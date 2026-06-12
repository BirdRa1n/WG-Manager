import { useState } from 'react'
import { api } from '../api/client'
import { Shield } from 'lucide-react'

export default function Login({ onLogin }: { onLogin: (data: any) => void }) {
  const [username, setUsername] = useState('root@pam')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await api.login(username, password)
      localStorage.setItem('token', data.token)
      localStorage.setItem('proxmox_ticket', data.proxmox_ticket)
      localStorage.setItem('proxmox_csrf', data.proxmox_csrf)
      onLogin(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#161b22', border: '1px solid #21262d',
        borderRadius: 12, padding: 40, width: 360,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Shield size={40} color="#58a6ff" style={{ marginBottom: 12 }} />
          <h1 style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700, margin: 0 }}>WG Proxy Manager</h1>
          <p style={{ color: '#8b949e', fontSize: 13, marginTop: 6 }}>Autenticação via Proxmox</p>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#8b949e', fontSize: 12, display: 'block', marginBottom: 6 }}>Usuário Proxmox</label>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="root@pam" required
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ color: '#8b949e', fontSize: 12, display: 'block', marginBottom: 6 }}>Senha</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required style={inputStyle}
            />
          </div>
          {error && (
            <div style={{ background: '#3a1a1a', color: '#f85149', borderRadius: 6, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? 'Autenticando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0d1117', border: '1px solid #30363d',
  borderRadius: 6, padding: '10px 12px', color: '#e6edf3', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  width: '100%', background: '#238636', border: 'none', borderRadius: 6,
  padding: '11px', color: 'white', fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
}
