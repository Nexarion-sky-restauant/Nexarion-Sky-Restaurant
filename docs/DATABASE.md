# Database Reference — Foundation + Menu, Tables & Reservations, Orders & Kitchen modules

All application tables live in schema **`app`** in the single Supabase
PostgreSQL database. Migrations live in `supabase/migrations/` and are applied
per environment by GitHub Actions (`docs/PROVISIONING.md`).

## Tables

### `app.organizations`
Business tenant. Exactly one per Nexarion Sky Restaurant business.
`default_currency` (ISO 4217, default `KES`) and `timezone`
(default `Africa/Nairobi`) anchor financial data for later phases.

### `app.branches`
Physical locations. `unique (organization_id, code)`. Later phases attach
orders, stock, folios and assets to branches; `app.user_branches` restricts
users to a subset.

### `app.profiles`
1:1 with `auth.users` (auto-created by the `handle_new_user` trigger).
`organization_id` is NULL until the user bootstraps or is invited into an org.
Profile updates are guarded: changing `organization_id` requires
`users.manage`.

### `app.permissions`
Global catalog of granular permission keys. Migration 00002 seeds the
foundation set; later module migrations append their keys
(`20261008000002` menu, `20261008000003` tables & reservations). Orders &
kitchen (`20261008000004`) adds **no new keys** — orders reuse `pos.*` and the
kitchen display reuses `kitchen.*`. Format
`<department>.<action>` — the full set:

| Department | Keys |
|---|---|
| management | `dashboard.view`, `reports.view`, `reports.export`, `admin.settings`, `approvals.view`, `approvals.manage`, `audit.view` |
| organization | `org.manage`, `branch.manage`, `branch.view_all`, `users.manage`, `users.view`, `roles.manage` |
| restaurant | `menu.manage`, `pos.view`, `pos.create`, `pos.edit`, `pos.discount`, `pos.void`, `pos.refund`, `pos.approve_void` |
| tables | `tables.manage` |
| kitchen | `kitchen.view`, `kitchen.manage` |
| rooms | `rooms.view`, `rooms.manage`, `housekeeping.view`, `housekeeping.manage` |
| bookings | `bookings.view`, `bookings.create`, `bookings.edit`, `bookings.cancel`, `folio.view`, `folio.post`, `folio.manage` |
| reservations | `reservations.view`, `reservations.create`, `reservations.edit`, `reservations.cancel` |
| inventory | `inventory.view`, `inventory.manage`, `inventory.adjust`, `inventory.approve_adjust` |
| purchasing | `purchasing.view`, `purchasing.create`, `purchasing.approve`, `suppliers.manage` |
| accounting | `accounting.view`, `accounting.post`, `accounting.reverse`, `accounting.reconcile`, `payments.view`, `payments.refund`, `payments.manage` |
| hr | `hr.view`, `employees.manage`, `payroll.view`, `payroll.run`, `payroll.approve` |
| assets | `assets.view`, `assets.manage`, `maintenance.view`, `maintenance.manage` |

New modules add their keys here (new migration, `insert … on conflict do nothing`),
and each migration must also backfill the new keys onto the system roles of
**existing** organizations (system roles were seeded from the catalog as it
existed at bootstrap time) and re-seed them in `app.bootstrap_organization`
for new ones.

Phase 3 (D6A) is the exception that proves the rule: no keys arrive, but the
`staff` system role gains `kitchen.manage` anyway — the same idempotent
backfill pattern onto existing organizations plus a mirrored re-declaration of
`app.bootstrap_organization` — so kitchen staff can advance items while
cancel/void stays manager+ (`pos.void`).

### `app.roles` / `app.role_permissions` / `app.user_roles`
Org-scoped roles and their permission grants and user assignments. Bootstrap
seeds four system roles (`is_system = true`):

| Role | Notable exclusions |
|---|---|
| `owner` | — (every permission) |
| `administrator` | `org.manage` |
| `manager` | `pos.refund`, `pos.approve_void`, `inventory.approve_adjust`, `purchasing.approve`, `accounting.*` writes, `payments.refund`, `payroll.run/approve`, `audit.view` |
| `staff` | read-only across floors + `pos.create/edit`, `kitchen.view/manage` |

