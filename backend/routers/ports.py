import asyncio
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db, PortRule, VPS, LXC
from auth import get_current_user
from ssh_manager import SSHClient
import wireguard as wg
import logger as log

READ_IPTABLES = """
echo "=== PREROUTING ==="
iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null
echo "=== FORWARD ==="
iptables -L FORWARD -n 2>/dev/null
"""


def _parse_iptables(output: str) -> list[dict]:
    """Parse iptables PREROUTING DNAT rules into structured list."""
    rules = []
    in_pre = False
    for line in output.splitlines():
        if "=== PREROUTING ===" in line:
            in_pre = True
            continue
        if "=== FORWARD ===" in line:
            in_pre = False
            continue
        if not in_pre:
            continue
        # Match DNAT lines: tcp dpt:PORT to:DEST:PORT
        m = re.search(r'(tcp|udp)\s+.*dpt:(\d+)\s+to:([^\s:]+):(\d+)', line)
        if m:
            rules.append({
                "protocol": m.group(1),
                "port": int(m.group(2)),
                "target_ip": m.group(3),
                "target_port": int(m.group(4)),
            })
    return rules

router = APIRouter(prefix="/api/ports", tags=["ports"])


class PortRuleCreate(BaseModel):
    vps_id: int
    lxc_id: Optional[int] = None
    port: int
    protocol: str = "tcp"
    mode: str = "split_tunnel"
    target_ip: Optional[str] = None
    target_port: Optional[int] = None
    description: Optional[str] = None


