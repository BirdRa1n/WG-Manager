import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { api, eventStream, LogEntry } from './api/client'

interface ActivityState { logs: LogEntry[]; connected: boolean; unread: number; markRead: () => void; clear: () => void }
const Ctx = createContext<ActivityState>({ logs: [], connected: false, unread: 0, markRead: () => {}, clear: () => {} })
export const useActivity = () => useContext(Ctx)

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [unread, setUnread] = useState(0)
  const retry = useRef<number>()

  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    api.logHistory().then(h => setLogs(h.slice(-300))).catch(() => {})
    const open = () => {
      es = eventStream()
      es.onopen = () => setConnected(true)
      es.onmessage = e => {
        const ev = JSON.parse(e.data) as LogEntry
        if (ev.level === 'ping') return
        setLogs(prev => (prev.some(p => p.ts === ev.ts && p.message === ev.message) ? prev : [...prev.slice(-499), ev]))
        if (ev.level === 'error' || ev.level === 'success' || ev.level === 'warn') setUnread(u => u + 1)
      }
      es.onerror = () => {
        setConnected(false)
        es?.close()
        if (!closed) retry.current = window.setTimeout(open, 4000)
      }
    }
    open()
    return () => { closed = true; es?.close(); clearTimeout(retry.current) }
  }, [])

  return (
    <Ctx.Provider value={{ logs, connected, unread, markRead: () => setUnread(0), clear: () => setLogs([]) }}>
      {children}
    </Ctx.Provider>
  )
}
