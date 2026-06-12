import os
import requests
import urllib3
from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8
PROXMOX_HOST = os.getenv("PROXMOX_HOST", "localhost")
PROXMOX_VERIFY_SSL = os.getenv("PROXMOX_VERIFY_SSL", "false").lower() == "true"

bearer_scheme = HTTPBearer()


def authenticate_proxmox(username: str, password: str) -> dict:
    url = f"https://{PROXMOX_HOST}:8006/api2/json/access/ticket"
    try:
        r = requests.post(url, data={"username": username, "password": password}, verify=PROXMOX_VERIFY_SSL, timeout=10)
        if r.status_code == 200:
            data = r.json()["data"]
            return {"ticket": data["ticket"], "csrf": data["CSRFPreventionToken"], "username": username}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Proxmox unreachable: {e}")
    raise HTTPException(status_code=401, detail="Invalid Proxmox credentials")


def create_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))) -> str:
    token = None
    if credentials:
        token = credentials.credentials
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
