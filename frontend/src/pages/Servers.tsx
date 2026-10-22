import { useEffect, useState } from 'react'
import {
  Cable, Fingerprint, KeyRound, Network, Plus, Radar, RefreshCw, Server, Settings2, ShieldCheck, Trash2, Upload, Users, Wrench,
} from 'lucide-react'
import { api, Peer, VPS } from '../api/client'
import {
  Badge, Button, Callout, Drawer, Empty, Field, fmtAgo, fmtAgoIso, fmtBytes, Modal, PageHeader, Skeleton, Tabs,
  useAsync, useConfirm, useToast,
} from '../ui'

function vpsHealth(v: VPS): { tone: string; label: string } {
  if (v.last_error) return { tone: 'danger', label: 'inacessível' }
  if (v.status === 'wg_ready') return { tone: 'success', label: 'WireGuard ativo' }
  if (v.status === 'connected') return { tone: 'info', label: 'SSH ok' }
  return { tone: 'warn', label: 'pendente' }
}

export default function Servers() {
  const list = useAsync(api.listVPS, [], 30000)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const open = list.data?.find(v => v.id === openId)

  return (
    <>
      <PageHeader title="Servidores" sub="VPS públicas que recebem o tráfego e o encaminham pelo túnel WireGuard."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Adicionar VPS</Button>} />

      {list.loading && !list.data ? (
        <div className="grid grid-2">{[0, 1].map(i => <div key={i} className="card card-pad"><Skeleton h={110} /></div>)}</div>
      ) : !list.data?.length ? (
        <div className="card"><Empty icon={<Server size={22} />} title="Nenhuma VPS cadastrada" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Adicionar VPS</Button>}>
          Cadastre a VPS com IP público (ex.: Oracle Cloud) usando a chave SSH dela. Depois use <b>Detectar</b> para importar o WireGuard já existente.
        </Empty></div>
      ) : (
        <div className="grid grid-2">
          {list.data.map(v => {
            const h = vpsHealth(v)
            return (
              <div key={v.id} className="card card-pad interactive" onClick={() => setOpenId(v.id)}>
                <div className="between" style={{ marginBottom: 14 }}>
                  <div className="row">
                    <div className="stat-icon" style={{ width: 40, height: 40, background: `var(--${h.tone}-soft)`, color: `var(--${h.tone})` }}><Server size={19} /></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 650, fontSize: 15 }} className="truncate">{v.name}</div>
                      <div className="muted mono" style={{ fontSize: 12.5 }}>{v.ssh_user}@{v.host}</div>
                    </div>
                  </div>
                  <Badge tone={h.tone} dot live={h.tone === 'success'}>{h.label}</Badge>
                </div>
                <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                  <dt>Túnel</dt><dd className="mono">{v.wg_address ? `${v.wg_interface} · ${v.wg_address}` : <span className="muted">não configurado</span>}</dd>
                  <dt>Gateway (host)</dt><dd className="mono">{v.gw_ip ? `${v.gw_ip} via ${v.gw_iface}` : <span style={{ color: 'var(--warn)' }}>não definido</span>}</dd>
                  <dt>Encaminhamentos</dt><dd>{v.rules}</dd>
                  <dt>Último contato</dt><dd>{v.last_error ? <span style={{ color: 'var(--danger)' }} className="truncate">{v.last_error}</span> : fmtAgoIso(v.last_seen)}</dd>
                </dl>
              </div>
            )
          })}
        </div>
      )}

      <AddVPS open={adding} onClose={() => setAdding(false)} onCreated={v => { setAdding(false); list.reload(); setOpenId(v.id) }} />
      {open && <VPSDrawer vps={open} onClose={() => setOpenId(null)} onChange={list.reload} />}
    </>
  )
}

