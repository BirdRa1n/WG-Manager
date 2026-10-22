import { useState } from 'react'
import { BadgeCheck, KeyRound, Plus, ShieldQuestion, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { Badge, Button, Callout, Empty, Field, fmtAgoIso, Modal, PageHeader, Skeleton, useAsync, useConfirm, useToast } from '../ui'

const PERMS = [
  { key: 'tunnel_edit', label: 'Cloudflare Tunnel: Edit' },
  { key: 'dns_edit', label: 'DNS: Edit' },
  { key: 'zone_read', label: 'Zone: Read' },
]

export default function Credentials() {
  const toast = useToast()
  const confirm = useConfirm()
  const creds = useAsync(api.listCredentials)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)

  async function verify(id: number) {
    setBusy(id)
    try {
      const r = await api.verifyCredential(id)
      r.ok ? toast('success', 'Token válido', `${r.permissions.length}/3 permissões detectadas`) : toast('error', 'Token inválido', r.error)
    } catch (e: any) { toast('error', 'Falhou', e.message) }
    setBusy(null)
    creds.reload()
  }

  return (
    <>
      <PageHeader title="Credenciais" sub="Tokens de API usados para criar túneis e registros DNS. Ficam apenas no banco do host."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Adicionar token</Button>} />
      {!creds.data ? <Skeleton h={120} /> : !creds.data.length ? (
        <div className="card"><Empty icon={<KeyRound size={22} />} title="Nenhuma credencial" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Adicionar token</Button>}>
          Crie um API Token na Cloudflare com <b>Cloudflare Tunnel: Edit</b>, <b>DNS: Edit</b> e <b>Zone: Read</b>.
        </Empty></div>
      ) : (
        <div className="grid grid-2">
          {creds.data.map(c => (
            <div key={c.id} className="card card-pad stack">
              <div className="between">
                <div className="row"><div className="stat-icon" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><KeyRound size={16} /></div>
                  <div><b>{c.name}</b><div className="muted mono" style={{ fontSize: 12 }}>{c.api_token_preview} · conta {c.account_id ? c.account_id.slice(0, 8) + '…' : '—'}</div></div></div>
                <Badge>{c.provider}</Badge>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {PERMS.map(p => (
                  <Badge key={p.key} tone={c.permissions.includes(p.key) ? 'success' : ''}>
                    {c.permissions.includes(p.key) ? <BadgeCheck size={12} /> : <ShieldQuestion size={12} />}{p.label}
                  </Badge>
                ))}
              </div>
              {c.notes && <p className="text-2" style={{ fontSize: 13 }}>{c.notes}</p>}
              <div className="between">
                <span className="muted" style={{ fontSize: 12 }}>Adicionado {fmtAgoIso(c.created_at)}</span>
                <div className="row">
                  <Button size="sm" loading={busy === c.id} onClick={() => verify(c.id)}>Verificar</Button>
                  <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label="Excluir"
                    onClick={async () => { if (await confirm({ title: `Excluir ${c.name}?`, danger: true, confirm: 'Excluir', body: 'Túneis já criados continuam funcionando, mas o painel não poderá mais gerenciar DNS deles com esta credencial.' })) { await api.deleteCredential(c.id); creds.reload() } }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <AddCredential open={adding} onClose={() => setAdding(false)} onDone={id => { setAdding(false); creds.reload(); verify(id) }} />
    </>
  )
}

function AddCredential({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState({ name: '', account_id: '', api_token: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setSaving(true); setError(null)
    try { const c = await api.createCredential({ ...f, provider: 'cloudflare' }); setF({ name: '', account_id: '', api_token: '', notes: '' }); onDone(c.id) } catch (e: any) { setError(e.message) }
    setSaving(false)
  }
  return (
    <Modal open={open} onClose={onClose} title="Adicionar token Cloudflare" sub="O token é verificado logo após salvar."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!f.name || !f.api_token} onClick={submit}>Salvar e verificar</Button></>}>
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Nome"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Cloudflare pessoal" autoFocus /></Field>
      <Field label="Account ID" hint="Painel da Cloudflare → barra lateral da conta."><input className="input mono" value={f.account_id} onChange={e => setF({ ...f, account_id: e.target.value })} /></Field>
      <Field label="API Token"><input className="input mono" type="password" value={f.api_token} onChange={e => setF({ ...f, api_token: e.target.value })} autoComplete="off" /></Field>
      <Field label="Notas"><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  )
}
