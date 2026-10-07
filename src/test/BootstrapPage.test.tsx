import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BootstrapPage from '../pages/BootstrapPage'
import { authValue, type AuthValue } from './authMock'
import { makeAccess } from './fixtures'

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  rpc: vi.fn(),
}))

vi.mock('../lib/auth', () => ({
  useAuth: () => mocks.current,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    schema: () => ({ rpc: mocks.rpc }),
  },
}))

function renderBootstrap(overrides: Partial<AuthValue> = {}) {
  mocks.current = authValue(overrides)
  return render(
    <MemoryRouter initialEntries={['/bootstrap']}>
      <Routes>
        <Route path="/bootstrap" element={<BootstrapPage />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

function fill(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  mocks.rpc.mockResolvedValue({ error: null })
})

describe('BootstrapPage', () => {
  it('shows the splash while loading', () => {
    renderBootstrap({ loading: true })
    expect(screen.getByText('Loading Nexarion Sky…')).toBeInTheDocument()
  })

  it('redirects once the organization exists', () => {
    renderBootstrap({ access: makeAccess() })
    expect(screen.getByText('HOME')).toBeInTheDocument()
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument()
  })

  it('prefills the first-run defaults', () => {
    renderBootstrap()
    expect(screen.getByLabelText('Business name')).toHaveValue('Nexarion Sky Restaurant')
    expect(screen.getByLabelText('Business slug (unique, lowercase)')).toHaveValue('nexarion-sky')
    expect(screen.getByLabelText('First branch name')).toHaveValue('Main Branch')
    expect(screen.getByLabelText('Branch code')).toHaveValue('MAIN')
  })

  it('requires every field and constrains the slug format', () => {
    renderBootstrap()
    expect(screen.getByLabelText('Business name')).toBeRequired()
    expect(screen.getByLabelText('First branch name')).toBeRequired()
    expect(screen.getByLabelText('Branch code')).toBeRequired()
    const slug = screen.getByLabelText('Business slug (unique, lowercase)')
    expect(slug).toBeRequired()
    expect(slug).toHaveAttribute('pattern', '[a-z0-9-]+')
  })

  it('normalizes input before calling the bootstrap rpc', async () => {
    const { container } = renderBootstrap()
    fill(screen.getByLabelText('Business name'), '  Nexarion Sky  ')
    fill(screen.getByLabelText('Business slug (unique, lowercase)'), '  MY-SKY  ')
    fill(screen.getByLabelText('First branch name'), ' Downtown ')
    fill(screen.getByLabelText('Branch code'), ' dtn ')
    submit(container)

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledWith('bootstrap_organization', {
      p_org_name: 'Nexarion Sky',
      p_org_slug: 'my-sky',
      p_branch_name: 'Downtown',
      p_branch_code: 'DTN',
    })
  })

  it('refreshes access and navigates home after a successful bootstrap', async () => {
    const refreshAccess = vi.fn(async () => {})
    const { container } = renderBootstrap({ refreshAccess })
    submit(container)
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(refreshAccess).toHaveBeenCalledTimes(1)
  })

  it('shows the rpc error, stays on the page and keeps the button usable', async () => {
    const refreshAccess = vi.fn(async () => {})
    mocks.rpc.mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint' },
    })
    const { container } = renderBootstrap({ refreshAccess })
    submit(container)

    expect(
      await screen.findByText('duplicate key value violates unique constraint'),
    ).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
    expect(refreshAccess).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled()
  })

  it('shows a busy button while the rpc is in flight', async () => {
    let resolveRpc!: (value: { error: { message: string } | null }) => void
    mocks.rpc.mockImplementation(
      () =>
        new Promise<{ error: { message: string } | null }>((resolve) => {
          resolveRpc = resolve
        }),
    )
    const { container } = renderBootstrap()
    submit(container)
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()

    resolveRpc({ error: null })
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })
})
