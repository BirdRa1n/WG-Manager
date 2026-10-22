"""Sites: many HTTP(S) services behind one public 80/443, routed by hostname through Caddy."""
import asyncio
import socket
import threading
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import caddy
import forward_engine as engine
import logger as log
import proxmox_local as host
import validators as val
from auth import get_current_user
from database import LXC, PortRule, ReverseProxy, SessionLocal, Site, VPS, get_db

router = APIRouter(prefix="/api/sites", tags=["sites"], dependencies=[Depends(get_current_user)])

PROXY_PORTS = (80, 443)
_apply_lock = threading.Lock()


async def _in_thread(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


def _proxy(db: Session) -> ReverseProxy | None:
    return db.query(ReverseProxy).first()


def _serialize_site(s: Site) -> dict:
    return {
        "id": s.id, "hostname": s.hostname, "upstream_scheme": s.upstream_scheme, "upstream_ip": s.upstream_ip,
        "upstream_port": s.upstream_port, "vmid": s.vmid, "tls": bool(s.tls), "enabled": bool(s.enabled),
        "description": s.description or "",
        "created_at": s.created_at.isoformat() + "Z" if s.created_at else None,
    }


def _serialize_proxy(p: ReverseProxy, db: Session) -> dict:
    rules = db.query(PortRule).filter(PortRule.vps_id == p.vps_id, PortRule.port.in_(PROXY_PORTS)).all()
    return {
        "id": p.id, "vps_id": p.vps_id, "vps_name": p.vps.name if p.vps else None, "vps_host": p.vps.host if p.vps else None,
        "lxc_id": p.lxc_id, "vmid": p.lxc.vmid if p.lxc else None, "lxc_name": p.lxc.name if p.lxc else None,
        "proxy_ip": p.proxy_ip, "acme_email": p.acme_email, "status": p.status,
        "forwards": [{"id": r.id, "port": r.port, "enabled": bool(r.enabled), "target_ip": r.target_ip} for r in rules],
    }


# ── Caddy apply ──────────────────────────────────────────────────────────────────────────────

def apply_config() -> dict:
    """Render every site into a Caddyfile and push it to the proxy container (validated first)."""
    db = SessionLocal()
    try:
        p = _proxy(db)
        if not p or not p.lxc:
            return {"ok": False, "message": "Proxy não configurado"}
        specs = [caddy.SiteSpec(s.hostname, s.upstream_scheme, s.upstream_ip, s.upstream_port, bool(s.tls), bool(s.enabled))
                 for s in db.query(Site).all()]
        cfg = caddy.caddyfile(specs, p.acme_email)
        vmid = p.lxc.vmid
    finally:
        db.close()
    with _apply_lock:
        try:
            _, out = host.pct_exec(vmid, caddy.APPLY.format(config=cfg), timeout=60)
        except Exception as e:
            log.emit_sync("error", f"Proxy: {e}", "sites")
            return {"ok": False, "message": str(e)}
    if "CADDY_APPLIED" in out:
        n = sum(1 for s in specs if s.enabled)
        log.emit_sync("success", f"Proxy: {n} site(s) ativo(s), Caddy recarregado", "sites")
        return {"ok": True, "message": f"{n} site(s)"}
    detail = out.strip().splitlines()[-3:] if out.strip() else ["falha desconhecida"]
    msg = "Configuração rejeitada pelo Caddy: " + " ".join(detail) if "CADDY_INVALID" in out else " ".join(detail)
    log.emit_sync("error", f"Proxy: {msg}", "sites")
    return {"ok": False, "message": msg}


# ── Proxy setup ──────────────────────────────────────────────────────────────────────────────

class ProxyIn(BaseModel):
    vps_id: int
    vmid: int
    acme_email: Optional[str] = ""


@router.get("/proxy")
async def get_proxy(db: Session = Depends(get_db)):
    p = _proxy(db)
    if not p:
        return None
    data = _serialize_proxy(p, db)
    try:
        _, out = await _in_thread(host.pct_exec, p.lxc.vmid, caddy.STATUS, 20)
        kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        data["caddy"] = {"installed": kv.get("INSTALLED") == "1", "active": kv.get("ACTIVE") == "1", "version": kv.get("VERSION", "")}
    except Exception as e:
        data["caddy"] = {"installed": False, "active": False, "error": str(e)}
    return data


@router.post("/proxy")
async def setup_proxy(data: ProxyIn, db: Session = Depends(get_db)):
    v = db.get(VPS, data.vps_id) or _404("VPS não encontrada")
    if not v.gw_ip:
        raise HTTPException(400, f"{v.name} não tem gateway. Use Conectar ao host em Servidores primeiro.")
    email = (data.acme_email or "").strip()
    if email and ("@" not in email or len(email) > 120 or any(c in email for c in " \t\n{}")):
        val.bad("E-mail inválido")
    try:
        guests = await _in_thread(host.list_guests, True)
    except host.HostError as e:
        raise HTTPException(503, str(e))
    g = next((x for x in guests if x["vmid"] == data.vmid), None)
    if not g or g["type"] != "lxc":
        raise HTTPException(404, "Container LXC não encontrado")
    if g["status"] != "running":
        raise HTTPException(400, f"O CT {g['vmid']} está parado")
    lan = [i["ip"] for i in g["ips"] if not (i["iface"] or "").startswith(("wg", "tailscale", "docker", "br-")) and not i["ip"].startswith("100.")]
    if not lan:
        raise HTTPException(400, f"Não encontrei o IP da LAN do CT {g['vmid']}")
    proxy_ip = val.ipv4(lan[0])

    # 80/443 on this VPS must be free (or already pointing at this container)
    for r in db.query(PortRule).filter(PortRule.vps_id == v.id, PortRule.port.in_(PROXY_PORTS)).all():
        if r.protocol in ("tcp", "both") and not (r.mode == "host" and r.target_ip == proxy_ip):
            raise HTTPException(409, f"A porta {r.port} de {v.name} já é usada pelo encaminhamento #{r.id} → {r.target_ip}")

    lxc = db.query(LXC).filter(LXC.vmid == g["vmid"]).first()
    if not lxc:
        lxc = LXC(vmid=g["vmid"], name=g["name"], proxmox_node=g["node"], status="imported")
        db.add(lxc)
        db.flush()
    p = _proxy(db) or ReverseProxy()
    p.lxc_id, p.vps_id, p.proxy_ip, p.acme_email, p.status = lxc.id, v.id, proxy_ip, email or None, "installing"
    db.add(p)
    # (re)point the public 80/443 at the proxy container
    for port in PROXY_PORTS:
        rule = db.query(PortRule).filter(PortRule.vps_id == v.id, PortRule.port == port).first()
        if not rule:
            rule = PortRule(vps_id=v.id, port=port, protocol="tcp", source="panel")
            db.add(rule)
        rule.mode, rule.target_ip, rule.target_port, rule.vmid = "host", proxy_ip, port, g["vmid"]
        rule.lxc_id, rule.enabled = lxc.id, True
        rule.description = f"Proxy reverso — Sites ({'HTTP' if port == 80 else 'HTTPS'})"
    # a proxy that moved to another VPS leaves its old forwards behind: remove them
    old = db.query(PortRule).filter(PortRule.vps_id != v.id, PortRule.port.in_(PROXY_PORTS),
                                    PortRule.description.like("Proxy reverso — Sites%")).all()
    old_vps = {r.vps_id for r in old}
    for r in old:
        db.delete(r)
    db.commit()
    await log.emit("info", f"Proxy reverso: CT {g['vmid']} ({proxy_ip}) atrás de {v.name}:80/443", "sites")

    proxy_id, vmid, vps_id = p.id, g["vmid"], v.id

    def run():
        db2 = SessionLocal()
        try:
            engine.apply({vps_id, *old_vps}, True)
            for line in host.pct_exec_stream(vmid, caddy.INSTALL):
                log.emit_sync("info", line, "sites")
            res = apply_config()
            row = db2.get(ReverseProxy, proxy_id)
            row.status = "ready" if res["ok"] else "error"
            db2.commit()
        except Exception as e:
            log.emit_sync("error", f"Instalação do Caddy falhou: {e}", "sites")
            row = db2.get(ReverseProxy, proxy_id)
            if row:
                row.status = "error"
                db2.commit()
        finally:
            db2.close()

    asyncio.get_running_loop().run_in_executor(None, run)
    return _serialize_proxy(p, db)


@router.post("/proxy/reinstall")
async def reinstall(db: Session = Depends(get_db)):
    p = _proxy(db) or _404("Proxy não configurado")
    vmid, pid = p.lxc.vmid, p.id

    def run():
        try:
            for line in host.pct_exec_stream(vmid, caddy.INSTALL):
                log.emit_sync("info", line, "sites")
            res = apply_config()
        except Exception as e:
            log.emit_sync("error", str(e), "sites")
            res = {"ok": False}
        db2 = SessionLocal()
        try:
            db2.get(ReverseProxy, pid).status = "ready" if res["ok"] else "error"
            db2.commit()
        finally:
            db2.close()
    asyncio.get_running_loop().run_in_executor(None, run)
    return {"ok": True}


@router.get("/proxy/logs")
async def proxy_logs(lines: int = 80, db: Session = Depends(get_db)):
    p = _proxy(db) or _404("Proxy não configurado")
    _, out = await _in_thread(host.pct_exec, p.lxc.vmid, caddy.LOGS.format(lines=max(10, min(int(lines), 400))), 20)
    return {"logs": out}


@router.post("/apply")
async def apply(db: Session = Depends(get_db)):
    _proxy(db) or _404("Proxy não configurado")
    return await _in_thread(apply_config)


# ── Sites ────────────────────────────────────────────────────────────────────────────────────

class SiteIn(BaseModel):
    hostname: str
    upstream_ip: str
    upstream_port: int
    upstream_scheme: str = "http"
    tls: bool = True
    enabled: bool = True
    vmid: Optional[int] = None
    description: Optional[str] = ""


def _clean(data: SiteIn, db: Session, site_id: int | None = None) -> dict:
    hostname = val.public_hostname(data.hostname.replace("https://", "").replace("http://", "").rstrip("/"))
    if hostname.startswith("*."):
        val.bad("Curingas (*.dominio) exigem desafio DNS e não são suportados")
    if data.upstream_scheme not in ("http", "https"):
        val.bad("Protocolo do destino inválido")
    dup = db.query(Site).filter(Site.hostname == hostname, Site.id != (site_id or 0)).first()
    if dup:
        raise HTTPException(409, f"{hostname} já está cadastrado")
    return {"hostname": hostname, "upstream_ip": val.ipv4(data.upstream_ip, "IP de destino"),
            "upstream_port": val.port(data.upstream_port, "Porta de destino"), "upstream_scheme": data.upstream_scheme,
            "tls": bool(data.tls), "enabled": bool(data.enabled), "vmid": int(data.vmid) if data.vmid else None,
            "description": val.text(data.description)}


def _resolve(hostname: str) -> list[str]:
    try:
        return sorted({a[4][0] for a in socket.getaddrinfo(hostname, None, socket.AF_INET)})
    except Exception:
        return []


@router.get("")
async def list_sites(db: Session = Depends(get_db)):
    sites = db.query(Site).order_by(Site.hostname).all()
    p = _proxy(db)
    public_ip = p.vps.host if p and p.vps else None
    pool = ThreadPoolExecutor(max_workers=8)
    futs = {s.id: pool.submit(_resolve, s.hostname) for s in sites}
    await _in_thread(wait, list(futs.values()), 4)
    pool.shutdown(wait=False, cancel_futures=True)
    out = []
    for s in sites:
        f = futs[s.id]
        ips = f.result() if f.done() else []
        if not ips:
            dns = "missing"
        elif public_ip in ips:
            dns = "ok"
        else:
            dns = "other"      # wrong IP or proxied through Cloudflare
        out.append({**_serialize_site(s), "dns": dns, "dns_ips": ips})
    return out


@router.post("")
async def create_site(data: SiteIn, db: Session = Depends(get_db)):
    if not _proxy(db):
        raise HTTPException(400, "Configure o proxy primeiro")
    s = Site(**_clean(data, db))
    db.add(s)
    db.commit()
    db.refresh(s)
    await log.emit("info", f"Site {s.hostname} → {s.upstream_ip}:{s.upstream_port}", "sites")
    return {"site": _serialize_site(s), "apply": await _in_thread(apply_config)}


@router.put("/{site_id}")
async def update_site(site_id: int, data: SiteIn, db: Session = Depends(get_db)):
    s = db.get(Site, site_id) or _404()
    for k, v in _clean(data, db, site_id).items():
        setattr(s, k, v)
    db.commit()
    return {"site": _serialize_site(s), "apply": await _in_thread(apply_config)}


@router.patch("/{site_id}/toggle")
async def toggle_site(site_id: int, db: Session = Depends(get_db)):
    s = db.get(Site, site_id) or _404()
    s.enabled = not s.enabled
    db.commit()
    return {"site": _serialize_site(s), "apply": await _in_thread(apply_config)}


@router.delete("/{site_id}")
async def delete_site(site_id: int, db: Session = Depends(get_db)):
    s = db.get(Site, site_id) or _404()
    name = s.hostname
    db.delete(s)
    db.commit()
    await log.emit("warn", f"Site {name} removido", "sites")
    return {"ok": True, "apply": await _in_thread(apply_config)}


def _404(msg: str = "Site não encontrado"):
    raise HTTPException(404, msg)
