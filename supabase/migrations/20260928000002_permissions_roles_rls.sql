-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00002 — Permission catalog, roles, memberships, RLS write policies
-- Phase 2 (Authentication & permissions)
-- ═══════════════════════════════════════════════════════════════════════════
-- Model:
--   app.permissions      global catalog of granular permission keys (seeded)
--   app.roles            org-scoped named roles (owner/administrator/manager/staff
--                        are created per org by bootstrap; more can be added later)
--   app.role_permissions which permissions a role grants
--   app.user_roles       which roles a user holds
--   app.user_branches    optional branch restriction (no rows = all org branches)
--
-- Authorization questions are answered ONLY by the security-definer helpers
-- app.is_org_member / app.user_has_permission / app.user_can_access_branch so
-- that RLS policies stay small and the logic has a single source of truth.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Permission catalog (global, seeded) ─────────────────────────────────────
create table app.permissions (
  key         text primary key,          -- '<department>.<action>', e.g. 'pos.void'
  department  text not null,             -- 'restaurant', 'accounting', ...
  description text not null
);

comment on table app.permissions is 'Global catalog of granular permissions. Seeded; extend in later phase migrations.';

insert into app.permissions (key, department, description) values
  -- management & reporting
  ('dashboard.view',        'management',  'View the management dashboard'),
  ('reports.view',          'management',  'View reports'),
  ('reports.export',        'management',  'Export reports and documents (PDF/CSV)'),
  ('admin.settings',        'management',  'Manage organization settings and integrations'),
  ('approvals.view',        'management',  'View pending approvals'),
  ('approvals.manage',      'management',  'Create, grant and deny approvals'),
  ('audit.view',            'management',  'View the audit trail'),
  -- organization & access administration
  ('org.manage',            'organization','Manage organization record (name, currency, settings)'),
  ('branch.manage',         'organization','Create and edit branches'),
  ('branch.view_all',       'organization','View all branches incl. restricted ones'),
  ('users.manage',          'organization','Invite, activate and deactivate users; assign org'),
  ('users.view',            'organization','View other users in the organization'),
  ('roles.manage',          'organization','Create roles and assign permissions'),
  -- restaurant / POS
  ('menu.manage',           'restaurant',  'Manage menu items and prices'),
  ('pos.view',              'restaurant',  'View POS orders'),
  ('pos.create',            'restaurant',  'Create POS orders'),
  ('pos.edit',              'restaurant',  'Edit open POS orders'),
  ('pos.discount',          'restaurant',  'Apply discounts to orders'),
  ('pos.void',              'restaurant',  'Void orders or items'),
  ('pos.refund',            'restaurant',  'Process refunds'),
  ('pos.approve_void',      'restaurant',  'Approve void requests from other staff'),
  -- kitchen
  ('kitchen.view',          'kitchen',     'View kitchen display orders'),
  ('kitchen.manage',        'kitchen',     'Manage kitchen stations and course flow'),
  -- rooms & housekeeping
  ('rooms.view',            'rooms',       'View rooms and their status'),
  ('rooms.manage',          'rooms',       'Manage room records and status'),
  ('housekeeping.view',     'rooms',       'View housekeeping tasks'),
  ('housekeeping.manage',   'rooms',       'Manage housekeeping tasks'),
  -- bookings, guests & folios
  ('bookings.view',         'bookings',    'View bookings and guests'),
  ('bookings.create',       'bookings',    'Create bookings'),
  ('bookings.edit',         'bookings',    'Edit bookings'),
  ('bookings.cancel',       'bookings',    'Cancel bookings'),
  ('folio.view',            'bookings',    'View guest folios'),
  ('folio.post',            'bookings',    'Post charges and credits to folios'),
  ('folio.manage',          'bookings',    'Manage folio settings and corrections'),
  -- inventory & stock
  ('inventory.view',        'inventory',   'View stock levels and movements'),
  ('inventory.manage',      'inventory',   'Manage stock items, units and recipes'),
  ('inventory.adjust',      'inventory',   'Record stock adjustments'),
  ('inventory.approve_adjust','inventory', 'Approve stock adjustments'),
  -- purchasing & suppliers
  ('purchasing.view',       'purchasing',  'View purchase orders and supplier invoices'),
  ('purchasing.create',     'purchasing',  'Create purchase orders'),
  ('purchasing.approve',    'purchasing',  'Approve purchase orders'),
  ('suppliers.manage',      'purchasing',  'Manage supplier records'),
  -- accounting & payments
  ('accounting.view',       'accounting',  'View ledger, journals and accounts'),
  ('accounting.post',       'accounting',  'Post journal entries'),
  ('accounting.reverse',    'accounting',  'Reverse posted journal entries'),
  ('accounting.reconcile',  'accounting',  'Reconcile accounts and payments'),
  ('payments.view',         'accounting',  'View payments (cash, card, M-Pesa)'),
  ('payments.refund',       'accounting',  'Process payment refunds'),
  ('payments.manage',       'accounting',  'Manage payment methods and integrations'),
  -- HR & payroll
  ('hr.view',               'hr',          'View employee records'),
  ('employees.manage',      'hr',          'Manage employee records'),
  ('payroll.view',          'hr',          'View payroll runs and payslips'),
  ('payroll.run',           'hr',          'Prepare payroll runs'),
  ('payroll.approve',       'hr',          'Approve and finalize payroll'),
  -- assets & maintenance
  ('assets.view',           'assets',      'View assets'),
  ('assets.manage',         'assets',      'Manage asset records'),
  ('maintenance.view',      'assets',      'View maintenance requests and schedules'),
  ('maintenance.manage',    'assets',      'Manage maintenance work');

