import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Cloud, ExternalLink, Globe, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { api, Tunnel } from '../api/client'
import { Badge, Button, Callout, Empty, Field, Modal, PageHeader, Segmented, Skeleton, useAsync, useConfirm, useToast } from '../ui'

const STATUS: Record<string, string> = { healthy: 'success', running: 'success', degraded: 'warn', created: 'info', inactive: '', down: 'danger' }

export default function Tunnels() {
  const toast = useToast()
  const confirm = useConfirm()
  const tunnels = useAsync(api.listTunnels)
  const lxcs = useAsync(api.listLXC)
  const creds = useAsync(api.listCredentials)
  const [creating, setCreating] = useState(false)
  const [routeFor, setRouteFor] = useState<Tunnel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function act(key: string, fn: () => Promise<any>, msg?: string) {
    setBusy(key)
    try { await fn(); if (msg) toast('success', msg) } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
    tunnels.reload()
  }

  return (
    <>
      <PageHeader title="Túneis Cloudflare" sub="Publique sites HTTP(S) sem abrir portas, via Cloudflare Zero Trust."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Novo túnel</Button>} />

      {creds.data && !creds.data.length && (
        <div style={{ marginBottom: 14 }}><Callout tone="info" title="Dica">Cadastre um token em <Link to="/credentials" style={{ color: 'var(--primary)' }}>Credenciais</Link> para criar túneis e registros DNS automaticamente.</Callout></div>
      )}

      {!tunnels.data ? <div className="grid grid-2">{[0, 1].map(i => <div key={i} className="card card-pad"><Skeleton h={120} /></div>)}</div>
        : !tunnels.data.length ? <div className="card"><Empty icon={<Cloud size={22} />} title="Nenhum túnel" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>Criar túnel</Button>}>Crie um túnel e o painel instala o <code>cloudflared</code> no container escolhido.</Empty></div>
        : (
          <div className="grid grid-2">
            {tunnels.data.map(t => (
              <div key={t.id} className="card">
                <div className="card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title"><Cloud size={16} color="var(--info)" />{t.name}</div>
                    <div className="card-sub mono truncate">{t.tunnel_id}</div>
                  </div>
                  <Badge tone={STATUS[t.status] ?? ''} dot live={STATUS[t.status] === 'success'}>{t.status}</Badge>
                </div>
                <div className="card-pad stack" style={{ gap: 10 }}>
                  <div className="row muted" style={{ fontSize: 12.5, flexWrap: 'wrap' }}>
                    {t.lxc ? <Badge>CT {t.lxc.vmid} · {t.lxc.name}</Badge> : <Badge>sem container</Badge>}
                    <Badge tone={t.managed ? 'primary' : ''}>{t.managed ? 'gerenciado via API' : 'token manual'}</Badge>
                  </div>
                  {t.routes.length ? t.routes.map(r => (
                    <div key={r.id} className="between" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
                      <div className="path" style={{ minWidth: 0 }}>
                        <a className="hop pub row" style={{ gap: 4 }} href={`https://${r.public_url}`} target="_blank" rel="noreferrer"><Globe size={11} />{r.public_url}<ExternalLink size={10} /></a>
                        <span className="arrow">→</span><span className="hop truncate">{r.service}</span>
                      </div>
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={13} />} loading={busy === `r${r.id}`} aria-label="Remover rota"
                        onClick={async () => { if (await confirm({ title: `Remover ${r.public_url}?`, danger: true, confirm: 'Remover', body: 'Remove a rota do túnel e o CNAME correspondente (se gerenciado).' })) act(`r${r.id}`, () => api.deleteRoute(t.id, r.id), 'Rota removida') }} />
                    </div>
                  )) : <span className="muted" style={{ fontSize: 13 }}>Nenhuma rota pública.</span>}
                </div>
                <div className="overlay-foot" style={{ justifyContent: 'space-between', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' }}>
                  <div className="row">
                    <Button size="sm" icon={<RefreshCw size={13} />} loading={busy === `s${t.id}`} onClick={() => act(`s${t.id}`, () => api.tunnelStatus(t.id))}>Status</Button>
                    {t.lxc && <Button size="sm" icon={<Wrench size={13} />} loading={busy === `i${t.id}`} onClick={() => act(`i${t.id}`, () => api.installCloudflared(t.id), 'Instalação iniciada')}>Reinstalar</Button>}
                  </div>
                  <div className="row">
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} loading={busy === `d${t.id}`} aria-label="Excluir túnel"
                      onClick={async () => { if (await confirm({ title: `Excluir o túnel ${t.name}?`, danger: true, confirm: 'Excluir', body: 'Remove o túnel na Cloudflare, os CNAMEs dele e desinstala o cloudflared do container.' })) act(`d${t.id}`, () => api.deleteTunnel(t.id), 'Túnel excluído') }} />
                    <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setRouteFor(t)}>Rota</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      <CreateTunnel open={creating} lxcs={lxcs.data ?? []} creds={creds.data ?? []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); tunnels.reload() }} />
      {routeFor && <AddRoute tunnel={routeFor} onClose={() => setRouteFor(null)} onDone={() => { setRouteFor(null); tunnels.reload() }} />}
    </>
  )
}

