"""Open SSH sessions to a VPS row, pinning its host key on first contact."""
from contextlib import contextmanager
from datetime import datetime

from database import VPS, SessionLocal
from ssh_manager import SSHClient


class VPSConn:
    """Plain snapshot of the fields needed to reach a VPS (safe to use from worker threads)."""

    def __init__(self, v: VPS):
        self.id = v.id
        self.name = v.name
        self.host = v.host
        self.ssh_port = v.ssh_port or 22
        self.ssh_user = v.ssh_user or "root"
        self.ssh_key_path = v.ssh_key_path
        self.ssh_host_key = v.ssh_host_key
        self.wg_interface = v.wg_interface or "wg0"
        self.wg_listen_port = v.wg_listen_port or 51820
        self.wg_public_key = v.wg_public_key
        self.wg_address = v.wg_address
        self.pub_interface = v.pub_interface or "ens3"
        self.gw_ip = v.gw_ip
        self.gw_iface = v.gw_iface or "wg0"
        self.lan_iface = v.lan_iface or "vmbr0"


@contextmanager
def open_ssh(conn: VPSConn, timeout: int = 15):
    client = SSHClient(conn.host, conn.ssh_port, conn.ssh_user, conn.ssh_key_path,
                       host_key=conn.ssh_host_key, timeout=timeout)
    try:
        client.connect()
    except Exception as e:
        _record(conn.id, error=str(e) or e.__class__.__name__)
        raise
    try:
        yield client
    finally:
        client.close()
    _record(conn.id, host_key=None if conn.ssh_host_key else client.host_key)


def _record(vps_id: int, error: str | None = None, host_key: str | None = None):
    db = SessionLocal()
    try:
        row = db.get(VPS, vps_id)
        if not row:
            return
        if error:
            row.last_error = error[:500]
        else:
            row.last_error = None
            row.last_seen = datetime.utcnow()
            if host_key and not row.ssh_host_key:
                row.ssh_host_key = host_key
        db.commit()
    finally:
        db.close()
