-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20261008000003 — Tables & reservations (Phase 2)
-- Restaurant floor plan and table reservations. Purely additive:
--   * app.restaurant_tables — branch-scoped dining tables. No stored
--     day-status; availability is derived from reservations (walk-ins and
--     occupancy tracking arrive with Orders & Kitchen).
--   * app.table_reservations — guest reservations with a six-state workflow.
--     Overlapping ACTIVE reservations (pending/confirmed/seated) on the same
--     table are impossible: a GiST exclusion constraint (btree_gist supplies
--     the uuid equality leg) rejects them at write time with SQLSTATE 23P01.
--     ends_at is derived by a BEFORE trigger — a stored generated column is
--     impossible because timestamptz + interval is STABLE, not IMMUTABLE.
--   * Composite foreign keys pin a reservation to a table of the same branch
--     AND organization, and a table to a branch of the same organization:
--     cross-tenant references are structurally impossible.
--   * Five permission keys (tables.manage; reservations.view/create/edit/
--     cancel) added to the catalog, backfilled onto the system roles of every
--     existing organization, and seeded by the replaced bootstrap_organization.
--   * app.audit_row_change() — SHARED CHANGE, opt-in branch attribution via a
--     second trigger argument ('branch'). The menu triggers are untouched and
--     pass one argument, so menu audit rows keep branch_id NULL by
--     construction; the two new triggers opt in and record the row's branch.
--     Signature and ACLs are unchanged (CREATE OR REPLACE preserves both).
-- Read model: floor plan is member-readable within accessible branches;
-- reservations additionally require reservations.view. No delete surface.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── btree_gist: uuid equality support inside the GiST exclusion constraint ──
create extension if not exists btree_gist with schema extensions;

-- ── Branch composite key: target for branch-scoped composite foreign keys ───
alter table app.branches
  add constraint branches_id_org_key unique (id, organization_id);

-- ── Restaurant tables (floor plan) ─────────────────────────────────────────
create table app.restaurant_tables (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  branch_id       uuid not null,
  name            text not null,
  zone            text not null default 'Main',
  capacity        integer not null default 2,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint restaurant_tables_branch_fk
    foreign key (branch_id, organization_id)
    references app.branches (id, organization_id) on delete restrict,
  constraint restaurant_tables_id_branch_org_key unique (id, branch_id, organization_id),
  constraint restaurant_tables_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint restaurant_tables_zone_length check (char_length(btrim(zone)) between 1 and 60),
  constraint restaurant_tables_capacity_bounds check (capacity between 1 and 100)
);

-- The composite foreign key pins branch_id to a branch of the SAME
-- organization, and the unique (id, branch_id, organization_id) constraint
-- above is the composite foreign-key target for app.table_reservations.
create index restaurant_tables_branch_idx on app.restaurant_tables (organization_id, branch_id);

-- Table names are unique among ACTIVE tables of the same branch only, so a
-- deactivated table's name can be reused. lower(btrim(...)) blocks
-- case/whitespace look-alikes.
create unique index restaurant_tables_branch_name_active_idx
  on app.restaurant_tables (branch_id, lower(btrim(name)))
  where is_active;

create trigger restaurant_tables_set_updated_at
  before update on app.restaurant_tables
  for each row execute function app.set_updated_at();

create trigger restaurant_tables_audit_change
  after insert or update on app.restaurant_tables
  for each row execute function app.audit_row_change('tables.table', 'branch');

comment on table app.restaurant_tables is 'Branch-scoped dining table (floor plan). Soft-deleted via is_active; availability is derived, never stored.';
comment on column app.restaurant_tables.zone is 'Free-text floor-plan grouping such as Terrace or Main hall.';
comment on column app.restaurant_tables.capacity is 'Seats per table (1-100). Reservations may exceed it; capacity is informational in v1.';

-- ── Table reservations ──────────────────────────────────────────────────────
create table app.table_reservations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references app.organizations(id) on delete restrict,
  branch_id        uuid not null,
  table_id         uuid not null,
  guest_name       text not null,
  guest_phone      text not null default '',
  party_size       integer not null,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 120,
  ends_at          timestamptz not null,
  status           text not null default 'pending',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint table_reservations_table_fk
    foreign key (table_id, branch_id, organization_id)
    references app.restaurant_tables (id, branch_id, organization_id) on delete restrict,
  constraint table_reservations_status_check
    check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  constraint table_reservations_guest_name_length check (char_length(btrim(guest_name)) between 1 and 120),
  constraint table_reservations_guest_phone_length check (char_length(guest_phone) <= 32),
  constraint table_reservations_party_size_bounds check (party_size between 1 and 100),
  constraint table_reservations_duration_bounds check (duration_minutes between 15 and 480),
  constraint table_reservations_notes_length check (char_length(notes) <= 2000),
  constraint table_reservations_ends_after_start check (ends_at > starts_at),
  -- Only resources with an active lifecycle block a table: an overlapping
  -- pending/confirmed/seated reservation is rejected, while terminal rows
  -- (completed/cancelled/no_show) never conflict. The range is half-open
  -- [starts_at, ends_at): back-to-back bookings do not conflict.
  constraint table_reservations_no_overlap
    exclude using gist (
      table_id with =,
      tstzrange(starts_at, ends_at) with &&
    ) where (status in ('pending', 'confirmed', 'seated'))
);

