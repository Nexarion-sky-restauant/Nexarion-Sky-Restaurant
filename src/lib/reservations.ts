import { supabase } from './supabase'
import type { ReservationStatus, TableReservation } from '../types/database'

// Must stay in step with the column checks in
// supabase/migrations/20261008000003_tables_reservations.sql.
export const DURATION_MIN_MINUTES = 15
export const DURATION_MAX_MINUTES = 480
export const GUEST_NAME_MAX = 120
export const GUEST_PHONE_MAX = 32
export const PARTY_SIZE_MIN = 1
export const PARTY_SIZE_MAX = 100
export const NOTES_MAX = 2000

export const RESERVATION_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
]

// Statuses covered by the exclusion constraint: only these block a table.
export const ACTIVE_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'seated']

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  seated: 'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

// Mirrors app.guard_reservation_status in the migration.
const NEXT_STATUSES: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
}

export function allowedTransitions(status: ReservationStatus): ReservationStatus[] {
  return NEXT_STATUSES[status]
}

export interface ReservationInput {
  table_id: string
  guest_name: string
  guest_phone: string
  party_size: number
  starts_at: string
  duration_minutes: number
  status: ReservationStatus
  notes: string
}

export async function listReservations(
  branchId: string,
  startIso: string,
  endIso: string,
): Promise<{ data: TableReservation[] | null; error: string | null }> {
  const { data, error } = await supabase
    .schema('app')
    .from('table_reservations')
    .select('*')
    .eq('branch_id', branchId)
    .lt('starts_at', endIso)
    .gt('ends_at', startIso)
    .order('starts_at')

  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function listActiveReservationsInWindow(
  tableId: string,
  startIso: string,
  endIso: string,
  excludeId?: string,
): Promise<{ data: TableReservation[] | null; error: string | null }> {
  let query = supabase
    .schema('app')
    .from('table_reservations')
    .select('*')
    .eq('table_id', tableId)
    .in('status', ACTIVE_STATUSES)
    .lt('starts_at', endIso)
    .gt('ends_at', startIso)
  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query.order('starts_at')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function saveReservation(
  organizationId: string,
  branchId: string,
  reservationId: string | null,
  input: ReservationInput,
): Promise<{ error: string | null }> {
  const { error } = reservationId
    ? await supabase.schema('app').from('table_reservations').update(input).eq('id', reservationId)
    : await supabase
        .schema('app')
        .from('table_reservations')
        .insert({ organization_id: organizationId, branch_id: branchId, ...input })

  if (!error) return { error: null }
  if (error.code === '23P01') {
    return { error: 'That table already has a reservation during this time.' }
  }
  return { error: error.message }
}

export async function setReservationStatus(
  reservationId: string,
  status: ReservationStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('table_reservations')
    .update({ status })
    .eq('id', reservationId)
  return { error: error ? error.message : null }
}

export function validateGuestName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Guest name is required.'
  if (trimmed.length > GUEST_NAME_MAX) return 'Guest name must be 120 characters or fewer.'
  return null
}

export function validateGuestPhone(raw: string): string | null {
  if (raw.trim().length > GUEST_PHONE_MAX) return 'Phone must be 32 characters or fewer.'
  return null
}

const WHOLE_NUMBER_PATTERN = /^\d+$/

export function parsePartySize(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Party size is required.' }
  if (!WHOLE_NUMBER_PATTERN.test(trimmed)) {
    return { value: null, error: 'Party size must be a whole number.' }
  }
  const value = Number.parseInt(trimmed, 10)
  if (value < PARTY_SIZE_MIN || value > PARTY_SIZE_MAX) {
    return { value: null, error: 'Party size must be between 1 and 100.' }
  }
  return { value, error: null }
}

export function parseDuration(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Duration is required.' }
  if (!WHOLE_NUMBER_PATTERN.test(trimmed)) {
    return { value: null, error: 'Duration must be a whole number of minutes.' }
  }
  const value = Number.parseInt(trimmed, 10)
  if (value < DURATION_MIN_MINUTES || value > DURATION_MAX_MINUTES) {
    return { value: null, error: 'Duration must be between 15 and 480 minutes.' }
  }
  return { value, error: null }
}

export function validateNotes(raw: string): string | null {
  if (raw.trim().length > NOTES_MAX) return 'Notes must be 2000 characters or fewer.'
  return null
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_KEY_PATTERN = /^(\d{2}):(\d{2})$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toMillis(instant: string | number | Date): number {
  if (instant instanceof Date) return instant.getTime()
  if (typeof instant === 'number') return instant
  return Date.parse(instant)
}

interface ClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(utcMillis: number, timeZone: string): ClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis))
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

// Offset in milliseconds to ADD to a UTC instant to reach the local wall time.
function utcOffsetMs(utcMillis: number, timeZone: string): number {
  const base = Math.floor(utcMillis / 1000) * 1000
  const clock = wallClock(base, timeZone)
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - base
}

export function tzDateKey(instant: string | number | Date, timeZone: string): string {
  const clock = wallClock(toMillis(instant), timeZone)
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`
}

export function tzTimeKey(instant: string | number | Date, timeZone: string): string {
  const clock = wallClock(toMillis(instant), timeZone)
  return `${pad(clock.hour)}:${pad(clock.minute)}`
}

export function tzToday(timeZone: string): string {
  return tzDateKey(Date.now(), timeZone)
}

export function offsetDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) return dateKey
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  )
  return shifted.toISOString().slice(0, 10)
}

/**
 * Converts a wall-clock date + time in `timeZone` to a UTC ISO instant.
 * Two passes settle the DST offset; the round-trip check rejects invalid
 * calendar dates (e.g. 2026-02-31) and wall times skipped by DST.
 */
export function wallTimeToUtcIso(dateKey: string, time: string, timeZone: string): string | null {
  const dateMatch = DATE_KEY_PATTERN.exec(dateKey)
  const timeMatch = TIME_KEY_PATTERN.exec(time)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const guess = wallAsUtc - utcOffsetMs(wallAsUtc, timeZone)
  const settled = wallAsUtc - utcOffsetMs(guess, timeZone)

  const check = wallClock(settled, timeZone)
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    return null
  }
  return new Date(settled).toISOString()
}

export function dayBoundsUtc(
  dateKey: string,
  timeZone: string,
): { startIso: string; endIso: string } | null {
  const startIso = wallTimeToUtcIso(dateKey, '00:00', timeZone)
  const endIso = wallTimeToUtcIso(offsetDateKey(dateKey, 1), '00:00', timeZone)
  if (!startIso || !endIso) return null
  return { startIso, endIso }
}

export function reservationEndIso(startsAtIso: string, durationMinutes: number): string {
  return new Date(Date.parse(startsAtIso) + durationMinutes * 60_000).toISOString()
}

// Half-open interval overlap: back-to-back windows (end === start) do not conflict.
export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd)
}
