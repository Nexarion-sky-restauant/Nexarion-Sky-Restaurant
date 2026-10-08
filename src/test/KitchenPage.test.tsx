import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KitchenPage from '../pages/kitchen/KitchenPage'
import { authValue, type AuthValue } from './authMock'
import {
  TEST_BRANCH_ID,
  TEST_ORDER_ITEM_ID,
  makeAccess,
  makeBranch,
  makeMenuCategory,
  makeMenuItem,
  makeOrder,
  makeOrderItem,
  makeRestaurantTable,
} from './fixtures'

const SECOND_CATEGORY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SECOND_ITEM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SECOND_ORDER_ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  listBranches: vi.fn(),
  listTables: vi.fn(),
  listMenu: vi.fn(),
  listKitchenBoard: vi.fn(),
  setOrderItemStatus: vi.fn(),
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
    listKitchenBoard: mocks.listKitchenBoard,
    setOrderItemStatus: mocks.setOrderItemStatus,
  }
})

const KITCHEN_PERMISSIONS = ['dashboard.view', 'kitchen.view', 'kitchen.manage']
const POS_PERMISSIONS = ['dashboard.view', 'pos.view', 'pos.edit']

function permissionsAuth(permissions: string[]): AuthValue {
  return authValue({
    access: makeAccess({ permissions }),
    hasPermission: (key) => permissions.includes(key),
  })
}

function renderKitchen(auth: AuthValue = permissionsAuth(KITCHEN_PERMISSIONS)) {
  mocks.current = auth
  return render(<KitchenPage />)
}

function twoCategoryMenu() {
  return {
    categories: [
      makeMenuCategory(),
      makeMenuCategory({ id: SECOND_CATEGORY_ID, name: 'Mains', sort_order: 2 }),
    ],
    items: [
      makeMenuItem(),
      makeMenuItem({
        id: SECOND_ITEM_ID,
        category_id: SECOND_CATEGORY_ID,
        name: 'Grilled Tilapia',
        price: 1250,
      }),
    ],
  }
}

beforeEach(() => {
  mocks.listBranches.mockReset()
  mocks.listTables.mockReset()
  mocks.listMenu.mockReset()
  mocks.listKitchenBoard.mockReset()
  mocks.setOrderItemStatus.mockReset()

  mocks.listBranches.mockResolvedValue({ data: [makeBranch()], error: null })
  mocks.listTables.mockResolvedValue({ data: [makeRestaurantTable()], error: null })
  mocks.listMenu.mockResolvedValue({
    data: { categories: [makeMenuCategory()], items: [makeMenuItem()] },
    error: null,
  })
  mocks.listKitchenBoard.mockResolvedValue({
    data: { orders: [makeOrder({ status: 'placed' })], items: [makeOrderItem()] },
    error: null,
  })
  mocks.setOrderItemStatus.mockResolvedValue({ error: null })
})

describe('KitchenPage board', () => {
  it('renders the live board with columns, table label and updated stamp', async () => {
    renderKitchen()
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()

    for (const label of ['Queued', 'Preparing', 'Ready']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Table 1')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByText('03:00')).toBeInTheDocument()
    expect(screen.getAllByText('Nothing here.')).toHaveLength(2)
    expect(screen.getByText(/^Updated \d{2}:\d{2}$/)).toBeInTheDocument()

    expect(mocks.listBranches).toHaveBeenCalledTimes(1)
    expect(mocks.listKitchenBoard).toHaveBeenCalledWith(TEST_BRANCH_ID)
    expect(mocks.listTables).toHaveBeenCalledWith(TEST_BRANCH_ID, true)
    expect(mocks.listMenu).toHaveBeenCalledWith(true)
  })

  it('scopes the board to a single category', async () => {
    mocks.listMenu.mockResolvedValue({ data: twoCategoryMenu(), error: null })
    mocks.listKitchenBoard.mockResolvedValue({
      data: {
        orders: [makeOrder({ status: 'placed' })],
        items: [
          makeOrderItem(),
          makeOrderItem({
            id: SECOND_ORDER_ITEM_ID,
            menu_item_id: SECOND_ITEM_ID,
            name_snapshot: 'Grilled Tilapia',
          }),
        ],
      },
      error: null,
    })
    renderKitchen()
    expect(await screen.findByText('Grilled Tilapia')).toBeInTheDocument()
    expect(screen.getByText('Truffle Soup')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Mains' } })
    expect(screen.queryByText('Truffle Soup')).not.toBeInTheDocument()
    expect(screen.getByText('Grilled Tilapia')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Starters' } })
    expect(screen.getByText('Truffle Soup')).toBeInTheDocument()
    expect(screen.queryByText('Grilled Tilapia')).not.toBeInTheDocument()
  })

  it('refreshes the board on demand', async () => {
    renderKitchen()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mocks.listKitchenBoard).toHaveBeenCalledTimes(2))
  })

  it('polls the board every 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const view = renderKitchen()
    try {
      await screen.findByText('Truffle Soup')
      expect(mocks.listKitchenBoard).toHaveBeenCalledTimes(1)

      await act(async () => {
        vi.advanceTimersByTime(15000)
      })
      await waitFor(() => expect(mocks.listKitchenBoard).toHaveBeenCalledTimes(2))
    } finally {
      // Unmount first so the polling effect cleanup runs against the faked
      // clearInterval, then restore the real timers.
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps the last board when a refresh fails', async () => {
    renderKitchen()
    await screen.findByText('Truffle Soup')
    mocks.listKitchenBoard.mockResolvedValue({ data: null, error: 'permission denied' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    expect(screen.getByText('Truffle Soup')).toBeInTheDocument()
  })

  it('renders an empty queue with all three columns', async () => {
    mocks.listKitchenBoard.mockResolvedValue({ data: { orders: [], items: [] }, error: null })
    renderKitchen()
    await waitFor(() => expect(screen.getAllByText('Nothing here.')).toHaveLength(3))
  })
})

describe('KitchenPage permissions', () => {
  it('lets kitchen roles start a queued line but not serve it', async () => {
    renderKitchen(permissionsAuth(KITCHEN_PERMISSIONS))
    const start = await screen.findByRole('button', { name: 'Start' })
    expect(screen.queryByRole('button', { name: 'Serve' })).not.toBeInTheDocument()

    fireEvent.click(start)
    await waitFor(() =>
      expect(mocks.setOrderItemStatus).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID, 'preparing'),
    )
    await waitFor(() => expect(mocks.listKitchenBoard).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Ready' })).not.toBeInTheDocument()
  })

  it('lets POS roles serve a ready line but not run the kitchen queue', async () => {
    mocks.listKitchenBoard.mockResolvedValue({
      data: {
        orders: [makeOrder({ status: 'placed' })],
        items: [
          makeOrderItem({ status: 'ready' }),
          makeOrderItem({ id: SECOND_ORDER_ITEM_ID, name_snapshot: 'Grilled Tilapia' }),
        ],
      },
      error: null,
    })
    renderKitchen(permissionsAuth(POS_PERMISSIONS))

    const serve = await screen.findByRole('button', { name: 'Serve' })
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()

    fireEvent.click(serve)
    await waitFor(() =>
      expect(mocks.setOrderItemStatus).toHaveBeenCalledWith(TEST_ORDER_ITEM_ID, 'served'),
    )
    await waitFor(() => expect(mocks.listKitchenBoard).toHaveBeenCalledTimes(2))
  })
})
