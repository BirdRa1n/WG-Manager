import { useEffect, useState } from 'react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { Plus, Trash2, RefreshCw, Download, ExternalLink, Cloud } from 'lucide-react'
import { C, shadow } from '../theme'

export default function CloudflareTunnels() {
  const [tunnels, setTunnels] = useState<any[]>([])
  const [lxcList, setLxcList] = useState<any[]>([])
  const [cfCreds, setCfCreds] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [routeModal, setRouteModal] = useState<any | null>(null)
  const [form, setForm] = useState({ name: '', account_id: '', api_token: '', lxc_id: '', existing_token: '', mode: 'api', cred_id: '' })
  const [routeForm, setRouteForm] = useState({ public_url: '', service: '', description: '' })

  const load = () => api.listTunnels().then(setTunnels)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setR = (k: string, v: string) => setRouteForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    load()
    api.listLXC().then(setLxcList)
    api.listCredentials().then((creds: any[]) => {
      const cf = creds.filter(c => c.provider === 'cloudflare')
      setCfCreds(cf)
      if (cf.length > 0) setForm(f => ({ ...f, cred_id: String(cf[0].id) }))
    })
  }, [])

  async function createTunnel(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createTunnel({ ...form, lxc_id: form.lxc_id ? parseInt(form.lxc_id) : null, cred_id: form.cred_id ? parseInt(form.cred_id) : null })
      setShowAdd(false)
      setForm({ name: '', account_id: '', api_token: '', lxc_id: '', existing_token: '', mode: 'api', cred_id: cfCreds[0] ? String(cfCreds[0].id) : '' })
      load()
    } catch (err: any) { alert(`Erro: ${err.message}`) }
  }

  async function addRoute(e: React.FormEvent) {
    e.preventDefault()
    await api.addRoute(routeModal.id, routeForm)
    setRouteModal(null); setRouteForm({ public_url: '', service: '', description: '' }); load()
  }

  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Cloudflare Zero Trust</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>Exponha serviços HTTP/HTTPS sem abrir portas na VPS</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...btnBase, background: C.cyan + 'cc', color: 'white' }}>
          <Plus size={15} /> Novo Tunnel
        </button>
      </div>

      {showAdd && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: shadow.md }}>
          <h3 style={{ color: C.text, marginTop: 0, marginBottom: 20 }}>Configurar Tunnel Cloudflare</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {['token', 'api'].map(m => (
              <button key={m} type="button" onClick={() => set('mode', m)} style={{ ...btnBase, background: form.mode === m ? C.cyan + '20' : C.surface2, color: form.mode === m ? C.cyanL : C.text2, border: `1px solid ${form.mode === m ? C.cyan + '60' : C.border}` }}>
                {m === 'token' ? '📋 Colar token do dashboard' : '🔑 Criar via API'}
              </button>
            ))}
          </div>
          <form onSubmit={createTunnel} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={lbl}>Nome do Tunnel</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ex: meu-servico-web" required style={inp} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Credencial Cloudflare</label>
              {cfCreds.length > 0 ? (
                <select value={form.cred_id} onChange={e => set('cred_id', e.target.value)} style={inp}>
                  {cfCreds.map(c => <option key={c.id} value={c.id}>{c.name} — {c.permission_labels?.join(', ') || 'sem permissões verificadas'}</option>)}
                  <option value="">Inserir manualmente...</option>
                </select>
              ) : (
                <div style={{ background: C.yellow + '10', border: `1px solid ${C.yellow}40`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.yellow }}>
                  ⚠ Nenhuma credencial Cloudflare. <a href="/credentials" style={{ color: C.blueL }}>Cadastre em Credenciais de API</a>
                </div>
              )}
            </div>
            {!form.cred_id && (<>
              {form.mode === 'api' && (
                <div>
                  <label style={lbl}>Account ID</label>
                  <input value={form.account_id} onChange={e => set('account_id', e.target.value)} placeholder="ID da sua conta Cloudflare" style={inp} />
                </div>
              )}
              <div style={{ gridColumn: form.mode === 'api' ? '1 / -1' : undefined }}>
                <label style={lbl}>API Token</label>
                <input value={form.api_token} onChange={e => set('api_token', e.target.value)} placeholder="Token de API da Cloudflare" style={inp} type="password" />
              </div>
            </>)}
            {form.mode === 'token' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: C.green + '10', border: `1px solid ${C.green}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.text2, marginBottom: 10 }}>
                  Dashboard CF → Zero Trust → Networks → Tunnels → Criar → Cloudflared → copie o token do comando
                </div>
                <label style={lbl}>Token do tunnel (eyJ...)</label>
                <input value={form.existing_token} onChange={e => set('existing_token', e.target.value)} placeholder="Cole o token gerado no dashboard da Cloudflare" required={form.mode === 'token'} style={inp} />
              </div>
            )}
            <div>
              <label style={lbl}>Instalar cloudflared em qual LXC</label>
              <select value={form.lxc_id} onChange={e => set('lxc_id', e.target.value)} style={inp}>
                <option value="">Instalar manualmente depois</option>
                {lxcList.map(c => <option key={c.id} value={c.id}>{c.name} (CT-{c.vmid})</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
              <button type="submit" style={{ ...btnBase, background: C.cyan + 'cc', color: 'white' }}>
                {form.mode === 'token' ? 'Salvar e Instalar' : 'Criar via API e Instalar'}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {routeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 460, boxShadow: shadow.lg }}>
            <h3 style={{ color: C.text, marginTop: 0 }}>Adicionar Rota — {routeModal.name}</h3>
            <form onSubmit={addRoute} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lbl}>URL pública (ex: app.birdra1n.com)</label>
                <input value={routeForm.public_url} onChange={e => setR('public_url', e.target.value)} placeholder="ex: app.seudominio.com" required style={inp} />
              </div>
              <div>
                <label style={lbl}>Serviço interno (ex: http://localhost:8086)</label>
                <input value={routeForm.service} onChange={e => setR('service', e.target.value)} placeholder="ex: http://localhost:3000" required style={inp} />
              </div>
              <div>
                <label style={lbl}>Descrição</label>
                <input value={routeForm.description} onChange={e => setR('description', e.target.value)} placeholder="ex: Painel de armazenamento" style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" style={{ ...btnBase, background: C.cyan + 'cc', color: 'white' }}>Adicionar Rota</button>
                <button type="button" onClick={() => setRouteModal(null)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tunnels.map(t => (
          <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, boxShadow: shadow.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: C.cyan + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Cloud size={18} color={C.cyan} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.text, fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                  <StatusBadge status={t.status} />
                </div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 3, fontFamily: 'monospace' }}>{t.tunnel_id}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => api.tunnelStatus(t.id).then(load)} title="Atualizar status"
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', color: C.text2, cursor: 'pointer', display: 'flex' }}>
                  <RefreshCw size={14} />
                </button>
                {t.lxc_id && (
                  <button onClick={() => api.installCloudflared(t.id)} title="Instalar cloudflared"
                    style={{ background: C.green + '20', border: `1px solid ${C.green}40`, borderRadius: 8, padding: '7px 10px', color: C.greenL, cursor: 'pointer', display: 'flex' }}>
                    <Download size={14} />
                  </button>
                )}
                <button onClick={() => setRouteModal(t)} title="Adicionar rota"
                  style={{ background: C.purple + '20', border: `1px solid ${C.purple}40`, borderRadius: 8, padding: '7px 10px', color: C.purpleL, cursor: 'pointer', display: 'flex' }}>
                  <Plus size={14} />
                </button>
                <button onClick={() => api.deleteTunnel(t.id).then(load)} title="Remover"
                  style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '7px 10px', color: C.red, cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {t.routes?.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>ROTAS ATIVAS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {t.routes.map((r: any) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface2, borderRadius: 8, padding: '9px 14px' }}>
                      <a href={`https://${r.public_url}`} target="_blank" rel="noreferrer"
                        style={{ color: C.purpleL, fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ExternalLink size={12} /> {r.public_url}
                      </a>
                      <span style={{ color: C.muted }}>→</span>
                      <span style={{ color: C.text2, fontSize: 13 }}>{r.service}</span>
                      {r.description && <span style={{ color: C.muted, fontSize: 12 }}>• {r.description}</span>}
                      <button onClick={() => api.deleteRoute(t.id, r.id).then(load)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, marginLeft: 'auto', padding: 4, display: 'flex' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: C.muted, fontSize: 13, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                Nenhuma rota — clique em + para adicionar
              </div>
            )}
          </div>
        ))}
        {tunnels.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
            <Cloud size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Nenhum tunnel configurado</div>
          </div>
        )}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }
const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
