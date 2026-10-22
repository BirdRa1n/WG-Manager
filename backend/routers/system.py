"""Dashboard overview: topology and actionable alerts, computed from cached data (no SSH here)."""
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import config
import proxmox_local as host
from auth import get_current_user
from database import LXC, VPS, PortRule, get_db
from routers import stats

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(get_current_user)])


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    now = time.time()
    health = stats.health()
    peers_by_vps = stats.last_peers()
    local_wg = host.local_wg_interfaces()
    local_keys = {i["public_key"]: i for i in local_wg}
    alerts = []

    vps_nodes = []
    for v in db.query(VPS).order_by(VPS.id).all():
        h = health.get(v.id, {})
        peers = peers_by_vps.get(v.id, [])
        gw_peer = next((p for p in peers if p["pubkey"] in local_keys), None)
        handshake_age = now - gw_peer["last_handshake"] if gw_peer and gw_peer["last_handshake"] else None
        rules = [r for r in v.port_rules]
        vps_nodes.append({
            "id": v.id, "name": v.name, "host": v.host, "wg_address": v.wg_address,
            "online": h.get("ok"), "latency_ms": h.get("latency_ms"), "error": h.get("error") or v.last_error,
            "peers": len(peers), "gw_ip": v.gw_ip, "gw_iface": v.gw_iface,
            "gw_handshake_age": handshake_age,
            "rules_host": sum(1 for r in rules if r.mode == "host" and r.enabled),
            "rules_direct": sum(1 for r in rules if r.mode == "direct" and r.enabled),
        })
        if h and not h.get("ok"):
            alerts.append({"level": "error", "title": f"{v.name} inacessível", "detail": h.get("error"), "link": "/servers"})
        if v.wg_public_key and not v.gw_ip:
            alerts.append({"level": "warn", "title": f"{v.name} sem gateway configurado",
                           "detail": "Abra a VPS em Servidores e use Conectar ao host para criar o túnel.", "link": "/servers"})
        if handshake_age and handshake_age > 180:
            alerts.append({"level": "error", "title": f"Túnel {v.name} ⇄ host parado",
                           "detail": f"Último handshake há {int(handshake_age // 60)} min.", "link": "/servers"})
        orphans = [p for p in peers if not p["allowed_ips"]]
        if orphans:
            alerts.append({"level": "warn", "title": f"{len(orphans)} peer(s) sem IP em {v.name}",
                           "detail": "Peers sem AllowedIPs não recebem tráfego — geralmente sobras de IP duplicado.", "link": "/servers"})

    # Panel-managed containers whose WG address collides with the host's own tunnel address
    host_addrs = {(i.get("address") or "").split("/")[0] for i in local_wg}
    for c in db.query(LXC).filter(LXC.wg_address.isnot(None)).all():
        if c.wg_address.split("/")[0] in host_addrs:
            alerts.append({"level": "error", "title": f"CT {c.vmid} usa o IP do host ({c.wg_address})",
                           "detail": "Conflito de endereço WireGuard com o host Proxmox. Remova o WireGuard do container.", "link": "/guests"})

    if config.DEV_AUTH:
        alerts.insert(0, {"level": "error", "title": "Modo de desenvolvimento ativo",
                          "detail": "WGM_DEV_AUTH=1 permite login sem senha.", "link": None})

    return {
        "host": {"name": "Proxmox", "wg": [{"name": i["name"], "address": i["address"], "peers": len(i["peers"])} for i in local_wg],
                 "on_proxmox": host.available()},
        "vps": vps_nodes,
        "alerts": alerts,
        "counts": {
            "forwards": db.query(PortRule).filter(PortRule.enabled.is_(True)).count(),
            "containers_wg": db.query(LXC).filter(LXC.wg_public_key.isnot(None)).count(),
        },
    }
