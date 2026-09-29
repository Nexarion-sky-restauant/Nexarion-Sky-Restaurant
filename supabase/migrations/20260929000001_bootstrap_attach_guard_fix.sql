-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20260929000001 — Bootstrap profile-attach guard fix
-- Phase 2 (Authentication & permissions)
-- ───────────────────────────────────────────────────────────────────────────
-- app.bootstrap_organization attaches the caller's profile to the organization
-- it just created, but that UPDATE fired profiles_guard_update, which requires
-- users.manage — a permission the bootstrapper cannot hold yet (roles are
-- created later in the same function). The guard remains load-bearing because
-- clients may UPDATE their own profile row, so the exemption is scoped to the
-- bootstrap transaction alone via a transaction-local GUC that API clients
-- cannot set (set_config is not exposed through PostgREST).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Set only by app.bootstrap_organization, only for its own transaction.
  if current_setting('app.bootstrap_org_id', true) = new.organization_id::text then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     and not app.user_has_permission('users.manage') then
    raise exception 'Changing a profile''s organization requires the users.manage permission.';
  end if;
  return new;
end;
$$;

-- Verbatim re-declaration of app.bootstrap_organization from migration 00003
-- with one added line: the transaction-local flag consumed by the guard above.
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
