import { supabase } from './supabase'
import type { RestaurantTable } from '../types/database'

// Must stay in step with the column checks in
// supabase/migrations/20261008000003_tables_reservations.sql.
export const NAME_MAX = 80
export const ZONE_MAX = 60
export const CAPACITY_MIN = 1
export const CAPACITY_MAX = 100

export interface TableInput {
  name: string
  zone: string
  capacity: number
  sort_order: number
  is_active: boolean
}

export async function listTables(
  branchId: string,
  includeInactive: boolean,
): Promise<{ data: RestaurantTable[] | null; error: string | null }> {
  let query = supabase
    .schema('app')
    .from('restaurant_tables')
    .select('*')
    .eq('branch_id', branchId)
    .order('zone')
    .order('sort_order')
    .order('name')
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function saveTable(
  organizationId: string,
  branchId: string,
  tableId: string | null,
  input: TableInput,
): Promise<{ error: string | null }> {
  const { error } = tableId
    ? await supabase.schema('app').from('restaurant_tables').update(input).eq('id', tableId)
    : await supabase
        .schema('app')
        .from('restaurant_tables')
        .insert({ organization_id: organizationId, branch_id: branchId, ...input })

  if (!error) return { error: null }
  if (error.code === '23505') {
    return { error: 'An active table with this name already exists in this branch.' }
  }
  return { error: error.message }
}

export async function setTableActive(
  tableId: string,
  isActive: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('restaurant_tables')
    .update({ is_active: isActive })
    .eq('id', tableId)
  return { error: error ? error.message : null }
}

export function validateTableName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Name is required.'
  if (trimmed.length > NAME_MAX) return 'Name must be 80 characters or fewer.'
  return null
}

export function validateZone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Zone is required.'
  if (trimmed.length > ZONE_MAX) return 'Zone must be 60 characters or fewer.'
  return null
}

const CAPACITY_PATTERN = /^\d+$/

export function parseCapacity(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Capacity is required.' }
  if (!CAPACITY_PATTERN.test(trimmed)) {
    return { value: null, error: 'Capacity must be a whole number.' }
  }
  const value = Number.parseInt(trimmed, 10)
  if (value < CAPACITY_MIN || value > CAPACITY_MAX) {
    return { value: null, error: 'Capacity must be between 1 and 100.' }
  }
  return { value, error: null }
}
