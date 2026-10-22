import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.umask(0o077)

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
import logger as log
from auth import authenticate_proxmox, clear_session_cookie, create_token, get_current_user, set_session_cookie
from database import init_db
from routers import credentials, events, forwards, lxc, sites, stats, system, tunnels, vps

VERSION_FILE = os.path.join(config.BASE_DIR, "version.json")
STATIC_DIR = os.path.join(config.BASE_DIR, "frontend", "dist")


def _version() -> str:
    try:
        with open(VERSION_FILE) as f:
            return json.load(f).get("version", "unknown")
    except Exception:
        return "unknown"


app = FastAPI(title="WG Manager", version=_version(), docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security(request: Request, call_next):
    # CSRF: state-changing API calls must carry a header that cross-site forms cannot set.
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-wgm") != "1":
            return JSONResponse({"detail": "Requisição recusada (CSRF)"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self' https://api.github.com; frame-ancestors 'none'"
    )
    return response


for r in (vps, lxc, forwards, sites, tunnels, events, credentials, stats, system):
    app.include_router(r.router)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    user = authenticate_proxmox(req.username.strip(), req.password, request.client.host if request.client else "?")
    resp = JSONResponse({"username": user})
    set_session_cookie(resp, create_token(user))
    log.emit_sync("info", f"Login de {user}", "auth")
    return resp


@app.post("/api/auth/logout")
def logout():
    resp = JSONResponse({"ok": True})
    clear_session_cookie(resp)
    return resp


@app.get("/api/auth/me")
def me(user: str = Depends(get_current_user)):
    return {"username": user, "dev_auth": config.DEV_AUTH}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/version")
def version():
    return {"version": _version()}


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(rest: str):
    return JSONResponse({"detail": "Rota não encontrada"}, status_code=404)


if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        candidate = os.path.realpath(os.path.join(STATIC_DIR, full_path))
        if full_path and candidate.startswith(os.path.realpath(STATIC_DIR) + os.sep) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.on_event("startup")
async def startup():
    log.set_loop(asyncio.get_running_loop())
    config.harden_permissions()
    init_db()
    config.harden_permissions()
    asyncio.create_task(stats.start_collector())
    if config.DEV_AUTH:
        print("!! WGM_DEV_AUTH=1 — login sem senha habilitado. Nunca use em produção.")
    print(f"WG Manager {_version()} em {config.PANEL_HOST}:{config.PANEL_PORT}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.PANEL_HOST, port=config.PANEL_PORT, reload=False, proxy_headers=False)