create index table_reservations_branch_window_idx
  on app.table_reservations (organization_id, branch_id, starts_at);
create index table_reservations_table_window_idx
  on app.table_reservations (table_id, starts_at);

comment on table app.table_reservations is 'Guest reservation for a dining table. Overlaps among pending/confirmed/seated rows are prevented per table by an exclusion constraint.';
comment on column app.table_reservations.ends_at is 'Derived from starts_at + duration_minutes by app.set_reservation_window; never client-supplied.';
comment on column app.table_reservations.status is 'pending -> confirmed -> seated -> completed, plus cancelled/no_show. Transitions are validated by app.guard_reservation_status.';

-- ── Reservation window + status transition guards ───────────────────────────
-- Pure computation: overwrites any client-supplied ends_at so the window is
-- always consistent with starts_at + duration_minutes. Runs before the
-- exclusion constraint is evaluated.
create or replace function app.set_reservation_window()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end;
$$;

-- Lifecycle: INSERT may only open at pending/confirmed. UPDATEs that leave
-- the status untouched pass (metadata edits, including on terminal rows);
-- status changes must follow the transition table, and moving INTO cancelled
-- additionally requires reservations.cancel (staff hold edit but not cancel).
create or replace function app.guard_reservation_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'confirmed') then
      raise exception 'A reservation cannot be created with status "%".', new.status;
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'pending'   and new.status in ('confirmed', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('seated', 'cancelled', 'no_show'))
    or (old.status = 'seated'    and new.status = 'completed')
  ) then
    raise exception 'Invalid reservation transition from "%" to "%".', old.status, new.status;
  end if;

  if new.status = 'cancelled' and not app.user_has_permission('reservations.cancel') then
    raise exception 'Cancelling a reservation requires the reservations.cancel permission.';
  end if;

  return new;
end;
$$;

create trigger table_reservations_set_window
  before insert or update on app.table_reservations
  for each row execute function app.set_reservation_window();

create trigger table_reservations_guard_status
  before insert or update on app.table_reservations
  for each row execute function app.guard_reservation_status();

create trigger table_reservations_set_updated_at
  before update on app.table_reservations
  for each row execute function app.set_updated_at();

create trigger table_reservations_audit_change
  after insert or update on app.table_reservations
  for each row execute function app.audit_row_change('reservations.reservation', 'branch');

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table app.restaurant_tables enable row level security;
alter table app.table_reservations enable row level security;

-- Floor plan: every organization member with access to the branch can read;
-- tables.manage holders write. There is deliberately no DELETE privilege and
-- no delete policy: deactivation (is_active = false) is the only removal path.
create policy restaurant_tables_select_member
  on app.restaurant_tables for select to authenticated
  using (app.user_can_access_branch(branch_id));

create policy restaurant_tables_insert_managed
  on app.restaurant_tables for insert to authenticated
  with check (app.user_has_permission('tables.manage') and app.user_can_access_branch(branch_id));

create policy restaurant_tables_update_managed
  on app.restaurant_tables for update to authenticated
  using (app.user_has_permission('tables.manage') and app.user_can_access_branch(branch_id))
  with check (app.user_has_permission('tables.manage') and app.user_can_access_branch(branch_id));

-- Reservations: reservations.view to read, reservations.create to insert,
-- edit or cancel to update — always within a branch the user can access.
-- UPDATE carries both USING and WITH CHECK so a row can neither be edited
-- into nor out of another branch/organization.
create policy table_reservations_select_viewer
  on app.table_reservations for select to authenticated
  using (app.user_has_permission('reservations.view') and app.user_can_access_branch(branch_id));

create policy table_reservations_insert_creator
  on app.table_reservations for insert to authenticated
  with check (app.user_has_permission('reservations.create') and app.user_can_access_branch(branch_id));

create policy table_reservations_update_editor
  on app.table_reservations for update to authenticated
  using (
    (app.user_has_permission('reservations.edit') or app.user_has_permission('reservations.cancel'))
    and app.user_can_access_branch(branch_id)
  )
  with check (
    (app.user_has_permission('reservations.edit') or app.user_has_permission('reservations.cancel'))
    and app.user_can_access_branch(branch_id)
  );

