-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20261008000004 — Orders & kitchen (Phase 3)
-- Restaurant orders built at the POS and worked on the kitchen display (KDS).
-- Purely additive:
--   * app.orders — branch-scoped order header. dine_in orders may reference a
--     floor-plan table and, optionally, the reservation they fulfil; takeaway
--     orders carry neither. Lifecycle: open → placed → served → completed,
--     plus cancelled (from open/placed only, requires pos.void). Completed and
--     cancelled orders are immutable; table/type/reservation details freeze
--     the moment the order leaves open. created_by is stamped server-side.
--   * app.order_items — order lines. name_snapshot and unit_price are derived
--     server-side from app.menu_items at insert time (client values are
--     ignored), so later menu edits can never rewrite the price of an order
--     that has already been taken. line_total is a stored generated column.
--   * Item lifecycle: queued → preparing → ready (kitchen.manage) → served
--     (pos.edit), no skips and no regressions. Fields are editable only while
--     the parent order is open; after placement items are voided (pos.void,
--     reason required, one-way), never deleted. Removing a line is the ONLY
--     delete surface in the schema and is bounded to open orders by the guard
--     trigger.
--   * Composite foreign keys pin every order to its branch/organization, its
--     table and its reservation (all same-branch), and every order line to
--     the exact branch + organization of its parent order: cross-tenant
--     references are structurally impossible. MATCH SIMPLE keeps the nullable
--     table/reservation legs optional.
--   * No new permission keys (catalog unchanged): orders reuse pos.* and the
--     kitchen display reuses kitchen.*. The staff system role receives
--     kitchen.manage (D6A) via an idempotent backfill, mirrored in the
--     replaced bootstrap_organization, so kitchen staff can advance items
--     while cancel/void stays manager+ (pos.void).
--   * app.audit_row_change() is reused exactly as-is (second argument
--     'branch'); order lines audit deletes too. Menu triggers stay
--     single-argument (branch_id NULL by construction).
-- Read model: orders and lines are readable with pos.view OR kitchen.view in
-- accessible branches; writes per command as below.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Composite-key targets for the new order foreign keys ────────────────────
-- Additive constraints only: `id` is already each table's primary key, so
-- uniqueness holds trivially and no existing behavior changes.
alter table app.table_reservations
  add constraint table_reservations_id_branch_key unique (id, branch_id);

alter table app.menu_items
  add constraint menu_items_id_org_key unique (id, organization_id);

-- ── Orders ──────────────────────────────────────────────────────────────────
create table app.orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  branch_id       uuid not null,
  table_id        uuid,
  reservation_id  uuid,
  order_type      text not null,
  status          text not null default 'open',
  notes           text not null default '',
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint orders_branch_fk
    foreign key (branch_id, organization_id)
    references app.branches (id, organization_id) on delete restrict,
  -- MATCH SIMPLE (the default): a NULL table_id/reservation_id skips its
  -- foreign key, which is what takeaway orders and unlinked walk-ins need.
  constraint orders_table_fk
    foreign key (table_id, branch_id, organization_id)
    references app.restaurant_tables (id, branch_id, organization_id) on delete restrict,
  constraint orders_reservation_fk
    foreign key (reservation_id, branch_id)
    references app.table_reservations (id, branch_id) on delete restrict,
  constraint orders_id_branch_org_key unique (id, branch_id, organization_id),
  constraint orders_type_check check (order_type in ('dine_in', 'takeaway')),
  constraint orders_status_check
    check (status in ('open', 'placed', 'served', 'completed', 'cancelled')),
  constraint orders_notes_length check (char_length(notes) <= 500)
);

create index orders_branch_created_idx on app.orders (branch_id, created_at desc);
create index orders_branch_status_idx on app.orders (branch_id, status);

comment on table app.orders is 'Branch-scoped restaurant order header. Lifecycle open -> placed -> served -> completed, plus cancelled from open/placed (pos.void). Details freeze once placed; completed/cancelled rows are immutable.';
comment on column app.orders.table_id is 'Dine-in table of this order, pinned to the same branch by a composite foreign key; NULL for takeaway and counter orders.';
comment on column app.orders.reservation_id is 'Optional reservation this order fulfils (same branch, by composite foreign key).';
comment on column app.orders.created_by is 'Stamped server-side from auth.uid() on insert; never changes.';
comment on column app.orders.status is 'Validated by app.guard_order_status; open -> placed needs an active item, served -> completed needs every active item served.';

