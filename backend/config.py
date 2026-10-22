"""Central configuration. Everything that comes from the environment lives here."""
import os
import secrets
import stat

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


PANEL_HOST = _env("PANEL_HOST", "0.0.0.0")
PANEL_PORT = int(_env("PANEL_PORT", "8765"))

DATA_DIR = _env("DATA_DIR", BASE_DIR)
DB_PATH = _env("DB_PATH", os.path.join(DATA_DIR, "data.db"))
SSH_KEYS_DIR = _env("SSH_KEYS_DIR", os.path.join(DATA_DIR, "keys"))

PROXMOX_HOST = _env("PROXMOX_HOST", "localhost")
PROXMOX_VERIFY_SSL = _env("PROXMOX_VERIFY_SSL", "false").lower() == "true"
# Proxmox privilege required to use the panel (the panel runs as root, so only admins may log in)
REQUIRED_PRIVILEGE = _env("REQUIRED_PRIVILEGE", "Sys.Modify")

TOKEN_EXPIRE_HOURS = int(_env("TOKEN_EXPIRE_HOURS", "8"))
COOKIE_SECURE = _env("COOKIE_SECURE", "false").lower() == "true"

# Development only: accept any login without Proxmox. Never enable in production.
DEV_AUTH = _env("WGM_DEV_AUTH", "") == "1"

_INSECURE_DEFAULTS = {"", "change-me-in-production", "change-me-generate-with-openssl-rand-hex-32"}


def _load_secret_key() -> str:
    key = _env("SECRET_KEY")
    if key not in _INSECURE_DEFAULTS:
        return key
    # No usable key in the environment: persist a random one next to the database.
    path = os.path.join(DATA_DIR, ".secret_key")
    if os.path.exists(path):
        with open(path) as f:
            stored = f.read().strip()
        if stored:
            return stored
    key = secrets.token_hex(32)
    os.makedirs(DATA_DIR, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


SECRET_KEY = _load_secret_key()


def harden_permissions():
    """The DB holds WireGuard private keys and API tokens — keep it root-only."""
    os.makedirs(SSH_KEYS_DIR, exist_ok=True)
    os.chmod(SSH_KEYS_DIR, 0o700)
    for path in (DB_PATH, os.path.join(BASE_DIR, ".env")):
        if os.path.exists(path):
            mode = stat.S_IMODE(os.stat(path).st_mode)
            if mode & 0o077:
                os.chmod(path, 0o600)
