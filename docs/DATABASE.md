# Database Reference — Foundation (Phase 1+2) + Menu module

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
Global catalog of granular permission keys, seeded by migration 00002.
Format `<department>.<action>` — the full set:

| Department | Keys |
|---|---|
| management | `dashboard.view`, `reports.view`, `reports.export`, `admin.settings`, `approvals.view`, `approvals.manage`, `audit.view` |
| organization | `org.manage`, `branch.manage`, `branch.view_all`, `users.manage`, `users.view`, `roles.manage` |
| restaurant | `menu.manage`, `pos.view`, `pos.create`, `pos.edit`, `pos.discount`, `pos.void`, `pos.refund`, `pos.approve_void` |
| kitchen | `kitchen.view`, `kitchen.manage` |
| rooms | `rooms.view`, `rooms.manage`, `housekeeping.view`, `housekeeping.manage` |
| bookings | `bookings.view`, `bookings.create`, `bookings.edit`, `bookings.cancel`, `folio.view`, `folio.post`, `folio.manage` |
| inventory | `inventory.view`, `inventory.manage`, `inventory.adjust`, `inventory.approve_adjust` |
| purchasing | `purchasing.view`, `purchasing.create`, `purchasing.approve`, `suppliers.manage` |
| accounting | `accounting.view`, `accounting.post`, `accounting.reverse`, `accounting.reconcile`, `payments.view`, `payments.refund`, `payments.manage` |
| hr | `hr.view`, `employees.manage`, `payroll.view`, `payroll.run`, `payroll.approve` |
| assets | `assets.view`, `assets.manage`, `maintenance.view`, `maintenance.manage` |

New modules add their keys here (new migration, `insert … on conflict do nothing`).

### `app.roles` / `app.role_permissions` / `app.user_roles`
Org-scoped roles and their permission grants and user assignments. Bootstrap
seeds four system roles (`is_system = true`):

| Role | Notable exclusions |
|---|---|
| `owner` | — (every permission) |
| `administrator` | `org.manage` |
| `manager` | `pos.refund`, `pos.approve_void`, `inventory.approve_adjust`, `purchasing.approve`, `accounting.*` writes, `payments.refund`, `payroll.run/approve`, `audit.view` |
| `staff` | read-only across floors + `pos.create/edit` |

### `app.user_branches`
Optional branch restriction set. **No rows = access to all org branches.**
Once any row exists the user is confined to the listed branches (enforced by
`app.user_can_access_branch`).

### `app.menu_categories`
Org-wide menu categories (migration `20261008000002`). Names are unique among
**active** rows per organization (`lower(btrim(name))` partial unique index), so
a deactivated category's name can be reused. Soft-deleted via `is_active` —
there is no DELETE grant or policy anywhere. `(id, organization_id)` is unique
as the composite-FK target for items.

### `app.menu_items`
Menu items in `numeric(12,2)` prices (> 0, org default currency). A composite
foreign key `(category_id, organization_id)` pins each item to a category of
the **same** organization, so cross-org category references are structurally
impossible. `is_available` is the day-to-day "86" toggle; `is_active` is the
soft-delete flag. `image_path` points into the private `menu-images` bucket.
Both menu tables carry the `app.audit_row_change` trigger: every INSERT/UPDATE
is captured with full before/after JSONB (`menu.category` / `menu.item`).

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

## Functions (all `security definer`, `set search_path = ''`)

| Function | Purpose |
|---|---|
| `app.is_org_member(org)` | membership test used across RLS |
| `app.user_has_permission(key)` | permission test used across RLS |
| `app.user_can_access_branch(branch)` | branch scoping (restriction rows win) |
| `app.get_my_access()` | one-round-trip payload for the SPA: profile + organization + permission keys + restricted branch ids |
| `app.bootstrap_organization(name, slug, branch_name, branch_code)` | first-run: creates org, first branch, the four system roles; caller becomes `owner`. One org per user; writes an audit entry |
| `app.log_audit(...)` | server-stamped audit writer; validates `branch_id` against the caller's organization |
| `app.guard_audit_integrity()` | audit insert guard: server-derives actor identity, overwrites client `actor_email`, validates branch/organization consistency |
| `app.audit_row_change()` | generic AFTER INSERT/UPDATE row-audit trigger: writes full before/after JSONB through `app.log_audit` under the entity type given as the trigger argument (menu tables use `menu.category` / `menu.item`; `branch_id` is null for org-wide entities) |
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
has a DELETE grant or policy — deactivation is the only removal path. The
`menu-images` storage rules enforce the same split against the organization
folder. The `app` schema is
exposed to PostgREST (`alter role authenticator set pgrst.db_schemas =
'public, app'`) so the SPA uses `.schema('app')`; the `anon` role has no usage
of `app` at all — unauthenticated requests get nothing.

## Conventions for future phase migrations

1. New tables in schema `app`, `organization_id` (and usually `branch_id`)
   FK'd, indexes on the FKs, `enable row level security`, explicit grants,
   policies via the helpers above.
2. Sensitive mutations call `app.log_audit` with before/after JSON; for plain
   create/update row audits, attach the reusable `app.audit_row_change('<entity.type>')`
   trigger instead (see the menu tables).
3. Financial tables follow the reversals-not-edits rule: posted rows are
   immutable; corrections insert compensating rows (detail in the accounting
   phase).
4. Keep migrations additive for production roll-forward.
