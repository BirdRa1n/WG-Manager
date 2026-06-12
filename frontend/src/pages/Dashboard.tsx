import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import {
  AreaChart, Area, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { Server, Box, ArrowRightLeft, Cloud, Wifi, Activity, AlertTriangle, CheckCircle } from 'lucide-react'
import { C, shadow } from '../theme'
import StatusBadge from '../components/StatusBadge'

function fmtBytes(b: number) {
  if (!b) return '0 B'
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b > 1e3) return (b / 1e3).toFixed(0) + ' KB'
  return b + ' B'
}
function fmtRate(bytes: number) {
  if (!bytes) return '0 B/s'
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB/s'
  if (bytes > 1e3) return (bytes / 1e3).toFixed(0) + ' KB/s'
  return bytes + ' B/s'
}

function StatCard({ icon: Icon, label, value, sub, color, onClick }: any) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '18px 22px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: shadow.sm,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}
      onMouseEnter={e => { if (onClick) { (e.currentTarget as HTMLDivElement).style.borderColor = color; (e.currentTarget as HTMLDivElement).style.boxShadow = shadow.glow(color) } }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = C.border; (e.currentTarget as HTMLDivElement).style.boxShadow = shadow.sm }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: C.text2, fontSize: 12, fontWeight: 600, letterSpacing: '0.05em' }}>{label.toUpperCase()}</span>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color={color} />
        </div>
      </div>
      <div>
        <div style={{ color: C.text, fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ color: C.text2, fontSize: 12, marginTop: 6 }}>{sub}</div>}
      </div>
    </div>
  )
}

