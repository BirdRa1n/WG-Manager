# Auditoria do WG Manager v1 e plano de migração do fw-manager

Data: 22/10/2026 · Escopo: código do repositório (v1.0.0), host Proxmox `pve` (100.94.93.106) e VPS Oracle (147.15.36.121).
Nos servidores, a auditoria foi **somente leitura**: nada foi alterado, e os dois scripts `fw-manager` continuam onde estavam.

---

## 1. Por que o v1 não substituía o fw-manager

A causa raiz é que o painel modelava uma topologia diferente da que você usa de fato.

| | Topologia real (fw-manager) | O que o v1 assumia |
|---|---|---|
| Quem tem WireGuard | Só o **host Proxmox** (`10.10.0.2`) | **Cada LXC** roda o próprio WireGuard |
| Salto 1 | VPS `ens3:porta` → DNAT → `10.10.0.2:porta` | VPS → DNAT → IP WG do container |
| Salto 2 | Host `wg0:porta` → DNAT → `192.168.1.x:porta` (vmbr0) | — (não existia) |
| VMs (ex.: Windows 101) | Funcionam: basta ter IP na LAN | Impossível: VM não é LXC |

Sem o segundo salto, o painel não tinha como representar nenhuma das regras do host, e as VMs não tinham como receber tráfego.

**No v2:** cada encaminhamento tem um **modo**. O modo `host` (Internet → VPS → host Proxmox → LAN) é o recomendado e é exatamente o que o fw-manager fazia. O modo `direct` (VPS → peer WireGuard) atende os containers que rodam o próprio túnel, como o emqx (`10.10.0.3`).

---

## 2. Estado atual dos servidores (achados)

### VPS Oracle
- **Não existe nenhum DNAT apontando para `10.10.0.2`.** Com isso, todas as regras do fw-manager no host estão órfãs hoje: 80, 443, 1080, 7000, 7778, 7882, 8888, 15000 e 15777. Só funcionam as regras diretas para o emqx (`10.10.0.3`) e para `10.10.0.4:7777`.
- **6 peers no `wg0`, e 2 deles com `allowed ips: (none)`** (`WcEC…` e `bT7r…`). Esse é o sintoma clássico de IP duplicado: o WireGuard move o IP para o peer mais novo, e o anterior para de receber tráfego.
- **nginx escuta em 80/443 na própria VPS.** Se as regras órfãs 80/443 → `192.168.1.138` fossem reativadas, elas tomariam o lugar do nginx. O v2 avisa sobre esse conflito no formulário e no assistente de importação.
- **Regras duplicadas por toda parte:** 5× `POSTROUTING -o ens3 MASQUERADE`, `-j MASQUERADE` sem nenhum filtro, `FORWARD -o/-i wg0 ACCEPT` em dobro e o multiport 8010/8011 repetido. A origem é o `PostUp` do wg-quick, que reinsere as regras a cada restart, somado às execuções repetidas dos scripts.
- **No `FORWARD`, 8 regras ACCEPT ficam depois de um `REJECT`** e nunca são avaliadas. Hoje isso não quebra nada só porque `-o wg0 -j ACCEPT` aceita tudo antes.

### Host Proxmox
- **O banco do painel deu ao CT 103 (oxicloud) o IP `10.10.0.2/24`, que é o IP do próprio host no túnel.** Além disso, o CT 103 nem existe mais no `pct list`.
- **4 regras para `192.168.1.107` (8083, 8084, 8883, 1883) não têm `-i wg0`.** Elas capturam qualquer tráfego encaminhado pelo host nessas portas, inclusive o de containers saindo para a internet na porta 8883/1883.
- O `fw-manager` do host foi escrito para a rede `192.168.2.x` (está no exemplo do prompt), mas a LAN real é `192.168.1.x`.
- `data.db` e `.env` estão com permissão **644**, legíveis por qualquer usuário do host. Eles guardam as chaves privadas WireGuard, o token da Cloudflare e a `SECRET_KEY`.
- Erro recorrente no journal: `Error reading SSH protocol banner`. É o coletor de estatísticas tentando a segunda VPS (`23.26.127.10`) sem timeout de banner.

---

## 3. Segurança do código v1

