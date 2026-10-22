import { useMemo, useState } from 'react'
import {
  ArrowLeftRight, ArrowRight, Boxes, CheckCircle2, ChevronRight, CircleDashed, Download, Globe, Pencil, Plus,
  RefreshCw, Search, Server, ShieldCheck, Trash2, TriangleAlert, XCircle,
} from 'lucide-react'
import { api, Forward, ForwardStatus, Guest, HopStatus, Mode, Protocol, VPS } from '../api/client'
import {
  applyToast, Badge, Button, Callout, Drawer, Empty, Field, PageHeader, protoLabel, Segmented, Skeleton, Switch,
  useAsync, useConfirm, useToast,
} from '../ui'
import { FlowLink } from '../ui/charts'
import ImportWizard from './ImportWizard'

const HOP_TONE: Record<string, { tone: string; label: string }> = {
  applied: { tone: 'success', label: 'aplicada' },
  partial: { tone: 'warn', label: 'parcial' },
  missing: { tone: 'danger', label: 'ausente' },
  disabled: { tone: '', label: 'desativada' },
}

function HopDot({ label, status }: { label: string; status?: HopStatus }) {
  if (!status || status === 'n/a') return null
  const s = HOP_TONE[status] || { tone: '', label: status }
  const Icon = status === 'applied' ? CheckCircle2 : status === 'missing' ? XCircle : status === 'partial' ? TriangleAlert : CircleDashed
  return (
    <span className="row" style={{ gap: 5, fontSize: 12, color: s.tone ? `var(--${s.tone})` : 'var(--muted)' }} title={`${label}: ${s.label}`}>
      <Icon size={13} />{label}
    </span>
  )
}

export function guestFor(ip: string | null | undefined, guests: Guest[] | undefined) {
  if (!ip || !guests) return undefined
  return guests.find(g => g.ips.some(i => i.ip === ip) || g.managed?.wg_address?.split('/')[0] === ip)
}

export function RulePath({ r, vps, guest }: { r: Pick<Forward, 'mode' | 'port' | 'target_ip' | 'target_port'>; vps?: VPS; guest?: Guest }) {
  return (
    <div className="path">
      <span className="hop pub">{vps?.host || 'VPS'}:{r.port}</span>
      <span className="arrow"><ChevronRight size={13} /></span>
      {r.mode === 'host' && <>
        <span className="hop" title="Host Proxmox no túnel">{vps?.gw_ip || 'host'}</span>
        <span className="arrow"><ChevronRight size={13} /></span>
      </>}
      <span className="hop dst">{r.target_ip || '?'}:{r.target_port}</span>
      {guest && <span className="muted" style={{ fontFamily: 'var(--font)', fontSize: 12 }}>{guest.type === 'lxc' ? 'CT' : 'VM'} {guest.vmid} · {guest.name}</span>}
    </div>
  )
}

