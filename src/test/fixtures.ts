import type { Session } from '@supabase/supabase-js'
import type {
  AccessPayload,
  Branch,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  Organization,
  Profile,
  RestaurantTable,
  TableReservation,
} from '../types/database'

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
export const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222'
export const TEST_BRANCH_ID = '33333333-3333-4333-8333-333333333333'
export const TEST_CATEGORY_ID = '44444444-4444-4444-8444-444444444444'
export const TEST_ITEM_ID = '55555555-5555-4555-8555-555555555555'
export const TEST_TABLE_ID = '66666666-6666-4666-8666-666666666666'
export const TEST_ORDER_ID = '77777777-7777-4777-8777-777777777777'
export const TEST_RESERVATION_ID = '88888888-8888-4888-8888-888888888888'
export const TEST_SECOND_BRANCH_ID = '99999999-9999-4999-8999-999999999999'
export const TEST_ORDER_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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

export function makeMenuCategory(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: TEST_CATEGORY_ID,
    organization_id: TEST_ORG_ID,
    name: 'Starters',
    description: 'Light dishes to open the meal.',
    sort_order: 1,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: TEST_ITEM_ID,
    organization_id: TEST_ORG_ID,
    category_id: TEST_CATEGORY_ID,
    name: 'Truffle Soup',
    description: 'Creamy wild mushroom soup.',
    price: 950,
    image_path: null,
    is_available: true,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeRestaurantTable(overrides: Partial<RestaurantTable> = {}): RestaurantTable {
  return {
    id: TEST_TABLE_ID,
    organization_id: TEST_ORG_ID,
    branch_id: TEST_BRANCH_ID,
    name: 'Table 1',
    zone: 'Main',
    capacity: 4,
    sort_order: 0,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

// starts_at 16:00Z renders as 19:00 in Africa/Nairobi (the org test timezone).
export function makeReservation(overrides: Partial<TableReservation> = {}): TableReservation {
  return {
    id: TEST_RESERVATION_ID,
    organization_id: TEST_ORG_ID,
    branch_id: TEST_BRANCH_ID,
    table_id: TEST_TABLE_ID,
    guest_name: 'Grace Wanjiru',
    guest_phone: '+254700000000',
    party_size: 2,
    starts_at: '2026-01-01T16:00:00.000Z',
    duration_minutes: 120,
    ends_at: '2026-01-01T18:00:00.000Z',
    status: 'confirmed',
    notes: '',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: TEST_ORDER_ID,
    organization_id: TEST_ORG_ID,
    branch_id: TEST_BRANCH_ID,
    table_id: TEST_TABLE_ID,
    reservation_id: null,
    order_type: 'dine_in',
    status: 'open',
    notes: '',
    created_by: TEST_USER_ID,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: TEST_ORDER_ITEM_ID,
    order_id: TEST_ORDER_ID,
    organization_id: TEST_ORG_ID,
    branch_id: TEST_BRANCH_ID,
    menu_item_id: TEST_ITEM_ID,
    name_snapshot: 'Truffle Soup',
    unit_price: 950,
    quantity: 2,
    notes: '',
    status: 'queued',
    voided_at: null,
    voided_by: null,
    void_reason: '',
    line_total: 1900,
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
