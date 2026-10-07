import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  AccessErrorScreen,
  RequireAuth,
  RequireOrganization,
  RequirePermission,
} from '../components/guards'
import { authValue, type AuthValue } from './authMock'
import { makeAccess, makeSession } from './fixtures'

const mocks = vi.hoisted(() => ({ current: null as unknown as AuthValue }))

vi.mock('../lib/auth', () => ({
  useAuth: () => mocks.current,
}))

function LoginProbe() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <div>{`LOGIN:${from ?? 'none'}`}</div>
}

function renderAt(path: string, ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/bootstrap" element={<div>BOOTSTRAP</div>} />
        <Route path="/unauthorized" element={<div>UNAUTHORIZED</div>} />
        <Route path="/" element={ui} />
        <Route path="/audit" element={ui} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.current = authValue()
})

describe('RequireAuth', () => {
  it('shows the splash while loading', () => {
    mocks.current = authValue({ loading: true })
    renderAt('/', <RequireAuth><div>SECRET</div></RequireAuth>)
    expect(screen.getByText('Loading Nexarion Sky…')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('redirects to /login when there is no session', () => {
    renderAt('/', <RequireAuth><div>SECRET</div></RequireAuth>)
    expect(screen.getByText('LOGIN:/')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('preserves the requested path so login can return to it', () => {
    renderAt('/audit', <RequireAuth><div>SECRET</div></RequireAuth>)
    expect(screen.getByText('LOGIN:/audit')).toBeInTheDocument()
  })

  it('renders children for a signed-in session', () => {
    mocks.current = authValue({ session: makeSession() })
    renderAt('/', <RequireAuth><div>SECRET</div></RequireAuth>)
    expect(screen.getByText('SECRET')).toBeInTheDocument()
  })
})

describe('RequireOrganization', () => {
  it('shows the splash while loading', () => {
    mocks.current = authValue({ loading: true })
    renderAt('/', <RequireOrganization><div>SECRET</div></RequireOrganization>)
    expect(screen.getByText('Loading Nexarion Sky…')).toBeInTheDocument()
  })

  it('sends users without an organization to /bootstrap', () => {
    renderAt('/', <RequireOrganization><div>SECRET</div></RequireOrganization>)
    expect(screen.getByText('BOOTSTRAP')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('shows the retry screen (not /bootstrap) when the access load failed (M7)', () => {
    mocks.current = authValue({ accessError: 'Failed to fetch' })
    renderAt('/', <RequireOrganization><div>SECRET</div></RequireOrganization>)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('BOOTSTRAP')).not.toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('renders children when an organization is present', () => {
    mocks.current = authValue({ access: makeAccess() })
    renderAt('/', <RequireOrganization><div>SECRET</div></RequireOrganization>)
    expect(screen.getByText('SECRET')).toBeInTheDocument()
  })
})

describe('RequirePermission', () => {
  it('shows the splash while loading', () => {
    mocks.current = authValue({ loading: true })
    renderAt('/', <RequirePermission permission="dashboard.view"><div>SECRET</div></RequirePermission>)
    expect(screen.getByText('Loading Nexarion Sky…')).toBeInTheDocument()
  })

  it('sends users without the permission to /unauthorized', () => {
    renderAt('/', <RequirePermission permission="dashboard.view"><div>SECRET</div></RequirePermission>)
    expect(screen.getByText('UNAUTHORIZED')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('renders children when the permission is granted', () => {
    mocks.current = authValue({ hasPermission: (key) => key === 'dashboard.view' })
    renderAt('/', <RequirePermission permission="dashboard.view"><div>SECRET</div></RequirePermission>)
    expect(screen.getByText('SECRET')).toBeInTheDocument()
  })
})

describe('AccessErrorScreen', () => {
  it('renders the message and a retry that reports its pending state', async () => {
    let resolveRetry!: () => void
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve
        }),
    )
    render(
      <MemoryRouter>
        <AccessErrorScreen message="Failed to fetch" onRetry={onRetry} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled()

    await act(async () => {
      resolveRetry()
    })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})
