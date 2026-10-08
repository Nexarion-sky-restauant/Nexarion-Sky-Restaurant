import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TablesPage from '../pages/tables/TablesPage'
import { authValue, type AuthValue } from './authMock'
import {
  TEST_BRANCH_ID,
  TEST_ORG_ID,
  TEST_SECOND_BRANCH_ID,
  TEST_TABLE_ID,
  makeAccess,
  makeBranch,
  makeRestaurantTable,
} from './fixtures'

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  listBranches: vi.fn(),
  listTables: vi.fn(),
  saveTable: vi.fn(),
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
  return { ...actual, listTables: mocks.listTables, saveTable: mocks.saveTable }
})

function managerAuth(): AuthValue {
  return authValue({
    access: makeAccess({ permissions: ['dashboard.view', 'tables.manage'] }),
    hasPermission: (key) => key === 'tables.manage',
  })
}

function staffAuth(): AuthValue {
  return authValue({
    access: makeAccess({ permissions: ['dashboard.view'] }),
    hasPermission: (key) => key === 'dashboard.view',
  })
}

function renderTables(auth: AuthValue = managerAuth()) {
  mocks.current = auth
  return render(<TablesPage />)
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
  mocks.saveTable.mockReset()

  mocks.listBranches.mockResolvedValue({ data: [makeBranch()], error: null })
  mocks.listTables.mockResolvedValue({ data: [makeRestaurantTable()], error: null })
  mocks.saveTable.mockResolvedValue({ error: null })
})

describe('TablesPage floor plan', () => {
  it('renders the floor plan with management controls', async () => {
    renderTables()
    expect(await screen.findByText('Table 1')).toBeInTheDocument()
    expect(screen.getByText('4 seats')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New table' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show inactive')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(mocks.listTables).toHaveBeenCalledWith(TEST_BRANCH_ID, false)
  })

  it('groups tables by zone with per-zone counts', async () => {
    mocks.listTables.mockResolvedValue({
      data: [
        makeRestaurantTable(),
        makeRestaurantTable({ id: '66666666-6666-4666-8666-666666666667', name: 'Table 2' }),
        makeRestaurantTable({ id: '66666666-6666-4666-8666-666666666668', name: 'Terrace 1', zone: 'Terrace' }),
      ],
      error: null,
    })
    renderTables()
    expect(await screen.findByText('Table 1')).toBeInTheDocument()
    expect(screen.getByText('2 tables')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Terrace' })).toBeInTheDocument()
    expect(screen.getByText('1 table')).toBeInTheDocument()
  })

  it('flags inactive tables with a pill', async () => {
    mocks.listTables.mockResolvedValue({
      data: [makeRestaurantTable({ is_active: false })],
      error: null,
    })
    const { container } = renderTables()
    expect(await screen.findByText('Table 1')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(container.querySelector('.floor-table-inactive')).not.toBeNull()
  })

  it('renders the floor plan read-only for staff', async () => {
    renderTables(staffAuth())
    expect(await screen.findByText('Table 1')).toBeInTheDocument()
    expect(screen.getByText('4 seats')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New table' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Show inactive')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('shows the manager empty state before any table exists', async () => {
    mocks.listTables.mockResolvedValue({ data: [], error: null })
    renderTables()
    expect(
      await screen.findByText('No tables yet. Create the first table to start building the floor plan.'),
    ).toBeInTheDocument()
  })

  it('shows the staff empty state when the floor plan is not set up', async () => {
    mocks.listTables.mockResolvedValue({ data: [], error: null })
    renderTables(staffAuth())
    expect(await screen.findByText('The floor plan has not been set up yet.')).toBeInTheDocument()
  })

  it('shows a load error with a retry that reloads the floor plan', async () => {
    mocks.listTables
      .mockResolvedValueOnce({ data: null, error: 'permission denied' })
      .mockResolvedValueOnce({ data: [makeRestaurantTable()], error: null })
    renderTables()
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    expect(screen.getByText('The floor plan could not be loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Table 1')).toBeInTheDocument()
    expect(mocks.listTables).toHaveBeenCalledTimes(2)
  })

  it('reloads with inactive tables when the filter is toggled', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByLabelText('Show inactive'))
    await waitFor(() => expect(mocks.listTables).toHaveBeenLastCalledWith(TEST_BRANCH_ID, true))
  })
})

describe('TablesPage branch selection', () => {
  it('offers a branch picker only when multiple branches are accessible', async () => {
    renderTables()
    await screen.findByText('Table 1')
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument()
  })

  it('switches the floor plan when another branch is selected', async () => {
    mocks.listBranches.mockResolvedValue({
      data: [
        makeBranch(),
        makeBranch({ id: TEST_SECOND_BRANCH_ID, code: 'TERRACE', name: 'Terrace Branch' }),
      ],
      error: null,
    })
    renderTables(
      authValue({
        access: makeAccess({ permissions: ['dashboard.view', 'tables.manage'], branch_ids: [] }),
        hasPermission: (key) => key === 'tables.manage',
      }),
    )
    await screen.findByText('Table 1')
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: TEST_SECOND_BRANCH_ID } })
    await waitFor(() =>
      expect(mocks.listTables).toHaveBeenLastCalledWith(TEST_SECOND_BRANCH_ID, false),
    )
  })

  it('explains when no branch is available for the account', async () => {
    mocks.listBranches.mockResolvedValue({ data: [], error: null })
    renderTables()
    expect(await screen.findByText('No branches are available for your account.')).toBeInTheDocument()
  })
})

describe('table editing', () => {
  it('creates a table through the modal', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByRole('button', { name: 'New table' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New table')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: 'Patio 1' } })
    submitDialog()

    await waitFor(() =>
      expect(mocks.saveTable).toHaveBeenCalledWith(TEST_ORG_ID, TEST_BRANCH_ID, null, {
        name: 'Patio 1',
        zone: 'Main',
        capacity: 2,
        sort_order: 0,
        is_active: true,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listTables).toHaveBeenCalledTimes(2))
  })

  it('blocks an empty name without calling the save', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByRole('button', { name: 'New table' }))
    submitDialog()
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(mocks.saveTable).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('rejects a capacity the column cannot store', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByRole('button', { name: 'New table' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: 'Patio 1' } })
    fireEvent.change(within(dialog).getByLabelText('Capacity'), { target: { value: '0' } })
    submitDialog()
    expect(await screen.findByText('Capacity must be between 1 and 100.')).toBeInTheDocument()
    expect(mocks.saveTable).not.toHaveBeenCalled()
  })

  it('edits an existing table with prefilled values', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Edit table')).toBeInTheDocument()
    const nameInput = within(dialog).getByLabelText('Table name')
    expect(nameInput).toHaveValue('Table 1')
    fireEvent.change(nameInput, { target: { value: 'Table 1b' } })
    submitDialog()

    await waitFor(() =>
      expect(mocks.saveTable).toHaveBeenCalledWith(TEST_ORG_ID, TEST_BRANCH_ID, TEST_TABLE_ID, {
        name: 'Table 1b',
        zone: 'Main',
        capacity: 4,
        sort_order: 0,
        is_active: true,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes the modal on cancel without saving', async () => {
    renderTables()
    await screen.findByText('Table 1')
    fireEvent.click(screen.getByRole('button', { name: 'New table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.saveTable).not.toHaveBeenCalled()
  })
})
