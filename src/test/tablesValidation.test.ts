import { describe, expect, it, vi } from 'vitest'
import { parseCapacity, validateTableName, validateZone } from '../lib/tables'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

describe('validateTableName', () => {
  it('accepts a trimmed, non-empty name up to the column limit', () => {
    expect(validateTableName('Table 12')).toBeNull()
    expect(validateTableName('  Terrace 4  ')).toBeNull()
    expect(validateTableName('a'.repeat(80))).toBeNull()
  })

  it('rejects blank names', () => {
    expect(validateTableName('')).toBe('Name is required.')
    expect(validateTableName('   ')).toBe('Name is required.')
  })

  it('rejects names beyond the column limit', () => {
    expect(validateTableName('a'.repeat(81))).toBe('Name must be 80 characters or fewer.')
  })
})

describe('validateZone', () => {
  it('accepts a trimmed, non-empty zone up to the column limit', () => {
    expect(validateZone('Terrace')).toBeNull()
    expect(validateZone('  Main hall  ')).toBeNull()
    expect(validateZone('a'.repeat(60))).toBeNull()
  })

  it('rejects blank zones', () => {
    expect(validateZone('')).toBe('Zone is required.')
    expect(validateZone('   ')).toBe('Zone is required.')
  })

  it('rejects zones beyond the column limit', () => {
    expect(validateZone('a'.repeat(61))).toBe('Zone must be 60 characters or fewer.')
  })
})

describe('parseCapacity', () => {
  it('accepts whole numbers within the column bounds', () => {
    expect(parseCapacity('4')).toEqual({ value: 4, error: null })
    expect(parseCapacity(' 8 ')).toEqual({ value: 8, error: null })
    expect(parseCapacity('1')).toEqual({ value: 1, error: null })
    expect(parseCapacity('100')).toEqual({ value: 100, error: null })
  })

  it('requires a value', () => {
    expect(parseCapacity('')).toEqual({ value: null, error: 'Capacity is required.' })
  })

  it('rejects non-integers and out-of-range capacities', () => {
    expect(parseCapacity('2.5')).toEqual({ value: null, error: 'Capacity must be a whole number.' })
    expect(parseCapacity('abc')).toEqual({ value: null, error: 'Capacity must be a whole number.' })
    expect(parseCapacity('0')).toEqual({
      value: null,
      error: 'Capacity must be between 1 and 100.',
    })
    expect(parseCapacity('101')).toEqual({
      value: null,
      error: 'Capacity must be between 1 and 100.',
    })
  })
})
