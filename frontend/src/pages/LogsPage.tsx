import { useEffect, useRef, useState } from 'react'
import { createEventSource, api } from '../api/client'
import { Trash2, Terminal, Circle } from 'lucide-react'
import { C } from '../theme'

const levelColor: Record<string, string> = {
  info: C.text2, warn: C.yellow, error: C.red, success: C.green,
}
const levelPrefix: Record<string, string> = {
  info: '›', warn: '⚠', error: '✗', success: '✓',
}

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [live, setLive] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.logHistory().then(setLogs)
    const es = createEventSource()
    es.onmessage = e => {
      const data = JSON.parse(e.data)
      if (data.level === 'ping') return
      setLogs(prev => [...prev.slice(-999), data])
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, live])

  const errorCount = logs.filter(l => l.level === 'error').length
  const warnCount = logs.filter(l => l.level === 'warn').length

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 24, fontWeight: 700, margin: 0 }}>Logs</h1>
          <p style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>
            {logs.length} entradas
            {errorCount > 0 && <span style={{ color: C.red, marginLeft: 10 }}>• {errorCount} erro(s)</span>}
            {warnCount > 0 && <span style={{ color: C.yellow, marginLeft: 10 }}>• {warnCount} aviso(s)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setLive(!live)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: live ? C.green + '20' : C.surface2, border: `1px solid ${live ? C.green + '50' : C.border}`, borderRadius: 8, padding: '8px 14px', color: live ? C.greenL : C.text2, fontSize: 13, cursor: 'pointer' }}
          >
            <Circle size={8} fill={live ? C.green : 'transparent'} color={live ? C.green : C.muted} />
            {live ? 'Live' : 'Pausado'}
          </button>
          <button onClick={() => setLogs([])} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', color: C.text2, fontSize: 13, cursor: 'pointer' }}>
            <Trash2 size={14} /> Limpar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total', value: logs.length, color: C.text2 },
          { label: 'Info', value: logs.filter(l => l.level === 'info').length, color: C.text2 },
          { label: 'Sucesso', value: logs.filter(l => l.level === 'success').length, color: C.green },
          { label: 'Aviso', value: warnCount, color: C.yellow },
          { label: 'Erro', value: errorCount, color: C.red },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', flex: 1, textAlign: 'center' }}>
            <div style={{ color: s.color, fontSize: 20, fontWeight: 700 }}>{s.value}</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: '12px 0', fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: 12,
        maxHeight: 'calc(100vh - 340px)', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 10px', borderBottom: `1px solid ${C.border}`, marginBottom: 8 }}>
          <Terminal size={13} color={C.muted} />
          <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>CONSOLE</span>
        </div>
        {logs.length === 0 && (
          <div style={{ color: C.muted, padding: '20px 16px' }}>Aguardando eventos...</div>
        )}
        {logs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 16px', lineHeight: 1.7 }}>
            <span style={{ color: C.muted, flexShrink: 0, userSelect: 'none', width: 80 }}>
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            {l.operation && (
              <span style={{ color: C.blue + 'bb', flexShrink: 0, minWidth: 120 }}>[{l.operation}]</span>
            )}
            <span style={{ color: levelColor[l.level] || C.text2 }}>
              {levelPrefix[l.level] || '›'} {l.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
