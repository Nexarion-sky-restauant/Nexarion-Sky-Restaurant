-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20261008000001 — Audit integrity hardening (L2)
-- Phase 0B follow-up. Two hardening changes, no behavior change for
-- legitimate writers:
--   * app.log_audit validates a non-null branch against the caller's
--     organization before writing (null-branch callers such as
--     bootstrap_organization are unaffected).
--   * A before-insert trigger on app.audit_log server-derives actor identity:
--     an authenticated client can never store a supplied actor_email, and
--     branch/organization pairs must be consistent on direct inserts.
-- RLS, privileges and the append-only contract are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── log_audit: branch/organization validation ───────────────────────────────
create or replace function app.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_branch_id   uuid default null,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     bigint;
  v_org_id uuid;
begin
  select organization_id into v_org_id from app.profiles where id = auth.uid();

  if p_branch_id is not null then
    if v_org_id is null
       or not exists (
         select 1 from app.branches b
         where b.id = p_branch_id and b.organization_id = v_org_id
       ) then
      raise exception 'Audit branch % does not belong to the caller''s organization.', p_branch_id;
    end if;
  end if;

  insert into app.audit_log (
    organization_id, branch_id, actor_id, actor_email,
    action, entity_type, entity_id, before_data, after_data, metadata
  )
  values (
    v_org_id,
    p_branch_id,
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_metadata
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ── audit_log: server-side attribution guard ────────────────────────────────
-- Fires before every insert (including ones made through app.log_audit).
-- For authenticated callers the actor is pinned to auth.uid() and the email
-- is derived only from server-side sources (auth.users, then the request
-- JWT claim); a client-supplied actor_email is always overwritten and never
-- kept as a fallback. Service-role/server writers are left untouched.
-- branch_id, when present, must belong to organization_id; when the row has
-- no organization yet, it must belong to the authenticated writer's
-- organization instead.
create or replace function app.guard_audit_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is not null then
    v_email := coalesce(
      (select u.email from auth.users u where u.id = v_uid),
      auth.jwt() ->> 'email'
    );
    new.actor_id    := v_uid;
    new.actor_email := v_email;
  end if;

  if new.branch_id is not null then
    if new.organization_id is not null then
      if not exists (
        select 1 from app.branches b
        where b.id = new.branch_id and b.organization_id = new.organization_id
      ) then
        raise exception 'Audit branch does not belong to the audit organization.';
      end if;
    elsif v_uid is not null then
      if not exists (
        select 1 from app.branches b
        join app.profiles p on p.organization_id = b.organization_id
        where b.id = new.branch_id and p.id = v_uid
      ) then
        raise exception 'Audit branch does not belong to the auditor''s organization.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger audit_log_guard_integrity
  before insert on app.audit_log
  for each row execute function app.guard_audit_integrity();

revoke execute on function app.guard_audit_integrity() from public;