function CreateTunnel({ open, lxcs, creds, onClose, onDone }: { open: boolean; lxcs: any[]; creds: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'api' | 'token'>('api')
  const [f, setF] = useState({ name: '', lxc_id: '', cred_id: '', existing_token: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setSaving(true); setError(null)
    try {
      await api.createTunnel({ name: f.name, mode, lxc_id: f.lxc_id ? +f.lxc_id : null, cred_id: f.cred_id ? +f.cred_id : null, existing_token: f.existing_token })
      toast('success', 'Túnel criado', f.lxc_id ? 'Instalando cloudflared — acompanhe em Atividade.' : undefined)
      setF({ name: '', lxc_id: '', cred_id: '', existing_token: '' })
      onDone()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }
  return (
    <Modal open={open} onClose={onClose} title="Novo túnel Cloudflare"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!f.name || (mode === 'token' && !f.existing_token)} onClick={submit}>Criar túnel</Button></>}>
      {error && <Callout tone="danger">{error}</Callout>}
      <Segmented block value={mode} onChange={setMode} options={[{ value: 'api', label: 'Criar via API' }, { value: 'token', label: 'Colar token existente' }]} />
      <Field label="Nome"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="homelab-web" autoFocus /></Field>
      {mode === 'api' ? (
        <Field label="Credencial" hint={!creds.length ? 'Nenhuma credencial cadastrada.' : undefined}>
          <select className="select" value={f.cred_id} onChange={e => setF({ ...f, cred_id: e.target.value })}>
            <option value="">Primeira disponível</option>
            {creds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Token do túnel" hint="O valor depois de 'cloudflared service install'.">
          <textarea className="textarea" value={f.existing_token} onChange={e => setF({ ...f, existing_token: e.target.value })} placeholder="eyJhIjoi…" />
        </Field>
      )}
      <Field label="Instalar cloudflared em" hint="Opcional — o container precisa estar importado em Containers.">
        <select className="select" value={f.lxc_id} onChange={e => setF({ ...f, lxc_id: e.target.value })}>
          <option value="">Não instalar agora</option>
          {lxcs.map(c => <option key={c.id} value={c.id}>CT {c.vmid} · {c.name}</option>)}
        </select>
      </Field>
    </Modal>
  )
}

function AddRoute({ tunnel, onClose, onDone }: { tunnel: Tunnel; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ public_url: '', service: 'http://localhost:80', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setSaving(true); setError(null)
    try {
      const r = await api.addRoute(tunnel.id, f)
      toast('success', 'Rota adicionada', r.dns ? 'CNAME criado na Cloudflare.' : tunnel.managed ? 'Verifique o DNS — o CNAME não foi criado.' : `Crie o CNAME ${f.public_url} → ${tunnel.tunnel_id}.cfargotunnel.com`)
      onDone()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }
  return (
    <Modal open onClose={onClose} title={`Nova rota em ${tunnel.name}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!f.public_url || !f.service} onClick={submit}>Adicionar rota</Button></>}>
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Hostname público"><input className="input mono" value={f.public_url} onChange={e => setF({ ...f, public_url: e.target.value })} placeholder="app.seudominio.com" autoFocus /></Field>
      <Field label="Serviço interno" hint="Visto a partir do container onde roda o cloudflared."><input className="input mono" value={f.service} onChange={e => setF({ ...f, service: e.target.value })} /></Field>
      <Field label="Descrição"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
    </Modal>
  )
}
