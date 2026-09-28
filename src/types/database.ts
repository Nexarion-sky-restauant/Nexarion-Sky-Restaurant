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
