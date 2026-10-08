import { useState } from 'react'
import type { FormEvent } from 'react'
import type { OrderType, RestaurantTable } from '../../types/database'
import { createOrder, ORDER_TYPE_LABELS, validateOrderNotes } from '../../lib/orders'

interface OrderEditorProps {
  organizationId: string
  branchId: string
  tables: RestaurantTable[]
  onClose: () => void
  onSaved: (orderId: string) => void
}

export default function OrderEditor({
  organizationId,
  branchId,
  tables,
  onClose,
  onSaved,
}: OrderEditorProps) {
  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')
  const [tableError, setTableError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectable = tables.filter((table) => table.is_active)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextTableError =
      orderType === 'dine_in' && !tableId ? 'Choose a table for this dine-in order.' : null
    const nextNotesError = validateOrderNotes(notes)
    setTableError(nextTableError)
    setNotesError(nextNotesError)
    if (nextTableError || nextNotesError) return

    setBusy(true)
    setError(null)
    const { id, error: saveError } = await createOrder(organizationId, branchId, {
      order_type: orderType,
      table_id: orderType === 'dine_in' ? tableId : null,
      reservation_id: null,
      notes: notes.trim(),
    })
    setBusy(false)
    if (saveError || !id) {
      setError(saveError ?? 'The order could not be created.')
      return
    }
    onSaved(id)
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="order-editor-title">
          New order
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field field-narrow">
            <span>Order type</span>
            <select
              value={orderType}
              onChange={(event) => {
                const next = event.target.value as OrderType
                setOrderType(next)
                if (next === 'takeaway') {
                  setTableId('')
                  setTableError(null)
                }
              }}
            >
              <option value="dine_in">{ORDER_TYPE_LABELS.dine_in}</option>
              <option value="takeaway">{ORDER_TYPE_LABELS.takeaway}</option>
            </select>
          </label>

          {orderType === 'dine_in' && (
            <>
              <label className="field">
                <span>Table</span>
                <select
                  value={tableId}
                  onChange={(event) => setTableId(event.target.value)}
                  autoFocus
                >
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
            </>
          )}

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={500}
              rows={2}
            />
          </label>
          {notesError && <div className="field-error">{notesError}</div>}

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
