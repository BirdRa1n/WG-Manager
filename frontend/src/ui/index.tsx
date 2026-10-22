import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'

// ── Formatting ───────────────────────────────────────────────────────────────────────────
export function fmtBytes(b: number | null | undefined): string {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`
}
export const fmtRate = (b: number) => `${fmtBytes(b)}/s`
export function fmtAgo(epochSec: number | null | undefined): string {
  if (!epochSec) return 'nunca'
  const s = Math.max(0, Date.now() / 1000 - epochSec)
  if (s < 60) return `${Math.round(s)}s atrás`
  if (s < 3600) return `${Math.round(s / 60)} min atrás`
  if (s < 86400) return `${Math.round(s / 3600)} h atrás`
  return `${Math.round(s / 86400)} d atrás`
}
export const fmtAgoIso = (iso?: string | null) => (iso ? fmtAgo(Date.parse(iso) / 1000) : 'nunca')
export const protoLabel = (p: string) => (p === 'both' ? 'TCP+UDP' : p.toUpperCase())

// ── Async helper ─────────────────────────────────────────────────────────────────────────
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], intervalMs?: number) {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fnRef.current())
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    reload()
    if (!intervalMs) return
    const iv = setInterval(() => { if (!document.hidden) reload() }, intervalMs)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload, setData }
}

// ── Primitives ───────────────────────────────────────────────────────────────────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost' | 'default'; size?: 'sm' | 'lg'; icon?: ReactNode; loading?: boolean; iconOnly?: boolean
}
export function Button({ variant = 'default', size, icon, loading, iconOnly, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, iconOnly && 'btn-icon', className].filter(Boolean).join(' ')
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="spin" /> : icon}
      {children}
    </button>
  )
}

export function Badge({ tone, children, dot, live }: { tone?: string; children: ReactNode; dot?: boolean; live?: boolean }) {
  return <span className={`badge ${tone || ''}`}>{dot && <span className={`dot ${live ? 'live' : ''}`} />}{children}</span>
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />
}

export function Segmented<T extends string>({ value, onChange, options, block }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; block?: boolean
}) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="radiogroup">
      {options.map(o => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, error, warn, children, className = '', aside }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; warn?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode
}) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}{aside}</label>}
      {children}
      {error ? <span className="hint error">{error}</span> : warn ? <span className="hint warn">{warn}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Callout({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const Ic = { info: Info, warn: AlertTriangle, danger: XCircle, success: CheckCircle2 }[tone]
  return (
    <div className={`callout ${tone}`}>
      {icon ?? <Ic size={16} />}
      <div>{title && <div style={{ fontWeight: 600, marginBottom: children ? 2 : 0 }}>{title}</div>}{children && <div className="text-2">{children}</div>}</div>
    </div>
  )
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1 className="page-title">{title}</h1>{sub && <p className="page-sub">{sub}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'on' : ''}`} onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  )
}

// ── Overlays ─────────────────────────────────────────────────────────────────────────────
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

interface OverlayProps { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode }

export function Modal({ open, onClose, title, sub, children, footer }: OverlayProps) {
  if (!open) return null
  return createPortal(<ModalInner {...{ onClose, title, sub, children, footer }} />, document.body)
}
function ModalInner({ onClose, title, sub, children, footer }: Omit<OverlayProps, 'open'>) {
  useEscape(onClose)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="overlay-head">
          <div><div className="overlay-title">{title}</div>{sub && <div className="overlay-sub">{sub}</div>}</div>
          <Button variant="ghost" size="sm" iconOnly icon={<X size={16} />} onClick={onClose} aria-label="Fechar" />
        </div>
        <div className="overlay-body">{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </div>
    </>
  )
}

export function Drawer({ open, onClose, title, sub, children, footer, wide, tabs }: OverlayProps & { wide?: boolean; tabs?: ReactNode }) {
  if (!open) return null
  return createPortal(<DrawerInner {...{ onClose, title, sub, children, footer, wide, tabs }} />, document.body)
}
function DrawerInner({ onClose, title, sub, children, footer, wide, tabs }: Omit<OverlayProps, 'open'> & { wide?: boolean; tabs?: ReactNode }) {
  useEscape(onClose)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="overlay-head" style={tabs ? { borderBottom: 0, paddingBottom: 8 } : undefined}>
          <div style={{ minWidth: 0 }}><div className="overlay-title">{title}</div>{sub && <div className="overlay-sub">{sub}</div>}</div>
          <Button variant="ghost" size="sm" iconOnly icon={<X size={16} />} onClick={onClose} aria-label="Fechar" />
        </div>
        {tabs}
        <div className="overlay-body">{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </aside>
    </>
  )
}

// ── Toasts ───────────────────────────────────────────────────────────────────────────────
type ToastTone = 'success' | 'error' | 'info' | 'warn'
interface ToastItem { id: number; tone: ToastTone; title: string; detail?: string }
const ToastCtx = createContext<(tone: ToastTone, title: string, detail?: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

// ── Confirm ──────────────────────────────────────────────────────────────────────────────
interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = ++seq.current
    setToasts(t => [...t.slice(-3), { id, tone, title, detail }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 8000 : 4500)
  }, [])
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setConfirm({ ...o, resolve })), [])
  const close = (v: boolean) => { confirm?.resolve(v); setConfirm(null) }
  const icon = { success: <CheckCircle2 size={17} color="var(--success)" />, error: <XCircle size={17} color="var(--danger)" />, info: <Info size={17} color="var(--info)" />, warn: <AlertTriangle size={17} color="var(--warn)" /> }

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        {createPortal(
          <div className="toasts" aria-live="polite">
            {toasts.map(t => (
              <div key={t.id} className="toast">
                {icon[t.tone]}
                <div style={{ flex: 1, minWidth: 0 }}><div className="t">{t.title}</div>{t.detail && <div className="d">{t.detail}</div>}</div>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Fechar"><X size={14} /></button>
              </div>
            ))}
          </div>, document.body)}
        <Modal open={!!confirm} onClose={() => close(false)} title={confirm?.title}
          footer={<>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{confirm?.confirm || 'Confirmar'}</Button>
          </>}>
          <div className="text-2" style={{ fontSize: 13.5 }}>{confirm?.body}</div>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

/** Summarise an apply result coming back from the backend into a toast. */
export function applyToast(toast: ReturnType<typeof useToast>, res: any, okTitle: string) {
  const failures = Object.entries(res || {}).filter(([k, v]: any) => k !== 'ok' && v && v.ok === false && !v.skipped)
  if (!failures.length) toast('success', okTitle, 'Regras aplicadas e persistidas.')
  else toast('error', 'Salvo, mas a aplicação falhou', failures.map(([k, v]: any) => `${k === 'host' ? 'Host' : 'VPS'}: ${v.message}`).join(' · '))
}
