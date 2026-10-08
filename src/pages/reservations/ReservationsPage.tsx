import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { filterAccessibleBranches, listBranches } from '../../lib/branches'
import { listTables } from '../../lib/tables'
import {
  allowedTransitions,
  dayBoundsUtc,
  listReservations,
  setReservationStatus,
  STATUS_LABELS,
  tzTimeKey,
  tzToday,
} from '../../lib/reservations'
import type {
  Branch,
  ReservationStatus,
  RestaurantTable,
  TableReservation,
} from '../../types/database'
import ReservationEditor from './ReservationEditor'

const ACTION_LABELS: Record<ReservationStatus, string> = {
  pending: 'Restore',
  confirmed: 'Confirm',
  seated: 'Seat',
  completed: 'Complete',
  cancelled: 'Cancel',
  no_show: 'No show',
}

function StatusPill({ status }: { status: ReservationStatus }) {
  return <span className={`pill pill-status pill-${status}`}>{STATUS_LABELS[status]}</span>
}

export default function ReservationsPage() {
  const { access, hasPermission } = useAuth()
  const canCreate = hasPermission('reservations.create')
  const canEdit = hasPermission('reservations.edit')
  const canCancel = hasPermission('reservations.cancel')
  const organizationId = access?.organization?.id ?? ''
  const timeZone = access?.organization?.timezone ?? 'UTC'
  const accessBranchIds = access?.branch_ids

  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [dateKey, setDateKey] = useState(() => tzToday(timeZone))
  const [dataState, setDataState] = useState<{ key: string; rows: TableReservation[] } | null>(null)
  const [lastTables, setLastTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ reservation: TableReservation | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const day = useMemo(() => dayBoundsUtc(dateKey, timeZone), [dateKey, timeZone])

  const load = useCallback(async () => {
    if (!branchId || !day) return
    setError(null)
    setLoading(true)
    const [reservationsResult, tablesResult] = await Promise.all([
      listReservations(branchId, day.startIso, day.endIso),
      listTables(branchId, true),
    ])
    if (reservationsResult.error || tablesResult.error) {
      setError(reservationsResult.error ?? tablesResult.error)
      setLoading(false)
      return
    }
    setDataState({ key: `${branchId}|${dateKey}`, rows: reservationsResult.data ?? [] })
    setLastTables(tablesResult.data ?? [])
    setLoading(false)
  }, [branchId, day, dateKey])

  useEffect(() => {
    if (!branches) return
    if (!branchId) {
      setDataState(null)
      setLoading(false)
      return
    }
    void load()
  }, [branches, branchId, load])

  const reservations =
    dataState && branchId && dataState.key === `${branchId}|${dateKey}` ? dataState.rows : null

  const tablesById = useMemo(
    () => new Map(lastTables.map((table) => [table.id, table])),
    [lastTables],
  )

  const handleSaved = () => {
    setEditor(null)
    void load()
  }

  const handleStatus = async (reservation: TableReservation, next: ReservationStatus) => {
    setBusyId(reservation.id)
    setError(null)
    const { error: statusError } = await setReservationStatus(reservation.id, next)
    setBusyId(null)
    // load() clears the error state when it starts, so report a failed change
    // after kicking off the reload or the alert would be wiped instantly.
    void load()
    if (statusError) setError(statusError)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reservations</h1>
        <p className="page-sub">Bookings for the selected day, shown in {timeZone}.</p>
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
          <label className="control-inline">
            <span>Date</span>
            <input
              type="date"
              value={dateKey}
              onChange={(event) => {
                if (event.target.value) setDateKey(event.target.value)
              }}
            />
          </label>
          <div className="page-controls-spacer" />
          {canCreate && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reservations}
              onClick={() => setEditor({ reservation: null })}
            >
              New reservation
            </button>
          )}
        </div>
      )}

      {!branches ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading reservations…</p>
          ) : (
            <>
              <p className="card-note">The reservations could not be loaded.</p>
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
      ) : !reservations ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading reservations…</p>
          ) : (
            <>
              <p className="card-note">The reservations could not be loaded.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                Retry
              </button>
            </>
          )}
        </div>
      ) : reservations.length === 0 ? (
        <div className="card">
          <p className="card-note">
            {canCreate ? 'No reservations for this day yet.' : 'No reservations for this day.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="res-list">
            {reservations.map((reservation) => {
              const transitions = allowedTransitions(reservation.status).filter((next) =>
                next === 'cancelled' ? canCancel : canEdit,
              )
              return (
                <div key={reservation.id} className="res-row">
                  <div className="res-time">
                    <span className="res-start">{tzTimeKey(reservation.starts_at, timeZone)}</span>
                    <span className="res-window">– {tzTimeKey(reservation.ends_at, timeZone)}</span>
                  </div>
                  <div className="res-main">
                    <div className="res-guest">
                      <span>{reservation.guest_name}</span>
                      <StatusPill status={reservation.status} />
                    </div>
                    <div className="res-meta">
                      Party of {reservation.party_size}
                      {' · '}
                      {tablesById.get(reservation.table_id)?.name ?? 'Table'}
                      {reservation.guest_phone ? ` · ${reservation.guest_phone}` : ''}
                    </div>
                    {reservation.notes && <div className="res-meta">{reservation.notes}</div>}
                  </div>
                  <div className="res-actions">
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditor({ reservation })}
                      >
                        Edit
                      </button>
                    )}
                    {transitions.map((next) => (
                      <button
                        key={next}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === reservation.id}
                        onClick={() => void handleStatus(reservation, next)}
                      >
                        {ACTION_LABELS[next]}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editor && branchId && (
        <ReservationEditor
          organizationId={organizationId}
          branchId={branchId}
          tables={lastTables}
          timeZone={timeZone}
          defaultDateKey={dateKey}
          reservation={editor.reservation}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
