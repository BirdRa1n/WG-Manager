"""Declarative iptables management.

Everything the panel creates lives in its own chains (WGM-PRE / WGM-POST in nat, WGM-FWD in
filter), hooked at the top of PREROUTING / POSTROUTING / FORWARD. Applying = rebuilding those
chains atomically with `iptables-restore --noflush`, so edits, toggles and deletes can never leave
stale or duplicated rules behind, and rules created by other tools (fw-manager, Docker, Tailscale)
are never touched.

Two hops are supported:

  direct   Internet → VPS:port ──DNAT──▶ target_ip:target_port   (a WireGuard peer)
  host     Internet → VPS:port ──DNAT──▶ gw_ip:port (Proxmox host on wg)
                                 host ──DNAT──▶ target_ip:target_port (LAN guest)
"""
import re
import shlex
from dataclasses import dataclass, field

CHAIN_PRE = "WGM-PRE"
CHAIN_POST = "WGM-POST"
CHAIN_FWD = "WGM-FWD"
WGM_CHAINS = (CHAIN_PRE, CHAIN_POST, CHAIN_FWD)


@dataclass
class Rule:
    id: int
    port: int
    protocol: str            # tcp | udp | both
    mode: str                # direct | host
    target_ip: str
    target_port: int
    enabled: bool = True

    @property
    def protos(self) -> list[str]:
        return ["tcp", "udp"] if self.protocol == "both" else [self.protocol]


@dataclass
class VPSNet:
    pub_iface: str
    wg_iface: str
    gw_ip: str | None


@dataclass
class HostNet:
    gw_iface: str
    lan_iface: str


def _c(rule_id: int) -> str:
    return f'-m comment --comment "wgm:{rule_id}"'


# ── rule generation (lines are written in the canonical `iptables -S` format) ──────────────────

def vps_lines(rules: list[Rule], net: VPSNet) -> dict[str, list[str]]:
    nat_pre, nat_post, fwd = [], [], [f"-A {CHAIN_FWD} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"]
    for r in rules:
        if not r.enabled:
            continue
        if r.mode == "host":
            if not net.gw_ip:
                continue
            dest, dport = net.gw_ip, r.port
        else:
            dest, dport = r.target_ip, r.target_port
        for p in r.protos:
            nat_pre.append(f"-A {CHAIN_PRE} -i {net.pub_iface} -p {p} -m {p} --dport {r.port} {_c(r.id)} -j DNAT --to-destination {dest}:{dport}")
            nat_post.append(f"-A {CHAIN_POST} -d {dest}/32 -o {net.wg_iface} -p {p} -m {p} --dport {dport} {_c(r.id)} -j MASQUERADE")
            fwd.append(f"-A {CHAIN_FWD} -d {dest}/32 -o {net.wg_iface} -p {p} -m {p} --dport {dport} {_c(r.id)} -j ACCEPT")
    return {"nat_pre": nat_pre, "nat_post": nat_post, "fwd": fwd}


def host_lines(rules: list[tuple[Rule, HostNet]]) -> dict[str, list[str]]:
    nat_pre, nat_post, fwd = [], [], [f"-A {CHAIN_FWD} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"]
    for r, net in rules:
        if not r.enabled or r.mode != "host":
            continue
        for p in r.protos:
            nat_pre.append(f"-A {CHAIN_PRE} -i {net.gw_iface} -p {p} -m {p} --dport {r.port} {_c(r.id)} -j DNAT --to-destination {r.target_ip}:{r.target_port}")
            nat_post.append(f"-A {CHAIN_POST} -d {r.target_ip}/32 -o {net.lan_iface} -p {p} -m {p} --dport {r.target_port} {_c(r.id)} -j MASQUERADE")
            fwd.append(f"-A {CHAIN_FWD} -d {r.target_ip}/32 -i {net.gw_iface} -o {net.lan_iface} -p {p} -m {p} --dport {r.target_port} {_c(r.id)} -j ACCEPT")
    return {"nat_pre": nat_pre, "nat_post": nat_post, "fwd": fwd}