-- ── Privileges ──────────────────────────────────────────────────────────────
grant select, insert, update on app.restaurant_tables to authenticated;
grant select, insert, update on app.table_reservations to authenticated;

-- ── Permission catalog: tables & reservations ───────────────────────────────
insert into app.permissions (key, department, description) values
  ('tables.manage',       'tables',       'Manage restaurant tables and the floor plan'),
  ('reservations.view',   'reservations', 'View table reservations'),
  ('reservations.create', 'reservations', 'Create table reservations'),
  ('reservations.edit',   'reservations', 'Edit table reservations'),
  ('reservations.cancel', 'reservations', 'Cancel table reservations')
on conflict (key) do nothing;

-- ── System-role backfill for existing organizations ────────────────────────
-- System roles were seeded from the catalog as it existed at bootstrap time,
-- so organizations created before this migration (including production) do
-- not auto-inherit new keys. owner/administrator mirror the bootstrap rule
-- dynamically (every key, minus org.manage for administrator); manager and
-- staff receive their explicit Phase 2 keys.
insert into app.role_permissions (role_id, permission_key)
select r.id, p.key
from app.roles r
cross join app.permissions p
where r.is_system
  and (r.name = 'owner' or (r.name = 'administrator' and p.key <> 'org.manage'))
on conflict do nothing;

insert into app.role_permissions (role_id, permission_key)
select r.id, v.key
from app.roles r
cross join (values
  ('tables.manage'),
  ('reservations.view'),
  ('reservations.create'),
  ('reservations.edit'),
  ('reservations.cancel')
) as v(key)
where r.is_system and r.name = 'manager'
on conflict do nothing;

insert into app.role_permissions (role_id, permission_key)
select r.id, v.key
from app.roles r
cross join (values
  ('reservations.view'),
  ('reservations.create'),
  ('reservations.edit')
) as v(key)
where r.is_system and r.name = 'staff'
on conflict do nothing;

