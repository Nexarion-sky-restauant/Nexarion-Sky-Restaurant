import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { filterAccessibleBranches, listBranches } from '../../lib/branches'
import { listTables } from '../../lib/tables'
import { listMenu } from '../../lib/menu'
import {
  allowedItemTransitions,
  ITEM_ACTION_LABELS,
  ITEM_STATUS_LABELS,
  KITCHEN_ITEM_STATUSES,
  listKitchenBoard,
  setOrderItemStatus,
} from '../../lib/orders'
import { tzTimeKey } from '../../lib/reservations'
import type {
  Branch,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  OrderItemStatus,
  RestaurantTable,
} from '../../types/database'

const POLL_MS = 15000

export default function KitchenPage() {
  const { access, hasPermission } = useAuth()
  const canAdvance = hasPermission('kitchen.manage')
  const canServe = hasPermission('pos.edit')
  const timeZone = access?.organization?.timezone ?? 'UTC'
  const accessBranchIds = access?.branch_ids

  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [board, setBoard] = useState<{ key: string; orders: Order[]; items: OrderItem[] } | null>(
    null,
  )
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [menuItemsById, setMenuItemsById] = useState<Map<string, MenuItem>>(new Map())
  const [categoriesById, setCategoriesById] = useState<Map<string, MenuCategory>>(new Map())
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
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

  const load = useCallback(
    async (quiet: boolean) => {
      if (!branchId) return
      if (!quiet) setLoading(true)
      setError(null)
      const { data, error: boardError } = await listKitchenBoard(branchId)
      if (boardError) {
        setError(boardError)
        setLoading(false)
        return
      }
      setBoard({ key: branchId, orders: data?.orders ?? [], items: data?.items ?? [] })
      setRefreshedAt(tzTimeKey(Date.now(), timeZone))
      setLoading(false)
    },
    [branchId, timeZone],
  )

  useEffect(() => {
    if (!branches) return
    if (!branchId) {
      setBoard(null)
      setLoading(false)
      return
    }
    void load(false)
    const timer = setInterval(() => void load(true), POLL_MS)
    return () => clearInterval(timer)
  }, [branches, branchId, load])

  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    void (async () => {
      const [tablesResult, menuResult] = await Promise.all([
        listTables(branchId, true),
        listMenu(true),
      ])
      if (cancelled) return
      if (tablesResult.error || menuResult.error) {
        setError(tablesResult.error ?? menuResult.error)
        return
      }
      setTables(tablesResult.data ?? [])
      if (menuResult.data) {
        setMenuItemsById(new Map(menuResult.data.items.map((item) => [item.id, item])))
        setCategoriesById(new Map(menuResult.data.categories.map((category) => [category.id, category])))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [branchId])

  const boardData = board && branchId && board.key === branchId ? board : null

  const ordersById = useMemo(
    () => new Map((boardData?.orders ?? []).map((order) => [order.id, order])),
    [boardData],
  )

  const categoryNameOf = useCallback(
    (item: OrderItem): string | null => {
      const menuItem = menuItemsById.get(item.menu_item_id)
      if (!menuItem) return null
      return categoriesById.get(menuItem.category_id)?.name ?? null
    },
    [menuItemsById, categoriesById],
  )

  // Only categories with live lines are offered, so a filter never yields an
  // empty board on its own.
  const presentCategories = useMemo(() => {
    const names = new Set<string>()
    for (const item of boardData?.items ?? []) {
      const name = categoryNameOf(item)
      if (name) names.add(name)
    }
    return [...names].sort()
  }, [boardData, categoryNameOf])

  const visibleItems = (boardData?.items ?? []).filter(
    (item) => categoryFilter === 'all' || categoryNameOf(item) === categoryFilter,
  )

  const columns = KITCHEN_ITEM_STATUSES.map((status) => ({
    status,
    items: visibleItems.filter((item) => item.status === status),
  }))

  const orderLabel = (order: Order | undefined): string => {
    if (!order) return 'Order'
    if (order.order_type === 'takeaway') return 'Takeaway'
    return tables.find((table) => table.id === order.table_id)?.name ?? 'Table'
  }

  const handleAdvance = async (item: OrderItem, next: OrderItemStatus) => {
    setBusyItemId(item.id)
    setError(null)
    const { error: statusError } = await setOrderItemStatus(item.id, next)
    setBusyItemId(null)
    // load(true) clears the error state when it starts, so report a failed
    // change after kicking off the reload or the alert would be wiped instantly.
    void load(true)
    if (statusError) setError(statusError)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Kitchen</h1>
        <p className="page-sub">
          Live queue, refreshed every 15 seconds. Times are shown in {timeZone}.
        </p>
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
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {presentCategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="page-controls-spacer" />
          {refreshedAt && <span className="kds-updated">Updated {refreshedAt}</span>}
          <button type="button" className="btn btn-ghost" onClick={() => void load(false)}>
            Refresh
          </button>
        </div>
      )}

      {!branches ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading kitchen board…</p>
          ) : (
            <>
              <p className="card-note">The kitchen board could not be loaded.</p>
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
      ) : !boardData ? (
        <div className="card">
          {loading ? (
            <p className="card-note">Loading kitchen board…</p>
          ) : (
            <>
              <p className="card-note">The kitchen board could not be loaded.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void load(false)}>
                Retry
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="kds-board">
          {columns.map((column) => (
            <div key={column.status} className="kds-column">
              <div className="kds-column-head">
                <span className="kds-column-title">{ITEM_STATUS_LABELS[column.status]}</span>
                <span className="section-count">{column.items.length}</span>
              </div>
              {column.items.length === 0 ? (
                <p className="card-note">Nothing here.</p>
              ) : (
                column.items.map((item) => {
                  const order = ordersById.get(item.order_id)
                  const transitions = allowedItemTransitions(item.status).filter((next) =>
                    next === 'served' ? canServe : canAdvance,
                  )
                  return (
                    <div key={item.id} className="kds-card">
                      <div className="kds-card-head">
                        <span className="kds-card-table">{orderLabel(order)}</span>
                        <span className="kds-card-time">
                          {tzTimeKey(item.created_at, timeZone)}
                        </span>
                      </div>
                      <div className="order-item-name">{item.name_snapshot}</div>
                      <div className="order-meta">
                        ×{item.quantity}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </div>
                      {transitions.length > 0 && (
                        <div className="res-actions">
                          {transitions.map((next) => (
                            <button
                              key={next}
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busyItemId === item.id}
                              onClick={() => void handleAdvance(item, next)}
                            >
                              {ITEM_ACTION_LABELS[next]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
