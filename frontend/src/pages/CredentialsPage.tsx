import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Plus, Trash2, ShieldCheck, Key, CheckCircle, Loader, KeyRound } from 'lucide-react'
import { C, shadow } from '../theme'

const PERMISSION_INFO: Record<string, { label: string; desc: string; color: string }> = {
  tunnel_edit: { label: 'Tunnel: Edit', desc: 'Criar e gerenciar tunnels Zero Trust', color: C.purple },
  dns_edit:    { label: 'DNS: Edit',    desc: 'Criar/atualizar registros DNS automaticamente', color: C.blue },
  zone_read:   { label: 'Zone: Read',   desc: 'Listar zonas e domínios da conta', color: C.green },
}

export default function CredentialsPage() {
  const [list, setList] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [verifying, setVerifying] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', provider: 'cloudflare', account_id: '', api_token: '', notes: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const load = () => api.listCredentials().then(setList)
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    try { await api.createCredential(form); setShowAdd(false); setForm({ name: '', provider: 'cloudflare', account_id: '', api_token: '', notes: '' }); load() }
    catch (err: any) { alert(err.message) }
  }

  async function verify(id: number) {
    setVerifying(id)
    try { await api.verifyCredential(id); load() } catch (err: any) { alert(err.message) }
    setVerifying(null)
  }

  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Credenciais de API</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>Chaves de API para operações automáticas do painel</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...btnBase, background: C.blue, color: 'white' }}>
          <Plus size={15} /> Adicionar
        </button>
      </div>

      {showAdd && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: shadow.md }}>
          <h3 style={{ color: C.text, marginTop: 0, marginBottom: 20 }}>Nova Credencial</h3>
          <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={lbl}>Nome</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ex: Cloudflare Produção" required style={inp} />
            </div>
            <div>
              <label style={lbl}>Provedor</label>
              <select value={form.provider} onChange={e => set('provider', e.target.value)} style={inp}>
                <option value="cloudflare">Cloudflare</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Account ID <span style={{ color: C.muted }}>(necessário para Tunnels)</span></label>
              <input value={form.account_id} onChange={e => set('account_id', e.target.value)} placeholder="ID da sua conta Cloudflare" style={inp} />
            </div>
            <div>
              <label style={lbl}>API Token</label>
              <input value={form.api_token} onChange={e => set('api_token', e.target.value)} placeholder="Token de API gerado no painel da Cloudflare" required type="password" style={inp} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Notas (opcional)</label>
              <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="ex: Token com permissões Tunnel:Edit e DNS:Edit" style={inp} />
            </div>

            <div style={{ gridColumn: '1 / -1', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ color: C.text2, fontSize: 12, marginBottom: 10 }}>
                Permissões necessárias ao criar o token em <span style={{ color: C.blueL }}>dash.cloudflare.com/profile/api-tokens</span>:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(PERMISSION_INFO).map(([key, p]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ background: p.color + '20', color: p.color, border: `1px solid ${p.color}40`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{p.label}</span>
                    <span style={{ color: C.muted, fontSize: 12 }}>{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
              <button type="submit" style={{ ...btnBase, background: C.blue, color: 'white' }}>Salvar</button>
              <button type="button" onClick={() => setShowAdd(false)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.map(c => (
          <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: shadow.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: C.yellow + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Key size={18} color={C.yellow} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ color: C.muted, fontSize: 11, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px' }}>{c.provider}</span>
                  {c.account_id && <span style={{ color: C.muted, fontSize: 11 }}>Account: {c.account_id.slice(0, 8)}...</span>}
                </div>
                <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>
                  Token: <code style={{ color: C.text2 }}>{c.api_token_preview}</code>
                  {c.notes && <span style={{ marginLeft: 12 }}>• {c.notes}</span>}
                </div>
                {c.permissions?.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {c.permissions.map((p: string) => {
                      const info = PERMISSION_INFO[p]
                      return info ? (
                        <span key={p} style={{ background: info.color + '20', color: info.color, border: `1px solid ${info.color}40`, borderRadius: 4, padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle size={10} /> {info.label}
                        </span>
                      ) : null
                    })}
                  </div>
                ) : (
                  <span style={{ color: C.muted, fontSize: 12 }}>Permissões não verificadas — clique em Verificar</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => verify(c.id)} disabled={verifying === c.id}
                  style={{ ...btnBase, background: C.green + '20', color: C.greenL, padding: '7px 12px' }}>
                  {verifying === c.id
                    ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    : <ShieldCheck size={13} />}
                  {verifying === c.id ? 'Verificando...' : 'Verificar'}
                </button>
                <button onClick={() => api.deleteCredential(c.id).then(load)}
                  style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '7px 10px', color: C.red, cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
            <KeyRound size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Nenhuma credencial cadastrada</div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const lbl: React.CSSProperties = { color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }
const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