Phase 2 additions: `manager` holds all five tables/reservations keys; `staff`
holds `reservations.view/create/edit` but **not** `reservations.cancel`
(cancelling is a manager action), and reads the floor plan like any member —
note there is deliberately no `tables.view` key: floor-plan reads are plain
org-membership + branch access.

Phase 3 additions (D6A): `staff` gains `kitchen.manage` next to its existing
`kitchen.view` (so front-line kitchen staff advance the KDS) and keeps
`pos.view/create/edit`; it deliberately holds **no** `pos.void`,
`pos.discount` or `tables.manage` — cancelling orders and voiding lines is a
manager action.

### `app.user_branches`
Optional branch restriction set. **No rows = access to all org branches.**
Once any row exists the user is confined to the listed branches (enforced by
`app.user_can_access_branch`).

### `app.menu_categories`
Org-wide menu categories (migration `20261008000002`). Names are unique among
**active** rows per organization (`lower(btrim(name))` partial unique index), so
a deactivated category's name can be reused. Soft-deleted via `is_active` —
there is no DELETE grant or policy on the menu tables. `(id, organization_id)`
is unique as the composite-FK target for items.

### `app.menu_items`
Menu items in `numeric(12,2)` prices (> 0, org default currency). A composite
foreign key `(category_id, organization_id)` pins each item to a category of
the **same** organization, so cross-org category references are structurally
impossible. `is_available` is the day-to-day "86" toggle; `is_active` is the
soft-delete flag. `image_path` points into the private `menu-images` bucket.
Both menu tables carry the `app.audit_row_change` trigger: every INSERT/UPDATE
is captured with full before/after JSONB (`menu.category` / `menu.item`).

### `app.restaurant_tables`
Branch-scoped dining tables — the floor plan (migration `20261008000003`).
A composite FK `(branch_id, organization_id) → app.branches (id, organization_id)`
pins each table to a branch of the **same** organization, and
`(id, branch_id, organization_id)` is unique as the composite-FK target for
reservations. Names are unique among **active** tables of a branch only
(`lower(btrim(name))` partial index), so a deactivated name can be reused.
`zone` groups the floor plan (free text, e.g. Main / Terrace; 1–60 chars),
`capacity` is an informational seat count (1–100) — reservations may exceed
it. Soft-deleted via `is_active`; there is no DELETE grant or policy. No
day-status is stored: availability is derived from reservations, never
persisted.

### `app.table_reservations`
Guest reservations for a table, with a six-state lifecycle
`pending → confirmed → seated → completed` plus `cancelled` / `no_show`
(default `pending`). A composite FK
`(table_id, branch_id, organization_id) → app.restaurant_tables (id, branch_id, organization_id)`
pins every reservation to a table of the same branch **and** organization.
Two overlapping pending/confirmed/seated reservations on one table are
impossible: a GiST exclusion constraint (`table_reservations_no_overlap`;
`btree_gist` supplies the uuid equality leg) rejects them at write time with
SQLSTATE 23P01, and the range is half-open `[starts_at, ends_at)` so
back-to-back bookings never conflict. `ends_at` is **derived**, not stored
client input: the BEFORE trigger `app.set_reservation_window` overwrites it as
`starts_at + duration_minutes` (15–480, default 120) — a stored generated
column is impossible because `timestamptz + interval` is STABLE, not
IMMUTABLE. Status transitions are enforced by `app.guard_reservation_status`
(INSERT may only open at pending/confirmed; terminal states are final; moving
into `cancelled` additionally requires `reservations.cancel`). Both tables
carry the `audit_row_change` trigger with **branch attribution opted in**
(`'tables.table', 'branch'` / `'reservations.reservation', 'branch'`), so
their audit rows record the row's `branch_id`.

