import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function FullScreenLoading({ label = 'Loading Nexarion Sky…' }: { label?: string }) {
  return (
    <div className="splash">
      <div className="splash-brand">NEXARION SKY</div>
      <div className="splash-spinner" aria-hidden="true" />
      <div className="splash-label">{label}</div>
    </div>
  )
}

/** Requires a signed-in user; redirects to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoading />
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

/** Requires an organization membership; sends fresh users to /bootstrap. */
export function RequireOrganization({ children }: { children: ReactNode }) {
  const { access, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!access?.organization) return <Navigate to="/bootstrap" replace />
  return <>{children}</>
}

/** Requires a specific permission key; otherwise /unauthorized. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { hasPermission, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!hasPermission(permission)) return <Navigate to="/unauthorized" replace />
  return <>{children}</>
}
