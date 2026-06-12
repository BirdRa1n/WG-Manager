# WG Manager

Painel web completo para gerenciamento de infraestrutura WireGuard integrado ao Proxmox. Permite configurar VPNs, containers LXC, regras de redirecionamento de portas e túneis Cloudflare Zero Trust — tudo por uma interface moderna, sem precisar de SSH manual.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Arquitetura](#arquitetura)
- [Autenticação](#autenticação)
- [Módulos](#módulos)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Segurança](#segurança)
- [Versionamento](#versionamento)

---

## Visão Geral

O WG Manager substitui o processo manual de SSH + iptables para gerenciar redes WireGuard entre VPS Oracle e containers LXC no Proxmox. Toda a configuração é feita pelo painel web, com logs em tempo real via Server-Sent Events (SSE).

```
Internet → VPS Oracle (WireGuard) → LXC Containers (Proxmox)
                                  ↕
                         Cloudflare Zero Trust
```

---

## Funcionalidades

- **Dashboard** com resumo de tráfego, gráficos de uso por peer e alertas
- **Gerenciamento de VPS** — adicionar servidores, instalar/detectar WireGuard, monitorar peers
- **Containers LXC** — importar do Proxmox, verificar permissões, instalar WireGuard como cliente
- **Regras de Porta** — criar, editar e sincronizar regras DNAT via iptables (split tunnel / full tunnel / DNAT simples)
- **Cloudflare Zero Trust** — criar túneis, adicionar rotas públicas, instalar `cloudflared` no container
- **Credenciais de API** — armazenar e verificar tokens do Cloudflare com validação de permissões
- **Logs em Tempo Real** — terminal flutuante com stream SSE de todas as operações
- **Verificação de Atualizações** — checagem automática via GitHub Releases (a cada 1 hora)

---

## Tecnologias

### Backend
| Pacote | Versão | Uso |
|---|---|---|
| FastAPI | 0.115.0 | Framework HTTP |
| Uvicorn | 0.32.0 | Servidor ASGI |
| SQLAlchemy | 2.0.36 | ORM / SQLite |
| Paramiko | 3.5.0 | Conexões SSH |
| Python-JOSE | — | Tokens JWT |
| HTTPX | 0.27.2 | Chamadas Cloudflare API |

### Frontend
| Pacote | Versão | Uso |
|---|---|---|
| React | 18.3.1 | UI |
| TypeScript | 5.4.5 | Tipagem estática |
| React Router | 6.24.0 | Roteamento SPA |
| Vite | 5.3.1 | Build / Dev server |
| Recharts | — | Gráficos de tráfego |
| Lucide React | 0.395.0 | Ícones |

---

## Instalação

### Pré-requisitos

- Proxmox VE 7+ (host onde o painel será executado)
- Python 3.10+
- Node.js 18+
- Acesso root no host Proxmox

### Instalação Automática

```bash
git clone https://github.com/BirdRa1n/WG-Manager.git /opt/wg-proxy-manager
cd /opt/wg-proxy-manager
chmod +x install.sh
./install.sh
```

O script realiza automaticamente:

1. Instala dependências do sistema (`python3`, `nodejs`, `wireguard-tools`, `iptables`)
2. Cria virtualenv Python e instala `requirements.txt`
3. Faz build do frontend React (`npm install && npm run build`)
4. Gera `SECRET_KEY` aleatória se não existir no `.env`
5. Cria e ativa serviço `systemd` (`wg-proxy-manager.service`)

### Instalação Manual

```bash
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r ../requirements.txt

# Frontend
cd ../frontend
npm install
npm run build

# Iniciar
cd ..
python3 backend/main.py
```

### Verificar Status

```bash
systemctl status wg-proxy-manager
journalctl -u wg-proxy-manager -f
```

O painel estará disponível em: `http://<IP_DO_PROXMOX>:8765`

---

## Configuração

Copie o arquivo de exemplo e ajuste conforme necessário:

```bash
cp .env.example .env
```

```env
PANEL_PORT=8765
SECRET_KEY=<gerado automaticamente pelo install.sh>
PROXMOX_HOST=localhost
PROXMOX_VERIFY_SSL=false
SSH_KEYS_DIR=/opt/wg-proxy-manager/keys
DB_PATH=/opt/wg-proxy-manager/data.db
```

> O arquivo `.env` **nunca** deve ser commitado. Ele já está no `.gitignore`.

---

## Estrutura do Projeto

```
wg-proxy-manager/
├── backend/
│   ├── main.py                  # Ponto de entrada FastAPI
│   ├── auth.py                  # Autenticação Proxmox + JWT
│   ├── database.py              # Modelos SQLAlchemy e sessão
│   ├── logger.py                # Sistema de log assíncrono (SSE)
│   ├── ssh_manager.py           # Cliente SSH via Paramiko
│   ├── wireguard.py             # Scripts de instalação WireGuard
│   ├── cloudflare.py            # Cliente Cloudflare API
│   ├── proxmox_client.py        # Cliente Proxmox REST API
│   └── routers/
│       ├── vps.py               # CRUD VPS + instalação WireGuard
│       ├── lxc.py               # CRUD LXC + permissões + WG client
│       ├── ports.py             # Regras de porta (iptables DNAT)
│       ├── tunnels.py           # Cloudflare Zero Trust tunnels
│       ├── credentials.py       # Credenciais de API
│       ├── events.py            # Stream SSE de logs
│       └── stats.py             # Coleta de tráfego WireGuard
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Router principal e layout
│   │   ├── theme.ts             # Design tokens / paleta de cores
│   │   ├── api/client.ts        # Wrapper fetch tipado para a API
│   │   ├── hooks/
│   │   │   └── useUpdateCheck.ts  # Verificador de versão (GitHub)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── VPSPage.tsx
│   │   │   ├── LXCPage.tsx
│   │   │   ├── PortRules.tsx
│   │   │   ├── SimpleForwarding.tsx
│   │   │   ├── CloudflareTunnels.tsx
│   │   │   ├── CredentialsPage.tsx
│   │   │   └── LogsPage.tsx
│   │   └── components/
│   │       ├── Sidebar.tsx
│   │       ├── LogTerminal.tsx
│   │       └── StatusBadge.tsx
│   ├── package.json
│   └── vite.config.ts
├── version.json                 # Versão atual da aplicação
├── requirements.txt
├── install.sh
├── .env.example
└── .gitignore
```

---

## Arquitetura

### Banco de Dados (SQLite)

#### VPS
| Campo | Tipo | Descrição |
|---|---|---|
| `id` | int | Chave primária |
| `name` | string | Nome do servidor |
| `host` | string | IP ou hostname |
| `ssh_port` | int | Porta SSH |
| `ssh_user` | string | Usuário SSH |
| `ssh_key_path` | string | Caminho da chave no filesystem |
| `wg_public_key` | string | Chave pública WireGuard |
| `wg_address` | string | IP do peer (ex: `10.10.0.1/24`) |
| `wg_listen_port` | int | Porta de escuta WireGuard |
| `status` | string | `pending` / `connected` / `wg_ready` |

#### LXC
| Campo | Tipo | Descrição |
|---|---|---|
| `id` | int | Chave primária |
| `vmid` | int | ID do container no Proxmox |
| `name` | string | Nome do container |
| `wg_address` | string | IP do peer (ex: `10.10.0.2/24`) |
| `wg_vps_id` | int | VPS associada (FK) |
| `status` | string | `imported` / `ready` / `wg_ready` |

#### PortRule
| Campo | Tipo | Descrição |
|---|---|---|
| `port` | int | Porta pública exposta |
| `protocol` | string | `tcp` / `udp` / `both` |
| `mode` | string | `split_tunnel` / `full_tunnel` / `simple_dnat` |
| `target_ip` | string | IP de destino interno |
| `target_port` | int | Porta de destino interna |
| `enabled` | bool | Regra ativa ou não |

#### CloudflareTunnel / CloudflareRoute
Armazena token do túnel, ID da conta e as rotas públicas (`hostname → serviço interno`).

---

## Autenticação

O login é feito com as credenciais do **Proxmox** (ex: `root@pam`). O backend valida contra a API do Proxmox em `https://localhost:8006`. Após autenticação bem-sucedida, é emitido um **JWT** com validade de 8 horas.

Para o stream SSE, onde o browser não suporta headers customizados, o token é aceito via query string: `GET /api/events/stream?token=<jwt>`.

---

## Módulos

### Regras de Porta — Modos de Operação

| Modo | AllowedIPs na LXC | Caso de Uso |
|---|---|---|
| `split_tunnel` | `10.10.0.0/24` | Apenas tráfego VPN roteado pelo túnel |
| `full_tunnel` | `0.0.0.0/0` | Todo tráfego da LXC pelo túnel |
| `simple_dnat` | — | DNAT direto sem WireGuard na LXC |

As regras são aplicadas via `iptables PREROUTING DNAT` + `FORWARD` e persistidas em `/etc/iptables/rules.v4`.

A página **Redirecionamento Simples** permite comparar as regras no banco com as regras ativas no VPS e importar ou reaplicar divergências.

### Cloudflare Zero Trust

**Modo API (recomendado):**
1. Credencial Cloudflare salva na aba Credenciais (Account ID + API Token)
2. Painel cria o túnel via `POST /accounts/{id}/cfd_tunnel`
3. Instala `cloudflared` no container automaticamente
4. Rotas criam CNAMEs via DNS API automaticamente

**Modo Token Manual:**
1. Túnel criado no dashboard Cloudflare
2. Token colado no painel
3. Rotas adicionadas localmente via `config.yml`

### Logs em Tempo Real

Toda operação SSH, instalação ou chamada de API emite eventos em tempo real via SSE. O terminal flutuante na base do painel exibe essas mensagens com código de cor:

| Nível | Cor |
|---|---|
| `info` | Branco |
| `warn` | Amarelo |
| `error` | Vermelho |
| `success` | Verde |

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PANEL_PORT` | `8765` | Porta do painel web |
| `SECRET_KEY` | — | Chave de assinatura JWT (obrigatório) |
| `PROXMOX_HOST` | `localhost` | Host da API do Proxmox |
| `PROXMOX_VERIFY_SSL` | `false` | Verificar certificado SSL do Proxmox |
| `SSH_KEYS_DIR` | `/opt/wg-proxy-manager/keys` | Diretório das chaves SSH dos VPS |
| `DB_PATH` | `/opt/wg-proxy-manager/data.db` | Caminho do banco SQLite |

---

## Segurança

- Credenciais de acesso ao painel são as do Proxmox — nenhum banco de usuários local
- Chaves SSH armazenadas com permissão `0o600`, nunca expostas via API
- `SECRET_KEY` gerada com `openssl rand -hex 32` durante a instalação
- Tokens Cloudflare exibem apenas os últimos 8 caracteres na interface
- Banco de dados e chaves SSH excluídos do controle de versão via `.gitignore`
- CORS aberto por padrão (`allow_origins=["*"]`) — assumido rede confiável (LAN Proxmox)

---

## Versionamento

A versão atual da aplicação é definida em `version.json` na raiz do projeto:

```json
{ "version": "1.0.0" }
```

O painel consulta automaticamente a [página de releases](https://github.com/BirdRa1n/WG-Manager/releases) do GitHub ao carregar e a cada 1 hora. Quando há nova versão disponível, um banner aparece na sidebar com link direto para o release. O botão de atualização na sidebar permite verificar manualmente a qualquer momento.

---

## Licença

Distribuído sob a licença incluída no arquivo [LICENSE](LICENSE).
