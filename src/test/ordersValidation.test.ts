import { describe, expect, it, vi } from 'vitest'
import {
  allowedItemTransitions,
  allowedOrderTransitions,
  orderTotal,
  parseQuantity,
  validateItemNotes,
  validateOrderNotes,
  validateVoidReason,
} from '../lib/orders'
import { makeOrderItem } from './fixtures'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

describe('allowedOrderTransitions', () => {
  it('mirrors the server-side order guard', () => {
    expect(allowedOrderTransitions('open')).toEqual(['placed', 'cancelled'])
    expect(allowedOrderTransitions('placed')).toEqual(['served', 'cancelled'])
    expect(allowedOrderTransitions('served')).toEqual(['completed'])
    expect(allowedOrderTransitions('completed')).toEqual([])
    expect(allowedOrderTransitions('cancelled')).toEqual([])
  })
})

describe('allowedItemTransitions', () => {
  it('mirrors the post-placement kitchen transition chain', () => {
    expect(allowedItemTransitions('queued')).toEqual(['preparing'])
    expect(allowedItemTransitions('preparing')).toEqual(['ready'])
    expect(allowedItemTransitions('ready')).toEqual(['served'])
    expect(allowedItemTransitions('served')).toEqual([])
  })
})

describe('validateOrderNotes', () => {
  it('accepts empty and boundary-length notes', () => {
    expect(validateOrderNotes('')).toBeNull()
    expect(validateOrderNotes('a'.repeat(500))).toBeNull()
  })

  it('rejects notes beyond the column limit', () => {
    expect(validateOrderNotes('a'.repeat(501))).toBe('Notes must be 500 characters or fewer.')
  })
})

describe('validateItemNotes', () => {
  it('accepts empty and boundary-length notes', () => {
    expect(validateItemNotes('')).toBeNull()
    expect(validateItemNotes('a'.repeat(200))).toBeNull()
  })

  it('rejects notes beyond the column limit', () => {
    expect(validateItemNotes('a'.repeat(201))).toBe('Item notes must be 200 characters or fewer.')
  })
})

describe('validateVoidReason', () => {
  it('accepts a trimmed, non-empty reason up to the column limit', () => {
    expect(validateVoidReason('Guest changed their mind')).toBeNull()
    expect(validateVoidReason('  spilled on the way  ')).toBeNull()
    expect(validateVoidReason('a'.repeat(200))).toBeNull()
  })

  it('requires a reason', () => {
    expect(validateVoidReason('')).toBe('A void reason is required.')
    expect(validateVoidReason('   ')).toBe('A void reason is required.')
  })

  it('rejects reasons beyond the column limit', () => {
    expect(validateVoidReason('a'.repeat(201))).toBe('Void reason must be 200 characters or fewer.')
  })
})

describe('parseQuantity', () => {
  it('accepts whole numbers within the column bounds', () => {
    expect(parseQuantity('1')).toEqual({ value: 1, error: null })
    expect(parseQuantity(' 12 ')).toEqual({ value: 12, error: null })
    expect(parseQuantity('99')).toEqual({ value: 99, error: null })
  })

  it('requires a value', () => {
    expect(parseQuantity('')).toEqual({ value: null, error: 'Quantity is required.' })
    expect(parseQuantity('   ')).toEqual({ value: null, error: 'Quantity is required.' })
  })

  it('rejects non-integers and out-of-range quantities', () => {
    expect(parseQuantity('2.5')).toEqual({
      value: null,
      error: 'Quantity must be a whole number.',
    })
    expect(parseQuantity('two')).toEqual({
      value: null,
      error: 'Quantity must be a whole number.',
    })
    expect(parseQuantity('0')).toEqual({
      value: null,
      error: 'Quantity must be between 1 and 99.',
    })
    expect(parseQuantity('100')).toEqual({
      value: null,
      error: 'Quantity must be between 1 and 99.',
    })
  })
})

describe('orderTotal', () => {
  it('sums the stored line totals of live lines', () => {
    const items = [
      makeOrderItem({ line_total: 1900 }),
      makeOrderItem({ id: 'second', line_total: 950, quantity: 1 }),
    ]
    expect(orderTotal(items)).toBe(2850)
  })

  it('excludes voided lines from the total', () => {
    const items = [
      makeOrderItem({ line_total: 1900 }),
      makeOrderItem({
        id: 'second',
        line_total: 950,
        voided_at: '2026-01-01T01:00:00.000Z',
        voided_by: '22223333-1111-4111-8111-111111111111',
        void_reason: 'spilled',
      }),
    ]
    expect(orderTotal(items)).toBe(1900)
  })

  it('returns zero for an empty order', () => {
    expect(orderTotal([])).toBe(0)
  })
})
