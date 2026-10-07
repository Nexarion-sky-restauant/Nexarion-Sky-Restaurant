import type { Session } from '@supabase/supabase-js'
import type { AccessPayload, Branch, Organization, Profile } from '../types/database'

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
export const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222'
export const TEST_BRANCH_ID = '33333333-3333-4333-8333-333333333333'

const NOW = '2026-01-01T00:00:00.000Z'

export function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: TEST_ORG_ID,
    slug: 'nexarion-sky',
    name: 'Nexarion Sky Restaurant',
    default_currency: 'KES',
    timezone: 'Africa/Nairobi',
    settings: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: TEST_BRANCH_ID,
    organization_id: TEST_ORG_ID,
    code: 'MAIN',
    name: 'Main Branch',
    address: null,
    phone: null,
    email: null,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: TEST_USER_ID,
    organization_id: TEST_ORG_ID,
    full_name: 'Ada Owner',
    phone: null,
    avatar_path: null,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeAccess(overrides: Partial<AccessPayload> = {}): AccessPayload {
  return {
    profile: makeProfile(),
    organization: makeOrganization(),
    permissions: ['dashboard.view', 'audit.view'],
    branch_ids: [TEST_BRANCH_ID],
    ...overrides,
  }
}

/** Minimal session shape — only the fields the app actually touches. */
export function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: TEST_USER_ID,
      email: 'owner@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: NOW,
    },
    ...overrides,
  } as unknown as Session
}
