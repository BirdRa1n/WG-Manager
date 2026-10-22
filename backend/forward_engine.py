"""Builds the expected firewall state from the database and pushes it to the VPSs and the host."""
import os
import shutil
import threading

import firewall as fw
import logger as log
import proxmox_local as host
from database import PortRule, SessionLocal, VPS
from vps_ssh import VPSConn, open_ssh

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def to_rule(r: PortRule) -> fw.Rule:
    return fw.Rule(id=r.id, port=r.port, protocol=r.protocol, mode=r.mode,
                   target_ip=r.target_ip or "", target_port=r.target_port or r.port, enabled=bool(r.enabled))


def expected_vps(db, v: VPS) -> dict[str, list[str]]:
    rules = [to_rule(r) for r in db.query(PortRule).filter(PortRule.vps_id == v.id).order_by(PortRule.port).all()]
    net = fw.VPSNet(pub_iface=v.pub_interface or "ens3", wg_iface=v.wg_interface or "wg0", gw_ip=v.gw_ip)
    return fw.vps_lines(rules, net)


def expected_host(db) -> dict[str, list[str]]:
    pairs = []
    for r in db.query(PortRule).filter(PortRule.mode == "host").order_by(PortRule.port).all():
        v = r.vps
        if not v or not v.gw_ip:
            continue
        pairs.append((to_rule(r), fw.HostNet(gw_iface=v.gw_iface or "wg0", lan_iface=v.lan_iface or "vmbr0")))
    return fw.host_lines(pairs)


def host_supported() -> tuple[bool, str]:
    if not shutil.which("iptables-restore"):
        return False, "iptables não disponível neste host"
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        return False, "o painel não está rodando como root"
    return True, ""


def apply_vps(vps_id: int) -> dict:
    db = SessionLocal()
    try:
        v = db.get(VPS, vps_id)
        if not v:
            return {"ok": False, "message": "VPS não encontrada"}
        lines = expected_vps(db, v)
        conn = VPSConn(v)
    finally:
        db.close()
    n = len(lines["nat_pre"])
    with _lock(f"vps:{vps_id}"):
        try:
            with open_ssh(conn) as ssh:
                code, out, err = ssh.run(fw.apply_script(lines), sudo=True, timeout=60)
        except Exception as e:
            log.emit_sync("error", f"{conn.name}: {e}", "firewall")
            return {"ok": False, "message": str(e)}
    if code != 0 or "WGM_APPLIED" not in out:
        msg = (err or out).strip().splitlines()[-1:] or ["falha desconhecida"]
        log.emit_sync("error", f"{conn.name}: falha ao aplicar regras — {msg[0]}", "firewall")
        return {"ok": False, "message": msg[0]}
    persisted = "PERSISTED" in out.replace("NOT_PERSISTED", "")
    log.emit_sync("success", f"{conn.name}: {n} regra(s) DNAT aplicada(s)" + ("" if persisted else " (sem /etc/iptables — não persistido)"), "firewall")
    return {"ok": True, "message": f"{n} regra(s)", "persisted": persisted}


def apply_host() -> dict:
    ok, why = host_supported()
    db = SessionLocal()
    try:
        lines = expected_host(db)
    finally:
        db.close()
    n = len(lines["nat_pre"])
    if not ok:
        if n:
            log.emit_sync("warn", f"Host Proxmox: {why}", "firewall")
        return {"ok": n == 0, "message": why, "skipped": True}
    with _lock("host"):
        try:
            code, out = host.run_script(fw.apply_script(lines), timeout=60)
        except host.HostError as e:
            log.emit_sync("error", f"Host Proxmox: {e}", "firewall")
            return {"ok": False, "message": str(e)}
    if code != 0 or "WGM_APPLIED" not in out:
        tail = out.strip().splitlines()[-1:] or ["falha desconhecida"]
        log.emit_sync("error", f"Host Proxmox: falha ao aplicar — {tail[0]}", "firewall")
        return {"ok": False, "message": tail[0]}
    log.emit_sync("success", f"Host Proxmox: {n} regra(s) DNAT aplicada(s)", "firewall")
    return {"ok": True, "message": f"{n} regra(s)"}


def apply(vps_ids: set[int], include_host: bool = True) -> dict:
    results = {}
    for vid in sorted(i for i in vps_ids if i):
        results[f"vps:{vid}"] = apply_vps(vid)
    if include_host:
        results["host"] = apply_host()
    results["ok"] = all(r["ok"] for k, r in results.items() if isinstance(r, dict))
    return results


def read_host_state() -> dict:
    ok, why = host_supported()
    if not ok:
        return {"available": False, "error": why}
    try:
        _, out = host.run_script(fw.READ_SCRIPT, timeout=20)
    except host.HostError as e:
        return {"available": False, "error": str(e)}
    return {"available": True, "sections": fw.split_sections(out)}


def read_vps_state(conn: VPSConn) -> dict:
    try:
        with open_ssh(conn, timeout=10) as ssh:
            _, out, _ = ssh.run(fw.READ_SCRIPT, sudo=True, timeout=30)
    except Exception as e:
        return {"available": False, "error": str(e) or e.__class__.__name__}
    return {"available": True, "sections": fw.split_sections(out)}
