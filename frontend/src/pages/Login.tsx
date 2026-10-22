import { FormEvent, Fragment, useState } from 'react'
import { ArrowRight, Cloud, Lock, Server, ShieldCheck, User } from 'lucide-react'
import { api } from '../api/client'
import { Button, Callout, Field } from '../ui'

export default function Login({ onLogin }: { onLogin: (user: string) => void }) {
  const [username, setUsername] = useState('root@pam')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const r = await api.login(username, password)
      onLogin(r.username)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="grid-bg" />
        <div className="brand" style={{ position: 'relative', padding: 0 }}>
          <div className="brand-mark" style={{ width: 38, height: 38 }}>
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M6 10l5 13 5-9 5 9 5-13" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div><div className="brand-name" style={{ fontSize: 17 }}>WG Manager</div><div className="brand-sub">WireGuard · Proxmox · Cloudflare</div></div>
        </div>
        <div style={{ position: 'relative', maxWidth: 480 }}>
          <h2 style={{ fontSize: 34, lineHeight: 1.15, fontWeight: 750, letterSpacing: '-0.035em' }}>
            Exponha seus serviços do homelab com <span style={{ color: 'var(--primary)' }}>uma porta</span>, não com um script.
          </h2>
          <p className="text-2" style={{ marginTop: 14, fontSize: 15 }}>
            VPS pública, túnel WireGuard e DNAT no Proxmox — configurados, verificados e persistidos de ponta a ponta.
          </p>
          <div className="pipeline" style={{ marginTop: 28, background: 'color-mix(in srgb, var(--surface) 70%, transparent)' }}>
            {[{ ic: Cloud, n: 'Internet', a: ':443' }, { ic: Server, n: 'VPS', a: 'wg0' }, { ic: ShieldCheck, n: 'Proxmox', a: '192.168.1.x' }].map((s, i) => (
              <Fragment key={s.n}>
                {i > 0 && <svg width="54" height="14"><line x1="2" x2="52" y1="7" y2="7" stroke="var(--success)" strokeWidth="2" strokeDasharray="4 4" style={{ animation: 'flow 1s linear infinite' }} /></svg>}
                <div className="node"><div className="node-ic"><s.ic size={18} /></div><div className="n">{s.n}</div><div className="a">{s.a}</div></div>
              </Fragment>
            ))}
          </div>
        </div>
        <div className="muted" style={{ position: 'relative', fontSize: 12 }}>Autenticação via Proxmox VE · requer privilégio de administrador</div>
      </div>

      <div className="login-form">
        <form className="login-box" onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Entrar</h1>
            <p className="text-2" style={{ marginTop: 4 }}>Use sua conta do Proxmox (ex.: <code>root@pam</code>).</p>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          <Field label="Usuário">
            <div className="input-group">
              <span className="addon"><User size={14} /></span>
              <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required autoFocus />
            </div>
          </Field>
          <Field label="Senha">
            <div className="input-group">
              <span className="addon"><Lock size={14} /></span>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
          </Field>
          <Button variant="primary" size="lg" type="submit" loading={loading} style={{ width: '100%' }}>
            Entrar <ArrowRight size={16} />
          </Button>
        </form>
      </div>
    </div>
  )
}
