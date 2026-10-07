import { describe, expect, it, vi } from 'vitest'
import {
  IMAGE_MAX_BYTES,
  formatKes,
  parsePrice,
  validateDescription,
  validateImageFile,
  validateName,
} from '../lib/menu'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

function makeFile(type: string, size = 4): File {
  const file = new File(['x'], 'photo.jpg', { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('parsePrice', () => {
  it('accepts plain and decimal amounts', () => {
    expect(parsePrice('950')).toEqual({ value: 950, error: null })
    expect(parsePrice(' 12.5 ')).toEqual({ value: 12.5, error: null })
    expect(parsePrice('0.01')).toEqual({ value: 0.01, error: null })
  })

  it('accepts the numeric(12,2) upper boundary', () => {
    expect(parsePrice('9999999999.99')).toEqual({ value: 9999999999.99, error: null })
  })

  it('requires a value', () => {
    expect(parsePrice('')).toEqual({ value: null, error: 'Price is required.' })
    expect(parsePrice('   ')).toEqual({ value: null, error: 'Price is required.' })
  })

  it('rejects zero and non-positive amounts', () => {
    expect(parsePrice('0')).toEqual({
      value: null,
      error: 'Price must be greater than zero.',
    })
    expect(parsePrice('0.00')).toEqual({
      value: null,
      error: 'Price must be greater than zero.',
    })
  })

  it('rejects formats the column cannot store', () => {
    const formatError = 'Enter a price with up to 2 decimal places.'
    for (const raw of ['-5', '12.345', '1e3', 'abc', '12,50', '.5', '12345678901']) {
      expect(parsePrice(raw), `should reject ${raw}`).toEqual({
        value: null,
        error: formatError,
      })
    }
    // 11 integer digits exceeds numeric(12,2) just like the regex does, so the
    // client never sends a value the database would reject.
    expect(parsePrice('10000000000.00')).toEqual({ value: null, error: formatError })
  })
})

describe('validateName', () => {
  it('accepts a trimmed, non-empty name', () => {
    expect(validateName('Truffle Soup')).toBeNull()
    expect(validateName('  Truffle Soup  ')).toBeNull()
    expect(validateName('a'.repeat(120))).toBeNull()
  })

  it('rejects blank names', () => {
    expect(validateName('')).toBe('Name is required.')
    expect(validateName('   ')).toBe('Name is required.')
  })

  it('rejects names beyond the column limit', () => {
    expect(validateName('a'.repeat(121))).toBe('Name must be 120 characters or fewer.')
  })
})

describe('validateDescription', () => {
  it('accepts empty and boundary-length descriptions', () => {
    expect(validateDescription('')).toBeNull()
    expect(validateDescription('a'.repeat(2000))).toBeNull()
  })

  it('rejects descriptions beyond the column limit', () => {
    expect(validateDescription('a'.repeat(2001))).toBe(
      'Description must be 2000 characters or fewer.',
    )
  })
})

describe('validateImageFile', () => {
  it('accepts the three allowed image types', () => {
    expect(validateImageFile(makeFile('image/jpeg'))).toBeNull()
    expect(validateImageFile(makeFile('image/png'))).toBeNull()
    expect(validateImageFile(makeFile('image/webp'))).toBeNull()
  })

  it('rejects other MIME types', () => {
    expect(validateImageFile(makeFile('image/gif'))).toBe(
      'Image must be a JPEG, PNG or WebP file.',
    )
    expect(validateImageFile(makeFile('application/pdf'))).toBe(
      'Image must be a JPEG, PNG or WebP file.',
    )
  })

  it('enforces the 2 MB bucket limit', () => {
    expect(validateImageFile(makeFile('image/jpeg', IMAGE_MAX_BYTES))).toBeNull()
    expect(validateImageFile(makeFile('image/jpeg', IMAGE_MAX_BYTES + 1))).toBe(
      'Image must be 2 MB or smaller.',
    )
  })
})

describe('formatKes', () => {
  it('renders amounts in Kenyan shillings with two decimals', () => {
    expect(formatKes(950)).toBe('KES 950.00')
    expect(formatKes(12.5)).toBe('KES 12.50')
    expect(formatKes(0.01)).toBe('KES 0.01')
  })
})
