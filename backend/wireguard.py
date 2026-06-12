import subprocess
import ipaddress
from typing import Optional
from ssh_manager import SSHClient


def generate_keypair() -> tuple[str, str]:
    priv = subprocess.check_output(["wg", "genkey"]).decode().strip()
    pub = subprocess.check_output(["wg", "pubkey"], input=priv.encode()).decode().strip()
    return priv, pub


def find_free_wg_address(used_addresses: list[str], subnet: str = "10.10.0.0/24") -> str:
    network = ipaddress.ip_network(subnet)
    used = {a.split("/")[0] for a in used_addresses}
    for host in network.hosts():
        ip = str(host)
        if ip not in used and ip != str(network.network_address + 1):
            return f"{ip}/24"
    raise ValueError("No free WireGuard addresses in subnet")


VPS_WG_SETUP = """
set -e
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
$SUDO apt-get update -qq
$SUDO apt-get install -y wireguard wireguard-tools iptables iptables-persistent 2>&1

# Enable IP forwarding
echo 'net.ipv4.ip_forward=1' | $SUDO tee -a /etc/sysctl.conf
$SUDO sysctl -w net.ipv4.ip_forward=1

$SUDO tee /etc/wireguard/{iface}.conf << 'WGEOF'
[Interface]
PrivateKey = {privkey}
Address = {address}
ListenPort = {port}
PostUp = iptables -t nat -A POSTROUTING -o {pub_iface} -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -o {pub_iface} -j MASQUERADE
WGEOF

$SUDO chmod 600 /etc/wireguard/{iface}.conf
$SUDO systemctl enable wg-quick@{iface}
$SUDO systemctl start wg-quick@{iface} || $SUDO systemctl restart wg-quick@{iface}
echo "WG_SETUP_OK"
"""

LXC_WG_SETUP = """
set -e
apt-get update -qq
apt-get install -y wireguard wireguard-tools 2>&1

cat > /etc/wireguard/wg0.conf << 'WGEOF'
[Interface]
PrivateKey = {privkey}
Address = {address}

[Peer]
PublicKey = {vps_pubkey}
Endpoint = {vps_host}:{vps_port}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
WGEOF

chmod 600 /etc/wireguard/wg0.conf
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0 || systemctl restart wg-quick@wg0
echo "LXC_WG_OK"
"""

VPS_ADD_PEER = """
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
$SUDO wg set {iface} peer {pubkey} allowed-ips {allowed_ips} persistent-keepalive 25

# Persist peer in config
$SUDO grep -q '{pubkey}' /etc/wireguard/{iface}.conf || echo '
[Peer]
# {label}
PublicKey = {pubkey}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25' | $SUDO tee -a /etc/wireguard/{iface}.conf
echo "PEER_ADDED"
"""

VPS_REMOVE_PEER = """
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
$SUDO wg set {iface} peer {pubkey} remove && echo PEER_REMOVED
"""

VPS_ADD_PORT = """
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
PUB_IFACE={pub_iface}
DEST={dest_ip}
PORT={port}
PROTO={proto}

# PREROUTING
$SUDO iptables -t nat -C PREROUTING -i $PUB_IFACE -p $PROTO --dport $PORT -j DNAT --to-destination $DEST:$PORT 2>/dev/null || \\
  $SUDO iptables -t nat -A PREROUTING -i $PUB_IFACE -p $PROTO --dport $PORT -j DNAT --to-destination $DEST:$PORT

# FORWARD
$SUDO iptables -C FORWARD -p $PROTO -d $DEST --dport $PORT -j ACCEPT 2>/dev/null || \\
  $SUDO iptables -A FORWARD -p $PROTO -d $DEST --dport $PORT -j ACCEPT

$SUDO iptables-save | $SUDO tee /etc/iptables/rules.v4 > /dev/null
echo "PORT_ADDED"
"""

VPS_REMOVE_PORT = """
SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
PUB_IFACE={pub_iface}
DEST={dest_ip}
PORT={port}
PROTO={proto}

$SUDO iptables -t nat -D PREROUTING -i $PUB_IFACE -p $PROTO --dport $PORT -j DNAT --to-destination $DEST:$PORT 2>/dev/null || true
$SUDO iptables -D FORWARD -p $PROTO -d $DEST --dport $PORT -j ACCEPT 2>/dev/null || true
$SUDO iptables-save | $SUDO tee /etc/iptables/rules.v4 > /dev/null
echo "PORT_REMOVED"
"""

LXC_CHECK_WG_EXISTING = """
WG_INSTALLED=0
WG_RUNNING=0
WG_CONFIG=""
WG_PEER=""

# Check if wireguard-tools installed
command -v wg > /dev/null 2>&1 && WG_INSTALLED=1

# Check if wg0 is up
if ip link show wg0 > /dev/null 2>&1; then
  WG_RUNNING=1
fi

# Read existing config if present
if [ -f /etc/wireguard/wg0.conf ]; then
  WG_CONFIG=$(cat /etc/wireguard/wg0.conf)
  WG_PEER=$(grep -A1 '\\[Peer\\]' /etc/wireguard/wg0.conf | grep 'Endpoint' | awk '{print $3}' || echo "")
fi

echo "WG_INSTALLED=$WG_INSTALLED"
echo "WG_RUNNING=$WG_RUNNING"
echo "WG_PEER=$WG_PEER"
if [ -n "$WG_CONFIG" ]; then
  echo "WG_CONFIG_EXISTS=1"
  echo "---WG_CONFIG_START---"
  echo "$WG_CONFIG"
  echo "---WG_CONFIG_END---"
else
  echo "WG_CONFIG_EXISTS=0"
fi
"""

LXC_REMOVE_WG = """
systemctl stop wg-quick@wg0 2>/dev/null || true
systemctl disable wg-quick@wg0 2>/dev/null || true
rm -f /etc/wireguard/wg0.conf
rm -f /etc/wireguard/private.key /etc/wireguard/public.key
echo "WG_REMOVED"
"""

LXC_CHECK_PERMISSIONS = """
ERRORS=""
# Check OS
if ! grep -qiE 'debian|ubuntu' /etc/os-release 2>/dev/null; then
  ERRORS="${ERRORS}OS_NOT_SUPPORTED "
fi
# Check wireguard module
if ! modinfo wireguard > /dev/null 2>&1 && ! [ -f /sys/module/wireguard/version ]; then
  ERRORS="${ERRORS}WG_MODULE_MISSING "
fi
# Check net_admin cap
if ! ip link add dummy_wgtest type dummy 2>/dev/null; then
  ERRORS="${ERRORS}NET_ADMIN_MISSING "
else
  ip link del dummy_wgtest 2>/dev/null
fi
if [ -z "$ERRORS" ]; then
  echo "PERMISSIONS_OK"
else
  echo "PERMISSIONS_FAIL: $ERRORS"
fi
"""


def get_vps_peers_status(ssh: SSHClient, iface: str) -> str:
    _, out, _ = ssh.run(f"wg show {iface}")
    return out
