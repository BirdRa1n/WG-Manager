import { useEffect, useState, useRef } from 'react'
import { api, createEventSource } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { Plus, Trash2, Wifi, Terminal, X, CheckCircle, XCircle, Loader, Search, Users, AlertTriangle } from 'lucide-react'
import { C } from '../theme'

interface TermLine { level: string; msg: string }

function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}

export default function VPSPage() {
  const [list, setList] = useState<any[]>([])
  const [peersMap, setPeersMap] = useState<Record<number, any[]>>({})
  const [loadingPeers, setLoadingPeers] = useState<number | null>(null)
  const [showPeers, setShowPeers] = useState<Record<number, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState(''), [host, setHost] = useState('')
  const [sshUser, setSshUser] = useState('ubuntu'), [sshPort, setSshPort] = useState('22')
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // Terminal modal
  const [termOpen, setTermOpen] = useState(false)
  const [termTitle, setTermTitle] = useState('')
  const [termLines, setTermLines] = useState<TermLine[]>([])
  const [termDone, setTermDone] = useState<'ok' | 'error' | null>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const load = () => api.listVPS().then(setList)
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [termLines])

  function openTerminal(title: string, op: string) {
    setTermTitle(title)
    setTermLines([])
    setTermDone(null)
    setTermOpen(true)
    esRef.current?.close()

    const es = createEventSource()
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.operation !== op) return
        setTermLines(prev => [...prev, { level: data.level, msg: data.message }])
        if (data.level === 'success') { setTermDone('ok'); es.close(); setTimeout(load, 1500) }
        else if (data.level === 'error') { setTermDone('error'); es.close() }
      } catch {}
    }
  }

  function closeTerminal() { esRef.current?.close(); setTermOpen(false) }

  async function addVPS(e: React.FormEvent) {
    e.preventDefault()
    if (!keyFile) return
    setSaving(true)
    const form = new FormData()
    form.append('name', name); form.append('host', host)
    form.append('ssh_user', sshUser); form.append('ssh_port', sshPort)
    form.append('ssh_key', keyFile)
    try {
      await api.createVPS(form)
      setShowAdd(false); load()
      setName(''); setHost(''); setKeyFile(null)
    } catch (err: any) { alert(err.message) }
    setSaving(false)
  }

  async function testConn(id: number) {
    try {
      const r = await api.testVPS(id)
      alert(r.ok ? 'Conexão SSH OK!' : 'Falha na conexão SSH')
      load()
    } catch (e: any) { alert(e.message) }
  }

  async function installWG(vps: any) {
    openTerminal(`Instalando WireGuard — ${vps.name} (${vps.host})`, 'install-wg')
    try {
      await api.installWGVPS(vps.id)
    } catch (e: any) {
      setTermLines(prev => [...prev, { level: 'error', msg: e.message }])
      setTermDone('error')
    }
  }

  async function detectWG(vps: any) {
    openTerminal(`Detectando WireGuard existente — ${vps.name}`, 'detect-wg')
    setTermLines([{ level: 'info', msg: `Conectando em ${vps.host}...` }])
    try {
      const r = await api.detectWGVPS(vps.id)
      if (r.detected) {
        setTermLines([
          { level: 'info', msg: `Conectando em ${vps.host}...` },
          { level: 'success', msg: `WireGuard detectado! Endereço: ${r.wg_address}` },
          { level: 'info', msg: `Interface pública: ${r.pub_interface}` },
          { level: 'info', msg: `Listen port: ${r.listen_port}` },
          { level: 'info', msg: `Chave pública: ${r.wg_public_key?.slice(0, 30)}...` },
          { level: r.ports_imported > 0 ? 'success' : 'info',
            msg: r.ports_imported > 0
              ? `${r.ports_imported} regra(s) iptables importadas para o painel`
              : 'Nenhuma regra iptables DNAT encontrada' },
        ])
        setTermDone('ok')
        load()
      } else {
        setTermLines([
          { level: 'info', msg: `Conectando em ${vps.host}...` },
          { level: 'warn', msg: r.message },
        ])
        setTermDone('error')
      }
    } catch (e: any) {
      setTermLines(prev => [...prev, { level: 'error', msg: e.message }])
      setTermDone('error')
    }
  }

  async function loadPeers(v: any) {
    setLoadingPeers(v.id)
    try {
      const peers = await api.wgPeers(v.id)
      setPeersMap(prev => ({ ...prev, [v.id]: peers }))
      setShowPeers(prev => ({ ...prev, [v.id]: true }))
    } catch (e: any) { alert(e.message) }
    setLoadingPeers(null)
  }

  async function showWGStatus(v: any) {
    openTerminal(`Status WireGuard — ${v.name}`, '_status')
    setTermDone('ok')
    try {
      const r = await api.wgStatusVPS(v.id)
      const lines = r.output.split('\n').filter(Boolean)
      setTermLines(lines.map((l: string) => ({ level: 'info', msg: l })))
    } catch (e: any) {
      setTermLines([{ level: 'error', msg: String(e.message) }])
      setTermDone('error')
    }
  }

  const lineColor = (l: string) =>
    l === 'success' ? C.green : l === 'error' ? C.red : l === 'warn' ? C.yellow : C.text2
  const linePrefix = (l: string) =>
    l === 'success' ? '✓ ' : l === 'error' ? '✗ ' : l === 'warn' ? '⚠ ' : '  '

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={pageTitle}>VPS (WireGuard)</h1>
        <button onClick={() => setShowAdd(!showAdd)} style={btnPrimary}>
          <Plus size={15} /> Adicionar VPS
        </button>
      </div>

      {showAdd && (
        <div style={{ ...card, marginBottom: 20 }}>
          <h3 style={{ color: '#e6edf3', marginTop: 0 }}>Nova VPS</h3>
          <form onSubmit={addVPS} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Nome" value={name} onChange={setName} placeholder="ex: VPS Principal" />
            <Field label="Host (IP ou domínio)" value={host} onChange={setHost} placeholder="ex: 203.0.113.10" />
            <Field label="Usuário SSH" value={sshUser} onChange={setSshUser} placeholder="ex: ubuntu" />
            <Field label="Porta SSH" value={sshPort} onChange={setSshPort} placeholder="22" />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Chave SSH privada (.pem / id_ed25519)</label>
              <input type="file" onChange={e => setKeyFile(e.target.files?.[0] || null)} required
                style={{ color: '#8b949e', marginTop: 6, display: 'block' }} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
              <button type="submit" disabled={saving} style={btnPrimary}>{saving ? 'Salvando...' : 'Salvar'}</button>
              <button type="button" onClick={() => setShowAdd(false)} style={btnSecondary}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.map(v => (
          <div key={v.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#e6edf3', fontWeight: 600 }}>{v.name}</span>
                  <StatusBadge status={v.status} />
                </div>
                <div style={{ color: '#8b949e', fontSize: 13, marginTop: 4 }}>
                  {v.ssh_user}@{v.host}:{v.ssh_port}
                  {v.wg_address && <span style={{ color: '#58a6ff', marginLeft: 12 }}>WG: {v.wg_address}</span>}
                  {v.pub_interface && <span style={{ color: '#484f58', marginLeft: 8 }}>({v.pub_interface})</span>}
                  {v.wg_public_key && (
                    <span style={{ color: '#3fb950', marginLeft: 12, fontSize: 11 }}>
                      ● WireGuard ativo
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => testConn(v.id)} style={btnIcon} title="Testar conexão SSH">
                  <Wifi size={15} />
                </button>

                {/* Se não tem WG: botões instalar + detectar existente */}
                {!v.wg_public_key ? (<>
                  <button onClick={() => installWG(v)} style={{ ...btnIcon, color: '#3fb950', gap: 5, fontSize: 12, fontWeight: 700 }} title="Instalar WireGuard do zero">
                    <Terminal size={13} /> Instalar WG
                  </button>
                  <button onClick={() => detectWG(v)} style={{ ...btnIcon, color: '#d29922', gap: 5, fontSize: 12 }} title="Detectar WireGuard já instalado">
                    <Search size={13} /> Detectar WG
                  </button>
                </>) : (<>
                  <button onClick={() => showWGStatus(v)} style={btnIcon} title="Ver status WireGuard">
                    <Terminal size={15} />
                  </button>
                  <button
                    onClick={() => showPeers[v.id] ? setShowPeers(p => ({ ...p, [v.id]: false })) : loadPeers(v)}
                    style={{ ...btnIcon, color: '#a371f7', gap: 5, fontSize: 12 }}
                    title="Ver peers WireGuard"
                  >
                    {loadingPeers === v.id
                      ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      : <Users size={13} />}
                    Peers
                  </button>
                </>)}

                <button onClick={() => api.deleteVPS(v.id).then(load)} style={{ ...btnIcon, color: '#f85149' }} title="Remover">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {/* WG Peers Panel */}
            {showPeers[v.id] && peersMap[v.id] && (
              <div style={{ borderTop: '1px solid #21262d', marginTop: 14, paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Users size={13} color="#a371f7" />
                  <span style={{ color: '#a371f7', fontWeight: 600, fontSize: 13 }}>
                    WireGuard Peers ({peersMap[v.id].length})
                  </span>
                  {peersMap[v.id].filter((p: any) => !p.in_panel).length > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#d29922', fontSize: 12, marginLeft: 8 }}>
                      <AlertTriangle size={12} />
                      {peersMap[v.id].filter((p: any) => !p.in_panel).length} peer(s) não registrado(s) no painel
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {peersMap[v.id].map((peer: any, i: number) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: peer.in_panel ? '#0d1117' : '#1a1500',
                      border: `1px solid ${peer.in_panel ? '#21262d' : '#3a2a00'}`,
                      borderRadius: 6, padding: '8px 12px', fontSize: 12,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: peer.last_handshake > 0 && (Date.now() / 1000 - peer.last_handshake) < 180
                          ? '#3fb950' : '#484f58'
                      }} title={peer.last_handshake > 0 ? `Último handshake: ${Math.round((Date.now()/1000 - peer.last_handshake)/60)}min atrás` : 'Sem handshake'} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {peer.in_panel ? (
                            <span style={{ color: '#3fb950', fontWeight: 600 }}>{peer.lxc_name} (CT-{peer.lxc_vmid})</span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#d29922', fontWeight: 600 }}>
                              <AlertTriangle size={11} /> Peer não registrado
                            </span>
                          )}
                          {peer.allowed_ips && (
                            <span style={{ color: '#58a6ff', fontFamily: 'monospace' }}>{peer.allowed_ips}</span>
                          )}
                          {!peer.allowed_ips && (
                            <span style={{ color: '#f85149', fontSize: 11 }}>⚠ sem AllowedIPs (conflito)</span>
                          )}
                        </div>
                        <div style={{ color: '#484f58', marginTop: 2, fontFamily: 'monospace', fontSize: 11 }}>
                          {peer.pubkey.slice(0, 24)}... {peer.endpoint && `• ${peer.endpoint}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', color: '#8b949e', fontSize: 11, flexShrink: 0 }}>
                        ↑ {fmtBytes(peer.tx_bytes)} / ↓ {fmtBytes(peer.rx_bytes)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <div style={{ color: '#8b949e', textAlign: 'center', padding: 40 }}>Nenhuma VPS cadastrada</div>}
      </div>

      {/* Terminal Modal */}
      {termOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, width: 680, maxWidth: '95vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#161b22', borderBottom: '1px solid #21262d' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f85149' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#d29922' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#3fb950' }} />
              </div>
              <span style={{ color: '#8b949e', fontSize: 12, flex: 1, marginLeft: 8 }}>{termTitle}</span>
              {termDone === null && <Loader size={13} color="#8b949e" style={{ animation: 'spin 1s linear infinite' }} />}
              {termDone === 'ok' && <CheckCircle size={14} color="#3fb950" />}
              {termDone === 'error' && <XCircle size={14} color="#f85149" />}
              <button onClick={closeTerminal} style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', padding: 4 }}><X size={15} /></button>
            </div>

            {/* Terminal body */}
            <div ref={termRef} style={{ padding: '14px 18px', fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: 12, lineHeight: 1.7, height: 380, overflowY: 'auto' }}>
              {termLines.length === 0 && termDone === null && (
                <span style={{ color: '#484f58' }}>Aguardando...</span>
              )}
              {termLines.map((l, i) => (
                <div key={i}>
                  <span style={{ color: '#3fb950', userSelect: 'none' }}>➜ </span>
                  <span style={{ color: lineColor(l.level) }}>{linePrefix(l.level)}{l.msg}</span>
                </div>
              ))}
              {termDone === 'ok' && (
                <div style={{ color: '#3fb950', marginTop: 10, borderTop: '1px solid #21262d', paddingTop: 8 }}>
                  ✓ Processo concluído com sucesso
                </div>
              )}
              {termDone === 'error' && (
                <div style={{ color: '#f85149', marginTop: 10, borderTop: '1px solid #21262d', paddingTop: 8 }}>
                  ✗ Processo encerrado com erro
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid #21262d', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={closeTerminal} style={termDone ? btnPrimary : btnSecondary}>
                {termDone ? 'Fechar' : 'Minimizar (processo continua em segundo plano)'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: any) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} required />
    </div>
  )
}

const pageTitle: React.CSSProperties = { color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }
const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: C.blue, border: 'none', borderRadius: 8, padding: '9px 16px', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnSecondary: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', color: C.text2, fontSize: 13, cursor: 'pointer' }
const btnIcon: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', color: C.text2, cursor: 'pointer', display: 'flex', alignItems: 'center' }
const labelStyle: React.CSSProperties = { color: C.text2, fontSize: 12, display: 'block', marginBottom: 6 }
const inputStyle: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
