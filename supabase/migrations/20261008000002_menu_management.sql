-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20261008000002 — Menu management (Phase 1)
-- First restaurant-management module. Purely additive:
--   * app.menu_categories / app.menu_items — org-scoped menu. Items soft-delete
--     via is_active; prices are never silently rewritten because every insert
--     and update is captured with full before/after JSONB in the audit trail.
--   * app.audit_row_change() — generic row-audit trigger helper; both menu
--     tables carry it (entity types 'menu.category' / 'menu.item').
--   * A private 'menu-images' storage bucket (2 MB cap, image MIME allow-list)
--     with org-scoped access rules; object paths are {organization_id}/{uuid}.{ext}.
-- Read model: every org member. Write model: the menu.manage permission held by
-- owner / administrator / manager. No delete surface exists — deactivation only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Menu categories ─────────────────────────────────────────────────────────
create table app.menu_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  name            text not null,
  description     text not null default '',
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint menu_categories_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint menu_categories_description_length check (char_length(description) <= 2000),
  constraint menu_categories_id_org_key unique (id, organization_id)
);

-- Name uniqueness applies to ACTIVE categories only, so a deactivated
-- category's name can be reused. lower(btrim(...)) blocks case/whitespace
-- look-alikes. The (id, organization_id) unique constraint above exists as
-- the composite foreign-key target for menu_items.
create unique index menu_categories_org_name_active_idx
  on app.menu_categories (organization_id, lower(btrim(name)))
  where is_active;

create trigger menu_categories_set_updated_at
  before update on app.menu_categories
  for each row execute function app.set_updated_at();

comment on table app.menu_categories is 'Menu category (org-wide). Soft-deleted via is_active; names unique among active rows.';

-- ── Menu items ──────────────────────────────────────────────────────────────
create table app.menu_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  category_id     uuid not null,
  name            text not null,
  description     text not null default '',
  price           numeric(12,2) not null,
  image_path      text,
  is_available    boolean not null default true,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint menu_items_category_fk
    foreign key (category_id, organization_id)
    references app.menu_categories (id, organization_id) on delete restrict,
  constraint menu_items_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint menu_items_description_length check (char_length(description) <= 2000),
  constraint menu_items_price_positive check (price > 0),
  constraint menu_items_image_path_length check (image_path is null or char_length(image_path) <= 400)
);

-- The composite foreign key pins category_id to a category of the SAME
-- organization: cross-org category references are structurally impossible.
create index menu_items_org_category_idx on app.menu_items (organization_id, category_id);

create trigger menu_items_set_updated_at
  before update on app.menu_items
  for each row execute function app.set_updated_at();

comment on table app.menu_items is 'Menu item (org-wide). price is the sales price in the org currency; edits are audited via before/after JSONB.';
comment on column app.menu_items.price is 'Sales price, positive, 2 decimal places, in the organization default currency.';
comment on column app.menu_items.is_available is 'Day-to-day availability ("86" toggle). is_active is the soft-delete flag.';
comment on column app.menu_items.image_path is 'Object path inside the private menu-images bucket: {organization_id}/{uuid}.{ext}.';

-- ── Generic row audit helper ────────────────────────────────────────────────
-- Reusable AFTER INSERT OR UPDATE trigger: writes create/update rows through
-- app.log_audit with full before/after JSONB and branch_id null (menu entities
-- are organization-wide, not branch-scoped). The entity type comes from the
-- trigger argument (e.g. 'menu.item'); the table name is the fallback.
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

  perform app.log_audit(
    v_action,
    coalesce(tg_argv[0], tg_table_name),
    v_entity_id,
    null,
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

create trigger menu_categories_audit_change
  after insert or update on app.menu_categories
  for each row execute function app.audit_row_change('menu.category');

create trigger menu_items_audit_change
  after insert or update on app.menu_items
  for each row execute function app.audit_row_change('menu.item');

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table app.menu_categories enable row level security;
alter table app.menu_items enable row level security;

-- Read: every org member sees the menu. Write: menu.manage holders only.
-- There is deliberately no DELETE privilege and no delete policy on either
-- table: deactivation (is_active = false) is the only removal path.
create policy menu_categories_select_member
  on app.menu_categories for select to authenticated
  using (app.is_org_member(organization_id));

create policy menu_categories_insert_managed
  on app.menu_categories for insert to authenticated
  with check (app.user_has_permission('menu.manage') and app.is_org_member(organization_id));

create policy menu_categories_update_managed
  on app.menu_categories for update to authenticated
  using (app.user_has_permission('menu.manage') and app.is_org_member(organization_id))
  with check (app.user_has_permission('menu.manage') and app.is_org_member(organization_id));

create policy menu_items_select_member
  on app.menu_items for select to authenticated
  using (app.is_org_member(organization_id));

create policy menu_items_insert_managed
  on app.menu_items for insert to authenticated
  with check (app.user_has_permission('menu.manage') and app.is_org_member(organization_id));

create policy menu_items_update_managed
  on app.menu_items for update to authenticated
  using (app.user_has_permission('menu.manage') and app.is_org_member(organization_id))
  with check (app.user_has_permission('menu.manage') and app.is_org_member(organization_id));

-- ── Storage: menu images ────────────────────────────────────────────────────
-- Private bucket; the storage service enforces the 2 MB cap and the
-- image-only MIME allow-list. Object paths are {organization_id}/{uuid}.{ext},
-- so the first folder segment is always the owning organization's id. The
-- SELECT/INSERT/UPDATE rules below scope access per organization; there is
-- deliberately no delete rule in v1 (replacing an image points image_path at
-- a new object; the old object becomes unreachable).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy menu_images_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'menu-images'
    and app.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy menu_images_insert_managed
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and app.user_has_permission('menu.manage')
    and app.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy menu_images_update_managed
  on storage.objects for update to authenticated
  using (
    bucket_id = 'menu-images'
    and app.user_has_permission('menu.manage')
    and app.is_org_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'menu-images'
    and app.user_has_permission('menu.manage')
    and app.is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- ── Privileges ──────────────────────────────────────────────────────────────
grant select, insert, update on app.menu_categories to authenticated;
grant select, insert, update on app.menu_items to authenticated;
revoke execute on function app.audit_row_change() from public;
grant execute on function app.audit_row_change() to authenticated;

notify pgrst, 'reload schema cache';
