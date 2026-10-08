import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { filterAccessibleBranches, listBranches } from '../../lib/branches'
import { listTables } from '../../lib/tables'
import type { Branch, RestaurantTable } from '../../types/database'
import TableEditor from './TableEditor'

export default function TablesPage() {
  const { access, hasPermission } = useAuth()
  const canManage = hasPermission('tables.manage')
  const organizationId = access?.organization?.id ?? ''
  const accessBranchIds = access?.branch_ids

  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [tablesState, setTablesState] = useState<{ branchId: string; rows: RestaurantTable[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editor, setEditor] = useState<{ table: RestaurantTable | null } | null>(null)

  const loadBranches = useCallback(async () => {
    setError(null)
    setLoading(true)
    const { data, error: branchError } = await listBranches()
    if (branchError) {
      setError(branchError)
      setLoading(false)
      return
    }
    setBranches(data)
  }, [])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches])

  const accessibleBranches = useMemo(
    () => filterAccessibleBranches(branches ?? [], accessBranchIds ?? []),
    [branches, accessBranchIds],
  )

  const branchId = selectedBranchId ?? accessibleBranches[0]?.id ?? null

  const load = useCallback(async () => {
    if (!branchId) return
    setError(null)
    setLoading(true)
    const { data, error: loadError } = await listTables(branchId, includeInactive)
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setTablesState({ branchId, rows: data ?? [] })
    setLoading(false)
  }, [branchId, includeInactive])

  useEffect(() => {
    if (!branches) return
    if (!branchId) {
      setTablesState(null)
      setLoading(false)
      return
    }
    void load()
  }, [branches, branchId, load])

  const tables = tablesState && tablesState.branchId === branchId ? tablesState.rows : null

  const zoneGroups = useMemo(() => {
    const groups: { zone: string; rows: RestaurantTable[] }[] = []
    for (const row of tables ?? []) {
      const last = groups[groups.length - 1]
      if (last && last.zone === row.zone) last.rows.push(row)
      else groups.push({ zone: row.zone, rows: [row] })
    }
    return groups
  }, [tables])

  const handleSaved = () => {
    setEditor(null)
    void load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tables</h1>
        <p className="page-sub">The floor plan grouped by zone — availability is driven by reservations.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {branchId && (
        <div className="page-controls">
          {accessibleBranches.length > 1 && (
            <label className="control-inline">
              <span>Branch</span>
              <select value={branchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
                {accessibleBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canManage && (
            <label className="field-check">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />
              <span>Show inactive</span>
            </label>
          )}
          <div className="page-controls-spacer" />
          {canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setEditor({ table: null })}>
              New table
            </button>
          )}
        </div>
      )}

      {!branches ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading floor plan…</p>
          ) : (
            <>
              <p className="card-note">The floor plan could not be loaded.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void loadBranches()}>
                Retry
              </button>
            </>
          )}
        </div>
      ) : accessibleBranches.length === 0 ? (
        <div className="card">
          <p className="card-note">No branches are available for your account.</p>
        </div>
      ) : !tables ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading floor plan…</p>
          ) : (
            <>
              <p className="card-note">The floor plan could not be loaded.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                Retry
              </button>
            </>
          )}
        </div>
      ) : tables.length === 0 ? (
        <div className="card">
          <p className="card-note">
            {canManage
              ? 'No tables yet. Create the first table to start building the floor plan.'
              : 'The floor plan has not been set up yet.'}
          </p>
        </div>
      ) : (
        zoneGroups.map((group) => (
          <div key={group.zone} className="card">
            <div className="section-head">
              <h2 className="section-title">{group.zone}</h2>
              <span className="section-count">
                {group.rows.length} {group.rows.length === 1 ? 'table' : 'tables'}
              </span>
            </div>
            <div className="floor-grid">
              {group.rows.map((table) => (
                <div
                  key={table.id}
                  className={table.is_active ? 'floor-table' : 'floor-table floor-table-inactive'}
                >
                  <div className="floor-table-name">
                    <span>{table.name}</span>
                    {!table.is_active && <span className="pill pill-inactive">Inactive</span>}
                  </div>
                  <div className="floor-table-meta">
                    {table.capacity} {table.capacity === 1 ? 'seat' : 'seats'}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditor({ table })}
                    >
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editor && branchId && (
        <TableEditor
          organizationId={organizationId}
          branchId={branchId}
          table={editor.table}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
