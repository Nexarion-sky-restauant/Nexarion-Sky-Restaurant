# Testing

The automated test foundation (Phase 0B) covers authentication, authorization
and the security-critical invariants of the foundation. It runs on every push
and pull request in the `CI` workflow and requires **no** Supabase project,
network access or credentials.

## Running the suite

```bash
npm ci
npm test            # single run — same command CI uses
npm run test:watch  # watch mode
```

Vitest + Testing Library on jsdom. The UI suites mock the Supabase client; the
database is asserted statically from `supabase/migrations/` (see below for what
that does and does not cover).

## Layout

| File | Covers |
|---|---|
| `src/config/env.test.ts` | `VITE_*` env resolution and the `appEnv()` mapping |
| `src/test/auth.test.tsx` | AuthProvider: session lifecycle, sign-in / sign-up / reset, `loadAccess`, M7 error surfacing, signup-settings probe |
| `src/test/guards.test.tsx` | `RequireAuth` / `RequireOrganization` / `RequirePermission` redirects and the M7 retry screen |
| `src/test/LoginPage.test.tsx` | Sign-in / sign-up / reset flows, hidden sign-up when the server disables it |
| `src/test/BootstrapPage.test.tsx` | First-run bootstrap form: prefill, input normalization, RPC call, error handling |
| `src/test/ErrorBoundary.test.tsx` | Global error boundary fallback |
| `src/test/menuValidation.test.ts` | Menu validation rules: price parsing/bounds, name/description limits, image type & size, currency formatting |
| `src/test/MenuPage.test.tsx` | Menu page (manager/staff views): read-only gating, availability toggle + failure alert, inactive filter, category/item editors, image upload → signed URL render |
| `src/test/tablesValidation.test.ts` | Floor-plan validation rules: name/zone length bounds, capacity parsing |
| `src/test/reservationsValidation.test.ts` | Reservation validation: timezone conversion & DST edges, day bounds, duration/party/note bounds, half-open overlap pre-check, the client-side transition table |
| `src/test/TablesPage.test.tsx` | Tables page (manager/staff): zone grouping with counts, inactive filter, branch picker, read-only gating, load-error retry, editor modal (create/edit/validation) |
| `src/test/ReservationsPage.test.tsx` | Reservations page: day view, status transitions (cancel gated by permission), conflict pre-check before save, editor modal, viewer/staff/manager views |
| `src/test/ordersValidation.test.ts` | Order validation rules: allowed order/item transition tables mirroring the server guards, quantity parsing/bounds, notes limits, void reason bounds, live-line order total |
| `src/test/OrdersPage.test.tsx` | Orders page: list with status filter and both empty states, detail permission matrix (manager/staff/viewer, void and cancel denied to staff), status transitions and notes, dine-in/takeaway creation modal, item add/edit/void/remove |
| `src/test/KitchenPage.test.tsx` | Kitchen display: board columns and labels, category scoping, manual refresh, 15-second polling (fake timers), failed refresh keeps the last board, role-gated Start/Serve |
| `src/test/security.test.ts` | Static invariants over the SQL migrations and `public/_headers` |
| `src/test/fixtures.ts` | Deterministic IDs and payload factories |
| `src/test/authMock.ts` | Full `useAuth` context mock factory |

## Conventions

- `restoreMocks`, `unstubGlobals` and `unstubEnvs` are enabled in
  `vite.config.ts`: every mock's behaviour must be re-set in `beforeEach`.
- Mock the auth context with `vi.hoisted` mutable state plus
  `vi.mock('../lib/auth')`; build values through `authValue()` in
  `src/test/authMock.ts` so every field stays in sync with `AuthContextValue`.
- After `render()`, flush pending microtasks with `await act(async () => {})`
  (twice when a chained promise settles a state update).
- Submit forms via `fireEvent.submit(container.querySelector('form'))` to
  bypass jsdom constraint validation. Change inputs with `fireEvent.change`.
- Env-dependent modules (`src/config/env.ts`) read `import.meta.env` at import
  time: use `vi.stubEnv` + `vi.resetModules()` + dynamic `import()`.

## Static security suite

`src/test/security.test.ts` fails the build when the migrations or the shipped
security headers regress on:

- RLS enabled on every `app.*` table; every policy targets `authenticated` only
- `app.audit_log` append-only: select + insert grants, no update/delete
- audit integrity hardening: `log_audit` rejects a branch outside the caller's
  organization; a before-insert guard on `app.audit_log` server-derives actor
  attribution (client `actor_email` is always overwritten, never kept as a
  fallback) and keeps branch/organization pairs consistent
