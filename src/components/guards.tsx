import { useState } from 'react'
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

/** Shown when the access lookup fails — a retry, not a /bootstrap bounce (M7). */
export function AccessErrorScreen({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div>
            <div className="brand-name">NEXARION SKY</div>
            <div className="brand-sub">Restaurant ERP</div>
          </div>
        </div>
        <h1>We couldn&apos;t load your access</h1>
        <div className="alert alert-error" role="alert">{message}</div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={retrying}
          onClick={() => void handleRetry()}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
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

/** Requires an organization membership; sends fresh users to /bootstrap.
 *  An access-load failure shows the retry screen instead of bouncing (M7). */
export function RequireOrganization({ children }: { children: ReactNode }) {
  const { access, accessError, loading, refreshAccess } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!access?.organization) {
    if (accessError) return <AccessErrorScreen message={accessError} onRetry={refreshAccess} />
    return <Navigate to="/bootstrap" replace />
  }
  return <>{children}</>
}

/** Requires a specific permission key; otherwise /unauthorized. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { hasPermission, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!hasPermission(permission)) return <Navigate to="/unauthorized" replace />
  return <>{children}</>
}
