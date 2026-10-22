import asyncio
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

import config
import logger as log
import proxmox_local as host
import validators as val
import wireguard as wg
from auth import get_current_user
from database import LXC, VPS, PortRule, get_db
from ssh_manager import fingerprint_sha256
from vps_ssh import VPSConn, open_ssh

router = APIRouter(prefix="/api/vps", tags=["vps"], dependencies=[Depends(get_current_user)])

MAX_KEY_BYTES = 16 * 1024


def _serialize(v: VPS) -> dict:
    return {
        "id": v.id, "name": v.name, "host": v.host,
        "ssh_port": v.ssh_port, "ssh_user": v.ssh_user,
        "ssh_host_key": fingerprint_sha256(v.ssh_host_key),
        "wg_public_key": v.wg_public_key, "wg_address": v.wg_address,
        "wg_listen_port": v.wg_listen_port, "wg_interface": v.wg_interface,
        "pub_interface": v.pub_interface,
        "gw_ip": v.gw_ip, "gw_iface": v.gw_iface, "lan_iface": v.lan_iface,
        "status": v.status, "last_error": v.last_error,
        "last_seen": v.last_seen.isoformat() + "Z" if v.last_seen else None,
        "created_at": v.created_at.isoformat() + "Z" if v.created_at else None,
        "rules": len(v.port_rules),
    }


def _get(vps_id: int, db: Session) -> VPS:
    v = db.get(VPS, vps_id)
    if not v:
        raise HTTPException(404, "VPS não encontrada")
    return v


