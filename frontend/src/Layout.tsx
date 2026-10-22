import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity as ActivityIc, ArrowLeftRight, Bell, Boxes, ChevronRight, Cloud, KeyRound, LayoutDashboard,
  LogOut, Menu, Moon, Server, Sun,
} from 'lucide-react'
import { api } from './api/client'
import { useActivity } from './activity'
import { Badge, Button, Drawer } from './ui'
import { LogList } from './pages/Activity'

const NAV = [
  { section: 'Visão geral', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { section: 'Rede', items: [
    { to: '/forwards', label: 'Encaminhamentos', icon: ArrowLeftRight },
    { to: '/servers', label: 'Servidores', icon: Server },
    { to: '/guests', label: 'Containers & VMs', icon: Boxes },
  ] },
  { section: 'Zero Trust', items: [
    { to: '/tunnels', label: 'Túneis Cloudflare', icon: Cloud },
    { to: '/credentials', label: 'Credenciais', icon: KeyRound },
  ] },
  { section: 'Sistema', items: [{ to: '/activity', label: 'Atividade', icon: ActivityIc }] },
]
const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap(s => s.items.map(i => [i.to, i.label])))

const GITHUB_REPO = 'BirdRa1n/WG-Manager'

export default function Layout({ user, onLogout }: { user: string; onLogout: () => void }) {
  const loc = useLocation()
  const [menu, setMenu] = useState(false)
  const [activity, setActivity] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [version, setVersion] = useState<{ current: string; latest?: string; url?: string }>({ current: '' })
  const { unread, markRead, connected, logs } = useActivity()

  useEffect(() => setMenu(false), [loc.pathname])
  useEffect(() => {
    api.version().then(async v => {
      setVersion({ current: v.version })
      try {
        const gh = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`).then(r => r.json())
        const latest = gh.tag_name?.replace(/^v/, '')
        if (latest && latest !== v.version) setVersion({ current: v.version, latest, url: gh.html_url })
      } catch { /* offline is fine */ }
    }).catch(() => {})
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('wgm-theme', next) } catch { /* private mode */ }
    setTheme(next)
  }

  return (
    <div className="shell">
      <div className={`scrim ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} />
      <nav className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 32 32"><path d="M6 10l5 13 5-9 5 9 5-13" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div><div className="brand-name">WG Manager</div><div className="brand-sub">WireGuard · Proxmox</div></div>
        </div>
        {NAV.map(s => (
          <div key={s.section}>
            <div className="nav-label">{s.section}</div>
            {s.items.map(i => (
              <NavLink key={i.to} to={i.to} end={'end' in i ? i.end : false} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <i.icon size={17} strokeWidth={1.9} />{i.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          {version.latest && (
            <a href={version.url} target="_blank" rel="noreferrer" className="callout info" style={{ fontSize: 12.5 }}>
              <span>Nova versão <b>v{version.latest}</b> disponível</span>
            </a>
          )}
          <div className="user-chip">
            <div className="avatar">{user.slice(0, 2).toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{user}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>v{version.current || '…'}</div>
            </div>
            <Button variant="ghost" size="sm" iconOnly icon={<LogOut size={15} />} onClick={onLogout} title="Sair" aria-label="Sair" />
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <Button variant="ghost" iconOnly className="menu-btn" icon={<Menu size={18} />} onClick={() => setMenu(true)} aria-label="Menu" />
          <div className="crumbs">WG Manager <ChevronRight size={14} /> <b>{TITLES[loc.pathname] || 'Dashboard'}</b></div>
          <div style={{ marginLeft: 'auto' }} className="row">
            <span className="conn" title={connected ? 'Eventos em tempo real conectados' : 'Reconectando…'}>
              <span className={`dot ${connected ? 'live' : ''}`} style={{ color: connected ? 'var(--success)' : 'var(--warn)' }} />
              <span className="hide-sm">{connected ? 'Ao vivo' : 'Reconectando'}</span>
            </span>
            <Button variant="ghost" iconOnly icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />} onClick={toggleTheme} title="Alternar tema" aria-label="Alternar tema" />
            <div style={{ position: 'relative' }}>
              <Button variant="ghost" iconOnly icon={<Bell size={17} />} onClick={() => { setActivity(true); markRead() }} title="Atividade recente" aria-label="Atividade recente" />
              {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, pointerEvents: 'none' }}><Badge tone="danger">{unread > 9 ? '9+' : unread}</Badge></span>}
            </div>
          </div>
        </header>
        <main className="page"><Outlet context={{ user }} /></main>
      </div>

      <Drawer open={activity} onClose={() => setActivity(false)} title="Atividade recente" sub="Operações do painel em tempo real">
        <LogList logs={logs.slice(-150)} autoScroll />
      </Drawer>
    </div>
  )
}
