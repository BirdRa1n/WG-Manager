import { useEffect, useRef, useState } from 'react'
import { createEventSource, api } from '../api/client'
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import { C } from '../theme'

interface LogEntry { ts: string; level: string; message: string; operation: string }

const levelColor: Record<string, string> = {
  info:    C.text2,
  warn:    C.yellow,
  error:   C.red,
  success: C.green,
}
const levelPrefix: Record<string, string> = {
  info: '›', warn: '⚠', error: '✗', success: '✓',
}

export default function LogTerminal() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [open, setOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.logHistory().then((h: any[]) => setLogs(h.slice(-100)))
    const es = createEventSource()
    es.onmessage = e => {
      const data = JSON.parse(e.data) as LogEntry
      if (data.level === 'ping') return
      setLogs(prev => [...prev.slice(-499), data])
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, open])

  const lastLog = logs[logs.length - 1]

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 232, right: 0,
      background: C.bg,
      borderTop: `1px solid ${C.border}`,
      zIndex: 100,
      height: open ? 200 : 38,
      transition: 'height 0.2s ease',
    }}>
      {/* Header bar */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', cursor: 'pointer',
          background: C.surface, borderBottom: open ? `1px solid ${C.border}` : 'none',
          height: 38, boxSizing: 'border-box',
        }}
      >
        <Terminal size={13} color={C.muted} />
        <span style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>
          LOGS EM TEMPO REAL
        </span>
        {!open && lastLog && (
          <span style={{ color: levelColor[lastLog.level] || C.text2, fontSize: 11, fontFamily: 'monospace', marginLeft: 8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            [{lastLog.operation}] {lastLog.message}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!open && logs.length > 0 && (
            <span style={{ background: C.blue + '30', color: C.blueL, borderRadius: 9, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
              {logs.length}
            </span>
          )}
          {open ? <ChevronDown size={13} color={C.muted} /> : <ChevronUp size={13} color={C.muted} />}
        </div>
      </div>

      {/* Log body */}
      {open && (
        <div style={{
          height: 162, overflowY: 'auto', padding: '6px 14px',
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
          fontSize: 11, lineHeight: 1.8,
        }}>
          {logs.length === 0 && (
            <span style={{ color: C.muted }}>Aguardando eventos...</span>
          )}
          {logs.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, color: levelColor[l.level] || C.text2 }}>
              <span style={{ color: C.muted, flexShrink: 0, userSelect: 'none' }}>
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              {l.operation && (
                <span style={{ color: C.blue + 'cc', flexShrink: 0 }}>[{l.operation}]</span>
              )}
              <span style={{ color: levelColor[l.level] || C.text2 }}>
                {levelPrefix[l.level] || '›'} {l.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