-- ── Roles (org-scoped) ─────────────────────────────────────────────────────
create table app.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger roles_set_updated_at
  before update on app.roles
  for each row execute function app.set_updated_at();

-- ── Role permissions ───────────────────────────────────────────────────────
create table app.role_permissions (
  role_id        uuid not null references app.roles(id) on delete cascade,
  permission_key text not null references app.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ── User roles ─────────────────────────────────────────────────────────────
create table app.user_roles (
  user_id uuid not null references app.profiles(id) on delete cascade,
  role_id uuid not null references app.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- ── User branches (optional restriction set) ───────────────────────────────
-- A user with NO rows here can access every branch of their organization.
-- As soon as one row exists, the user is restricted to the listed branches.
create table app.user_branches (
  user_id   uuid not null references app.profiles(id) on delete cascade,
  branch_id uuid not null references app.branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

create index user_roles_role_id_idx on app.user_roles (role_id);
create index role_permissions_permission_key_idx on app.role_permissions (permission_key);
create index user_branches_branch_id_idx on app.user_branches (branch_id);

-- ── Authorization helpers (single source of truth for RLS) ─────────────────
-- All are SECURITY DEFINER with an empty search_path: they run as the table
-- owner, bypass RLS, and cannot be tricked by a hostile search_path.

create or replace function app.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.profiles p
    where p.id = auth.uid() and p.organization_id = p_organization_id
  );
$$;

create or replace function app.user_has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.user_roles ur
    join app.roles r          on r.id = ur.role_id
    join app.role_permissions rp on rp.role_id = r.id
    join app.profiles p       on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and rp.permission_key = p_permission_key
      and p.organization_id = r.organization_id  -- roles only count in the user's own org
  );
$$;

create or replace function app.user_can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- branch must belong to the user's organization
    exists (
      select 1
      from app.branches b
      join app.profiles p on p.organization_id = b.organization_id
      where b.id = p_branch_id and p.id = auth.uid()
    )
    and (
      -- no restriction rows => all org branches
      not exists (select 1 from app.user_branches where user_id = auth.uid())
      or exists (
        select 1 from app.user_branches
        where user_id = auth.uid() and branch_id = p_branch_id
      )
    );
$$;

-- ── RLS: roles & memberships ────────────────────────────────────────────────
alter table app.permissions enable row level security;
alter table app.roles enable row level security;
alter table app.role_permissions enable row level security;
alter table app.user_roles enable row level security;
alter table app.user_branches enable row level security;

-- Catalog is reference data: any signed-in user may read it (keys are not secret).
create policy permissions_select_authenticated
  on app.permissions for select to authenticated
  using (true);

-- roles: org members read their org's roles; roles.manage for writes.
create policy roles_select_member
  on app.roles for select to authenticated
  using (app.is_org_member(organization_id));

create policy roles_insert_managed
  on app.roles for insert to authenticated
  with check (app.user_has_permission('roles.manage'));

create policy roles_update_managed
  on app.roles for update to authenticated
  using (app.user_has_permission('roles.manage'))
  with check (app.user_has_permission('roles.manage'));

-- role_permissions: readable by org members; writable with roles.manage, and a
-- role may only receive permissions within its own org.
create policy role_permissions_select_member
  on app.role_permissions for select to authenticated
  using (exists (
    select 1 from app.roles r
    where r.id = role_permissions.role_id and app.is_org_member(r.organization_id)
  ));

create policy role_permissions_write_managed
  on app.role_permissions for all to authenticated
  using (exists (
    select 1 from app.roles r
    where r.id = role_permissions.role_id and app.user_has_permission('roles.manage')
      and app.is_org_member(r.organization_id)
  ))
  with check (exists (
    select 1 from app.roles r
    where r.id = role_permissions.role_id and app.user_has_permission('roles.manage')
      and app.is_org_member(r.organization_id)
  ));

-- user_roles: users read their own assignments; users.view+org member reads all;
-- writes require users.manage. Assignments stay inside the user's org.
create policy user_roles_select_own_or_viewer
  on app.user_roles for select to authenticated
  using (
    user_id = auth.uid()
    or (app.user_has_permission('users.view') and exists (
      select 1 from app.profiles p
      where p.id = user_roles.user_id and app.is_org_member(p.organization_id)
    ))
  );

create policy user_roles_write_managed
  on app.user_roles for all to authenticated
  using (
    app.user_has_permission('users.manage')
    and exists (
      select 1 from app.profiles p
      where p.id = user_roles.user_id and app.is_org_member(p.organization_id)
    )
  )
  with check (
    app.user_has_permission('users.manage')
    and exists (
      select 1 from app.profiles p
      where p.id = user_roles.user_id and app.is_org_member(p.organization_id)
    )
  );

-- user_branches: same read model as user_roles.
create policy user_branches_select_own_or_viewer
  on app.user_branches for select to authenticated
  using (
    user_id = auth.uid()
    or (app.user_has_permission('users.view') and exists (
      select 1 from app.profiles p
      where p.id = user_branches.user_id and app.is_org_member(p.organization_id)
    ))
  );

create policy user_branches_write_managed
  on app.user_branches for all to authenticated
  using (
    app.user_has_permission('users.manage')
    and exists (
      select 1 from app.profiles p
      where p.id = user_branches.user_id and app.is_org_member(p.organization_id)
    )
  )
  with check (
    app.user_has_permission('users.manage')
    and exists (
      select 1 from app.profiles p
      where p.id = user_branches.user_id and app.is_org_member(p.organization_id)
    )
  );

-- ── RLS: write policies for 00001 tables that need permission checks ───────
create policy organizations_update_managed
  on app.organizations for update to authenticated
  using (app.user_has_permission('org.manage') and app.is_org_member(id))
  with check (app.user_has_permission('org.manage') and app.is_org_member(id));

create policy branches_insert_managed
  on app.branches for insert to authenticated
  with check (app.user_has_permission('branch.manage') and app.is_org_member(organization_id));

create policy branches_update_managed
  on app.branches for update to authenticated
  using (app.user_has_permission('branch.manage') and app.is_org_member(organization_id))
  with check (app.user_has_permission('branch.manage') and app.is_org_member(organization_id));

-- profiles: extend SELECT to user-managers, add UPDATE (the column guard that
-- blocks organization_id changes for non-managers arrives in migration 00003).
create policy profiles_select_managed
  on app.profiles for select to authenticated
  using (
    app.user_has_permission('users.view') and app.is_org_member(organization_id)
  );

create policy profiles_update_own_or_managed
  on app.profiles for update to authenticated
  using (
    id = auth.uid()
    or (app.user_has_permission('users.manage') and app.is_org_member(organization_id))
  )
  with check (
    id = auth.uid()
    or (app.user_has_permission('users.manage') and app.is_org_member(organization_id))
  );

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select on app.permissions to authenticated;
grant select, insert, update on app.roles to authenticated;
grant select, insert, delete on app.role_permissions to authenticated;
grant select, insert, delete on app.user_roles to authenticated;
grant select, insert, delete on app.user_branches to authenticated;
-- 00001 tables: add the write grants now that guarded policies exist.
grant insert, update on app.organizations to authenticated;
grant insert, update on app.branches to authenticated;
grant update on app.profiles to authenticated;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.user_has_permission(text) to authenticated;
grant execute on function app.user_can_access_branch(uuid) to authenticated;