### `app.orders`
Branch-scoped order header (migration `20261008000004`). Lifecycle
`open → placed → served → completed`, plus `cancelled` from `open`/`placed`
only; `order_type` is `dine_in` or `takeaway`. `dine_in` orders may reference a
floor-plan table and, optionally, the reservation they fulfil — both pinned to
the same branch by composite foreign keys with MATCH SIMPLE, so the nullable
legs simply skip their check (takeaway carries neither) while a non-null
reference can never cross branch or organization. `created_by` is stamped
server-side from `auth.uid()` on insert and never changes. The BEFORE trigger
`app.guard_order_status` enforces the whole lifecycle: INSERT may only open at
`open`; completed/cancelled orders are immutable; table/type/reservation
details freeze the moment the order leaves `open`; `open → placed` requires at
least one active (non-voided) item; `served → completed` requires every active
item to be `served`; entering `cancelled` additionally requires `pos.void`.
Notes are capped at 500 chars. There is **no DELETE grant and no delete
policy** — cancellation is a status change. The table carries the
`audit_row_change` trigger with branch attribution (`'pos.order', 'branch'`).

### `app.order_items`
Order lines (migration `20261008000004`). `name_snapshot` and `unit_price` are
**derived server-side** from `app.menu_items` at insert time (client-supplied
values are ignored), so later menu edits can never rewrite the price of an
order already taken; `line_total` is a stored generated column
(`unit_price * quantity`). Composite foreign keys pin every line to the exact
branch + organization of its parent order and to a menu item of the same
organization. `quantity` is 1–99, notes ≤ 200 chars, and void bookkeeping is
all-or-nothing (`voided_at`/`voided_by`/`void_reason` set together with a
1–200-char reason, or all empty). The BEFORE trigger
`app.guard_order_item_status` governs the whole line lifecycle: lines can only
be added while the parent is `open`; identity, name and price are immutable;
voided lines are frozen; the kitchen chain is `queued → preparing → ready`
(requires `kitchen.manage`) then `ready → served` (requires `pos.edit`), no
skips or regressions; fields are editable only while the parent is `open`;
voiding is a one-way UPDATE requiring `pos.void` + reason and never changes
kitchen status. **DELETE here is the schema's single delete surface**,
bounded by the guard trigger to open orders only (RLS additionally requires
`pos.edit` + branch access) — after placement, lines are voided, never
deleted. The table carries the `audit_row_change` trigger with branch
attribution (`'pos.order_item', 'branch'`) **including deletes**, so removing
a line while the order is open is part of the order's history.

### `app.audit_log`
Append-only (`SELECT`, `INSERT` grants only — no UPDATE/DELETE anywhere).
Written through `app.log_audit(action, entity_type, entity_id, branch_id,
before, after, metadata)`, which stamps `organization_id`, `actor_id` and
`actor_email` from the auth context server-side and validates a non-null
`branch_id` against the caller's organization. A before-insert guard
(`app.guard_audit_integrity`) server-derives `actor_id`/`actor_email` for
authenticated writers — a client-supplied email is always overwritten — and
requires `branch_id`/`organization_id` pairs to be consistent. Direct INSERT
is permitted only self-attributed (`actor_id = auth.uid()`), reserved for
Edge Functions in later phases. Read requires `audit.view`.

## Functions (`security definer`, `set search_path = ''` unless noted)

| Function | Purpose |
|---|---|
| `app.is_org_member(org)` | membership test used across RLS |
| `app.user_has_permission(key)` | permission test used across RLS |
| `app.user_can_access_branch(branch)` | branch scoping (restriction rows win) |
| `app.get_my_access()` | one-round-trip payload for the SPA: profile + organization + permission keys + restricted branch ids |
| `app.bootstrap_organization(name, slug, branch_name, branch_code)` | first-run: creates org, first branch, the four system roles; caller becomes `owner`. One org per user; writes an audit entry |
| `app.log_audit(...)` | server-stamped audit writer; validates `branch_id` against the caller's organization |
| `app.guard_audit_integrity()` | audit insert guard: server-derives actor identity, overwrites client `actor_email`, validates branch/organization consistency |
| `app.audit_row_change()` | generic AFTER INSERT/UPDATE row-audit trigger: writes full before/after JSONB through `app.log_audit` under the entity type given as the **first** trigger argument. Branch attribution is opt-in: a second argument `'branch'` records the row's `branch_id` (tables, reservations, orders, order lines); without it `branch_id` stays NULL (menu rows — NULL by construction) |
| `app.set_reservation_window()` | BEFORE trigger: derives `ends_at = starts_at + duration_minutes` (not `security definer` — pure row computation, no table access) |
| `app.guard_reservation_status()` | BEFORE trigger: enforces the six-state reservation lifecycle (INSERT opens at pending/confirmed; legal transitions only; entering `cancelled` requires `reservations.cancel`) |
| `app.guard_order_status()` | BEFORE trigger: enforces the order lifecycle (INSERT only at `open`; creator/branch/organization immutable; details freeze once placed; completed/cancelled immutable; `open → placed` needs an active item; `served → completed` needs every active item served; entering `cancelled` requires `pos.void`) |
| `app.guard_order_item_status()` | BEFORE trigger over INSERT/UPDATE/DELETE: server-derives name/price/branch from the parent order and menu item, pins the initial state, enforces the line lifecycle and kitchen chain (`kitchen.manage` / `pos.edit` gates), the one-way void (`pos.void` + reason) and the bounded delete (open orders only) |
| `app.handle_new_user()` | auth trigger → creates profile |

