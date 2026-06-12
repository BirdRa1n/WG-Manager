import { useEffect, useState } from 'react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { Plus, Trash2, ShieldCheck, ShieldX, Wrench, Download, AlertTriangle, Box } from 'lucide-react'
import { C, shadow } from '../theme'

export default function LXCPage() {
  const [list, setList] = useState<any[]>([])
  const [vpsList, setVpsList] = useState<any[]>([])
  const [proxmoxList, setProxmoxList] = useState<any[]>([])
  const [showImport, setShowImport] = useState(false)
  const [issues, setIssues] = useState<Record<number, any[]>>({})
  const [installModal, setInstallModal] = useState<number | null>(null)
  const [selVps, setSelVps] = useState('')
  const [mode, setMode] = useState('split_tunnel')
  const [wgExisting, setWgExisting] = useState<any | null>(null)
  const [wgChecking, setWgChecking] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const ticket = localStorage.getItem('proxmox_ticket') || ''
  const csrf = localStorage.getItem('proxmox_csrf') || ''
  const load = () => api.listLXC().then(setList)

  useEffect(() => { load(); api.listVPS().then(setVpsList) }, [])

  async function loadProxmox() {
    setShowImport(true)
    const data = await api.listProxmoxLXC(ticket)
    setProxmoxList(data)
  }

  async function importCT(ct: any) {
    await api.importLXC({ vmid: ct.vmid, name: ct.name })
    load(); setShowImport(false)
  }

  async function checkPerms(id: number) {
    const r = await api.checkPermissions(id)
    setIssues(prev => ({ ...prev, [id]: r.issues }))
    load()
  }

  async function fixPerms(id: number) {
    await api.fixPermissions(id, ticket, csrf)
    checkPerms(id)
  }

  async function openInstallModal(lxcId: number) {
    setInstallModal(lxcId); setSelVps(''); setWgExisting(null); setConfirmReplace(false); setWgChecking(true)
    try { const r = await api.checkWGExisting(lxcId); setWgExisting(r) } catch {}
    setWgChecking(false)
  }

  async function installWG(lxcId: number) {
    if (!selVps) return alert('Selecione uma VPS')
    if (wgExisting?.config_exists && !confirmReplace) return
    try {
      if (wgExisting?.config_exists) await api.removeWGLXC(lxcId)
      await api.installWGLXC(lxcId, parseInt(selVps), mode)
      setInstallModal(null)
      alert('Instalação iniciada — acompanhe nos logs')
      setTimeout(load, 3000)
    } catch (e: any) { alert(`Erro: ${e.message}`) }
  }

  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s' }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>LXC Containers</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>{list.length} containers importados</p>
        </div>
        <button onClick={loadProxmox} style={{ ...btnBase, background: C.blue, color: 'white' }}>
          <Plus size={15} /> Importar do Proxmox
        </button>
      </div>

      {showImport && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ color: C.text, fontWeight: 600 }}>Containers disponíveis no Proxmox</span>
            <button onClick={() => setShowImport(false)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Fechar</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['VMID', 'Nome', 'Status', 'OS', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', borderBottom: `1px solid ${C.border}` }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proxmoxList.map(ct => (
                <tr key={ct.vmid} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 12px', color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>{ct.vmid}</td>
                  <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{ct.name}</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={ct.status} /></td>
                  <td style={{ padding: '10px 12px', color: C.text2, fontSize: 12 }}>{ct.features || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <button onClick={() => importCT(ct)} style={{ ...btnBase, background: C.green + '20', color: C.greenL, padding: '5px 12px' }}>Importar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {installModal !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 500, boxShadow: shadow.lg }}>
            <h3 style={{ color: C.text, marginTop: 0, marginBottom: 20 }}>Instalar WireGuard</h3>

            {wgChecking && <div style={{ color: C.text2, fontSize: 13, marginBottom: 16 }}>Verificando configuração existente...</div>}

            {!wgChecking && wgExisting && (wgExisting.installed || wgExisting.config_exists) && (
              <div style={{ background: C.yellow + '10', border: `1px solid ${C.yellow}40`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={16} color={C.yellow} />
                  <span style={{ color: C.yellow, fontWeight: 600, fontSize: 13 }}>WireGuard já detectado neste CT</span>
                </div>
                <div style={{ color: C.text2, fontSize: 12, marginBottom: 8 }}>
                  {wgExisting.running && <div>• Serviço <b style={{ color: C.yellowL }}>wg0 ativo</b></div>}
                  {wgExisting.config_exists && <div>• Arquivo <code>/etc/wireguard/wg0.conf</code> existe</div>}
                  {wgExisting.peer && <div>• Peer: <code style={{ color: C.blueL }}>{wgExisting.peer}</code></div>}
                </div>
                {wgExisting.config_preview && (
                  <pre style={{ background: C.bg, borderRadius: 6, padding: 10, fontSize: 11, color: C.text2, maxHeight: 100, overflowY: 'auto', marginBottom: 10 }}>
                    {wgExisting.config_preview}
                  </pre>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} />
                  <span style={{ color: C.red, fontSize: 13 }}>Remover configuração existente e instalar nova</span>
                </label>
              </div>
            )}

            {!wgChecking && wgExisting && !wgExisting.installed && !wgExisting.config_exists && (
              <div style={{ background: C.green + '10', border: `1px solid ${C.green}40`, borderRadius: 8, padding: 10, marginBottom: 16, color: C.greenL, fontSize: 13 }}>
                ✓ Nenhuma configuração WireGuard existente — instalação limpa
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }}>VPS de destino</label>
              <select value={selVps} onChange={e => setSelVps(e.target.value)} style={inputSt}>
                <option value="">Selecione...</option>
                {vpsList.map(v => <option key={v.id} value={v.id}>{v.name} ({v.wg_address || 'sem WG'})</option>)}
              </select>
              {selVps && !vpsList.find(v => v.id === parseInt(selVps))?.wg_public_key && (
                <div style={{ marginTop: 8, background: C.red + '10', border: `1px solid ${C.red}40`, borderRadius: 6, padding: '8px 12px', color: C.red, fontSize: 12 }}>
                  ⚠ Esta VPS não tem WireGuard instalado. Instale primeiro na aba VPS.
                </div>
              )}
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }}>Modo de túnel</label>
              <select value={mode} onChange={e => setMode(e.target.value)} style={inputSt}>
                <option value="split_tunnel">Split Tunnel — apenas portas definidas passam pela VPS</option>
                <option value="full_tunnel">Full Tunnel — todo tráfego passa pela VPS</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => installWG(installModal!)}
                disabled={!selVps || (wgExisting?.config_exists && !confirmReplace) || !vpsList.find(v => v.id === parseInt(selVps))?.wg_public_key}
                style={{ ...btnBase, background: C.blue, color: 'white', opacity: (!selVps || (wgExisting?.config_exists && !confirmReplace) || !vpsList.find(v => v.id === parseInt(selVps))?.wg_public_key) ? 0.5 : 1 }}
              >
                {wgExisting?.config_exists && confirmReplace ? 'Remover e Reinstalar' : 'Instalar'}
              </button>
              <button onClick={() => setInstallModal(null)} style={{ ...btnBase, background: C.surface2, color: C.text2 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.map(c => (
          <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: shadow.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: C.purple + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Box size={18} color={C.purple} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>CT-{c.vmid}</span>
                  <span style={{ color: C.text, fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ fontSize: 12, color: C.text2 }}>
                  {c.wg_address && <span style={{ color: C.blueL, fontFamily: 'monospace', marginRight: 12 }}>WG: {c.wg_address}</span>}
                  {c.wg_public_key && <span style={{ color: C.muted }}>{c.wg_public_key.slice(0, 24)}…</span>}
                </div>
                {issues[c.id]?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {issues[c.id].map((issue: any) => (
                      <div key={issue.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 6, padding: '6px 10px', marginBottom: 4 }}>
                        <ShieldX size={13} color={C.red} />
                        <span style={{ color: C.red, fontSize: 12 }}>{issue.message}</span>
                        {issue.fixable && (
                          <button onClick={() => fixPerms(c.id)} style={{ ...btnBase, marginLeft: 'auto', padding: '3px 8px', background: C.yellow + '20', color: C.yellow }}>
                            <Wrench size={11} /> Corrigir
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => checkPerms(c.id)} title="Verificar permissões"
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', color: C.text2, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <ShieldCheck size={15} />
                </button>
                {(c.status === 'ready' || c.status === 'wg_ready' || c.status === 'imported') && (
                  <button onClick={() => openInstallModal(c.id)} title="Instalar WireGuard"
                    style={{ background: C.green + '20', border: `1px solid ${C.green}40`, borderRadius: 8, padding: '7px 10px', color: C.greenL, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Download size={15} />
                  </button>
                )}
                <button onClick={() => api.deleteLXC(c.id).then(load)} title="Remover"
                  style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '7px 10px', color: C.red, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
            <Box size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Nenhum LXC importado</div>
          </div>
        )}
      </div>
    </div>
  )
}

const inputSt: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
