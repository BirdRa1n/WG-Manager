import os
import asyncio
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db, VPS
from auth import get_current_user
from ssh_manager import SSHClient, test_ssh_connection
import wireguard as wg
import logger as log

SSH_KEYS_DIR = os.getenv("SSH_KEYS_DIR", "/opt/wg-proxy-manager/keys")
os.makedirs(SSH_KEYS_DIR, exist_ok=True)

router = APIRouter(prefix="/api/vps", tags=["vps"])


class VPSCreate(BaseModel):
    name: str
    host: str
    ssh_port: int = 22
    ssh_user: str = "root"


@router.get("")
def list_vps(db: Session = Depends(get_db), user=Depends(get_current_user)):
    items = db.query(VPS).all()
    return [_serialize(v) for v in items]


@router.post("")
async def create_vps(
    name: str = Form(...),
    host: str = Form(...),
    ssh_port: int = Form(22),
    ssh_user: str = Form("root"),
    ssh_key: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    key_path = os.path.join(SSH_KEYS_DIR, f"vps_{name.replace(' ', '_')}.key")
    content = await ssh_key.read()
    with open(key_path, "wb") as f:
        f.write(content)
    os.chmod(key_path, 0o600)

    v = VPS(name=name, host=host, ssh_port=ssh_port, ssh_user=ssh_user, ssh_key_path=key_path, status="pending")
    db.add(v)
    db.commit()
    db.refresh(v)
    return _serialize(v)


@router.post("/{vps_id}/test")
async def test_connection(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = _get_or_404(vps_id, db)
    ok = test_ssh_connection(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path)
    if ok:
        v.status = "connected"
        db.commit()
    return {"ok": ok}


@router.post("/{vps_id}/install-wireguard")
async def install_wireguard(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = _get_or_404(vps_id, db)
    used = [x.wg_address for x in db.query(VPS).filter(VPS.wg_address.isnot(None)).all()]
    priv, pub = wg.generate_keypair()
    address = wg.find_free_wg_address(used)

    # Copy all needed fields before thread (avoid detached instance error)
    vps_host = v.host; vps_port = v.ssh_port; vps_user = v.ssh_user
    vps_key = v.ssh_key_path; vps_iface = v.wg_interface or "wg0"
    vps_wg_port = v.wg_listen_port or 51820; vps_name = v.name

    await log.emit("info", f"Connecting to VPS {vps_host}...", "install-wg")

    def run():
        from database import SessionLocal
        thread_db = SessionLocal()
        try:
            with SSHClient(vps_host, vps_port, vps_user, vps_key) as ssh:
                _, iface, _ = ssh.run("ip route | awk '/default/ {print $5; exit}'")
                pub_iface = iface.strip() or "ens3"
                log.emit_sync("info", f"Public interface: {pub_iface}", "install-wg")

                script = wg.VPS_WG_SETUP.format(
                    iface=vps_iface, privkey=priv, address=address,
                    port=vps_wg_port, pub_iface=pub_iface,
                )

                def cb(level, msg):
                    log.emit_sync(level, msg, "install-wg")

                code, out, _ = ssh.run(script, log_cb=cb)
                if "WG_SETUP_OK" in out or code == 0:
                    row = thread_db.query(VPS).filter(VPS.id == vps_id).first()
                    if row:
                        row.wg_private_key = priv
                        row.wg_public_key = pub
                        row.wg_address = address
                        row.pub_interface = pub_iface
                        row.status = "wg_ready"
                        thread_db.commit()
                    log.emit_sync("success", f"WireGuard installed on VPS {vps_name}!", "install-wg")
                else:
                    log.emit_sync("error", f"Installation failed: {out}", "install-wg")
        except Exception as e:
            log.emit_sync("error", str(e), "install-wg")
        finally:
            thread_db.close()

    asyncio.get_event_loop().run_in_executor(None, run)
    return {"ok": True, "wg_address": address, "wg_public_key": pub}


@router.post("/{vps_id}/detect-wireguard")
async def detect_wireguard(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Read existing WireGuard config from VPS and import into DB."""
    v = _get_or_404(vps_id, db)
    # Copy fields before possible async gap
    v_host = v.host; v_port = v.ssh_port; v_user = v.ssh_user; v_key = v.ssh_key_path
    await log.emit("info", f"Conectando em {v_host}...", "detect-wg")
    try:
        with SSHClient(v_host, v_port, v_user, v_key) as ssh:
            DETECT = """
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
echo "=== WG_INSTALLED ==="
command -v wg > /dev/null 2>&1 && echo "YES" || echo "NO"
echo "=== WG_RUNNING ==="
$SUDO wg show wg0 2>/dev/null && echo "RUNNING" || echo "NOT_RUNNING"
echo "=== WG_CONF ==="
$SUDO cat /etc/wireguard/wg0.conf 2>/dev/null || echo "NO_CONF"
echo "=== PUB_IFACE ==="
ip route | awk '/default/ {print $5; exit}'
echo "=== IPTABLES ==="
$SUDO iptables -t nat -L PREROUTING -n 2>/dev/null
"""
            _, out, _ = ssh.run(DETECT)
    except Exception as e:
        raise HTTPException(500, f"SSH error: {e}")

    sections = {}
    cur = None
    for line in out.splitlines():
        if line.startswith("=== ") and line.endswith(" ==="):
            cur = line[4:-4]
            sections[cur] = []
        elif cur:
            sections[cur].append(line)

    installed = "YES" in "\n".join(sections.get("WG_INSTALLED", []))
    if not installed:
        return {"detected": False, "message": "WireGuard não instalado na VPS"}

    conf_lines = sections.get("WG_CONF", [])
    conf_text = "\n".join(conf_lines)

    if "NO_CONF" in conf_text:
        return {"detected": False, "message": "WireGuard instalado mas sem wg0.conf"}

    # Parse wg0.conf
    priv_key, address, listen_port = "", "", 51820
    for line in conf_lines:
        line = line.strip()
        if line.startswith("PrivateKey"):
            priv_key = line.split("=", 1)[1].strip()
        elif line.startswith("Address"):
            address = line.split("=", 1)[1].strip()
        elif line.startswith("ListenPort"):
            try: listen_port = int(line.split("=", 1)[1].strip())
            except: pass

    # Derive public key from private key
    pub_key = ""
    if priv_key:
        try:
            import subprocess
            pub_key = subprocess.check_output(
                ["wg", "pubkey"], input=priv_key.encode()
            ).decode().strip()
        except Exception:
            pub_key = ""

    pub_iface = "\n".join(sections.get("PUB_IFACE", [])).strip() or "ens3"

    # Parse iptables DNAT rules
    import re
    from database import PortRule
    iptables_out = "\n".join(sections.get("IPTABLES", []))
    port_rules = []
    for line in iptables_out.splitlines():
        m = re.search(r'(tcp|udp)\s+.*dpt:(\d+)\s+to:([^\s:]+):(\d+)', line)
        if m:
            port_rules.append({
                "protocol": m.group(1), "port": int(m.group(2)),
                "target_ip": m.group(3), "target_port": int(m.group(4)),
            })

    # Save to DB
    v.wg_private_key = priv_key
    v.wg_public_key = pub_key
    v.wg_address = address
    v.wg_listen_port = listen_port
    v.wg_interface = "wg0"
    v.pub_interface = pub_iface
    v.status = "wg_ready"

    # Import port rules not yet in DB
    imported_ports = 0
    for rule in port_rules:
        exists = db.query(PortRule).filter(
            PortRule.vps_id == vps_id,
            PortRule.port == rule["port"],
            PortRule.protocol == rule["protocol"],
        ).first()
        if not exists:
            db.add(PortRule(
                vps_id=vps_id, port=rule["port"], protocol=rule["protocol"],
                mode="simple_dnat", target_ip=rule["target_ip"],
                target_port=rule["target_port"], description="Importado do VPS",
                enabled=True,
            ))
            imported_ports += 1

    db.commit()
    return {
        "detected": True,
        "wg_address": address,
        "wg_public_key": pub_key,
        "listen_port": listen_port,
        "pub_interface": pub_iface,
        "ports_imported": imported_ports,
        "port_rules": port_rules,
    }


@router.get("/{vps_id}/wg-peers")
def wg_peers(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Read live WireGuard peers from VPS and correlate with panel DB."""
    v = _get_or_404(vps_id, db)
    try:
        with SSHClient(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path) as ssh:
            _, out, _ = ssh.run("sudo wg show wg0 dump 2>/dev/null || wg show wg0 dump 2>/dev/null")
    except Exception as e:
        raise HTTPException(500, f"SSH error: {e}")

    from database import LXC as LXCModel
    lxcs = db.query(LXCModel).filter(LXCModel.wg_public_key.isnot(None)).all()
    lxc_by_pubkey = {c.wg_public_key: c for c in lxcs}

    peers = []
    for line in out.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        pubkey, _preshared, endpoint, allowed_ips, last_handshake = parts[0], parts[1], parts[2], parts[3], parts[4]
        rx_bytes = int(parts[5]) if len(parts) > 5 else 0
        tx_bytes = int(parts[6]) if len(parts) > 6 else 0

        lxc = lxc_by_pubkey.get(pubkey)
        peers.append({
            "pubkey": pubkey,
            "endpoint": endpoint if endpoint != "(none)" else None,
            "allowed_ips": allowed_ips if allowed_ips != "(none)" else None,
            "last_handshake": int(last_handshake) if last_handshake.isdigit() else 0,
            "rx_bytes": rx_bytes,
            "tx_bytes": tx_bytes,
            "lxc_id": lxc.id if lxc else None,
            "lxc_name": lxc.name if lxc else None,
            "lxc_vmid": lxc.vmid if lxc else None,
            "in_panel": lxc is not None,
        })

    return peers


@router.delete("/{vps_id}")
def delete_vps(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = _get_or_404(vps_id, db)
    if v.ssh_key_path and os.path.exists(v.ssh_key_path):
        os.remove(v.ssh_key_path)
    db.delete(v)
    db.commit()
    return {"ok": True}


@router.get("/{vps_id}/wg-status")
def wg_status(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = _get_or_404(vps_id, db)
    try:
        with SSHClient(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path) as ssh:
            _, out, _ = ssh.run(f"wg show {v.wg_interface or 'wg0'} 2>/dev/null || echo 'not running'")
            return {"output": out}
    except Exception as e:
        return {"output": str(e)}


def _get_or_404(vps_id: int, db: Session) -> VPS:
    v = db.query(VPS).filter(VPS.id == vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")
    return v


def _serialize(v: VPS) -> dict:
    return {
        "id": v.id, "name": v.name, "host": v.host,
        "ssh_port": v.ssh_port, "ssh_user": v.ssh_user,
        "wg_public_key": v.wg_public_key, "wg_address": v.wg_address,
        "wg_listen_port": v.wg_listen_port, "wg_interface": v.wg_interface,
        "pub_interface": v.pub_interface, "status": v.status,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
