import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Box, ExternalLink, FileText, Globe, Lock, LockOpen, Pencil, Plus, RefreshCw, Server, ShieldCheck, Trash2, Wrench,
} from 'lucide-react'
import { api, ForwardStatus, Guest, ProxyInfo, Site, VPS } from '../api/client'
import {
  Badge, Button, Callout, Drawer, Empty, Field, Modal, PageHeader, Segmented, Skeleton, Switch, useAsync, useConfirm, useToast,
} from '../ui'
import { FlowLink } from '../ui/charts'
import { guestFor } from './Forwards'

const lanIps = (g: Guest) => g.ips.filter(i => !/^(wg|tailscale|docker|br-)/.test(i.iface || '') && !i.ip.startsWith('100.'))

function applyMsg(toast: ReturnType<typeof useToast>, res: { ok: boolean; message: string }, ok: string) {
  res.ok ? toast('success', ok, 'Caddy recarregado com a nova configuração.') : toast('error', 'Salvo, mas o proxy recusou', res.message)
}

export default function Sites() {
  const toast = useToast()
  const confirm = useConfirm()
  const proxy = useAsync(api.proxy)
  const sites = useAsync(api.listSites)
  const guests = useAsync(() => api.guests().catch(() => [] as Guest[]))
  const vpsList = useAsync(api.listVPS)
  const [editing, setEditing] = useState<Site | 'new' | null>(null)
  const [setup, setSetup] = useState(false)
  const [logs, setLogs] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | number | null>(null)
  const p = proxy.data

  // While Caddy is being installed, keep polling the proxy status
  useEffect(() => {
    if (p?.status !== 'installing') return
    const t = setInterval(proxy.reload, 4000)
    return () => clearInterval(t)
  }, [p?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string | number, fn: () => Promise<any>, done?: (r: any) => void) {
    setBusy(key)
    try { done?.(await fn()) } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
  }

  const statusBadge = !p ? null
    : p.status === 'installing' ? <Badge tone="info" dot live>instalando Caddy…</Badge>
    : p.status === 'error' ? <Badge tone="danger" dot>erro</Badge>
    : p.caddy?.active ? <Badge tone="success" dot live>Caddy {p.caddy.version} ativo</Badge>
    : <Badge tone="warn" dot>Caddy parado</Badge>

  return (
    <>
      <PageHeader title="Sites" sub="Vários sites nas mesmas portas 80/443, separados pelo subdomínio — com HTTPS automático (Let's Encrypt)."
        actions={p && <>
          <Button icon={<RefreshCw size={15} />} loading={busy === 'apply'} onClick={() => act('apply', api.applySites, r => applyMsg(toast, r, 'Configuração reaplicada'))}>Reaplicar</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Novo site</Button>
        </>} />

      {proxy.loading && !proxy.data ? <div className="card card-pad"><Skeleton h={120} /></div>
        : !p ? <SetupCard vpsList={vpsList.data ?? []} guests={guests.data ?? []} onDone={() => { proxy.reload(); sites.reload() }} />
        : (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div>
                <div className="card-title"><ShieldCheck size={16} color="var(--success)" />Proxy reverso</div>
                <div className="card-sub">Todas as requisições HTTP(S) chegam aqui e são distribuídas pelo nome do site.</div>
              </div>
              {statusBadge}
            </div>
            <div className="card-pad stack">
              <div className="pipeline">
                <div className="node"><div className="node-ic" style={{ color: 'var(--primary)' }}><Globe size={18} /></div><div className="n">*.seudominio</div><div className="a">{p.vps_host}:80/443</div></div>
                <FlowLink ok={p.forwards.every(f => f.enabled) && p.forwards.length === 2} />
                <div className="node"><div className="node-ic"><Server size={18} /></div><div className="n">{p.vps_name}</div><div className="a">via host</div></div>
                <FlowLink ok={!!p.caddy?.active} />
                <div className="node"><div className="node-ic" style={{ color: p.caddy?.active ? 'var(--success)' : undefined }}><Box size={18} /></div>
                  <div className="n">CT {p.vmid} · {p.lxc_name}</div><div className="a">{p.proxy_ip}</div></div>
              </div>
              {p.status === 'error' && <Callout tone="danger" title="O proxy não está funcionando">Veja os logs ou a página Atividade. Depois de corrigir, use Reinstalar.</Callout>}
              {p.forwards.length < 2 && <Callout tone="warn">Os encaminhamentos 80/443 até o proxy não existem mais. Use <b>Alterar</b> e salve de novo para recriá-los.</Callout>}
              <div className="between" style={{ flexWrap: 'wrap' }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {p.forwards.map(f => <Badge key={f.id} tone={f.enabled ? 'success' : ''}>:{f.port} → {f.target_ip}</Badge>)}
                  {p.acme_email && <Badge>Let's Encrypt · {p.acme_email}</Badge>}
                </div>
                <div className="row">
                  <Button size="sm" icon={<FileText size={13} />} loading={busy === 'logs'} onClick={() => act('logs', api.proxyLogs, r => setLogs(r.logs || '(sem logs)'))}>Logs</Button>
                  <Button size="sm" icon={<Wrench size={13} />} loading={busy === 'reinstall'} onClick={() => act('reinstall', api.reinstallProxy, () => { toast('info', 'Reinstalando Caddy', 'Acompanhe em Atividade.'); setTimeout(proxy.reload, 1500) })}>Reinstalar</Button>
                  <Button size="sm" onClick={() => setSetup(true)}>Alterar</Button>
                </div>
              </div>
            </div>
          </div>
        )}

      {p && (
        <div className="card">
          {!sites.data ? <div className="card-pad stack">{[0, 1].map(i => <Skeleton key={i} h={36} />)}</div>
            : !sites.data.length ? (
              <Empty icon={<Globe size={22} />} title="Nenhum site ainda" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Adicionar site</Button>}>
                Aponte um subdomínio para <code>{p.vps_host}</code> no DNS e diga para qual container ele vai.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Site</th><th>Destino</th><th>DNS</th><th>Descrição</th><th style={{ width: 60 }}>Ativo</th><th /></tr></thead>
                  <tbody>
                    {sites.data.map(s => {
                      const g = guestFor(s.upstream_ip, guests.data)
                      return (
                        <tr key={s.id} className={s.enabled ? '' : 'dim'}>
                          <td>
                            <a className="row" style={{ gap: 7, fontWeight: 600 }} href={`${s.tls ? 'https' : 'http'}://${s.hostname}`} target="_blank" rel="noreferrer">
                              {s.tls ? <Lock size={13} color="var(--success)" /> : <LockOpen size={13} className="muted" />}{s.hostname}<ExternalLink size={11} className="muted" />
                            </a>
                          </td>
                          <td>
                            <div className="path"><span className="hop dst">{s.upstream_scheme === 'https' ? 'https://' : ''}{s.upstream_ip}:{s.upstream_port}</span>
                              {g && <span className="muted" style={{ fontFamily: 'var(--font)', fontSize: 12 }}>{g.type === 'lxc' ? 'CT' : 'VM'} {g.vmid} · {g.name}</span>}</div>
                          </td>
                          <td>
                            {s.dns === 'ok' ? <Badge tone="success">ok</Badge>
                              : s.dns === 'other' ? <span title={`Resolve para ${s.dns_ips?.join(', ')} — esperado ${p.vps_host}. Se for o proxy laranja da Cloudflare, tudo bem.`}><Badge tone="warn">{s.dns_ips?.[0]}</Badge></span>
                              : <span title={`Crie um registro A ${s.hostname} → ${p.vps_host}`}><Badge tone="danger">sem registro</Badge></span>}
                          </td>
                          <td className="text-2"><div className="truncate" style={{ maxWidth: 220 }}>{s.description || <span className="muted">—</span>}</div></td>
                          <td><Switch on={s.enabled} disabled={busy === s.id} onChange={() => act(s.id, () => api.toggleSite(s.id), r => { applyMsg(toast, r.apply, `${s.hostname} ${r.site.enabled ? 'ativado' : 'desativado'}`); sites.reload() })} /></td>
                          <td>
                            <div className="row-actions">
                              <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} onClick={() => setEditing(s)} aria-label="Editar" />
                              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} loading={busy === `d${s.id}`} aria-label="Remover"
                                onClick={async () => {
                                  if (await confirm({ title: `Remover ${s.hostname}?`, danger: true, confirm: 'Remover', body: 'O site sai do proxy imediatamente. O registro DNS não é alterado.' }))
                                    act(`d${s.id}`, () => api.deleteSite(s.id), r => { applyMsg(toast, r.apply, 'Site removido'); sites.reload() })
                                }} />
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
      )}

      {p && (
        <div style={{ marginTop: 14 }}>
          <Callout tone="info" title="Só para HTTP/HTTPS">
            O roteamento por subdomínio funciona para sites e APIs. Jogos, UDP e TCP puro continuam precisando de uma porta própria em <Link to="/forwards" style={{ color: 'var(--primary)' }}>Encaminhamentos</Link>.
          </Callout>
        </div>
      )}

      {editing && p && <SiteDrawer site={editing === 'new' ? null : editing} proxy={p} guests={guests.data ?? []}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); sites.reload() }} />}
      <Modal open={setup} onClose={() => setSetup(false)} title="Alterar proxy" sub="Mover o proxy recria os encaminhamentos 80/443 e reinstala o Caddy.">
        <SetupForm vpsList={vpsList.data ?? []} guests={guests.data ?? []} current={p ?? undefined} onDone={() => { setSetup(false); proxy.reload() }} />
      </Modal>
      <Modal open={logs !== null} onClose={() => setLogs(null)} title="Logs do Caddy">
        <div className="code" style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{logs}</div>
      </Modal>
    </>
  )
}

function SetupCard({ vpsList, guests, onDone }: { vpsList: VPS[]; guests: Guest[]; onDone: () => void }) {
  return (
    <div className="card">
      <div className="card-head"><div><div className="card-title"><Globe size={16} />Configurar o proxy reverso</div>
        <div className="card-sub">Feito uma vez. Depois, cada site novo é só um subdomínio e um destino.</div></div></div>
      <div className="card-pad stack">
        <div className="grid grid-3">
          {[
            ['1', 'Escolha uma VPS', 'As portas 80/443 dela passam a ser do proxy.'],
            ['2', 'Escolha um container', 'O painel instala o Caddy nele (Debian/Ubuntu). Um LXC pequeno basta.'],
            ['3', 'Cadastre os sites', 'subdomínio → container. Certificados HTTPS são emitidos sozinhos.'],
          ].map(([n, t, d]) => (
            <div key={n} className="row" style={{ alignItems: 'flex-start' }}>
              <div className="stat-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>{n}</div>
              <div><b>{t}</b><div className="text-2" style={{ fontSize: 13 }}>{d}</div></div>
            </div>
          ))}
        </div>
        <div className="divider" />
        <SetupForm vpsList={vpsList} guests={guests} onDone={onDone} />
      </div>
    </div>
  )
}

function SetupForm({ vpsList, guests, current, onDone }: { vpsList: VPS[]; guests: Guest[]; current?: ProxyInfo; onDone: () => void }) {
  const toast = useToast()
  const status = useAsync<ForwardStatus | null>(() => api.forwardStatus().catch(() => null))
  const forwards = useAsync(api.listForwards)
  const usable = vpsList.filter(v => v.gw_ip)
  const [vpsId, setVpsId] = useState<number | undefined>(current?.vps_id ?? usable[0]?.id)
  const lxcs = guests.filter(g => g.type === 'lxc' && g.status === 'running' && lanIps(g).length)
  const [vmid, setVmid] = useState<number | undefined>(current?.vmid)
  const [email, setEmail] = useState(current?.acme_email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!vpsId && usable[0]) setVpsId(usable[0].id) }, [usable.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const vps = vpsList.find(v => v.id === vpsId)
  const listening = status.data?.targets[`vps:${vpsId}`]?.listening?.tcp ?? []
  const busyPorts = [80, 443].filter(p => listening.includes(p))
  const target = guests.find(g => g.vmid === vmid)
  const targetIp = target ? lanIps(target)[0]?.ip : undefined
  const clash = useMemo(() => (forwards.data ?? []).filter(f => f.vps_id === vpsId && [80, 443].includes(f.port) && f.target_ip !== targetIp), [forwards.data, vpsId, targetIp])

  async function save() {
    if (!vpsId || !vmid) return
    setSaving(true); setError(null)
    try {
      await api.setupProxy({ vps_id: vpsId, vmid, acme_email: email })
      toast('info', 'Configurando o proxy', 'Encaminhamentos criados; instalando o Caddy — acompanhe em Atividade.')
      onDone()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div className="stack">
      {error && <Callout tone="danger">{error}</Callout>}
      {!usable.length && <Callout tone="warn">Nenhuma VPS tem gateway. Em <Link to="/servers" style={{ color: 'var(--primary)' }}>Servidores</Link>, use <b>Conectar ao host</b> primeiro.</Callout>}
      <div className="form-grid">
        <Field label="VPS pública" hint={vps ? `Os DNS dos sites apontam para ${vps.host}` : undefined}>
          <select className="select" value={vpsId} onChange={e => setVpsId(parseInt(e.target.value))}>
            {usable.map(v => <option key={v.id} value={v.id}>{v.name} — {v.host}</option>)}
          </select>
        </Field>
        <Field label="Container do proxy" hint="LXC Debian/Ubuntu ligado, com IP na LAN.">
          <select className="select" value={vmid ?? ''} onChange={e => setVmid(parseInt(e.target.value) || undefined)}>
            <option value="">Escolher…</option>
            {lxcs.map(g => <option key={g.vmid} value={g.vmid}>CT {g.vmid} · {g.name} — {lanIps(g)[0].ip}</option>)}
          </select>
        </Field>
        <Field label="E-mail para o Let's Encrypt" className="span-2" hint="Opcional — recebe avisos de expiração de certificado.">
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
        </Field>
      </div>
      {busyPorts.length > 0 && (
        <Callout tone="warn" title={`${vps?.name} já tem algo escutando em ${busyPorts.join(' e ')}`}>
          Provavelmente um nginx na própria VPS. O proxy vai sobrepor esse serviço — migre esses sites para cá ou escolha outra VPS.
        </Callout>
      )}
      {clash.length > 0 && <Callout tone="danger">Já existem encaminhamentos nas portas {clash.map(c => c.port).join(', ')} desta VPS para outro destino. Remova-os em Encaminhamentos antes.</Callout>}
      <div className="row">
        <Button variant="primary" loading={saving} disabled={!vpsId || !vmid || clash.length > 0} onClick={save}>{current ? 'Salvar e reinstalar' : 'Configurar proxy'}</Button>
        <span className="muted" style={{ fontSize: 12 }}>Na Oracle, libere TCP 80 e 443 na Security List.</span>
      </div>
    </div>
  )
}

function SiteDrawer({ site, proxy, guests, onClose, onSaved }: { site: Site | null; proxy: ProxyInfo; guests: Guest[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [hostname, setHostname] = useState(site?.hostname ?? '')
  const [ip, setIp] = useState(site?.upstream_ip ?? '')
  const [port, setPort] = useState(site ? String(site.upstream_port) : '80')
  const [scheme, setScheme] = useState<'http' | 'https'>(site?.upstream_scheme ?? 'http')
  const [tls, setTls] = useState(site?.tls ?? true)
  const [description, setDescription] = useState(site?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const g = guestFor(ip, guests)
  const hostValid = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)
  const ipValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
  const p = parseInt(port)
  const options = guests.filter(x => lanIps(x).length)

  async function save() {
    setSaving(true); setError(null)
    const body = { hostname, upstream_ip: ip, upstream_port: p, upstream_scheme: scheme, tls, description, vmid: g?.vmid ?? null }
    try {
      const r = site ? await api.updateSite(site.id, body) : await api.createSite(body)
      applyMsg(toast, r.apply, site ? 'Site atualizado' : `${r.site.hostname} publicado`)
      onSaved()
    } catch (e: any) { setError(e.message); setSaving(false) }
  }

  return (
    <Drawer open onClose={onClose} title={site ? site.hostname : 'Novo site'} sub="O proxy encaminha as requisições deste nome para o destino."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!hostValid || !ipValid || !(p > 0 && p < 65536)} onClick={save}>{site ? 'Salvar' : 'Publicar site'}</Button></>}>
      <div className="pipeline">
        <div className="node"><div className="node-ic" style={{ color: 'var(--primary)' }}>{tls ? <Lock size={18} /> : <Globe size={18} />}</div><div className="n">{hostValid ? hostname : 'site'}</div><div className="a">{tls ? 'https' : 'http'}</div></div>
        <FlowLink ok={hostValid} />
        <div className="node"><div className="node-ic"><ShieldCheck size={18} /></div><div className="n">Caddy</div><div className="a">CT {proxy.vmid}</div></div>
        <FlowLink ok={ipValid} />
        <div className="node"><div className="node-ic" style={{ color: ipValid ? 'var(--success)' : undefined }}><Box size={18} /></div><div className="n">{g?.name ?? 'Destino'}</div><div className="a">{ipValid ? ip : '…'}:{p || '…'}</div></div>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Endereço do site" hint={`No DNS: registro A ${hostname || 'site.seudominio.com'} → ${proxy.vps_host}`} error={hostname && !hostValid ? 'Domínio inválido' : null}>
        <input className="input mono" value={hostname} onChange={e => setHostname(e.target.value.trim().toLowerCase())} placeholder="xburguer.birdra1n.com" autoFocus />
      </Field>
      <Field label="Container ou VM de destino">
        <select className="select" value={options.some(x => lanIps(x).some(i => i.ip === ip)) ? ip : ''} onChange={e => e.target.value && setIp(e.target.value)}>
          <option value="">Escolher da lista…</option>
          {options.map(x => lanIps(x).map(i => <option key={`${x.vmid}-${i.ip}`} value={i.ip}>{x.type === 'lxc' ? 'CT' : 'VM'} {x.vmid} · {x.name} — {i.ip}</option>))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="IP de destino" error={ip && !ipValid ? 'IPv4 inválido' : null}><input className="input mono" value={ip} onChange={e => setIp(e.target.value.trim())} placeholder="192.168.1.105" /></Field>
        <Field label="Porta do serviço"><input className="input mono" inputMode="numeric" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="O serviço fala" className="span-2" hint={scheme === 'https' ? 'Certificados autoassinados do destino são aceitos.' : 'O mais comum para apps internos.'}>
          <Segmented block value={scheme} onChange={setScheme} options={[{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }]} />
        </Field>
      </div>
      <div className="between">
        <div><div>HTTPS automático</div><div className="muted" style={{ fontSize: 12 }}>Certificado Let's Encrypt e redirecionamento de http para https.</div></div>
        <Switch on={tls} onChange={setTls} />
      </div>
      <Field label="Descrição" hint="Opcional."><input className="input" value={description} maxLength={120} onChange={e => setDescription(e.target.value)} /></Field>
      {tls && <Callout tone="info">O certificado é emitido no primeiro acesso, depois que o DNS apontar para <code>{proxy.vps_host}</code> e as portas 80/443 estiverem liberadas no provedor.</Callout>}
    </Drawer>
  )
}
