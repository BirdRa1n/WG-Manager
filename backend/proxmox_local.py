"""Operations on the Proxmox host itself. The panel runs as root on the host, so it uses the local
CLIs (pvesh / pct / iptables / wg) instead of juggling short-lived Proxmox API tickets."""
import json
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from validators import ipv4


class HostError(Exception):
    pass


def available() -> bool:
    return shutil.which("pvesh") is not None


def run_script(script: str, timeout: int = 120) -> tuple[int, str]:
    """Run a bash script on the host (script via stdin, never through argv)."""
    try:
        r = subprocess.run(["bash", "-s"], input=script, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        raise HostError(str(e))
    except subprocess.TimeoutExpired:
        raise HostError(f"tempo esgotado após {timeout}s")
    return r.returncode, (r.stdout + r.stderr)


def _pvesh(path: str, timeout: int = 15, **params):
    if not available():
        raise HostError("pvesh não encontrado — o painel precisa rodar no host Proxmox")
    # pvesh takes API parameters as --name value, never as a query string
    args = [a for k, v in params.items() for a in (f"--{k}", str(v))]
    r = subprocess.run(["pvesh", "get", path, *args, "--output-format", "json"],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise HostError(r.stderr.strip() or f"pvesh get {path} falhou")
    return json.loads(r.stdout or "null")


# ── guests (LXC + VMs) ───────────────────────────────────────────────────────────────────────

_guest_cache: tuple[float, list] = (0.0, [])


def _guest_ips(g: dict) -> list[str]:
    node, vmid = g["node"], g["vmid"]
    ips = []
    try:
        if g["type"] == "lxc":
            if g.get("status") == "running":
                for itf in _pvesh(f"/nodes/{node}/lxc/{vmid}/interfaces", timeout=8) or []:
                    if itf.get("name") in ("lo",):
                        continue
                    for a in itf.get("ip-addresses", []):
                        if a.get("ip-address-type") == "inet":
                            ips.append({"ip": a["ip-address"], "iface": itf.get("name")})
            if not ips:
                cfg = _pvesh(f"/nodes/{node}/lxc/{vmid}/config", timeout=8) or {}
                for k, v in cfg.items():
                    if k.startswith("net") and "ip=" in str(v):
                        part = [p for p in str(v).split(",") if p.startswith("ip=")][0][3:]
                        if part not in ("dhcp", "manual"):
                            ips.append({"ip": part.split("/")[0], "iface": k})
        elif g.get("status") == "running":
            res = _pvesh(f"/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces", timeout=8) or {}
            for itf in res.get("result", []):
                for a in itf.get("ip-addresses", []):
                    ip = a.get("ip-address", "")
                    if a.get("ip-address-type") == "ipv4" and not ip.startswith(("127.", "169.254.")):
                        ips.append({"ip": ip, "iface": itf.get("name")})
    except Exception:
        pass
    return ips


def list_guests(force: bool = False) -> list[dict]:
    global _guest_cache
    ts, cached = _guest_cache
    if not force and cached and time.time() - ts < 30:
        return cached
    resources = _pvesh("/cluster/resources", type="vm") or []
    guests = [r for r in resources if not r.get("template")]
    with ThreadPoolExecutor(max_workers=8) as pool:
        ip_lists = list(pool.map(_guest_ips, guests))
    out = []
    for g, ips in zip(guests, ip_lists):
        out.append({
            "vmid": g["vmid"], "name": g.get("name") or f"{g['type']}-{g['vmid']}",
            "type": g["type"], "node": g["node"], "status": g.get("status"),
            "cpus": g.get("maxcpu"), "maxmem": g.get("maxmem"), "mem": g.get("mem"),
            "uptime": g.get("uptime"), "tags": g.get("tags", ""),
            "ips": ips,
        })
    out.sort(key=lambda x: x["vmid"])
    _guest_cache = (time.time(), out)
    return out


def guest_config(vmid: int, node: str) -> dict:
    return _pvesh(f"/nodes/{node}/lxc/{int(vmid)}/config") or {}


def enable_nesting(vmid: int) -> tuple[bool, str]:
    cfg_features = ""
    try:
        node = next((g["node"] for g in list_guests() if g["vmid"] == vmid), "pve")
        cfg_features = guest_config(vmid, node).get("features", "")
    except Exception:
        pass
    feats = dict(p.split("=", 1) for p in cfg_features.split(",") if "=" in p)
    feats["nesting"] = "1"
    value = ",".join(f"{k}={v}" for k, v in feats.items())
    r = subprocess.run(["pct", "set", str(int(vmid)), "--features", value], capture_output=True, text=True, timeout=30)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def pct_exec(vmid: int, command: str, timeout: int = 120) -> tuple[int, str]:
    r = subprocess.run(["pct", "exec", str(int(vmid)), "--", "bash", "-s"],
                       input=command, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


def pct_exec_stream(vmid: int, command: str) -> Iterator[str]:
    proc = subprocess.Popen(["pct", "exec", str(int(vmid)), "--", "bash", "-s"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    proc.stdin.write(command)
    proc.stdin.close()
    for line in proc.stdout:
        yield line.rstrip("\n")
    proc.wait()
    if proc.returncode != 0:
        raise HostError(f"comando no CT {vmid} terminou com código {proc.returncode}")


# ── local WireGuard ──────────────────────────────────────────────────────────────────────────

def local_wg_interfaces() -> list[dict]:
    """Local WireGuard interfaces with their address and peer endpoints (no private keys)."""
    if not shutil.which("wg"):
        return []
    r = subprocess.run(["wg", "show", "all", "dump"], capture_output=True, text=True, timeout=10)
    if r.returncode != 0:
        return []
    ifaces: dict[str, dict] = {}
    for line in r.stdout.splitlines():
        p = line.split("\t")
        if len(p) == 5:       # interface line: name, private, public, port, fwmark
            ifaces[p[0]] = {"name": p[0], "public_key": p[2], "listen_port": p[3], "peers": [], "address": None}
        elif len(p) >= 9 and p[0] in ifaces:
            ifaces[p[0]]["peers"].append({
                "public_key": p[1], "endpoint": None if p[3] == "(none)" else p[3],
                "allowed_ips": p[4], "latest_handshake": int(p[5] or 0),
                "rx": int(p[6] or 0), "tx": int(p[7] or 0),
            })
    for name, data in ifaces.items():
        a = subprocess.run(["ip", "-4", "-o", "addr", "show", "dev", name], capture_output=True, text=True)
        for tok in a.stdout.split():
            if "/" in tok and tok[0].isdigit():
                data["address"] = tok
                break
    return list(ifaces.values())


def detect_gateway(vps_host: str, vps_public_key: str | None) -> dict | None:
    """Find the local wg interface whose peer is this VPS → (iface, our address on it)."""
    for itf in local_wg_interfaces():
        for peer in itf["peers"]:
            ep = (peer["endpoint"] or "").rsplit(":", 1)[0].strip("[]")
            if (vps_public_key and peer["public_key"] == vps_public_key) or ep == vps_host:
                if itf["address"]:
                    return {"iface": itf["name"], "ip": ipv4(itf["address"].split("/")[0]),
                            "handshake": peer["latest_handshake"]}
    return None


def default_lan_iface() -> str:
    try:
        r = subprocess.run(["ip", "route", "show", "default"], capture_output=True, text=True, timeout=5)
        toks = r.stdout.split()
        if "dev" in toks:
            return toks[toks.index("dev") + 1]
    except Exception:
        pass
    return "vmbr0"
