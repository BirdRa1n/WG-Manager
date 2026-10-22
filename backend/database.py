import os
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, create_engine, inspect, text
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from config import DB_PATH

os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class VPS(Base):
    __tablename__ = "vps"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    ssh_port = Column(Integer, default=22)
    ssh_user = Column(String, default="root")
    ssh_key_path = Column(String)
    ssh_host_key = Column(String)            # pinned on first connection (TOFU)
    wg_public_key = Column(String)
    wg_private_key = Column(String)
    wg_address = Column(String)
    wg_listen_port = Column(Integer, default=51820)
    wg_interface = Column(String, default="wg0")
    pub_interface = Column(String, default="ens3")
    # Gateway hop: the Proxmox host's side of this VPS tunnel
    gw_ip = Column(String)                   # e.g. 10.10.0.2 (Proxmox host address on wg)
    gw_iface = Column(String)                # local WireGuard interface on the Proxmox host
    lan_iface = Column(String, default="vmbr0")
    status = Column(String, default="pending")
    last_error = Column(Text)
    last_seen = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    port_rules = relationship("PortRule", back_populates="vps", cascade="all, delete")


class LXC(Base):
    __tablename__ = "lxc"
    id = Column(Integer, primary_key=True)
    vmid = Column(Integer, nullable=False)
    name = Column(String)
    proxmox_node = Column(String, default="pve")
    wg_public_key = Column(String)
    wg_private_key = Column(String)
    wg_address = Column(String)
    wg_vps_id = Column(Integer, ForeignKey("vps.id"), nullable=True)
    os_type = Column(String)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    port_rules = relationship("PortRule", back_populates="lxc")
    cf_tunnels = relationship("CloudflareTunnel", back_populates="lxc")


class PortRule(Base):
    """A public port on a VPS forwarded to a service.

    mode="direct": VPS DNAT → target_ip (a WireGuard peer, e.g. a container running WG itself)
    mode="host":   VPS DNAT → Proxmox host (vps.gw_ip) → host DNAT → target_ip on the LAN
    """
    __tablename__ = "port_rules"
    id = Column(Integer, primary_key=True)
    vps_id = Column(Integer, ForeignKey("vps.id"), nullable=True)
    lxc_id = Column(Integer, ForeignKey("lxc.id"), nullable=True)
    vmid = Column(Integer, nullable=True)     # Proxmox guest the target belongs to (informational)
    port = Column(Integer, nullable=False)
    protocol = Column(String, default="tcp")
    mode = Column(String, default="host")
    target_ip = Column(String, nullable=True)
    target_port = Column(Integer, nullable=True)
    description = Column(String)
    enabled = Column(Boolean, default=True)
    source = Column(String, default="panel")  # panel | imported
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    vps = relationship("VPS", back_populates="port_rules")
    lxc = relationship("LXC", back_populates="port_rules")


class CloudflareTunnel(Base):
    __tablename__ = "cf_tunnels"
    id = Column(Integer, primary_key=True)
    lxc_id = Column(Integer, ForeignKey("lxc.id"), nullable=True)
    name = Column(String, nullable=False)
    tunnel_id = Column(String)
    token = Column(Text)
    account_id = Column(String, nullable=False)
    api_token = Column(String, nullable=False)
    cred_id = Column(Integer, ForeignKey("api_credentials.id"), nullable=True)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    lxc = relationship("LXC", back_populates="cf_tunnels")
    routes = relationship("CloudflareRoute", back_populates="tunnel", cascade="all, delete")


class CloudflareRoute(Base):
    __tablename__ = "cf_routes"
    id = Column(Integer, primary_key=True)
    tunnel_id = Column(Integer, ForeignKey("cf_tunnels.id"), nullable=False)
    public_url = Column(String, nullable=False)
    service = Column(String, nullable=False)
    description = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    tunnel = relationship("CloudflareTunnel", back_populates="routes")


class APICredential(Base):
    __tablename__ = "api_credentials"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    provider = Column(String, nullable=False)
    account_id = Column(String)
    api_token = Column(Text, nullable=False)
    permissions = Column(Text, default="")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Log(Base):
    __tablename__ = "logs"
    id = Column(Integer, primary_key=True)
    operation = Column(String)
    level = Column(String, default="info")
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def _migrate():
    """create_all() never adds columns to existing tables; do it by hand for upgrades from v1."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl_type = col.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl_type}'))
        # v1 modes (split_tunnel / full_tunnel / simple_dnat) were all a plain VPS DNAT
        conn.execute(text("UPDATE port_rules SET mode='direct' WHERE mode IS NULL OR mode NOT IN ('direct','host')"))
        conn.execute(text("UPDATE port_rules SET source='panel' WHERE source IS NULL"))


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate()
