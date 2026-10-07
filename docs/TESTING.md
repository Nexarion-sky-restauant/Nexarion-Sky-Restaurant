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
- permission catalog: 58 unique keys in `<department>.<action>` form, and every
  permission key referenced by the UI exists in the catalog
- no service-role references anywhere in the frontend
- `public/_headers`: CSP (self + Google Fonts + the three Supabase origins,
  no `unsafe-inline`/`unsafe-eval`), HSTS, `X-Frame-Options: DENY`,
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
  explicit approval — until then those behaviours were verified manually on
  staging during Phase 2 and are re-verified per deploy.
