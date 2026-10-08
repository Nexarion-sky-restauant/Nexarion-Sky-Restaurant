import { describe, expect, it, vi } from 'vitest'
import {
  allowedTransitions,
  dayBoundsUtc,
  offsetDateKey,
  parseDuration,
  parsePartySize,
  reservationEndIso,
  tzDateKey,
  tzTimeKey,
  tzToday,
  validateGuestName,
  validateGuestPhone,
  validateNotes,
  wallTimeToUtcIso,
  windowsOverlap,
} from '../lib/reservations'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

const NAIROBI = 'Africa/Nairobi'
const LONDON = 'Europe/London'

describe('wallTimeToUtcIso', () => {
  it('converts Nairobi wall time (UTC+3, no DST)', () => {
    expect(wallTimeToUtcIso('2026-10-08', '19:30', NAIROBI)).toBe('2026-10-08T16:30:00.000Z')
    expect(wallTimeToUtcIso('2026-01-01', '00:00', NAIROBI)).toBe('2025-12-31T21:00:00.000Z')
  })

  it('applies the seasonally correct London offset', () => {
    expect(wallTimeToUtcIso('2026-07-01', '12:00', LONDON)).toBe('2026-07-01T11:00:00.000Z')
    expect(wallTimeToUtcIso('2026-12-01', '12:00', LONDON)).toBe('2026-12-01T12:00:00.000Z')
  })

  it('rejects wall times skipped by the spring DST jump', () => {
    // UK clocks jump 01:00 GMT -> 02:00 BST on 2026-03-29; 01:30 never exists.
    expect(wallTimeToUtcIso('2026-03-29', '01:30', LONDON)).toBeNull()
    expect(wallTimeToUtcIso('2026-03-29', '02:30', LONDON)).toBe('2026-03-29T01:30:00.000Z')
  })

  it('resolves ambiguous fall-back times to a round-trippable instant', () => {
    const ambiguous = wallTimeToUtcIso('2026-10-25', '01:30', LONDON)
    expect(ambiguous).not.toBeNull()
    expect(tzTimeKey(ambiguous as string, LONDON)).toBe('01:30')
    expect(tzDateKey(ambiguous as string, LONDON)).toBe('2026-10-25')
  })

  it('rejects malformed or impossible inputs', () => {
    expect(wallTimeToUtcIso('2026-02-31', '12:00', NAIROBI)).toBeNull()
    expect(wallTimeToUtcIso('2026-13-01', '12:00', NAIROBI)).toBeNull()
    expect(wallTimeToUtcIso('2026-10-08', '24:00', NAIROBI)).toBeNull()
    expect(wallTimeToUtcIso('2026-10-8', '12:00', NAIROBI)).toBeNull()
    expect(wallTimeToUtcIso('2026-10-08', '19:5', NAIROBI)).toBeNull()
  })
})

describe('timezone display helpers', () => {
  it('formats the same instant in the organization timezone', () => {
    expect(tzDateKey('2026-10-08T16:30:00.000Z', NAIROBI)).toBe('2026-10-08')
    expect(tzTimeKey('2026-10-08T16:30:00.000Z', NAIROBI)).toBe('19:30')
  })

  it('rolls the date over when the local day has advanced', () => {
    expect(tzDateKey('2026-10-08T22:00:00.000Z', NAIROBI)).toBe('2026-10-09')
    expect(tzTimeKey('2026-10-08T22:00:00.000Z', NAIROBI)).toBe('01:00')
  })

  it('tzToday agrees with tzDateKey for the current instant', () => {
    expect(tzToday(NAIROBI)).toBe(tzDateKey(Date.now(), NAIROBI))
  })
})

