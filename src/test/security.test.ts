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

// Phase 2 (tables & reservations) appends a second catalog insert; bound it
// by the role_permissions backfill that follows it.
const CATALOG2_START = ALL_SQL.indexOf('insert into app.permissions', CATALOG_END)
const CATALOG2_END = ALL_SQL.indexOf('insert into app.role_permissions', CATALOG2_START)
const catalog2Section =
  CATALOG2_START >= 0 && CATALOG2_END > CATALOG2_START
    ? ALL_SQL.slice(CATALOG2_START, CATALOG2_END)
    : ''
const CATALOG2_KEYS = new Set(
  [...catalog2Section.matchAll(/'([a-z_]+\.[a-z_]+)'\s*,\s*'[a-z_]+'/g)].map((m) => m[1]),
)
const ALL_CATALOG_KEYS = new Set([...CATALOG_KEYS, ...CATALOG2_KEYS])

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
        '20261008000002_menu_management.sql',
        '20261008000003_tables_reservations.sql',
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
    'guard_reservation_status',
    'audit_row_change',
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

describe('menu management migration (static)', () => {
  const MENU_SQL = readFileSync(
    join(MIGRATIONS_DIR, '20261008000002_menu_management.sql'),
    'utf8',
  )
  const MENU_FLAT = MENU_SQL.replace(/\s+/g, ' ')

  it('creates both menu tables with row level security enabled', () => {
    const created = [...MENU_SQL.matchAll(/create table\s+app\.(\w+)/gi)].map((m) => m[1])
    expect(created).toEqual(['menu_categories', 'menu_items'])
    const enabled = new Set(
      [...MENU_SQL.matchAll(/alter table\s+app\.(\w+)\s+enable row level security/gi)].map(
        (m) => m[1],
      ),
    )
    for (const table of created) {
      expect(enabled.has(table), `RLS is not enabled on app.${table}`).toBe(true)
    }
  })

  it('exposes no delete surface on the menu tables or the storage bucket', () => {
    const grants = [...MENU_SQL.matchAll(/grant\s[^;]+;/gi)].map((m) => m[0])
    expect(grants.length).toBeGreaterThanOrEqual(3)
    for (const statement of grants) {
      expect(statement).not.toMatch(/\b(delete|truncate)\b/i)
    }

    const policies = [...MENU_SQL.matchAll(/create policy\s+\w+[\s\S]*?;/gi)].map((m) => m[0])
    expect(policies).toHaveLength(9)
    for (const statement of policies) {
      expect(statement).not.toMatch(/\bfor\s+delete\b/i)
    }
  })

  it('scopes table policies per command: members read, menu.manage writes', () => {
    const tablePolicies = [
      ...MENU_SQL.matchAll(
        /create policy\s+(\w+)\s+on\s+app\.(menu_categories|menu_items)\s+for\s+(\w+)([\s\S]*?);/gi,
      ),
    ].map((m) => ({ name: m[1], command: m[3].toLowerCase(), body: m[4] }))

    expect(tablePolicies).toHaveLength(6)
    expect(tablePolicies.map((policy) => policy.command).sort()).toEqual([
      'insert',
      'insert',
      'select',
      'select',
      'update',
      'update',
    ])
    for (const policy of tablePolicies) {
      expect(policy.body, `policy ${policy.name} must target authenticated`).toMatch(
        /\bto authenticated\b/,
      )
      expect(policy.body).toContain('app.is_org_member(organization_id)')
      if (policy.command === 'select') {
        expect(policy.body).not.toContain('user_has_permission')
      } else {
        expect(policy.body).toContain("app.user_has_permission('menu.manage')")
      }
    }

    // UPDATE policies carry both USING and WITH CHECK, so a row can neither be
    // read-into nor written-from another organization.
    const updatePolicies = tablePolicies.filter((policy) => policy.command === 'update')
    expect(updatePolicies).toHaveLength(2)
    for (const policy of updatePolicies) {
      expect(policy.body.match(/app\.is_org_member\(organization_id\)/g)).toHaveLength(2)
      expect(policy.body.match(/app\.user_has_permission\('menu\.manage'\)/g)).toHaveLength(2)
    }
  })

  it('structurally pins items to their own organization and unique active names', () => {
    expect(MENU_FLAT).toContain(
      'constraint menu_categories_id_org_key unique (id, organization_id)',
    )
    expect(MENU_FLAT).toContain(
      'foreign key (category_id, organization_id) references app.menu_categories (id, organization_id) on delete restrict',
    )
    expect(MENU_FLAT).toContain(
      'create unique index menu_categories_org_name_active_idx on app.menu_categories (organization_id, lower(btrim(name))) where is_active;',
    )
  })

  it('bounds names, descriptions, prices and image paths at the column level', () => {
    expect(MENU_FLAT).toContain(
      'constraint menu_categories_name_length check (char_length(btrim(name)) between 1 and 120)',
    )
    expect(MENU_FLAT).toContain(
      'constraint menu_items_name_length check (char_length(btrim(name)) between 1 and 120)',
    )
    expect(MENU_FLAT).toContain('constraint menu_items_price_positive check (price > 0)')
    expect(MENU_FLAT).toContain(
      'constraint menu_items_image_path_length check (image_path is null or char_length(image_path) <= 400)',
    )
  })

  it('audits menu create and update rows through the generic trigger helper', () => {
    const declarations = [
      ...MENU_SQL.matchAll(
        /create or replace function\s+app\.audit_row_change\s*\([\s\S]*?\bas\s+\$\$/gi,
      ),
    ]
    expect(declarations).toHaveLength(1)
    expect(declarations[0][0]).toMatch(/security definer/i)
    expect(declarations[0][0]).toContain("set search_path = ''")

    expect(MENU_FLAT).toContain("v_action := 'create';")
    expect(MENU_FLAT).toContain("v_action := 'update';")
    expect(MENU_FLAT).toContain("v_action := 'delete';")
    expect(MENU_FLAT).toContain('perform app.log_audit(')
    expect(MENU_FLAT).toContain('to_jsonb(old)')
    expect(MENU_FLAT).toContain('to_jsonb(new)')
    expect(MENU_FLAT).toContain('coalesce(tg_argv[0], tg_table_name)')
  })

  it('wires exactly two audit triggers and two updated_at triggers', () => {
    const triggers = [...MENU_SQL.matchAll(/create trigger\s+\w+[\s\S]*?;/gi)].map((m) =>
      m[0].replace(/\s+/g, ' ').trim(),
    )
    expect(triggers).toHaveLength(4)

    const auditTriggers = triggers.filter((statement) => statement.includes('audit_row_change'))
    expect(auditTriggers).toEqual([
      "create trigger menu_categories_audit_change after insert or update on app.menu_categories for each row execute function app.audit_row_change('menu.category');",
      "create trigger menu_items_audit_change after insert or update on app.menu_items for each row execute function app.audit_row_change('menu.item');",
    ])
    for (const statement of auditTriggers) {
      expect(statement).not.toMatch(/\bdelete\b/)
    }

    const updatedAtTriggers = triggers.filter((statement) => statement.includes('set_updated_at'))
    expect(updatedAtTriggers).toHaveLength(2)
    for (const statement of updatedAtTriggers) {
      expect(statement).toMatch(/before update on app\.(menu_categories|menu_items)/)
    }
  })

  it('provisions the private menu-images bucket with size and MIME limits', () => {
    expect(MENU_FLAT).toContain(
      "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('menu-images', 'menu-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']) on conflict (id) do nothing;",
    )
  })

  it('scopes storage objects to the owning organization and menu managers', () => {
    const storagePolicies = [
      ...MENU_SQL.matchAll(
        /create policy\s+(\w+)\s+on\s+storage\.objects\s+for\s+(\w+)([\s\S]*?);/gi,
      ),
    ].map((m) => ({ name: m[1], command: m[2].toLowerCase(), body: m[3] }))

    expect(storagePolicies.map((policy) => policy.command).sort()).toEqual([
      'insert',
      'select',
      'update',
    ])
    for (const policy of storagePolicies) {
      expect(policy.body, `policy ${policy.name} must target authenticated`).toMatch(
        /\bto authenticated\b/,
      )
      expect(policy.body).toContain("bucket_id = 'menu-images'")
      expect(policy.body).toContain(
        'app.is_org_member(((storage.foldername(name))[1])::uuid)',
      )
      if (policy.command !== 'select') {
        expect(policy.body).toContain("app.user_has_permission('menu.manage')")
      }
    }
  })

  it('grants menu access to authenticated and locks the helper away from public', () => {
    expect(MENU_FLAT).toContain(
      'grant select, insert, update on app.menu_categories to authenticated;',
    )
    expect(MENU_FLAT).toContain(
      'grant select, insert, update on app.menu_items to authenticated;',
    )
    expect(MENU_FLAT).toContain(
      'revoke execute on function app.audit_row_change() from public;',
    )
    expect(MENU_FLAT).toContain(
      'grant execute on function app.audit_row_change() to authenticated;',
    )
    expect(MENU_FLAT).toContain("notify pgrst, 'reload schema cache';")
  })
})

describe('tables and reservations migration (static)', () => {
  const TABLES_SQL = readFileSync(
    join(MIGRATIONS_DIR, '20261008000003_tables_reservations.sql'),
    'utf8',
  )
  const TABLES_FLAT = TABLES_SQL.replace(/\s+/g, ' ')

  it('creates both tables with row level security enabled', () => {
    const created = [...TABLES_SQL.matchAll(/create table\s+app\.(\w+)/gi)].map((m) => m[1])
    expect(created).toEqual(['restaurant_tables', 'table_reservations'])
    const enabled = new Set(
      [...TABLES_SQL.matchAll(/alter table\s+app\.(\w+)\s+enable row level security/gi)].map(
        (m) => m[1],
      ),
    )
    for (const table of created) {
      expect(enabled.has(table), `RLS is not enabled on app.${table}`).toBe(true)
    }
  })

  it('exposes no delete surface on the floor plan or reservations', () => {
    const grants = [...TABLES_SQL.matchAll(/grant\s[^;]+;/gi)].map((m) => m[0])
    expect(grants.length).toBeGreaterThanOrEqual(4)
    for (const statement of grants) {
      expect(statement).not.toMatch(/\b(delete|truncate)\b/i)
    }

    const policies = [...TABLES_SQL.matchAll(/create policy\s+\w+[\s\S]*?;/gi)].map((m) => m[0])
    expect(policies).toHaveLength(6)
    for (const statement of policies) {
      expect(statement).not.toMatch(/\bfor\s+delete\b/i)
    }
  })

  it('scopes table policies per command: members read, tables.manage writes', () => {
    const tablePolicies = [
      ...TABLES_SQL.matchAll(
        /create policy\s+(\w+)\s+on\s+app\.restaurant_tables\s+for\s+(\w+)([\s\S]*?);/gi,
      ),
    ].map((m) => ({ name: m[1], command: m[2].toLowerCase(), body: m[3].replace(/\s+/g, ' ') }))

    expect(tablePolicies).toHaveLength(3)
    expect(tablePolicies.map((policy) => policy.command).sort()).toEqual([
      'insert',
      'select',
      'update',
    ])
    for (const policy of tablePolicies) {
      expect(policy.body, `policy ${policy.name} must target authenticated`).toMatch(
        /\bto authenticated\b/,
      )
      expect(policy.body).toContain('app.user_can_access_branch(branch_id)')
      if (policy.command === 'select') {
        expect(policy.body).not.toContain('user_has_permission')
      } else {
        expect(policy.body).toContain("app.user_has_permission('tables.manage')")
      }
    }

    // UPDATE carries both USING and WITH CHECK, so a table can neither be
    // read-into nor written-from another branch or organization.
    const updatePolicies = tablePolicies.filter((policy) => policy.command === 'update')
    expect(updatePolicies).toHaveLength(1)
    expect(updatePolicies[0].body.match(/app\.user_can_access_branch\(branch_id\)/g)).toHaveLength(2)
    expect(updatePolicies[0].body.match(/app\.user_has_permission\('tables\.manage'\)/g)).toHaveLength(2)
  })

  it('scopes reservation policies per command: view, create, edit or cancel', () => {
    const reservationPolicies = [
      ...TABLES_SQL.matchAll(
        /create policy\s+(\w+)\s+on\s+app\.table_reservations\s+for\s+(\w+)([\s\S]*?);/gi,
      ),
    ].map((m) => ({ name: m[1], command: m[2].toLowerCase(), body: m[3].replace(/\s+/g, ' ') }))

    expect(reservationPolicies).toHaveLength(3)
    expect(reservationPolicies.map((policy) => policy.command).sort()).toEqual([
      'insert',
      'select',
      'update',
    ])
    for (const policy of reservationPolicies) {
      expect(policy.body, `policy ${policy.name} must target authenticated`).toMatch(
        /\bto authenticated\b/,
      )
      expect(policy.body).toContain('app.user_can_access_branch(branch_id)')
    }

    const requiredPermission: Record<string, string> = {
      select: "app.user_has_permission('reservations.view')",
      insert: "app.user_has_permission('reservations.create')",
      update:
        "app.user_has_permission('reservations.edit') or app.user_has_permission('reservations.cancel')",
    }
    for (const policy of reservationPolicies) {
      expect(policy.body).toContain(requiredPermission[policy.command])
    }

    const updatePolicies = reservationPolicies.filter((policy) => policy.command === 'update')
    expect(updatePolicies).toHaveLength(1)
    expect(updatePolicies[0].body.match(/app\.user_can_access_branch\(branch_id\)/g)).toHaveLength(2)
    expect(
      updatePolicies[0].body.match(/user_has_permission\('reservations\.edit'\)/g),
    ).toHaveLength(2)
    expect(
      updatePolicies[0].body.match(/user_has_permission\('reservations\.cancel'\)/g),
    ).toHaveLength(2)
  })

  it('structurally pins reservations to their own table, branch and organization', () => {
    expect(TABLES_FLAT).toContain(
      'alter table app.branches add constraint branches_id_org_key unique (id, organization_id);',
    )
    expect(TABLES_FLAT).toContain(
      'constraint restaurant_tables_branch_fk foreign key (branch_id, organization_id) references app.branches (id, organization_id) on delete restrict,',
    )
    expect(TABLES_FLAT).toContain(
      'constraint restaurant_tables_id_branch_org_key unique (id, branch_id, organization_id),',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_table_fk foreign key (table_id, branch_id, organization_id) references app.restaurant_tables (id, branch_id, organization_id) on delete restrict,',
    )
    expect(TABLES_FLAT).toContain(
      'create unique index restaurant_tables_branch_name_active_idx on app.restaurant_tables (branch_id, lower(btrim(name))) where is_active;',
    )
  })

  it('prevents overlapping active reservations per table at write time', () => {
    expect(TABLES_FLAT).toContain(
      'create extension if not exists btree_gist with schema extensions;',
    )
    expect(TABLES_FLAT).toContain(
      "constraint table_reservations_no_overlap exclude using gist ( table_id with =, tstzrange(starts_at, ends_at) with && ) where (status in ('pending', 'confirmed', 'seated'))",
    )
  })

  it('derives ends_at from starts_at + duration on the server', () => {
    expect(TABLES_FLAT).toContain('ends_at timestamptz not null,')
    expect(TABLES_FLAT).not.toContain('ends_at timestamptz not null default')
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_ends_after_start check (ends_at > starts_at),',
    )

    const setWindow = lastDeclaration('set_reservation_window').replace(/\s+/g, ' ')
    expect(setWindow).not.toMatch(/security definer/i)
    expect(setWindow).toContain(
      'new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);',
    )
  })

  it('bounds names, guests, parties, durations and notes at the column level', () => {
    expect(TABLES_FLAT).toContain(
      'constraint restaurant_tables_name_length check (char_length(btrim(name)) between 1 and 80)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint restaurant_tables_zone_length check (char_length(btrim(zone)) between 1 and 60)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint restaurant_tables_capacity_bounds check (capacity between 1 and 100)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_guest_name_length check (char_length(btrim(guest_name)) between 1 and 120)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_guest_phone_length check (char_length(guest_phone) <= 32)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_party_size_bounds check (party_size between 1 and 100)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_duration_bounds check (duration_minutes between 15 and 480)',
    )
    expect(TABLES_FLAT).toContain(
      'constraint table_reservations_notes_length check (char_length(notes) <= 2000)',
    )
    expect(TABLES_FLAT).toContain(
      "constraint table_reservations_status_check check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'))",
    )
  })

  it('enforces the reservation lifecycle from insert through cancel in the guard trigger', () => {
    const guard = lastDeclaration('guard_reservation_status').replace(/\s+/g, ' ')
    expect(guard).toMatch(/security definer/i)
    expect(guard).toContain("set search_path = ''")

    expect(guard).toContain("if new.status not in ('pending', 'confirmed') then")
    expect(guard).toContain('A reservation cannot be created with status')
    expect(guard).toContain('if new.status = old.status then')
    expect(guard).toContain(
      "(old.status = 'pending' and new.status in ('confirmed', 'cancelled')) or (old.status = 'confirmed' and new.status in ('seated', 'cancelled', 'no_show')) or (old.status = 'seated' and new.status = 'completed')",
    )

    // Moving a reservation into cancelled requires the dedicated permission;
    // the gate must sit after the transition-table check.
    const transitionCheck = guard.indexOf('Invalid reservation transition')
    const cancelGate = guard.indexOf("app.user_has_permission('reservations.cancel')")
    expect(transitionCheck).toBeGreaterThanOrEqual(0)
    expect(cancelGate).toBeGreaterThan(transitionCheck)
    expect(guard).toContain(
      "if new.status = 'cancelled' and not app.user_has_permission('reservations.cancel') then",
    )
  })

  it('wires exactly six triggers with the audit triggers opting into branch attribution', () => {
    const triggers = [...TABLES_SQL.matchAll(/create trigger\s+\w+[\s\S]*?;/gi)].map((m) =>
      m[0].replace(/\s+/g, ' ').trim(),
    )
    expect(triggers).toEqual([
      'create trigger restaurant_tables_set_updated_at before update on app.restaurant_tables for each row execute function app.set_updated_at();',
      "create trigger restaurant_tables_audit_change after insert or update on app.restaurant_tables for each row execute function app.audit_row_change('tables.table', 'branch');",
      'create trigger table_reservations_set_window before insert or update on app.table_reservations for each row execute function app.set_reservation_window();',
      'create trigger table_reservations_guard_status before insert or update on app.table_reservations for each row execute function app.guard_reservation_status();',
      'create trigger table_reservations_set_updated_at before update on app.table_reservations for each row execute function app.set_updated_at();',
      "create trigger table_reservations_audit_change after insert or update on app.table_reservations for each row execute function app.audit_row_change('reservations.reservation', 'branch');",
    ])
  })

  it('grants the trigger functions to authenticated and locks them away from public', () => {
    expect(TABLES_FLAT).toContain(
      'revoke execute on function app.set_reservation_window() from public;',
    )
    expect(TABLES_FLAT).toContain(
      'revoke execute on function app.guard_reservation_status() from public;',
    )
    expect(TABLES_FLAT).toContain(
      'grant execute on function app.set_reservation_window() to authenticated;',
    )
    expect(TABLES_FLAT).toContain(
      'grant execute on function app.guard_reservation_status() to authenticated;',
    )
    // audit_row_change keeps its existing ACLs: CREATE OR REPLACE preserves them.
    expect(TABLES_FLAT).not.toContain('revoke execute on function app.audit_row_change')
    expect(TABLES_FLAT).not.toContain('grant execute on function app.audit_row_change')
  })

  it('backfills the new keys onto the system roles of existing organizations', () => {
    // owner/administrator mirror the bootstrap rule dynamically.
    expect(TABLES_FLAT).toContain(
      "insert into app.role_permissions (role_id, permission_key) select r.id, p.key from app.roles r cross join app.permissions p where r.is_system and (r.name = 'owner' or (r.name = 'administrator' and p.key <> 'org.manage')) on conflict do nothing;",
    )
    // manager gets all five keys, staff gets view/create/edit but neither
    // tables.manage nor reservations.cancel.
    expect(TABLES_FLAT).toContain(
      "cross join (values ('tables.manage'), ('reservations.view'), ('reservations.create'), ('reservations.edit'), ('reservations.cancel') ) as v(key) where r.is_system and r.name = 'manager'",
    )
    expect(TABLES_FLAT).toContain(
      "cross join (values ('reservations.view'), ('reservations.create'), ('reservations.edit') ) as v(key) where r.is_system and r.name = 'staff'",
    )

    const bootstrap = lastDeclaration('bootstrap_organization').replace(/\s+/g, ' ')
    for (const key of [
      'tables.manage',
      'reservations.view',
      'reservations.create',
      'reservations.edit',
      'reservations.cancel',
    ]) {
      expect(bootstrap, `bootstrap_organization must seed ${key}`).toContain(`'${key}'`)
    }
  })
})

