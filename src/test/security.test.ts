/**
 * Static security regression suite: asserts the invariants of the SQL
 * migrations and the shipped security headers without needing a live
 * database. The live RLS behavior tests (two organizations, cross-org
 * probes) run against the staging project and are a separate artefact.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs with the project root as cwd (import.meta.url is not a file:
// URL under the jsdom transform).
const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const ALL_SQL = MIGRATION_FILES.map((name) =>
  readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
).join('\n')
const ALL_SQL_FLAT = ALL_SQL.replace(/\s+/g, ' ')

// The catalog insert cannot be sliced on `;`: descriptions contain semicolons
// (e.g. 'Invite, activate and deactivate users; assign org'). Bound it by the
// statement that follows it instead.
const CATALOG_START = ALL_SQL.indexOf('insert into app.permissions')
const CATALOG_END = ALL_SQL.indexOf('create table app.roles')
const catalogSection =
  CATALOG_START >= 0 && CATALOG_END > CATALOG_START ? ALL_SQL.slice(CATALOG_START, CATALOG_END) : ''
const CATALOG_KEYS = new Set(
  [...catalogSection.matchAll(/'([a-z_]+\.[a-z_]+)'\s*,\s*'[a-z_]+'/g)].map((m) => m[1]),
)

/** Text of the LAST declaration of app.<name> (last CREATE wins in Postgres). */
function lastDeclaration(name: string): string {
  const marker = `create or replace function app.${name}(`
  const start = ALL_SQL.lastIndexOf(marker)
  expect(
    start,
    `migration set no longer declares app.${name}`,
  ).toBeGreaterThanOrEqual(0)
  const rest = ALL_SQL.slice(start)
  const bodyEnd = rest.indexOf('$$;')
  return bodyEnd >= 0 ? rest.slice(0, bodyEnd + 3) : rest
}

/** Just the signature/attributes of the last declaration (up to `as $$`). */
function lastDeclarationHeader(name: string): string {
  const declaration = lastDeclaration(name)
  const headerEnd = declaration.search(/\bas\s+\$\$/)
  return headerEnd >= 0 ? declaration.slice(0, headerEnd) : declaration
}

function collectSourceTexts(dir: string): string[] {
  const texts: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue
      texts.push(...collectSourceTexts(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      texts.push(readFileSync(full, 'utf8'))
    }
  }
  return texts
}

describe('migration inventory', () => {
  it('keeps the foundation migrations in place', () => {
    expect(MIGRATION_FILES).toEqual(
      expect.arrayContaining([
        '20260928000001_organizations_branches_profiles.sql',
        '20260928000002_permissions_roles_rls.sql',
        '20260928000003_audit_access_bootstrap.sql',
        '20260929000001_bootstrap_attach_guard_fix.sql',
        '20261008000001_audit_integrity_hardening.sql',
      ]),
    )
  })
})

describe('RLS and grants (static)', () => {
  it('enables row level security on every table the migrations create', () => {
    const created = [...ALL_SQL.matchAll(/create table\s+app\.(\w+)/gi)].map((m) => m[1])
    expect(created).toEqual(
      expect.arrayContaining([
        'organizations',
        'branches',
        'profiles',
        'permissions',
        'roles',
        'role_permissions',
        'user_roles',
        'user_branches',
        'audit_log',
      ]),
    )
    const enabled = new Set(
      [...ALL_SQL.matchAll(/alter table\s+app\.(\w+)\s+enable row level security/gi)].map(
        (m) => m[1],
      ),
    )
    for (const table of created) {
      expect(enabled.has(table), `RLS is not enabled on app.${table}`).toBe(true)
    }
  })

  it('keeps app.audit_log append-only (select + insert, nothing else)', () => {
    const auditGrants = [...ALL_SQL.matchAll(/grant\s[^;]+;/gi)]
      .map((m) => m[0])
      .filter((statement) => statement.includes('audit_log'))
    expect(auditGrants).toHaveLength(1)
    expect(auditGrants[0]).toMatch(/select/i)
    expect(auditGrants[0]).toMatch(/insert/i)
    expect(auditGrants[0]).not.toMatch(/\b(update|delete|truncate)\b/i)

    const auditPolicies = [
      ...ALL_SQL.matchAll(/create policy\s+\w+\s+on\s+app\.audit_log\s+for\s+(\w+)/gi),
    ]
      .map((m) => m[1].toLowerCase())
      .sort()
    expect(auditPolicies).toEqual(['insert', 'select'])
  })

  it('grants schema privileges to authenticated only (anon/public locked out)', () => {
    expect(ALL_SQL_FLAT).toContain('revoke all on schema app from anon;')
    expect(ALL_SQL_FLAT).toContain('revoke usage on schema app from public;')
    const grantees = [...ALL_SQL.matchAll(/grant\s[^;]+?\bto\s+(\w+)\s*;/gi)].map((m) =>
      m[1].toLowerCase(),
    )
    expect(grantees.length).toBeGreaterThanOrEqual(10)
    expect([...new Set(grantees)]).toEqual(['authenticated'])
  })

  it('creates every RLS policy for the authenticated role only', () => {
    const policies = [...ALL_SQL.matchAll(/create policy\s+(\w+)[\s\S]*?;/gi)].map(
      (m) => [m[1], m[0]] as const,
    )
    expect(policies.length).toBeGreaterThanOrEqual(20)
    for (const [name, statement] of policies) {
      expect(statement, `policy ${name} must target authenticated`).toMatch(
        /\bto\s+authenticated\b/,
      )
      expect(statement, `policy ${name} must not target anon/service_role`).not.toMatch(
        /\b(anon|service_role)\b/,
      )
    }
    // The permission catalog is the single intentionally world-readable
    // (to authenticated) table: exactly one `using (true)` policy.
    expect([...ALL_SQL.matchAll(/using \(true\)/gi)]).toHaveLength(1)
  })

  it('revokes default function execution and exposes only the required RPCs', () => {
    expect(ALL_SQL_FLAT).toContain('revoke execute on all functions in schema app from public;')
    expect(ALL_SQL_FLAT).toContain(
      'grant execute on function app.bootstrap_organization(text, text, text, text) to authenticated;',
    )
    expect(ALL_SQL_FLAT).toContain(
      'grant execute on function app.get_my_access() to authenticated;',
    )
  })
})