-- ── Order status transition guard ───────────────────────────────────────────
-- INSERT may only open at 'open'; created_by is forced to the caller and can
-- never change. UPDATEs never move branch/organization/creator; table, type
-- and reservation details freeze once the order leaves open; completed and
-- cancelled orders are immutable. Status changes follow the transition table
-- and cancelled additionally requires pos.void.
create or replace function app.guard_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'An order cannot be created with status "%".', new.status;
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  if new.organization_id <> old.organization_id
    or new.branch_id <> old.branch_id then
    raise exception 'An order cannot be moved to another branch or organization.';
  end if;

  if new.created_by <> old.created_by then
    raise exception 'The creator of an order cannot be changed.';
  end if;

  if old.status in ('completed', 'cancelled') then
    raise exception 'A % order can no longer be changed.', old.status;
  end if;

  if old.status <> 'open'
    and (new.table_id is distinct from old.table_id
      or new.order_type <> old.order_type
      or new.reservation_id is distinct from old.reservation_id) then
    raise exception 'Order details are frozen once the order has been placed.';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'open'   and new.status in ('placed', 'cancelled'))
    or (old.status = 'placed' and new.status in ('served', 'cancelled'))
    or (old.status = 'served' and new.status = 'completed')
  ) then
    raise exception 'Invalid order transition from "%" to "%".', old.status, new.status;
  end if;

  if new.status = 'placed' and not exists (
    select 1 from app.order_items
    where order_id = old.id and voided_at is null
  ) then
    raise exception 'An order cannot be placed without at least one active item.';
  end if;

  if new.status = 'completed' and exists (
    select 1 from app.order_items
    where order_id = old.id and voided_at is null and status <> 'served'
  ) then
    raise exception 'Every active item must be served before the order is completed.';
  end if;

  if new.status = 'cancelled' and not app.user_has_permission('pos.void') then
    raise exception 'Cancelling an order requires the pos.void permission.';
  end if;

  return new;
end;
$$;

-- ── Order items ─────────────────────────────────────────────────────────────
create table app.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null,
  organization_id uuid not null,
  branch_id     uuid not null,
  menu_item_id  uuid not null,
  name_snapshot text not null,
  unit_price    numeric(12,2) not null,
  quantity      smallint not null default 1,
  notes         text not null default '',
  status        text not null default 'queued',
  voided_at     timestamptz,
  voided_by     uuid,
  void_reason   text not null default '',
  line_total    numeric(14,2) generated always as (unit_price * quantity) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint order_items_order_fk
    foreign key (order_id, branch_id, organization_id)
    references app.orders (id, branch_id, organization_id) on delete restrict,
  constraint order_items_menu_item_fk
    foreign key (menu_item_id, organization_id)
    references app.menu_items (id, organization_id) on delete restrict,
  constraint order_items_status_check
    check (status in ('queued', 'preparing', 'ready', 'served')),
  constraint order_items_name_length check (char_length(btrim(name_snapshot)) between 1 and 120),
  constraint order_items_unit_price_positive check (unit_price > 0),
  constraint order_items_quantity_bounds check (quantity between 1 and 99),
  constraint order_items_notes_length check (char_length(notes) <= 200),
  -- Void bookkeeping is all-or-nothing: a reason is required exactly when the
  -- item is voided, and voided_by can never be set without the marker.
  constraint order_items_void_consistency check (
    (voided_at is null and voided_by is null and void_reason = '')
    or (voided_at is not null and voided_by is not null
        and char_length(btrim(void_reason)) between 1 and 200)
  )
);

create index order_items_order_idx on app.order_items (order_id);
create index order_items_kitchen_idx
  on app.order_items (branch_id, status) where voided_at is null;

comment on table app.order_items is 'Order line. Name and price are a server-side snapshot of the menu item at insert time; later menu edits never rewrite the line. Removable only while the parent order is open, voided afterwards.';
comment on column app.order_items.name_snapshot is 'Copied from app.menu_items.name at insert time; client-supplied values are ignored.';
comment on column app.order_items.unit_price is 'Copied from app.menu_items.price at insert time; client-supplied values are ignored.';
comment on column app.order_items.line_total is 'Stored generated column: unit_price * quantity.';
comment on column app.order_items.voided_at is 'One-way void marker. Voiding requires pos.void and a reason; voided lines are frozen.';