export default function Forwards() {
  const toast = useToast()
  const confirm = useConfirm()
  const rules = useAsync(api.listForwards)
  const vpsList = useAsync(api.listVPS)
  const guests = useAsync(() => api.guests().catch(() => [] as Guest[]))
  const status = useAsync<ForwardStatus | null>(() => api.forwardStatus().catch(() => null), [], 45000)
  const [editing, setEditing] = useState<Forward | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState<number | 'sync' | null>(null)
  const [q, setQ] = useState('')
  const [vpsFilter, setVpsFilter] = useState<string>('all')

  const vpsById = useMemo(() => Object.fromEntries((vpsList.data ?? []).map(v => [v.id, v])), [vpsList.data])
  const list = useMemo(() => (rules.data ?? []).filter(r => {
    if (vpsFilter !== 'all' && String(r.vps_id) !== vpsFilter) return false
    if (!q) return true
    const g = guestFor(r.target_ip, guests.data)
    return `${r.port} ${r.target_ip} ${r.target_port} ${r.description} ${g?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())
  }), [rules.data, q, vpsFilter, guests.data])

  const refresh = () => { rules.reload(); status.reload() }

  async function toggle(r: Forward) {
    setBusy(r.id)
    try {
      const res = await api.toggleForward(r.id)
      applyToast(toast, res.apply, `Porta ${r.port} ${res.rule.enabled ? 'ativada' : 'desativada'}`)
    } catch (e: any) { toast('error', 'Falha', e.message) }
    setBusy(null)
    refresh()
  }

  async function remove(r: Forward) {
    const ok = await confirm({
      title: `Remover a porta ${r.port}?`, danger: true, confirm: 'Remover',
      body: <>O encaminhamento <code>{r.port}/{protoLabel(r.protocol)}</code> → <code>{r.target_ip}:{r.target_port}</code> será removido da VPS{r.mode === 'host' ? ' e do host Proxmox' : ''} imediatamente.</>,
    })
    if (!ok) return
    setBusy(r.id)
    try { applyToast(toast, (await api.deleteForward(r.id)).apply, `Porta ${r.port} removida`) } catch (e: any) { toast('error', 'Falha', e.message) }
    setBusy(null)
    refresh()
  }

  async function syncAll() {
    setBusy('sync')
    try { applyToast(toast, await api.applyAll(), 'Regras sincronizadas') } catch (e: any) { toast('error', 'Falha', e.message) }
    setBusy(null)
    status.reload()
  }

  const targets = status.data ? Object.entries(status.data.targets) : []
  const legacyTotal = targets.reduce((n, [, t]) => n + (t.legacy_count || 0), 0)

  return (
    <>
      <PageHeader title="Encaminhamentos"
        sub="Portas públicas da VPS levadas até seus serviços — pelo host Proxmox ou direto a um peer WireGuard."
        actions={<>
          <Button icon={<Download size={15} />} onClick={() => setImporting(true)}>Importar do fw-manager</Button>
          <Button icon={<RefreshCw size={15} />} loading={busy === 'sync'} onClick={syncAll}>Sincronizar</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Novo encaminhamento</Button>
        </>} />

      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        {status.loading && !status.data && [0, 1].map(i => <div key={i} className="card card-pad"><Skeleton h={40} /></div>)}
        {targets.map(([key, t]) => {
          const isHost = key === 'host'
          const ok = t.available && (t.hooked || !t.installed) && !(t.stray?.length)
          return (
            <div key={key} className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="stat-icon" style={{ width: 38, height: 38, background: t.available ? (ok ? 'var(--success-soft)' : 'var(--warn-soft)') : 'var(--danger-soft)', color: t.available ? (ok ? 'var(--success)' : 'var(--warn)') : 'var(--danger)' }}>
                {isHost ? <ShieldCheck size={18} /> : <Server size={18} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="between"><b className="truncate">{t.name}</b>
                  {!t.available ? <Badge tone="danger">offline</Badge> : t.installed ? <Badge tone={ok ? 'success' : 'warn'} dot>{ok ? 'em dia' : 'divergente'}</Badge> : <Badge>sem regras</Badge>}
                </div>
                <div className="muted truncate" style={{ fontSize: 12, marginTop: 2 }}>
                  {!t.available ? t.error : <>
                    {t.legacy_count ? `${t.legacy_count} regra(s) do fw-manager` : 'nenhuma regra legada'}
                    {t.ip_forward === '0' && ' · ip_forward desligado'}
                    {t.stray?.length ? ' · regras órfãs — sincronize' : ''}
                  </>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {legacyTotal > 0 && (rules.data?.length ?? 0) === 0 && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="info" title={`Encontramos ${legacyTotal} regra(s) criadas pelo fw-manager`}>
            Importe-as para gerenciar tudo por aqui. Nada é apagado — as regras antigas continuam ativas até você decidir limpá-las.
            <div style={{ marginTop: 8 }}><Button size="sm" variant="primary" icon={<Download size={14} />} onClick={() => setImporting(true)}>Abrir assistente de importação</Button></div>
          </Callout>
        </div>
      )}

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="chip-input"><Search size={14} className="muted" /><input placeholder="Porta, IP, serviço…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {(vpsList.data?.length ?? 0) > 1 && (
              <select className="select" style={{ width: 200, height: 34 }} value={vpsFilter} onChange={e => setVpsFilter(e.target.value)}>
                <option value="all">Todas as VPS</option>
                {vpsList.data!.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
          </div>
          <span className="muted tnum" style={{ fontSize: 12.5 }}>{(rules.data ?? []).filter(r => r.enabled).length} ativas · {rules.data?.length ?? 0} no total</span>
        </div>

        {rules.loading && !rules.data ? <div className="card-pad stack">{[0, 1, 2].map(i => <Skeleton key={i} h={36} />)}</div>
          : list.length === 0 ? (
            <Empty icon={<ArrowLeftRight size={22} />} title={rules.data?.length ? 'Nenhum resultado' : 'Nenhum encaminhamento ainda'}
              action={!rules.data?.length && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Criar o primeiro</Button>}>
              {rules.data?.length ? 'Ajuste a busca ou o filtro.' : 'Exponha um serviço do seu homelab escolhendo uma porta pública na VPS e o container de destino.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Porta</th><th>Caminho</th><th>Estado</th><th>Descrição</th><th style={{ width: 60 }}>Ativa</th><th /></tr></thead>
                <tbody>
                  {list.map(r => {
                    const st = status.data?.rules[r.id]
                    return (
                      <tr key={r.id} className={r.enabled ? '' : 'dim'}>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{r.port}</span>
                            <span className="proto">{protoLabel(r.protocol)}</span>
                          </div>
                        </td>
                        <td><RulePath r={r} vps={vpsById[r.vps_id]} guest={guestFor(r.target_ip, guests.data)} /></td>
                        <td>
                          {status.loading && !status.data ? <Skeleton h={14} w={90} /> : (
                            <div className="row" style={{ gap: 10 }}>
                              <HopDot label="VPS" status={st?.vps} />
                              {r.mode === 'host' && <HopDot label="Host" status={st?.host} />}
                              {!st?.vps && !st?.host && <span className="muted" style={{ fontSize: 12 }}>—</span>}
                            </div>
                          )}
                        </td>
                        <td className="text-2" style={{ maxWidth: 240 }}>
                          <div className="truncate">{r.description || <span className="muted">—</span>}</div>
                          {r.source === 'imported' && <Badge tone="violet">importada</Badge>}
                        </td>
                        <td><Switch on={r.enabled} disabled={busy === r.id} onChange={() => toggle(r)} label={`Ativar porta ${r.port}`} /></td>
                        <td>
                          <div className="row-actions">
                            <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} onClick={() => setEditing(r)} title="Editar" aria-label="Editar" />
                            <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} loading={busy === r.id} onClick={() => remove(r)} title="Remover" aria-label="Remover" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {editing && (
        <ForwardDrawer rule={editing === 'new' ? null : editing} vpsList={vpsList.data ?? []} guests={guests.data ?? []}
          status={status.data ?? null} existing={rules.data ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
      {importing && (
        <ImportWizard vpsList={vpsList.data ?? []} guests={guests.data ?? []} onClose={() => setImporting(false)} onDone={refresh} />
      )}
    </>
  )
}

// ── Create / edit drawer ─────────────────────────────────────────────────────────────────

function ForwardDrawer({ rule, vpsList, guests, status, existing, onClose, onSaved }: {
  rule: Forward | null; vpsList: VPS[]; guests: Guest[]; status: ForwardStatus | null; existing: Forward[]
  onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const firstVps = vpsList.find(v => v.gw_ip) ?? vpsList[0]
  const [vpsId, setVpsId] = useState<number | undefined>(rule?.vps_id ?? firstVps?.id)
  const vps = vpsList.find(v => v.id === vpsId)
  const [mode, setMode] = useState<Mode>(rule?.mode ?? (vps?.gw_ip ? 'host' : 'direct'))
  const [port, setPort] = useState(rule ? String(rule.port) : '')
  const [protocol, setProtocol] = useState<Protocol>(rule?.protocol ?? 'tcp')
  const [targetIp, setTargetIp] = useState(rule?.target_ip ?? '')
  const [samePort, setSamePort] = useState(!rule || rule.target_port === rule.port)
  const [targetPort, setTargetPort] = useState(rule ? String(rule.target_port) : '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = parseInt(port)
  const tp = samePort ? p : parseInt(targetPort)
  const guest = guestFor(targetIp, guests)
  const protos = protocol === 'both' ? ['tcp', 'udp'] : [protocol]
  const listening = status?.targets[`vps:${vpsId}`]?.listening
  const inUse = listening && p ? protos.filter(x => (listening as any)[x]?.includes(p)) : []
  const clash = existing.find(e => e.id !== rule?.id && e.vps_id === vpsId && e.port === p && (e.protocol === protocol || e.protocol === 'both' || protocol === 'both'))
  const portValid = p >= 1 && p <= 65535
  const ipValid = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(targetIp)
  const tpValid = tp >= 1 && tp <= 65535
  const hostBlocked = mode === 'host' && !vps?.gw_ip
  const canSave = vps && portValid && ipValid && tpValid && !clash && !hostBlocked

  const wgPeers = guests.filter(g => g.managed?.wg_address && g.managed.wg_vps_id === vpsId)
  const lanGuests = guests.filter(g => g.ips.length > 0)

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const body = { vps_id: vpsId, mode, port: p, protocol, target_ip: targetIp, target_port: tp, description, enabled, vmid: guest?.vmid ?? null }
    try {
      const res = rule ? await api.updateForward(rule.id, body) : await api.createForward(body)
      applyToast(toast, res.apply, rule ? `Porta ${p} atualizada` : `Porta ${p} publicada`)
      onSaved()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <Drawer open onClose={onClose} title={rule ? `Editar porta ${rule.port}` : 'Novo encaminhamento'}
      sub={rule ? 'As regras antigas são substituídas atomicamente ao salvar.' : 'Publique um serviço interno em uma porta da VPS.'}
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={saving} disabled={!canSave} onClick={save}>{rule ? 'Salvar e aplicar' : 'Publicar porta'}</Button>
      </>}>

      <div className="pipeline">
        <div className="node"><div className="node-ic" style={{ color: 'var(--primary)' }}><Globe size={18} /></div><div className="n">Internet</div><div className="a">{vps?.host ?? '—'}:{portValid ? p : '…'}</div></div>
        <FlowLink ok={!!vps && portValid} />
        <div className="node">
          <div className="node-ic">{mode === 'host' ? <ShieldCheck size={18} /> : <Server size={18} />}</div>
          <div className="n">{mode === 'host' ? 'Host Proxmox' : vps?.name ?? 'VPS'}</div>
          <div className="a">{mode === 'host' ? (vps?.gw_ip ?? 'sem gateway') : `wg ${vps?.wg_interface ?? 'wg0'}`}</div>
        </div>
        <FlowLink ok={ipValid && tpValid} />
        <div className="node"><div className="node-ic" style={{ color: ipValid ? 'var(--success)' : undefined }}><Boxes size={18} /></div>
          <div className="n">{guest ? guest.name : 'Destino'}</div><div className="a">{ipValid ? targetIp : '…'}:{tpValid ? tp : '…'}</div></div>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="stack">
        <div className="section-title">1 · Servidor público</div>
        {vpsList.length === 0 ? <Callout tone="warn">Cadastre uma VPS em <b>Servidores</b> primeiro.</Callout> : (
          <Field>
            <select className="select" value={vpsId} onChange={e => setVpsId(parseInt(e.target.value))}>
              {vpsList.map(v => <option key={v.id} value={v.id}>{v.name} — {v.host}</option>)}
            </select>
          </Field>
        )}
      </div>

      <div className="stack">
        <div className="section-title">2 · Como chegar ao serviço</div>
        <div className="choice">
          <button type="button" className={`choice-card ${mode === 'host' ? 'on' : ''}`} onClick={() => setMode('host')}>
            <ShieldCheck size={18} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }} />
            <div><div className="t">Via host Proxmox <Badge tone="primary">recomendado</Badge></div>
              <div className="d">A VPS envia ao host pelo túnel e o host entrega ao IP da LAN. Nada a instalar no container — é o que o fw-manager fazia.</div></div>
          </button>
          <button type="button" className={`choice-card ${mode === 'direct' ? 'on' : ''}`} onClick={() => setMode('direct')}>
            <Server size={18} style={{ color: 'var(--violet)', flexShrink: 0, marginTop: 2 }} />
            <div><div className="t">Direto para um peer WireGuard</div>
              <div className="d">A VPS entrega direto no IP WireGuard de um container que roda seu próprio túnel.</div></div>
          </button>
        </div>
        {hostBlocked && <Callout tone="warn" title="Gateway não configurado">Em <b>Servidores → {vps?.name} → Configuração</b>, use <b>Detectar</b> ou informe o IP do host Proxmox no túnel.</Callout>}
      </div>

      <div className="stack">
        <div className="section-title">3 · Destino</div>
        <Field label={mode === 'host' ? 'Container ou VM' : 'Peer WireGuard'} hint={mode === 'host' ? 'Lista vinda do Proxmox, com os IPs atuais.' : 'Containers com WireGuard instalado pelo painel nesta VPS.'}>
          <select className="select" value={guest && guest.ips.some(i => i.ip === targetIp) || (guest?.managed?.wg_address?.startsWith(targetIp + '/')) ? targetIp : ''} onChange={e => e.target.value && setTargetIp(e.target.value)}>
            <option value="">{(mode === 'host' ? lanGuests : wgPeers).length ? 'Escolher da lista…' : 'Nenhum disponível — informe o IP abaixo'}</option>
            {mode === 'host'
              ? lanGuests.map(g => g.ips.filter(i => !i.iface?.startsWith('wg') && !i.ip.startsWith('100.')).map(i => (
                <option key={`${g.vmid}-${i.ip}`} value={i.ip}>{g.type === 'lxc' ? 'CT' : 'VM'} {g.vmid} · {g.name} — {i.ip}{g.status !== 'running' ? ' (parado)' : ''}</option>
              )))
              : wgPeers.map(g => { const ip = g.managed!.wg_address!.split('/')[0]; return <option key={g.vmid} value={ip}>CT {g.vmid} · {g.name} — {ip}</option> })}
          </select>
        </Field>
        <Field label="IP de destino" error={targetIp && !ipValid ? 'IPv4 inválido' : null}>
          <input className="input mono" value={targetIp} onChange={e => setTargetIp(e.target.value.trim())} placeholder={mode === 'host' ? '192.168.1.120' : '10.10.0.3'} aria-invalid={!!targetIp && !ipValid} />
        </Field>
      </div>

      <div className="stack">
        <div className="section-title">4 · Portas</div>
        <div className="form-grid">
          <Field label="Porta pública" error={clash ? `Já usada pela regra #${clash.id}` : port && !portValid ? 'Entre 1 e 65535' : null}
            warn={inUse.length ? `Algo já escuta em ${p}/${inUse.join('+')} na VPS — o encaminhamento vai sobrepor esse serviço.` : undefined}>
            <input className="input mono" inputMode="numeric" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} placeholder="443" aria-invalid={!!clash || (!!port && !portValid)} />
          </Field>
          <Field label="Protocolo">
            <Segmented block value={protocol} onChange={setProtocol} options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'both', label: 'Ambos' }]} />
          </Field>
          <Field className="span-2" label="Porta no destino" aside={
            <label className="row" style={{ gap: 6, fontWeight: 500, cursor: 'pointer' }}><Switch on={samePort} onChange={setSamePort} label="Mesma porta" /> mesma porta</label>
          } error={!samePort && targetPort && !tpValid ? 'Entre 1 e 65535' : null}>
            {!samePort && <input className="input mono" inputMode="numeric" value={targetPort} onChange={e => setTargetPort(e.target.value.replace(/\D/g, ''))} placeholder="8080" />}
          </Field>
        </div>
      </div>

      <div className="stack">
        <div className="section-title">5 · Detalhes</div>
        <Field label="Descrição" hint="Opcional — aparece na lista.">
          <input className="input" value={description} maxLength={120} onChange={e => setDescription(e.target.value)} placeholder="Ex.: Nginx Proxy Manager, servidor de jogo…" />
        </Field>
        <div className="between"><span className="text-2">Ativar imediatamente</span><Switch on={enabled} onChange={setEnabled} /></div>
      </div>

      <Callout tone="info" title="Firewall do provedor">
        Na Oracle Cloud, libere <code>{portValid ? p : 'a porta'}/{protocol === 'both' ? 'tcp e udp' : protocol}</code> na <b>Security List</b> da VPC — o painel cuida só do iptables.
      </Callout>
      <div className="muted row" style={{ fontSize: 12 }}><ArrowRight size={12} />Regras ficam nas cadeias <code>WGM-*</code> — o fw-manager e o Docker não são afetados.</div>
    </Drawer>
  )
}
