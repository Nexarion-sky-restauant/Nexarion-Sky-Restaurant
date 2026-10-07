import { describe, expect, it, vi } from 'vitest'
import { appEnv, env } from './env'

describe('config/env', () => {
  it('resolves required Supabase values from the environment', () => {
    expect(env.supabaseUrl).toBe('https://test-project.supabase.co')
    expect(env.supabaseAnonKey).toBe('test-anon-key')
  })

  it('maps VITE_APP_ENV to the three known environments', async () => {
    vi.stubEnv('VITE_APP_ENV', 'staging')
    vi.resetModules()
    const staging = await import('./env')
    expect(staging.appEnv()).toBe('staging')

    vi.stubEnv('VITE_APP_ENV', 'production')
    vi.resetModules()
    const production = await import('./env')
    expect(production.appEnv()).toBe('production')

    vi.stubEnv('VITE_APP_ENV', 'development')
    vi.resetModules()
    const development = await import('./env')
    expect(development.appEnv()).toBe('development')
  })

  it('falls back to development for unrecognized values', async () => {
    vi.stubEnv('VITE_APP_ENV', 'qa-sandbox')
    vi.resetModules()
    const unknown = await import('./env')
    expect(unknown.appEnv()).toBe('development')

    vi.stubEnv('VITE_APP_ENV', '')
    vi.resetModules()
    const empty = await import('./env')
    expect(empty.appEnv()).toBe('development')
  })

  it('throws when a required variable is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      'Missing required environment variable VITE_SUPABASE_URL',
    )
    vi.unstubAllEnvs()
  })

  it('defaults appEnv() to development when VITE_APP_ENV is unset', () => {
    expect(appEnv()).toBe('development')
  })
})