-- ── Order item guard: derivation, lifecycle and the bounded delete ──────────
-- One BEFORE trigger governs the whole line lifecycle:
--   * INSERT: parent order must be open (read FOR UPDATE so a concurrent
--     placement is serialized); identity is copied from app.menu_items and
--     the parent's branch/organization, the initial state is pinned to
--     queued/not-voided.
--   * UPDATE: completed/cancelled parents freeze every line; voided lines are
--     frozen; item identity and price are immutable. While the parent is open
--     only quantity/notes may change and the status must stay queued; once
--     placed, fields freeze and only the kitchen transitions remain
--     (queued→preparing→ready under kitchen.manage, ready→served under
--     pos.edit). Voiding is a one-way UPDATE requiring pos.void + reason.
--   * DELETE: only while the parent order is open — the schema's single,
--     bounded delete surface.
create or replace function app.guard_order_item_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order app.orders%rowtype;
  v_name  text;
  v_price numeric(12,2);
begin
  if tg_op = 'DELETE' then
    select * into v_order from app.orders where id = old.order_id for update;
    if not found then
      raise exception 'The parent order of this item no longer exists.';
    end if;
    if v_order.status <> 'open' then
      raise exception 'Order items can only be removed while the order is open.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select * into v_order from app.orders where id = new.order_id for update;
    if not found then
      raise exception 'The parent order of this item does not exist.';
    end if;
    if v_order.status <> 'open' then
      raise exception 'Items can only be added while the order is open.';
    end if;

    select name, price into v_name, v_price
    from app.menu_items
    where id = new.menu_item_id and organization_id = v_order.organization_id;
    if not found then
      raise exception 'This menu item does not exist in this organization.';
    end if;

    new.organization_id := v_order.organization_id;
    new.branch_id       := v_order.branch_id;
    new.name_snapshot   := v_name;
    new.unit_price      := v_price;
    new.status          := 'queued';
    new.voided_at       := null;
    new.voided_by       := null;
    new.void_reason     := '';
    return new;
  end if;

  -- UPDATE — parent order must exist and still be live.
  select * into v_order from app.orders where id = old.order_id for update;
  if not found then
    raise exception 'The parent order of this item no longer exists.';
  end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'Items of a % order can no longer be changed.', v_order.status;
  end if;

  if new.order_id <> old.order_id
    or new.branch_id <> old.branch_id
    or new.organization_id <> old.organization_id then
    raise exception 'An order item cannot be moved to another order, branch or organization.';
  end if;

  if new.menu_item_id <> old.menu_item_id
    or new.name_snapshot <> old.name_snapshot
    or new.unit_price <> old.unit_price then
    raise exception 'The menu item, name and price of an order item cannot be changed.';
  end if;

  if old.voided_at is not null then
    raise exception 'A voided order item can no longer be changed.';
  end if;

  if new.voided_at is not null then
    if new.status <> old.status then
      raise exception 'Voiding an item does not change its kitchen status.';
    end if;
    if not app.user_has_permission('pos.void') then
      raise exception 'Voiding an order item requires the pos.void permission.';
    end if;
    if char_length(btrim(new.void_reason)) = 0 then
      raise exception 'Voiding an order item requires a reason.';
    end if;
    new.voided_at   := now();
    new.voided_by   := auth.uid();
    new.void_reason := btrim(new.void_reason);
    return new;
  end if;

  -- Not voided: strip any stray void bookkeeping the client sent.
  new.voided_by   := null;
  new.void_reason := '';

  if v_order.status = 'open' then
    if new.status <> old.status then
      raise exception 'Items cannot leave "queued" before the order is placed.';
    end if;
    if not app.user_has_permission('pos.edit') then
      raise exception 'Editing an item of an open order requires the pos.edit permission.';
    end if;
    return new;
  end if;

  -- Parent is placed or served: fields freeze, only kitchen transitions move.
  if new.quantity <> old.quantity or new.notes <> old.notes then
    raise exception 'Order item details are frozen once the order has been placed.';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'queued'    and new.status = 'preparing')
    or (old.status = 'preparing' and new.status = 'ready')
    or (old.status = 'ready'     and new.status = 'served')
  ) then
    raise exception 'Invalid order item transition from "%" to "%".', old.status, new.status;
  end if;

  if new.status in ('preparing', 'ready')
    and not app.user_has_permission('kitchen.manage') then
    raise exception 'Advancing an order item in the kitchen requires the kitchen.manage permission.';
  end if;

  if new.status = 'served' and not app.user_has_permission('pos.edit') then
    raise exception 'Serving an order item requires the pos.edit permission.';
  end if;

  return new;
