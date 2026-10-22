"""Port forwards — the replacement for fw-manager on both the VPS and the Proxmox host."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import firewall as fw
import forward_engine as engine
import logger as log
import validators as val
from auth import get_current_user
from database import LXC, PortRule, VPS, get_db
from vps_ssh import VPSConn

router = APIRouter(prefix="/api/forwards", tags=["forwards"], dependencies=[Depends(get_current_user)])


class ForwardIn(BaseModel):
    vps_id: int
    mode: str = "host"
    port: int
    protocol: str = "tcp"
    target_ip: str
    target_port: Optional[int] = None
    vmid: Optional[int] = None
    lxc_id: Optional[int] = None
    description: Optional[str] = ""
    enabled: bool = True


def _serialize(r: PortRule) -> dict:
    return {
        "id": r.id, "vps_id": r.vps_id, "lxc_id": r.lxc_id, "vmid": r.vmid,
        "port": r.port, "protocol": r.protocol, "mode": r.mode,
        "target_ip": r.target_ip, "target_port": r.target_port or r.port,
        "description": r.description or "", "enabled": bool(r.enabled), "source": r.source or "panel",
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _overlap(a: str, b: str) -> bool:
    return a == b or "both" in (a, b)


def _validate(data: ForwardIn, db: Session, rule_id: int | None = None) -> dict:
    v = db.get(VPS, data.vps_id)
    if not v:
        raise HTTPException(404, "VPS não encontrada")
    mode = data.mode if data.mode in ("direct", "host") else val.bad("Modo inválido")
    if mode == "host" and not v.gw_ip:
        raise HTTPException(400, f"Configure o gateway (IP do host Proxmox no túnel) da VPS {v.name} antes de usar o modo via host")
    clean = {
        "vps_id": v.id, "mode": mode,
        "port": val.port(data.port, "Porta pública"),
        "protocol": val.protocol(data.protocol),
        "target_ip": val.ipv4(data.target_ip, "IP de destino"),
        "target_port": val.port(data.target_port or data.port, "Porta de destino"),
        "vmid": int(data.vmid) if data.vmid else None,
        "lxc_id": data.lxc_id if data.lxc_id and db.get(LXC, data.lxc_id) else None,
        "description": val.text(data.description),
        "enabled": bool(data.enabled),
    }
    if mode == "host" and clean["target_ip"] == v.gw_ip:
        val.bad("No modo via host o destino deve ser o IP do serviço na LAN, não o IP do túnel")

    for other in db.query(PortRule).filter(PortRule.id != (rule_id or 0)).all():
        if not _overlap(other.protocol, clean["protocol"]):
            continue
        if other.vps_id == v.id and other.port == clean["port"]:
            raise HTTPException(409, f"A porta {clean['port']} já está encaminhada nesta VPS (regra #{other.id})")
        if mode == "host" and other.mode == "host" and other.port == clean["port"] and other.vps \
                and (other.vps.gw_iface or "wg0") == (v.gw_iface or "wg0"):
            raise HTTPException(409, f"A porta {clean['port']} já é usada no host pela regra #{other.id} ({other.vps.name})")
    return clean


async def _apply(vps_ids: set[int], include_host: bool = True) -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, engine.apply, vps_ids, include_host)


@router.get("")
def list_forwards(db: Session = Depends(get_db)):
    return [_serialize(r) for r in db.query(PortRule).order_by(PortRule.vps_id, PortRule.port).all()]


@router.post("")
async def create_forward(data: ForwardIn, db: Session = Depends(get_db)):
    clean = _validate(data, db)
    r = PortRule(**clean, source="panel")
    db.add(r)
    db.commit()
    db.refresh(r)
    await log.emit("info", f"Novo encaminhamento :{r.port}/{r.protocol} → {r.target_ip}:{r.target_port}", "forward")
    result = await _apply({r.vps_id}, r.mode == "host")
    return {"rule": _serialize(r), "apply": result}


@router.put("/{rule_id}")
async def update_forward(rule_id: int, data: ForwardIn, db: Session = Depends(get_db)):
    r = db.get(PortRule, rule_id) or _404()
    old_vps, old_mode = r.vps_id, r.mode
    clean = _validate(data, db, rule_id)
    for k, v in clean.items():
        setattr(r, k, v)
    db.commit()
    await log.emit("info", f"Encaminhamento #{r.id} atualizado", "forward")
    result = await _apply({old_vps, r.vps_id}, "host" in (old_mode, r.mode))
    return {"rule": _serialize(r), "apply": result}


@router.patch("/{rule_id}/toggle")
async def toggle_forward(rule_id: int, db: Session = Depends(get_db)):
    r = db.get(PortRule, rule_id) or _404()
    r.enabled = not r.enabled
    db.commit()
    await log.emit("info", f"Encaminhamento :{r.port} {'ativado' if r.enabled else 'desativado'}", "forward")
    result = await _apply({r.vps_id}, r.mode == "host")
    return {"rule": _serialize(r), "apply": result}


@router.delete("/{rule_id}")
async def delete_forward(rule_id: int, db: Session = Depends(get_db)):
    r = db.get(PortRule, rule_id) or _404()
    vps_id, mode, port = r.vps_id, r.mode, r.port
    db.delete(r)
    db.commit()
    await log.emit("warn", f"Encaminhamento :{port} removido", "forward")
    result = await _apply({vps_id}, mode == "host")
    return {"ok": True, "apply": result}


@router.post("/apply")
async def apply_all(db: Session = Depends(get_db)):
    ids = {v.id for v in db.query(VPS).all() if v.ssh_key_path}
    await log.emit("info", "Sincronizando todas as regras…", "firewall")
    return await _apply(ids, True)


@router.get("/status")
async def status(db: Session = Depends(get_db)):
    """Live comparison between the database and the WGM chains on every VPS and on the host."""
    vpss = [v for v in db.query(VPS).all() if v.ssh_key_path]
    expected = {v.id: engine.expected_vps(db, v) for v in vpss}
    expected_host = engine.expected_host(db)
    conns = [VPSConn(v) for v in vpss]
    rules = db.query(PortRule).all()
    names = {v.id: v.name for v in vpss}

    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=max(2, len(conns) + 1)) as pool:
        vps_futs = [loop.run_in_executor(pool, engine.read_vps_state, c) for c in conns]
        host_fut = loop.run_in_executor(pool, engine.read_host_state)
        vps_states = await asyncio.gather(*vps_futs)
        host_state = await host_fut

    targets, per_rule = {}, {r.id: {} for r in rules}
    for conn, st in zip(conns, vps_states):
        entry = {"name": names[conn.id], "available": st["available"], "error": st.get("error")}
        if st["available"]:
            secs = st["sections"]
            cs = fw.parse_state(secs)
            listening = fw.parse_listening(secs.get("LISTEN", []))
            legacy = fw.parse_legacy_dnat(secs.get("LEGACY_NAT", []))
            entry.update(installed=cs.installed, hooked=cs.hooked,
                         stray=sorted(fw.stray_ids(expected[conn.id], cs)),
                         listening={k: sorted(v) for k, v in listening.items()},
                         legacy_count=len(legacy),
                         ip_forward=(secs.get("FORWARDING") or ["?"])[0])
            for r in rules:
                if r.vps_id == conn.id:
                    per_rule[r.id]["vps"] = fw.rule_status(expected[conn.id], cs, r.id) if r.enabled else "disabled"
        targets[f"vps:{conn.id}"] = entry

    hentry = {"name": "Host Proxmox", "available": host_state["available"], "error": host_state.get("error")}
    if host_state["available"]:
        secs = host_state["sections"]
        cs = fw.parse_state(secs)
        hentry.update(installed=cs.installed, hooked=cs.hooked, stray=sorted(fw.stray_ids(expected_host, cs)),
                      legacy_count=len(fw.parse_legacy_dnat(secs.get("LEGACY_NAT", []))),
                      ip_forward=(secs.get("FORWARDING") or ["?"])[0])
        for r in rules:
            if r.mode == "host":
                per_rule[r.id]["host"] = fw.rule_status(expected_host, cs, r.id) if r.enabled else "disabled"
    targets["host"] = hentry
    return {"targets": targets, "rules": per_rule}


# ── migration from fw-manager ────────────────────────────────────────────────────────────────

def _legacy_view(v: VPS) -> dict:
    conn = VPSConn(v)
    vst = engine.read_vps_state(conn)
    if not vst["available"]:
        raise HTTPException(502, f"Não foi possível ler a VPS: {vst.get('error')}")
    hst = engine.read_host_state()
    vsec = vst["sections"]
    hsec = hst.get("sections", {}) if hst["available"] else {}
    vps_rules = fw.parse_legacy_dnat(vsec.get("LEGACY_NAT", []))
    host_rules = fw.parse_legacy_dnat(hsec.get("LEGACY_NAT", []))
    items = fw.correlate_legacy(vps_rules, host_rules, v.gw_ip, v.gw_iface or "wg0")
    listening = fw.parse_listening(vsec.get("LISTEN", []))
    # Attach the FORWARD ACCEPT lines fw-manager created alongside each DNAT
    for it in items:
        for p in val.protos(it["protocol"]):
            dest_v = v.gw_ip if it["mode"] == "host" else it["target_ip"]
            port_v = it["port"] if it["mode"] == "host" else it["target_port"]
            if it["vps_spec"] and dest_v:
                it["vps_spec"] += fw.legacy_forward_specs(vsec.get("LEGACY_FWD", []), dest_v, port_v, p)
            if it["host_spec"] and it["target_ip"]:
                it["host_spec"] += fw.legacy_forward_specs(hsec.get("LEGACY_FWD", []), it["target_ip"], it["target_port"], p)
        it["vps_spec"] = list(dict.fromkeys(it["vps_spec"]))
        it["host_spec"] = list(dict.fromkeys(it["host_spec"]))
        it["port_in_use"] = any(it["port"] in listening[p] for p in val.protos(it["protocol"]))
    return {"items": items, "host_available": hst["available"], "host_error": hst.get("error"),
            "vps_specs": {s for it in items for s in it["vps_spec"]},
            "host_specs": {s for it in items for s in it["host_spec"]}}


@router.get("/legacy/{vps_id}")
async def legacy(vps_id: int, db: Session = Depends(get_db)):
    v = db.get(VPS, vps_id) or _404("VPS não encontrada")
    view = await asyncio.get_running_loop().run_in_executor(None, _legacy_view, v)
    existing = db.query(PortRule).filter(PortRule.vps_id == vps_id).all()
    for it in view["items"]:
        it["exists"] = any(e.port == it["port"] and _overlap(e.protocol, it["protocol"]) for e in existing)
    return {"items": view["items"], "gw_ip": v.gw_ip, "host_available": view["host_available"],
            "host_error": view["host_error"]}


class ImportItem(BaseModel):
    port: int
    protocol: str
    mode: str
    target_ip: str
    target_port: int
    description: Optional[str] = ""
    enabled: bool = True


@router.post("/legacy/{vps_id}/import")
async def legacy_import(vps_id: int, items: list[ImportItem], db: Session = Depends(get_db)):
    created = []
    for it in items:
        clean = _validate(ForwardIn(vps_id=vps_id, **it.model_dump()), db)
        r = PortRule(**clean, source="imported")
        db.add(r)
        db.flush()
        created.append(r)
    db.commit()
    await log.emit("success", f"{len(created)} regra(s) importada(s) do fw-manager", "forward")
    result = await _apply({vps_id}, any(r.mode == "host" for r in created))
    return {"imported": len(created), "apply": result}


class CleanupIn(BaseModel):
    vps_spec: list[str] = []
    host_spec: list[str] = []


@router.post("/legacy/{vps_id}/cleanup")
async def legacy_cleanup(vps_id: int, data: CleanupIn, db: Session = Depends(get_db)):
    """Delete old fw-manager rules. Only lines that are *currently* reported as legacy are accepted."""
    v = db.get(VPS, vps_id) or _404("VPS não encontrada")
    loop = asyncio.get_running_loop()
    view = await loop.run_in_executor(None, _legacy_view, v)
    vps_specs = [s for s in data.vps_spec if s in view["vps_specs"]]
    host_specs = [s for s in data.host_spec if s in view["host_specs"]]
    out = {"vps": None, "host": None}
    if vps_specs:
        conn = VPSConn(v)

        def run_vps():
            from vps_ssh import open_ssh
            with open_ssh(conn) as ssh:
                return ssh.run(fw.delete_specs_script(vps_specs), sudo=True)[1]
        out["vps"] = await loop.run_in_executor(None, run_vps)
    if host_specs:
        import proxmox_local as host
        out["host"] = (await loop.run_in_executor(None, host.run_script, fw.delete_specs_script(host_specs)))[1]
    await log.emit("warn", f"Limpeza do fw-manager: {len(vps_specs)} linha(s) na VPS, {len(host_specs)} no host", "forward")
    return {"removed_vps": len(vps_specs), "removed_host": len(host_specs), "output": out}


def _404(msg: str = "Encaminhamento não encontrado"):
    raise HTTPException(404, msg)
