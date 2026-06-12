import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db, CloudflareTunnel, CloudflareRoute, LXC
from auth import get_current_user
import cloudflare as cf
import proxmox_client as px
import logger as log

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"])


class TunnelCreate(BaseModel):
    name: str
    account_id: Optional[str] = ""
    api_token: Optional[str] = ""
    lxc_id: Optional[int] = None
    mode: Optional[str] = "api"          # "api" | "token"
    existing_token: Optional[str] = ""   # token from CF dashboard


class RouteCreate(BaseModel):
    public_url: str
    service: str
    description: Optional[str] = None


@router.get("")
def list_tunnels(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_serialize_tunnel(t) for t in db.query(CloudflareTunnel).all()]


@router.post("")
async def create_tunnel(data: TunnelCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    token = ""
    tunnel_id_str = ""

    if data.mode == "token":
        # User pasted token from CF dashboard — save directly, no API call needed
        if not data.existing_token:
            raise HTTPException(400, "Token é obrigatório no modo 'colar token'")
        token = data.existing_token.strip()
        # Extract tunnel ID from JWT payload (second segment, base64)
        try:
            import base64, json as _json
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            payload = _json.loads(base64.b64decode(payload_b64))
            tunnel_id_str = payload.get("t", "") or payload.get("tunnel_id", "") or "manual"
        except Exception:
            tunnel_id_str = "manual"
        await log.emit("success", f"Tunnel '{data.name}' salvo com token existente", "cf-tunnel")
    else:
        # Create via CF API
        await log.emit("info", f"Creating Cloudflare tunnel '{data.name}'...", "cf-tunnel")
        try:
            result = await cf.create_tunnel(data.account_id, data.api_token, data.name)
            token = await cf.get_tunnel_token(data.account_id, data.api_token, result["tunnel_id"])
            tunnel_id_str = result["tunnel_id"]
        except Exception as e:
            await log.emit("error", str(e), "cf-tunnel")
            raise HTTPException(500, str(e))
        await log.emit("success", f"Tunnel '{data.name}' created (ID: {tunnel_id_str})", "cf-tunnel")

    tunnel = CloudflareTunnel(
        name=data.name, lxc_id=data.lxc_id,
        tunnel_id=tunnel_id_str, token=token,
        account_id=data.account_id or "", api_token=data.api_token or "",
        status="created",
    )
    db.add(tunnel)
    db.commit()
    db.refresh(tunnel)

    if data.lxc_id:
        tid = tunnel.id
        asyncio.get_event_loop().run_in_executor(None, lambda: _install_cloudflared(tid, data.lxc_id, token, db))

    return _serialize_tunnel(tunnel)


@router.post("/{tunnel_id}/install")
async def install_cloudflared(tunnel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    tunnel = _get_tunnel_or_404(tunnel_id, db)
    if not tunnel.lxc_id:
        raise HTTPException(400, "No LXC associated")
    await log.emit("info", f"Installing cloudflared on CT...", "cf-install")
    asyncio.get_event_loop().run_in_executor(None, lambda: _install_cloudflared(tunnel_id, tunnel.lxc_id, tunnel.token, db))
    return {"ok": True}


def _install_cloudflared(tunnel_db_id: int, lxc_id: int, token: str, db: Session):
    db2 = next(get_db())
    try:
        c = db2.query(LXC).filter(LXC.id == lxc_id).first()
        if not c:
            log.emit_sync("error", "LXC not found", "cf-install")
            return
        script = cf.CLOUDFLARED_INSTALL.format(token=token)
        for line in px.pct_exec_stream(c.vmid, script):
            log.emit_sync("info", line, "cf-install")

        t = db2.query(CloudflareTunnel).filter(CloudflareTunnel.id == tunnel_db_id).first()
        if t:
            t.status = "running"
            db2.commit()
        log.emit_sync("success", "cloudflared installed and running!", "cf-install")
    except Exception as e:
        log.emit_sync("error", str(e), "cf-install")
    finally:
        db2.close()


@router.post("/{tunnel_id}/routes")
async def add_route(tunnel_id: int, data: RouteCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    tunnel = _get_tunnel_or_404(tunnel_id, db)
    route = CloudflareRoute(tunnel_id=tunnel_id, public_url=data.public_url, service=data.service, description=data.description)
    db.add(route)
    db.commit()
    db.refresh(route)

    await log.emit("info", f"Configurando rota {data.public_url} → {data.service}...", "cf-route")
    await _push_config(tunnel, db)

    # Create DNS CNAME record if API credentials available
    if tunnel.api_token and tunnel.account_id and tunnel.tunnel_id and tunnel.tunnel_id != "manual":
        try:
            ok = await cf.create_dns_route(tunnel.account_id, tunnel.api_token, tunnel.tunnel_id, data.public_url)
            if ok:
                await log.emit("success", f"DNS CNAME criado: {data.public_url} → {tunnel.tunnel_id}.cfargotunnel.com", "cf-route")
            else:
                await log.emit("warn", f"Rota configurada mas DNS pode precisar de ajuste manual no CF", "cf-route")
        except Exception as e:
            await log.emit("warn", f"Rota configurada localmente. DNS manual necessário: {e}", "cf-route")
    else:
        await log.emit("warn", f"Sem API token — adicione o CNAME manualmente no CF: {data.public_url} → <tunnel-id>.cfargotunnel.com (proxied)", "cf-route")

    await log.emit("success", f"Rota {data.public_url} → {data.service} adicionada", "cf-route")
    return _serialize_route(route)


@router.delete("/{tunnel_id}/routes/{route_id}")
async def delete_route(tunnel_id: int, route_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    route = db.query(CloudflareRoute).filter(CloudflareRoute.id == route_id, CloudflareRoute.tunnel_id == tunnel_id).first()
    if not route:
        raise HTTPException(404, "Route not found")
    db.delete(route)
    db.commit()
    tunnel = _get_tunnel_or_404(tunnel_id, db)
    await _push_config(tunnel, db)
    return {"ok": True}


@router.delete("/{tunnel_id}")
async def delete_tunnel(tunnel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    tunnel = _get_tunnel_or_404(tunnel_id, db)
    try:
        await cf.delete_tunnel(tunnel.account_id, tunnel.api_token, tunnel.tunnel_id)
    except Exception:
        pass
    db.delete(tunnel)
    db.commit()
    return {"ok": True}


@router.get("/{tunnel_id}/status")
async def tunnel_status(tunnel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    tunnel = _get_tunnel_or_404(tunnel_id, db)
    status = await cf.get_tunnel_status(tunnel.account_id, tunnel.api_token, tunnel.tunnel_id)
    tunnel.status = status
    db.commit()
    return {"status": status}


async def _push_config(tunnel: CloudflareTunnel, db: Session):
    routes = db.query(CloudflareRoute).filter(CloudflareRoute.tunnel_id == tunnel.id).all()
    route_list = [{"public_url": r.public_url, "service": r.service} for r in routes]

    if tunnel.api_token and tunnel.account_id:
        # Managed via CF API
        await cf.update_tunnel_config(tunnel.account_id, tunnel.api_token, tunnel.tunnel_id, route_list)
        await log.emit("success", f"Rotas atualizadas via CF API ({len(route_list)} rota(s))", "cf-route")
    elif tunnel.lxc_id:
        # No API token — write local config.yml to LXC and restart cloudflared
        asyncio.get_event_loop().run_in_executor(
            None, lambda: _push_local_config(tunnel.lxc_id, tunnel.tunnel_id, route_list)
        )
    else:
        await log.emit("warn", "Sem API token e sem LXC — configure as rotas manualmente no dashboard CF", "cf-route")


def _push_local_config(lxc_id: int, tunnel_id: str, routes: list):
    """Write config.yml to LXC and restart cloudflared (used when no CF API token)."""
    from database import SessionLocal
    db2 = SessionLocal()
    try:
        c = db2.query(LXC).filter(LXC.id == lxc_id).first()
        if not c:
            log.emit_sync("error", "LXC not found for local config push", "cf-route")
            return

        ingress_lines = "\n".join(
            f"  - hostname: {r['public_url']}\n    service: {r['service']}"
            for r in routes
        )
        config_yml = f"""tunnel: {tunnel_id}
ingress:
{ingress_lines}
  - service: http_status:404
"""
        script = f"""mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml << 'CFEOF'
{config_yml}
CFEOF
systemctl restart cloudflared
echo "CONFIG_APPLIED"
"""
        code, out = px.pct_exec(c.vmid, script)
        if "CONFIG_APPLIED" in out:
            log.emit_sync("success", f"config.yml atualizado na LXC com {len(routes)} rota(s), cloudflared reiniciado", "cf-route")
        else:
            log.emit_sync("warn", f"config.yml escrito mas cloudflared pode não ter reiniciado: {out[:200]}", "cf-route")
    except Exception as e:
        log.emit_sync("error", str(e), "cf-route")
    finally:
        db2.close()


def _get_tunnel_or_404(tunnel_id: int, db: Session) -> CloudflareTunnel:
    t = db.query(CloudflareTunnel).filter(CloudflareTunnel.id == tunnel_id).first()
    if not t:
        raise HTTPException(404, "Tunnel not found")
    return t


def _serialize_tunnel(t: CloudflareTunnel) -> dict:
    return {
        "id": t.id, "name": t.name, "lxc_id": t.lxc_id,
        "tunnel_id": t.tunnel_id, "account_id": t.account_id,
        "status": t.status,
        "routes": [_serialize_route(r) for r in t.routes],
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _serialize_route(r: CloudflareRoute) -> dict:
    return {
        "id": r.id, "tunnel_id": r.tunnel_id,
        "public_url": r.public_url, "service": r.service,
        "description": r.description,
    }
