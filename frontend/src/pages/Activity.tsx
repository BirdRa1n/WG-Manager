import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity as ActivityIc, Search, Trash2 } from 'lucide-react'
import { LogEntry } from '../api/client'
import { useActivity } from '../activity'
import { Button, Empty, PageHeader, Segmented } from '../ui'

const ICON: Record<string, string> = { info: '›', warn: '!', error: '✕', success: '✓' }

export function LogList({ logs, autoScroll }: { logs: LogEntry[]; autoScroll?: boolean }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!autoScroll) return
    // Scroll only the nearest scrollable container — scrollIntoView would move the whole page.
    let el = end.current?.parentElement ?? null
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
    if (el && el !== document.documentElement && el !== document.body) el.scrollTop = el.scrollHeight
  }, [logs.length, autoScroll])
  if (!logs.length) return <Empty icon={<ActivityIc size={22} />} title="Nada por aqui ainda">As operações do painel aparecem aqui em tempo real.</Empty>
  return (
    <div>
      {logs.map((l, i) => (
        <div key={`${l.ts}-${i}`} className={`log-line ${l.level}`}>
          <span className="ts">{new Date(l.ts.endsWith('Z') ? l.ts : l.ts + 'Z').toLocaleTimeString()}</span>
          <span>{ICON[l.level] || '›'}</span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.operation && <span className="op">{l.operation}</span>}{l.message}</span>
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export default function Activity() {
  const { logs, clear } = useActivity()
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'success'>('all')
  const [q, setQ] = useState('')
  const filtered = useMemo(() => logs.filter(l =>
    (level === 'all' || l.level === level) &&
    (!q || `${l.operation} ${l.message}`.toLowerCase().includes(q.toLowerCase()))), [logs, level, q])

  return (
    <>
      <PageHeader title="Atividade" sub="Tudo que o painel executou nos servidores, em tempo real."
        actions={<Button icon={<Trash2 size={15} />} onClick={clear}>Limpar visualização</Button>} />
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Segmented value={level} onChange={setLevel} options={[
            { value: 'all', label: 'Tudo' }, { value: 'error', label: 'Erros' }, { value: 'warn', label: 'Avisos' }, { value: 'success', label: 'Sucesso' },
          ]} />
          <div className="chip-input"><Search size={14} className="muted" /><input placeholder="Filtrar…" value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        <div className="card-pad" style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
          <LogList logs={filtered} autoScroll={level === 'all' && !q} />
        </div>
      </div>
    </>
  )
}