describe('authorization helpers (static)', () => {
  const HELPERS = [
    'is_org_member',
    'user_has_permission',
    'user_can_access_branch',
    'log_audit',
    'handle_new_user',
    'guard_profile_update',
    'get_my_access',
    'bootstrap_organization',
  ]

  it('pins an empty search_path on every security-definer function declaration', () => {
    const declarations = [
      ...ALL_SQL.matchAll(/create or replace function\s+app\.(\w+)\s*\([\s\S]*?\bas\s+\$\$/gi),
    ]
    expect(declarations.length).toBeGreaterThanOrEqual(11)
    for (const match of declarations) {
      const [header, name] = [match[0], match[1]] as const
      if (/security definer/i.test(header)) {
        expect(
          header,
          `app.${name} is security definer without set search_path = ''`,
        ).toContain("set search_path = ''")
      }
    }
  })

  it('declares every authorization helper as stable security definer with an empty search_path', () => {
    for (const name of HELPERS) {
      const header = lastDeclarationHeader(name)
      expect(header, `app.${name} must be security definer`).toMatch(/security definer/i)
      expect(header, `app.${name} must pin its search_path`).toContain("set search_path = ''")
    }
    expect(lastDeclarationHeader('get_my_access')).toMatch(/\bstable\b/)
  })

  it('exempts profile org-moves only inside the bootstrap transaction (GUC)', () => {
    const guard = lastDeclaration('guard_profile_update')
    const gucCheck = guard.indexOf("current_setting('app.bootstrap_org_id', true)")
    const deny = guard.indexOf('raise exception')
    expect(gucCheck).toBeGreaterThanOrEqual(0)
    expect(deny).toBeGreaterThan(gucCheck)

    const bootstrap = lastDeclaration('bootstrap_organization')
    expect(bootstrap).toContain("set_config('app.bootstrap_org_id', v_org_id::text, true)")
  })
})

describe('bootstrap RPC preconditions (static)', () => {
  it('rejects anonymous callers, double bootstrap and taken slugs', () => {
    const bootstrap = lastDeclaration('bootstrap_organization').replace(/\s+/g, ' ')
    expect(bootstrap).toContain('if auth.uid() is null then')
    expect(bootstrap).toContain('Authentication required.')
    expect(bootstrap).toContain('already belongs to an organization')
    expect(bootstrap).toContain('is already taken')
  })
})

describe('audit integrity hardening (static)', () => {
  it('validates a non-null audit branch against the caller organization before insert', () => {
    const fn = lastDeclaration('log_audit').replace(/\s+/g, ' ')
    expect(fn).toContain('p_branch_id is not null')
    expect(fn).toContain('b.organization_id = v_org_id')
    expect(fn).toContain('does not belong to the caller')
    const validation = fn.indexOf('does not belong to the caller')
    const insert = fn.indexOf('insert into app.audit_log')
    expect(validation).toBeGreaterThanOrEqual(0)
    expect(insert).toBeGreaterThan(validation)
  })

  it('routes every audit insert through a before-insert integrity trigger', () => {
    const auditTriggers = [...ALL_SQL.matchAll(/create trigger\s+\w+[\s\S]*?;/gi)]
      .map((m) => m[0].replace(/\s+/g, ' '))
      .filter((statement) => statement.includes('on app.audit_log'))
    expect(auditTriggers).toHaveLength(1)
    expect(auditTriggers[0]).toMatch(/before insert on app\.audit_log/)
    expect(auditTriggers[0]).toMatch(/execute function app\.guard_audit_integrity\(\)/)
  })

  it('server-derives the audit actor so clients cannot spoof attribution', () => {
    const guard = lastDeclaration('guard_audit_integrity').replace(/\s+/g, ' ')
    expect(guard).toContain('v_uid uuid := auth.uid()')
    expect(guard).toContain('if v_uid is not null then')
    expect(guard).toContain('new.actor_id := v_uid')
    expect(guard).toContain('select u.email from auth.users u where u.id = v_uid')
    expect(guard).toContain("auth.jwt() ->> 'email'")
    // The stored email is assigned exactly once, from server-derived values;
    // the column is never read back as a fallback, so a client-supplied
    // actor_email can never survive the trigger.
    expect(guard.match(/new\.actor_email/g)).toHaveLength(1)
    expect(guard).toContain('new.actor_email := v_email')
    expect(guard).not.toContain('coalesce(new.actor_email')
  })

  it('keeps audit branch/organization consistent and revokes the guard from public', () => {
    const guard = lastDeclaration('guard_audit_integrity').replace(/\s+/g, ' ')
    expect(guard).toContain('new.branch_id is not null')
    expect(guard).toContain('b.organization_id = new.organization_id')
    expect(guard).toContain('p.organization_id = b.organization_id')
    expect(guard).toContain('raise exception')
    expect(ALL_SQL_FLAT).toContain(
      'revoke execute on function app.guard_audit_integrity() from public;',
    )
  })
})

describe('permission catalog (static)', () => {
  const DEPARTMENTS = [
    'accounting',
    'assets',
    'bookings',
    'hr',
    'inventory',
    'kitchen',
    'management',
    'organization',
    'purchasing',
    'restaurant',
    'rooms',
  ]

  it('seeds 58 unique, well-formed permission keys', () => {
    const rows = [
      ...catalogSection.matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,\s*'([a-z_]+)'/g),
    ].map((m) => ({ key: m[1], department: m[2] }))
    expect(rows).toHaveLength(58)
    expect(new Set(rows.map((row) => row.key)).size).toBe(58)
    for (const row of rows) {
      expect(DEPARTMENTS).toContain(row.department)
    }
    expect(new Set(rows.map((row) => row.department))).toEqual(new Set(DEPARTMENTS))
  })

  it('references only catalog permission keys from the UI', () => {
    const referenced = new Set<string>()
    for (const text of collectSourceTexts(join(ROOT, 'src'))) {
      for (const match of text.matchAll(/['"]([a-z_]+\.[a-z_]+)['"]/g)) {
        referenced.add(match[1])
      }
    }
    expect(referenced.has('dashboard.view')).toBe(true)
    expect(referenced.has('audit.view')).toBe(true)
    for (const key of referenced) {
      expect(CATALOG_KEYS.has(key), `src references unknown permission key '${key}'`).toBe(true)
    }
  })
})

describe('frontend secret hygiene', () => {
  it('never references service-role credentials in the frontend app', () => {
    for (const text of collectSourceTexts(join(ROOT, 'src'))) {
      expect(text).not.toMatch(/service[_-]?role/i)
    }
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(/service[_-]?role/i)
  })
})

describe('static security headers (public/_headers)', () => {
  const headersDoc = readFileSync(join(ROOT, 'public', '_headers'), 'utf8')
  const csp = headersDoc.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? ''

  it('ships all five required headers for every path', () => {
    expect(headersDoc).toMatch(/^\/\*$/m)
    expect(headersDoc).toMatch(/Content-Security-Policy:/)
    expect(headersDoc).toMatch(/Strict-Transport-Security:\s*max-age=31536000/)
    expect(headersDoc).toMatch(/X-Frame-Options:\s*DENY/)
    expect(headersDoc).toMatch(/X-Content-Type-Options:\s*nosniff/)
    expect(headersDoc).toMatch(/Referrer-Policy:\s*strict-origin-when-cross-origin/)
  })

  it('restricts the CSP to self, Google Fonts and the three Supabase APIs', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
    for (const host of [
      'https://kypnwtgbldoaisjmkjin.supabase.co',
      'https://cxlwrjwzykityppxpqnm.supabase.co',
      'https://ibbbaowkeexqmzwobhmm.supabase.co',
    ]) {
      expect(csp, `CSP connect-src must allow ${host}`).toContain(host)
    }
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
  })
})
