import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrdersPage from '../pages/orders/OrdersPage'
import { authValue, type AuthValue } from './authMock'
import {
  TEST_BRANCH_ID,
  TEST_ITEM_ID,
  TEST_ORDER_ID,
  TEST_ORDER_ITEM_ID,
  TEST_ORG_ID,
  TEST_TABLE_ID,
  makeAccess,
  makeBranch,
  makeMenuCategory,
  makeMenuItem,
  makeOrder,
  makeOrderItem,
  makeRestaurantTable,
} from './fixtures'

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  listBranches: vi.fn(),
  listTables: vi.fn(),
  listMenu: vi.fn(),
  listOrders: vi.fn(),
  listOrderItems: vi.fn(),
  createOrder: vi.fn(),
  setOrderStatus: vi.fn(),
  updateOrderNotes: vi.fn(),
  addOrderItem: vi.fn(),
  updateOrderItem: vi.fn(),
  setOrderItemStatus: vi.fn(),
  voidOrderItem: vi.fn(),
  removeOrderItem: vi.fn(),
}))

vi.mock('../lib/auth', () => ({
  useAuth: () => mocks.current,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('../lib/branches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/branches')>()
  return { ...actual, listBranches: mocks.listBranches }
})

vi.mock('../lib/tables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tables')>()
  return { ...actual, listTables: mocks.listTables }
})

vi.mock('../lib/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/menu')>()
  return { ...actual, listMenu: mocks.listMenu }
})

vi.mock('../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/orders')>()
  return {
    ...actual,
    listOrders: mocks.listOrders,
    listOrderItems: mocks.listOrderItems,
    createOrder: mocks.createOrder,
    setOrderStatus: mocks.setOrderStatus,
    updateOrderNotes: mocks.updateOrderNotes,
    addOrderItem: mocks.addOrderItem,
    updateOrderItem: mocks.updateOrderItem,
    setOrderItemStatus: mocks.setOrderItemStatus,
    voidOrderItem: mocks.voidOrderItem,
    removeOrderItem: mocks.removeOrderItem,
  }
})

const MANAGER_PERMISSIONS = [
  'dashboard.view',
  'pos.view',
  'pos.create',
  'pos.edit',
  'pos.void',
  'kitchen.view',
  'kitchen.manage',
]

// The staff system role (D6A): no pos.void, so no void or cancel surface.
const STAFF_PERMISSIONS = [
  'dashboard.view',
  'pos.view',
  'pos.create',
  'pos.edit',
  'kitchen.view',
  'kitchen.manage',
]

const VIEWER_PERMISSIONS = ['dashboard.view', 'pos.view']

function permissionsAuth(permissions: string[]): AuthValue {
  return authValue({
    access: makeAccess({ permissions }),
    hasPermission: (key) => permissions.includes(key),
  })
}

function renderOrders(auth: AuthValue = permissionsAuth(MANAGER_PERMISSIONS)) {
  mocks.current = auth
  return render(<OrdersPage />)
}

function findOrderRow() {
  return screen.findByRole('button', { name: /Dine in · Table 1/ }, { timeout: 3000 })
}

async function selectOrder() {
  const row = await findOrderRow()
  fireEvent.click(row)
  return row
}

function submitDialog() {
  const dialog = screen.getByRole('dialog')
  const form = dialog.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
  return dialog
}

