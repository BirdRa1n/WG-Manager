import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import VPSPage from './pages/VPSPage'
import LXCPage from './pages/LXCPage'
import PortRules from './pages/PortRules'
import SimpleForwarding from './pages/SimpleForwarding'
import CloudflareTunnels from './pages/CloudflareTunnels'
import LogsPage from './pages/LogsPage'
import CredentialsPage from './pages/CredentialsPage'
import Sidebar from './components/Sidebar'
import LogTerminal from './components/LogTerminal'

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'))

  function logout() {
    localStorage.clear()
    setAuthed(false)
  }

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />
  }

  return (
    <BrowserRouter>
      <div style={{ display: 'flex', background: '#070d1a', minHeight: '100vh', color: '#e8f0ff' }}>
        <Sidebar onLogout={logout} />
        <main style={{ marginLeft: 232, flex: 1, padding: '28px 32px', paddingBottom: 220 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/vps" element={<VPSPage />} />
            <Route path="/lxc" element={<LXCPage />} />
            <Route path="/ports" element={<PortRules />} />
            <Route path="/simple" element={<SimpleForwarding />} />
            <Route path="/cloudflare" element={<CloudflareTunnels />} />
            <Route path="/credentials" element={<CredentialsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <LogTerminal />
      </div>
    </BrowserRouter>
  )
}
