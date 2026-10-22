"""Run with: python -m pytest backend/tests  (fixtures are real `iptables -S` output from production)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import firewall as fw  # noqa: E402
import wireguard as wg  # noqa: E402

VPS_NAT = """-P PREROUTING ACCEPT
-A PREROUTING -p udp -m udp --dport 8010 -j DNAT --to-destination 10.10.0.3:8010
-A PREROUTING -i ens3 -p tcp -m tcp --dport 1883 -j DNAT --to-destination 10.10.0.3:1883
-A PREROUTING -i ens3 -p udp -m udp --dport 1883 -j DNAT --to-destination 10.10.0.3:1883
-A PREROUTING -i ens3 -p udp -m udp --dport 7777 -j DNAT --to-destination 10.10.0.4:7777
-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER
-A PREROUTING -i ens3 -p udp -m multiport --dports 8010,8011 -j DNAT --to-destination 10.10.0.3
-A PREROUTING -i ens3 -p tcp -m tcp --dport 443 -j DNAT --to-destination 10.10.0.2:443
-A PREROUTING -i ens3 -p tcp -m tcp --dport 9999 -j DNAT --to-destination 10.10.0.2:9999""".splitlines()

HOST_NAT = """-A PREROUTING -p tcp -m tcp --dport 8084 -j DNAT --to-destination 192.168.1.107:8084
-A PREROUTING -i wg0 -p tcp -m tcp --dport 7778 -j DNAT --to-destination 192.168.1.141:7778
-A PREROUTING -i wg0 -p udp -m udp --dport 7778 -j DNAT --to-destination 192.168.1.141:7778
-A PREROUTING -i wg0 -p tcp -m tcp --dport 443 -j DNAT --to-destination 192.168.1.138:443
-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER""".splitlines()


def test_parse_legacy_handles_multiport_and_missing_port():
    rules = fw.parse_legacy_dnat(VPS_NAT)
    ports = [(r["protocol"], r["port"], r["to_ip"], r["to_port"]) for r in rules]
    assert ("udp", 8010, "10.10.0.3", 8010) in ports
    assert ("udp", 8011, "10.10.0.3", 8011) in ports      # multiport without explicit port
    assert all("DOCKER" not in r["spec"] for r in rules)


def test_correlate_joins_both_hops():
    vps = fw.parse_legacy_dnat(VPS_NAT)
    host = fw.parse_legacy_dnat(HOST_NAT)
    items = fw.correlate_legacy(vps, host, "10.10.0.2", "wg0")
    by = {(i["port"], i["protocol"], i["status"]): i for i in items}
    https = by[(443, "tcp", "complete")]
    assert https["mode"] == "host" and https["target_ip"] == "192.168.1.138"
    assert len(https["vps_spec"]) == 1 and len(https["host_spec"]) == 1
    assert by[(9999, "tcp", "vps_only")]["target_ip"] is None
    assert by[(7778, "both", "host_only")]["target_ip"] == "192.168.1.141"   # tcp+udp merged
    assert by[(1883, "both", "complete")]["mode"] == "direct"
    assert by[(8084, "tcp", "host_only")]                                   # rule without -i wg0


def test_generated_lines_and_status():
    rules = [fw.Rule(1, 443, "tcp", "host", "192.168.1.138", 443), fw.Rule(2, 1883, "both", "direct", "10.10.0.3", 1883),
             fw.Rule(3, 25, "tcp", "host", "192.168.1.5", 25, enabled=False)]
    lines = fw.vps_lines(rules, fw.VPSNet("ens3", "wg0", "10.10.0.2"))
    assert '-A WGM-PRE -i ens3 -p tcp -m tcp --dport 443 -m comment --comment "wgm:1" -j DNAT --to-destination 10.10.0.2:443' in lines["nat_pre"]
    assert len(lines["nat_pre"]) == 3          # disabled rule skipped, both → 2 lines
    # iptables-nft prints comments without quotes — status must still match
    live = [l.replace('"', "") for g in lines.values() for l in g]
    st = fw.ChainState(installed=True, hooked=True, present={fw._norm(l) for l in live})
    assert fw.rule_status(lines, st, 1) == "applied"
    st.present.discard(fw._norm(lines["nat_pre"][0]))
    assert fw.rule_status(lines, st, 1) == "partial"
    assert fw.stray_ids(lines, fw.ChainState(True, True, {fw._norm('-A WGM-PRE -p tcp -m comment --comment "wgm:9" -j ACCEPT')})) == {9}


def test_apply_script_is_atomic_restore():
    s = fw.apply_script(fw.host_lines([(fw.Rule(1, 80, "tcp", "host", "192.168.1.138", 8080), fw.HostNet("wg0", "vmbr0"))]))
    assert "iptables-restore --noflush" in s and ":WGM-PRE - [0:0]" in s
    assert "--to-destination 192.168.1.138:8080" in s
    assert "rules.v4.wgm-original" in s


def test_cleanup_only_touches_prerouting_and_forward():
    s = fw.delete_specs_script(["-A PREROUTING -i wg0 -p tcp -m tcp --dport 1 -j DNAT --to-destination 1.2.3.4:1",
                                "-A INPUT -j ACCEPT", "-P FORWARD ACCEPT"])
    assert "iptables -t nat -D PREROUTING" in s
    assert "INPUT" not in s and "-P FORWARD" not in s


def test_listening_ignores_loopback():
    out = fw.parse_listening(["tcp LISTEN 0 511 0.0.0.0:443 0.0.0.0:*", "tcp LISTEN 0 4096 127.0.0.1:8765 0.0.0.0:*",
                              "udp UNCONN 0 0 [::]:51820 [::]:*"])
    assert out == {"tcp": {443}, "udp": {51820}}


def test_address_allocation_respects_live_peers():
    # 10.10.0.2 is the Proxmox host; .3/.4 are containers; one peer has no allowed-ips
    used = ["10.10.0.2/32", "10.10.0.3/32", "", "10.10.0.4/32", "10.10.0.10/32"]
    assert wg.find_free_wg_address(used, "10.10.0.1/24") == "10.10.0.5/24"


def test_pick_subnet_avoids_routed_networks():
    taken = ["10.10.0.0/24", "192.168.1.0/24", "172.17.0.0/16", "100.94.93.106/32", "10.0.1.0/24"]
    assert wg.pick_subnet(taken) == "10.20.0.0/24"
    assert wg.pick_subnet(taken + ["10.20.0.0/24"]) == "10.30.0.0/24"
    try:
        wg.pick_subnet(["10.0.0.0/8"])
        assert False
    except ValueError:
        pass


def test_connect_scripts_render():
    key = "+xGIL5bkLlqowO8csYVyN6PMaF0zl+lZUwDmM/DSYR8="
    s = wg.VPS_CONNECT_HOST.format(iface="wg0", new_address="", host_ip="10.20.0.2", host_pub=key, port=51820)
    assert "--dport 51820" in s and "AllowedIPs = 10.20.0.2/32" in s and '{for(i=2' in s
    c = wg.HOST_WG_CONF.format(vps_name="Ampere", vps_host="163.176.88.170", privkey="x", host_ip="10.20.0.2",
                               prefix="24", vps_pub=key, vps_port=51820, network="10.20.0.0/24")
    assert "Endpoint = 163.176.88.170:51820" in c and "Address = 10.20.0.2/24" in c
    inst = wg.VPS_WG_SETUP.format(iface="wg0", privkey="x", address="10.30.0.1/24", port=51820)
    assert "-I INPUT 1 -p udp --dport 51820 -j ACCEPT" in inst


def test_caddyfile_generation():
    import caddy
    specs = [caddy.SiteSpec("b.example.com", "http", "192.168.1.5", 80),
             caddy.SiteSpec("a.example.com", "https", "192.168.1.6", 8443),
             caddy.SiteSpec("plain.example.com", "http", "192.168.1.7", 8080, tls=False),
             caddy.SiteSpec("off.example.com", "http", "192.168.1.8", 80, enabled=False)]
    cfg = caddy.caddyfile(specs, "me@example.com")
    assert "email me@example.com" in cfg
    assert cfg.index("a.example.com {") < cfg.index("b.example.com {")      # stable order
    assert "reverse_proxy https://192.168.1.6:8443 {" in cfg and "tls_insecure_skip_verify" in cfg
    assert "http://plain.example.com {" in cfg
    assert "off.example.com" not in cfg
    assert ":80 {" in caddy.caddyfile([], None)                               # placeholder when empty
    assert "{config}" not in caddy.APPLY.format(config=cfg)
