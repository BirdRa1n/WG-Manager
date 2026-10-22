import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from './api/client'
import { FeedbackProvider } from './ui'
import { ActivityProvider } from './activity'
import Layout from './Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Forwards from './pages/Forwards'
import Servers from './pages/Servers'
import Guests from './pages/Guests'
import Tunnels from './pages/Tunnels'
import Credentials from './pages/Credentials'
import Activity from './pages/Activity'

export default function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    api.me().then(r => setUser(r.username)).catch(() => setUser(null))
    const onUnauthorized = () => setUser(null)
    window.addEventListener('wgm:unauthorized', onUnauthorized)
    return () => window.removeEventListener('wgm:unauthorized', onUnauthorized)
  }, [])

  if (user === undefined) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Loader2 className="spin" style={{ animation: 'spin 0.8s linear infinite', color: 'var(--muted)' }} /></div>
  }

  return (
    <FeedbackProvider>
      {!user ? <Login onLogin={setUser} /> : (
        <ActivityProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout user={user} onLogout={() => api.logout().finally(() => setUser(null))} />}>
                <Route index element={<Dashboard />} />
                <Route path="forwards" element={<Forwards />} />
                <Route path="servers" element={<Servers />} />
                <Route path="guests" element={<Guests />} />
                <Route path="tunnels" element={<Tunnels />} />
                <Route path="credentials" element={<Credentials />} />
                <Route path="activity" element={<Activity />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ActivityProvider>
      )}
    </FeedbackProvider>
  )
}
