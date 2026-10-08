import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  Order,
  OrderItem,
  OrderItemStatus,
  OrderStatus,
  RestaurantTable,
} from '../../types/database'
import type { MenuData } from '../../lib/menu'
import { formatKes } from '../../lib/menu'
import {
  addOrderItem,
  allowedItemTransitions,
  allowedOrderTransitions,
  ITEM_ACTION_LABELS,
  ITEM_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  orderTotal,
  parseQuantity,
  removeOrderItem,
  setOrderItemStatus,
  setOrderStatus,
  updateOrderItem,
  updateOrderNotes,
  validateItemNotes,
  validateOrderNotes,
  validateVoidReason,
  voidOrderItem,
} from '../../lib/orders'
import { tzDateKey, tzTimeKey } from '../../lib/reservations'

const ORDER_ACTION_LABELS: Record<OrderStatus, string> = {
  open: 'Reopen',
  placed: 'Place order',
  served: 'Mark served',
  completed: 'Complete',
  cancelled: 'Cancel order',
}

interface OrderDetailProps {
  order: Order
  items: OrderItem[]
  tables: RestaurantTable[]
  menu: MenuData | null
  timeZone: string
  canCreate: boolean
  canEdit: boolean
  canKitchen: boolean
  canVoid: boolean
  onReload: () => void
}

