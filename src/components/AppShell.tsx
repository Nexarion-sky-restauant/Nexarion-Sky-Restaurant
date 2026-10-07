import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { appEnv } from '../config/env'

interface NavItem {
  to: string
  label: string
  icon: string
  permission?: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '▦', permission: 'dashboard.view' },
  { to: '/menu', label: 'Menu', icon: '✦' },
  { to: '/audit', label: 'Audit Log', icon: '≣', permission: 'audit.view' },
]

const ENV_BADGE: Record<string, { label: string; className: string }> = {
  development: { label: 'DEVELOPMENT', className: 'env-badge env-dev' },
  staging: { label: 'STAGING', className: 'env-badge env-staging' },
  production: { label: 'PRODUCTION', className: 'env-badge env-prod' },
}

export default function AppShell() {
  const { access, hasPermission, signOut } = useAuth()
  const navigate = useNavigate()
  const env = ENV_BADGE[appEnv()] ?? ENV_BADGE.development

  const visibleNav = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission))

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">NS</div>
          <div>
            <div className="brand-name">NEXARION SKY</div>
            <div className="brand-sub">Restaurant ERP</div>
          </div>
        </div>

        <nav className="nav">
          {visibleNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-note">
          <div className="sidebar-note-title">Foundation</div>
          Foundation phases 1–2 are complete and the Menu module is live. Rooms,
          POS, inventory, accounting and the remaining departments activate in
          their approved phases.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className={env.className}>{env.label}</span>
          <div className="topbar-spacer" />
          <div className="topbar-org">{access?.organization?.name}</div>
          <div className="topbar-user">
            <div className="topbar-user-name">{access?.profile?.full_name || '—'}</div>
            <div className="topbar-user-email">{access?.profile?.id}</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
