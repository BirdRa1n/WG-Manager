"""
Live stats collector — polls WireGuard peer traffic every 60 s.
Stores up to 60 data-points per peer (1 hour of history).
"""
import asyncio
import re
from collections import defaultdict, deque
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db, VPS, LXC, PortRule, CloudflareTunnel
from auth import get_current_user
from ssh_manager import SSHClient

router = APIRouter(prefix="/api/stats", tags=["stats"])

# In-memory store: { vps_id: { peer_pubkey: deque([{ts, rx, tx, rx_delta, tx_delta}]) } }
_peer_series: dict[int, dict[str, deque]] = defaultdict(lambda: defaultdict(lambda: deque(maxlen=60)))
_last_raw: dict[int, dict[str, tuple]] = {}   # vps_id → { pubkey: (rx_bytes, tx_bytes) }
_collecting = False


async def start_collector(vps_list_fn):
    """Background loop — runs forever, polling every 60 s."""
    global _collecting
    if _collecting:
        return
    _collecting = True
    while True:
        try:
            await _poll_all(vps_list_fn)
        except Exception:
            pass
        await asyncio.sleep(60)


async def _poll_all(vps_list_fn):
    from database import SessionLocal
    db = SessionLocal()
    try:
        vpss = db.query(VPS).filter(VPS.wg_public_key.isnot(None)).all()
        for v in vpss:
            try:
                await asyncio.get_event_loop().run_in_executor(None, lambda v=v: _poll_vps(v))
            except Exception:
                pass
    finally:
        db.close()


def _poll_vps(v: VPS):
    try:
        with SSHClient(v.host, v.ssh_port, v.ssh_user, v.ssh_key_path) as ssh:
            _, out, _ = ssh.run(
                f"sudo wg show {v.wg_interface or 'wg0'} dump 2>/dev/null || "
                f"wg show {v.wg_interface or 'wg0'} dump 2>/dev/null"
            )
    except Exception:
        return

    ts = datetime.utcnow().isoformat()
    prev = _last_raw.get(v.id, {})
    new_raw = {}

    for line in out.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        pubkey = parts[0]
        try:
            rx = int(parts[5])
            tx = int(parts[6])
        except (ValueError, IndexError):
            continue

        prev_rx, prev_tx = prev.get(pubkey, (rx, tx))
        rx_delta = max(0, rx - prev_rx)
        tx_delta = max(0, tx - prev_tx)

        _peer_series[v.id][pubkey].append({
            "ts": ts,
            "rx": rx,
            "tx": tx,
            "rx_delta": rx_delta,
            "tx_delta": tx_delta,
        })
        new_raw[pubkey] = (rx, tx)

    _last_raw[v.id] = new_raw


@router.get("/wg/{vps_id}")
def wg_stats(vps_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return time-series traffic per WG peer for the given VPS."""
    from database import LXC as LXCModel
    lxcs = {c.wg_public_key: c for c in db.query(LXCModel).filter(LXCModel.wg_public_key.isnot(None)).all()}
    result = []
    for pubkey, series in _peer_series.get(vps_id, {}).items():
        lxc = lxcs.get(pubkey)
        result.append({
            "pubkey": pubkey,
            "lxc_name": lxc.name if lxc else None,
            "lxc_vmid": lxc.vmid if lxc else None,
            "series": list(series),
        })
    return result


@router.get("/summary")
def summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return counts and status summary for the dashboard."""
    vpss = db.query(VPS).all()
    lxcs = db.query(LXC).all()
    ports = db.query(PortRule).all()
    tunnels = db.query(CloudflareTunnel).all()

    wg_ready_vps = sum(1 for v in vpss if v.status == "wg_ready")
    wg_ready_lxc = sum(1 for c in lxcs if c.status == "wg_ready")
    active_ports = sum(1 for p in ports if p.enabled)
    running_tunnels = sum(1 for t in tunnels if t.status == "running")

    # Total traffic from last known values
    total_rx = sum(v for vps_id, peers in _last_raw.items() for _, (rx, tx) in peers.items())
    total_tx = sum(tx for vps_id, peers in _last_raw.items() for _, (rx, tx) in peers.items())

    # Ports grouped by target IP
    ip_counts: dict[str, int] = {}
    for p in ports:
        if p.target_ip:
            ip_counts[p.target_ip] = ip_counts.get(p.target_ip, 0) + 1

    return {
        "vps_total": len(vpss),
        "vps_wg_ready": wg_ready_vps,
        "lxc_total": len(lxcs),
        "lxc_wg_ready": wg_ready_lxc,
        "ports_total": len(ports),
        "ports_active": active_ports,
        "tunnels_total": len(tunnels),
        "tunnels_running": running_tunnels,
        "total_rx_bytes": total_rx,
        "total_tx_bytes": total_tx,
        "ports_by_ip": ip_counts,
    }
