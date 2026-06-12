import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db, APICredential
from auth import get_current_user

router = APIRouter(prefix="/api/credentials", tags=["credentials"])

CF_API = "https://api.cloudflare.com/client/v4"

KNOWN_PERMISSIONS = {
    "cloudflare": [
        {"key": "tunnel_edit",  "label": "Cloudflare Tunnel: Edit",  "desc": "Criar e gerenciar tunnels Zero Trust"},
        {"key": "dns_edit",     "label": "DNS: Edit",                 "desc": "Criar/atualizar registros DNS"},
        {"key": "zone_read",    "label": "Zone: Read",                "desc": "Listar zonas do domínio"},
    ]
}


class CredentialCreate(BaseModel):
    name: str
    provider: str = "cloudflare"
    account_id: Optional[str] = ""
    api_token: str
    notes: Optional[str] = ""


@router.get("")
def list_credentials(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(APICredential).all()
    return [_serialize(c) for c in rows]


@router.post("")
def create_credential(data: CredentialCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = APICredential(
        name=data.name, provider=data.provider,
        account_id=data.account_id, api_token=data.api_token,
        notes=data.notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serialize(c)


@router.post("/{cred_id}/verify")
async def verify_credential(cred_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Test the API token and detect which permissions it has."""
    c = _get_or_404(cred_id, db)
    headers = {"Authorization": f"Bearer {c.api_token}", "Content-Type": "application/json"}
    detected = []
    errors = []

    async with httpx.AsyncClient() as client:
        # Check token validity + zone:read
        r = await client.get(f"{CF_API}/user/tokens/verify", headers=headers)
        if not r.is_success:
            return {"ok": False, "error": "Token inválido ou sem permissão", "permissions": []}

        account_id = c.account_id.replace("-", "") if c.account_id else ""

        # Check zone:read
        r2 = await client.get(f"{CF_API}/zones", headers=headers)
        if r2.is_success and r2.json().get("result"):
            detected.append("zone_read")

        # Check DNS:edit — try listing DNS records of first zone
        if r2.is_success:
            zones = r2.json().get("result", [])
            if zones:
                zone_id = zones[0]["id"]
                r3 = await client.get(f"{CF_API}/zones/{zone_id}/dns_records?per_page=1", headers=headers)
                if r3.is_success:
                    detected.append("dns_edit")

        # Check tunnel:edit
        if account_id:
            r4 = await client.get(f"{CF_API}/accounts/{account_id}/cfd_tunnel?per_page=1", headers=headers)
            if r4.is_success:
                detected.append("tunnel_edit")

    # Save detected permissions
    c.permissions = ",".join(detected)
    db.commit()

    perm_labels = [p["label"] for p in KNOWN_PERMISSIONS["cloudflare"] if p["key"] in detected]
    return {"ok": True, "permissions": detected, "permission_labels": perm_labels}


@router.delete("/{cred_id}")
def delete_credential(cred_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _get_or_404(cred_id, db)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/cloudflare/active")
def get_active_cf_credential(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return first CF credential that has both tunnel_edit and dns_edit."""
    rows = db.query(APICredential).filter(APICredential.provider == "cloudflare").all()
    for c in rows:
        perms = c.permissions or ""
        if "tunnel_edit" in perms and "dns_edit" in perms:
            return _serialize(c)
        if "tunnel_edit" in perms or "dns_edit" in perms:
            return _serialize(c)
    if rows:
        return _serialize(rows[0])
    return None


def _get_or_404(cred_id: int, db: Session) -> APICredential:
    c = db.query(APICredential).filter(APICredential.id == cred_id).first()
    if not c:
        raise HTTPException(404, "Credential not found")
    return c


def _serialize(c: APICredential) -> dict:
    perms = [p for p in (c.permissions or "").split(",") if p]
    perm_labels = [p["label"] for p in KNOWN_PERMISSIONS.get(c.provider, []) if p["key"] in perms]
    return {
        "id": c.id, "name": c.name, "provider": c.provider,
        "account_id": c.account_id,
        "api_token_preview": c.api_token[:8] + "..." if c.api_token else "",
        "permissions": perms,
        "permission_labels": perm_labels,
        "notes": c.notes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
