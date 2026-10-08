import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReservationsPage from '../pages/reservations/ReservationsPage'
import {
  dayBoundsUtc,
  reservationEndIso,
  tzToday,
  wallTimeToUtcIso,
} from '../lib/reservations'
import { authValue, type AuthValue } from './authMock'
import {
  TEST_BRANCH_ID,
  TEST_ORG_ID,
  TEST_RESERVATION_ID,
  TEST_TABLE_ID,
  makeAccess,
  makeBranch,
  makeReservation,
  makeRestaurantTable,
} from './fixtures'

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  listBranches: vi.fn(),
  listTables: vi.fn(),
  listReservations: vi.fn(),
  setReservationStatus: vi.fn(),
  saveReservation: vi.fn(),
  listActiveReservationsInWindow: vi.fn(),
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

vi.mock('../lib/reservations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reservations')>()
  return {
    ...actual,
    listReservations: mocks.listReservations,
    setReservationStatus: mocks.setReservationStatus,
    saveReservation: mocks.saveReservation,
    listActiveReservationsInWindow: mocks.listActiveReservationsInWindow,
  }
})

const MANAGER_PERMISSIONS = [
  'dashboard.view',
  'reservations.view',
  'reservations.create',
  'reservations.edit',
  'reservations.cancel',
]

function permissionsAuth(permissions: string[]): AuthValue {
  return authValue({
    access: makeAccess({ permissions }),
    hasPermission: (key) => permissions.includes(key),
  })
}

function renderReservations(auth: AuthValue = permissionsAuth(MANAGER_PERMISSIONS)) {
  mocks.current = auth
  return render(<ReservationsPage />)
}

function submitDialog() {
  const dialog = screen.getByRole('dialog')
  const form = dialog.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
  return dialog
}

function nairobiDayBounds(dateKey: string): { startIso: string; endIso: string } {
  const bounds = dayBoundsUtc(dateKey, 'Africa/Nairobi')
  if (!bounds) throw new Error(`no day bounds for ${dateKey}`)
  return bounds
}

function nairobiIso(dateKey: string, time: string): string {
  const iso = wallTimeToUtcIso(dateKey, time, 'Africa/Nairobi')
  if (!iso) throw new Error(`no UTC instant for ${dateKey} ${time}`)
  return iso
}

beforeEach(() => {
  mocks.listBranches.mockReset()
  mocks.listTables.mockReset()
  mocks.listReservations.mockReset()
  mocks.setReservationStatus.mockReset()
  mocks.saveReservation.mockReset()
  mocks.listActiveReservationsInWindow.mockReset()

  mocks.listBranches.mockResolvedValue({ data: [makeBranch()], error: null })
  mocks.listTables.mockResolvedValue({ data: [makeRestaurantTable()], error: null })
  mocks.listReservations.mockResolvedValue({ data: [makeReservation()], error: null })
  mocks.setReservationStatus.mockResolvedValue({ error: null })
  mocks.saveReservation.mockResolvedValue({ error: null })
  mocks.listActiveReservationsInWindow.mockResolvedValue({ data: [], error: null })
})

