# Provisioning Runbook

Execute these steps in order. You paste secrets **only** into the GitHub /
Cloudflare / Supabase secret stores — never into chat, issues, or code.
Estimated total time: ~60 minutes, most of it waiting for DNS/certificates.

---

## 0. Prerequisites

- A GitHub account.
- A Cloudflare account with **your existing Nexarion Sky Restaurant domain's
  nameservers pointed to Cloudflare** (Dashboard → select account → Add site →
  change nameservers at your registrar). Status must show "Active".
- A Supabase account (supabase.com — sign in with GitHub is fine).

Naming used below — adjust freely, but keep the three projects distinct:

| Environment | Supabase project | Cloudflare Pages project |
|---|---|---|
| Development | `nexarion-sky-dev` | — (no deployment) |
| Staging | `nexarion-sky-staging` | `nexarion-sky-staging` |
| Production | `nexarion-sky-prod` | `nexarion-sky` |

---

## 1. GitHub repository

1. Create a **private** repository named `nexarion-sky-restaurant` (no README —
   this codebase replaces it).
2. From the directory containing this codebase:

   ```bash
   git init -b main
   git add .
   git commit -m "Foundation: cloud architecture, database schema, auth, permissions, audit"
   git remote add origin https://github.com/<you>/nexarion-sky-restaurant.git
   git push -u origin main
   git checkout -b develop
   git push -u origin develop
   ```

3. Branch protection (Settings → Branches):
   - `main`: require a pull request before merging; require status check
     **CI** (the check-run name produced by `.github/workflows/ci.yml`);
     require conversation resolution.
   - `develop`: require the same CI check (PRs into `develop` gate staging).

## 2. Supabase — three isolated projects

For each of **dev**, **staging**, **prod** (Settings → General after creation):

1. New project → name per table above → **strong, unique database password**
   (store each in a password manager immediately) → region: pick the region
   closest to your operation (for East Africa, `af-south-1` Johannesburg is the
   closest available Supabase region).
2. Collect from **Settings → API / Data API**:
   - `Project URL` (e.g. `https://abcdefgh.supabase.co`)
   - `anon public` key
   - `Project ID` (= the `ref` in the URL subdomain)

## 3. GitHub secrets and variables

### Repository secrets (Settings → Secrets and variables → Actions → New repository secret)

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens → "Generate new token" (name: `github-actions`) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → "Create Token" → use the **Edit Cloudflare Pages** template, then add **DNS:Edit** permission for your account |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → any domain → right-hand column "Account ID" |

### Repository variables (same page, **Variables** tab)

| Variable | Value |
|---|---|
| `APP_CUSTOM_DOMAIN` | `nexarionsky.com` — the exact host Cloudflare routes to the production deployment |
| `PRODUCTION_ENABLED` | **Leave unset for now.** Set to `true` only after staging passes the full verification checklist (section 6, steps 1–4). While unset, **Deploy Production** skips every job on push to `main`, so production cannot deploy (or migrate) early. |

### Environments (Settings → Environments → New environment)

Create three environments: `development`, `staging`, `production`.
For **production** enable "Required reviewers" and add yourself.

Secrets and variables **per environment**:

| Name | development | staging | production |
|---|---|---|---|
| Secret `SUPABASE_DB_PASSWORD` | dev DB password | staging DB password | prod DB password |
| Variable `SUPABASE_PROJECT_REF` | dev project ref | staging project ref | prod project ref |
| Secret `VITE_SUPABASE_URL` | dev Project URL | staging Project URL | prod Project URL |
| Secret `VITE_SUPABASE_ANON_KEY` | dev anon key | staging anon key | prod anon key |
| Variable `CLOUDFLARE_PAGES_PROJECT` | — | `nexarion-sky-staging` | `nexarion-sky` |
| Variable `STAGING_URL` | — | `https://<your-staging>.pages.dev` (from the first staging deploy log) | — |

> `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` are
> repository-level (above) and shared by the environments — rotate them on any
> suspected compromise.

## 4. Cloudflare Pages projects

In Cloudflare dashboard → **Workers & Pages → Create → Pages → "Upload assets"**
is not used; the projects are created empty and GitHub Actions uploads builds:

1. **Staging project**: Workers & Pages → Create application → Pages →
   "Connect to Git" is *not* needed — instead scroll to **"Direct Upload"**:
   create a Pages project named `nexarion-sky-staging` (creating via
   dashboard once lets Actions upload later; you can also run
   `npx wrangler@latest pages project create nexarion-sky-staging`).
