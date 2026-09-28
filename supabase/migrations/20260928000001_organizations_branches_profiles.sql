-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00001 — Foundation: schema, organizations, branches, profiles
-- Phase 1 (Architecture & database) + Phase 2 (Authentication & permissions)
-- ═══════════════════════════════════════════════════════════════════════════
-- Conventions established here and expected of ALL later migrations:
--   * All application tables live in schema `app`.
--   * Row Level Security is enabled on every table; no table is world-readable.
--   * Cross-table access checks go through `app.*` security-definer helper
--     functions with `set search_path = ''` (no search-path hijacking).
--   * Users are created by Supabase Auth; `app.profiles` is the application
--     identity row, linked 1:1 to auth.users.
--
-- This migration intentionally creates ONLY the org-membership SELECT policies.
-- Every policy that needs permission checks (org.manage, users.manage, ...)
-- is created in migration 00002 after the permission helpers exist.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists app;

-- Application schema is reachable by authenticated roles only.
revoke usage on schema app from public;
revoke all on schema app from anon;
grant usage on schema app to authenticated;

-- Expose schema `app` through the Supabase API (PostgREST) so the frontend can
-- query it with supabase-js via .schema('app') and call app.* RPCs. Equivalent
-- to Dashboard → Settings → API → Exposed schemas; kept here so every
-- environment (dev / staging / prod) gets it automatically with the migration.
alter role authenticator set pgrst.db_schemas = 'public, app';
notify pgrst, 'reload schema cache';

-- ── Shared trigger helper ────────────────────────────────────────────────────
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Organizations (tenants) ────────────────────────────────────────────────
-- ONE BUSINESS → ONE ORGANIZATION. Every other table hangs off organization_id.
create table app.organizations (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  default_currency char(3) not null default 'KES',
  timezone         text not null default 'Africa/Nairobi',
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on app.organizations
  for each row execute function app.set_updated_at();

comment on table app.organizations is 'Business tenant. One Nexarion Sky Restaurant business = one row.';
comment on column app.organizations.default_currency is 'ISO 4217 currency code used by accounting and POS.';

-- ── Branches ────────────────────────────────────────────────────────────────
create table app.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  code            text not null,
  name            text not null,
  address         text,
  phone           text,
  email           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create index branches_organization_id_idx on app.branches (organization_id);

create trigger branches_set_updated_at
  before update on app.branches
  for each row execute function app.set_updated_at();

comment on table app.branches is 'Physical locations (restaurant floor, hotel wing). Basis for branch-level data scoping.';

-- ── Profiles (1:1 with auth.users) ─────────────────────────────────────────
create table app.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references app.organizations(id) on delete restrict, -- null until bootstrap/invite
  full_name       text not null default '',
  phone           text,
  avatar_path     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index profiles_organization_id_idx on app.profiles (organization_id);

create trigger profiles_set_updated_at
  before update on app.profiles
  for each row execute function app.set_updated_at();

comment on table app.profiles is 'Application identity for each auth user. organization_id is assigned by bootstrap or an org admin.';

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table app.organizations enable row level security;
alter table app.branches enable row level security;
alter table app.profiles enable row level security;

-- SELECT policies: plain org membership, no permission helpers required yet.
-- organizations: members can read their own org.
create policy organizations_select_member
  on app.organizations for select to authenticated
  using (exists (
    select 1 from app.profiles p
    where p.id = auth.uid() and p.organization_id = organizations.id
  ));

-- branches: readable by members of the owning org.
create policy branches_select_member
  on app.branches for select to authenticated
  using (exists (
    select 1 from app.profiles p
    where p.id = auth.uid() and p.organization_id = branches.organization_id
  ));

-- profiles: everyone can read their own profile row. Reading OTHER profiles
-- requires users.view and is added in migration 00002.
create policy profiles_select_own
  on app.profiles for select to authenticated
  using (id = auth.uid());

-- ── Table grants (RLS does the filtering; no DELETE grants at foundation) ───
grant select on app.organizations to authenticated;
grant select on app.branches to authenticated;
grant select on app.profiles to authenticated;
-- insert on profiles happens only via app.handle_new_user (security definer);
-- update is granted in migration 00003 once the column guard trigger exists.