async def _in_thread(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


@router.get("")
def list_vps(db: Session = Depends(get_db)):
    return [_serialize(v) for v in db.query(VPS).order_by(VPS.id).all()]


@router.post("")
async def create_vps(
    name: str = Form(...), host_: str = Form(..., alias="host"), ssh_port: int = Form(22),
    ssh_user: str = Form("root"), ssh_key: UploadFile = File(...), db: Session = Depends(get_db),
):
    name = val.text(name, 60) or val.bad("Nome obrigatório")
    content = await ssh_key.read(MAX_KEY_BYTES + 1)
    if len(content) > MAX_KEY_BYTES or b"PRIVATE KEY" not in content:
        val.bad("Envie uma chave privada SSH válida (OpenSSH/PEM)")
    # Random filename: user input never becomes part of a path.
    key_path = os.path.join(config.SSH_KEYS_DIR, f"vps_{uuid.uuid4().hex}.key")
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(content)
    v = VPS(name=name, host=val.host(host_), ssh_port=val.port(ssh_port, "Porta SSH"),
            ssh_user=val.ssh_user(ssh_user), ssh_key_path=key_path, status="pending",
            lan_iface=host.default_lan_iface())
    db.add(v)
    db.commit()
    db.refresh(v)
    await log.emit("info", f"VPS {v.name} cadastrada", "vps")
    return _serialize(v)


class VPSUpdate(BaseModel):
    name: str | None = None
    ssh_port: int | None = None
    ssh_user: str | None = None
    pub_interface: str | None = None
    wg_interface: str | None = None
    gw_ip: str | None = None
    gw_iface: str | None = None
    lan_iface: str | None = None


@router.patch("/{vps_id}")
def update_vps(vps_id: int, data: VPSUpdate, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    d = data.model_dump(exclude_unset=True)
    if "name" in d: v.name = val.text(d["name"], 60) or val.bad("Nome obrigatório")
    if "ssh_port" in d: v.ssh_port = val.port(d["ssh_port"], "Porta SSH")
    if "ssh_user" in d: v.ssh_user = val.ssh_user(d["ssh_user"])
    if "pub_interface" in d: v.pub_interface = val.iface(d["pub_interface"])
    if "wg_interface" in d: v.wg_interface = val.iface(d["wg_interface"])
    if "gw_ip" in d: v.gw_ip = val.ipv4(d["gw_ip"], "IP do gateway") if d["gw_ip"] else None
    if "gw_iface" in d: v.gw_iface = val.iface(d["gw_iface"]) if d["gw_iface"] else None
    if "lan_iface" in d: v.lan_iface = val.iface(d["lan_iface"])
    db.commit()
    return _serialize(v)


@router.post("/{vps_id}/reset-host-key")
def reset_host_key(vps_id: int, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    v.ssh_host_key = None
    db.commit()
    return _serialize(v)


@router.post("/{vps_id}/test")
async def test_connection(vps_id: int, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    conn = VPSConn(v)

    def run():
        with open_ssh(conn) as ssh:
            code, out, err = ssh.run("echo ok; sudo -n true 2>/dev/null && echo SUDO_OK || true; id -u")
            return code, out, err
    try:
        code, out, _ = await _in_thread(run)
    except Exception as e:
        return {"ok": False, "error": str(e) or e.__class__.__name__}
    can_root = conn.ssh_user == "root" or "SUDO_OK" in out
    db.refresh(v)
    if v.status == "pending":
        v.status = "connected"
        db.commit()
    return {"ok": code == 0 and "ok" in out, "root": can_root, "host_key": fingerprint_sha256(v.ssh_host_key)}


@router.post("/{vps_id}/detect")
async def detect(vps_id: int, db: Session = Depends(get_db)):
    """Read the existing WireGuard config on the VPS and the matching gateway on this host."""
    v = _get(vps_id, db)
    conn = VPSConn(v)

    def run():
        with open_ssh(conn) as ssh:
            return ssh.run(wg.VPS_DETECT.format(iface=conn.wg_interface), sudo=True)[1]
    try:
        out = await _in_thread(run)
    except Exception as e:
        raise HTTPException(502, f"SSH: {e}")

    import firewall as fw
    secs = fw.split_sections(out)
    if "YES" not in secs.get("WG_INSTALLED", []):
        return {"detected": False, "message": "WireGuard não está instalado na VPS"}
    conf = secs.get("WG_CONF", [])
    if conf == ["NO_CONF"]:
        return {"detected": False, "message": f"WireGuard instalado, mas sem /etc/wireguard/{conn.wg_interface}.conf"}
    priv, address, listen = "", "", 51820
    for line in conf:
        k, _, val_ = line.partition("=")
        k, val_ = k.strip(), val_.strip()
        if k == "PrivateKey": priv = val_
        elif k == "Address": address = val_.split(",")[0].strip()
        elif k == "ListenPort" and val_.isdigit(): listen = int(val_)
    pub = ""
    if priv:
        try:
            pub = wg.public_key(priv)
        except Exception:
            pub = ""
    pub_iface = (secs.get("PUB_IFACE") or [""])[0].strip() or v.pub_interface or "ens3"

    v.wg_public_key = pub or v.wg_public_key
    v.wg_address = address or v.wg_address
    v.wg_listen_port = listen
    v.pub_interface = val.iface(pub_iface)
    v.status = "wg_ready"
    gw = await _in_thread(host.detect_gateway, v.host, pub or None)
    if gw:
        v.gw_ip, v.gw_iface = gw["ip"], gw["iface"]
        v.lan_iface = v.lan_iface or host.default_lan_iface()
    db.commit()
    await log.emit("success", f"{v.name}: WireGuard {address} detectado" + (f", gateway {gw['ip']} via {gw['iface']}" if gw else ""), "vps")
    return {"detected": True, "wg_address": address, "wg_public_key": pub, "listen_port": listen,
            "pub_interface": pub_iface, "gateway": gw}


@router.post("/{vps_id}/install-wireguard")
async def install_wireguard(vps_id: int, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    if v.wg_public_key:
        raise HTTPException(409, "Esta VPS já tem WireGuard configurado. Use 'Detectar' para reimportar.")
    priv, pub = wg.generate_keypair()
    address = "10.10.0.1/24"
    conn = VPSConn(v)
    await log.emit("info", f"Instalando WireGuard em {v.name}…", "install-wg")

    def run():
        from database import SessionLocal
        try:
            with open_ssh(conn, timeout=20) as ssh:
                _, iface, _ = ssh.run("ip route | awk '/default/ {print $5; exit}'")
                pub_iface = val.iface(iface.strip() or "ens3")
                script = wg.VPS_WG_SETUP.format(iface=conn.wg_interface, privkey=priv, address=address, port=conn.wg_listen_port)
                code, out, _ = ssh.run(script, sudo=True, timeout=600,
                                       log_cb=lambda lvl, msg: log.emit_sync(lvl, msg, "install-wg"))
            if code != 0 or "WG_SETUP_OK" not in out:
                log.emit_sync("error", f"Instalação falhou (código {code})", "install-wg")
                return
            db2 = SessionLocal()
            try:
                row = db2.get(VPS, conn.id)
                row.wg_private_key, row.wg_public_key, row.wg_address = priv, pub, address
                row.pub_interface, row.status = pub_iface, "wg_ready"
                db2.commit()
            finally:
                db2.close()
            log.emit_sync("success", f"WireGuard ativo em {conn.name} ({address})", "install-wg")
        except Exception as e:
            log.emit_sync("error", str(e), "install-wg")

    asyncio.get_running_loop().run_in_executor(None, run)
    return {"ok": True, "started": True}


@router.get("/{vps_id}/peers")
async def peers(vps_id: int, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    conn = VPSConn(v)

    def run():
        with open_ssh(conn, timeout=10) as ssh:
            return ssh.run(wg.VPS_PEERS.format(iface=conn.wg_interface), sudo=True)[1]
    try:
        out = await _in_thread(run)
    except Exception as e:
        raise HTTPException(502, f"SSH: {e}")
    lxcs = {c.wg_public_key: c for c in db.query(LXC).filter(LXC.wg_public_key.isnot(None)).all()}
    local = {i["public_key"]: i for i in await _in_thread(host.local_wg_interfaces)}
    result = []
    for p in wg.parse_dump(out):
        c = lxcs.get(p["pubkey"])
        label, kind = None, "unknown"
        if p["pubkey"] in local:
            label, kind = f"Host Proxmox ({local[p['pubkey']]['name']})", "host"
        elif c:
            label, kind = f"CT {c.vmid} · {c.name}", "lxc"
        p.update(label=label, kind=kind, lxc_id=c.id if c else None,
                 orphan=not p["allowed_ips"])
        result.append(p)
    return result


class PeerRemove(BaseModel):
    pubkey: str


@router.post("/{vps_id}/peers/remove")
async def remove_peer(vps_id: int, data: PeerRemove, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    key = val.wg_key(data.pubkey)
    local = {i["public_key"] for i in await _in_thread(host.local_wg_interfaces)}
    if key in local:
        raise HTTPException(400, "Este peer é o próprio host Proxmox — removê-lo derruba todos os encaminhamentos")
    conn = VPSConn(v)

    def run():
        with open_ssh(conn) as ssh:
            return ssh.run(wg.VPS_REMOVE_PEER.format(iface=conn.wg_interface, pubkey=key), sudo=True)
    code, out, err = await _in_thread(run)
    if "PEER_REMOVED" not in out:
        raise HTTPException(500, (err or out).strip()[-300:])
    await log.emit("warn", f"{v.name}: peer {key[:10]}… removido", "vps")
    return {"ok": True}


@router.delete("/{vps_id}")
def delete_vps(vps_id: int, db: Session = Depends(get_db)):
    v = _get(vps_id, db)
    if db.query(PortRule).filter(PortRule.vps_id == vps_id, PortRule.enabled.is_(True)).count():
        raise HTTPException(409, "Remova ou desative os encaminhamentos desta VPS antes de excluí-la")
    if v.ssh_key_path and os.path.realpath(v.ssh_key_path).startswith(os.path.realpath(config.SSH_KEYS_DIR) + os.sep):
        try:
            os.remove(v.ssh_key_path)
        except FileNotFoundError:
            pass
    db.query(LXC).filter(LXC.wg_vps_id == vps_id).update({LXC.wg_vps_id: None})
    db.delete(v)
    db.commit()
    return {"ok": True}