function AddVPS({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (v: VPS) => void }) {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', host: '', ssh_port: '22', ssh_user: 'ubuntu' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit() {
    if (!file) return
    setSaving(true); setError(null)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.append(k, v))
    fd.append('ssh_key', file)
    try {
      const v = await api.createVPS(fd)
      const t = await api.testVPS(v.id)
      if (t.ok) toast('success', 'VPS conectada', `Chave do servidor fixada: ${t.host_key}`)
      else toast('warn', 'VPS salva, mas o SSH falhou', t.error)
      setForm({ name: '', host: '', ssh_port: '22', ssh_user: 'ubuntu' }); setFile(null)
      onCreated(v)
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar VPS" sub="A chave privada fica no host com permissão 600 e nunca sai pela API."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!file || !form.name || !form.host} onClick={submit}>Adicionar e testar</Button></>}>
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="form-grid">
        <Field label="Nome" className="span-2"><input className="input" value={form.name} onChange={set('name')} placeholder="Oracle São Paulo" autoFocus /></Field>
        <Field label="IP público ou hostname" className="span-2"><input className="input mono" value={form.host} onChange={set('host')} placeholder="147.15.36.121" /></Field>
        <Field label="Usuário SSH" hint="Precisa de sudo sem senha se não for root."><input className="input mono" value={form.ssh_user} onChange={set('ssh_user')} /></Field>
        <Field label="Porta SSH"><input className="input mono" value={form.ssh_port} onChange={set('ssh_port')} inputMode="numeric" /></Field>
      </div>
      <label className="choice-card" style={{ borderStyle: 'dashed', alignItems: 'center' }}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]) }}>
        <Upload size={18} className="muted" />
        <div style={{ flex: 1 }}><div className="t">{file ? file.name : 'Chave privada SSH'}</div><div className="d">{file ? `${file.size} bytes` : 'Clique ou arraste o arquivo (.key, id_ed25519, .pem)'}</div></div>
        <input type="file" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>
    </Modal>
  )
}

type Tab = 'overview' | 'peers' | 'config'

function VPSDrawer({ vps, onClose, onChange }: { vps: VPS; onClose: () => void; onChange: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<any>, ok: (r: any) => void) {
    setBusy(key)
    try { ok(await fn()) } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
    onChange()
  }

  const test = () => run('test', () => api.testVPS(vps.id), r => r.ok
    ? toast('success', 'Conexão SSH ok', r.root ? 'Acesso root/sudo confirmado.' : 'Atenção: usuário sem sudo — as regras não poderão ser aplicadas.')
    : toast('error', 'SSH falhou', r.error))
  const detect = () => run('detect', () => api.detectVPS(vps.id), r => r.detected
    ? toast('success', 'WireGuard detectado', `${r.wg_address}${r.gateway ? ` · gateway ${r.gateway.ip} via ${r.gateway.iface}` : ' · gateway não encontrado neste host'}`)
    : toast('warn', 'Nada detectado', r.message))
  const install = async () => {
    if (!(await confirm({ title: 'Instalar WireGuard nesta VPS?', body: 'Instala wireguard-tools e cria um wg0 novo (10.10.0.1/24). Use apenas em VPS sem WireGuard — para uma VPS já configurada, use Detectar.', confirm: 'Instalar' }))) return
    run('install', () => api.installWGVPS(vps.id), () => toast('info', 'Instalação iniciada', 'Acompanhe o progresso em Atividade.'))
  }
  const del = async () => {
    if (!(await confirm({ title: `Excluir ${vps.name}?`, danger: true, confirm: 'Excluir', body: 'Remove a VPS e a chave SSH do painel. Nada é alterado no servidor. Encaminhamentos ativos impedem a exclusão.' }))) return
    run('delete', () => api.deleteVPS(vps.id), () => { toast('success', 'VPS removida'); onClose() })
  }

  return (
    <Drawer open wide onClose={onClose} title={vps.name} sub={<span className="mono">{vps.ssh_user}@{vps.host}:{vps.ssh_port}</span>}
      tabs={<Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: <><Radar size={14} />Visão geral</> },
        { value: 'peers', label: <><Users size={14} />Peers</> },
        { value: 'config', label: <><Settings2 size={14} />Configuração</> },
      ]} />}>
      {tab === 'overview' && <>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button icon={<Cable size={15} />} loading={busy === 'test'} onClick={test}>Testar SSH</Button>
          <Button icon={<Radar size={15} />} loading={busy === 'detect'} onClick={detect}>Detectar WireGuard e gateway</Button>
          {!vps.wg_public_key && <Button icon={<Wrench size={15} />} loading={busy === 'install'} onClick={install}>Instalar WireGuard</Button>}
        </div>
        {vps.last_error && <Callout tone="danger" title="Último erro de conexão">{vps.last_error}</Callout>}
        {!vps.gw_ip && vps.wg_public_key && (
          <Callout tone="warn" title="Gateway não configurado">Sem o IP do host Proxmox no túnel, só é possível encaminhar direto para peers. Clique em <b>Detectar</b> ou preencha em Configuração.</Callout>
        )}
        <div className="card card-pad" style={{ boxShadow: 'none' }}>
          <dl className="kv">
            <dt>Status</dt><dd><Badge tone={vpsHealth(vps).tone} dot>{vpsHealth(vps).label}</Badge></dd>
            <dt>Interface pública</dt><dd className="mono">{vps.pub_interface}</dd>
            <dt>WireGuard</dt><dd className="mono">{vps.wg_address ? `${vps.wg_interface} · ${vps.wg_address} · :${vps.wg_listen_port}` : '—'}</dd>
            <dt>Chave pública WG</dt><dd className="mono" style={{ fontSize: 12 }}>{vps.wg_public_key || '—'}</dd>
            <dt>Gateway</dt><dd className="mono">{vps.gw_ip ? `${vps.gw_ip} (${vps.gw_iface} → ${vps.lan_iface})` : '—'}</dd>
            <dt>Chave SSH do host</dt><dd className="mono" style={{ fontSize: 12 }}>{vps.ssh_host_key || 'ainda não fixada'}</dd>
            <dt>Último contato</dt><dd>{fmtAgoIso(vps.last_seen)}</dd>
          </dl>
        </div>
      </>}
      {tab === 'peers' && <PeersTab vps={vps} />}
      {tab === 'config' && <ConfigTab vps={vps} onSaved={onChange} onDelete={del} deleting={busy === 'delete'} />}
    </Drawer>
  )
}