| # | Severidade | Problema | Correção no v2 |
|---|---|---|---|
| 1 | Crítica | **Injeção de comando**: `target_ip`, `protocol`, nomes e hostnames eram interpolados em scripts shell executados como root na VPS e no host | Validação estrita de tudo (`validators.py`); scripts enviados via stdin; regras geradas em formato `iptables-restore` |
| 2 | Crítica | **Qualquer usuário do Proxmox** (até um sem privilégios, de qualquer realm) virava root no host e nas VPS através do painel | O login exige o privilégio `Sys.Modify` em `/` (configurável) |
| 3 | Crítica | **Path traversal** no upload da chave SSH: o nome do arquivo vinha do nome da VPS (`../../etc/cron.d/x`) | Nome aleatório (`uuid`), criado com `O_EXCL` e modo 600 |
| 4 | Alta | `SECRET_KEY` caía em `"change-me-in-production"` quando ausente, o que permitia forjar JWT | O painel gera e persiste uma chave aleatória quando não há uma válida |
| 5 | Alta | SSH com `AutoAddPolicy`, ou seja, sem verificar a chave do servidor (MITM) | TOFU: a chave do servidor é fixada no primeiro contato e qualquer troca é recusada |
| 6 | Alta | JWT no `localStorage` e na *query string* do SSE (aparece em logs/proxies) + CORS `*` com credenciais | Cookie `httpOnly` + `SameSite=Strict`, sem CORS, header anti-CSRF obrigatório e CSP |
| 7 | Alta | Ticket do Proxmox exposto no frontend e na URL; expira em 2 h, enquanto o JWT dura 8 h (importar LXC/corrigir permissões falhava em silêncio) | O ticket não sai mais do servidor; operações locais usam `pvesh`/`pct` |
| 8 | Média | `data.db`/`.env` em 644 | `umask 077`, `chmod 600` na inicialização e no instalador |
| 9 | Média | Login sem limite de tentativas | 8 falhas por IP a cada 10 min |
| 10 | Média | Painel escutava em `0.0.0.0` sem opção de mudar | `PANEL_HOST` configurável (recomendado: IP do Tailscale) |
| 11 | Baixa | `/api/rota-inexistente` devolvia o `index.html` com status 200 | 404 JSON |

---

## 4. Bugs funcionais do v1

- **Porta de destino ignorada**: o script sempre fazia DNAT para `$DEST:$PORT`, então `8080 → :80` nunca funcionou.
- **Editar uma regra não mudava o iptables**: só o banco era atualizado. Ao remover depois, o painel apagava a regra "nova", que não existia, e a antiga ficava para sempre.
- **Protocolo "ambos" quebrado na sincronização**: `apply-missing` executava `iptables -p both` e falhava. O diff nunca batia (`both` ≠ `tcp`/`udp`) e cada "reaplicar" duplicava regras.
- **Regras inseridas com `-A FORWARD` depois do `REJECT`**, onde não têm efeito.
- **Alocação de IP WireGuard** olhava só o banco, não os peers reais da VPS. Daí saiu o `10.10.0.2` dado ao CT 103 e os peers `(none)`.
- **Remover o WireGuard de um LXC não removia o peer da VPS**, deixando peers órfãos acumulados.
- `recharts` era importado no Dashboard mas **não estava no `package.json`**: `npm run build` falhava numa instalação limpa.
- O `install.sh` fazia `cp -r . /opt/wg-proxy-manager` rodando de dentro de `/opt/wg-proxy-manager` (como o README manda), e o `set -e` abortava a instalação.
- Arquivos mortos e duplicados: `backend/tunnels.py`, `routers/database.py`, `routers/wireguard.py`, `routers/client.ts`.
- Cloudflare: excluir túnel/rota não removia o CNAME; a zona era deduzida dos dois últimos rótulos (falha em `.com.br`); `update_tunnel_config` ignorava erros da API.
- Node fixo em `"pve"`, `asyncio.get_event_loop()` deprecado e objetos ORM usados fora da sessão em threads.

---

## 5. Como o v2 aplica regras

- **Cadeias próprias**: `WGM-PRE` e `WGM-POST` (nat) e `WGM-FWD` (filter), ligadas na **posição 1** de PREROUTING/POSTROUTING/FORWARD. Ficam antes do `REJECT`, do Docker e do Tailscale.
- **Aplicação declarativa e atômica**: cada mudança reconstrói as cadeias a partir do banco com `iptables-restore --noflush`. Por isso é impossível sobrar regra duplicada ou fantasma. Validado no `iptables-nft` real do Proxmox, num network namespace descartável.
- **Nada de terceiros é tocado**: regras do fw-manager, do Docker, do Tailscale e do `PostUp` continuam como estão.
- **Persistência**: `iptables-save > /etc/iptables/rules.v4`, com backup único do original em `rules.v4.wgm-original`.
- **Estado ao vivo**: a lista mostra, por regra, se cada salto (VPS/host) está `aplicada`, `parcial` ou `ausente`.
- `MASQUERADE` restrito a destino/porta, sem regra global.

---

## 6. Plano de migração (sem downtime)

1. **Atualizar o painel no host**: `git pull && ./install.sh`. Banco, chaves e `.env` são preservados e o banco ganha backup automático.
2. **Servidores → Oracle VPS 01 → Detectar**: preenche o gateway `10.10.0.2 via wg0` automaticamente.
3. **Encaminhamentos → Importar do fw-manager**: o assistente junta os dois saltos. Regras "só no host" (as órfãs de hoje) vêm **desmarcadas** porque importá-las abriria portas novas, como 80/443, que conflitam com o nginx.
4. Conferir que cada regra aparece como `aplicada` em VPS e Host. As regras antigas continuam ativas em paralelo, sem causar problema.
5. Quando estiver tudo certo: **Limpar regras antigas dessas portas**, no próprio assistente. Só são removidas as linhas legadas das portas importadas. Os scripts `fw-manager` **não** são apagados.
6. Opcional: em Servidores → Peers, remover os 2 peers `(none)`. Antes, use **Remover WireGuard** do CT 103 inexistente, ou exclua-o do painel.

> Na Oracle, lembre de liberar as portas novas na **Security List** da VPC. O painel cuida só do iptables.
