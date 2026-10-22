import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Box, Boxes, Cpu, MemoryStick, Monitor, RefreshCw, Search, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { api, Guest, VPS } from '../api/client'
import { Badge, Button, Callout, Drawer, Empty, Field, fmtBytes, PageHeader, Segmented, Skeleton, Switch, useAsync, useConfirm, useToast } from '../ui'
import { RulePath } from './Forwards'

export default function Guests() {
  const toast = useToast()
  const confirm = useConfirm()
  const guests = useAsync(() => api.guests(), [], 60000)
  const vpsList = useAsync(api.listVPS)
  const managed = useAsync(api.listLXC)
  const orphans = guests.data ? (managed.data ?? []).filter(m => !guests.data!.some(g => g.vmid === m.vmid)) : []

  async function forget(id: number, vmid: number) {
    if (!(await confirm({ title: `Esquecer o CT ${vmid}?`, danger: true, confirm: 'Esquecer',
      body: 'Este container não existe mais no Proxmox. O registro sai do painel e, se ele tinha WireGuard, o peer correspondente é removido da VPS (libera o IP).' }))) return
    try { await api.deleteLXC(id, true); toast('success', `CT ${vmid} removido do painel`); managed.reload() } catch (e: any) { toast('error', 'Falhou', e.message) }
  }
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'lxc' | 'qemu'>('all')
  const [openVmid, setOpenVmid] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const open = guests.data?.find(g => g.vmid === openVmid)

  const list = useMemo(() => (guests.data ?? []).filter(g =>
    (kind === 'all' || g.type === kind) &&
    (!q || `${g.vmid} ${g.name} ${g.ips.map(i => i.ip).join(' ')} ${g.tags}`.toLowerCase().includes(q.toLowerCase()))), [guests.data, q, kind])

  async function refresh() {
    setRefreshing(true)
    try { guests.setData(await api.guests(true)) } catch { /* shown below */ }
    setRefreshing(false)
  }

  return (
    <>
      <PageHeader title="Containers & VMs" sub="Tudo que roda no Proxmox, com IPs atuais — escolha daqui o destino dos encaminhamentos."
        actions={<Button icon={<RefreshCw size={15} />} loading={refreshing} onClick={refresh}>Atualizar</Button>} />

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todos' }, { value: 'lxc', label: 'LXC' }, { value: 'qemu', label: 'VMs' }]} />
            <div className="chip-input"><Search size={14} className="muted" /><input placeholder="Nome, ID, IP, tag…" value={q} onChange={e => setQ(e.target.value)} /></div>
          </div>
          <span className="muted" style={{ fontSize: 12.5 }}>{guests.data?.filter(g => g.status === 'running').length ?? 0} rodando · {guests.data?.length ?? 0} no total</span>
        </div>
        {guests.error ? <div className="card-pad"><Callout tone="warn" title="Não foi possível listar os guests">{guests.error}</Callout></div>
          : !guests.data ? <div className="card-pad stack">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={38} />)}</div>
          : list.length === 0 ? <Empty icon={<Boxes size={22} />} title="Nada encontrado">Ajuste a busca ou os filtros.</Empty>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>ID</th><th>Nome</th><th>Estado</th><th>IPs</th><th>Recursos</th><th>Exposição</th></tr></thead>
                <tbody>
                  {list.map(g => (
                    <tr key={g.vmid} style={{ cursor: 'pointer' }} onClick={() => setOpenVmid(g.vmid)}>
                      <td className="mono muted">{g.vmid}</td>
                      <td>
                        <div className="row" style={{ gap: 9 }}>
                          {g.type === 'lxc' ? <Box size={15} className="muted" /> : <Monitor size={15} className="muted" />}
                          <b>{g.name}</b>
                          {g.tags && g.tags.split(';').filter(Boolean).slice(0, 2).map(t => <Badge key={t}>{t}</Badge>)}
                        </div>
                      </td>
                      <td><Badge tone={g.status === 'running' ? 'success' : ''} dot>{g.status === 'running' ? 'rodando' : 'parado'}</Badge></td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {g.ips.filter(i => !i.ip.startsWith('100.')).slice(0, 2).map(i => <div key={i.ip}>{i.ip}<span className="muted"> {i.iface}</span></div>)}
                        {!g.ips.length && <span className="muted">{g.status === 'running' ? (g.type === 'qemu' ? 'sem guest agent' : '—') : '—'}</span>}
                      </td>
                      <td className="muted tnum" style={{ fontSize: 12 }}>{g.cpus} vCPU · {fmtBytes(g.maxmem)}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {g.forwards > 0 && <Badge tone="primary"><ArrowLeftRight size={11} />{g.forwards} porta(s)</Badge>}
                          {g.managed?.wg_address && <Badge tone="violet">WG {g.managed.wg_address.split('/')[0]}</Badge>}
                          {!g.forwards && !g.managed?.wg_address && <span className="muted">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {orphans.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head"><div><div className="card-title">Registros órfãos</div><div className="card-sub">Containers que o painel conhece, mas que não existem mais no Proxmox.</div></div></div>
          <div className="card-pad stack" style={{ gap: 8 }}>
            {orphans.map(m => (
              <div key={m.id} className="between">
                <div className="row"><Box size={15} className="muted" /><b>CT {m.vmid}</b><span className="text-2">{m.name}</span>{m.wg_address && <Badge tone="warn">WG {m.wg_address}</Badge>}</div>
                <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => forget(m.id, m.vmid)}>Esquecer</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && <GuestDrawer guest={open} vpsList={vpsList.data ?? []} onClose={() => setOpenVmid(null)} onChange={guests.reload} />}
    </>
  )
}

function GuestDrawer({ guest, vpsList, onClose, onChange }: { guest: Guest; vpsList: VPS[]; onClose: () => void; onChange: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const forwards = useAsync(api.listForwards)
  const [busy, setBusy] = useState<string | null>(null)
  const [issues, setIssues] = useState<{ key: string; message: string; fixable: boolean }[] | null>(null)
  const [vpsId, setVpsId] = useState<number | undefined>(vpsList.find(v => v.wg_public_key)?.id)
  const [full, setFull] = useState(false)
  const m = guest.managed
  const ips = new Set([...guest.ips.map(i => i.ip), ...(m?.wg_address ? [m.wg_address.split('/')[0]] : [])])
  const mine = (forwards.data ?? []).filter(f => f.vmid === guest.vmid || ips.has(f.target_ip))
  const vpsById = Object.fromEntries(vpsList.map(v => [v.id, v]))

  async function run<T>(key: string, fn: () => Promise<T>, ok?: (r: T) => void) {
    setBusy(key)
    try { const r = await fn(); ok?.(r) } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
    onChange()
  }
  const ensureManaged = async () => m ?? (await api.importLXC({ vmid: guest.vmid, name: guest.name, proxmox_node: guest.node }))

  return (
    <Drawer open wide onClose={onClose} title={<span className="row">{guest.type === 'lxc' ? <Box size={18} /> : <Monitor size={18} />}{guest.name}</span>}
      sub={`${guest.type === 'lxc' ? 'Container LXC' : 'Máquina virtual'} ${guest.vmid} · nó ${guest.node}`}>
      <div className="grid grid-3">
        <div className="card card-pad" style={{ boxShadow: 'none' }}><div className="muted" style={{ fontSize: 12 }}>Estado</div><Badge tone={guest.status === 'running' ? 'success' : ''} dot>{guest.status}</Badge></div>
        <div className="card card-pad" style={{ boxShadow: 'none' }}><div className="muted row" style={{ fontSize: 12, gap: 5 }}><Cpu size={12} />CPU</div><b>{guest.cpus} vCPU</b></div>
        <div className="card card-pad" style={{ boxShadow: 'none' }}><div className="muted row" style={{ fontSize: 12, gap: 5 }}><MemoryStick size={12} />Memória</div><b>{fmtBytes(guest.mem)} / {fmtBytes(guest.maxmem)}</b></div>
      </div>

      <div className="stack">
        <div className="section-title">Endereços</div>
        {guest.ips.length ? <div className="row" style={{ flexWrap: 'wrap' }}>{guest.ips.map(i => <Badge key={i.ip}><span className="mono">{i.ip}</span> <span className="muted">{i.iface}</span></Badge>)}</div>
          : <span className="muted">Nenhum IP visível{guest.type === 'qemu' ? ' — instale o qemu-guest-agent na VM' : ''}.</span>}
      </div>

      <div className="stack">
        <div className="between"><div className="section-title">Portas publicadas</div><Link to="/forwards" className="btn btn-sm"><ArrowLeftRight size={13} />Gerenciar</Link></div>
        {mine.length ? mine.map(f => (
          <div key={f.id} className="between card card-pad" style={{ boxShadow: 'none', padding: '10px 14px' }}>
            <RulePath r={f} vps={vpsById[f.vps_id]} />
            <Badge tone={f.enabled ? 'success' : ''}>{f.enabled ? 'ativa' : 'desativada'}</Badge>
          </div>
        )) : <span className="muted">Nenhuma porta deste guest está exposta.</span>}
      </div>

      {guest.type === 'lxc' && (
        <div className="stack">
          <div className="section-title">WireGuard dentro do container (avançado)</div>
          <Callout tone="info">
            Normalmente não é preciso: o modo <b>via host Proxmox</b> alcança qualquer container pela LAN. Use isto só se o container precisa de um IP próprio no túnel.
          </Callout>
          {m?.wg_address ? (
            <div className="card card-pad between" style={{ boxShadow: 'none' }}>
              <div><div className="row"><ShieldCheck size={15} color="var(--success)" /><b>Peer ativo</b></div>
                <div className="mono muted" style={{ fontSize: 12.5 }}>{m.wg_address} · VPS {vpsById[m.wg_vps_id!]?.name ?? m.wg_vps_id}</div></div>
              <Button variant="danger" size="sm" icon={<Trash2 size={14} />} loading={busy === 'remove'} onClick={async () => {
                if (await confirm({ title: 'Remover WireGuard do container?', danger: true, confirm: 'Remover', body: 'Para o wg0 no container (a config fica salva como backup) e remove o peer da VPS. Encaminhamentos diretos para este IP param de funcionar.' }))
                  run('remove', () => api.removeWGLXC(m.id), () => toast('success', 'WireGuard removido'))
              }}>Remover</Button>
            </div>
          ) : (
            <>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button size="sm" icon={<Wrench size={14} />} loading={busy === 'check'} onClick={() => run('check', async () => api.checkPermissions((await ensureManaged()).id), r => setIssues(r.issues))}>Verificar permissões</Button>
                {issues?.some(i => i.fixable) && (
                  <Button size="sm" loading={busy === 'fix'} onClick={() => run('fix', async () => api.fixPermissions((await ensureManaged()).id), r => toast(r.ok ? 'success' : 'error', r.ok ? 'nesting habilitado' : 'Falhou', r.ok ? 'Reinicie o container para aplicar.' : r.output))}>Habilitar nesting</Button>
                )}
              </div>
              {issues && (issues.length ? issues.map(i => <Callout key={i.key} tone="warn">{i.message}</Callout>) : <Callout tone="success">Container pronto para WireGuard.</Callout>)}
              <div className="form-grid">
                <Field label="VPS"><select className="select" value={vpsId} onChange={e => setVpsId(parseInt(e.target.value))}>
                  {vpsList.filter(v => v.wg_public_key).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></Field>
                <Field label="Rotear todo o tráfego pela VPS" hint="Full tunnel (AllowedIPs 0.0.0.0/0)"><div style={{ paddingTop: 8 }}><Switch on={full} onChange={setFull} /></div></Field>
              </div>
              <div><Button variant="primary" size="sm" disabled={!vpsId || guest.status !== 'running'} loading={busy === 'install'}
                onClick={() => run('install', async () => api.installWGLXC((await ensureManaged()).id, vpsId!, full), (r: any) => toast('info', 'Instalação iniciada', `IP reservado ${r.wg_address} — acompanhe em Atividade.`))}>
                Instalar WireGuard no container</Button></div>
            </>
          )}
        </div>
      )}
    </Drawer>
  )
}
