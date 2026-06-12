import httpx
from typing import Optional

CF_API = "https://api.cloudflare.com/client/v4"


def _headers(api_token: str) -> dict:
    return {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}


async def create_tunnel(account_id: str, api_token: str, name: str) -> dict:
    # Cloudflare account IDs are 32-char hex without hyphens
    account_id = account_id.replace("-", "")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{CF_API}/accounts/{account_id}/cfd_tunnel",
            headers=_headers(api_token),
            json={"name": name, "config_src": "cloudflare"},
        )
        if not r.is_success:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
            raise Exception(f"CF API {r.status_code}: {body}")
        data = r.json()["result"]
        return {"tunnel_id": data["id"], "name": data["name"], "token": data.get("token", "")}


async def get_tunnel_token(account_id: str, api_token: str, tunnel_id: str) -> str:
    account_id = account_id.replace("-", "")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{CF_API}/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token",
            headers=_headers(api_token),
        )
        r.raise_for_status()
        return r.json()["result"]


async def get_tunnel_status(account_id: str, api_token: str, tunnel_id: str) -> str:
    account_id = account_id.replace("-", "")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{CF_API}/accounts/{account_id}/cfd_tunnel/{tunnel_id}",
            headers=_headers(api_token),
        )
        if r.status_code != 200:
            return "unknown"
        data = r.json()["result"]
        return data.get("status", "unknown")


async def update_tunnel_config(account_id: str, api_token: str, tunnel_id: str, routes: list) -> bool:
    account_id = account_id.replace("-", "")
    ingress = [{"hostname": r["public_url"], "service": r["service"]} for r in routes]
    ingress.append({"service": "http_status:404"})
    async with httpx.AsyncClient() as client:
        r = await client.put(
            f"{CF_API}/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations",
            headers=_headers(api_token),
            json={"config": {"ingress": ingress}},
        )
        return r.status_code in (200, 204)


async def create_dns_route(account_id: str, api_token: str, tunnel_id: str, hostname: str) -> bool:
    """Create CNAME DNS record pointing hostname to tunnel."""
    account_id = account_id.replace("-", "")
    # First get zone_id for the hostname domain
    domain = ".".join(hostname.split(".")[-2:])
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{CF_API}/zones?name={domain}",
            headers=_headers(api_token),
        )
        zones = r.json().get("result", [])
        if not zones:
            raise Exception(f"Zona DNS não encontrada para domínio '{domain}'")
        zone_id = zones[0]["id"]

        # Create/update CNAME record
        cname_value = f"{tunnel_id}.cfargotunnel.com"
        # Check if record exists
        r2 = await client.get(
            f"{CF_API}/zones/{zone_id}/dns_records?name={hostname}&type=CNAME",
            headers=_headers(api_token),
        )
        existing = r2.json().get("result", [])
        if existing:
            record_id = existing[0]["id"]
            r3 = await client.put(
                f"{CF_API}/zones/{zone_id}/dns_records/{record_id}",
                headers=_headers(api_token),
                json={"type": "CNAME", "name": hostname, "content": cname_value, "proxied": True},
            )
            return r3.is_success
        else:
            r3 = await client.post(
                f"{CF_API}/zones/{zone_id}/dns_records",
                headers=_headers(api_token),
                json={"type": "CNAME", "name": hostname, "content": cname_value, "proxied": True},
            )
            return r3.is_success


async def delete_tunnel(account_id: str, api_token: str, tunnel_id: str) -> bool:
    account_id = account_id.replace("-", "")
    async with httpx.AsyncClient() as client:
        r = await client.delete(
            f"{CF_API}/accounts/{account_id}/cfd_tunnel/{tunnel_id}",
            headers=_headers(api_token),
        )
        return r.status_code in (200, 204)


CLOUDFLARED_INSTALL = """
set -e
# Install cloudflared binary if missing
if ! command -v cloudflared &>/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y cloudflared
fi

# Remove existing service if present (different token / fresh install)
if [ -f /etc/systemd/system/cloudflared.service ]; then
  echo "Removing existing cloudflared service..."
  systemctl stop cloudflared 2>/dev/null || true
  cloudflared service uninstall 2>/dev/null || true
  systemctl daemon-reload
fi

cloudflared service install {token}
systemctl enable cloudflared
systemctl start cloudflared
echo "CLOUDFLARED_OK"
"""

CLOUDFLARED_UNINSTALL = """
systemctl stop cloudflared 2>/dev/null || true
cloudflared service uninstall 2>/dev/null || true
echo "CLOUDFLARED_REMOVED"
"""
