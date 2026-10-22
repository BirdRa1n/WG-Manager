import ipaddress
import subprocess


def generate_keypair() -> tuple[str, str]:
    priv = subprocess.check_output(["wg", "genkey"]).decode().strip()
    pub = subprocess.check_output(["wg", "pubkey"], input=priv.encode()).decode().strip()
    return priv, pub


def public_key(private_key: str) -> str:
    return subprocess.check_output(["wg", "pubkey"], input=private_key.encode()).decode().strip()


def find_free_wg_address(used: list[str], server_address: str | None) -> str:
    """Next free host address in the server's WireGuard subnet.

    `used` must include the live peers of the VPS (not only what the panel knows), otherwise the
    new peer may steal an allowed-ip from an existing one — WireGuard silently moves it.
    """
    iface = ipaddress.IPv4Interface(server_address or "10.10.0.1/24")
    network = iface.network
    taken = {str(iface.ip)}
    for a in used:
        for part in (a or "").split(","):
            part = part.strip()
            if not part or part == "(none)":
                continue
            try:
                net = ipaddress.ip_network(part, strict=False)
            except ValueError:
                continue
            if net.version == 4 and net.prefixlen >= 24:
                taken.update(str(h) for h in (net.hosts() if net.prefixlen < 31 else [net.network_address]))
    for h in network.hosts():
        if str(h) not in taken:
            return f"{h}/{network.prefixlen}"
    raise ValueError(f"Sem endereços livres em {network}")


def pick_subnet(taken: list[str]) -> str:
    """First 10.N.0.0/24 (N = 10, 20, … 250, then the rest) that overlaps nothing in `taken`."""
    nets = []
    for t in taken:
        try:
            nets.append(ipaddress.ip_network(t, strict=False))
        except ValueError:
            continue
    order = list(range(10, 251, 10)) + [n for n in range(11, 255) if n % 10]
    for n in order:
        cand = ipaddress.ip_network(f"10.{n}.0.0/24")
        if not any(cand.overlaps(x) for x in nets if x.version == 4 and x.prefixlen > 0):
            return str(cand)
    raise ValueError("Nenhuma sub-rede 10.N.0.0/24 livre")


VPS_WG_SETUP = """set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools iptables iptables-persistent
echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-wg-manager.conf
sysctl -qw net.ipv4.ip_forward=1
umask 077
if [ -f /etc/wireguard/{iface}.conf ]; then
  cp -p /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.wgm-bak-$(date +%s)
fi
cat > /etc/wireguard/{iface}.conf <<'WGEOF'
[Interface]
PrivateKey = {privkey}
Address = {address}
ListenPort = {port}
WGEOF
systemctl enable wg-quick@{iface}
systemctl restart wg-quick@{iface}
iptables -C INPUT -p udp --dport {port} -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport {port} -j ACCEPT
[ -d /etc/iptables ] && iptables-save > /etc/iptables/rules.v4
echo "WG_SETUP_OK"
"""

LXC_WG_SETUP = """set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard-tools iproute2
umask 077
cat > /etc/wireguard/wg0.conf <<'WGEOF'
[Interface]
PrivateKey = {privkey}
Address = {address}

[Peer]
PublicKey = {vps_pubkey}
Endpoint = {vps_host}:{vps_port}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
WGEOF
systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0
echo "LXC_WG_OK"
"""

VPS_ADD_PEER = """set -e
OWNER=$(wg show {iface} allowed-ips | awk -v ip="{allowed_ip}" '{{for(i=2;i<=NF;i++) if($i==ip) print $1}}')
if [ -n "$OWNER" ] && [ "$OWNER" != "{pubkey}" ]; then
  echo "IP_CONFLICT $OWNER"; exit 4
fi
wg set {iface} peer {pubkey} allowed-ips {allowed_ip} persistent-keepalive 25
if ! grep -q '{pubkey}' /etc/wireguard/{iface}.conf; then
  cp -p /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.wgm-bak-$(date +%s)
  printf '\\n[Peer]\\n# {label}\\nPublicKey = {pubkey}\\nAllowedIPs = {allowed_ip}\\nPersistentKeepalive = 25\\n' >> /etc/wireguard/{iface}.conf
fi
echo "PEER_ADDED"
"""

# Joins the Proxmox host to the VPS tunnel: optional re-address (only when the VPS has no peers),
# host peer, WireGuard port opened in INPUT and rules persisted. A backup of every file is kept.
VPS_CONNECT_HOST = """set -e
CONF=/etc/wireguard/{iface}.conf
TS=$(date +%s)
cp -p "$CONF" "$CONF.wgm-bak-$TS"
[ -f /etc/iptables/rules.v4 ] && cp -p /etc/iptables/rules.v4 /etc/iptables/rules.v4.wgm-bak-$TS
RESTART=0
if [ "{new_address}" != "" ]; then
  if [ "$(wg show {iface} peers | wc -l)" != "0" ]; then echo "HAS_PEERS"; exit 5; fi
  sed -i 's#^Address *=.*#Address = {new_address}#' "$CONF"
  RESTART=1
fi
OWNER=$(wg show {iface} allowed-ips | awk -v ip="{host_ip}/32" '{{for(i=2;i<=NF;i++) if($i==ip) print $1}}')
if [ -n "$OWNER" ] && [ "$OWNER" != "{host_pub}" ]; then echo "IP_CONFLICT $OWNER"; exit 4; fi
if ! grep -q '{host_pub}' "$CONF"; then
  printf '\n[Peer]\n# Host Proxmox (WG Manager)\nPublicKey = {host_pub}\nAllowedIPs = {host_ip}/32\n' >> "$CONF"
fi
iptables -C INPUT -p udp --dport {port} -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport {port} -j ACCEPT
[ -d /etc/iptables ] && iptables-save > /etc/iptables/rules.v4
if [ "$RESTART" = "1" ]; then
  systemctl restart wg-quick@{iface}
else
  wg set {iface} peer {host_pub} allowed-ips {host_ip}/32
fi
echo "HOST_CONNECTED"
"""

