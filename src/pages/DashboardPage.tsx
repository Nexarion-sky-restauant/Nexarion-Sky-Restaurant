import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { Branch } from '../types/database'

/**
 * Foundation dashboard. Its purpose at Phase 1+2 is verification: everything on
 * this page is fetched through RLS-protected queries, so a working page proves
 * auth → schema → permissions → branch scoping are all functioning.
 */
export default function DashboardPage() {
  const { access } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .schema('app')
      .from('branches')
      .select('*')
      .order('code')
      .then(({ data, error }) => {
        if (error) setLoadError(error.message)
        else setBranches(data ?? [])
      })
  }, [])

  const restricted = (access?.branch_ids.length ?? 0) > 0

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-sub">Foundation verification — data below comes from RLS-protected live queries.</p>
      </div>

      {loadError && <div className="alert alert-error">Could not load branches: {loadError}</div>}

      <div className="card-grid">
        <section className="card">
          <div className="card-title">Organization</div>
          <div className="card-value">{access?.organization?.name ?? '—'}</div>
          <dl className="kv">
            <dt>Slug</dt>
            <dd>{access?.organization?.slug}</dd>
            <dt>Currency</dt>
            <dd>{access?.organization?.default_currency}</dd>
            <dt>Timezone</dt>
            <dd>{access?.organization?.timezone}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-title">Your access</div>
          <div className="card-value">{access?.permissions.length ?? 0} permissions</div>
          <p className="card-note">
            Branch scope: {restricted ? `${access?.branch_ids.length} assigned branch(es)` : 'all branches'}.
          </p>
          <div className="chips">
            {access?.permissions.slice(0, 12).map((key) => (
              <span key={key} className="chip">{key}</span>
            ))}
            {(access?.permissions.length ?? 0) > 12 && (
              <span className="chip chip-muted">+{access!.permissions.length - 12} more</span>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-title">Branches</div>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={branch.id}>
                <td>{branch.code}</td>
                <td>{branch.name}</td>
                <td>{branch.phone ?? '—'}</td>
                <td>
                  <span className={branch.is_active ? 'pill pill-green' : 'pill'}>
                    {branch.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td colSpan={4} className="table-empty">No branches visible to your account (RLS may be restricting).</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
