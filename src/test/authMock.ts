import { vi } from 'vitest'
import type { useAuth } from '../lib/auth'

export type AuthValue = ReturnType<typeof useAuth>

/** Full AuthContext stand-in; override just the fields a test cares about. */
export function authValue(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    session: null,
    loading: false,
    access: null,
    accessError: null,
    signUpEnabled: true,
    hasPermission: () => false,
    refreshAccess: vi.fn(async () => {}),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ error: null, emailSent: false })),
    sendPasswordReset: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => {}),
    ...overrides,
  }
}