function PeersTab({ vps }: { vps: VPS }) {
  const toast = useToast()
  const confirm = useConfirm()
  const peers = useAsync(() => api.peers(vps.id), [vps.id], 30000)
  const [busy, setBusy] = useState<string | null>(null)

  async function remove(p: Peer) {
    if (!(await confirm({
      title: 'Remover peer?', danger: true, confirm: 'Remover peer',
      body: <>O peer <code>{p.pubkey.slice(0, 16)}…</code>{p.label ? ` (${p.label})` : ''} será removido do <code>{vps.wg_interface}</code> e do arquivo de configuração (fica um backup <code>.wgm-bak</code>).</>,
    }))) return
    setBusy(p.pubkey)
    try { await api.removePeer(vps.id, p.pubkey); toast('success', 'Peer removido'); peers.reload() } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
  }

  if (peers.error) return <Callout tone="danger">{peers.error}</Callout>
  if (!peers.data) return <div className="stack">{[0, 1, 2].map(i => <Skeleton key={i} h={44} />)}</div>
  const orphans = peers.data.filter(p => p.orphan)
  return (
    <>
      <div className="between">
        <span className="text-2">{peers.data.length} peer(s) em <code>{vps.wg_interface}</code></span>
        <Button size="sm" icon={<RefreshCw size={13} />} onClick={peers.reload}>Atualizar</Button>
      </div>
      {orphans.length > 0 && (
        <Callout tone="warn" title={`${orphans.length} peer(s) sem AllowedIPs`}>
          Isso acontece quando dois peers recebem o mesmo IP: o WireGuard move o IP para o último e o anterior fica mudo. Remova os que não usa mais.
        </Callout>
      )}
      <div className="card" style={{ boxShadow: 'none' }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Peer</th><th>IPs</th><th>Handshake</th><th>Tráfego</th><th /></tr></thead>
            <tbody>
              {peers.data.map(p => {
                const fresh = p.last_handshake && Date.now() / 1000 - p.last_handshake < 180
                return (
                  <tr key={p.pubkey}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label || <span className="muted">Desconhecido</span>}</div>
                      <div className="mono muted" style={{ fontSize: 11.5 }}>{p.pubkey.slice(0, 20)}…</div>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>{p.allowed_ips || <Badge tone="warn">nenhum</Badge>}</td>
                    <td><span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: fresh ? 'var(--success)' : 'var(--muted)' }} />{fmtAgo(p.last_handshake)}</span></td>
                    <td className="tnum muted" style={{ fontSize: 12 }}>↓ {fmtBytes(p.rx_bytes)} · ↑ {fmtBytes(p.tx_bytes)}</td>
                    <td>{p.kind === 'host'
                      ? <span title="Túnel do host Proxmox — não removível"><ShieldCheck size={15} color="var(--success)" /></span>
                      : <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} loading={busy === p.pubkey} onClick={() => remove(p)} aria-label="Remover peer" />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function ConfigTab({ vps, onSaved, onDelete, deleting }: { vps: VPS; onSaved: () => void; onDelete: () => void; deleting: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const init = () => ({
    name: vps.name, ssh_user: vps.ssh_user, ssh_port: String(vps.ssh_port), pub_interface: vps.pub_interface,
    wg_interface: vps.wg_interface, gw_ip: vps.gw_ip ?? '', gw_iface: vps.gw_iface ?? '', lan_iface: vps.lan_iface ?? 'vmbr0',
  })
  const [f, setF] = useState(init)
  const [saving, setSaving] = useState(false)
  useEffect(() => setF(init()), [vps.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement>) => setF(x => ({ ...x, [k]: e.target.value }))

  async function save() {
    setSaving(true)
    try {
      await api.updateVPS(vps.id, { ...f, ssh_port: parseInt(f.ssh_port), gw_ip: f.gw_ip || null, gw_iface: f.gw_iface || null } as any)
      toast('success', 'Configuração salva', 'Use Sincronizar em Encaminhamentos para reaplicar com os novos valores.')
      onSaved()
    } catch (e: any) { toast('error', 'Não salvo', e.message) }
    setSaving(false)
  }
  async function resetKey() {
    if (!(await confirm({ title: 'Esquecer a chave SSH do servidor?', body: 'Faça isso só se você reinstalou a VPS. A próxima conexão vai fixar a nova chave.', confirm: 'Esquecer chave' }))) return
    await api.resetHostKey(vps.id); toast('info', 'Chave esquecida'); onSaved()
  }

  return (
    <>
      <div className="stack">
        <div className="section-title"><KeyRound size={12} /> Acesso</div>
        <div className="form-grid">
          <Field label="Nome" className="span-2"><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label="Usuário SSH"><input className="input mono" value={f.ssh_user} onChange={set('ssh_user')} /></Field>
          <Field label="Porta SSH"><input className="input mono" value={f.ssh_port} onChange={set('ssh_port')} /></Field>
        </div>
      </div>
      <div className="stack">
        <div className="section-title"><Network size={12} /> Rede da VPS</div>
        <div className="form-grid">
          <Field label="Interface pública" hint="Onde chega o tráfego da internet."><input className="input mono" value={f.pub_interface} onChange={set('pub_interface')} /></Field>
          <Field label="Interface WireGuard"><input className="input mono" value={f.wg_interface} onChange={set('wg_interface')} /></Field>
        </div>
      </div>
      <div className="stack">
        <div className="section-title"><ShieldCheck size={12} /> Gateway no host Proxmox</div>
        <div className="form-grid">
          <Field label="IP do host no túnel" hint="Ex.: 10.10.0.2"><input className="input mono" value={f.gw_ip} onChange={set('gw_ip')} placeholder="10.10.0.2" /></Field>
          <Field label="Interface WG no host"><input className="input mono" value={f.gw_iface} onChange={set('gw_iface')} placeholder="wg0" /></Field>
          <Field label="Interface da LAN no host" className="span-2" hint="Bridge onde estão os containers (normalmente vmbr0)."><input className="input mono" value={f.lan_iface} onChange={set('lan_iface')} /></Field>
        </div>
      </div>
      <div className="row"><Button variant="primary" loading={saving} onClick={save}>Salvar configuração</Button></div>
      <div className="divider" />
      <div className="stack">
        <div className="section-title"><Fingerprint size={12} /> Segurança</div>
        <div className="between"><div><div>Chave SSH fixada</div><div className="mono muted" style={{ fontSize: 12 }}>{vps.ssh_host_key || 'nenhuma'}</div></div>
          <Button size="sm" onClick={resetKey} disabled={!vps.ssh_host_key}>Esquecer</Button></div>
        <div className="between"><div><div>Excluir VPS do painel</div><div className="muted" style={{ fontSize: 12 }}>Não altera nada no servidor.</div></div>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} />} loading={deleting} onClick={onDelete}>Excluir</Button></div>
      </div>
    </>
  )
}
