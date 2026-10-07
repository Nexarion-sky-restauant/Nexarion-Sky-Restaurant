import { supabase } from './supabase'
import type { MenuCategory, MenuItem } from '../types/database'

// Must stay in step with the numeric(12,2) column and its checks in
// supabase/migrations/20261008000002_menu_management.sql.
export const PRICE_MAX = 9999999999.99
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024

const SIGNED_URL_TTL = 3600
const BUCKET = 'menu-images'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface MenuData {
  categories: MenuCategory[]
  items: MenuItem[]
}

export interface CategoryInput {
  name: string
  description: string
  sort_order: number
  is_active: boolean
}

export interface ItemInput {
  category_id: string
  name: string
  description: string
  price: number
  image_path: string | null
  is_available: boolean
  is_active: boolean
}

export async function listMenu(
  includeInactive: boolean,
): Promise<{ data: MenuData | null; error: string | null }> {
  const categoriesQuery = supabase.schema('app').from('menu_categories').select('*')
  const itemsQuery = supabase.schema('app').from('menu_items').select('*')

  const [categoriesResult, itemsResult] = await Promise.all([
    includeInactive
      ? categoriesQuery.order('sort_order').order('name')
      : categoriesQuery.order('sort_order').order('name').eq('is_active', true),
    includeInactive ? itemsQuery.order('name') : itemsQuery.order('name').eq('is_active', true),
  ])

  if (categoriesResult.error || itemsResult.error) {
    const message =
      categoriesResult.error?.message ?? itemsResult.error?.message ?? 'Could not load the menu.'
    return { data: null, error: message }
  }

  return {
    data: { categories: categoriesResult.data ?? [], items: itemsResult.data ?? [] },
    error: null,
  }
}

export async function saveCategory(
  organizationId: string,
  categoryId: string | null,
  input: CategoryInput,
): Promise<{ error: string | null }> {
  const { error } = categoryId
    ? await supabase.schema('app').from('menu_categories').update(input).eq('id', categoryId)
    : await supabase.schema('app').from('menu_categories').insert({ organization_id: organizationId, ...input })
  return { error: error ? error.message : null }
}

export async function saveItem(
  organizationId: string,
  itemId: string | null,
  input: ItemInput,
): Promise<{ error: string | null }> {
  const { error } = itemId
    ? await supabase.schema('app').from('menu_items').update(input).eq('id', itemId)
    : await supabase.schema('app').from('menu_items').insert({ organization_id: organizationId, ...input })
  return { error: error ? error.message : null }
}

export async function setItemAvailability(
  itemId: string,
  isAvailable: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .schema('app')
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId)
  return { error: error ? error.message : null }
}

export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Image must be a JPEG, PNG or WebP file.'
  if (file.size > IMAGE_MAX_BYTES) return 'Image must be 2 MB or smaller.'
  return null
}

function imageExtension(file: File): string {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

export function menuImagePath(organizationId: string, file: File): string {
  return `${organizationId}/${crypto.randomUUID()}.${imageExtension(file)}`
}

export async function uploadMenuImage(
  organizationId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> {
  const invalid = validateImageFile(file)
  if (invalid) return { path: null, error: invalid }

  const path = menuImagePath(organizationId, file)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  return { path: error ? null : path, error: error ? error.message : null }
}

export async function signedImageUrls(
  paths: string[],
): Promise<{ urls: Record<string, string>; error: string | null }> {
  if (paths.length === 0) return { urls: {}, error: null }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
  if (error) return { urls: {}, error: error.message }

  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return { urls, error: null }
}

export function validateName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Name is required.'
  if (trimmed.length > 120) return 'Name must be 120 characters or fewer.'
  return null
}

export function validateDescription(raw: string): string | null {
  if (raw.trim().length > 2000) return 'Description must be 2000 characters or fewer.'
  return null
}

const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/

export function parsePrice(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Price is required.' }
  if (!PRICE_PATTERN.test(trimmed)) {
    return { value: null, error: 'Enter a price with up to 2 decimal places.' }
  }
  const value = Number.parseFloat(trimmed)
  if (!(value > 0)) return { value: null, error: 'Price must be greater than zero.' }
  if (value > PRICE_MAX) return { value: null, error: 'Price is too large.' }
  return { value, error: null }
}

export function formatKes(amount: number): string {
  return `KES ${amount.toFixed(2)}`
}