describe('audit branch attribution (shared helper, D9)', () => {
  it('keeps the helper security definer with an opt-in branch gate only', () => {
    const header = lastDeclarationHeader('audit_row_change')
    expect(header).toContain('app.audit_row_change()')
    expect(header).toMatch(/security definer/i)
    expect(header).toContain("set search_path = ''")

    const helper = lastDeclaration('audit_row_change').replace(/\s+/g, ' ')
    expect(helper).toContain("v_action := 'create';")
    expect(helper).toContain("v_action := 'update';")
    expect(helper).toContain("v_action := 'delete';")
    expect(helper).toContain('perform app.log_audit(')
    expect(helper).toContain("if tg_argv[1] = 'branch' then")
    expect(helper).toContain('v_branch_id uuid;')
    expect(helper).toContain('v_branch_id := new.branch_id;')
    expect(helper).toContain('v_branch_id := old.branch_id;')
    expect(helper).toContain('coalesce(tg_argv[0], tg_table_name), v_entity_id, v_branch_id,')
    // The branch columns are read only inside the opt-in gate, exactly once.
    expect(helper.match(/new\.branch_id/g)).toHaveLength(1)
    expect(helper.match(/old\.branch_id/g)).toHaveLength(1)
  })

  it('is invoked with a branch argument only by the new table and reservation triggers', () => {
    const invocations = [
      ...ALL_SQL.matchAll(/app\.audit_row_change\('([^']+)'(?:\s*,\s*'([^']*)')?\)/g),
    ].map((m) => [m[1], m[2] ?? null] as const)
    // The two menu triggers pass a single argument, so tg_argv[1] is NULL for
    // them and their audit rows keep branch_id NULL by construction.
    expect(invocations).toEqual([
      ['menu.category', null],
      ['menu.item', null],
      ['tables.table', 'branch'],
      ['reservations.reservation', 'branch'],
    ])
  })

  it('leaves the menu migration untouched and redeclares only the expected functions', () => {
    const tablesSql = readFileSync(
      join(MIGRATIONS_DIR, '20261008000003_tables_reservations.sql'),
      'utf8',
    )
    expect(tablesSql).not.toMatch(/on app\.menu_(categories|items)/)

    const redeclared = [...tablesSql.matchAll(/create or replace function\s+app\.(\w+)\s*\(/gi)]
      .map((m) => m[1])
      .sort()
    expect(redeclared).toEqual([
      'audit_row_change',
      'bootstrap_organization',
      'guard_reservation_status',
      'set_reservation_window',
    ])
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
    'reservations',
    'restaurant',
    'rooms',
    'tables',
  ]

  it('seeds 63 unique, well-formed permission keys across both catalog inserts', () => {
    const rows = [
      ...[...catalogSection.matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,\s*'([a-z_]+)'/g)],
      ...[...catalog2Section.matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,\s*'([a-z_]+)'/g)],
    ].map((m) => ({ key: m[1], department: m[2] }))
    expect(rows).toHaveLength(63)
    expect(new Set(rows.map((row) => row.key)).size).toBe(63)
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
    expect(referenced.has('tables.manage')).toBe(true)
    expect(referenced.has('reservations.view')).toBe(true)
    for (const key of referenced) {
      expect(ALL_CATALOG_KEYS.has(key), `src references unknown permission key '${key}'`).toBe(true)
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

  it('allows menu images from self, data URIs and the Supabase hosts only', () => {
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''
    expect(imgSrc).toContain("'self'")
    expect(imgSrc).toContain('data:')
    for (const host of [
      'https://kypnwtgbldoaisjmkjin.supabase.co',
      'https://cxlwrjwzykityppxpqnm.supabase.co',
      'https://ibbbaowkeexqmzwobhmm.supabase.co',
    ]) {
      expect(imgSrc, `CSP img-src must allow ${host}`).toContain(host)
    }
    expect(imgSrc).not.toContain('*')
  })
})
