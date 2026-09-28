# Nexarion Sky Restaurant — Hospitality Management ERP

**One business → one platform → one central database → multiple departments → controlled access.**

This repository currently contains the **approved Phase 1+2 foundation**: cloud
deployment architecture, central database schema, authentication, granular
roles/permissions and the audit core — for the full 16-phase ERP plan (rooms,
POS, kitchen, inventory, purchasing, accounting, HR/payroll, assets,
reports/PDF, WhatsApp, M-Pesa, Gemini AI). ERP modules are deliberately **not**
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
| `supabase/migrations/` | Foundation schema: organizations, branches, profiles, permission catalog, roles, audit log, RLS, bootstrap RPC |
| `src/` | ERP shell: auth flows, org bootstrap, permission-gated dashboard + audit pages |
| `.github/workflows/` | CI, dev migration dispatch, staging deploy, production deploy (+ custom-domain verify) |
| `docs/ARCHITECTURE.md` | System design, environment model, security model |
| `docs/PROVISIONING.md` | **Step-by-step runbook** to provision GitHub/Cloudflare/Supabase and go live |
| `docs/DATABASE.md` | Foundation schema and permission catalog reference |

## Status

| Phase | State |
|---|---|
| 1. Architecture & database | ✅ Foundation schema + migrations |
| 2. Authentication & permissions | ✅ Supabase Auth, roles, granular permissions, RLS, audit core |
| 3–16 | ⏳ Not started — each begins only with explicit approval |

## Commands (CI parity)

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

Deployment and database migrations run in GitHub Actions; see
`docs/PROVISIONING.md` before pushing.