@router.get("/sync/{vps_id}")
def sync_from_vps(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Read live iptables from VPS and compare with DB rules. Returns diff."""
    v = db.query(VPS).filter(VPS.id == vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")
    if not v.ssh_key_path:
        raise HTTPException(400, "VPS has no SSH key")

    try:
        with SSHClient(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path) as ssh:
            _, out, _ = ssh.run(READ_IPTABLES)
    except Exception as e:
        raise HTTPException(500, f"SSH error: {e}")

    live_rules = _parse_iptables(out)

    # Get DB rules for this VPS
    db_rules = db.query(PortRule).filter(PortRule.vps_id == vps_id).all()
    db_keys = {(r.port, r.protocol, r.target_ip) for r in db_rules}

    # Find rules on VPS not in DB (manual/external configs)
    missing_in_db = []
    for rule in live_rules:
        key = (rule["port"], rule["protocol"], rule["target_ip"])
        if key not in db_keys:
            missing_in_db.append(rule)

    # Find DB rules not on VPS (DB out of sync)
    live_keys = {(r["port"], r["protocol"], r["target_ip"]) for r in live_rules}
    missing_on_vps = []
    for r in db_rules:
        if r.enabled and (r.port, r.protocol, r.target_ip) not in live_keys:
            missing_on_vps.append(_serialize(r))

    return {
        "live_rules": live_rules,
        "missing_in_db": missing_in_db,
        "missing_on_vps": missing_on_vps,
        "raw_output": out,
    }


@router.post("/import/{vps_id}")
def import_from_vps(vps_id: int, rules: list[dict], db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Import manually-configured rules from VPS into DB."""
    v = db.query(VPS).filter(VPS.id == vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")

    imported = []
    for rule in rules:
        existing = db.query(PortRule).filter(
            PortRule.vps_id == vps_id,
            PortRule.port == rule["port"],
            PortRule.protocol == rule["protocol"],
        ).first()
        if existing:
            continue
        r = PortRule(
            vps_id=vps_id,
            port=rule["port"],
            protocol=rule.get("protocol", "tcp"),
            mode="simple_dnat",
            target_ip=rule["target_ip"],
            target_port=rule.get("target_port", rule["port"]),
            description="Importado do VPS",
            enabled=True,
        )
        db.add(r)
        imported.append(rule)

    db.commit()
    return {"imported": len(imported), "rules": imported}


@router.post("/apply-missing/{vps_id}")
async def apply_missing_to_vps(vps_id: int, rules: list[dict], db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Re-apply DB rules that are missing from VPS (e.g. after reboot)."""
    v = db.query(VPS).filter(VPS.id == vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")

    # Copy fields before thread to avoid detached instance error
    v_host = v.host; v_port = v.ssh_port; v_user = v.ssh_user
    v_key = v.ssh_key_path; v_pub_iface = v.pub_interface or "ens3"; v_name = v.name

    await log.emit("info", f"Re-applying {len(rules)} missing rules to VPS {v_name}...", "sync")

    def apply():
        try:
            with SSHClient(v_host, v_port, v_user, v_key) as ssh:
                for rule in rules:
                    script = wg.VPS_ADD_PORT.format(
                        pub_iface=v_pub_iface,
                        dest_ip=rule["target_ip"],
                        port=rule["port"],
                        proto=rule["protocol"],
                    )
                    _, out, _ = ssh.run(script)
                    log.emit_sync("info", f"Port {rule['port']}: {out.strip()}", "sync")
            log.emit_sync("success", "Sync completo", "sync")
        except Exception as e:
            log.emit_sync("error", str(e), "sync")

    asyncio.get_event_loop().run_in_executor(None, apply)
    return {"ok": True}


@router.get("")
def list_rules(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rules = db.query(PortRule).all()
    return [_serialize(r) for r in rules]


@router.post("")
async def create_rule(data: PortRuleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = db.query(VPS).filter(VPS.id == data.vps_id).first()
    if not v:
        raise HTTPException(404, "VPS not found")

    dest_ip = None
    if data.lxc_id:
        c = db.query(LXC).filter(LXC.id == data.lxc_id).first()
        if not c or not c.wg_address:
            raise HTTPException(400, "LXC has no WireGuard address. Install WireGuard first.")
        dest_ip = c.wg_address.split("/")[0]
    elif data.target_ip:
        dest_ip = data.target_ip
    else:
        raise HTTPException(400, "Must provide lxc_id or target_ip")

    rule = PortRule(
        vps_id=data.vps_id, lxc_id=data.lxc_id,
        port=data.port, protocol=data.protocol,
        mode=data.mode, target_ip=dest_ip,
        target_port=data.target_port or data.port,
        description=data.description, enabled=True,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    await log.emit("info", f"Adding port rule {data.port}/{data.protocol} → {dest_ip}", "add-port")

    def apply():
        try:
            protos = ["tcp", "udp"] if data.protocol == "both" else [data.protocol]
            with SSHClient(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path) as ssh:
                for proto in protos:
                    script = wg.VPS_ADD_PORT.format(
                        pub_iface=v.pub_interface or "ens3",
                        dest_ip=dest_ip,
                        port=data.port,
                        proto=proto,
                    )
                    code, out, _ = ssh.run(script)
                    log.emit_sync("info" if code == 0 else "error", out, "add-port")
            log.emit_sync("success", f"Port {data.port}/{data.protocol} active on VPS {v.name}", "add-port")
        except Exception as e:
            log.emit_sync("error", str(e), "add-port")

    asyncio.get_event_loop().run_in_executor(None, apply)
    return _serialize(rule)


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = db.query(PortRule).filter(PortRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    v = db.query(VPS).filter(VPS.id == rule.vps_id).first()

    # Copy all fields before thread to avoid detached instance error
    r_port = rule.port; r_protocol = rule.protocol; r_target_ip = rule.target_ip
    v_host = v.host if v else None; v_port = v.ssh_port if v else 22
    v_user = v.ssh_user if v else "root"; v_key = v.ssh_key_path if v else None
    v_pub_iface = (v.pub_interface or "ens3") if v else "ens3"

    await log.emit("info", f"Removing port {r_port}/{r_protocol}", "del-port")

    def remove():
        if not v_host or not v_key:
            return
        try:
            protos = ["tcp", "udp"] if r_protocol == "both" else [r_protocol]
            with SSHClient(v_host, v_port, v_user, v_key) as ssh:
                for proto in protos:
                    script = wg.VPS_REMOVE_PORT.format(
                        pub_iface=v_pub_iface,
                        dest_ip=r_target_ip,
                        port=r_port,
                        proto=proto,
                    )
                    _, out, _ = ssh.run(script)
                    log.emit_sync("info", out, "del-port")
            log.emit_sync("success", f"Porta {r_port} removida do VPS", "del-port")
        except Exception as e:
            log.emit_sync("error", str(e), "del-port")

    asyncio.get_event_loop().run_in_executor(None, remove)
    db.delete(rule)
    db.commit()
    return {"ok": True}


class PortRuleUpdate(BaseModel):
    vps_id: Optional[int] = None
    lxc_id: Optional[int] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    mode: Optional[str] = None
    target_ip: Optional[str] = None
    target_port: Optional[int] = None
    description: Optional[str] = None


@router.put("/{rule_id}")
def update_rule(rule_id: int, data: PortRuleUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = db.query(PortRule).filter(PortRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    db.commit()
    return _serialize(rule)


@router.patch("/{rule_id}/toggle")
async def toggle_rule(rule_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = db.query(PortRule).filter(PortRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    v = db.query(VPS).filter(VPS.id == rule.vps_id).first()
    rule.enabled = not rule.enabled
    db.commit()

    # Copy all fields before thread to avoid detached instance error
    r_port = rule.port; r_protocol = rule.protocol; r_enabled = rule.enabled; r_target_ip = rule.target_ip
    v_host = v.host if v else None; v_port = v.ssh_port if v else 22
    v_user = v.ssh_user if v else "root"; v_key = v.ssh_key_path if v else None
    v_pub_iface = (v.pub_interface or "ens3") if v else "ens3"

    action = "add-port" if r_enabled else "del-port"
    await log.emit("info", f"{'Habilitando' if r_enabled else 'Desabilitando'} porta {r_port}", action)

    def apply():
        if not v_host or not v_key:
            return
        try:
            protos = ["tcp", "udp"] if r_protocol == "both" else [r_protocol]
            with SSHClient(v_host, v_port, v_user, v_key) as ssh:
                for proto in protos:
                    template = wg.VPS_ADD_PORT if r_enabled else wg.VPS_REMOVE_PORT
                    script = template.format(
                        pub_iface=v_pub_iface,
                        dest_ip=r_target_ip,
                        port=r_port,
                        proto=proto,
                    )
                    _, out, _ = ssh.run(script)
                    log.emit_sync("info", out, action)
        except Exception as e:
            log.emit_sync("error", str(e), action)

    asyncio.get_event_loop().run_in_executor(None, apply)
    return _serialize(rule)


def _serialize(r: PortRule) -> dict:
    return {
        "id": r.id, "vps_id": r.vps_id, "lxc_id": r.lxc_id,
        "port": r.port, "protocol": r.protocol, "mode": r.mode,
        "target_ip": r.target_ip, "target_port": r.target_port,
        "description": r.description, "enabled": r.enabled,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
