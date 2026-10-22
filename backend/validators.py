"""Strict input validation. Every value that ends up in a shell command passes through here."""
import ipaddress
import re

from fastapi import HTTPException

_IFACE_RE = re.compile(r"^[a-zA-Z0-9_.\-]{1,15}$")
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$")
_USER_RE = re.compile(r"^[a-z_][a-z0-9_\-]{0,31}$")
_WG_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$")
_HOSTNAME_URL_RE = re.compile(r"^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$")
_SERVICE_RE = re.compile(r"^(https?|tcp|udp|ssh|rdp|unix|http_status):[A-Za-z0-9.\-_:/\[\]]{1,200}$")

PROTOCOLS = ("tcp", "udp", "both")


def bad(msg: str):
    raise HTTPException(status_code=422, detail=msg)


def ipv4(value: str, field: str = "IP") -> str:
    try:
        return str(ipaddress.IPv4Address((value or "").strip()))
    except ValueError:
        bad(f"{field} inválido: {value!r}")


def cidr(value: str, field: str = "Endereço") -> str:
    try:
        return str(ipaddress.IPv4Interface((value or "").strip()))
    except ValueError:
        bad(f"{field} inválido: {value!r}")


def port(value, field: str = "Porta") -> int:
    try:
        p = int(value)
    except (TypeError, ValueError):
        bad(f"{field} inválida: {value!r}")
    if not 1 <= p <= 65535:
        bad(f"{field} fora do intervalo 1–65535: {p}")
    return p


def protocol(value: str) -> str:
    v = (value or "").lower().strip()
    if v not in PROTOCOLS:
        bad(f"Protocolo inválido: {value!r}")
    return v


def protos(value: str) -> list[str]:
    return ["tcp", "udp"] if value == "both" else [value]


def iface(value: str, field: str = "Interface") -> str:
    v = (value or "").strip()
    if not _IFACE_RE.match(v):
        bad(f"{field} inválida: {value!r}")
    return v


def host(value: str) -> str:
    v = (value or "").strip()
    try:
        return str(ipaddress.ip_address(v))
    except ValueError:
        pass
    if not _HOST_RE.match(v):
        bad(f"Host inválido: {value!r}")
    return v


def ssh_user(value: str) -> str:
    v = (value or "").strip()
    if not _USER_RE.match(v):
        bad(f"Usuário SSH inválido: {value!r}")
    return v


def wg_key(value: str) -> str:
    v = (value or "").strip()
    if not _WG_KEY_RE.match(v):
        bad("Chave WireGuard inválida")
    return v


def public_hostname(value: str) -> str:
    v = (value or "").strip().lower()
    if not _HOSTNAME_URL_RE.match(v):
        bad(f"Hostname público inválido: {value!r}")
    return v


def tunnel_service(value: str) -> str:
    v = (value or "").strip()
    if not _SERVICE_RE.match(v):
        bad(f"Serviço inválido (ex: http://localhost:8080): {value!r}")
    return v


def text(value: str | None, max_len: int = 120) -> str:
    v = (value or "").strip()
    if len(v) > max_len:
        bad(f"Texto muito longo (máx. {max_len})")
    # descriptions are only stored and shown; strip control characters anyway
    return re.sub(r"[\x00-\x1f\x7f]", "", v)
