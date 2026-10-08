# Nexarion Sky Restaurant — Hospitality Management ERP

**One business → one platform → one central database → multiple departments → controlled access.**

This repository contains the **approved foundation**: cloud deployment
architecture, central database schema, authentication, granular
roles/permissions and the audit core — plus two restaurant modules: **Menu**
(categories, items, prices, images — live in production) and **Tables &
Reservations** (branch floor plan + six-state guest reservations — built on
`feat/phase-2-tables-reservations`, staging acceptance pending). The remaining
ERP modules (rooms, POS, kitchen, inventory, purchasing, accounting, HR/payroll,
assets, reports/PDF, WhatsApp, M-Pesa, Gemini AI) are deliberately **not**
built yet.

## Architecture (cloud-only)

```
GitHub (source of truth)
  └─ GitHub Actions ── CI on every push/PR · migrations + deploy per environment
       ├─ develop  → Supabase STAGING project → Cloudflare Pages (staging)
       └─ main     → Supabase PRODUCTION project → Cloudflare Pages → LIVE DOMAIN
                          ▲ migrations are promoted: DEV (manual dispatch) → staging → production
Supabase = PostgreSQL + Auth + RLS + Storage (backend of record)
Cloudflare = hosting, DNS, domain, edge/serverless where needed
```

- **No local server, no local database, no local-only deployment.**
- **Three fully isolated Supabase projects**: development, staging, production.
- Secrets live only in GitHub/Cloudflare/Supabase secret stores — never in code,
  never in chat. The browser bundle contains only publishable anon keys; all
  authorization is enforced by Postgres RLS.

## Stack

React 19 + TypeScript + Vite · Supabase (PostgreSQL, Auth, RLS) · Cloudflare
Pages · GitHub Actions.

## Repository map

| Path | Purpose |
|---|---|
| `supabase/migrations/` | Foundation schema (organizations, branches, profiles, permission catalog, roles, audit log, RLS, bootstrap RPC) + menu tables and `menu-images` bucket + floor-plan and reservation tables |
| `src/` | ERP shell: auth flows, org bootstrap, permission-gated dashboard + audit pages, the menu module (`src/pages/menu/`, `src/lib/menu.ts`) and the tables & reservations module (`src/pages/tables/`, `src/pages/reservations/`, `src/lib/tables.ts`, `src/lib/reservations.ts`) |
| `.github/workflows/` | CI, dev migration dispatch, staging deploy, production deploy (+ custom-domain verify) |
| `docs/ARCHITECTURE.md` | System design, environment model, security model |
| `docs/PROVISIONING.md` | **Step-by-step runbook** to provision GitHub/Cloudflare/Supabase and go live |
| `docs/DATABASE.md` | Foundation schema and permission catalog reference |
| `docs/TESTING.md` | Test foundation: suites, conventions, static security invariants |
| `public/_headers` | Cloudflare Pages security headers (CSP, HSTS, frame-deny, nosniff, referrer policy) |

## Status

| Phase | State |
|---|---|
| 1. Architecture & database | ✅ Foundation schema + migrations |
| 2. Authentication & permissions | ✅ Supabase Auth, roles, granular permissions, RLS, audit core |
| Menu management (first restaurant module) | ✅ Live in production (released 2026-10-08) |
| Tables & reservations (second restaurant module) | 🔄 Implemented on `feat/phase-2-tables-reservations` — staging acceptance pending |
| Remaining roadmap phases | ⏳ Not started — each begins only with explicit approval |

## Commands (CI parity)

```bash
npm ci
npm run lint
npm run typecheck
npm test            # Vitest suite — see docs/TESTING.md
npm run build
```

The `CI` workflow additionally gates on
`npm audit --omit=dev --audit-level=high`; Dependabot opens weekly npm and
GitHub Actions dependency-update PRs. Deployment and database migrations run in
GitHub Actions; see `docs/PROVISIONING.md` before pushing.
