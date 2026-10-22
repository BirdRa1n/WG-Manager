# WG Manager

Painel web para expor serviços do seu Proxmox na internet através de uma VPS pública e um túnel WireGuard, sem precisar de SSH nem de `iptables` à mão. Substitui os scripts `fw-manager` da VPS e do host.

```
Internet ──▶ VPS :443 ──DNAT──▶ wg0 ──▶ Host Proxmox 10.10.0.2 ──DNAT──▶ 192.168.1.138:443 (LXC/VM)
                         └─────DNAT──▶ peer WireGuard 10.10.0.3 (container com túnel próprio)
```

## Funcionalidades

- **Encaminhamentos**: escolha uma porta pública da VPS e o container ou VM de destino, que vem da lista do Proxmox com os IPs atuais. São dois modos:
  - **via host Proxmox** (recomendado): a VPS envia ao host e o host entrega na LAN. Funciona com qualquer LXC ou VM, sem instalar nada neles.
  - **direto**: a VPS entrega no IP WireGuard de um container que roda o próprio túnel.
- **Importação do fw-manager**: lê as regras DNAT existentes na VPS e no host, junta os dois saltos e importa. Depois, se você quiser, limpa as linhas antigas.
- **Estado ao vivo**: em cada regra, mostra se ela está aplicada na VPS e no host, avisa quando a porta já está em uso na VPS e aponta divergências.
- **Servidores**: detecta o WireGuard e o gateway, lista os peers com handshake e tráfego, destaca peers órfãos (sem AllowedIPs) e permite removê-los.
- **Containers e VMs**: lista tudo do cluster via `pvesh`. O modo opcional "WireGuard dentro do container" aloca o IP consultando os peers reais da VPS.
- **Cloudflare Zero Trust**: cria túneis, rotas e CNAMEs e instala o `cloudflared` no container.
- **Dashboard**: topologia, alertas acionáveis, tráfego WireGuard e atividade em tempo real (SSE).
- Tema claro e escuro, layout responsivo.

## Como as regras são aplicadas

Tudo o que o painel cria fica em cadeias próprias: `WGM-PRE` e `WGM-POST` (nat) e `WGM-FWD` (filter). Elas ficam ligadas no topo de PREROUTING, POSTROUTING e FORWARD.

A cada mudança, o painel reconstrói essas cadeias a partir do banco com `iptables-restore --noflush`, de forma atômica e idempotente. Assim, editar, desativar ou remover nunca deixa regra duplicada ou fantasma. Regras do fw-manager, do Docker e do Tailscale não são tocadas. Depois de aplicar, o painel persiste em `/etc/iptables/rules.v4`, com backup do original em `rules.v4.wgm-original`.

## Instalação / atualização (no host Proxmox, como root)

```bash
git clone https://github.com/BirdRa1n/WG-Manager.git
cd WG-Manager
./install.sh
```

O instalador:
- copia os arquivos para `/opt/wg-proxy-manager` sem sobrescrever o banco, as chaves nem o `.env`;
- faz backup do banco;
- faz o build do frontend;
- cria o serviço `wg-proxy-manager`.

Para atualizar, rode o mesmo comando de novo.

O login usa uma conta do Proxmox com o privilégio **`Sys.Modify` em `/`** (ex.: `root@pam`), porque o painel executa comandos como root.

### Variáveis (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `PANEL_HOST` | `0.0.0.0` | Interface de escuta. Prefira o IP do Tailscale ou da LAN |
| `PANEL_PORT` | `8765` | Porta do painel |
| `SECRET_KEY` | gerada | Assinatura das sessões. Se ficar vazia, é criada em `DATA_DIR/.secret_key` |
| `REQUIRED_PRIVILEGE` | `Sys.Modify` | Privilégio do Proxmox exigido no login |
| `COOKIE_SECURE` | `false` | `true` quando o painel estiver atrás de HTTPS |
| `PROXMOX_HOST` / `PROXMOX_VERIFY_SSL` | `localhost` / `false` | API usada para validar o login |
| `DATA_DIR`, `DB_PATH`, `SSH_KEYS_DIR` | `/opt/wg-proxy-manager…` | Onde ficam o banco e as chaves |

## Segurança

- Todo valor que chega a um comando passa por validação estrita. Os scripts vão por stdin e nunca por argv.
- A sessão usa cookie `httpOnly` + `SameSite=Strict`. Há header anti-CSRF obrigatório, CSP e limite de tentativas de login.
- A chave SSH de cada VPS é fixada no primeiro contato (TOFU). Se ela mudar, a conexão é recusada.
- Banco, chaves e `.env` ficam com permissão 600/700. Tokens aparecem mascarados na interface.

A análise completa do v1 e o plano de migração estão em [docs/AUDITORIA.md](docs/AUDITORIA.md).

## Desenvolvimento

```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt pytest
venv/bin/python -m pytest backend/tests
cd frontend && npm install && npm run dev        # proxy /api → :8765
WGM_DEV_AUTH=1 DATA_DIR=/tmp/wgm venv/bin/python backend/main.py   # login sem senha, NUNCA em produção
```

## Licença

Veja [LICENSE](LICENSE).
