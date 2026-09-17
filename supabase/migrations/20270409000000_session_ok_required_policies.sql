-- =====================================================================================================
-- SLICE 6 (6/n) -- the database stops trusting the application to check (Phase 2 AA, Z)
--
-- Until now internal.session_ok() has been consulted by internal.can() and has_site_capability(), which
-- covers everything reached through a capability. It does not cover a plain table read that a permissive
-- RLS policy already allows on its own terms. AA closes that with a RESTRICTIVE policy on every
-- non-public table:
--
--     session_ok_required  FOR ALL TO authenticated  USING (session_ok()) WITH CHECK (session_ok())
--
-- RESTRICTIVE means it ANDs with whatever else the table allows, so it can only ever take access away.
-- It applies to `authenticated` alone: anon keeps exactly the public surface it had, and service_role is
-- untouched, because neither is a browser session and neither is what this gate is about.
--
-- At T0 session_ok() is (live session AND usable account), unchanged from today, so this migration
-- removes nobody's access. What it buys is that when a group's enforcement is switched on later, or a
-- session is revoked, EVERY path is already gated -- including one somebody adds next year without
-- remembering to call requireSession.
--
-- THE SETUP PATH IS EXEMPT, AND HAS TO BE. F lists what an AAL1 session may still do, and two of those
-- are table reads: a person reads their own security posture, and a person whose account is still
-- PENDING_SETUP completes their own name and date of birth. Gating those on "usable account" would mean
-- an account could never become usable -- the deadlock this exemption exists to avoid. Those tables keep
-- a weaker gate, internal.session_live(), which still refuses a revoked session.
-- =====================================================================================================

-- A live session, without requiring the account to be complete. The setup path's gate.
create or replace function internal.session_live_only()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.session_live();
$$;
grant execute on function internal.session_live_only() to authenticated;

do $$
declare
  r record;
  -- Tables an AAL1 / not-yet-complete session must still reach, or setup deadlocks (F, AAL1 ops 3 and 7).
  v_setup_path constant text[] := array['profiles','account_security_state','mfa_enforcement_policy'];
  v_applied int := 0;
  v_setup int := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity                     -- RLS on: a table without it is not access-controlled here
       -- Not part of the public surface. anon holding SELECT is the marker of a genuinely public table.
       and not has_table_privilege('anon', c.oid, 'SELECT')
       -- Only tables a browser can reach at all.
       and has_table_privilege('authenticated', c.oid, 'SELECT')
     order by c.relname
  loop
    execute format('drop policy if exists session_ok_required on public.%I', r.relname);

    if r.relname = any (v_setup_path) then
      execute format($f$
        create policy session_ok_required on public.%I
          as restrictive for all to authenticated
          using (internal.session_live_only()) with check (internal.session_live_only())$f$, r.relname);
      v_setup := v_setup + 1;
    else
      execute format($f$
        create policy session_ok_required on public.%I
          as restrictive for all to authenticated
          using (internal.session_ok()) with check (internal.session_ok())$f$, r.relname);
      v_applied := v_applied + 1;
    end if;
  end loop;

  raise notice 'Slice 6: session gate on % tables (% on the weaker setup-path gate)', v_applied + v_setup, v_setup;
end $$;

do $$
declare v_total int; v_restrictive int;
begin
  select count(*) into v_restrictive from pg_policy where polname = 'session_ok_required' and polpermissive = false;
  select count(*) into v_total from pg_policy where polname = 'session_ok_required';
  if v_restrictive <> v_total then
    raise exception 'Slice 6: a session gate policy is PERMISSIVE, which would GRANT access rather than restrict it.';
  end if;
  if v_restrictive = 0 then
    raise exception 'Slice 6: no session gate was applied.';
  end if;
  -- It must never reach a genuinely public table: that would take away anonymous reads.
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where p.polname = 'session_ok_required' and has_table_privilege('anon', c.oid, 'SELECT')) then
    raise exception 'Slice 6: the session gate landed on a publicly readable table.';
  end if;
  raise notice 'Slice 6: % RESTRICTIVE session gates, none on a public table', v_restrictive;
end $$;
