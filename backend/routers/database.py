import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_PATH = os.getenv("DB_PATH", "/opt/wg-proxy-manager/data.db")
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
    wg_public_key = Column(String)
    wg_private_key = Column(String)
    wg_address = Column(String)
    wg_listen_port = Column(Integer, default=51820)
    wg_interface = Column(String, default="wg0")
    pub_interface = Column(String, default="ens3")
    status = Column(String, default="pending")
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
    __tablename__ = "port_rules"
    id = Column(Integer, primary_key=True)
    vps_id = Column(Integer, ForeignKey("vps.id"), nullable=True)
    lxc_id = Column(Integer, ForeignKey("lxc.id"), nullable=True)
    port = Column(Integer, nullable=False)
    protocol = Column(String, default="tcp")
    mode = Column(String, default="split_tunnel")
    target_ip = Column(String, nullable=True)
    target_port = Column(Integer, nullable=True)
    description = Column(String)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
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
    name = Column(String, nullable=False)          # ex: "Cloudflare BirdRa1n"
    provider = Column(String, nullable=False)       # "cloudflare"
    account_id = Column(String)                    # CF account ID
    api_token = Column(Text, nullable=False)
    permissions = Column(Text, default="")         # comma-separated list
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Log(Base):
    __tablename__ = "logs"
    id = Column(Integer, primary_key=True)
    operation = Column(String)
    level = Column(String, default="info")
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
