import { supabase } from './supabase'
import type {
  Order,
  OrderItem,
  OrderItemStatus,
  OrderStatus,
  OrderType,
} from '../types/database'

// Must stay in step with the column checks in
// supabase/migrations/20261008000004_orders_kitchen.sql.
export const ORDER_NOTES_MAX = 500
export const ITEM_NOTES_MAX = 200
export const VOID_REASON_MAX = 200
export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 99

export const ORDER_STATUSES: OrderStatus[] = [
  'open',
  'placed',
  'served',
  'completed',
  'cancelled',
]

// Orders a venue is still working on; completed/cancelled rows are history.
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['open', 'placed', 'served']

export const ORDER_ITEM_STATUSES: OrderItemStatus[] = ['queued', 'preparing', 'ready', 'served']

// Kitchen display columns: lines that still need kitchen or service attention.
export const KITCHEN_ITEM_STATUSES: OrderItemStatus[] = ['queued', 'preparing', 'ready']

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open',
  placed: 'Placed',
  served: 'Served',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
}

export const ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
}

// Action button labels keyed by the target status a transition moves to.
export const ITEM_ACTION_LABELS: Record<OrderItemStatus, string> = {
  queued: 'Queued',
  preparing: 'Start',
  ready: 'Ready',
  served: 'Serve',
}

// Mirrors app.guard_order_status in the migration.
const NEXT_ORDER_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  open: ['placed', 'cancelled'],
  placed: ['served', 'cancelled'],
  served: ['completed'],
  completed: [],
  cancelled: [],
}

// Mirrors the post-placement transitions in app.guard_order_item_status.
const NEXT_ITEM_STATUSES: Record<OrderItemStatus, OrderItemStatus[]> = {
  queued: ['preparing'],
  preparing: ['ready'],
  ready: ['served'],
  served: [],
}

export function allowedOrderTransitions(status: OrderStatus): OrderStatus[] {
  return NEXT_ORDER_STATUSES[status]
}

export function allowedItemTransitions(status: OrderItemStatus): OrderItemStatus[] {
  return NEXT_ITEM_STATUSES[status]
}

export interface OrderInput {
  order_type: OrderType
  table_id: string | null
  reservation_id: string | null
  notes: string
}

export async function listOrders(
  branchId: string,
  statuses?: OrderStatus[],
): Promise<{ data: Order[] | null; error: string | null }> {
  let query = supabase.schema('app').from('orders').select('*').eq('branch_id', branchId)
  if (statuses && statuses.length > 0) query = query.in('status', statuses)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200)
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function listOrderItems(
  orderIds: string[],
): Promise<{ data: OrderItem[] | null; error: string | null }> {
  if (orderIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .schema('app')
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at')

  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function createOrder(
  organizationId: string,
  branchId: string,
  input: OrderInput,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .schema('app')
    .from('orders')
    .insert({ organization_id: organizationId, branch_id: branchId, ...input })
    .select('id')
    .single()

  if (error) return { id: null, error: error.message }
  return { id: data?.id ?? null, error: null }
}

export async function updateOrderNotes(
  orderId: string,
  notes: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.schema('app').from('orders').update({ notes }).eq('id', orderId)
  return { error: error ? error.message : null }
}

export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase.schema('app').from('orders').update({ status }).eq('id', orderId)
  return { error: error ? error.message : null }
}

// branch/organization/name/price are derived server-side by the guard trigger
// from the parent order and app.menu_items; only these four fields are sent.
export async function addOrderItem(
  orderId: string,
  menuItemId: string,
  quantity: number,
  notes: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('order_items')
    .insert({ order_id: orderId, menu_item_id: menuItemId, quantity, notes })
  return { error: error ? error.message : null }
}

export async function updateOrderItem(
  itemId: string,
  changes: { quantity: number; notes: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase.schema('app').from('order_items').update(changes).eq('id', itemId)
  return { error: error ? error.message : null }
}

export async function setOrderItemStatus(
  itemId: string,
  status: OrderItemStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('order_items')
    .update({ status })
    .eq('id', itemId)
  return { error: error ? error.message : null }
}

// voided_at is the one-way marker the guard keys on; it overwrites the
// client value with now() and stamps voided_by from the session.
export async function voidOrderItem(
  itemId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('order_items')
    .update({ voided_at: new Date().toISOString(), void_reason: reason })
    .eq('id', itemId)
  return { error: error ? error.message : null }
}

export async function removeOrderItem(itemId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.schema('app').from('order_items').delete().eq('id', itemId)
  return { error: error ? error.message : null }
}

export interface KitchenBoard {
  orders: Order[]
  items: OrderItem[]
}

// The kitchen sees live orders (placed/served — catch-up lines of an early
// "served" stay visible) with their non-voided lines that still need work.
export async function listKitchenBoard(
  branchId: string,
): Promise<{ data: KitchenBoard | null; error: string | null }> {
  const { data: orders, error: ordersError } = await supabase
    .schema('app')
    .from('orders')
    .select('*')
    .eq('branch_id', branchId)
    .in('status', ['placed', 'served'])
    .order('created_at')

  if (ordersError) return { data: null, error: ordersError.message }
  if (!orders || orders.length === 0) return { data: { orders: [], items: [] }, error: null }

  const { data: items, error: itemsError } = await supabase
    .schema('app')
    .from('order_items')
    .select('*')
    .in(
      'order_id',
      orders.map((order) => order.id),
    )
    .in('status', KITCHEN_ITEM_STATUSES)
    .is('voided_at', null)
    .order('created_at')

  if (itemsError) return { data: null, error: itemsError.message }
  return { data: { orders, items: items ?? [] }, error: null }
}

export function validateOrderNotes(raw: string): string | null {
  if (raw.trim().length > ORDER_NOTES_MAX) return 'Notes must be 500 characters or fewer.'
  return null
}

export function validateItemNotes(raw: string): string | null {
  if (raw.trim().length > ITEM_NOTES_MAX) return 'Item notes must be 200 characters or fewer.'
  return null
}

export function validateVoidReason(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'A void reason is required.'
  if (trimmed.length > VOID_REASON_MAX) return 'Void reason must be 200 characters or fewer.'
  return null
}

const WHOLE_NUMBER_PATTERN = /^\d+$/

export function parseQuantity(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Quantity is required.' }
  if (!WHOLE_NUMBER_PATTERN.test(trimmed)) {
    return { value: null, error: 'Quantity must be a whole number.' }
  }
  const value = Number.parseInt(trimmed, 10)
  if (value < QUANTITY_MIN || value > QUANTITY_MAX) {
    return { value: null, error: 'Quantity must be between 1 and 99.' }
  }
  return { value, error: null }
}

export function orderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => (item.voided_at ? sum : sum + item.line_total), 0)
}
