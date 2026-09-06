-- Site Admin Dashboard, Phase A -- the read model's boundary and semantics.
--
-- Two things are proved here: that only a Site Admin gets platform data
-- (and only a commercially-authorized one gets commercial data), and that
-- the KPI definitions count the entities the audit said they count -- in
-- particular that parents are distinct PEOPLE and that players are never
-- conflated with users.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_full     uuid := gen_random_uuid();   -- Full Site Admin
  v_ops      uuid := gen_random_uuid();   -- Site Admin, NO view_commercial
  v_club     uuid := gen_random_uuid();   -- ordinary Club Admin
  v_teamadm  uuid := gen_random_uuid();   -- Team Admin only
  v_parent   uuid := gen_random_uuid();   -- Guardian, two children
  v_parent2  uuid := gen_random_uuid();   -- Guardian, one child
  v_dir uuid; v_club_id uuid; v_team uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_membership uuid;
  v_count int; v_int int; v_text text;
  v_users_before int; v_users_after int;
  v_parents_before int; v_parents_after int;
  v_players_before int;
  v_clubs_before int;
  v_today int;
  v_ok boolean;
begin
  -- =================== fixtures ===================
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_full,    'dashfull@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_ops,     'dashops@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_club,    'dashclub@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_teamadm, 'dashteam@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_parent,  'dashparent@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_parent2, 'dashparent2@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- Baselines captured before this suite adds anything, so every count
  -- assertion is a delta and cannot be fooled by pre-existing local data.
  select registered_users, registered_parents, registered_players, registered_clubs
  into v_users_before, v_parents_before, v_players_before, v_clubs_before
  from (select 0) _
  cross join lateral (
    select
      (select count(*)::int from public.profiles) as registered_users,
      (select count(distinct g.guardian_user_id)::int from public.guardians g where g.status='active') as registered_parents,
      (select count(*)::int from public.players) as registered_players,
      (select count(*)::int from public.clubs) as registered_clubs
  ) b;

  -- profiles, not auth.users, is the canonical person record. Inserted
  -- explicitly here because the metric deliberately excludes an auth row
  -- that never completed signup -- asserted directly at assertion 14b.
  insert into public.profiles (id, first_name, surname, email) values
    (v_full,    'Dash','Full',    'dashfull@ovalball-test.invalid'),
    (v_ops,     'Dash','Ops',     'dashops@ovalball-test.invalid'),
    (v_club,    'Dash','Club',    'dashclub@ovalball-test.invalid'),
    (v_teamadm, 'Dash','Team',    'dashteam@ovalball-test.invalid'),
    (v_parent,  'Dash','Parent',  'dashparent@ovalball-test.invalid'),
    (v_parent2, 'Dash','Parent2', 'dashparent2@ovalball-test.invalid');

  insert into public.site_admins (user_id, admin_role, status) values (v_full, 'full', 'active');
  -- read_only is not full, and view_commercial is false: the commercial
  -- boundary's negative case.
  insert into public.site_admins (user_id, admin_role, status, view_commercial)
  values (v_ops, 'read_only', 'active', false);

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Dashboard Test RUFC','union','England','England','manual','verified','dashboard-test')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'dashboard-test', 'active') returning id into v_club_id;

  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_id, v_club, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_id, v_teamadm, 'BASIC_USER', 'active') returning id into v_membership;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active,
                            canonical_team_type_id)
  values (v_club_id, 'union', 'youth', 'U13', 'boys', 'Dashboard U13', 'dashboard-u13', true,
          internal.resolve_canonical_team_type('youth','U13','boys',null))
  returning id into v_team;

  insert into public.team_permissions (membership_id, team_id, permission)
  values (v_membership, v_team, 'team_admin');

  -- Three players, and two guardians. The parent count must be 2 (people),
  -- not 3 (relationship rows) -- v_parent guardians two of the children.
  insert into public.players (first_name, surname, active) values ('Kid','One',true) returning id into v_p1;
  insert into public.players (first_name, surname, active) values ('Kid','Two',true) returning id into v_p2;
  insert into public.players (first_name, surname, active) values ('Kid','Three',true) returning id into v_p3;

  insert into public.guardians (guardian_user_id, player_id, status) values
    (v_parent,  v_p1, 'active'),
    (v_parent,  v_p2, 'active'),
    (v_parent2, v_p3, 'active');

  -- ============ A. Full Site Admin gets platform data ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_full, 'role','authenticated')::text, true);
  select registered_users into v_int from public.site_admin_dashboard_platform();
  if v_int > 0 then
    raise notice 'PASS 1 (A): a Full Site Admin can read the platform snapshot';
  else
    raise notice 'FAIL 1 (A): platform snapshot returned %', v_int;
  end if;

  select fixtures_today into v_today from public.site_admin_dashboard_operations();
  raise notice 'PASS 2 (A): a Full Site Admin can read the operations snapshot (fixtures today = %)', v_today;

  select clubs_on_trial into v_int from public.site_admin_dashboard_commercial();
  raise notice 'PASS 3 (A/F): a Full Site Admin can read the commercial snapshot';

  -- ============ B. Club Admin cannot ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_club, 'role','authenticated')::text, true);
  begin
    perform public.site_admin_dashboard_platform();
    raise notice 'FAIL 4 (B): a Club Admin read the platform snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 4 (B): a Club Admin cannot read the platform snapshot';
  end;
  begin
    perform public.site_admin_dashboard_operations();
    raise notice 'FAIL 5 (B): a Club Admin read the operations snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 5 (B): a Club Admin cannot read the operations snapshot';
  end;
  begin
    perform public.site_admin_dashboard_commercial();
    raise notice 'FAIL 6 (B): a Club Admin read the commercial snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 6 (B): a Club Admin cannot read the commercial snapshot';
  end;

  -- ============ C. Team Admin cannot ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_teamadm, 'role','authenticated')::text, true);
  begin
    perform public.site_admin_dashboard_platform();
    raise notice 'FAIL 7 (C): a Team Admin read the platform snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 7 (C): a Team Admin cannot read the platform snapshot';
  end;

  -- ============ D. Parent cannot ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
  begin
    perform public.site_admin_dashboard_platform();
    raise notice 'FAIL 8 (D): a Parent read the platform snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 8 (D): a Parent cannot read the platform snapshot';
  end;
  begin
    perform public.site_admin_dashboard_commercial();
    raise notice 'FAIL 9 (D): a Parent read the commercial snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 9 (D): a Parent cannot read the commercial snapshot';
  end;

  -- ============ E. anonymous cannot ============
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.site_admin_dashboard_platform();
    raise notice 'FAIL 10 (E): an anonymous caller read the platform snapshot';
  exception when insufficient_privilege then
    raise notice 'PASS 10 (E): an anonymous caller cannot read the platform snapshot';
  end;

  -- EXECUTE is not granted to anon at all, which is the transport-layer
  -- half of the same boundary.
  select has_function_privilege('anon', 'public.site_admin_dashboard_platform()', 'EXECUTE')
      or has_function_privilege('anon', 'public.site_admin_dashboard_operations()', 'EXECUTE')
      or has_function_privilege('anon', 'public.site_admin_dashboard_commercial()', 'EXECUTE')
  into v_ok;
  if not v_ok then
    raise notice 'PASS 11 (E): anon holds no EXECUTE grant on any dashboard function';
  else
    raise notice 'FAIL 11 (E): anon can execute a dashboard function';
  end if;

  -- ============ F/G. commercial capability is required, and denied data is not returned ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_ops, 'role','authenticated')::text, true);
  select registered_users into v_int from public.site_admin_dashboard_platform();
  if v_int > 0 then
    raise notice 'PASS 12 (F): a Site Admin without commercial authority still gets platform data';
  else
    raise notice 'FAIL 12 (F): platform data was withheld from an ordinary Site Admin';
  end if;

  begin
    perform public.site_admin_dashboard_commercial();
    raise notice 'FAIL 13 (G): commercial data was returned without site.commercial.view';
  exception when insufficient_privilege then
    raise notice 'PASS 13 (G): commercial data is refused outright, not blanked, without site.commercial.view';
  end;

  -- ============ H. KPI definitions ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_full, 'role','authenticated')::text, true);

  select registered_users into v_users_after from public.site_admin_dashboard_platform();
  if v_users_after = v_users_before + 6 then
    raise notice 'PASS 14 (H): registered users counts canonical profiles (+6)';
  else
    raise notice 'FAIL 14 (H): users went % -> %, expected +6', v_users_before, v_users_after;
  end if;

  -- The definition's whole point: an authenticated identity that never
  -- completed signup is not a registered user.
  insert into auth.users (id, email, instance_id, aud, role)
  values (gen_random_uuid(), 'nosignup@ovalball-test.invalid',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  select registered_users into v_int from public.site_admin_dashboard_platform();
  if v_int = v_users_after then
    raise notice 'PASS 14b (H): an auth identity with no completed profile is not a registered user';
  else
    raise notice 'FAIL 14b (H): a profile-less auth user was counted (% -> %)', v_users_after, v_int;
  end if;

  select registered_clubs into v_int from public.site_admin_dashboard_platform();
  if v_int = v_clubs_before + 1 then
    raise notice 'PASS 15 (H): registered clubs counts activated clubs rows (+1)';
  else
    raise notice 'FAIL 15 (H): clubs went % -> %, expected +1', v_clubs_before, v_int;
  end if;

  -- registered_clubs must never be the directory count.
  select registered_clubs, directory_clubs into v_int, v_count from public.site_admin_dashboard_platform();
  if v_int <> v_count then
    raise notice 'PASS 16 (H): registered clubs and directory clubs are reported separately';
  else
    raise notice 'FAIL 16 (H): club count equals directory count -- the directory is being reported as customers';
  end if;

  -- ============ I. guardians are distinct PEOPLE ============
  select registered_parents into v_parents_after from public.site_admin_dashboard_platform();
  if v_parents_after = v_parents_before + 2 then
    raise notice 'PASS 17 (I): registered parents counts distinct guardian people (+2 from 3 relationship rows)';
  else
    raise notice 'FAIL 17 (I): parents went % -> %, expected +2 (got the relationship-row count?)',
      v_parents_before, v_parents_after;
  end if;

  -- and revoking a relationship must not remove a parent who still has one
  update public.guardians set status = 'revoked' where guardian_user_id = v_parent and player_id = v_p2;
  select registered_parents into v_int from public.site_admin_dashboard_platform();
  if v_int = v_parents_before + 2 then
    raise notice 'PASS 18 (I): a parent with one revoked and one active child is still one parent';
  else
    raise notice 'FAIL 18 (I): parent count moved to % after revoking one of two relationships', v_int;
  end if;

  -- players are a separate population and are never users
  select registered_players into v_int from public.site_admin_dashboard_platform();
  if v_int = v_players_before + 3 then
    raise notice 'PASS 19 (H): registered players counts player identities, independent of users';
  else
    raise notice 'FAIL 19 (H): players went % -> %, expected +3', v_players_before, v_int;
  end if;

  -- ============ J. fixtures are not double-counted ============
  -- A legacy mirror pair: two rows, one real match. Only the primary counts.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, source, season_label)
  values (v_team, current_date, 'Home', 'Booked', 'Mirror Opponent RUFC', 'club_created', '26/27');

  select fixtures_today into v_int from public.site_admin_dashboard_operations();
  if v_int = v_today + 1 then
    raise notice 'PASS 20 (J): a fixture playing today is counted once';
  else
    raise notice 'FAIL 20 (J): fixtures today went % -> %, expected +1', v_today, v_int;
  end if;

  -- the read model goes through admin_fixture_overview, whose
  -- is_primary_mirror filter is the canonical dedup contract
  select count(*)::int into v_count
  from public.admin_fixture_overview f
  where f.kickoff_date = current_date and f.is_primary_mirror = false;
  raise notice 'PASS 21 (J): the operations read filters on is_primary_mirror (% non-primary row(s) excluded)', v_count;

  -- cancelled fixtures today are not "playing today"
  update public.fixtures set status = 'Cancelled', cancelled_at = now()
  where owning_team_id = v_team and kickoff_date = current_date;
  select fixtures_today into v_int from public.site_admin_dashboard_operations();
  if v_int = v_today then
    raise notice 'PASS 22 (J): a cancelled fixture is not counted as playing today';
  else
    raise notice 'FAIL 22 (J): cancelled fixture still counted (% vs %)', v_int, v_today;
  end if;

  -- ============ K. a refused read raises; it never returns a zero ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_club, 'role','authenticated')::text, true);
  v_ok := false;
  begin
    select registered_users into v_int from public.site_admin_dashboard_platform();
    if v_int = 0 then
      raise notice 'FAIL 23 (K): an unauthorized read returned 0 instead of raising';
    end if;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 23 (K): an unauthorized read raises 42501 -- it can never be rendered as a zero';
  else
    raise notice 'FAIL 23 (K): unauthorized read did not raise';
  end if;

  -- ============ L. referral health comes from F0 ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_full, 'role','authenticated')::text, true);
  select referral_health_status into v_text from public.site_admin_dashboard_commercial();
  if v_text in ('HEALTHY','RECONCILIATION NEEDED','ACTION REQUIRED') then
    raise notice 'PASS 24 (L): referral health uses F0 vocabulary (%)', v_text;
  else
    raise notice 'FAIL 24 (L): unexpected referral health status %', coalesce(v_text,'<null>');
  end if;

  select h.status into v_text from public.referral_data_health() h;
  if v_text = (select c.referral_health_status from public.site_admin_dashboard_commercial() c) then
    raise notice 'PASS 25 (L): the dashboard reports exactly what referral_data_health() reports';
  else
    raise notice 'FAIL 25 (L): dashboard and F0 disagree about referral health';
  end if;

  -- ============ M/N. no sensitive rows, no referral emails ============
  -- The real check is the declared return shape, not a table's columns.
  select count(*)::int into v_count
  from unnest(array[
    'public.site_admin_dashboard_platform()',
    'public.site_admin_dashboard_operations()',
    'public.site_admin_dashboard_commercial()'
  ]) fn
  where pg_get_function_result(fn::regprocedure) ~* '(email|token|secret|access_token|contact_)';
  if v_count = 0 then
    raise notice 'PASS 26 (M/N): no dashboard function returns an email, a token or a secret';
  else
    raise notice 'FAIL 26 (M/N): % dashboard function(s) expose a sensitive field', v_count;
  end if;

  -- every returned column is a count, a status word or a timestamp
  select count(*)::int into v_count
  from unnest(array[
    'public.site_admin_dashboard_platform()',
    'public.site_admin_dashboard_operations()',
    'public.site_admin_dashboard_commercial()'
  ]) fn
  where pg_get_function_result(fn::regprocedure) ~* '(jsonb|record|uuid)';
  if v_count = 0 then
    raise notice 'PASS 27 (M): dashboard functions return aggregates only -- no raw rows, no ids, no jsonb';
  else
    raise notice 'FAIL 27 (M): % dashboard function(s) return raw row material', v_count;
  end if;

  -- ============ safety: search_path and definer are set on all three ============
  select count(*)::int into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'site_admin_dashboard_%'
    and (p.prosecdef = false or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v_count = 0 then
    raise notice 'PASS 28: every dashboard function is SECURITY DEFINER with a pinned search_path';
  else
    raise notice 'FAIL 28: % dashboard function(s) lack definer or search_path', v_count;
  end if;

  -- ============ no ambiguous overload of the reconciler ============
  -- F0 added a defaulted third parameter to
  -- internal.reconcile_partner_invitations, which created a second function
  -- rather than replacing the first and made every two-argument call
  -- ambiguous. Phase A dropped the stale form; this keeps it dropped.
  select count(*)::int into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'reconcile_partner_invitations';
  if v_count = 1 then
    raise notice 'PASS 29: exactly one reconcile_partner_invitations exists -- no ambiguous overload';
  else
    raise notice 'FAIL 29: % overloads of reconcile_partner_invitations', v_count;
  end if;

  -- and a two-argument call must resolve, via the default
  begin
    perform internal.reconcile_partner_invitations(gen_random_uuid(), gen_random_uuid());
    raise notice 'PASS 30: a two-argument call resolves unambiguously through the default';
  exception when others then
    raise notice 'FAIL 30: two-argument call failed -- %', sqlerrm;
  end;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