describe('offsetDateKey', () => {
  it('steps calendar days across month and year boundaries', () => {
    expect(offsetDateKey('2026-10-08', 1)).toBe('2026-10-09')
    expect(offsetDateKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(offsetDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(offsetDateKey('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('dayBoundsUtc', () => {
  it('returns the UTC window covering the local calendar day', () => {
    expect(dayBoundsUtc('2026-10-08', NAIROBI)).toEqual({
      startIso: '2026-10-07T21:00:00.000Z',
      endIso: '2026-10-08T21:00:00.000Z',
    })
  })

  it('returns null for an impossible date key', () => {
    expect(dayBoundsUtc('2026-13-01', NAIROBI)).toBeNull()
  })
})

describe('reservationEndIso', () => {
  it('adds the duration to the start instant', () => {
    expect(reservationEndIso('2026-10-08T16:30:00.000Z', 120)).toBe('2026-10-08T18:30:00.000Z')
  })
})

describe('windowsOverlap', () => {
  const start = '2026-10-08T16:00:00.000Z'
  const end = '2026-10-08T18:00:00.000Z'

  it('detects a genuine overlap', () => {
    expect(windowsOverlap(start, end, '2026-10-08T17:00:00.000Z', '2026-10-08T19:00:00.000Z')).toBe(
      true,
    )
    expect(windowsOverlap(start, end, '2026-10-08T15:00:00.000Z', '2026-10-08T16:30:00.000Z')).toBe(
      true,
    )
  })

  it('treats back-to-back bookings as non-conflicting (half-open)', () => {
    expect(windowsOverlap(start, end, end, '2026-10-08T20:00:00.000Z')).toBe(false)
    expect(windowsOverlap(start, end, '2026-10-08T14:00:00.000Z', start)).toBe(false)
  })

  it('is insensitive to the offset notation PostgREST returns', () => {
    expect(windowsOverlap(start, end, '2026-10-08T18:00:00+00:00', '2026-10-08T19:00:00+00:00')).toBe(
      false,
    )
    expect(windowsOverlap(start, end, '2026-10-08T17:00:00+00:00', '2026-10-08T19:00:00+00:00')).toBe(
      true,
    )
  })

  it('reports no overlap for disjoint windows', () => {
    expect(windowsOverlap(start, end, '2026-10-08T20:00:00.000Z', '2026-10-08T22:00:00.000Z')).toBe(
      false,
    )
  })
})

describe('allowedTransitions', () => {
  it('mirrors the server-side transition guard', () => {
    expect(allowedTransitions('pending')).toEqual(['confirmed', 'cancelled'])
    expect(allowedTransitions('confirmed')).toEqual(['seated', 'cancelled', 'no_show'])
    expect(allowedTransitions('seated')).toEqual(['completed'])
    expect(allowedTransitions('completed')).toEqual([])
    expect(allowedTransitions('cancelled')).toEqual([])
    expect(allowedTransitions('no_show')).toEqual([])
  })
})

describe('validateGuestName', () => {
  it('accepts a trimmed, non-empty name up to the column limit', () => {
    expect(validateGuestName('Ada Wanjiru')).toBeNull()
    expect(validateGuestName('  Ada  ')).toBeNull()
    expect(validateGuestName('a'.repeat(120))).toBeNull()
  })

  it('rejects blank and oversized names', () => {
    expect(validateGuestName('')).toBe('Guest name is required.')
    expect(validateGuestName('   ')).toBe('Guest name is required.')
    expect(validateGuestName('a'.repeat(121))).toBe('Guest name must be 120 characters or fewer.')
  })
})

describe('validateGuestPhone', () => {
  it('accepts empty and boundary-length phones', () => {
    expect(validateGuestPhone('')).toBeNull()
    expect(validateGuestPhone('+254 700 000 000')).toBeNull()
    expect(validateGuestPhone('9'.repeat(32))).toBeNull()
  })

  it('rejects phones beyond the column limit', () => {
    expect(validateGuestPhone('9'.repeat(33))).toBe('Phone must be 32 characters or fewer.')
  })
})

describe('parsePartySize', () => {
  it('accepts whole numbers within the column bounds', () => {
    expect(parsePartySize('4')).toEqual({ value: 4, error: null })
    expect(parsePartySize(' 12 ')).toEqual({ value: 12, error: null })
    expect(parsePartySize('1')).toEqual({ value: 1, error: null })
    expect(parsePartySize('100')).toEqual({ value: 100, error: null })
  })

  it('requires a value', () => {
    expect(parsePartySize('')).toEqual({ value: null, error: 'Party size is required.' })
  })

  it('rejects non-integers and out-of-range sizes', () => {
    expect(parsePartySize('2.5')).toEqual({
      value: null,
      error: 'Party size must be a whole number.',
    })
    expect(parsePartySize('abc')).toEqual({
      value: null,
      error: 'Party size must be a whole number.',
    })
    expect(parsePartySize('0')).toEqual({
      value: null,
      error: 'Party size must be between 1 and 100.',
    })
    expect(parsePartySize('101')).toEqual({
      value: null,
      error: 'Party size must be between 1 and 100.',
    })
  })
})

describe('parseDuration', () => {
  it('accepts the documented 15-480 minute range', () => {
    expect(parseDuration('120')).toEqual({ value: 120, error: null })
    expect(parseDuration('15')).toEqual({ value: 15, error: null })
    expect(parseDuration('480')).toEqual({ value: 480, error: null })
  })

  it('requires a value', () => {
    expect(parseDuration('')).toEqual({ value: null, error: 'Duration is required.' })
  })

  it('rejects non-integers and out-of-range durations', () => {
    expect(parseDuration('60.5')).toEqual({
      value: null,
      error: 'Duration must be a whole number of minutes.',
    })
    expect(parseDuration('10')).toEqual({
      value: null,
      error: 'Duration must be between 15 and 480 minutes.',
    })
    expect(parseDuration('481')).toEqual({
      value: null,
      error: 'Duration must be between 15 and 480 minutes.',
    })
  })
})

describe('validateNotes', () => {
  it('accepts empty and boundary-length notes', () => {
    expect(validateNotes('')).toBeNull()
    expect(validateNotes('a'.repeat(2000))).toBeNull()
  })

  it('rejects notes beyond the column limit', () => {
    expect(validateNotes('a'.repeat(2001))).toBe('Notes must be 2000 characters or fewer.')
  })
})