def apply_script(lines: dict[str, list[str]]) -> str:
    """Bash script (run as root) that atomically rebuilds the WGM chains and persists them."""
    payload = "\n".join([
        "*nat",
        f":{CHAIN_PRE} - [0:0]",
        f":{CHAIN_POST} - [0:0]",
        f"-F {CHAIN_PRE}",
        f"-F {CHAIN_POST}",
        *lines["nat_pre"],
        *lines["nat_post"],
        "COMMIT",
        "*filter",
        f":{CHAIN_FWD} - [0:0]",
        f"-F {CHAIN_FWD}",
        *lines["fwd"],
        "COMMIT",
        "",
    ])
    return f"""set -e
command -v iptables-restore >/dev/null || {{ echo "iptables-restore não encontrado"; exit 3; }}
iptables-restore --noflush <<'WGM_RULES'
{payload}WGM_RULES
iptables -t nat -C PREROUTING -j {CHAIN_PRE} 2>/dev/null || iptables -t nat -I PREROUTING 1 -j {CHAIN_PRE}
iptables -t nat -C POSTROUTING -j {CHAIN_POST} 2>/dev/null || iptables -t nat -I POSTROUTING 1 -j {CHAIN_POST}
iptables -C FORWARD -j {CHAIN_FWD} 2>/dev/null || iptables -I FORWARD 1 -j {CHAIN_FWD}
if [ "$(sysctl -n net.ipv4.ip_forward)" != "1" ]; then
  sysctl -qw net.ipv4.ip_forward=1
  echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-wg-manager.conf
fi
if [ -d /etc/iptables ]; then
  if [ -f /etc/iptables/rules.v4 ] && [ ! -f /etc/iptables/rules.v4.wgm-original ]; then
    cp -p /etc/iptables/rules.v4 /etc/iptables/rules.v4.wgm-original
  fi
  iptables-save > /etc/iptables/rules.v4.wgm-tmp && mv /etc/iptables/rules.v4.wgm-tmp /etc/iptables/rules.v4
  echo "PERSISTED"
else
  echo "NOT_PERSISTED"
fi
echo "WGM_APPLIED"
"""


READ_SCRIPT = f"""
echo "=== WGM_PRE ==="; iptables -t nat -S {CHAIN_PRE} 2>/dev/null || echo MISSING
echo "=== WGM_POST ==="; iptables -t nat -S {CHAIN_POST} 2>/dev/null || echo MISSING
echo "=== WGM_FWD ==="; iptables -S {CHAIN_FWD} 2>/dev/null || echo MISSING
echo "=== HOOKS ==="
iptables -t nat -C PREROUTING -j {CHAIN_PRE} 2>/dev/null && echo PRE_OK
iptables -t nat -C POSTROUTING -j {CHAIN_POST} 2>/dev/null && echo POST_OK
iptables -C FORWARD -j {CHAIN_FWD} 2>/dev/null && echo FWD_OK
echo "=== LEGACY_NAT ==="; iptables -t nat -S PREROUTING 2>/dev/null
echo "=== LEGACY_FWD ==="; iptables -S FORWARD 2>/dev/null
echo "=== LISTEN ==="; ss -Htuln 2>/dev/null
echo "=== FORWARDING ==="; sysctl -n net.ipv4.ip_forward
echo "=== END ==="
"""


