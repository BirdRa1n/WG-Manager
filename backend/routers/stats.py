"""Background collector: WireGuard peer traffic on every VPS, sampled every 60 s (1 h of history)."""
import asyncio
import time
from collections import defaultdict, deque
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import wireguard as wg
from auth import get_current_user
from database import LXC, VPS, CloudflareTunnel, PortRule, SessionLocal, get_db
from vps_ssh import VPSConn, open_ssh

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(get_current_user)])

INTERVAL = 60
_series: dict[int, dict[str, deque]] = defaultdict(lambda: defaultdict(lambda: deque(maxlen=60)))
_last_raw: dict[int, dict[str, tuple[int, int]]] = {}
_last_peers: dict[int, list[dict]] = {}
_health: dict[int, dict] = {}
_started = False


async def start_collector():
    global _started
    if _started:
        return
    _started = True
    await asyncio.sleep(3)
    while True:
        try:
            db = SessionLocal()
            try:
                conns = [VPSConn(v) for v in db.query(VPS).filter(VPS.ssh_key_path.isnot(None)).all()]
            finally:
                db.close()
            loop = asyncio.get_running_loop()
            await asyncio.gather(*(loop.run_in_executor(None, _poll, c) for c in conns), return_exceptions=True)
        except Exception:
            pass
        await asyncio.sleep(INTERVAL)


def _poll(conn: VPSConn):
    started = time.time()
    try:
        with open_ssh(conn, timeout=10) as ssh:
            _, out, _ = ssh.run(wg.VPS_PEERS.format(iface=conn.wg_interface), sudo=True, timeout=20)
    except Exception as e:
        _health[conn.id] = {"ok": False, "error": str(e) or e.__class__.__name__, "ts": datetime.utcnow().isoformat() + "Z"}
        return
    latency = int((time.time() - started) * 1000)
    ts = datetime.utcnow().isoformat() + "Z"
    peers = wg.parse_dump(out)
    prev = _last_raw.get(conn.id, {})
    raw = {}
    for p in peers:
        rx, tx = p["rx_bytes"], p["tx_bytes"]
        prx, ptx = prev.get(p["pubkey"], (rx, tx))
        _series[conn.id][p["pubkey"]].append({
            "ts": ts, "rx": rx, "tx": tx,
            # counters reset when the peer reconnects → never report negative deltas
            "rx_delta": rx - prx if rx >= prx else rx, "tx_delta": tx - ptx if tx >= ptx else tx,
        })
        raw[p["pubkey"]] = (rx, tx)
    _last_raw[conn.id] = raw
    _last_peers[conn.id] = peers
    _health[conn.id] = {"ok": True, "latency_ms": latency, "ts": ts, "peers": len(peers)}


def health() -> dict[int, dict]:
    return dict(_health)


def last_peers() -> dict[int, list[dict]]:
    return dict(_last_peers)


@router.get("/wg/{vps_id}")
def wg_stats(vps_id: int, db: Session = Depends(get_db)):
    lxcs = {c.wg_public_key: c for c in db.query(LXC).filter(LXC.wg_public_key.isnot(None)).all()}
    out = []
    for pubkey, series in _series.get(vps_id, {}).items():
        c = lxcs.get(pubkey)
        out.append({"pubkey": pubkey, "lxc_name": c.name if c else None, "lxc_vmid": c.vmid if c else None,
                    "series": list(series)})
    return out


@router.get("/traffic")
def traffic():
    """Aggregated rx/tx rate per minute across every VPS (for the dashboard chart)."""
    buckets: dict[str, list[int]] = {}
    for peers in _series.values():
        for series in peers.values():
            for pt in series:
                key = pt["ts"][:16]
                b = buckets.setdefault(key, [0, 0])
                b[0] += pt["rx_delta"]
                b[1] += pt["tx_delta"]
    return [{"ts": k + ":00Z", "rx": v[0] / INTERVAL, "tx": v[1] / INTERVAL} for k, v in sorted(buckets.items())][-60:]


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    vpss = db.query(VPS).all()
    rules = db.query(PortRule).all()
    tunnels = db.query(CloudflareTunnel).all()
    total_rx = sum(rx for peers in _last_raw.values() for rx, _ in peers.values())
    total_tx = sum(tx for peers in _last_raw.values() for _, tx in peers.values())
    return {
        "vps_total": len(vpss),
        "vps_online": sum(1 for v in vpss if _health.get(v.id, {}).get("ok")),
        "lxc_total": db.query(LXC).count(),
        "lxc_wg_ready": db.query(LXC).filter(LXC.wg_public_key.isnot(None)).count(),
        "ports_total": len(rules),
        "ports_active": sum(1 for r in rules if r.enabled),
        "tunnels_total": len(tunnels),
        "tunnels_running": sum(1 for t in tunnels if t.status in ("running", "healthy")),
        "total_rx_bytes": total_rx,
        "total_tx_bytes": total_tx,
    }
