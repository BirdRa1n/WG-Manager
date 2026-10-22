import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, Boxes, CheckCircle2, Cloud, Globe, RefreshCw, Server, ShieldCheck, XCircle,
} from 'lucide-react'
import { api } from '../api/client'
import { useActivity } from '../activity'
import { applyToast, Button, Callout, fmtBytes, Skeleton, useAsync, useToast } from '../ui'
import { FlowLink, TrafficChart } from '../ui/charts'
import { LogList } from './Activity'
import { useState } from 'react'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function Stat({ icon, label, value, total, foot, tone, to }: { icon: React.ReactNode; label: string; value?: number; total?: number; foot?: string; tone: string; to: string }) {
  const nav = useNavigate()
  return (
    <div className="card stat interactive" onClick={() => nav(to)}>
      <div className="stat-top">{label}<div className="stat-icon" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{icon}</div></div>
      <div className="stat-value">{value ?? <Skeleton h={28} w={60} />}{total !== undefined && value !== undefined && <small>/ {total}</small>}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  )
}

export default function Dashboard() {
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  const overview = useAsync(api.overview, [], 30000)
  const summary = useAsync(api.summary, [], 30000)
  const traffic = useAsync(api.traffic, [], 60000)
  const { logs } = useActivity()
  const o = overview.data
  const s = summary.data
  const user = (useOutletContext<{ user: string }>()?.user || '').split('@')[0]

  async function syncAll() {
    setSyncing(true)
    try { applyToast(toast, await api.applyAll(), 'Tudo sincronizado') } catch (e: any) { toast('error', 'Falha ao sincronizar', e.message) }
    setSyncing(false)
    overview.reload()
  }

  const errors = o?.alerts.filter(a => a.level === 'error') ?? []
  const warns = o?.alerts.filter(a => a.level !== 'error') ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting()}{user && `, ${user}`}</h1>
          <p className="page-sub">
            {o ? (errors.length ? `${errors.length} problema(s) precisam de atenção.` : 'Tudo operando normalmente.') : 'Carregando o estado da rede…'}
          </p>
        </div>
        <div className="actions">
          <Button icon={<RefreshCw size={15} />} loading={syncing} onClick={syncAll}>Sincronizar regras</Button>
          <Link to="/forwards" className="btn btn-primary"><ArrowLeftRight size={15} />Novo encaminhamento</Link>
        </div>
      </div>

      {o && o.alerts.length > 0 && (
        <div className="stack" style={{ gap: 8, marginBottom: 18 }}>
          {[...errors, ...warns].map((a, i) => (
            <div key={i} className={`callout ${a.level === 'error' ? 'danger' : 'warn'}`} style={{ alignItems: 'center' }}>
              {a.level === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
              <div style={{ flex: 1 }}><b>{a.title}</b>{a.detail && <span className="text-2"> — {a.detail}</span>}</div>
              {a.link && <Link to={a.link} className="btn btn-sm btn-ghost">Resolver <ArrowRight size={13} /></Link>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat icon={<ArrowLeftRight size={16} />} label="Encaminhamentos" value={s?.ports_active} total={s?.ports_total} foot="portas públicas ativas" tone="primary" to="/forwards" />
        <Stat icon={<Server size={16} />} label="VPS online" value={s?.vps_online} total={s?.vps_total} foot={o ? `${o.vps.reduce((n, v) => n + v.peers, 0)} peers WireGuard` : ' '} tone="success" to="/servers" />
        <Stat icon={<Boxes size={16} />} label="Containers c/ WireGuard" value={s?.lxc_wg_ready} total={s?.lxc_total} foot="modo peer direto" tone="violet" to="/guests" />
        <Stat icon={<Cloud size={16} />} label="Túneis Cloudflare" value={s?.tunnels_running} total={s?.tunnels_total} foot="Zero Trust" tone="info" to="/tunnels" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div><div className="card-title"><Globe size={16} className="muted" />Topologia</div><div className="card-sub">Caminho do tráfego da internet até seus serviços</div></div>
        </div>
        <div className="card-pad">
          {!o ? <Skeleton h={120} /> : o.vps.length === 0 ? (
            <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Link to="/servers" className="btn btn-primary">Cadastrar a primeira VPS</Link></div>
          ) : (
            <div className="stack">
              {o.vps.map(v => {
                const tunnelOk = v.gw_handshake_age != null ? v.gw_handshake_age < 180 : undefined
                return (
                  <div key={v.id} className="topo">
                    <div className="topo-node">
                      <div className="node-ic"><Globe size={18} /></div>
                      <div><div className="n">Internet</div><div className="a mono">{v.host}</div></div>
                    </div>
                    <FlowLink ok={v.online} />
                    <div className="topo-node">
                      <div className="node-ic" style={{ color: v.online ? 'var(--success)' : v.online === false ? 'var(--danger)' : undefined }}><Server size={18} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div className="n truncate">{v.name}</div>
                        <div className="a">{v.online ? `${v.latency_ms} ms · ${v.peers} peers` : v.online === false ? 'inacessível' : 'aguardando coleta'}</div>
                      </div>
                    </div>
                    <FlowLink ok={tunnelOk} />
                    <div className="topo-node">
                      <div className="node-ic" style={{ color: tunnelOk ? 'var(--success)' : tunnelOk === false ? 'var(--danger)' : undefined }}><ShieldCheck size={18} /></div>
                      <div><div className="n">Proxmox</div><div className="a mono">{v.gw_ip ? `${v.gw_ip} · ${v.gw_iface}` : 'gateway não configurado'}</div></div>
                    </div>
                    <FlowLink ok={tunnelOk && v.rules_host > 0 ? true : undefined} />
                    <div className="topo-node">
                      <div className="node-ic"><Boxes size={18} /></div>
                      <div><div className="n">{v.rules_host + v.rules_direct} serviço(s)</div><div className="a">{v.rules_host} via host · {v.rules_direct} diretos</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Tráfego WireGuard</div><div className="card-sub">Soma de todos os peers · última hora</div></div>
            <div className="row" style={{ fontSize: 12 }}>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--primary)' }} />Entrada {fmtBytes(s?.total_rx_bytes)}</span>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--success)' }} />Saída {fmtBytes(s?.total_tx_bytes)}</span>
            </div>
          </div>
          <div className="card-pad"><TrafficChart data={traffic.data ?? []} /></div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head">
            <div className="card-title">Atividade recente</div>
            <Link to="/activity" className="btn btn-sm btn-ghost">Ver tudo <ArrowRight size={13} /></Link>
          </div>
          <div className="card-pad" style={{ flex: 1, maxHeight: 260, overflowY: 'auto' }}>
            {logs.length ? <LogList logs={logs.slice(-12)} autoScroll /> : (
              <div className="row muted" style={{ justifyContent: 'center', height: '100%' }}><CheckCircle2 size={16} />Sem eventos ainda</div>
            )}
          </div>
        </div>
      </div>
      {o && !o.host.on_proxmox && (
        <div style={{ marginTop: 14 }}><Callout tone="warn">Painel fora do host Proxmox — operações locais (DNAT do host, containers) indisponíveis.</Callout></div>
      )}
    </>
  )
}
