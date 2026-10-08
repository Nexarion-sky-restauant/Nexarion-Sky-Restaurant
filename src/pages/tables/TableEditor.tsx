import { useState } from 'react'
import type { FormEvent } from 'react'
import type { RestaurantTable } from '../../types/database'
import { parseCapacity, saveTable, validateTableName, validateZone } from '../../lib/tables'

interface TableEditorProps {
  organizationId: string
  branchId: string
  table: RestaurantTable | null
  onClose: () => void
  onSaved: () => void
}

export default function TableEditor({ organizationId, branchId, table, onClose, onSaved }: TableEditorProps) {
  const [name, setName] = useState(table?.name ?? '')
  const [zone, setZone] = useState(table?.zone ?? 'Main')
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 2))
  const [sortOrder, setSortOrder] = useState(String(table?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(table?.is_active ?? true)
  const [nameError, setNameError] = useState<string | null>(null)
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [capacityError, setCapacityError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextNameError = validateTableName(name)
    const nextZoneError = validateZone(zone)
    const nextCapacity = parseCapacity(capacity)
    setNameError(nextNameError)
    setZoneError(nextZoneError)
    setCapacityError(nextCapacity.error)
    if (nextNameError || nextZoneError || nextCapacity.error) return
    if (nextCapacity.value === null) return

    setBusy(true)
    setError(null)
    const { error: saveError } = await saveTable(organizationId, branchId, table?.id ?? null, {
      name: name.trim(),
      zone: zone.trim(),
      capacity: nextCapacity.value,
      sort_order: Number.parseInt(sortOrder, 10) || 0,
      is_active: isActive,
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
        aria-labelledby="table-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="table-editor-title">
          {table ? 'Edit table' : 'New table'}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Table name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
          </label>
          {nameError && <div className="field-error">{nameError}</div>}

          <label className="field">
            <span>Zone</span>
            <input value={zone} onChange={(event) => setZone(event.target.value)} maxLength={60} />
          </label>
          {zoneError && <div className="field-error">{zoneError}</div>}

          <div className="field-row">
            <label className="field field-narrow">
              <span>Capacity</span>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </label>
            <label className="field field-narrow">
              <span>Sort order</span>
              <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
            </label>
            <label className="field-check">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>
          {capacityError && <div className="field-error">{capacityError}</div>}

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
