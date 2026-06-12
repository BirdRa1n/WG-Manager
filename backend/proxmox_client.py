import os
import subprocess
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

PROXMOX_HOST = os.getenv("PROXMOX_HOST", "localhost")
VERIFY_SSL = os.getenv("PROXMOX_VERIFY_SSL", "false").lower() == "true"
BASE_URL = f"https://{PROXMOX_HOST}:8006/api2/json"


def _headers(ticket: str, csrf: str = None) -> dict:
    h = {"Cookie": f"PVEAuthCookie={ticket}"}
    if csrf:
        h["CSRFPreventionToken"] = csrf
    return h


def list_nodes(ticket: str) -> list:
    r = requests.get(f"{BASE_URL}/nodes", headers=_headers(ticket), verify=VERIFY_SSL, timeout=10)
    r.raise_for_status()
    return r.json()["data"]


def list_lxc(ticket: str, node: str = "pve") -> list:
    r = requests.get(f"{BASE_URL}/nodes/{node}/lxc", headers=_headers(ticket), verify=VERIFY_SSL, timeout=10)
    r.raise_for_status()
    containers = r.json()["data"]
    result = []
    for ct in containers:
        vmid = ct["vmid"]
        config_r = requests.get(
            f"{BASE_URL}/nodes/{node}/lxc/{vmid}/config",
            headers=_headers(ticket), verify=VERIFY_SSL, timeout=10
        )
        config = config_r.json().get("data", {}) if config_r.status_code == 200 else {}
        result.append({
            "vmid": vmid,
            "name": ct.get("name", f"CT-{vmid}"),
            "status": ct.get("status"),
            "os_template": config.get("ostemplate", ""),
            "features": config.get("features", ""),
            "memory": ct.get("maxmem", 0),
            "cpus": ct.get("cpus", 1),
        })
    return result


def get_lxc_config(ticket: str, vmid: int, node: str = "pve") -> dict:
    r = requests.get(f"{BASE_URL}/nodes/{node}/lxc/{vmid}/config", headers=_headers(ticket), verify=VERIFY_SSL, timeout=10)
    r.raise_for_status()
    return r.json()["data"]


def fix_lxc_permissions(ticket: str, csrf: str, vmid: int, node: str = "pve") -> bool:
    config = get_lxc_config(ticket, vmid, node)
    features = config.get("features", "")
    if "nesting=1" not in features:
        new_features = f"nesting=1,{features}".strip(",") if features else "nesting=1"
        r = requests.put(
            f"{BASE_URL}/nodes/{node}/lxc/{vmid}/config",
            headers=_headers(ticket, csrf),
            data={"features": new_features},
            verify=VERIFY_SSL, timeout=10
        )
        if r.status_code not in (200, 204):
            return False
    return True


def pct_exec(vmid: int, command: str, node: str = "pve") -> tuple[int, str]:
    """Execute command in LXC via pct exec on the Proxmox host."""
    result = subprocess.run(
        ["pct", "exec", str(vmid), "--", "bash", "-c", command],
        capture_output=True, text=True, timeout=120
    )
    output = result.stdout + result.stderr
    return result.returncode, output


def pct_exec_stream(vmid: int, command: str):
    """Stream output from pct exec."""
    proc = subprocess.Popen(
        ["pct", "exec", str(vmid), "--", "bash", "-c", command],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    for line in proc.stdout:
        yield line.rstrip("\n")
    proc.wait()
    return proc.returncode