beforeEach(() => {
  mocks.listBranches.mockReset()
  mocks.listTables.mockReset()
  mocks.listMenu.mockReset()
  mocks.listOrders.mockReset()
  mocks.listOrderItems.mockReset()
  mocks.createOrder.mockReset()
  mocks.setOrderStatus.mockReset()
  mocks.updateOrderNotes.mockReset()
  mocks.addOrderItem.mockReset()
  mocks.updateOrderItem.mockReset()
  mocks.setOrderItemStatus.mockReset()
  mocks.voidOrderItem.mockReset()
  mocks.removeOrderItem.mockReset()

  mocks.listBranches.mockResolvedValue({ data: [makeBranch()], error: null })
  mocks.listTables.mockResolvedValue({ data: [makeRestaurantTable()], error: null })
  mocks.listMenu.mockResolvedValue({
    data: { categories: [makeMenuCategory()], items: [makeMenuItem()] },
    error: null,
  })
  mocks.listOrders.mockResolvedValue({ data: [makeOrder()], error: null })
  mocks.listOrderItems.mockResolvedValue({ data: [makeOrderItem()], error: null })
  mocks.createOrder.mockResolvedValue({ id: TEST_ORDER_ID, error: null })
  mocks.setOrderStatus.mockResolvedValue({ error: null })
  mocks.updateOrderNotes.mockResolvedValue({ error: null })
  mocks.addOrderItem.mockResolvedValue({ error: null })
  mocks.updateOrderItem.mockResolvedValue({ error: null })
  mocks.setOrderItemStatus.mockResolvedValue({ error: null })
  mocks.voidOrderItem.mockResolvedValue({ error: null })
  mocks.removeOrderItem.mockResolvedValue({ error: null })
})

describe('OrdersPage list', () => {
  it('renders the active orders with totals and opens the detail on click', async () => {
    renderOrders()
    const row = await selectOrder()

    expect(within(row).getByText('Open')).toBeInTheDocument()
    expect(within(row).getByText('1 items')).toBeInTheDocument()
    expect(within(row).getByText('KES 1900.00')).toBeInTheDocument()
    expect(within(row).getByText('03:00')).toBeInTheDocument()

    expect(mocks.listOrders).toHaveBeenCalledWith(TEST_BRANCH_ID, ['open', 'placed', 'served'])
    expect(mocks.listOrderItems).toHaveBeenCalledWith([TEST_ORDER_ID])
    expect(mocks.listTables).toHaveBeenCalledWith(TEST_BRANCH_ID, true)
    expect(mocks.listMenu).toHaveBeenCalledWith(true)

    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByText('Total KES 1900.00')).toBeInTheDocument()
  })

  it('reloads when the status filter changes', async () => {
    renderOrders()
    await selectOrder()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })
    await waitFor(() =>
      expect(mocks.listOrders).toHaveBeenLastCalledWith(TEST_BRANCH_ID, undefined),
    )
  })

  it('shows the creator empty state for an empty view', async () => {
    mocks.listOrders.mockResolvedValue({ data: [], error: null })
    mocks.listOrderItems.mockResolvedValue({ data: [], error: null })
    renderOrders()
    expect(await screen.findByText('No orders in this view yet.')).toBeInTheDocument()
  })

  it('shows the viewer empty state for an empty view', async () => {
    mocks.listOrders.mockResolvedValue({ data: [], error: null })
    mocks.listOrderItems.mockResolvedValue({ data: [], error: null })
    renderOrders(permissionsAuth(VIEWER_PERMISSIONS))
    expect(await screen.findByText('No orders in this view.')).toBeInTheDocument()
  })
})

describe('order detail permissions', () => {
  it('renders the full action set for managers', async () => {
    renderOrders()
    await selectOrder()
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Place order' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New order' })).toBeEnabled()
  })

  it('lets staff work orders but not void or cancel', async () => {
    renderOrders(permissionsAuth(STAFF_PERMISSIONS))
    await selectOrder()
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Place order' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New order' })).toBeInTheDocument()
  })

  it('renders the detail read-only for viewers', async () => {
    renderOrders(permissionsAuth(VIEWER_PERMISSIONS))
    await selectOrder()
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()

    for (const name of ['Place order', 'Cancel order', 'Edit', 'Void', 'Remove', 'Add item']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'New order' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument()
  })

  it('offers the service transition once an item is ready on a placed order', async () => {
    mocks.listOrders.mockResolvedValue({ data: [makeOrder({ status: 'placed' })], error: null })
    mocks.listOrderItems.mockResolvedValue({
      data: [makeOrderItem({ status: 'ready' })],
      error: null,
    })
    renderOrders()
    await selectOrder()

    const serve = await screen.findByRole('button', { name: 'Serve' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.getByText('Items can only be added while the order is open.')).toBeInTheDocument()

    fireEvent.click(serve)
    await waitFor(() =>
      expect(mocks.setOrderItemStatus).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID, 'served'),
    )
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })
})

