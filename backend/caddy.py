"""Caddy reverse proxy: config generation and the scripts run inside the proxy container."""
from dataclasses import dataclass


@dataclass
class SiteSpec:
    hostname: str
    scheme: str          # http | https (upstream)
    ip: str
    port: int
    tls: bool = True
    enabled: bool = True


HEADER = "# Gerado pelo WG Manager — alterações manuais serão sobrescritas.\n"


def caddyfile(sites: list[SiteSpec], email: str | None) -> str:
    out = [HEADER, "{"]
    if email:
        out.append(f"\temail {email}")
    out += ["\tadmin localhost:2019", "}", ""]
    active = [s for s in sites if s.enabled]
    for s in sorted(active, key=lambda x: x.hostname):
        addr = s.hostname if s.tls else f"http://{s.hostname}"
        upstream = f"{s.scheme}://{s.ip}:{s.port}" if s.scheme == "https" else f"{s.ip}:{s.port}"
        out.append(f"{addr} {{")
        out.append("\tencode zstd gzip")
        if s.scheme == "https":
            # internal services usually have self-signed certificates
            out += [f"\treverse_proxy {upstream} {{", "\t\ttransport http {", "\t\t\ttls_insecure_skip_verify",
                    "\t\t}", "\t}"]
        else:
            out.append(f"\treverse_proxy {upstream}")
        out += ["}", ""]
    if not active:
        out += [":80 {", "\trespond \"WG Manager: nenhum site configurado\" 404", "}", ""]
    return "\n".join(out)


INSTALL = """set -e
export DEBIAN_FRONTEND=noninteractive
grep -qiE 'debian|ubuntu' /etc/os-release || { echo "Sistema não suportado (use Debian/Ubuntu)"; exit 3; }
if ! command -v caddy >/dev/null; then
  apt-get update -qq
  if ! apt-get install -y -qq caddy 2>/dev/null; then
    apt-get install -y -qq curl gpg debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
fi
systemctl enable --now caddy
caddy version
echo "CADDY_OK"
"""

# Writes the new config only if `caddy validate` accepts it; the previous one is kept as a backup.
APPLY = """set -e
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile.wgm-new <<'CADDYEOF'
{config}CADDYEOF
if ! caddy validate --config /etc/caddy/Caddyfile.wgm-new --adapter caddyfile >/tmp/wgm-caddy-validate 2>&1; then
  tail -n 5 /tmp/wgm-caddy-validate; rm -f /etc/caddy/Caddyfile.wgm-new; echo "CADDY_INVALID"; exit 6
fi
[ -f /etc/caddy/Caddyfile ] && cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.wgm-prev
mv /etc/caddy/Caddyfile.wgm-new /etc/caddy/Caddyfile
if systemctl is-active -q caddy; then systemctl reload caddy; else systemctl restart caddy; fi
echo "CADDY_APPLIED"
"""

STATUS = """
command -v caddy >/dev/null && echo "INSTALLED=1" || echo "INSTALLED=0"
systemctl is-active -q caddy && echo "ACTIVE=1" || echo "ACTIVE=0"
echo "VERSION=$(caddy version 2>/dev/null | awk '{print $1}')"
"""

LOGS = "journalctl -u caddy -n {lines} --no-pager -o cat 2>/dev/null | tail -n {lines}"