describe('ReservationsPage day list', () => {
  it("renders the day's bookings with status actions for managers", async () => {
    renderReservations()
    expect(await screen.findByText('Grace Wanjiru')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Party of 2 · Table 1 · +254700000000')).toBeInTheDocument()
    expect(screen.getByText('19:00')).toBeInTheDocument()
    expect(screen.getByText('– 21:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No show' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeEnabled()

    const day = nairobiDayBounds(tzToday('Africa/Nairobi'))
    expect(mocks.listReservations).toHaveBeenCalledWith(TEST_BRANCH_ID, day.startIso, day.endIso)
    expect(mocks.listTables).toHaveBeenCalledWith(TEST_BRANCH_ID, true)
  })

  it('lets staff work the floor but not cancel', async () => {
    renderReservations(
      permissionsAuth(['dashboard.view', 'reservations.view', 'reservations.create', 'reservations.edit']),
    )
    expect(await screen.findByText('Grace Wanjiru')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No show' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeInTheDocument()
  })

  it('renders the day read-only for viewers', async () => {
    renderReservations(permissionsAuth(['dashboard.view', 'reservations.view']))
    expect(await screen.findByText('Grace Wanjiru')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Seat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New reservation' })).not.toBeInTheDocument()
  })

  it('shows the creator empty state for an empty day', async () => {
    mocks.listReservations.mockResolvedValue({ data: [], error: null })
    renderReservations()
    expect(await screen.findByText('No reservations for this day yet.')).toBeInTheDocument()
  })

  it('shows the viewer empty state for an empty day', async () => {
    mocks.listReservations.mockResolvedValue({ data: [], error: null })
    renderReservations(permissionsAuth(['dashboard.view', 'reservations.view']))
    expect(await screen.findByText('No reservations for this day.')).toBeInTheDocument()
  })

  it('reloads the day when the date changes', async () => {
    renderReservations()
    await screen.findByText('Grace Wanjiru')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-30' } })
    const day = nairobiDayBounds('2026-12-30')
    await waitFor(() =>
      expect(mocks.listReservations).toHaveBeenLastCalledWith(
        TEST_BRANCH_ID,
        day.startIso,
        day.endIso,
      ),
    )
  })
})

describe('reservation status transitions', () => {
  it('advances the status and reloads the day', async () => {
    mocks.listReservations
      .mockResolvedValueOnce({ data: [makeReservation()], error: null })
      .mockResolvedValueOnce({ data: [makeReservation({ status: 'seated' })], error: null })
    renderReservations()
    fireEvent.click(await screen.findByRole('button', { name: 'Seat' }))

    await waitFor(() =>
      expect(mocks.setReservationStatus).toHaveBeenCalledWith(TEST_RESERVATION_ID, 'seated'),
    )
    await waitFor(() => expect(mocks.listReservations).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Seated')).toBeInTheDocument()
  })

  it('reports a failed status change without losing the day', async () => {
    mocks.setReservationStatus.mockResolvedValue({ error: 'row level security denied' })
    renderReservations()
    fireEvent.click(await screen.findByRole('button', { name: 'Seat' }))
    expect(await screen.findByText('row level security denied')).toBeInTheDocument()
    expect(screen.getByText('Grace Wanjiru')).toBeInTheDocument()
  })
})

describe('reservation editing', () => {
  it('creates a reservation through the modal after a conflict pre-check', async () => {
    renderReservations()
    await screen.findByText('Grace Wanjiru')
    fireEvent.click(screen.getByRole('button', { name: 'New reservation' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New reservation')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-12-31' } })
    fireEvent.change(within(dialog).getByLabelText('Table'), { target: { value: TEST_TABLE_ID } })
    fireEvent.change(within(dialog).getByLabelText('Guest name'), {
      target: { value: 'Amina Yusuf' },
    })
    submitDialog()

    const startsAt = nairobiIso('2026-12-31', '19:00')
    const endsAt = reservationEndIso(startsAt, 120)
    await waitFor(() =>
      expect(mocks.listActiveReservationsInWindow).toHaveBeenCalledWith(
        TEST_TABLE_ID,
        startsAt,
        endsAt,
        undefined,
      ),
    )
    await waitFor(() =>
      expect(mocks.saveReservation).toHaveBeenCalledWith(TEST_ORG_ID, TEST_BRANCH_ID, null, {
        table_id: TEST_TABLE_ID,
        guest_name: 'Amina Yusuf',
        guest_phone: '',
        party_size: 2,
        starts_at: startsAt,
        duration_minutes: 120,
        status: 'confirmed',
        notes: '',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listReservations).toHaveBeenCalledTimes(2))
  })

  it('blocks a conflicting slot before saving', async () => {
    mocks.listActiveReservationsInWindow.mockResolvedValue({
      data: [makeReservation()],
      error: null,
    })
    renderReservations()
    await screen.findByText('Grace Wanjiru')
    fireEvent.click(screen.getByRole('button', { name: 'New reservation' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Table'), { target: { value: TEST_TABLE_ID } })
    fireEvent.change(within(dialog).getByLabelText('Guest name'), {
      target: { value: 'Amina Yusuf' },
    })
    submitDialog()

    expect(
      await screen.findByText('That table already has a reservation during this time.'),
    ).toBeInTheDocument()
    expect(mocks.saveReservation).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('requires a table and a guest name', async () => {
    renderReservations()
    await screen.findByText('Grace Wanjiru')
    fireEvent.click(screen.getByRole('button', { name: 'New reservation' }))
    submitDialog()
    expect(await screen.findByText('Choose a table for this reservation.')).toBeInTheDocument()
    expect(screen.getByText('Guest name is required.')).toBeInTheDocument()
    expect(mocks.listActiveReservationsInWindow).not.toHaveBeenCalled()
    expect(mocks.saveReservation).not.toHaveBeenCalled()
  })

  it('edits an existing reservation with prefilled values', async () => {
    renderReservations()
    await screen.findByText('Grace Wanjiru')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Edit reservation')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Table')).toHaveValue(TEST_TABLE_ID)
    const guestInput = within(dialog).getByLabelText('Guest name')
    expect(guestInput).toHaveValue('Grace Wanjiru')
    expect(within(dialog).getByText('Status')).toBeInTheDocument()
    expect(within(dialog).queryByText('Create as')).not.toBeInTheDocument()
    fireEvent.change(guestInput, { target: { value: 'Grace W.' } })
    submitDialog()

    const startsAt = nairobiIso('2026-01-01', '19:00')
    const endsAt = reservationEndIso(startsAt, 120)
    await waitFor(() =>
      expect(mocks.listActiveReservationsInWindow).toHaveBeenCalledWith(
        TEST_TABLE_ID,
        startsAt,
        endsAt,
        TEST_RESERVATION_ID,
      ),
    )
    await waitFor(() =>
      expect(mocks.saveReservation).toHaveBeenCalledWith(
        TEST_ORG_ID,
        TEST_BRANCH_ID,
        TEST_RESERVATION_ID,
        {
          table_id: TEST_TABLE_ID,
          guest_name: 'Grace W.',
          guest_phone: '+254700000000',
          party_size: 2,
          starts_at: startsAt,
          duration_minutes: 120,
          status: 'confirmed',
          notes: '',
        },
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