end;
$$;

create trigger orders_guard_status
  before insert or update on app.orders
  for each row execute function app.guard_order_status();

create trigger orders_set_updated_at
  before update on app.orders
  for each row execute function app.set_updated_at();

create trigger orders_audit_change
  after insert or update on app.orders
  for each row execute function app.audit_row_change('pos.order', 'branch');

create trigger order_items_guard_status
  before insert or update or delete on app.order_items
  for each row execute function app.guard_order_item_status();

create trigger order_items_set_updated_at
  before update on app.order_items
  for each row execute function app.set_updated_at();

-- Line deletions are part of the order's history: audit them too.
create trigger order_items_audit_change
  after insert or update or delete on app.order_items
  for each row execute function app.audit_row_change('pos.order_item', 'branch');

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table app.orders enable row level security;
alter table app.order_items enable row level security;

-- Orders: pos.view or kitchen.view (KDS needs the header) to read; pos.create
-- to open; pos.edit to advance notes/status. No DELETE privilege and no
-- delete policy: cancellation is a status change. UPDATE carries USING and
-- WITH CHECK so a row can neither be edited into nor out of another branch.
create policy orders_select_staff
  on app.orders for select to authenticated
  using (
    (app.user_has_permission('pos.view') or app.user_has_permission('kitchen.view'))
    and app.user_can_access_branch(branch_id)
  );

create policy orders_insert_pos
  on app.orders for insert to authenticated
  with check (app.user_has_permission('pos.create') and app.user_can_access_branch(branch_id));

create policy orders_update_pos
  on app.orders for update to authenticated
  using (app.user_has_permission('pos.edit') and app.user_can_access_branch(branch_id))
  with check (app.user_has_permission('pos.edit') and app.user_can_access_branch(branch_id));

-- Order items: same read model; pos.create to add lines; pos.edit or
-- kitchen.manage to update them (the trigger distinguishes who may do what);
-- delete (bounded to open orders by the guard trigger) needs pos.edit.
create policy order_items_select_staff
  on app.order_items for select to authenticated
  using (
    (app.user_has_permission('pos.view') or app.user_has_permission('kitchen.view'))
    and app.user_can_access_branch(branch_id)
  );

create policy order_items_insert_pos
  on app.order_items for insert to authenticated
  with check (app.user_has_permission('pos.create') and app.user_can_access_branch(branch_id));

create policy order_items_update_pos_kitchen
  on app.order_items for update to authenticated
  using (
    (app.user_has_permission('pos.edit') or app.user_has_permission('kitchen.manage'))
    and app.user_can_access_branch(branch_id)
  )
  with check (
    (app.user_has_permission('pos.edit') or app.user_has_permission('kitchen.manage'))
    and app.user_can_access_branch(branch_id)
  );

create policy order_items_delete_pos
  on app.order_items for delete to authenticated
  using (app.user_has_permission('pos.edit') and app.user_can_access_branch(branch_id));

-- ── Privileges ──────────────────────────────────────────────────────────────
grant select, insert, update on app.orders to authenticated;
grant select, insert, update, delete on app.order_items to authenticated;

-- ── Staff system-role backfill (D6A) ────────────────────────────────────────
-- No new permission keys arrive in Phase 3, so only the staff system role
-- changes: kitchen.manage is added to every existing staff system role
-- (idempotent) so kitchen staff can advance items. Manager already holds it;
-- owner/administrator mirror the catalog dynamically.
insert into app.role_permissions (role_id, permission_key)
select r.id, 'kitchen.manage'
from app.roles r
where r.is_system and r.name = 'staff'
on conflict do nothing;

-- ── bootstrap_organization: staff gains kitchen.manage for NEW orgs ────────
-- Verbatim re-declaration of app.bootstrap_organization from migration
-- 20261008000003 (including the app.bootstrap_org_id attach-guard fix) with
-- kitchen.manage added to the staff system-role grant.
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
    (v_role_id, 'kitchen.manage'),
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

-- ── Function privileges for the new trigger functions ───────────────────────
revoke execute on function app.guard_order_status() from public;
revoke execute on function app.guard_order_item_status() from public;
grant execute on function app.guard_order_status() to authenticated;
grant execute on function app.guard_order_item_status() to authenticated;

notify pgrst, 'reload schema cache';
