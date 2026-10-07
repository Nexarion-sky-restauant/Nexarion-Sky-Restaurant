import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../lib/auth'
import { makeAccess, makeSession } from './fixtures'

const mocks = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, session: unknown) => void>,
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signOut: mocks.signOut,
    },
    schema: () => ({ rpc: mocks.rpc }),
  },
}))

type AuthValue = ReturnType<typeof useAuth>

let ctx: AuthValue | null = null

function Probe() {
  ctx = useAuth()
  const { loading, session, access, accessError, signUpEnabled } = ctx
  return (
    <div
      data-testid="probe"
      data-loading={String(loading)}
      data-session={session ? 'yes' : 'no'}
      data-access={access ? 'yes' : 'no'}
      data-error={accessError ?? 'none'}
      data-signup={String(signUpEnabled)}
    />
  )
}

function probe() {
  return screen.getByTestId('probe')
}

async function flush() {
  await act(async () => {})
}

async function renderProvider() {
  const utils = render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  await flush()
  await flush()
  return utils
}

function stubSettingsFetch(settings: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => settings })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  ctx = null
  mocks.listeners.length = 0
  mocks.getSession.mockResolvedValue({ data: { session: null } })
  mocks.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    mocks.listeners.push(cb)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
  mocks.signOut.mockResolvedValue({ error: null })
  stubSettingsFetch({})
})

describe('AuthProvider initial load', () => {
  it('treats a missing session as signed out and stops loading', async () => {
    await renderProvider()
    expect(probe()).toHaveAttribute('data-loading', 'false')
    expect(probe()).toHaveAttribute('data-session', 'no')
    expect(probe()).toHaveAttribute('data-access', 'no')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('loads the access payload for an existing session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: makeAccess(), error: null })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-session', 'yes')
    expect(probe()).toHaveAttribute('data-access', 'yes')
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_access')
  })

  it('maps an rpc payload without a profile to access=null (not bootstrapped)', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({
      data: { profile: null, organization: null, permissions: [], branch_ids: [] },
      error: null,
    })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-access', 'no')
    expect(probe()).toHaveAttribute('data-error', 'none')
  })
})

describe('M7 — access load failures are surfaced, not masked', () => {
  it('sets accessError on rpc failure instead of a synthetic empty access', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-loading', 'false')
    expect(probe()).toHaveAttribute('data-access', 'no')
    expect(probe()).toHaveAttribute('data-error', 'Failed to fetch')
  })

  it('keeps previously loaded access when a refresh fails', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: makeAccess(), error: null })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-access', 'yes')

    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await act(async () => {
      await ctx!.refreshAccess()
    })
    expect(probe()).toHaveAttribute('data-access', 'yes')
    expect(probe()).toHaveAttribute('data-error', 'Failed to fetch')
  })

  it('clears accessError after a successful retry', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-error', 'Failed to fetch')

    mocks.rpc.mockResolvedValue({ data: makeAccess(), error: null })
    await act(async () => {
      await ctx!.refreshAccess()
    })
    expect(probe()).toHaveAttribute('data-error', 'none')
    expect(probe()).toHaveAttribute('data-access', 'yes')
  })
})

describe('auth state changes', () => {
  it('loads access when SIGNED_IN fires', async () => {
    await renderProvider()
    mocks.rpc.mockResolvedValue({ data: makeAccess(), error: null })
    await act(async () => {
      mocks.listeners.forEach((cb) => cb('SIGNED_IN', makeSession()))
    })
    await flush()
    expect(probe()).toHaveAttribute('data-session', 'yes')
    expect(probe()).toHaveAttribute('data-access', 'yes')
  })

  it('clears session, access and accessError on SIGNED_OUT', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-error', 'Failed to fetch')

    await act(async () => {
      mocks.listeners.forEach((cb) => cb('SIGNED_OUT', null))
    })
    await flush()
    expect(probe()).toHaveAttribute('data-session', 'no')
    expect(probe()).toHaveAttribute('data-access', 'no')
    expect(probe()).toHaveAttribute('data-error', 'none')
  })
})

