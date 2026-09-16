-- SECURITY PERIMETER GUARD.
--
-- Structural checks over the catalog, so a later migration cannot quietly
-- reopen what the identity containment closed:
--
--   P1. No NEW SECURITY DEFINER function in public becomes executable by
--       anon. The inventory below is the Identity/Auth Slice 1 perimeter
--       (down from 238 at Phase 0 containment): genuine public entry points
--       only. It grows only by a reviewed decision recorded in
--       supabase/security/perimeter-manifest.json, the full contract (the
--       Slice 1 forward-fix added the public season team names projection).
--   P2. The functions the containment narrowed stay narrowed.
--   P3. No write policy anywhere in public accepts a row unconditionally.
--   P4. Views that run with their owner's rights are not readable by anon,
--       apart from the deliberately public ones listed. public_venues joined that list in
--       Slice 4E: it carries a venue's id, name and club and nothing else, and it exists so that
--       anonymous readers need no grant on public.venues at all.
--   P5. Browser roles keep no write access to children's records, and cannot
--       write the protected columns of profiles or club_memberships.
--   P6. Every public table has row-level security enabled.
--
-- Read-only; wrapped in a transaction for symmetry with the other suites.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_allowed text[] := array[
    'active_email_logo_path()',
    'current_platform_mode()',
    'get_guardian_invitation_preview(text)',
    'get_invitation_preview(text)',
    'get_player_account_invitation_preview(text)',
    -- Identity/Auth Slice 1 forward-fix: season team names for the public
    -- Club Digital Home, scoped to public_club_fixtures pairs.
    'get_public_team_season_names(jsonb)',
    'get_safeguarding_officer_invitation_preview(text)',
    'get_site_admin_invitation_preview(text)',
    'platform_public_state()',
    'submit_public_support_ticket(text, text, text, text, text, text)'
  ];
  v_found text;
  v_bad text[];
begin
  -- P1 ---------------------------------------------------------------
  select array_agg(sig order by sig) into v_bad
  from (
    select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) s
  where sig <> all (v_allowed);
  if v_bad is null then
    raise notice 'PASS P1: no SECURITY DEFINER function outside the reviewed inventory is executable by anonymous callers';
  else
    raise notice 'FAIL P1: new anonymous-executable SECURITY DEFINER function(s): %', array_to_string(v_bad, ', ');
  end if;

  -- P2 ---------------------------------------------------------------
  v_bad := '{}';
  if has_function_privilege('anon', 'public.set_account_status(uuid, text)', 'EXECUTE') then v_bad := v_bad || 'anon: set_account_status'::text; end if;
  if has_function_privilege('anon', 'public.record_session_version(integer)', 'EXECUTE') then v_bad := v_bad || 'anon: record_session_version'::text; end if;
  if has_function_privilege('anon', 'public.list_suspended_club_memberships(uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: list_suspended_club_memberships'::text; end if;
  if has_function_privilege('anon', 'public.accept_fixture_request(uuid, uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: accept_fixture_request'::text; end if;
  if has_function_privilege('anon', 'public.create_competition(text, text, text, boolean, uuid[])', 'EXECUTE') then v_bad := v_bad || 'anon: create_competition'::text; end if;
  if has_function_privilege('anon', 'public.publish_import_row(uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: publish_import_row'::text; end if;
  if has_function_privilege('anon', 'public.reconcile_overdue_fixture_results()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_overdue_fixture_results()', 'EXECUTE') then
    v_bad := v_bad || 'browser role: reconcile_overdue_fixture_results'::text;
  end if;
  for v_found in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_gocardless_token_for_payer_subscription', 'get_gocardless_token_for_club_admin_action')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    v_bad := v_bad || ('browser role: ' || v_found);
  end loop;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS P2: account status, session version, suspended members, legacy fixture functions, reconciliation and merchant tokens stay out of reach';
  else
    raise notice 'FAIL P2: reopened: %', array_to_string(v_bad, ', ');
  end if;

  -- P3 ---------------------------------------------------------------
  select array_agg(tablename || '.' || policyname) into v_bad
  from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (coalesce(with_check, '') ~* '\mtrue\M' or coalesce(qual, '') ~* '\mtrue\M');
  if v_bad is null then
    raise notice 'PASS P3: no write policy accepts a row unconditionally';
  else
    raise notice 'FAIL P3: write policies with a literal true: %', array_to_string(v_bad, ', ');
  end if;

  -- P4 ---------------------------------------------------------------
  select array_agg(c.relname order by c.relname) into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and has_table_privilege('anon', c.oid, 'SELECT')
    and not coalesce((select option_value in ('true', 'on', '1', 'yes')
                      from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
    and c.relname not in ('public_club_fixtures', 'public_venues', 'notification_topic_settings');
  if v_bad is null then
    raise notice 'PASS P4: owner-rights views readable by anonymous callers are only the deliberately public ones';
  else
    raise notice 'FAIL P4: owner-rights view(s) readable by anon: %', array_to_string(v_bad, ', ');
  end if;

  -- P5 ---------------------------------------------------------------
  v_bad := '{}';
  select v_bad || coalesce(array_agg(t || ':' || r || ':' || priv), '{}') into v_bad
  from unnest(array['players', 'guardians', 'player_team_memberships']) t,
       unnest(array['anon', 'authenticated']) r,
       unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
  where has_table_privilege(r, ('public.' || t)::regclass, priv);
  select v_bad || coalesce(array_agg(t || ':anon:' || priv), '{}') into v_bad
  from unnest(array['players', 'guardians', 'player_team_memberships', 'profiles', 'club_memberships']) t,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) priv
  where has_table_privilege('anon', ('public.' || t)::regclass, priv);
  select v_bad || coalesce(array_agg('profiles.' || col), '{}') into v_bad
  from unnest(array['account_status', 'email', 'date_of_birth', 'id', 'last_active_at']) col
  where has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE');
  select v_bad || coalesce(array_agg('club_memberships.' || col), '{}') into v_bad
  from unnest(array['user_id', 'club_id', 'authority_suspended', 'authority_suspended_at', 'authority_restored_at', 'authority_restored_by', 'created_by']) col
  where has_column_privilege('authenticated', 'public.club_memberships', col, 'UPDATE');
  if has_table_privilege('authenticated', 'public.profiles', 'DELETE') then v_bad := v_bad || 'profiles:authenticated:DELETE'::text; end if;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS P5: children''s records, account status and membership identity are not writable by browser roles';
  else
    raise notice 'FAIL P5: browser-role write access reopened: %', array_to_string(v_bad, ', ');
  end if;

  -- P6 ---------------------------------------------------------------
  select array_agg(c.relname order by c.relname) into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is null then
    raise notice 'PASS P6: every public table has row-level security enabled';
  else
    raise notice 'FAIL P6: public table(s) without row-level security: %', array_to_string(v_bad, ', ');
  end if;
end $$;

rollback;
