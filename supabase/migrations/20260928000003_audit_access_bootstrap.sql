-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00003 — Audit trail, auth integration, access RPC, bootstrap
-- Phase 2 (Authentication & permissions)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Audit log ───────────────────────────────────────────────────────────────
-- Append-only. Later phases call app.log_audit(...) for sensitive events:
-- approvals, refunds, voids, discounts, stock adjustments, payroll actions,
-- permission changes and all financial record reversals.
create table app.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid references app.organizations(id) on delete restrict,
  branch_id       uuid references app.branches(id) on delete set null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_email     text,
  action          text not null,              -- 'create' | 'update' | 'void' | 'refund' | 'approve' | 'organization.bootstrap' | ...
  entity_type     text not null,              -- 'organization' | 'pos.order' | 'inventory.adjustment' | ...
  entity_id       text,
  before_data     jsonb,
  after_data      jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index audit_log_organization_created_idx on app.audit_log (organization_id, created_at desc);
create index audit_log_entity_idx on app.audit_log (entity_type, entity_id);

comment on table app.audit_log is 'Append-only audit trail. No UPDATE/DELETE grants exist on this table.';

alter table app.audit_log enable row level security;

create policy audit_log_select_viewer
  on app.audit_log for select to authenticated
  using (
    app.user_has_permission('audit.view')
    and app.is_org_member(organization_id)
  );

-- Direct inserts are allowed but must be self-attributed and org-scoped;
-- the app normally writes via app.log_audit which stamps these server-side.
create policy audit_log_insert_self
  on app.audit_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (organization_id is null or app.is_org_member(organization_id))
  );

grant select, insert on app.audit_log to authenticated;

-- Server-side audit writer: fills actor/org/email from the auth context.
create or replace function app.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_branch_id   uuid default null,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into app.audit_log (
    organization_id, branch_id, actor_id, actor_email,
    action, entity_type, entity_id, before_data, after_data, metadata
  )
  values (
    (select organization_id from app.profiles where id = auth.uid()),
    p_branch_id,
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_metadata
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Auth integration ────────────────────────────────────────────────────────
-- Every new auth.users row gets a profile automatically.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Profiles guard: without users.manage you cannot move a profile to another
-- organization or flip the active flag on anyone but yourself... (is_active
-- changes by managers are allowed; org moves are the privileged part).
create or replace function app.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     and not app.user_has_permission('users.manage') then
    raise exception 'Changing a profile''s organization requires the users.manage permission.';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update
  before update on app.profiles
  for each row execute function app.guard_profile_update();

-- ── Single-round-trip access payload for the frontend ───────────────────────
create or replace function app.get_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile   jsonb;
  v_perms     jsonb;
  v_branches  jsonb;
  v_org       jsonb;
begin
  select to_jsonb(p) into v_profile from app.profiles p where p.id = auth.uid();

  select to_jsonb(o) into v_org
  from app.organizations o
  where o.id = (select organization_id from app.profiles where id = auth.uid());

  select coalesce(jsonb_agg(rp.permission_key), '[]'::jsonb) into v_perms
  from app.user_roles ur
  join app.roles r          on r.id = ur.role_id
  join app.role_permissions rp on rp.role_id = r.id
  join app.profiles p       on p.id = ur.user_id
  where ur.user_id = auth.uid()
    and p.organization_id = r.organization_id;

  select coalesce(jsonb_agg(ub.branch_id), '[]'::jsonb) into v_branches
  from app.user_branches ub
  where ub.user_id = auth.uid();

  return jsonb_build_object(
    'profile',   coalesce(v_profile, 'null'::jsonb),
    'organization', coalesce(v_org, 'null'::jsonb),
    'permissions', v_perms,
    'branch_ids',  v_branches
  );
end;
$$;

-- ── Organization bootstrap ─────────────────────────────────────────────────
-- First-run flow: a freshly signed-up user (no organization) calls this once
-- to create their business, its first branch, and the four system roles, and
-- to become 'owner'. Invite-based joining of additional users is a later phase.
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

-- ── Function privileges: nothing public, everything the app needs ───────────
revoke execute on all functions in schema app from public;

grant execute on function app.set_updated_at() to authenticated;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.user_has_permission(text) to authenticated;
grant execute on function app.user_can_access_branch(uuid) to authenticated;
grant execute on function app.get_my_access() to authenticated;
grant execute on function app.log_audit(text, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function app.bootstrap_organization(text, text, text, text) to authenticated;
grant execute on function app.handle_new_user() to authenticated;
grant execute on function app.guard_profile_update() to authenticated;