HOST_WG_CONF = """# Túnel com {vps_name} ({vps_host}) — criado pelo WG Manager
[Interface]
PrivateKey = {privkey}
Address = {host_ip}/{prefix}

[Peer]
PublicKey = {vps_pub}
Endpoint = {vps_host}:{vps_port}
AllowedIPs = {network}
PersistentKeepalive = 25
"""

# Removes the peer at runtime and its [Peer] block from the config (a backup is kept).
VPS_REMOVE_PEER = """set -e
wg set {iface} peer {pubkey} remove 2>/dev/null || true
CONF=/etc/wireguard/{iface}.conf
if grep -q '{pubkey}' "$CONF"; then
  cp -p "$CONF" "$CONF.wgm-bak-$(date +%s)"
  awk -v key="{pubkey}" '
    function flush() {{ if (buf != "" && index(buf, key) == 0) printf "%s", buf; buf = "" }}
    /^\\[/ {{ flush() }}
    {{ buf = buf $0 "\\n" }}
    END {{ flush() }}
  ' "$CONF" > "$CONF.wgm-tmp"
  cat "$CONF.wgm-tmp" > "$CONF" && rm -f "$CONF.wgm-tmp"
fi
echo "PEER_REMOVED"
"""

VPS_DETECT = """
echo "=== WG_INSTALLED ==="
command -v wg > /dev/null 2>&1 && echo "YES" || echo "NO"
echo "=== WG_CONF ==="
cat /etc/wireguard/{iface}.conf 2>/dev/null || echo "NO_CONF"
echo "=== PUB_IFACE ==="
ip route | awk '/default/ {{print $5; exit}}'
echo "=== END ==="
"""

VPS_PEERS = "wg show {iface} dump 2>/dev/null"

LXC_CHECK_WG_EXISTING = """
WG_INSTALLED=0; WG_RUNNING=0
command -v wg > /dev/null 2>&1 && WG_INSTALLED=1
ip link show wg0 > /dev/null 2>&1 && WG_RUNNING=1
echo "WG_INSTALLED=$WG_INSTALLED"
echo "WG_RUNNING=$WG_RUNNING"
if [ -f /etc/wireguard/wg0.conf ]; then
  echo "WG_CONFIG_EXISTS=1"
  echo "WG_ADDRESS=$(awk -F' *= *' '/^Address/ {print $2; exit}' /etc/wireguard/wg0.conf)"
  echo "WG_PEER=$(awk -F' *= *' '/^Endpoint/ {print $2; exit}' /etc/wireguard/wg0.conf)"
else
  echo "WG_CONFIG_EXISTS=0"
fi
"""

LXC_REMOVE_WG = """
systemctl stop wg-quick@wg0 2>/dev/null || true
systemctl disable wg-quick@wg0 2>/dev/null || true
[ -f /etc/wireguard/wg0.conf ] && mv /etc/wireguard/wg0.conf /etc/wireguard/wg0.conf.wgm-removed-$(date +%s)
echo "WG_REMOVED"
"""

LXC_CHECK_PERMISSIONS = """
ERRORS=""
grep -qiE 'debian|ubuntu' /etc/os-release 2>/dev/null || ERRORS="${ERRORS}OS_NOT_SUPPORTED "
if ! ip link add wgm_test type wireguard 2>/dev/null; then
  ip link add dummy_wgtest type dummy 2>/dev/null && ip link del dummy_wgtest 2>/dev/null || ERRORS="${ERRORS}NET_ADMIN_MISSING "
  ERRORS="${ERRORS}WG_MODULE_MISSING "
else
  ip link del wgm_test 2>/dev/null
fi
[ -z "$ERRORS" ] && echo "PERMISSIONS_OK" || echo "PERMISSIONS_FAIL: $ERRORS"
"""


def parse_dump(out: str) -> list[dict]:
    """`wg show <iface> dump` → peers (first line is the interface itself)."""
    peers = []
    for line in out.strip().splitlines():
        p = line.split("\t")
        if len(p) < 8:
            continue
        peers.append({
            "pubkey": p[0],
            "endpoint": None if p[2] == "(none)" else p[2],
            "allowed_ips": None if p[3] == "(none)" else p[3],
            "last_handshake": int(p[4]) if p[4].isdigit() else 0,
            "rx_bytes": int(p[5]) if p[5].isdigit() else 0,
            "tx_bytes": int(p[6]) if p[6].isdigit() else 0,
            "keepalive": None if p[7] == "off" else p[7],
        })
    return peers
