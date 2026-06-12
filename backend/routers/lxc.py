import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db, LXC, VPS
from auth import get_current_user, authenticate_proxmox
import proxmox_client as px
import wireguard as wg
import logger as log

router = APIRouter(prefix="/api/lxc", tags=["lxc"])


class LXCImport(BaseModel):
    vmid: int
    name: str
    proxmox_node: str = "pve"


@router.get("/proxmox-list")
def proxmox_list(ticket: str, node: str = "pve", user=Depends(get_current_user)):
    try:
        return px.list_lxc(ticket, node)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("")
def list_lxc(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_serialize(c) for c in db.query(LXC).all()]


@router.post("")
def import_lxc(data: LXCImport, db: Session = Depends(get_db), user=Depends(get_current_user)):
    existing = db.query(LXC).filter(LXC.vmid == data.vmid).first()
    if existing:
        return _serialize(existing)
    c = LXC(vmid=data.vmid, name=data.name, proxmox_node=data.proxmox_node, status="imported")
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serialize(c)


@router.get("/{lxc_id}/check-wg-existing")
async def check_wg_existing(lxc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(lxc_id, db)
    code, out = px.pct_exec(c.vmid, wg.LXC_CHECK_WG_EXISTING)
    installed = "WG_INSTALLED=1" in out
    running = "WG_RUNNING=1" in out
    config_exists = "WG_CONFIG_EXISTS=1" in out
    peer = ""
    for line in out.splitlines():
        if line.startswith("WG_PEER="):
            peer = line.split("=", 1)[1].strip()
    config = ""
    if "---WG_CONFIG_START---" in out and "---WG_CONFIG_END---" in out:
        start = out.index("---WG_CONFIG_START---") + len("---WG_CONFIG_START---\n")
        end = out.index("---WG_CONFIG_END---")
        config = out[start:end].strip()
    return {
        "installed": installed,
        "running": running,
        "config_exists": config_exists,
        "peer": peer,
        "config_preview": config[:500] if config else "",
    }


@router.post("/{lxc_id}/remove-wireguard")
async def remove_wireguard(lxc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(lxc_id, db)
    c_vmid = c.vmid

    await log.emit("warn", f"Removing existing WireGuard from CT {c_vmid}...", "remove-wg")

    def run():
        from database import SessionLocal
        thread_db = SessionLocal()
        try:
            for line in px.pct_exec_stream(c_vmid, wg.LXC_REMOVE_WG):
                log.emit_sync("info", line, "remove-wg")
            row = thread_db.query(LXC).filter(LXC.id == lxc_id).first()
            if row:
                row.wg_public_key = None
                row.wg_private_key = None
                row.wg_address = None
                row.wg_vps_id = None
                if row.status == "wg_ready":
                    row.status = "ready"
                thread_db.commit()
            log.emit_sync("success", f"WireGuard removido do CT {c_vmid}", "remove-wg")
        except Exception as e:
            log.emit_sync("error", str(e), "remove-wg")
        finally:
            thread_db.close()

    await asyncio.get_event_loop().run_in_executor(None, run)
    return {"ok": True}


@router.post("/{lxc_id}/check-permissions")
async def check_permissions(lxc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(lxc_id, db)
    await log.emit("info", f"Checking permissions for CT {c.vmid}...", "check-perms")

    def run():
        code, out = px.pct_exec(c.vmid, wg.LXC_CHECK_PERMISSIONS)
        log.emit_sync("info", out, "check-perms")
        return "PERMISSIONS_OK" in out, out

    ok, out = await asyncio.get_event_loop().run_in_executor(None, run)
    if ok:
        c.status = "ready"
        db.commit()
    return {"ok": ok, "output": out, "issues": _parse_issues(out)}


@router.post("/{lxc_id}/fix-permissions")
async def fix_permissions(lxc_id: int, ticket: str, csrf: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(lxc_id, db)
    await log.emit("info", f"Fixing permissions for CT {c.vmid}...", "fix-perms")
    ok = px.fix_lxc_permissions(ticket, csrf, c.vmid, c.proxmox_node)
    if ok:
        await log.emit("success", f"Permissions fixed for CT {c.vmid}", "fix-perms")
    else:
        await log.emit("error", f"Failed to fix permissions for CT {c.vmid}", "fix-perms")
    return {"ok": ok}


@router.post("/{lxc_id}/install-wireguard")
async def install_wireguard(
    lxc_id: int,
    vps_id: int,
    mode: str = "split_tunnel",
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    c = _get_or_404(lxc_id, db)
    v = db.query(VPS).filter(VPS.id == vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")
    if not v.wg_public_key:
        raise HTTPException(400, "VPS WireGuard not installed yet")

    from database import LXC as LXCModel
    used = [x.wg_address for x in db.query(LXCModel).filter(LXCModel.wg_address.isnot(None)).all()]
    used += [x.wg_address for x in db.query(VPS).filter(VPS.wg_address.isnot(None)).all()]

    priv, pub = wg.generate_keypair()
    address = wg.find_free_wg_address(used)
    lxc_ip = address.split("/")[0]
    allowed_ips = "0.0.0.0/0" if mode == "full_tunnel" else "10.10.0.0/24"

    # Copy fields before thread to avoid detached instance error
    lxc_vmid = c.vmid; lxc_name = c.name or f"CT-{c.vmid}"; lxc_id = c.id
    vps_pubkey = v.wg_public_key; vps_host = v.host; vps_port = v.ssh_port
    vps_user = v.ssh_user; vps_key = v.ssh_key_path
    vps_wg_port = v.wg_listen_port or 51820; vps_iface = v.wg_interface or "wg0"
    vps_id_val = v.id

    await log.emit("info", f"Installing WireGuard on CT {lxc_vmid}...", "install-wg-lxc")

    def run():
        from database import SessionLocal
        thread_db = SessionLocal()
        try:
            script = wg.LXC_WG_SETUP.format(
                privkey=priv, address=address, vps_pubkey=vps_pubkey,
                vps_host=vps_host, vps_port=vps_wg_port, allowed_ips=allowed_ips,
            )
            for line in px.pct_exec_stream(lxc_vmid, script):
                log.emit_sync("info", line, "install-wg-lxc")

            log.emit_sync("info", "Adding peer on VPS...", "install-wg-lxc")
            from ssh_manager import SSHClient as SSH
            with SSH(vps_host, vps_port, vps_user, vps_key) as ssh:
                peer_script = wg.VPS_ADD_PEER.format(
                    iface=vps_iface, pubkey=pub,
                    allowed_ips=f"{lxc_ip}/32", label=lxc_name,
                )
                code, out, _ = ssh.run(peer_script)
                log.emit_sync("info" if code == 0 else "error", out, "install-wg-lxc")

            row = thread_db.query(LXC).filter(LXC.id == lxc_id).first()
            if row:
                row.wg_private_key = priv
                row.wg_public_key = pub
                row.wg_address = address
                row.wg_vps_id = vps_id_val
                row.status = "wg_ready"
                thread_db.commit()
            log.emit_sync("success", f"WireGuard ready on CT {lxc_vmid} (IP: {lxc_ip})", "install-wg-lxc")
        except Exception as e:
            log.emit_sync("error", str(e), "install-wg-lxc")
        finally:
            thread_db.close()

    await asyncio.get_event_loop().run_in_executor(None, run)
    return {"ok": True, "wg_address": address, "lxc_ip": lxc_ip}


@router.delete("/{lxc_id}")
def delete_lxc(lxc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(lxc_id, db)
    db.delete(c)
    db.commit()
    return {"ok": True}


def _get_or_404(lxc_id: int, db: Session) -> LXC:
    c = db.query(LXC).filter(LXC.id == lxc_id).first()
    if not c:
        raise HTTPException(404, "LXC not found")
    return c


def _parse_issues(output: str) -> list:
    issues = []
    if "OS_NOT_SUPPORTED" in output:
        issues.append({"key": "os", "message": "OS não é Debian/Ubuntu", "fixable": False})
    if "WG_MODULE_MISSING" in output:
        issues.append({"key": "wg_module", "message": "Módulo WireGuard não disponível (habilite nesting=1)", "fixable": True})
    if "NET_ADMIN_MISSING" in output:
        issues.append({"key": "net_admin", "message": "Permissão NET_ADMIN ausente", "fixable": True})
    return issues


def _serialize(c: LXC) -> dict:
    return {
        "id": c.id, "vmid": c.vmid, "name": c.name,
        "proxmox_node": c.proxmox_node,
        "wg_public_key": c.wg_public_key, "wg_address": c.wg_address,
        "wg_vps_id": c.wg_vps_id, "os_type": c.os_type,
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
