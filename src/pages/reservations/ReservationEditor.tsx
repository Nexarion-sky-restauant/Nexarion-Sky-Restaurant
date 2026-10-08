import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ReservationStatus, RestaurantTable, TableReservation } from '../../types/database'
import {
  listActiveReservationsInWindow,
  parseDuration,
  parsePartySize,
  reservationEndIso,
  saveReservation,
  STATUS_LABELS,
  tzDateKey,
  tzTimeKey,
  validateGuestName,
  validateGuestPhone,
  validateNotes,
  wallTimeToUtcIso,
} from '../../lib/reservations'

interface ReservationEditorProps {
  organizationId: string
  branchId: string
  tables: RestaurantTable[]
  timeZone: string
  defaultDateKey: string
  reservation: TableReservation | null
  onClose: () => void
  onSaved: () => void
}

export default function ReservationEditor({
  organizationId,
  branchId,
  tables,
  timeZone,
  defaultDateKey,
  reservation,
  onClose,
  onSaved,
}: ReservationEditorProps) {
  const [tableId, setTableId] = useState(reservation?.table_id ?? '')
  const [guestName, setGuestName] = useState(reservation?.guest_name ?? '')
  const [guestPhone, setGuestPhone] = useState(reservation?.guest_phone ?? '')
  const [partySize, setPartySize] = useState(reservation ? String(reservation.party_size) : '2')
  const [dateKey, setDateKey] = useState(
    reservation ? tzDateKey(reservation.starts_at, timeZone) : defaultDateKey,
  )
  const [timeKey, setTimeKey] = useState(
    reservation ? tzTimeKey(reservation.starts_at, timeZone) : '19:00',
  )
  const [duration, setDuration] = useState(String(reservation?.duration_minutes ?? 120))
  const [createStatus, setCreateStatus] = useState<ReservationStatus>('confirmed')
  const [notes, setNotes] = useState(reservation?.notes ?? '')
  const [tableError, setTableError] = useState<string | null>(null)
  const [guestNameError, setGuestNameError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [partyError, setPartyError] = useState<string | null>(null)
  const [durationError, setDurationError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectable = tables.filter((table) => table.is_active || table.id === reservation?.table_id)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextTableError = tableId ? null : 'Choose a table for this reservation.'
    const nextGuestNameError = validateGuestName(guestName)
    const nextPhoneError = validateGuestPhone(guestPhone)
    const nextParty = parsePartySize(partySize)
    const nextDuration = parseDuration(duration)
    const nextNotesError = validateNotes(notes)
    const startsAt = wallTimeToUtcIso(dateKey, timeKey, timeZone)
    const nextTimeError = startsAt ? null : 'Enter a valid date and time.'
    setTableError(nextTableError)
    setGuestNameError(nextGuestNameError)
    setPhoneError(nextPhoneError)
    setPartyError(nextParty.error)
    setDurationError(nextDuration.error)
    setNotesError(nextNotesError)
    setTimeError(nextTimeError)
    if (
      nextTableError ||
      nextGuestNameError ||
      nextPhoneError ||
      nextParty.error ||
      nextDuration.error ||
      nextNotesError ||
      nextTimeError
    ) {
      return
    }
    if (!startsAt || nextParty.value === null || nextDuration.value === null) return

    setBusy(true)
    setError(null)
    const endsAt = reservationEndIso(startsAt, nextDuration.value)

    // Client pre-check for friendly feedback; the exclusion constraint on the
    // server remains the authority for double-booking.
    const { data: conflicts, error: conflictError } = await listActiveReservationsInWindow(
      tableId,
      startsAt,
      endsAt,
      reservation?.id,
    )
    if (conflictError) {
      setBusy(false)
      setError(conflictError)
      return
    }
    if (conflicts && conflicts.length > 0) {
      setBusy(false)
      setError('That table already has a reservation during this time.')
      return
    }

    const { error: saveError } = await saveReservation(organizationId, branchId, reservation?.id ?? null, {
      table_id: tableId,
      guest_name: guestName.trim(),
      guest_phone: guestPhone.trim(),
      party_size: nextParty.value,
      starts_at: startsAt,
      duration_minutes: nextDuration.value,
      status: reservation?.status ?? createStatus,
      notes: notes.trim(),
    })
    setBusy(false)
    if (saveError) {
      setError(saveError)
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="reservation-editor-title">
          {reservation ? 'Edit reservation' : 'New reservation'}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Table</span>
            <select value={tableId} onChange={(event) => setTableId(event.target.value)}>
              <option value="">Choose a table…</option>
              {selectable.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name} · {table.zone} · {table.capacity} seats
                </option>
              ))}
            </select>
          </label>
          {tableError && <div className="field-error">{tableError}</div>}
          {selectable.length === 0 && (
            <p className="card-note">No tables are set up in this branch yet. Create a table first.</p>
          )}

          <label className="field">
            <span>Guest name</span>
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>
          {guestNameError && <div className="field-error">{guestNameError}</div>}

          <label className="field">
            <span>Phone (optional)</span>
            <input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} maxLength={32} />
          </label>
          {phoneError && <div className="field-error">{phoneError}</div>}

          <div className="field-row">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={dateKey}
                onChange={(event) => {
                  if (event.target.value) setDateKey(event.target.value)
                }}
              />
            </label>
            <label className="field field-narrow">
              <span>Time</span>
              <input
                type="time"
                value={timeKey}
                onChange={(event) => {
                  if (event.target.value) setTimeKey(event.target.value)
                }}
              />
            </label>
          </div>
          {timeError && <div className="field-error">{timeError}</div>}

          <div className="field-row">
            <label className="field field-narrow">
              <span>Party size</span>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={partySize}
                onChange={(event) => setPartySize(event.target.value)}
              />
            </label>
            <label className="field field-narrow">
              <span>Duration (minutes)</span>
              <input
                type="number"
                min="15"
                max="480"
                step="15"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </label>
          </div>
          {partyError && <div className="field-error">{partyError}</div>}
          {durationError && <div className="field-error">{durationError}</div>}

          {reservation ? (
            <div className="control-inline">
              <span>Status</span>
              <span className={`pill pill-status pill-${reservation.status}`}>
                {STATUS_LABELS[reservation.status]}
              </span>
            </div>
          ) : (
            <label className="field field-narrow">
              <span>Create as</span>
              <select
                value={createStatus}
                onChange={(event) => setCreateStatus(event.target.value as ReservationStatus)}
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
          )}

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
            />
          </label>
          {notesError && <div className="field-error">{notesError}</div>}

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save reservation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