function TrafficSparkline({ data, color }: { data: any[]; color: string }) {
  if (!data || data.length < 2) return (
    <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
      Aguardando dados...
    </div>
  )
  const gradId = `grad-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={60}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.4} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const [summary, setSummary] = useState<any>(null)
  const [vpsList, setVpsList] = useState<any[]>([])
  const [lxcList, setLxcList] = useState<any[]>([])
  const [ports, setPorts] = useState<any[]>([])
  const [tunnels, setTunnels] = useState<any[]>([])
  const [wgStats, setWgStats] = useState<any[]>([])

  useEffect(() => {
    const load = () => {
      api.statsSummary().then(setSummary).catch(() => {})
      api.listVPS().then(setVpsList)
      api.listLXC().then(setLxcList)
      api.listPorts().then(setPorts)
      api.listTunnels().then(setTunnels)
    }
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (vpsList.length > 0 && vpsList[0].id) {
      api.statsWG(vpsList[0].id).then(setWgStats).catch(() => {})
    }
  }, [vpsList])

  const activePorts = ports.filter(p => p.enabled).length
  const inactivePorts = ports.length - activePorts

  const peerCharts = wgStats.map(peer => ({
    ...peer,
    rxSeries: (peer.series || []).map((s: any, i: number) => ({ i, value: s.rx_delta })),
    totalRx: peer.series?.length ? peer.series[peer.series.length - 1].rx : 0,
    totalTx: peer.series?.length ? peer.series[peer.series.length - 1].tx : 0,
    lastDelta: peer.series?.length ? peer.series[peer.series.length - 1] : null,
  }))

  const pieData = [
    { name: 'Ativas', value: activePorts, color: C.green },
    { name: 'Inativas', value: inactivePorts, color: C.muted },
  ]

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Dashboard</h1>
        <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>
          Visão geral da infraestrutura · Atualiza automaticamente a cada 30s
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard icon={Server} label="VPS" color={C.blue}
          value={summary?.vps_total ?? vpsList.length}
          sub={`${summary?.vps_wg_ready ?? vpsList.filter(v => v.status === 'wg_ready').length} com WireGuard`}
          onClick={() => nav('/vps')} />
        <StatCard icon={Box} label="LXC Containers" color={C.purple}
          value={summary?.lxc_total ?? lxcList.length}
          sub={`${summary?.lxc_wg_ready ?? lxcList.filter(c => c.status === 'wg_ready').length} com WireGuard`}
          onClick={() => nav('/lxc')} />
        <StatCard icon={ArrowRightLeft} label="Portas Abertas" color={C.green}
          value={summary?.ports_active ?? activePorts}
          sub={`${summary?.ports_total ?? ports.length} total configuradas`}
          onClick={() => nav('/ports')} />
        <StatCard icon={Cloud} label="CF Tunnels" color={C.cyan}
          value={summary?.tunnels_running ?? tunnels.filter(t => t.status === 'running').length}
          sub={`${summary?.tunnels_total ?? tunnels.length} total`}
          onClick={() => nav('/cloudflare')} />
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* WG Traffic */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Activity size={16} color={C.blue} />
            <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Tráfego WireGuard</span>
            <span style={{ marginLeft: 'auto', color: C.muted, fontSize: 11 }}>últimos 60 min</span>
          </div>
          {peerCharts.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
              Coletando dados... (atualiza a cada 60s)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {peerCharts.map((peer, i) => (
                <div key={i} style={{ background: C.surface2, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: peer.lxc_name ? C.green : C.yellow, flexShrink: 0 }} />
                    <span style={{ color: peer.lxc_name ? C.text : C.yellow, fontWeight: 600, fontSize: 13 }}>
                      {peer.lxc_name ?? 'Peer não registrado'}
                    </span>
                    {peer.lxc_vmid && <span style={{ color: C.muted, fontSize: 11 }}>CT-{peer.lxc_vmid}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, color: C.text2 }}>
                      <span>↑ {fmtBytes(peer.totalTx)}</span>
                      <span>↓ {fmtBytes(peer.totalRx)}</span>
                      {peer.lastDelta && (
                        <span style={{ color: C.greenL }}>
                          {fmtRate((peer.lastDelta.rx_delta || 0) + (peer.lastDelta.tx_delta || 0))}/min
                        </span>
                      )}
                    </div>
                  </div>
                  <TrafficSparkline data={peer.rxSeries} color={C.blue} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Port distribution */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <ArrowRightLeft size={15} color={C.green} />
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Distribuição de Portas</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <PieChart width={100} height={100}>
                <Pie data={pieData} cx={45} cy={45} innerRadius={28} outerRadius={45} dataKey="value" strokeWidth={0}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
              </PieChart>
              <div style={{ flex: 1 }}>
                {pieData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <span style={{ color: C.text2, fontSize: 12, flex: 1 }}>{d.name}</span>
                    <span style={{ color: C.text, fontWeight: 700 }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* LXC Status */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Box size={15} color={C.purple} />
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Containers</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lxcList.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface2, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: C.purple + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Box size={14} color={C.purple} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>
                      CT-{c.vmid}
                      {c.wg_address && <span style={{ color: C.blue, marginLeft: 8, fontFamily: 'monospace' }}>{c.wg_address}</span>}
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
              {lxcList.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: 8 }}>Nenhum container</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* VPS Overview */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Server size={15} color={C.blue} />
            <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>VPS</span>
          </div>
          {vpsList.map(v => (
            <div key={v.id} style={{ background: C.surface2, borderRadius: 10, padding: '14px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: C.blue + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Wifi size={15} color={C.blue} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{v.name}</div>
                  <div style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>{v.host}</div>
                </div>
                <StatusBadge status={v.status} />
              </div>
              {v.wg_address && (
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <span style={{ color: C.muted }}>WG:</span>
                  <span style={{ color: C.blueL, fontFamily: 'monospace' }}>{v.wg_address}</span>
                  <span style={{ color: C.muted, marginLeft: 8 }}>Interface:</span>
                  <span style={{ color: C.text2 }}>{v.pub_interface || 'ens3'}</span>
                </div>
              )}
            </div>
          ))}
          {vpsList.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: 12 }}>Nenhuma VPS</div>}
        </div>

        {/* CF + Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Cloud size={15} color={C.cyan} />
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Cloudflare Tunnels</span>
            </div>
            {tunnels.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: 12 }}>Nenhum tunnel configurado</div>
            ) : (
              tunnels.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface2, borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
                  <Cloud size={13} color={t.status === 'running' ? C.green : C.yellow} />
                  <span style={{ color: C.text, flex: 1, fontSize: 13 }}>{t.name}</span>
                  <StatusBadge status={t.status} />
                </div>
              ))
            )}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <AlertTriangle size={15} color={C.yellow} />
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Atenção</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lxcList.filter(c => !c.wg_address).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.yellow + '10', border: `1px solid ${C.yellow}30`, borderRadius: 8, padding: '8px 12px' }}>
                  <AlertTriangle size={12} color={C.yellow} />
                  <span style={{ color: C.text2, fontSize: 12 }}>CT-{c.vmid} <b style={{ color: C.text }}>{c.name}</b> sem WireGuard</span>
                </div>
              ))}
              {ports.filter(p => !p.enabled).map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '8px 12px' }}>
                  <AlertTriangle size={12} color={C.red} />
                  <span style={{ color: C.text2, fontSize: 12 }}>Porta <b style={{ color: C.text }}>{p.port}</b> desativada</span>
                </div>
              ))}
              {lxcList.filter(c => !c.wg_address).length === 0 && ports.filter(p => !p.enabled).length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.green, fontSize: 12 }}>
                  <CheckCircle size={14} />
                  Nenhum alerta ativo
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
