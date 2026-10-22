import asyncio
import base64
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import cloudflare as cf
import logger as log
import proxmox_local as host
import validators as val
from auth import get_current_user
from database import APICredential, CloudflareRoute, CloudflareTunnel, LXC, SessionLocal, get_db

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"], dependencies=[Depends(get_current_user)])


class TunnelCreate(BaseModel):
    name: str
    lxc_id: Optional[int] = None
    mode: str = "api"                 # api | token
    existing_token: Optional[str] = ""
    cred_id: Optional[int] = None


class RouteCreate(BaseModel):
    public_url: str
    service: str
    description: Optional[str] = None


def _serialize_route(r: CloudflareRoute) -> dict:
    return {"id": r.id, "tunnel_id": r.tunnel_id, "public_url": r.public_url,
            "service": r.service, "description": r.description}


def _serialize(t: CloudflareTunnel) -> dict:
    return {
        "id": t.id, "name": t.name, "lxc_id": t.lxc_id, "tunnel_id": t.tunnel_id,
        "account_id": t.account_id, "status": t.status, "managed": bool(t.api_token and t.account_id),
        "lxc": {"vmid": t.lxc.vmid, "name": t.lxc.name} if t.lxc else None,
        "routes": [_serialize_route(r) for r in t.routes],
        "created_at": t.created_at.isoformat() + "Z" if t.created_at else None,
    }


def _get(tunnel_id: int, db: Session) -> CloudflareTunnel:
    t = db.get(CloudflareTunnel, tunnel_id)
    if not t:
        raise HTTPException(404, "Túnel não encontrado")
    return t


@router.get("")
def list_tunnels(db: Session = Depends(get_db)):
    return [_serialize(t) for t in db.query(CloudflareTunnel).order_by(CloudflareTunnel.id).all()]


@router.post("")
async def create_tunnel(data: TunnelCreate, db: Session = Depends(get_db)):
    name = val.text(data.name, 60) or val.bad("Nome obrigatório")
    lxc = db.get(LXC, data.lxc_id) if data.lxc_id else None
    if data.lxc_id and not lxc:
        raise HTTPException(404, "Container não encontrado")
    account_id = api_token = ""
    cred = None
    if data.mode == "token":
        token = (data.existing_token or "").strip()
        if not token or len(token) > 4096:
            val.bad("Cole o token do túnel (cloudflared service install <TOKEN>)")
        try:
            seg = token.split(".")[1] if "." in token else token
            payload = json.loads(base64.b64decode(seg + "=" * (-len(seg) % 4)))
            tunnel_id = payload.get("t") or payload.get("tunnel_id") or "manual"
        except Exception:
            tunnel_id = "manual"
    else:
        cred = db.get(APICredential, data.cred_id) if data.cred_id else \
            db.query(APICredential).filter(APICredential.provider == "cloudflare").first()
        if not cred or not cred.account_id:
            raise HTTPException(400, "Cadastre uma credencial Cloudflare com Account ID em Credenciais")
        account_id, api_token = cred.account_id, cred.api_token
        await log.emit("info", f"Criando túnel '{name}' via API…", "cf-tunnel")
        try:
            result = await cf.create_tunnel(account_id, api_token, name)
            tunnel_id = result["tunnel_id"]
            token = await cf.get_tunnel_token(account_id, api_token, tunnel_id)
        except Exception as e:
            await log.emit("error", str(e), "cf-tunnel")
            raise HTTPException(502, str(e))
    t = CloudflareTunnel(name=name, lxc_id=lxc.id if lxc else None, tunnel_id=tunnel_id, token=token,
                         account_id=account_id, api_token=api_token, cred_id=cred.id if cred else None, status="created")
    db.add(t)
    db.commit()
    db.refresh(t)
    await log.emit("success", f"Túnel '{name}' salvo ({tunnel_id})", "cf-tunnel")
    if lxc:
        asyncio.get_running_loop().run_in_executor(None, _install_cloudflared, t.id)
    return _serialize(t)


@router.post("/{tunnel_id}/install")
async def install(tunnel_id: int, db: Session = Depends(get_db)):
    t = _get(tunnel_id, db)
    if not t.lxc_id:
        raise HTTPException(400, "Nenhum container associado")
    asyncio.get_running_loop().run_in_executor(None, _install_cloudflared, t.id)
    return {"ok": True}


def _install_cloudflared(tunnel_db_id: int):
    db = SessionLocal()
    try:
        t = db.get(CloudflareTunnel, tunnel_db_id)
        if not t or not t.lxc:
            return
        vmid = t.lxc.vmid
        log.emit_sync("info", f"Instalando cloudflared no CT {vmid}…", "cf-install")
        for line in host.pct_exec_stream(vmid, cf.CLOUDFLARED_INSTALL.format(token=t.token)):
            log.emit_sync("info", line, "cf-install")
        t.status = "running"
        db.commit()
        log.emit_sync("success", f"cloudflared rodando no CT {vmid}", "cf-install")
    except Exception as e:
        log.emit_sync("error", str(e), "cf-install")
    finally:
        db.close()