## Storage

Private bucket **`menu-images`** (2 MB cap; `image/jpeg`, `image/png`,
`image/webp` only). Object paths are `{organization_id}/{uuid}.{ext}`, and the
three access rules on `storage.objects` mirror table RLS: members select,
`menu.manage` holders insert/update — all scoped to the folder named after the
caller's organization. There is deliberately no DELETE rule in v1: replacing an
image points `image_path` at a new object; the old object becomes unreachable.
The SPA displays images via short-lived signed URLs (1 hour).

## RLS summary

Every table has RLS enabled. SELECT is org-membership based (plus permission
gates where marked); all writes require the relevant manage/permission key and
org membership; `audit_log` is insert/self or `audit.view`. The menu tables are
the worked example of the full pattern: every member reads, `menu.manage`
writes, UPDATE policies carry both `using` and `with check`, and neither table
has a DELETE grant or policy — deactivation is the only removal path.
Tables & reservations add **branch scoping**: floor-plan rows are readable by
every member with access to the branch (`app.user_can_access_branch`),
`tables.manage` writes; reservations additionally require `reservations.view`
to read, `reservations.create` to insert, and `reservations.edit` or
`reservations.cancel` to update — always compounded with branch access, and
UPDATE policies carry both `using` and `with check` so a row can neither be
edited into nor out of another branch. Orders & kitchen reuse those building
blocks: `pos.view` **or** `kitchen.view` reads both orders and lines (the KDS
needs the headers), `pos.create` opens orders and adds lines, `pos.edit` or
`kitchen.manage` updates lines (the guard trigger distinguishes kitchen
advances from edits/serves), and `pos.edit` deletes lines — with the delete
additionally bounded to open orders by the guard trigger. `app.orders` itself
has no DELETE grant or policy. The `menu-images` storage rules enforce
the same member/manage split against the organization folder. The `app` schema
is exposed to PostgREST (`alter role authenticator set pgrst.db_schemas =
'public, app'`) so the SPA uses `.schema('app')`; the `anon` role has no usage
of `app` at all — unauthenticated requests get nothing.

## Conventions for future phase migrations

1. New tables in schema `app`, `organization_id` (and usually `branch_id`)
   FK'd, indexes on the FKs, `enable row level security`, explicit grants,
   policies via the helpers above.
2. Sensitive mutations call `app.log_audit` with before/after JSON; for plain
   create/update row audits, attach the reusable `app.audit_row_change('<entity.type>')`
   trigger instead (see the menu tables). Branch-scoped entities pass a second
   argument — `app.audit_row_change('<entity.type>', 'branch')` — to record the
   row's `branch_id` on the audit entry (see the tables and reservations
   triggers).
3. Financial tables follow the reversals-not-edits rule: posted rows are
   immutable; corrections insert compensating rows (detail in the accounting
   phase).
4. Keep migrations additive for production roll-forward.
5. Soft-delete (`is_active`) stays the default removal path. A hard DELETE is
   only acceptable when a guard trigger bounds it to a pre-commitment window
   — `app.order_items` is the single sanctioned example (open orders only;
   after placement lines are voided, never deleted).
