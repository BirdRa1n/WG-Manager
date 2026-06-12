import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Server, Box, ArrowRightLeft,
  Share2, Cloud, ScrollText, LogOut, KeyRound, Activity,
  RefreshCw, ArrowUpCircle, ExternalLink,
} from 'lucide-react'
import { C } from '../theme'
import { useUpdateCheck } from '../hooks/useUpdateCheck'

const NAV = [
  { to: '/',           label: 'Dashboard',          icon: LayoutDashboard, group: 'main' },
  { to: '/vps',        label: 'VPS / WireGuard',    icon: Server,          group: 'infra' },
  { to: '/lxc',        label: 'LXC Containers',     icon: Box,             group: 'infra' },
  { to: '/ports',      label: 'Regras de Porta',    icon: ArrowRightLeft,  group: 'net' },
  { to: '/simple',     label: 'Redirecionamento',   icon: Share2,          group: 'net' },
  { to: '/cloudflare', label: 'Cloudflare Tunnels', icon: Cloud,           group: 'net' },
  { to: '/credentials',label: 'Credenciais de API', icon: KeyRound,        group: 'cfg' },
  { to: '/logs',       label: 'Logs',               icon: ScrollText,      group: 'cfg' },
]

const GROUP_LABELS: Record<string, string> = {
  main: '', infra: 'INFRAESTRUTURA', net: 'REDE', cfg: 'CONFIGURAÇÃO',
}

export default function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { updateInfo, checking, checkNow } = useUpdateCheck()
  let lastGroup = ''

  return (
    <div style={{
      width: 232, background: C.bg,
      borderRight: `1px solid ${C.border}`,
      height: '100vh', position: 'fixed', left: 0, top: 0,
      display: 'flex', flexDirection: 'column',
      boxShadow: '2px 0 12px rgba(0,0,0,0.5)',
    }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Activity size={16} color="white" />
          </div>
          <div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>WG Manager</div>
            <div style={{ color: C.muted, fontSize: 10, marginTop: 1 }}>
              {updateInfo ? `v${updateInfo.current}` : 'Proxmox • WireGuard • CF'}
            </div>
          </div>
          {/* Botão verificar atualização */}
          <button
            onClick={checkNow}
            disabled={checking}
            title="Verificar atualizações"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              color: updateInfo?.hasUpdate ? C.green : C.muted,
              padding: 4, display: 'flex', flexShrink: 0,
              animation: checking ? 'spin 1s linear infinite' : 'none',
            }}
          >
            {updateInfo?.hasUpdate
              ? <ArrowUpCircle size={16} />
              : <RefreshCw size={14} />
            }
          </button>
        </div>

        {/* Banner de atualização disponível */}
        {updateInfo?.hasUpdate && (
          <a
            href={updateInfo.releaseUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 10, padding: '7px 10px',
              background: C.green + '15',
              border: `1px solid ${C.green}40`,
              borderRadius: 8, textDecoration: 'none',
              color: C.greenL, fontSize: 11, fontWeight: 600,
            }}
          >
            <ArrowUpCircle size={13} />
            <span style={{ flex: 1 }}>
              Nova versão disponível<br />
              <span style={{ color: C.muted, fontWeight: 400 }}>
                v{updateInfo.current} → v{updateInfo.latest}
              </span>
            </span>
            <ExternalLink size={11} style={{ flexShrink: 0 }} />
          </a>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px 0', overflowY: 'auto' }}>
        {NAV.map(({ to, label, icon: Icon, group }) => {
          const showLabel = group !== lastGroup
          lastGroup = group
          return (
            <div key={to}>
              {showLabel && GROUP_LABELS[group] && (
                <div style={{
                  color: C.muted, fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.1em', padding: '14px 10px 6px',
                }}>
                  {GROUP_LABELS[group]}
                </div>
              )}
              <NavLink to={to} end={to === '/'} style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', textDecoration: 'none',
                borderRadius: 8, marginBottom: 2,
                color: isActive ? C.blueL : C.text2,
                background: isActive ? `${C.blue}18` : 'transparent',
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                transition: 'all 0.15s',
                border: `1px solid ${isActive ? C.blue + '30' : 'transparent'}`,
              })}>
                <Icon size={15} />
                {label}
              </NavLink>
            </div>
          )
        })}
      </nav>

      {/* Logout */}
      <button onClick={onLogout} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 22px', background: 'none', border: 'none',
        borderTop: `1px solid ${C.border}`,
        color: C.muted, cursor: 'pointer', fontSize: 13, width: '100%',
        transition: 'color 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.color = C.red)}
        onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
      >
        <LogOut size={15} />
        Sair
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
