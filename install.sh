#!/bin/bash
# WG Manager — installer / updater for the Proxmox host. Safe to run again to upgrade.
set -euo pipefail

INSTALL_DIR="/opt/wg-proxy-manager"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" = "0" ] || { echo "Execute como root."; exit 1; }
command -v pvesh >/dev/null || echo "!! pvesh não encontrado — o painel foi feito para rodar no host Proxmox."

echo "==> Dependências do sistema"
apt-get update -qq
apt-get install -y -qq python3 python3-venv nodejs npm wireguard-tools iptables >/dev/null

echo "==> Copiando arquivos para $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
  # never overwrite runtime state (database, keys, .env)
  tar -C "$SRC_DIR" --exclude=.git --exclude=node_modules --exclude=frontend/dist \
      --exclude=data.db --exclude=keys --exclude=.env --exclude=.secret_key --exclude=venv -cf - . \
    | tar -C "$INSTALL_DIR" -xf -
fi
cd "$INSTALL_DIR"

if [ -f data.db ]; then
  cp -p data.db "data.db.bak-$(date +%Y%m%d%H%M%S)"
  echo "==> Backup do banco criado"
fi

echo "==> Ambiente Python"
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -q -r requirements.txt

echo "==> Build do frontend"
(cd frontend && npm ci --silent --no-audit --no-fund && npm run build --silent)

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$(openssl rand -hex 32)/" .env
  echo "==> .env criado com SECRET_KEY aleatória"
fi
mkdir -p keys
chmod 700 keys
chmod 600 .env
[ -f data.db ] && chmod 600 data.db*

cat > /etc/systemd/system/wg-proxy-manager.service <<EOF
[Unit]
Description=WG Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/python main.py
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable wg-proxy-manager >/dev/null
systemctl restart wg-proxy-manager

PORT=$(grep -E '^PANEL_PORT=' .env | cut -d= -f2 || true)
HOST=$(grep -E '^PANEL_HOST=' .env | cut -d= -f2 || true)
echo ""
echo "✓ WG Manager instalado"
echo "  Acesse: http://${HOST:-$(hostname -I | awk '{print $1}')}:${PORT:-8765}"
echo "  Login: conta do Proxmox com privilégio Sys.Modify (ex.: root@pam)"
if [ "${HOST:-0.0.0.0}" = "0.0.0.0" ]; then
  echo "  Dica: defina PANEL_HOST no .env (ex.: o IP do Tailscale) para não expor o painel em todas as interfaces."
fi
