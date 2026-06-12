#!/bin/bash
set -e

INSTALL_DIR="/opt/wg-proxy-manager"
SERVICE_USER="root"

echo "==> Installing WG Proxy Manager..."

# Dependencies
apt-get update -qq
apt-get install -y python3 python3-pip python3-venv nodejs npm wireguard-tools 2>&1 | tail -5

# Copy files
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR"

# Python venv
python3 -m venv venv
venv/bin/pip install -q -r requirements.txt

# Build frontend
cd frontend
npm install --silent
npm run build
cd ..

# Generate .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32)
  sed -i "s/change-me-generate-with-openssl-rand-hex-32/$SECRET/" .env
  echo "==> Generated .env with random SECRET_KEY"
fi

mkdir -p keys data

# Systemd service
cat > /etc/systemd/system/wg-proxy-manager.service << EOF
[Unit]
Description=WG Proxy Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/python main.py
Restart=always
RestartSec=5
User=$SERVICE_USER

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now wg-proxy-manager

PORT=$(grep PANEL_PORT "$INSTALL_DIR/.env" | cut -d= -f2)
echo ""
echo "✓ WG Proxy Manager instalado!"
echo "  Acesse: http://$(hostname -I | awk '{print $1}'):${PORT:-8765}"
echo "  Login: usuário e senha do Proxmox (ex: root@pam)"