2. **Production project**: same, named `nexarion-sky`.
3. No build settings are needed in the dashboard — Actions builds and uploads.

### DNS for the live domain

`APP_CUSTOM_DOMAIN` (`nexarionsky.com`) is attached to the production
Pages project **automatically by the deploy workflow** (it calls the Cloudflare
API; CNAME record is created in your zone). Requirements:

- The zone's nameservers are already at Cloudflare (step 0).
- The API token has `DNS:Edit` (step 3).
- Cloudflare provisions the TLS certificate automatically after attachment —
  the domain answers HTTPS within minutes.

If you prefer a different host (e.g. `app.nexarionsky.com`) instead of the
apex domain, set `APP_CUSTOM_DOMAIN` to it; Pages supports apex custom
domains too.

## 5. Supabase Auth configuration (per project)

Dashboard → Authentication → Sign In / Providers:

- Keep **Email** enabled.
- Decide email confirmation:
  - *Dev/staging*: turn **Confirm email OFF** for fast testing.
  - *Production*: turn it **ON** (recommended). Set up a custom SMTP provider
    (Authentication → Emails → SMTP) before going live so confirmation and
    password-reset mail doesn't come from the shared quota.
- Authentication → URL Configuration:
  - Site URL: staging → your `*.pages.dev` URL; production → `https://nexarionsky.com`.
  - Redirect URLs: add the same URLs (wildcard `https://nexarionsky.com/**` is convenient).

## 6. First end-to-end verification

1. **Apply migrations to Development**: GitHub → Actions → "Apply migrations to
   Development" → Run workflow. Confirm it goes green; in the dev project
   (Table Editor) you should see schema `app` with all tables.
2. **Verify staging pipeline**: push any commit to `develop` (e.g. README
   tweak). The **Deploy Staging** workflow must: migrate the staging project →
   build → deploy → print the `*.pages.dev` URL.
3. **Create the first user**: open the staging URL → Create account → (if
   confirmation is off you're signed in immediately) → the app asks you to set
   up the business → submit → you land on the Dashboard as **owner**.
4. **Prove the permission model**:
   - Dashboard shows your organization, branches, permission chips (fetched
     through RLS).
   - Create a second account in an incognito window; it belongs to **no
     organization** — it must see the setup screen, not your data.
   - Audit page shows the `organization.bootstrap` entry.
   - Then run the automated layer: Actions → **Verify Staging** → Run workflow
     (set the staging variable `STAGING_URL` first). It checks the SPA is
     served, PostgREST/`app` schema are exposed, RLS blocks anonymous reads on
     every `app` table, and Auth is healthy — all four must be green.
5. **Enable production deployment** — only after steps 1–4 are green: set the
   repository variable `PRODUCTION_ENABLED=true` (Settings → Secrets and
   variables → Actions → Variables). Until then, pushes to `main` trigger
   **Deploy Production** but every job is skipped.
6. **Promote to production**: PR `develop` → `main` (required CI passes),
   merge → **Deploy Production** runs: migrate prod → deploy → attach
   `nexarionsky.com` → verify step confirms the domain.
7. Open `https://nexarionsky.com` → create the production owner account →
   set up the organization. Production is live.

## 7. Operating rules

- **Never** run `migrate-dev` against production refs; the production workflow
  only ever links `vars.SUPABASE_PROJECT_REF` of the `production` environment.
- Migration changes ride the same PR as the code that uses them, so CI proves
  code↔schema compatibility before deploy.
- Rollback = revert commit + re-deploy. Database changes are forward-only;
  write additive migrations.
- Rotating secrets: replace in the relevant store only; no code change needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `supabase link` fails in Actions | Check `SUPABASE_ACCESS_TOKEN` scope and `SUPABASE_DB_PASSWORD` for that env's project ref |
| Pages deploy 403/404 | Project name mismatch: `CLOUDFLARE_PAGES_PROJECT` must equal the dashboard project name; token needs Pages:Edit |
| Custom domain verify step fails | DNS propagation can take a few minutes — re-run the failed job; check the CNAME exists in Cloudflare DNS |
| Login works on staging, not prod | `VITE_SUPABASE_URL`/`ANON_KEY` for `production` environment point at the wrong project, or Auth URL Configuration lacks the prod domain |