-- ── bootstrap_organization: seed the new keys for NEW organizations ────────
-- Verbatim re-declaration of app.bootstrap_organization from migration
-- 20260929000001 (including the app.bootstrap_org_id attach-guard fix) with
-- the five Phase 2 keys added to the manager and staff system-role grants.
create or replace function app.bootstrap_organization(
  p_org_name   text,
  p_org_slug   text,
  p_branch_name text,
  p_branch_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id    uuid;
  v_branch_id uuid;
  v_role_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if exists (select 1 from app.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'This user already belongs to an organization.';
  end if;

  if exists (select 1 from app.organizations where slug = p_org_slug) then
    raise exception 'Organization slug "%" is already taken.', p_org_slug;
  end if;

  insert into app.organizations (slug, name)
  values (p_org_slug, p_org_name)
  returning id into v_org_id;

  insert into app.branches (organization_id, code, name)
  values (v_org_id, p_branch_code, p_branch_name)
  returning id into v_branch_id;

  -- Exempt this transaction's attach from the profile org-move guard.
  perform set_config('app.bootstrap_org_id', v_org_id::text, true);

  update app.profiles set organization_id = v_org_id where id = auth.uid();

  -- system role: owner (every permission)
  insert into app.roles (organization_id, name, description, is_system)
  values (v_org_id, 'owner', 'Full access including organization administration.', true)
  returning id into v_role_id;

  insert into app.role_permissions (role_id, permission_key)
  select v_role_id, key from app.permissions;

  -- system role: administrator (everything except org.manage)
  insert into app.roles (organization_id, name, description, is_system)
  values (v_org_id, 'administrator', 'Full operational access; cannot change the organization record.', true)
  returning id into v_role_id;

  insert into app.role_permissions (role_id, permission_key)
  select v_role_id, key from app.permissions where key <> 'org.manage';

  -- system role: manager (operations without financial destruction / payroll approval)
  insert into app.roles (organization_id, name, description, is_system)
  values (v_org_id, 'manager', 'Operations across departments; refunds, accounting reversals and payroll approval excluded.', true)
  returning id into v_role_id;

  insert into app.role_permissions (role_id, permission_key) values
    (v_role_id, 'dashboard.view'),
    (v_role_id, 'reports.view'),
    (v_role_id, 'branch.view_all'),
    (v_role_id, 'users.view'),
    (v_role_id, 'menu.manage'),
    (v_role_id, 'tables.manage'),
    (v_role_id, 'reservations.view'),
    (v_role_id, 'reservations.create'),
    (v_role_id, 'reservations.edit'),
    (v_role_id, 'reservations.cancel'),
    (v_role_id, 'pos.view'),
    (v_role_id, 'pos.create'),
    (v_role_id, 'pos.edit'),
    (v_role_id, 'pos.discount'),
    (v_role_id, 'pos.void'),
    (v_role_id, 'kitchen.view'),
    (v_role_id, 'kitchen.manage'),
    (v_role_id, 'rooms.view'),
    (v_role_id, 'rooms.manage'),
    (v_role_id, 'housekeeping.view'),
    (v_role_id, 'housekeeping.manage'),
    (v_role_id, 'bookings.view'),
    (v_role_id, 'bookings.create'),
    (v_role_id, 'bookings.edit'),
    (v_role_id, 'bookings.cancel'),
    (v_role_id, 'folio.view'),
    (v_role_id, 'folio.post'),
    (v_role_id, 'folio.manage'),
    (v_role_id, 'inventory.view'),
    (v_role_id, 'inventory.manage'),
    (v_role_id, 'inventory.adjust'),
    (v_role_id, 'purchasing.view'),
    (v_role_id, 'purchasing.create'),
    (v_role_id, 'suppliers.manage'),
    (v_role_id, 'accounting.view'),
    (v_role_id, 'payments.view'),
    (v_role_id, 'hr.view'),
    (v_role_id, 'employees.manage'),
    (v_role_id, 'payroll.view'),
    (v_role_id, 'assets.view'),
    (v_role_id, 'assets.manage'),
    (v_role_id, 'maintenance.view'),
    (v_role_id, 'maintenance.manage'),
    (v_role_id, 'approvals.view');

  -- system role: staff (front line)
  insert into app.roles (organization_id, name, description, is_system)
  values (v_org_id, 'staff', 'Front-line access: POS, kitchen display, room and booking visibility.', true)
  returning id into v_role_id;

  insert into app.role_permissions (role_id, permission_key) values
    (v_role_id, 'dashboard.view'),
    (v_role_id, 'pos.view'),
    (v_role_id, 'pos.create'),
    (v_role_id, 'pos.edit'),
    (v_role_id, 'kitchen.view'),
    (v_role_id, 'reservations.view'),
    (v_role_id, 'reservations.create'),
    (v_role_id, 'reservations.edit'),
    (v_role_id, 'rooms.view'),
    (v_role_id, 'housekeeping.view'),
    (v_role_id, 'bookings.view'),
    (v_role_id, 'folio.view'),
    (v_role_id, 'inventory.view');

  -- bootstrapper becomes owner
  select id into v_role_id from app.roles where organization_id = v_org_id and name = 'owner';
  insert into app.user_roles (user_id, role_id) values (auth.uid(), v_role_id);

  perform app.log_audit(
    'organization.bootstrap',
    'organization',
    v_org_id::text,
    null,
    null,
    jsonb_build_object('name', p_org_name, 'slug', p_org_slug, 'branch_code', p_branch_code)
  );

  return v_org_id;
end;
$$;

-- ── audit_row_change: opt-in branch attribution (SHARED CHANGE) ────────────
-- CREATE OR REPLACE with the SAME signature (): the menu triggers call this
-- with a single argument, so tg_argv[1] is NULL for them and v_branch_id
-- stays NULL — menu audit rows keep branch_id NULL by construction, and
-- new.branch_id is never even evaluated for tables without that column.
-- Only triggers created as audit_row_change('<entity>', 'branch') record a
-- branch. Ownership and ACLs (revoked from public, granted to authenticated
-- in 20261008000002) are preserved by CREATE OR REPLACE.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action    text;
  v_entity_id text;
  v_before    jsonb;
  v_after     jsonb;
  v_branch_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action    := 'create';
    v_entity_id := new.id::text;
    v_after     := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action    := 'update';
    v_entity_id := new.id::text;
    v_before    := to_jsonb(old);
    v_after     := to_jsonb(new);
  else
    v_action    := 'delete';
    v_entity_id := old.id::text;
    v_before    := to_jsonb(old);
  end if;

  -- Opt-in gate: without the literal second argument 'branch' this block is
  -- skipped in full and the audit row is written with branch_id NULL.
  if tg_argv[1] = 'branch' then
    if tg_op = 'DELETE' then
      v_branch_id := old.branch_id;
    else
      v_branch_id := new.branch_id;
    end if;
  end if;

  perform app.log_audit(
    v_action,
    coalesce(tg_argv[0], tg_table_name),
    v_entity_id,
    v_branch_id,
    v_before,
    v_after,
    jsonb_build_object('table', tg_table_name)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ── Function privileges for the new trigger functions ───────────────────────
-- (app.audit_row_change keeps the ACL granted in 20261008000002.)
revoke execute on function app.set_reservation_window() from public;
revoke execute on function app.guard_reservation_status() from public;
grant execute on function app.set_reservation_window() to authenticated;
grant execute on function app.guard_reservation_status() to authenticated;

notify pgrst, 'reload schema cache';