@router.post("/{tunnel_id}/routes")
async def add_route(tunnel_id: int, data: RouteCreate, db: Session = Depends(get_db)):
    t = _get(tunnel_id, db)
    hostname = val.public_hostname(data.public_url.replace("https://", "").replace("http://", "").rstrip("/"))
    service = val.tunnel_service(data.service)
    if any(r.public_url == hostname for r in t.routes):
        raise HTTPException(409, "Esse hostname já está neste túnel")
    route = CloudflareRoute(tunnel_id=t.id, public_url=hostname, service=service, description=val.text(data.description))
    db.add(route)
    db.commit()
    db.refresh(route)
    try:
        await _push_config(t, db)
    except Exception as e:
        db.delete(route)
        db.commit()
        raise HTTPException(502, f"Falha ao atualizar o túnel: {e}")
    dns = None
    if t.api_token and t.tunnel_id not in ("", "manual"):
        try:
            dns = await cf.create_dns_route(t.account_id, t.api_token, t.tunnel_id, hostname)
        except Exception as e:
            await log.emit("warn", f"DNS não criado: {e}", "cf-route")
    await log.emit("success", f"Rota {hostname} → {service}", "cf-route")
    return {"route": _serialize_route(route), "dns": dns}


@router.delete("/{tunnel_id}/routes/{route_id}")
async def delete_route(tunnel_id: int, route_id: int, db: Session = Depends(get_db)):
    t = _get(tunnel_id, db)
    route = db.query(CloudflareRoute).filter(CloudflareRoute.id == route_id, CloudflareRoute.tunnel_id == tunnel_id).first()
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    hostname = route.public_url
    db.delete(route)
    db.commit()
    db.refresh(t)
    await _push_config(t, db)
    if t.api_token and t.tunnel_id not in ("", "manual"):
        try:
            await cf.delete_dns_route(t.api_token, t.tunnel_id, hostname)
        except Exception as e:
            await log.emit("warn", f"CNAME de {hostname} não removido: {e}", "cf-route")
    return {"ok": True}


@router.delete("/{tunnel_id}")
async def delete_tunnel(tunnel_id: int, db: Session = Depends(get_db)):
    t = _get(tunnel_id, db)
    if t.api_token and t.tunnel_id not in ("", "manual"):
        for r in t.routes:
            try:
                await cf.delete_dns_route(t.api_token, t.tunnel_id, r.public_url)
            except Exception:
                pass
        try:
            await cf.delete_tunnel(t.account_id, t.api_token, t.tunnel_id)
        except Exception as e:
            await log.emit("warn", f"Túnel removido do painel, mas não da Cloudflare: {e}", "cf-tunnel")
    if t.lxc:
        vmid = t.lxc.vmid
        asyncio.get_running_loop().run_in_executor(None, lambda: host.pct_exec(vmid, cf.CLOUDFLARED_UNINSTALL))
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/{tunnel_id}/status")
async def tunnel_status(tunnel_id: int, db: Session = Depends(get_db)):
    t = _get(tunnel_id, db)
    if not t.api_token:
        return {"status": t.status}
    t.status = await cf.get_tunnel_status(t.account_id, t.api_token, t.tunnel_id)
    db.commit()
    return {"status": t.status}


async def _push_config(t: CloudflareTunnel, db: Session):
    routes = [{"public_url": r.public_url, "service": r.service} for r in t.routes]
    if t.api_token and t.account_id:
        await cf.update_tunnel_config(t.account_id, t.api_token, t.tunnel_id, routes)
        await log.emit("success", f"Ingress atualizado via API ({len(routes)} rota(s))", "cf-route")
    elif t.lxc:
        vmid, tid = t.lxc.vmid, t.tunnel_id
        ingress = "\n".join(f"  - hostname: {r['public_url']}\n    service: {r['service']}" for r in routes)
        script = f"""mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<'CFEOF'
tunnel: {tid}
ingress:
{ingress}
  - service: http_status:404
CFEOF
systemctl restart cloudflared && echo CONFIG_APPLIED
"""
        _, out = await asyncio.get_running_loop().run_in_executor(None, host.pct_exec, vmid, script)
        if "CONFIG_APPLIED" not in out:
            raise Exception(out.strip()[-200:] or "cloudflared não reiniciou")
    else:
        await log.emit("warn", "Túnel sem API e sem container — configure as rotas no painel da Cloudflare", "cf-route")