describe('sign-up settings probe', () => {
  it('hides sign-up when the server reports disable_signup=true', async () => {
    stubSettingsFetch({ disable_signup: true })
    await renderProvider()
    expect(probe()).toHaveAttribute('data-signup', 'false')
  })

  it('probes the public auth settings endpoint with the publishable anon key', async () => {
    const fetchMock = stubSettingsFetch({})
    await renderProvider()
    expect(fetchMock).toHaveBeenCalledWith('https://test-project.supabase.co/auth/v1/settings', {
      headers: { apikey: 'test-anon-key' },
    })
  })

  it('fails open when the probe request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await renderProvider()
    expect(probe()).toHaveAttribute('data-signup', 'true')
  })
})

describe('auth methods', () => {
  async function callMethod<T>(fn: () => Promise<T>): Promise<T> {
    let result: T | undefined
    await act(async () => {
      result = await fn()
    })
    return result as T
  }

  it('signInWithPassword returns a null error on success', async () => {
    await renderProvider()
    const result = await callMethod(() => ctx!.signInWithPassword('owner@example.com', 'password1'))
    expect(result).toEqual({ error: null })
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'password1',
    })
  })

  it('strips the error prefix from server messages (friendlyError)', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: 'AuthApiError: Invalid login credentials' },
    })
    await renderProvider()
    const result = await callMethod(() => ctx!.signInWithPassword('a@b.com', 'password1'))
    expect(result.error).toBe('Invalid login credentials')
  })

  it('falls back to a generic message when the server error is empty', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: '' } })
    await renderProvider()
    const result = await callMethod(() => ctx!.signInWithPassword('a@b.com', 'password1'))
    expect(result.error).toBe('Something went wrong. Please try again.')
  })

  it('signUp reports emailSent=true when no session is returned', async () => {
    await renderProvider()
    const result = await callMethod(() => ctx!.signUp('a@b.com', 'password1', 'Ada Owner'))
    expect(result).toEqual({ error: null, emailSent: true })
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'password1',
      options: { data: { full_name: 'Ada Owner' } },
    })
  })

  it('signUp reports emailSent=false when a session is returned', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: makeSession() }, error: null })
    await renderProvider()
    const result = await callMethod(() => ctx!.signUp('a@b.com', 'password1', 'Ada Owner'))
    expect(result).toEqual({ error: null, emailSent: false })
  })

  it('signUp surfaces server errors with emailSent=false', async () => {
    mocks.signUp.mockResolvedValue({
      data: null,
      error: { message: 'User already registered' },
    })
    await renderProvider()
    const result = await callMethod(() => ctx!.signUp('a@b.com', 'password1', 'Ada Owner'))
    expect(result).toEqual({ error: 'User already registered', emailSent: false })
  })

  it('sendPasswordReset forwards to supabase and reports success', async () => {
    await renderProvider()
    const result = await callMethod(() => ctx!.sendPasswordReset('a@b.com'))
    expect(result).toEqual({ error: null })
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com')
  })

  it('sendPasswordReset surfaces server errors', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: 'Rate limit exceeded' } })
    await renderProvider()
    const result = await callMethod(() => ctx!.sendPasswordReset('a@b.com'))
    expect(result.error).toBe('Rate limit exceeded')
  })

  it('signOut delegates to supabase.auth.signOut', async () => {
    await renderProvider()
    await callMethod(() => ctx!.signOut())
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('useAuth and hasPermission', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useAuth must be used inside <AuthProvider>')
    spy.mockRestore()
  })

  it('hasPermission checks the loaded permission list', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: makeSession() } })
    mocks.rpc.mockResolvedValue({ data: makeAccess(), error: null })
    await renderProvider()
    expect(ctx!.hasPermission('audit.view')).toBe(true)
    expect(ctx!.hasPermission('inventory.view')).toBe(false)
  })

  it('hasPermission defaults to false without access', async () => {
    await renderProvider()
    expect(ctx!.hasPermission('dashboard.view')).toBe(false)
  })
})
