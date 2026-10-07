import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { InitialEntry } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '../pages/LoginPage'
import { authValue, type AuthValue } from './authMock'
import { makeSession } from './fixtures'

const mocks = vi.hoisted(() => ({ current: null as unknown as AuthValue }))

vi.mock('../lib/auth', () => ({
  useAuth: () => mocks.current,
}))

function renderLogin(
  initialEntry: InitialEntry = '/login',
  overrides: Partial<AuthValue> = {},
) {
  mocks.current = authValue(overrides)
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/audit" element={<div>AUDIT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
  return form
}

function fill(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  mocks.current = authValue()
})

describe('LoginPage', () => {
  it('shows the splash while loading', () => {
    renderLogin('/login', { loading: true })
    expect(screen.getByText('Loading Nexarion Sky…')).toBeInTheDocument()
  })

  it('redirects an existing session to the default destination', () => {
    renderLogin('/login', { session: makeSession() })
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('returns an existing session to the interrupted path', () => {
    renderLogin({ pathname: '/login', state: { from: '/audit' } }, { session: makeSession() })
    expect(screen.getByText('AUDIT')).toBeInTheDocument()
  })

  it('offers account creation and reveals the full-name field', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
  })

  it('hides the sign-up tab when the server disables sign-up', () => {
    renderLogin('/login', { signUpEnabled: false })
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument()
  })

  it('shows the server error when sign-in fails', async () => {
    const { container } = renderLogin('/login', {
      signInWithPassword: vi.fn(async () => ({ error: 'Invalid login credentials' })),
    })
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    submit(container)
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  it('navigates home after a successful sign-in', async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }))
    const { container } = renderLogin('/login', { signInWithPassword })
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    submit(container)
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(signInWithPassword).toHaveBeenCalledWith('owner@example.com', 'password1')
  })

  it('disables the button while the sign-in is in flight', async () => {
    let resolveSignIn!: (value: { error: string | null }) => void
    const signInWithPassword = vi.fn(
      () =>
        new Promise<{ error: string | null }>((resolve) => {
          resolveSignIn = resolve
        }),
    )
    const { container } = renderLogin('/login', { signInWithPassword })
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    const form = submit(container)
    expect(within(form).getByRole('button', { name: 'Working…' })).toBeDisabled()

    await act(async () => {
      resolveSignIn({ error: null })
    })
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })

  it('creates an account and navigates home when a session is returned', async () => {
    const signUp = vi.fn(async () => ({ error: null, emailSent: false }))
    const { container } = renderLogin('/login', { signUp })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fill(screen.getByLabelText('Full name'), 'Ada Owner')
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    submit(container)
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(signUp).toHaveBeenCalledWith('owner@example.com', 'password1', 'Ada Owner')
  })

  it('shows the confirm-email message and returns to sign-in when no session was created', async () => {
    const signUp = vi.fn(async () => ({ error: null, emailSent: true }))
    const { container } = renderLogin('/login', { signUp })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fill(screen.getByLabelText('Full name'), 'Ada Owner')
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    submit(container)
    expect(
      await screen.findByText('Account created. Check your email to confirm, then sign in.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('shows the server error when account creation fails', async () => {
    const signUp = vi.fn(async () => ({ error: 'User already registered', emailSent: false }))
    const { container } = renderLogin('/login', { signUp })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fill(screen.getByLabelText('Full name'), 'Ada Owner')
    fill(screen.getByLabelText('Email'), 'owner@example.com')
    fill(screen.getByLabelText('Password'), 'password1')
    submit(container)
    expect(await screen.findByText('User already registered')).toBeInTheDocument()
  })

  it('enforces an 8-character minimum on passwords', () => {
    renderLogin()
    expect(screen.getByLabelText('Password')).toHaveAttribute('minlength', '8')
  })

  it('sends a reset link and toggles back to sign-in', async () => {
    const sendPasswordReset = vi.fn(async () => ({ error: null }))
    const { container } = renderLogin('/login', { sendPasswordReset })

    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    fill(screen.getByLabelText('Email'), 'owner@example.com')
    submit(container)
    expect(
      await screen.findByText('If an account exists for that email, a reset link is on its way.'),
    ).toBeInTheDocument()
    expect(sendPasswordReset).toHaveBeenCalledWith('owner@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})
