"""Proxmox guests (LXC + VMs) and the optional "WireGuard inside the container" mode."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import logger as log
import proxmox_local as host
import validators as val
import wireguard as wg
from auth import get_current_user
from database import LXC, VPS, PortRule, get_db
from vps_ssh import VPSConn, open_ssh

router = APIRouter(prefix="/api/lxc", tags=["lxc"], dependencies=[Depends(get_current_user)])


def _serialize(c: LXC) -> dict:
    return {
        "id": c.id, "vmid": c.vmid, "name": c.name, "proxmox_node": c.proxmox_node,
        "wg_public_key": c.wg_public_key, "wg_address": c.wg_address, "wg_vps_id": c.wg_vps_id,
        "status": c.status, "created_at": c.created_at.isoformat() + "Z" if c.created_at else None,
    }


def _get(lxc_id: int, db: Session) -> LXC:
    c = db.get(LXC, lxc_id)
    if not c:
        raise HTTPException(404, "Container não encontrado")
    return c


async def _in_thread(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


@router.get("/guests")
async def guests(refresh: bool = False, db: Session = Depends(get_db)):
    """Every LXC/VM on the cluster with its IPs, merged with what the panel knows about it."""
    try:
        items = await _in_thread(host.list_guests, refresh)
    except host.HostError as e:
        raise HTTPException(503, str(e))
    managed = {c.vmid: c for c in db.query(LXC).all()}
    rules = db.query(PortRule).all()
    for g in items:
        c = managed.get(g["vmid"])
        g["managed"] = _serialize(c) if c else None
        ips = {i["ip"] for i in g["ips"]} | ({c.wg_address.split("/")[0]} if c and c.wg_address else set())
        g["forwards"] = sum(1 for r in rules if r.vmid == g["vmid"] or r.target_ip in ips)
    return items


@router.get("")
def list_lxc(db: Session = Depends(get_db)):
    return [_serialize(c) for c in db.query(LXC).order_by(LXC.vmid).all()]


class LXCImport(BaseModel):
    vmid: int
    name: str
    proxmox_node: str = "pve"


@router.post("")
def import_lxc(data: LXCImport, db: Session = Depends(get_db)):
    existing = db.query(LXC).filter(LXC.vmid == data.vmid).first()
    if existing:
        return _serialize(existing)
    c = LXC(vmid=int(data.vmid), name=val.text(data.name, 60), proxmox_node=val.iface(data.proxmox_node, "Nó"), status="imported")
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serialize(c)


@router.get("/{lxc_id}/check-wg")
async def check_wg(lxc_id: int, db: Session = Depends(get_db)):
    c = _get(lxc_id, db)
    try:
        _, out = await _in_thread(host.pct_exec, c.vmid, wg.LXC_CHECK_WG_EXISTING)
    except Exception as e:
        raise HTTPException(502, str(e))
    kv = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    return {"installed": kv.get("WG_INSTALLED") == "1", "running": kv.get("WG_RUNNING") == "1",
            "config_exists": kv.get("WG_CONFIG_EXISTS") == "1", "address": kv.get("WG_ADDRESS", ""),
            "peer": kv.get("WG_PEER", "")}


@router.post("/{lxc_id}/check-permissions")
async def check_permissions(lxc_id: int, db: Session = Depends(get_db)):
    c = _get(lxc_id, db)
    try:
        _, out = await _in_thread(host.pct_exec, c.vmid, wg.LXC_CHECK_PERMISSIONS)
    except Exception as e:
        raise HTTPException(502, str(e))
    ok = "PERMISSIONS_OK" in out
    if ok and c.status == "imported":
        c.status = "ready"
        db.commit()
    issues = []
    if "OS_NOT_SUPPORTED" in out:
        issues.append({"key": "os", "message": "Sistema não é Debian/Ubuntu", "fixable": False})
    if "WG_MODULE_MISSING" in out:
        issues.append({"key": "wg_module", "message": "Não consegue criar interface WireGuard (habilitar nesting)", "fixable": True})
    if "NET_ADMIN_MISSING" in out:
        issues.append({"key": "net_admin", "message": "Sem permissão NET_ADMIN", "fixable": True})
    return {"ok": ok, "issues": issues}


@router.post("/{lxc_id}/fix-permissions")
async def fix_permissions(lxc_id: int, db: Session = Depends(get_db)):
    c = _get(lxc_id, db)
    ok, out = await _in_thread(host.enable_nesting, c.vmid)
    await log.emit("success" if ok else "error", f"CT {c.vmid}: nesting {'habilitado' if ok else 'falhou'} {out}", "lxc")
    return {"ok": ok, "output": out, "restart_required": ok}


class WGInstall(BaseModel):
    vps_id: int
    full_tunnel: bool = False


@router.post("/{lxc_id}/install-wireguard")
async def install_wireguard(lxc_id: int, data: WGInstall, db: Session = Depends(get_db)):
    c = _get(lxc_id, db)
    v = db.get(VPS, data.vps_id)
    if not v:
        raise HTTPException(404, "VPS não encontrada")
    if not v.wg_public_key or not v.wg_address:
        raise HTTPException(400, "A VPS ainda não tem WireGuard configurado (use Detectar ou Instalar)")
    if c.wg_public_key:
        raise HTTPException(409, "Este container já tem WireGuard pelo painel. Remova antes de reinstalar.")
    conn = VPSConn(v)

    # Allocate against the *live* peers of the VPS, not only the database.
    def live_peers():
        with open_ssh(conn, timeout=10) as ssh:
            return wg.parse_dump(ssh.run(wg.VPS_PEERS.format(iface=conn.wg_interface), sudo=True)[1])
    try:
        peers = await _in_thread(live_peers)
    except Exception as e:
        raise HTTPException(502, f"Não foi possível ler os peers da VPS: {e}")
    used = [p["allowed_ips"] or "" for p in peers]
    used += [x.wg_address for x in db.query(LXC).filter(LXC.wg_address.isnot(None), LXC.wg_vps_id == v.id).all()]
    used += [g["address"] for g in host.local_wg_interfaces() if g.get("address")]
    address = wg.find_free_wg_address(used, v.wg_address)
    prefix = address.split("/")[1]
    lxc_ip = address.split("/")[0]
    net = v.wg_address.split("/")[0].rsplit(".", 1)[0] + f".0/{prefix}"
    allowed = "0.0.0.0/0" if data.full_tunnel else net
    priv, pub = wg.generate_keypair()
    vmid, name, cid = c.vmid, c.name or f"CT-{c.vmid}", c.id
    await log.emit("info", f"Instalando WireGuard no CT {vmid} ({address})…", "install-wg-lxc")

    def run():
        from database import SessionLocal
        try:
            with open_ssh(conn) as ssh:
                code, out, _ = ssh.run(wg.VPS_ADD_PEER.format(iface=conn.wg_interface, pubkey=pub,
                                                              allowed_ip=f"{lxc_ip}/32", label=val.text(name, 40)), sudo=True)
            if "PEER_ADDED" not in out:
                log.emit_sync("error", f"Falha ao adicionar peer na VPS: {out.strip()[-200:]}", "install-wg-lxc")
                return
            script = wg.LXC_WG_SETUP.format(privkey=priv, address=address, vps_pubkey=conn.wg_public_key,
                                            vps_host=conn.host, vps_port=conn.wg_listen_port, allowed_ips=allowed)
            for line in host.pct_exec_stream(vmid, script):
                log.emit_sync("info", line, "install-wg-lxc")
            db2 = SessionLocal()
            try:
                row = db2.get(LXC, cid)
                row.wg_private_key, row.wg_public_key, row.wg_address = priv, pub, address
                row.wg_vps_id, row.status = conn.id, "wg_ready"
                db2.commit()
            finally:
                db2.close()
            log.emit_sync("success", f"WireGuard ativo no CT {vmid} ({lxc_ip})", "install-wg-lxc")
        except Exception as e:
            log.emit_sync("error", str(e), "install-wg-lxc")

    asyncio.get_running_loop().run_in_executor(None, run)
    return {"ok": True, "wg_address": address}


@router.post("/{lxc_id}/remove-wireguard")
async def remove_wireguard(lxc_id: int, db: Session = Depends(get_db)):
    c = _get(lxc_id, db)
    v = db.get(VPS, c.wg_vps_id) if c.wg_vps_id else None
    conn = VPSConn(v) if v else None
    vmid, pub = c.vmid, c.wg_public_key
    await log.emit("warn", f"Removendo WireGuard do CT {vmid}…", "remove-wg")

    def run():
        _, out = host.pct_exec(vmid, wg.LXC_REMOVE_WG)
        log.emit_sync("info", out.strip(), "remove-wg")
        if conn and pub:
            with open_ssh(conn) as ssh:
                ssh.run(wg.VPS_REMOVE_PEER.format(iface=conn.wg_interface, pubkey=pub), sudo=True)
            log.emit_sync("info", f"Peer removido da VPS {conn.name}", "remove-wg")
    try:
        await _in_thread(run)
    except Exception as e:
        await log.emit("error", str(e), "remove-wg")
        raise HTTPException(502, str(e))
    c.wg_public_key = c.wg_private_key = c.wg_address = None
    c.wg_vps_id = None
    c.status = "ready"
    db.commit()
    await log.emit("success", f"WireGuard removido do CT {vmid}", "remove-wg")
    return {"ok": True}


@router.delete("/{lxc_id}")
async def delete_lxc(lxc_id: int, forget: bool = False, db: Session = Depends(get_db)):
    """forget=true: the container no longer exists in Proxmox — drop the record and its VPS peer."""
    c = _get(lxc_id, db)
    if c.wg_public_key and not forget:
        raise HTTPException(409, "Remova o WireGuard do container antes de tirá-lo do painel")
    if forget:
        try:
            exists = any(g["vmid"] == c.vmid for g in await _in_thread(host.list_guests, True))
        except host.HostError:
            exists = False
        if exists:
            raise HTTPException(409, f"O CT {c.vmid} ainda existe no Proxmox — use Remover WireGuard")
        v = db.get(VPS, c.wg_vps_id) if c.wg_vps_id else None
        if v and c.wg_public_key:
            conn, pub = VPSConn(v), c.wg_public_key

            def drop_peer():
                with open_ssh(conn) as ssh:
                    ssh.run(wg.VPS_REMOVE_PEER.format(iface=conn.wg_interface, pubkey=pub), sudo=True)
            try:
                await _in_thread(drop_peer)
                await log.emit("info", f"Peer do CT {c.vmid} removido de {v.name}", "lxc")
            except Exception as e:
                await log.emit("warn", f"Peer do CT {c.vmid} não removido da VPS: {e}", "lxc")
    db.query(PortRule).filter(PortRule.lxc_id == lxc_id).update({PortRule.lxc_id: None})
    db.delete(c)
    db.commit()
    return {"ok": True}
