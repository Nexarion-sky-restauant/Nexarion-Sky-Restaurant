import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuditLogEntry } from '../types/database'

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .schema('app')
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setEntries(data ?? [])
      })
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Audit Log</h1>
        <p className="page-sub">Append-only trail. Visible with the audit.view permission only.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Entity ID</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="mono">{new Date(entry.created_at).toLocaleString()}</td>
                <td>{entry.actor_email ?? '—'}</td>
                <td>
                  <span className="chip">{entry.action}</span>
                </td>
                <td>{entry.entity_type}</td>
                <td className="mono">{entry.entity_id ?? '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="table-empty">No audit entries yet. Bootstrapping your organization created the first one.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
