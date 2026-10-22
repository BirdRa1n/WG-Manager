import { useId, useMemo, useState } from 'react'
import { fmtRate } from '.'

interface Pt { ts: string; rx: number; tx: number }

/** Two-series area chart (rx / tx) in plain SVG with a hover readout. */
export function TrafficChart({ data, height = 190 }: { data: Pt[]; height?: number }) {
  const id = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = height, PAD = 6
  const max = useMemo(() => Math.max(1, ...data.flatMap(d => [d.rx, d.tx])) * 1.15, [data])
  if (data.length < 2) {
    return <div className="muted" style={{ height, display: 'grid', placeItems: 'center', fontSize: 13 }}>Coletando amostras — o gráfico aparece após 2 minutos.</div>
  }
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
  const line = (k: 'rx' | 'tx') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const area = (k: 'rx' | 'tx') => `${line(k)} L${x(data.length - 1)},${H} L${x(0)},${H} Z`
  const h = hover != null ? data[hover] : null

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)))
        }}>
        <defs>
          <linearGradient id={`rx${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></linearGradient>
          <linearGradient id={`tx${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--success)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--success)" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--border)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        <path d={area('rx')} fill={`url(#rx${id})`} />
        <path d={area('tx')} fill={`url(#tx${id})`} />
        <path d={line('rx')} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={line('tx')} fill="none" stroke="var(--success)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div className="card" style={{ position: 'absolute', top: 8, left: `clamp(8px, calc(${(hover! / (data.length - 1)) * 100}% - 70px), calc(100% - 150px))`, padding: '8px 10px', fontSize: 12, pointerEvents: 'none', minWidth: 140 }}>
          <div className="muted" style={{ marginBottom: 4 }}>{new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="between"><span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--primary)' }} />Entrada</span><b className="tnum">{fmtRate(h.rx)}</b></div>
          <div className="between"><span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--success)' }} />Saída</span><b className="tnum">{fmtRate(h.tx)}</b></div>
        </div>
      )}
    </div>
  )
}

export function Sparkline({ values, color = 'var(--primary)', height = 32 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} />
  const W = 120, max = Math.max(1, ...values)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * W},${height - 2 - (v / max) * (height - 4)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** Animated dashed connector between topology nodes. */
export function FlowLink({ ok, width = 54 }: { ok: boolean | undefined; width?: number }) {
  const color = ok === false ? 'var(--danger)' : ok ? 'var(--success)' : 'var(--muted)'
  return (
    <svg width={width} height={14} viewBox={`0 0 ${width} 14`} aria-hidden>
      <line x1={2} x2={width - 2} y1={7} y2={7} stroke={color} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round"
        style={{ animation: ok ? 'flow 1s linear infinite' : undefined, opacity: ok === undefined ? 0.5 : 1 }} />
      <path d={`M${width - 8},3 L${width - 2},7 L${width - 8},11`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
