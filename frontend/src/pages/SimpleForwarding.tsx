import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, AlertTriangle, Download, Upload, CheckCircle, Share2 } from 'lucide-react'
import { C, shadow } from '../theme'

export default function SimpleForwarding() {
  const [rules, setRules] = useState<any[]>([])
  const [vpsList, setVpsList] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [selVpsSync, setSelVpsSync] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<any | null>(null)
  const [form, setForm] = useState({ vps_id: '', port: '', protocol: 'tcp', target_ip: '', target_port: '', description: '' })

  const load = () => api.listPorts().then(r => setRules(r.filter((x: any) => x.mode === 'simple_dnat')))
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { load(); api.listVPS().then(setVpsList) }, [])

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    await api.createPort({ vps_id: parseInt(form.vps_id), port: parseInt(form.port), protocol: form.protocol, mode: 'simple_dnat', target_ip: form.target_ip, target_port: form.target_port ? parseInt(form.target_port) : parseInt(form.port), description: form.description })
    setShowAdd(false)
    setForm({ vps_id: '', port: '', protocol: 'tcp', target_ip: '', target_port: '', description: '' })
    load()
  }

  async function runSync() {
    if (!selVpsSync) return
    setSyncing(true); setSyncResult(null)
    try { const r = await api.syncFromVPS(parseInt(selVpsSync)); setSyncResult(r) } catch (e: any) { alert(e.message) }
    setSyncing(false)
  }

  async function importRules(rules: any[]) { await api.importFromVPS(parseInt(selVpsSync), rules); setSyncResult(null); load() }
  async function applyMissing(rules: any[]) { await api.applyMissingToVPS(parseInt(selVpsSync), rules); setSyncResult((p: any) => p ? { ...p, missing_on_vps: [] } : null) }

  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Redirecionamento Simples (DNAT)</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>Redireciona portas da VPS sem WireGuard na LXC</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...btnBase, background: C.blue, color: 'white' }}>
          <Plus size={15} /> Nova Regra
        </button>
      </div>

      {/* Sync Panel */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RefreshCw size={15} color={C.blue} />
          <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Sincronizar com VPS</span>
          <select value={selVpsSync} onChange={e => { setSelVpsSync(e.target.value); setSyncResult(null) }}
            style={{ ...inpSt, width: 240, marginLeft: 8 }}>
            <option value="">Selecione a VPS...</option>
            {vpsList.map(v => <option key={v.id} value={v.id}>{v.name} ({v.host})</option>)}
          </select>
          <button onClick={runSync} disabled={!selVpsSync || syncing}
            style={{ ...btnBase, background: C.surface2, color: C.text2, border: `1px solid ${C.border}`, opacity: (!selVpsSync || syncing) ? 0.5 : 1 }}>
            <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Verificando...' : 'Verificar Agora'}
          </button>
        </div>

        {syncResult && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 16 }}>
            {syncResult.missing_in_db.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={15} color={C.yellow} />
                  <span style={{ color: C.yellow, fontWeight: 600, fontSize: 13 }}>
                    {syncResult.missing_in_db.length} regra(s) no VPS não cadastradas no painel
                  </span>
                  <button onClick={() => importRules(syncResult.missing_in_db)}
                    style={{ ...btnBase, marginLeft: 'auto', padding: '4px 10px', background: C.green + '20', color: C.greenL }}>
                    <Download size={11} /> Importar todas
                  </button>
                </div>
                {syncResult.missing_in_db.map((r: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.yellow + '08', border: `1px solid ${C.yellow}20`, borderRadius: 8, padding: '8px 14px', marginBottom: 6 }}>
                    <span style={{ color: C.yellow, fontWeight: 700, fontFamily: 'monospace' }}>{r.port}</span>
                    <span style={{ color: C.muted, fontSize: 12 }}>/{r.protocol.toUpperCase()}</span>
                    <span style={{ color: C.text2 }}>→</span>
                    <span style={{ color: C.blueL, fontSize: 13, fontFamily: 'monospace' }}>{r.target_ip}:{r.target_port}</span>
                    <button onClick={() => importRules([r])}
                      style={{ ...btnBase, marginLeft: 'auto', padding: '3px 8px', background: C.green + '20', color: C.greenL }}>
                      <Download size={11} /> Importar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {syncResult.missing_on_vps.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={15} color={C.red} />
                  <span style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>
                    {syncResult.missing_on_vps.length} regra(s) no painel ausentes no VPS
                  </span>
                  <button onClick={() => applyMissing(syncResult.missing_on_vps)}
                    style={{ ...btnBase, marginLeft: 'auto', padding: '4px 10px', background: C.blue + '20', color: C.blueL }}>
                    <Upload size={11} /> Reaplicar todas
                  </button>
                </div>
                {syncResult.missing_on_vps.map((r: any) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.red + '08', border: `1px solid ${C.red}20`, borderRadius: 8, padding: '8px 14px', marginBottom: 6 }}>
                    <span style={{ color: C.red, fontWeight: 700, fontFamily: 'monospace' }}>{r.port}</span>
                    <span style={{ color: C.muted, fontSize: 12 }}>/{r.protocol.toUpperCase()}</span>
                    <span style={{ color: C.text2 }}>→</span>
                    <span style={{ color: C.blueL, fontSize: 13, fontFamily: 'monospace' }}>{r.target_ip}:{r.target_port}</span>
                    {r.description && <span style={{ color: C.muted, fontSize: 12 }}>• {r.description}</span>}
                    <button onClick={() => applyMissing([r])}
                      style={{ ...btnBase, marginLeft: 'auto', padding: '3px 8px', background: C.blue + '20', color: C.blueL }}>
                      <Upload size={11} /> Reaplicar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {syncResult.missing_in_db.length === 0 && syncResult.missing_on_vps.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.green, fontSize: 13 }}>
                <CheckCircle size={15} />
                Painel sincronizado — nenhuma divergência encontrada
              </div>
            )}
            <div style={{ marginTop: 10, color: C.muted, fontSize: 12 }}>
              {syncResult.live_rules.length} regra(s) ativa(s) no iptables do VPS
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: shadow.md }}>
          <h3 style={{ color: C.text, marginTop: 0, marginBottom: 20 }}>Nova Regra DNAT</h3>
          <form onSubmit={addRule} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={lbl}>VPS</label>
              <select value={form.vps_id} onChange={e => set('vps_id', e.target.value)} required style={inpSt}>
                <option value="">Selecione...</option>
                {vpsList.map(v => <option key={v.id} value={v.id}>{v.name} ({v.host})</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Porta pública (na VPS)</label>
              <input value={form.port} onChange={e => set('port', e.target.value)} placeholder="ex: 8080" required style={inpSt} type="number" />
            </div>
            <div>
              <label style={lbl}>IP de destino interno</label>
              <input value={form.target_ip} onChange={e => set('target_ip', e.target.value)} placeholder="ex: 192.168.1.100" required style={inpSt} />
            </div>
            <div>
              <label style={lbl}>Porta de destino (padrão = mesma)</label>
              <input value={form.target_port} onChange={e => set('target_port', e.target.value)} placeholder="deixe vazio para usar a mesma" style={inpSt} type="number" />
            </div>
            <div>
              <label style={lbl}>Protocolo</label>
              <select value={form.protocol} onChange={e => set('protocol', e.target.value)} style={inpSt}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="both">TCP + UDP</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Descrição</label>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="ex: Broker MQTT, Servidor de Jogo..." style={inpSt} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
              <button type="submit" style={{ ...btnBase, background: C.blue, color: 'white' }}>Aplicar</button>
              <button type="button" onClick={() => setShowAdd(false)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rules.map(r => {
          const vps = vpsList.find(v => v.id === r.vps_id)
          return (
            <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', opacity: r.enabled ? 1 : 0.6, boxShadow: shadow.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: C.yellow + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: C.yellow, fontWeight: 800, fontFamily: 'monospace', fontSize: 15 }}>{r.port}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.muted, fontSize: 12 }}>{r.protocol.toUpperCase()}</span>
                    <span style={{ color: C.text2 }}>→</span>
                    <span style={{ color: C.blueL, fontFamily: 'monospace' }}>{r.target_ip}:{r.target_port || r.port}</span>
                    <span style={{ color: C.muted, fontSize: 12 }}>via {vps?.name || 'VPS'}</span>
                    {r.description && <span style={{ color: C.muted, fontSize: 12 }}>• {r.description}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => api.togglePort(r.id).then(load)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                    {r.enabled ? <ToggleRight size={22} color={C.green} /> : <ToggleLeft size={22} color={C.muted} />}
                  </button>
                  <button onClick={() => api.deletePort(r.id).then(load)}
                    style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '7px 10px', color: C.red, cursor: 'pointer', display: 'flex' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        {rules.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
            <Share2 size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Nenhum redirecionamento configurado</div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const lbl: React.CSSProperties = { color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }
const inpSt: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
