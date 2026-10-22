import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import requests
import urllib3
from fastapi import HTTPException, Request, status
from jose import JWTError, jwt

import config

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ALGORITHM = "HS256"
COOKIE_NAME = "wgm_session"
_PVE = f"https://{config.PROXMOX_HOST}:8006/api2/json"

# ── brute-force protection: 8 failures per IP in 10 minutes → locked for the rest of the window ──
_failures: dict[str, deque] = defaultdict(deque)
_WINDOW, _MAX_FAILS = 600, 8


def _check_rate(ip: str):
    q = _failures[ip]
    now = time.time()
    while q and now - q[0] > _WINDOW:
        q.popleft()
    if len(q) >= _MAX_FAILS:
        wait = int(_WINDOW - (now - q[0]))
        raise HTTPException(429, f"Muitas tentativas. Tente novamente em {wait // 60 + 1} min.")


def authenticate_proxmox(username: str, password: str, client_ip: str) -> str:
    _check_rate(client_ip)
    if config.DEV_AUTH:
        return username
    try:
        r = requests.post(f"{_PVE}/access/ticket", data={"username": username, "password": password},
                          verify=config.PROXMOX_VERIFY_SSL, timeout=10)
    except Exception as e:
        raise HTTPException(503, f"Proxmox inacessível: {e}")
    if r.status_code != 200:
        _failures[client_ip].append(time.time())
        raise HTTPException(401, "Usuário ou senha inválidos")
    ticket = r.json()["data"]["ticket"]

    # The panel executes everything as root — only Proxmox administrators may use it.
    try:
        p = requests.get(f"{_PVE}/access/permissions", params={"path": "/"},
                         cookies={"PVEAuthCookie": ticket}, verify=config.PROXMOX_VERIFY_SSL, timeout=10)
        perms = (p.json().get("data") or {}).get("/", {})
    except Exception:
        perms = {}
    if not perms.get(config.REQUIRED_PRIVILEGE):
        raise HTTPException(403, f"O usuário precisa do privilégio {config.REQUIRED_PRIVILEGE} em '/' no Proxmox")
    _failures.pop(client_ip, None)
    return username


def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=config.TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, config.SECRET_KEY, algorithm=ALGORITHM)


def set_session_cookie(response, token: str):
    response.set_cookie(COOKIE_NAME, token, max_age=config.TOKEN_EXPIRE_HOURS * 3600, httponly=True,
                        samesite="strict", secure=config.COOKIE_SECURE, path="/")


def clear_session_cookie(response):
    response.delete_cookie(COOKIE_NAME, path="/")


def get_current_user(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada")