describe('order status transitions', () => {
  it('places an order and reloads the list', async () => {
    renderOrders()
    await selectOrder()
    fireEvent.click(await screen.findByRole('button', { name: 'Place order' }))
    await waitFor(() => expect(mocks.setOrderStatus).toHaveBeenCalledWith(TEST_ORDER_ID, 'placed'))
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })

  it('reports a failed status change without losing the list', async () => {
    mocks.setOrderStatus.mockResolvedValue({ error: 'row level security denied' })
    renderOrders()
    await selectOrder()
    fireEvent.click(await screen.findByRole('button', { name: 'Place order' }))
    expect(await screen.findByText('row level security denied')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dine in · Table 1/ })).toBeInTheDocument()
  })

  it('saves order notes while the order is open', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.change(screen.getByLabelText('Notes (optional)'), {
      target: { value: 'Window seat' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }))
    await waitFor(() =>
      expect(mocks.updateOrderNotes).toHaveBeenCalledWith(TEST_ORDER_ID, 'Window seat'),
    )
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })
})

describe('order creation', () => {
  it('requires a table for dine-in and creates the order with the modal', async () => {
    renderOrders()
    await findOrderRow()
    fireEvent.click(screen.getByRole('button', { name: 'New order' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New order')).toBeInTheDocument()

    submitDialog()
    expect(await screen.findByText('Choose a table for this dine-in order.')).toBeInTheDocument()
    expect(mocks.createOrder).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Table'), { target: { value: TEST_TABLE_ID } })
    fireEvent.change(within(dialog).getByLabelText('Notes (optional)'), {
      target: { value: 'Birthday' },
    })
    submitDialog()

    await waitFor(() =>
      expect(mocks.createOrder).toHaveBeenCalledWith(TEST_ORG_ID, TEST_BRANCH_ID, {
        order_type: 'dine_in',
        table_id: TEST_TABLE_ID,
        reservation_id: null,
        notes: 'Birthday',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })

  it('drops the table requirement for takeaway orders', async () => {
    renderOrders()
    await findOrderRow()
    fireEvent.click(screen.getByRole('button', { name: 'New order' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Order type'), {
      target: { value: 'takeaway' },
    })
    expect(within(dialog).queryByLabelText('Table')).not.toBeInTheDocument()
    submitDialog()

    await waitFor(() =>
      expect(mocks.createOrder).toHaveBeenCalledWith(TEST_ORG_ID, TEST_BRANCH_ID, {
        order_type: 'takeaway',
        table_id: null,
        reservation_id: null,
        notes: '',
      }),
    )
  })
})

describe('order items', () => {
  it('adds a menu item to an open order', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.change(screen.getByLabelText('Menu item'), { target: { value: TEST_ITEM_ID } })
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Item notes (optional)'), {
      target: { value: 'No cream' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() =>
      expect(mocks.addOrderItem).toHaveBeenCalledWith(TEST_ORDER_ID, TEST_ITEM_ID, 3, 'No cream'),
    )
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })

  it('requires a menu item before adding', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Choose a menu item.')).toBeInTheDocument()
    expect(mocks.addOrderItem).not.toHaveBeenCalled()
  })

  it('edits the quantity of an open item', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Edit Truffle Soup')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '4' } })
    submitDialog()

    await waitFor(() =>
      expect(mocks.updateOrderItem).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID, {
        quantity: 4,
        notes: '',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })

  it('voids an item and requires a reason', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Void Truffle Soup')).toBeInTheDocument()

    submitDialog()
    expect(await screen.findByText('A void reason is required.')).toBeInTheDocument()
    expect(mocks.voidOrderItem).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'spilled' } })
    submitDialog()
    await waitFor(() =>
      expect(mocks.voidOrderItem).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID, 'spilled'),
    )
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })

  it('removes an item while the order is open', async () => {
    renderOrders()
    await selectOrder()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mocks.removeOrderItem).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID))
    await waitFor(() => expect(mocks.listOrders).toHaveBeenCalledTimes(2))
  })
})
