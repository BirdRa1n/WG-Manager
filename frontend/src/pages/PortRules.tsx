import { useEffect, useState } from 'react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { Plus, Trash2, ToggleLeft, ToggleRight, ArrowRightLeft, Pencil, X } from 'lucide-react'
import { C, shadow } from '../theme'

const emptyForm = { vps_id: '', lxc_id: '', port: '', protocol: 'tcp', mode: 'split_tunnel', target_ip: '', description: '' }

const lbl: React.CSSProperties = { color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }
const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const modeLabel: Record<string, string> = { split_tunnel: 'Split Tunnel', full_tunnel: 'Full Tunnel', simple_dnat: 'DNAT' }
const modeColor: Record<string, string> = { split_tunnel: C.blue, full_tunnel: C.purple, simple_dnat: C.yellow }
const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

export default function PortRules() {
  const [rules, setRules] = useState<any[]>([])
  const [vpsList, setVpsList] = useState<any[]>([])
  const [lxcList, setLxcList] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  const load = () => api.listPorts().then(setRules)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { load(); api.listVPS().then(setVpsList); api.listLXC().then(setLxcList) }, [])

  function openEdit(r: any) {
    setEditingId(r.id)
    setShowAdd(false)
    setForm({
      vps_id: String(r.vps_id),
      lxc_id: r.lxc_id ? String(r.lxc_id) : '',
      port: String(r.port),
      protocol: r.protocol,
      mode: r.mode,
      target_ip: r.target_ip || '',
      description: r.description || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ ...emptyForm })
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    await api.createPort({
      vps_id: parseInt(form.vps_id),
      lxc_id: form.lxc_id ? parseInt(form.lxc_id) : null,
      port: parseInt(form.port),
      protocol: form.protocol,
      mode: form.mode,
      target_ip: form.target_ip || null,
      description: form.description,
    })
    setShowAdd(false)
    setForm({ ...emptyForm })
    load()
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    await api.updatePort(editingId!, {
      vps_id: parseInt(form.vps_id),
      lxc_id: form.lxc_id ? parseInt(form.lxc_id) : null,
      port: parseInt(form.port),
      protocol: form.protocol,
      mode: form.mode,
      target_ip: form.target_ip || null,
      description: form.description,
    })
    cancelEdit()
    load()
  }

  const formFields = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <label style={lbl}>VPS</label>
        <select value={form.vps_id} onChange={e => set('vps_id', e.target.value)} required style={inp}>
          <option value="">Selecione...</option>
          {vpsList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>LXC destino</label>
        <select value={form.lxc_id} onChange={e => {
          const lxc = lxcList.find(c => c.id === parseInt(e.target.value))
          setForm(f => ({
            ...f,
            lxc_id: e.target.value,
            target_ip: lxc?.wg_address ? lxc.wg_address.split('/')[0] : f.target_ip,
          }))
        }} style={inp}>
          <option value="">IP manual</option>
          {lxcList.filter(c => c.wg_address).map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.wg_address})</option>
          ))}
        </select>
      </div>
      <div>
        <label style={lbl}>IP de destino</label>
        <input value={form.target_ip} onChange={e => set('target_ip', e.target.value)} placeholder="ex: 192.168.1.100" style={inp} />
      </div>
      <div>
        <label style={lbl}>Porta</label>
        <input value={form.port} onChange={e => set('port', e.target.value)} placeholder="ex: 443" required style={inp} type="number" />
      </div>
      <div>
        <label style={lbl}>Protocolo</label>
        <select value={form.protocol} onChange={e => set('protocol', e.target.value)} style={inp}>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="both">TCP + UDP</option>
        </select>
      </div>
      <div>
        <label style={lbl}>Modo</label>
        <select value={form.mode} onChange={e => set('mode', e.target.value)} style={inp}>
          <option value="split_tunnel">Split Tunnel — economiza banda</option>
          <option value="full_tunnel">Full Tunnel — todo tráfego pela VPS</option>
          <option value="simple_dnat">DNAT Simples — sem WireGuard na LXC</option>
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={lbl}>Descrição (opcional)</label>
        <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="ex: HTTPS Painel Web" style={inp} />
      </div>
    </div>
  )

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Regras de Porta</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>
            {rules.filter(r => r.enabled).length} ativas · {rules.length} total
          </p>
        </div>
        <button onClick={() => { setShowAdd(v => !v); cancelEdit() }} style={{ ...btnBase, background: C.blue, color: 'white' }}>
          <Plus size={15} /> Nova Regra
        </button>
      </div>

      {showAdd && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: shadow.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h3 style={{ color: C.text, margin: 0, fontSize: 16 }}>Nova Regra de Porta</h3>
            <button onClick={() => { setShowAdd(false); setForm({ ...emptyForm }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4, display: 'flex' }}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={addRule}>
            {formFields}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="submit" style={{ ...btnBase, background: C.blue, color: 'white' }}>Aplicar Regra</button>
              <button type="button" onClick={() => { setShowAdd(false); setForm({ ...emptyForm }) }} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {editingId !== null && (
        <div style={{ background: C.surface, border: `1px solid ${C.blue}40`, borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: shadow.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h3 style={{ color: C.text, margin: 0, fontSize: 16 }}>
              Editar Regra <span style={{ color: C.blueL, fontFamily: 'monospace' }}>#{editingId}</span>
            </h3>
            <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4, display: 'flex' }}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={saveEdit}>
            {formFields}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="submit" style={{ ...btnBase, background: C.blue, color: 'white' }}>Salvar Alterações</button>
              <button type="button" onClick={cancelEdit} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.surface2 }}>
              {['Porta', 'Proto', 'Modo', 'VPS', 'Destino', 'Descrição', 'Status', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', borderBottom: `1px solid ${C.border}` }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map(r => {
              const vps = vpsList.find(v => v.id === r.vps_id)
              const lxc = lxcList.find(c => c.id === r.lxc_id)
              const isEditing = editingId === r.id
              return (
                <tr key={r.id} style={{
                  borderBottom: `1px solid ${C.border}`,
                  opacity: r.enabled ? 1 : 0.55,
                  background: isEditing ? C.blue + '08' : 'transparent',
                  transition: 'background 0.15s',
                }}>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: C.blueL, fontWeight: 700, fontSize: 16, fontFamily: 'monospace' }}>{r.port}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: C.muted, fontSize: 12, background: C.surface2, borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' }}>{r.protocol.toUpperCase()}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: modeColor[r.mode] || C.text2, fontSize: 12 }}>{modeLabel[r.mode] || r.mode}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: C.text2, fontSize: 13 }}>{vps?.name || r.vps_id}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, fontFamily: 'monospace' }}>
                    {lxc && <span style={{ color: C.text2, marginRight: 4 }}>{lxc.name}</span>}
                    <span style={{ color: C.blueL }}>{r.target_ip}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: C.muted, fontSize: 12 }}>{r.description || '—'}</td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={r.enabled ? 'running' : 'stopped'} /></td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => api.togglePort(r.id).then(load)} title="Ativar/Desativar"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                        {r.enabled ? <ToggleRight size={20} color={C.green} /> : <ToggleLeft size={20} color={C.muted} />}
                      </button>
                      <button onClick={() => isEditing ? cancelEdit() : openEdit(r)} title="Editar"
                        style={{ background: isEditing ? C.blue + '30' : C.surface2, border: `1px solid ${isEditing ? C.blue + '60' : C.border}`, borderRadius: 6, padding: '4px 8px', color: isEditing ? C.blueL : C.text2, cursor: 'pointer', display: 'flex' }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => api.deletePort(r.id).then(load)} title="Remover"
                        style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 6, padding: '4px 8px', color: C.red, cursor: 'pointer', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rules.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
            <ArrowRightLeft size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Nenhuma regra configurada</div>
          </div>
        )}
      </div>
    </div>
  )
}
