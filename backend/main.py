import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from database import init_db
from auth import authenticate_proxmox, create_token, get_current_user
from routers import vps, lxc, ports, tunnels, events, credentials, stats

app = FastAPI(title="WG Proxy Manager", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vps.router)
app.include_router(lxc.router)
app.include_router(ports.router)
app.include_router(tunnels.router)
app.include_router(events.router)
app.include_router(credentials.router)
app.include_router(stats.router)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(req: LoginRequest):
    data = authenticate_proxmox(req.username, req.password)
    token = create_token(req.username)
    return {"token": token, "username": req.username, "proxmox_ticket": data["ticket"], "proxmox_csrf": data["csrf"]}


@app.get("/api/auth/me")
def me(user: str = Depends(get_current_user)):
    return {"username": user}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/version")
def version():
    import json
    version_file = os.path.join(os.path.dirname(__file__), "..", "version.json")
    try:
        with open(version_file) as f:
            data = json.load(f)
        return {"version": data.get("version", "unknown")}
    except Exception:
        return {"version": "unknown"}


# Serve React frontend
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.on_event("startup")
async def startup():
    import asyncio
    import logger as log
    from routers.stats import start_collector
    loop = asyncio.get_event_loop()
    log.set_loop(loop)
    init_db()
    asyncio.create_task(start_collector(None))
    print(f"WG Proxy Manager started on port {os.getenv('PANEL_PORT', '8765')}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PANEL_PORT", "8765")), reload=False)