export default function OrderDetail({
  order,
  items,
  tables,
  menu,
  timeZone,
  canCreate,
  canEdit,
  canKitchen,
  canVoid,
  onReload,
}: OrderDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState(order.notes)
  const [notesBusy, setNotesBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null)
  const [voidingItem, setVoidingItem] = useState<OrderItem | null>(null)
  const [addMenuItemId, setAddMenuItemId] = useState('')
  const [addQuantity, setAddQuantity] = useState('1')
  const [addNotes, setAddNotes] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setNotesDraft(order.notes)
  }, [order.notes])

  const frozen = order.status === 'completed' || order.status === 'cancelled'
  const editableNotes = canEdit && !frozen

  const orderTransitions = allowedOrderTransitions(order.status).filter((next) =>
    next === 'cancelled' ? canVoid : canEdit,
  )

  const itemTransitions = (item: OrderItem): OrderItemStatus[] => {
    if (item.voided_at || frozen) return []
    if (order.status !== 'placed' && order.status !== 'served') return []
    return allowedItemTransitions(item.status).filter((next) =>
      next === 'served' ? canEdit : canKitchen,
    )
  }

  const tableLabel =
    order.order_type === 'takeaway'
      ? ORDER_TYPE_LABELS.takeaway
      : (tables.find((table) => table.id === order.table_id)?.name ?? 'Table')

  const pickableItems = useMemo(
    () => (menu?.items ?? []).filter((item) => item.is_active && item.is_available),
    [menu],
  )

  const handleOrderStatus = async (next: OrderStatus) => {
    setBusyAction(next)
    setError(null)
    const { error: statusError } = await setOrderStatus(order.id, next)
    setBusyAction(null)
    // onReload clears the error state when it starts, so report a failed change
    // after kicking off the reload or the alert would be wiped instantly.
    onReload()
    if (statusError) setError(statusError)
  }

  const handleItemStatus = async (item: OrderItem, next: OrderItemStatus) => {
    setBusyItemId(item.id)
    setError(null)
    const { error: statusError } = await setOrderItemStatus(item.id, next)
    setBusyItemId(null)
    onReload()
    if (statusError) setError(statusError)
  }

  const handleRemoveItem = async (item: OrderItem) => {
    setBusyItemId(item.id)
    setError(null)
    const { error: removeError } = await removeOrderItem(item.id)
    setBusyItemId(null)
    onReload()
    if (removeError) setError(removeError)
  }

  const handleSaveNotes = async (event: FormEvent) => {
    event.preventDefault()
    const nextNotesError = validateOrderNotes(notesDraft)
    if (nextNotesError) {
      setError(nextNotesError)
      return
    }
    setNotesBusy(true)
    setError(null)
    const { error: saveError } = await updateOrderNotes(order.id, notesDraft.trim())
    setNotesBusy(false)
    onReload()
    if (saveError) setError(saveError)
  }

  const handleAddItem = async (event: FormEvent) => {
    event.preventDefault()
    const nextItemError = addMenuItemId ? null : 'Choose a menu item.'
    const nextQuantity = parseQuantity(addQuantity)
    const nextNotesError = validateItemNotes(addNotes)
    setAddError(nextItemError ?? nextQuantity.error ?? nextNotesError)
    if (nextItemError || nextQuantity.error || nextNotesError) return
    if (nextQuantity.value === null) return

    setAdding(true)
    setError(null)
    const { error: addItemError } = await addOrderItem(
      order.id,
      addMenuItemId,
      nextQuantity.value,
      addNotes.trim(),
    )
    setAdding(false)
    if (addItemError) {
      setAddError(addItemError)
      return
    }
    setAddMenuItemId('')
    setAddQuantity('1')
    setAddNotes('')
    onReload()
  }

  return (
    <div className="order-detail">
      <div className="order-detail-head">
        <div>
          <h2 className="section-title">
            {ORDER_TYPE_LABELS[order.order_type]} · {tableLabel}
          </h2>
          <div className="order-meta">
            Opened {tzDateKey(order.created_at, timeZone)} at{' '}
            {tzTimeKey(order.created_at, timeZone)}
          </div>
        </div>
        <span className={`pill pill-status pill-${order.status}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {orderTransitions.length > 0 && (
        <div className="res-actions">
          {orderTransitions.map((next) => (
            <button
              key={next}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busyAction !== null}
              onClick={() => void handleOrderStatus(next)}
            >
              {ORDER_ACTION_LABELS[next]}
            </button>
          ))}
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Total</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="table-empty">
                No items yet.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr key={item.id} className={item.voided_at ? 'item-voided' : undefined}>
              <td>
                <div className="order-item-name">{item.name_snapshot}</div>
                {item.notes && <div className="order-meta">{item.notes}</div>}
                {item.voided_at && <div className="order-meta">Voided: {item.void_reason}</div>}
              </td>
              <td>×{item.quantity}</td>
              <td>{formatKes(item.unit_price)}</td>
              <td>{formatKes(item.line_total)}</td>
              <td>
                {item.voided_at ? (
                  <span className="pill pill-status pill-cancelled">Voided</span>
                ) : (
                  <span className={`pill pill-status pill-${item.status}`}>
                    {ITEM_STATUS_LABELS[item.status]}
                  </span>
                )}
              </td>
              <td>
                <div className="res-actions">
                  {itemTransitions(item).map((next) => (
                    <button
                      key={next}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyItemId === item.id}
                      onClick={() => void handleItemStatus(item, next)}
                    >
                      {ITEM_ACTION_LABELS[next]}
                    </button>
                  ))}
                  {canEdit && order.status === 'open' && !item.voided_at && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditingItem(item)}
                    >
                      Edit
                    </button>
                  )}
                  {canVoid && !item.voided_at && !frozen && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setVoidingItem(item)}
                    >
                      Void
                    </button>
                  )}
                  {canEdit && order.status === 'open' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyItemId === item.id}
                      onClick={() => void handleRemoveItem(item)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="order-total">Total {formatKes(orderTotal(items))}</div>

      {canEdit &&
        (editableNotes ? (
          <form className="form" onSubmit={handleSaveNotes}>
            <label className="field">
              <span>Notes (optional)</span>
              <textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                maxLength={500}
                rows={2}
              />
            </label>
            <div className="modal-actions">
              <button
                type="submit"
                className="btn btn-ghost btn-sm"
                disabled={notesBusy || notesDraft === order.notes}
              >
                {notesBusy ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </form>
        ) : (
          order.notes && <p className="order-meta">{order.notes}</p>
        ))}

      {order.status === 'open' &&
        (canCreate ? (
          menu ? (
            <form className="order-add" onSubmit={handleAddItem}>
              <label className="field">
                <span>Menu item</span>
                <select
                  value={addMenuItemId}
                  onChange={(event) => setAddMenuItemId(event.target.value)}
                >
                  <option value="">Choose an item…</option>
                  {menu.categories.map((category) => {
                    const categoryItems = pickableItems.filter(
                      (item) => item.category_id === category.id,
                    )
                    if (categoryItems.length === 0) return null
                    return (
                      <optgroup key={category.id} label={category.name}>
                        {categoryItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {formatKes(item.price)}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </label>
              <label className="field field-narrow">
                <span>Qty</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  value={addQuantity}
                  onChange={(event) => setAddQuantity(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Item notes (optional)</span>
                <input
                  value={addNotes}
                  onChange={(event) => setAddNotes(event.target.value)}
                  maxLength={200}
                />
              </label>
              <button type="submit" className="btn btn-primary btn-sm" disabled={adding}>
                {adding ? 'Adding…' : 'Add item'}
              </button>
            </form>
          ) : (
            <p className="card-note">The menu could not be loaded, so items cannot be added.</p>
          )
        ) : null)}
      {addError && <div className="field-error">{addError}</div>}
      {order.status !== 'open' && !frozen && (
        <p className="card-note">Items can only be added while the order is open.</p>
      )}

      {editingItem && (
        <ItemEditor
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null)
            onReload()
          }}
        />
      )}
      {voidingItem && (
        <VoidPrompt
          item={voidingItem}
          onClose={() => setVoidingItem(null)}
          onSaved={() => {
            setVoidingItem(null)
            onReload()
          }}
        />
      )}
    </div>
  )
}

function ItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: OrderItem
  onClose: () => void
  onSaved: () => void
}) {
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [notes, setNotes] = useState(item.notes)
  const [quantityError, setQuantityError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextQuantity = parseQuantity(quantity)
    const nextNotesError = validateItemNotes(notes)
    setQuantityError(nextQuantity.error)
    setNotesError(nextNotesError)
    if (nextQuantity.error || nextNotesError) return
    if (nextQuantity.value === null) return

    setBusy(true)
    setError(null)
    const { error: saveError } = await updateOrderItem(item.id, {
      quantity: nextQuantity.value,
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
        aria-labelledby="item-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="item-editor-title">
          Edit {item.name_snapshot}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field field-narrow">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              autoFocus
            />
          </label>
          {quantityError && <div className="field-error">{quantityError}</div>}

          <label className="field">
            <span>Item notes (optional)</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200} />
          </label>
          {notesError && <div className="field-error">{notesError}</div>}

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VoidPrompt({
  item,
  onClose,
  onSaved,
}: {
  item: OrderItem
  onClose: () => void
  onSaved: () => void
}) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextReasonError = validateVoidReason(reason)
    setReasonError(nextReasonError)
    if (nextReasonError) return

    setBusy(true)
    setError(null)
    const { error: voidError } = await voidOrderItem(item.id, reason.trim())
    setBusy(false)
    if (voidError) {
      setError(voidError)
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
        aria-labelledby="void-prompt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="void-prompt-title">
          Void {item.name_snapshot}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <p className="card-note">
            The line stays on the check as a voided item and is excluded from the total.
          </p>
          <label className="field">
            <span>Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              rows={2}
              autoFocus
            />
          </label>
          {reasonError && <div className="field-error">{reasonError}</div>}

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Voiding…' : 'Void item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
