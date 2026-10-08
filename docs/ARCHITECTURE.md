# Architecture

## Principles

1. **One database is the only source of truth.** Every department (restaurant,
   rooms, inventory, accounting, …) reads and writes the same transactional
   data in one PostgreSQL database. No departmental silos, no second database,
   no second auth system, no second permission system.
2. **Authorization happens in the database.** All access control is Postgres
   Row Level Security plus `security definer` helper functions. The frontend
   asks permission questions only for UX; RLS decides what data moves.
3. **Everything sensitive is auditable.** Approvals, refunds, voids, discounts,
   stock adjustments and payroll actions write to the append-only
   `app.audit_log` via `app.log_audit`.
4. **Posted financial records are never silently edited.** Later accounting
   phases will implement corrections/reversals; the audit core to support that
   exists now.
5. **Cloud-only.** GitHub is the source of truth; GitHub Actions deploys;
   Cloudflare serves the app and DNS; Supabase provides the backend. No local
   server, no local database.

## Component view

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA on Cloudflare Pages, live domain)       │
│  - Supabase Auth session (email/password)                   │
│  - supabase-js with publishable anon key only               │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────────────────────┐
│  Supabase                                                   │
│  - Auth (sessions, users)                                   │
│  - PostgREST API, schema `app` exposed                      │
│  - PostgreSQL with RLS on every table                       │
│  - Storage (private buckets; menu images via signed URLs)   │
│  - Edge Functions (M-Pesa callbacks, WhatsApp, Gemini:      │
│    later phases; hold service-role keys server-side only)   │
└─────────────────────────────────────────────────────────────┘
```

## Environments and promotion

| Environment | Supabase project | App deployment | Trigger |
|---|---|---|---|
| Development | `…-dev` | none (CI verifies) | manual `workflow_dispatch` applies migrations to dev |
| Staging | `…-staging` | Cloudflare Pages (staging project, `*.pages.dev`) | push to `develop` |
| Production | `…-prod` | Cloudflare Pages (production project) + **live domain** | push to `main` (protected) |

- Migration promotion: `migrate-dev` (manual) → `deploy-staging` →
  `deploy-production`. Production is never migrated from a feature branch.
- Production schema changes must be additive/backwards-compatible
  (expand/contract). Destructive changes require a reviewed plan and a manual
  gate.
- Rollback: revert the commit and re-run the workflow; the database migrates
  forward only, so application rollbacks must remain compatible with the
  migrated schema.

## Security model

- **Schema isolation**: application tables live in schema `app`, not `public`.
  New tables in `app` receive no implicit grants; grants are explicit per
  migration, and RLS is enabled on every table.
- **Helper functions** (`app.is_org_member`, `app.user_has_permission`,
  `app.user_can_access_branch`) are `security definer` with
  `set search_path = ''` so they cannot be redirected by a hostile search
  path. RLS policies stay small and delegate to these functions.
- **Roles & permissions**: global permission catalog (department.action), org-
  scoped roles, role→permission and user→role mappings, optional per-user
  branch restrictions. Seeded system roles: `owner`, `administrator`,
  `manager`, `staff`.
- **Tenant isolation**: every table carries `organization_id`; policies check
  membership, so one business can never read another's rows — including
  through the anon key.
- **Secrets**: repository and environment secrets in GitHub, scoped API tokens
  in Cloudflare, per-project keys in Supabase. Service-role keys (when Edge
  Functions arrive) live exclusively in Supabase Edge Function secrets.
- **Audit**: `app.audit_log` is append-only — no UPDATE/DELETE grants exist.
  Inserts must be self-attributed (`actor_id = auth.uid()`), and the normal
  path is the server-stamping `app.log_audit` function. The reusable
  `app.audit_row_change` trigger captures every menu, table, reservation,
  order and order-line create/update with full before/after JSONB — order-line
  deletions are audited too, as they are the schema's only delete surface
  (bounded to open orders). Branch attribution is opt-in via a second trigger
  argument (`'branch'`), so branch-scoped entities record the row's branch
  while org-wide rows keep `branch_id` NULL by construction.
- **Storage**: buckets are private; rules on `storage.objects` mirror table RLS
  per organization folder (`{organization_id}/…`). Menu images: members read,
  `menu.manage` write, no delete in v1 — served to the SPA as short-lived
  signed URLs.

## What intentionally does not exist yet

The Menu module (categories, items, prices, images; migration
`20261008000002` + `src/pages/menu/`) is live in production. The Tables &
Reservations module (branch floor plan + six-state reservation workflow;
migration `20261008000003` + `src/pages/tables/`, `src/pages/reservations/`)
passed staging acceptance on 2026-10-08 and awaits its separate production
release. The Orders & Kitchen module (POS order lifecycle + kitchen display;
migration `20261008000004` + `src/pages/orders/`, `src/pages/kitchen/`) is
built and in staging acceptance. Walk-ins and stored occupancy deliberately do
not exist yet — table availability is derived from reservations, and orders
reference tables without tracking seat-level occupancy. Payments, discounts,
receipts and shifts deliberately do not exist yet: orders carry a derived
line total and status, nothing more. Rooms/bookings/folios, inventory,
purchasing, accounting, HR, payroll, assets, reports/PDF, WhatsApp, M-Pesa,
Gemini intentionally do not exist yet. Each arrives in its approved phase
with its own migration set extending this foundation.