- every security-definer function pins `set search_path = ''`
- the bootstrap GUC guard (`app.bootstrap_org_id`) and the bootstrap RPC
  preconditions (authenticated caller, single organization, unique slug)
- schema lockdown: nothing granted to `anon`/`public`; only the required
  functions executable by `authenticated`
- permission catalog: 63 unique keys in `<department>.<action>` form across the
  two catalog inserts (58 foundation + 5 tables/reservations; orders & kitchen
  adds **no** keys), and every permission key referenced by the UI exists in
  the catalog
- menu migration (`20261008000002`): both tables RLS-enabled; **no delete
  surface** (no delete/truncate grants, no delete policies); members read,
  `menu.manage` writes; UPDATE policies carry both `using` and `with check`;
  composite FK pins items to a same-organization category; active-name unique
  index; column-level bounds (price > 0, name/description/image-path lengths);
  audit triggers on create/update; private `menu-images` bucket (2 MB,
  JPEG/PNG/WebP) with org-folder-scoped storage rules
- tables & reservations migration (`20261008000003`): both tables RLS-enabled;
  **no delete surface**; floor plan read by branch access, `tables.manage`
  writes; reservations gated `view`/`create`/`edit`/`cancel`, all compounded
  with branch access; UPDATE policies carry both `using` and `with check`;
  composite FKs pin reservations to a same-branch/organization table and
  tables to a same-organization branch; active-name unique index per branch;
  GiST exclusion constraint over `[starts_at, ends_at)` for
  pending/confirmed/seated statuses; `ends_at` derived by trigger; lifecycle
  guard with the cancel-permission gate; five permission keys backfilled onto
  existing system roles and re-seeded in `bootstrap_organization`
- orders & kitchen migration (`20261008000004`): exactly `app.orders` and
  `app.order_items` created and RLS-enabled, no `drop` anywhere, additive
  composite-key targets only; composite FKs pin orders to their branch and —
  through MATCH SIMPLE nullable legs — to a same-branch table/reservation,
  and lines to their parent order's branch + organization and to a
  same-organization menu item; column bounds (status enums, quantity 1–99,
  notes ≤ 200/500, price > 0, `line_total` stored generated, all-or-nothing
  void bookkeeping); orders gated `pos.create`/`pos.edit` with doubled
  UPDATE policies and no delete surface; order lines read by
  `pos.view`/`kitchen.view`, written by `pos.create`/`pos.edit`/
  `kitchen.manage`, with the schema's **only** delete surface — bounded to
  open orders by the guard trigger; `guard_order_status` and
  `guard_order_item_status` pinned (INSERT only at `open`, server-stamped
  `created_by`, freeze rules, transition chains, place/complete item
  requirements, the `pos.void` and `kitchen.manage`/`pos.edit` gates);
  exactly six triggers, including both `'branch'`-attributed audit triggers
  and the order-line delete audit; staff backfill (D6A) adds `kitchen.manage`
  idempotently and the re-declared `bootstrap_organization` mirrors it, while
  staff holds no `pos.void`, `pos.discount` or `tables.manage`; the
  re-declared functions keep identical signatures/ACLs and the migration ends
  with the PostgREST cache reload
- audit branch attribution (shared `audit_row_change` helper): only triggers
  for branch-scoped entities pass the `'branch'` argument — the
  cross-migration invocation list is asserted to be exactly
  `menu.category`/`menu.item` (no branch) plus `tables.table`/
  `reservations.reservation`/`pos.order`/`pos.order_item` (branch, order-line
  deletes included), so menu audit rows keep `branch_id` NULL **by
  construction**; the helper reads `new./old.branch_id` only inside the
  `tg_argv[1] = 'branch'` gate, and its signature/ACLs are unchanged by the
  re-declaration
- no service-role references anywhere in the frontend
- `public/_headers`: CSP (self + Google Fonts + the three Supabase origins,
  no `unsafe-inline`/`unsafe-eval`; `img-src` additionally allows the Supabase
  hosts for signed menu-image URLs), HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`

## CI integration

The `CI` workflow (`.github/workflows/ci.yml`) runs, in order: domain-verify
self-tests → `npm ci` → production dependency audit
(`npm audit --omit=dev --audit-level=high`) → lint → typecheck → **test** →
build. Dependabot (`.github/dependabot.yml`) opens weekly npm and
GitHub Actions update PRs, which go through the same gate.

## Not yet covered

- **Live RLS/integration tests** (two organizations, cross-org read/write
  probes, bootstrap RPC round-trip against Postgres) require either a fourth
  isolated Supabase project or a pgTAP harness. Both are deferred pending
  explicit approval — until then those behaviours are verified manually on
  staging during each module's acceptance run (menu, tables & reservations,
  orders & kitchen) and re-verified per deploy.
