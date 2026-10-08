import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { filterAccessibleBranches, listBranches } from '../../lib/branches'
import { listTables } from '../../lib/tables'
import { formatKes, listMenu } from '../../lib/menu'
import type { MenuData } from '../../lib/menu'
import {
  ACTIVE_ORDER_STATUSES,
  listOrderItems,
  listOrders,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  orderTotal,
} from '../../lib/orders'
import { tzTimeKey } from '../../lib/reservations'
import type { Branch, Order, OrderItem, OrderStatus, RestaurantTable } from '../../types/database'
import OrderDetail from './OrderDetail'
import OrderEditor from './OrderEditor'

type StatusFilter = 'active' | 'all' | OrderStatus

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: 'open', label: ORDER_STATUS_LABELS.open },
  { value: 'placed', label: ORDER_STATUS_LABELS.placed },
  { value: 'served', label: ORDER_STATUS_LABELS.served },
  { value: 'completed', label: ORDER_STATUS_LABELS.completed },
  { value: 'cancelled', label: ORDER_STATUS_LABELS.cancelled },
]

function filterStatuses(filter: StatusFilter): OrderStatus[] | undefined {
  if (filter === 'active') return ACTIVE_ORDER_STATUSES
  if (filter === 'all') return undefined
  return [filter]
}

export default function OrdersPage() {
  const { access, hasPermission } = useAuth()
  const canCreate = hasPermission('pos.create')
  const canEdit = hasPermission('pos.edit')
  const canKitchen = hasPermission('kitchen.manage')
  const canVoid = hasPermission('pos.void')
  const organizationId = access?.organization?.id ?? ''
  const timeZone = access?.organization?.timezone ?? 'UTC'
  const accessBranchIds = access?.branch_ids

  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [dataState, setDataState] = useState<{
    key: string
    orders: Order[]
    items: OrderItem[]
  } | null>(null)
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  const dataKey = branchId && statusFilter ? `${branchId}|${statusFilter}` : null

  const load = useCallback(async () => {
    if (!branchId) return
    setError(null)
    setLoading(true)
    const [ordersResult, tablesResult, menuResult] = await Promise.all([
      listOrders(branchId, filterStatuses(statusFilter)),
      listTables(branchId, true),
      listMenu(true),
    ])
    if (ordersResult.error || tablesResult.error || menuResult.error) {
      setError(ordersResult.error ?? tablesResult.error ?? menuResult.error)
      setLoading(false)
      return
    }
    const orders = ordersResult.data ?? []
    const itemsResult = await listOrderItems(orders.map((order) => order.id))
    if (itemsResult.error) {
      setError(itemsResult.error)
      setLoading(false)
      return
    }
    setDataState({
      key: `${branchId}|${statusFilter}`,
      orders,
      items: itemsResult.data ?? [],
    })
    setTables(tablesResult.data ?? [])
    setMenu(menuResult.data)
    setLoading(false)
  }, [branchId, statusFilter])

  useEffect(() => {
    if (!branches) return
    if (!branchId) {
      setDataState(null)
      setLoading(false)
      return
    }
    void load()
  }, [branches, branchId, load])

  const data = dataState && dataKey && dataState.key === dataKey ? dataState : null
  const orders = data?.orders ?? null

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, OrderItem[]>()
    for (const item of data?.items ?? []) {
      const list = map.get(item.order_id)
      if (list) list.push(item)
      else map.set(item.order_id, [item])
    }
    return map
  }, [data])

  const selectedOrder = orders?.find((order) => order.id === selectedOrderId) ?? null
  const selectedItems = selectedOrder ? (itemsByOrder.get(selectedOrder.id) ?? []) : []

  const handleCreated = (orderId: string) => {
    setCreating(false)
    setSelectedOrderId(orderId)
    if (statusFilter === 'active' || statusFilter === 'all' || statusFilter === 'open') {
      void load()
    } else {
      setStatusFilter('active')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Orders</h1>
        <p className="page-sub">Point-of-sale orders and their kitchen-facing line items.</p>
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
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="page-controls-spacer" />
          {canCreate && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!branches}
              onClick={() => setCreating(true)}
            >
              New order
            </button>
          )}
        </div>
      )}

      {!branches ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading orders…</p>
          ) : (
            <>
              <p className="card-note">The orders could not be loaded.</p>
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
      ) : !orders ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading orders…</p>
          ) : (
            <>
              <p className="card-note">The orders could not be loaded.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                Retry
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="orders-layout">
          <div className="card">
            {orders.length === 0 ? (
              <p className="card-note">
                {canCreate ? 'No orders in this view yet.' : 'No orders in this view.'}
              </p>
            ) : (
              <div className="order-list">
                {orders.map((order) => {
                  const orderItems = itemsByOrder.get(order.id) ?? []
                  return (
                    <button
                      key={order.id}
                      type="button"
                      className={`order-row${order.id === selectedOrderId ? ' order-row-active' : ''}`}
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      <div className="order-time">
                        <span className="res-start">{tzTimeKey(order.created_at, timeZone)}</span>
                        <span className="res-window">{orderItems.length} items</span>
                      </div>
                      <div className="order-main">
                        <div className="order-title">
                          <span>
                            {ORDER_TYPE_LABELS[order.order_type]}
                            {order.table_id
                              ? ` · ${tables.find((table) => table.id === order.table_id)?.name ?? 'Table'}`
                              : ''}
                          </span>
                          <span className={`pill pill-status pill-${order.status}`}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>
                        </div>
                        <div className="order-meta">{formatKes(orderTotal(orderItems))}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            {selectedOrder ? (
              <OrderDetail
                order={selectedOrder}
                items={selectedItems}
                tables={tables}
                menu={menu}
                timeZone={timeZone}
                canCreate={canCreate}
                canEdit={canEdit}
                canKitchen={canKitchen}
                canVoid={canVoid}
                onReload={() => void load()}
              />
            ) : (
              <p className="card-note">Select an order to see its items and actions.</p>
            )}
          </div>
        </div>
      )}

      {creating && branchId && (
        <OrderEditor
          organizationId={organizationId}
          branchId={branchId}
          tables={tables}
          onClose={() => setCreating(false)}
          onSaved={handleCreated}
        />
      )}
    </div>
  )
}