def split_sections(out: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    cur = None
    for line in out.splitlines():
        m = re.match(r"^=== (\w+) ===$", line.strip())
        if m:
            cur = m.group(1)
            sections[cur] = []
        elif cur:
            sections[cur].append(line.rstrip())
    return sections


# ── state inspection ──────────────────────────────────────────────────────────────────────────

def _norm(line: str) -> str:
    return " ".join(line.replace('"', "").split())


@dataclass
class ChainState:
    installed: bool
    hooked: bool
    present: set[str] = field(default_factory=set)


def parse_state(sections: dict[str, list[str]]) -> ChainState:
    lines = sections.get("WGM_PRE", []) + sections.get("WGM_POST", []) + sections.get("WGM_FWD", [])
    installed = "MISSING" not in lines and bool(sections.get("WGM_PRE"))
    hooks = sections.get("HOOKS", [])
    hooked = all(h in hooks for h in ("PRE_OK", "POST_OK", "FWD_OK"))
    return ChainState(installed=installed, hooked=hooked,
                      present={_norm(l) for l in lines if l.startswith("-A ")})


def rule_status(expected: dict[str, list[str]], state: ChainState, rule_id: int) -> str:
    """applied | missing | partial — compares the lines generated for a rule with the live chains."""
    tag = f"wgm:{rule_id}"
    mine = [_norm(l) for group in expected.values() for l in group if tag in l]
    if not mine:
        return "n/a"
    if not state.hooked:
        return "missing"
    hits = sum(1 for l in mine if l in state.present)
    if hits == len(mine):
        return "applied"
    return "missing" if hits == 0 else "partial"


def stray_ids(expected: dict[str, list[str]], state: ChainState) -> set[int]:
    """Rule ids found in the live chains that the panel no longer expects (needs re-apply)."""
    want = {_norm(l) for group in expected.values() for l in group}
    out = set()
    for l in state.present:
        if l not in want:
            m = re.search(r"wgm:(\d+)", l)
            if m:
                out.add(int(m.group(1)))
    return out


def parse_listening(lines: list[str]) -> dict[str, set[int]]:
    """Ports with something listening on a non-loopback address (`ss -Htuln`)."""
    out = {"tcp": set(), "udp": set()}
    for line in lines:
        parts = line.split()
        if len(parts) < 5 or parts[0] not in out:
            continue
        local = parts[4]
        addr, _, port = local.rpartition(":")
        if addr.startswith("127.") or addr in ("[::1]", "::1") or "%lo" in addr:
            continue
        if port.isdigit():
            out[parts[0]].add(int(port))
    return out


# ── legacy (fw-manager / v1 panel) rule detection ────────────────────────────────────────────

_DNAT_RE = re.compile(r"--to-destination (\d+\.\d+\.\d+\.\d+)(?::(\d+))?")


def parse_legacy_dnat(lines: list[str]) -> list[dict]:
    """DNAT rules hooked directly in PREROUTING (i.e. not created by this panel)."""
    rules = []
    for line in lines:
        if not line.startswith("-A PREROUTING") or "-j DNAT" not in line:
            continue
        toks = shlex.split(line)
        opts: dict[str, str] = {}
        i = 0
        while i < len(toks):
            if toks[i].startswith("-") and i + 1 < len(toks) and not toks[i + 1].startswith("-"):
                opts[toks[i]] = toks[i + 1]
                i += 2
            else:
                i += 1
        proto = opts.get("-p")
        m = _DNAT_RE.search(line)
        if proto not in ("tcp", "udp") or not m:
            continue
        if "--dport" in opts:
            ports = [opts["--dport"]]
        elif "--dports" in opts:
            ports = opts["--dports"].split(",")
        else:
            continue
        for p in ports:
            if not p.isdigit():
                continue          # ranges (a:b) are left alone
            rules.append({
                "iface": opts.get("-i"),
                "protocol": proto,
                "port": int(p),
                "to_ip": m.group(1),
                "to_port": int(m.group(2)) if m.group(2) else int(p),
                "spec": line,
            })
    return rules


def correlate_legacy(vps_rules: list[dict], host_rules: list[dict], gw_ip: str | None,
                     gw_iface: str | None) -> list[dict]:
    """Join both hops of fw-manager style forwards into panel rules ready to import."""
    used_host = set()
    out = []
    for v in vps_rules:
        item = {"protocol": v["protocol"], "port": v["port"], "vps_spec": [v["spec"]], "host_spec": []}
        if gw_ip and v["to_ip"] == gw_ip:
            match = next((i for i, h in enumerate(host_rules)
                          if i not in used_host and h["protocol"] == v["protocol"] and h["port"] == v["to_port"]
                          and (h["iface"] in (None, gw_iface))), None)
            item["mode"] = "host"
            if match is not None:
                used_host.add(match)
                h = host_rules[match]
                item.update(target_ip=h["to_ip"], target_port=h["to_port"], host_spec=[h["spec"]], status="complete")
            else:
                item.update(target_ip=None, target_port=v["to_port"], status="vps_only")
        else:
            item.update(mode="direct", target_ip=v["to_ip"], target_port=v["to_port"], status="complete")
        out.append(item)
    for i, h in enumerate(host_rules):
        if i in used_host:
            continue
        if h["iface"] not in (None, gw_iface):
            continue
        out.append({"protocol": h["protocol"], "port": h["port"], "mode": "host",
                    "target_ip": h["to_ip"], "target_port": h["to_port"],
                    "vps_spec": [], "host_spec": [h["spec"]], "status": "host_only"})
    return _merge_protocols(out)


def _merge_protocols(items: list[dict]) -> list[dict]:
    merged: dict[tuple, dict] = {}
    order = []
    for it in items:
        key = (it["port"], it["mode"], it["target_ip"], it["target_port"], it["status"])
        if key in merged and merged[key]["protocol"] != it["protocol"]:
            m = merged[key]
            m["protocol"] = "both"
            m["vps_spec"] += it["vps_spec"]
            m["host_spec"] += it["host_spec"]
        elif key in merged:
            # exact duplicate (fw-manager / wg-quick PostUp re-adding the same rule)
            merged[key]["vps_spec"] += it["vps_spec"]
            merged[key]["host_spec"] += it["host_spec"]
        else:
            merged[key] = dict(it)
            order.append(key)
    return [merged[k] for k in order]


def delete_specs_script(specs: list[str]) -> str:
    """Remove exact legacy rules (as printed by `iptables -S`). Only PREROUTING/FORWARD lines."""
    cmds = ["set +e"]
    for spec in specs:
        if not re.match(r"^-A (PREROUTING|FORWARD) ", spec):
            continue
        table = "-t nat " if spec.startswith("-A PREROUTING") else ""
        args = spec.replace("-A ", "-D ", 1)
        cmds.append(f"iptables {table}{args} && echo 'removida: {args}' || echo 'não encontrada: {args}'")
    cmds.append("[ -d /etc/iptables ] && iptables-save > /etc/iptables/rules.v4.wgm-tmp && mv /etc/iptables/rules.v4.wgm-tmp /etc/iptables/rules.v4")
    return "\n".join(cmds) + "\n"


def legacy_forward_specs(fwd_lines: list[str], ip: str, port: int, proto: str) -> list[str]:
    """FORWARD ACCEPT lines that fw-manager created next to a DNAT rule."""
    out = []
    for line in fwd_lines:
        if not line.startswith("-A FORWARD") or "-j ACCEPT" not in line:
            continue
        if f"-d {ip}/32" in line and f"-p {proto}" in line and f"--dport {port} " in line + " ":
            out.append(line)
    return out
