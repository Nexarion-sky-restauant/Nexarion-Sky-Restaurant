// Hand-written types for the Phase 1+2 foundation schema (schema `app`).
// Regenerate with `supabase gen types typescript` once the CLI is available in
// CI if tighter typing is wanted; these cover everything the foundation UI uses.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// Row types are `type` aliases (not interfaces): supabase-js requires rows to
// extend Record<string, unknown>, and interfaces lack the implicit index
// signature that makes that assignability check pass.
export type Organization = {
  id: string
  slug: string
  name: string
  default_currency: string
  timezone: string
  settings: Json
  created_at: string
  updated_at: string
}

export type Branch = {
  id: string
  organization_id: string
  code: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Profile = {
  id: string
  organization_id: string | null
  full_name: string
  phone: string | null
  avatar_path: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AuditLogEntry = {
  id: number
  organization_id: string | null
  branch_id: string | null
  actor_id: string | null
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_data: Json | null
  after_data: Json | null
  metadata: Json
  ip_address: string | null
  created_at: string
}

export type MenuCategory = {
  id: string
  organization_id: string
  name: string
  description: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MenuItem = {
  id: string
  organization_id: string
  category_id: string
  name: string
  description: string
  price: number
  image_path: string | null
  is_available: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type RestaurantTable = {
  id: string
  organization_id: string
  branch_id: string
  name: string
  zone: string
  capacity: number
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type TableReservation = {
  id: string
  organization_id: string
  branch_id: string
  table_id: string
  guest_name: string
  guest_phone: string
  party_size: number
  starts_at: string
  duration_minutes: number
  ends_at: string
  status: ReservationStatus
  notes: string
  created_at: string
  updated_at: string
}

export interface AccessPayload {
  profile: Profile | null
  organization: Organization | null
  permissions: string[]
  branch_ids: string[]
}

export interface Database {
  app: {
    Tables: {
      organizations: {
        Row: Organization
        Insert: Omit<Organization, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<Organization, 'id'>>
        Relationships: []
      }
      branches: {
        Row: Branch
        Insert: Omit<Branch, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<Branch, 'id' | 'organization_id'>>
        Relationships: []
      }
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id'>>
        Relationships: []
      }
      audit_log: {
        Row: AuditLogEntry
        Insert: never
        Update: never
        Relationships: []
      }
      menu_categories: {
        Row: MenuCategory
        Insert: Omit<MenuCategory, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<MenuCategory, 'id' | 'organization_id'>>
        Relationships: []
      }
      menu_items: {
        Row: MenuItem
        Insert: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<MenuItem, 'id' | 'organization_id'>>
        Relationships: []
      }
      restaurant_tables: {
        Row: RestaurantTable
        Insert: Omit<RestaurantTable, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<RestaurantTable, 'id' | 'organization_id' | 'branch_id'>>
        Relationships: []
      }
      table_reservations: {
        Row: TableReservation
        // ends_at is derived server-side from starts_at + duration_minutes by
        // app.set_reservation_window, so clients never supply it.
        Insert: Omit<TableReservation, 'id' | 'created_at' | 'updated_at' | 'ends_at'> & {
          id?: string
        }
        Update: Partial<Omit<TableReservation, 'id' | 'organization_id' | 'branch_id' | 'ends_at'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_my_access: { Args: Record<PropertyKey, never>; Returns: Json }
      bootstrap_organization: {
        Args: {
          p_org_name: string
          p_org_slug: string
          p_branch_name: string
          p_branch_code: string
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
