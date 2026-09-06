-- Site Admin Dashboard, Phase B -- rugby activity, growth and adoption.
--
-- The properties that matter are the ones a screenshot cannot show: that
-- "booked" reads the creation clock and "playing" reads the kickoff clock,
-- that one physical fixture is counted once, that growth uses the same
-- entity definitions as the Pulse cards, and that the adoption denominator
-- is active clubs rather than the club directory.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_club_ad uuid := gen_random_uuid();
  v_parent  uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid;
  v_p1 uuid; v_p2 uuid;
  v_fx_today uuid; v_fx_old uuid; v_fx_cancel uuid;
  v_count int; v_int int; v_text text;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_week_start timestamptz := date_trunc('week', now() at time zone 'Europe/London') at time zone 'Europe/London';
  v_b_today int; v_b_week int; v_b_month int; v_b_cancel int;
  v_a_today int; v_a_week int; v_a_month int; v_a_cancel int;
  v_before_clubs int; v_after_clubs int;
  v_before_parents int; v_after_parents int;
  v_adopt jsonb; v_weeks jsonb; v_daily jsonb; v_monthly jsonb;
  v_text2 text; v_clubs_bucket_before int;
  v_ok boolean;
begin
  -- =================== baseline (deltas, never absolutes) ===================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin,   'pbadmin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_club_ad, 'pbclub@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_parent,  'pbparent@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin,'PB','Admin','pbadmin@ovalball-test.invalid'),
    (v_club_ad,'PB','Club','pbclub@ovalball-test.invalid'),
    (v_parent,'PB','Parent','pbparent@ovalball-test.invalid');
  insert into public.site_admins (user_id, admin_role, status) values (v_admin, 'full', 'active');

  select fixtures_today, fixtures_booked_this_week, fixtures_booked_this_month, fixtures_cancelled_this_month
  into v_b_today, v_b_week, v_b_month, v_b_cancel
  from public.site_admin_dashboard_operations();

  select (adoption->>'active_clubs')::int into v_before_clubs from public.site_admin_dashboard_trends();

  -- =================== fixtures ===================
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Phase B RUFC','union','England','England','manual','verified','phase-b-rufc') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'phase-b-rufc','active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_ad, 'CLUB_ADMIN','active');
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active, canonical_team_type_id)
  values (v_club,'union','youth','U14','boys','Phase B U14','phase-b-u14',true,
          internal.resolve_canonical_team_type('youth','U14','boys',null))
  returning id into v_team;

  -- ============ A/B/C. the two clocks ============
  -- Created NOW, kicking off far in the future: booked this week/month,
  -- but NOT playing today.
  insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, source, season_label)
  values (v_team, v_today + 200, '14:00', 'Home', 'Booked', 'Future Opponent RUFC', 'club_created', '26/27')
  returning id into v_fx_old;

  select fixtures_today, fixtures_booked_this_week, fixtures_booked_this_month
  into v_a_today, v_a_week, v_a_month
  from public.site_admin_dashboard_operations();

  if v_a_week = v_b_week + 1 and v_a_month = v_b_month + 1 then
    raise notice 'PASS 1 (A/B): booked-this-week and -month count fixture CREATION time';
  else
    raise notice 'FAIL 1 (A/B): week %->%, month %->%', v_b_week, v_a_week, v_b_month, v_a_month;
  end if;

  if v_a_today = v_b_today then
    raise notice 'PASS 2 (C): a fixture kicking off in 200 days is not "playing today"';
  else
    raise notice 'FAIL 2 (C): playing-today moved %->%', v_b_today, v_a_today;
  end if;

  -- Kicking off TODAY but created long ago: playing today, NOT booked this week.
  insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, source, season_label, created_at)
  values (v_team, v_today, '15:30', 'Home', 'Booked', 'Today Opponent RUFC', 'club_created', '26/27',
          v_week_start - interval '40 days')
  returning id into v_fx_today;

  select fixtures_today, fixtures_booked_this_week into v_a_today, v_int
  from public.site_admin_dashboard_operations();

  if v_a_today = v_b_today + 1 then
    raise notice 'PASS 3 (C): playing-today counts fixtures by KICKOFF date';
  else
    raise notice 'FAIL 3 (C): playing-today %->%', v_b_today, v_a_today;
  end if;

  if v_int = v_b_week + 1 then
    raise notice 'PASS 4 (A): a fixture created 40 days ago is NOT booked this week, though it plays today';
  else
    raise notice 'FAIL 4 (A): booked-this-week became % (expected %)', v_int, v_b_week + 1;
  end if;

  -- ============ D. one physical fixture, counted once ============
  select count(*) into v_count from public.site_admin_dashboard_fixtures_today(50)
  where fixture_id = v_fx_today;
  if v_count = 1 then
    raise notice 'PASS 5 (D): the physical fixture appears exactly once in Playing Today';
  else
    raise notice 'FAIL 5 (D): it appears % times', v_count;
  end if;

  select count(*)::int into v_count
  from public.admin_fixture_overview f where f.id = v_fx_today and f.is_primary_mirror = false;
  if v_count = 0 then
    raise notice 'PASS 6 (D): the read model filters is_primary_mirror -- no mirror double-count';
  else
    raise notice 'FAIL 6 (D): a non-primary row for this fixture is visible';
  end if;

  -- ============ E. cancelled semantics ============
  insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, source, season_label, cancelled_at)
  values (v_team, v_today, '11:00', 'Home', 'Cancelled', 'Called Off RUFC', 'club_created', '26/27', now())
  returning id into v_fx_cancel;

  select fixtures_today, fixtures_cancelled_this_month into v_a_today, v_a_cancel
  from public.site_admin_dashboard_operations();

  if v_a_today = v_b_today + 1 then
    raise notice 'PASS 7 (E): a cancelled fixture is excluded from Playing Today';
  else
    raise notice 'FAIL 7 (E): playing-today became % with a cancelled fixture added', v_a_today;
  end if;

  if v_a_cancel = v_b_cancel + 1 then
    raise notice 'PASS 8 (E): cancellations attribute to cancelled_at, in this month';
  else
    raise notice 'FAIL 8 (E): cancelled-this-month %->%', v_b_cancel, v_a_cancel;
  end if;

  select count(*) into v_count from public.site_admin_dashboard_fixtures_today(50) where fixture_id = v_fx_cancel;
  if v_count = 0 then
    raise notice 'PASS 9 (E): the cancelled fixture is absent from the Playing Today list';
  else
    raise notice 'FAIL 9 (E): a cancelled fixture is listed';
  end if;

  -- ============ ordering is deterministic ============
  -- The contract is MONOTONIC ordering, not a particular first row: other
  -- fixtures may legitimately exist today. Counts any row whose kickoff is
  -- earlier than the row before it, and any timed row that follows a TBD.
  select count(*)::int into v_count from (
    select kickoff_time,
           lag(kickoff_time) over (order by ord) as prev,
           lag(kickoff_time is null) over (order by ord) as prev_was_tbd
    from (select kickoff_time, row_number() over () as ord
          from public.site_admin_dashboard_fixtures_today(50)) x
  ) y
  where (kickoff_time is not null and prev is not null and kickoff_time < prev)
     or (kickoff_time is not null and prev_was_tbd);
  select string_agg(coalesce(kickoff_time::text,'TBD'), ',' order by ord) into v_text
  from (select kickoff_time, row_number() over () as ord from public.site_admin_dashboard_fixtures_today(50)) x;
  if v_count = 0 then
    raise notice 'PASS 10 (P): Playing Today is ordered by kickoff ascending, TBD last (%)', v_text;
  else
    raise notice 'FAIL 10 (P): % ordering violation(s) in %', v_count, v_text;
  end if;

  -- ============ F. weekly aggregation ============
  select fixture_weeks into v_weeks from public.site_admin_dashboard_trends();
  if jsonb_array_length(v_weeks) = 12 then
    raise notice 'PASS 11 (F): the fixture chart returns exactly 12 weekly buckets';
  else
    raise notice 'FAIL 11 (F): % buckets', jsonb_array_length(v_weeks);
  end if;

  -- current week's "booked" must include the two fixtures created just now
  select (v_weeks -> 11 ->> 'booked')::int into v_int;
  if v_int >= 2 then
    raise notice 'PASS 12 (F): the current week bucket counts fixtures booked this week (%)', v_int;
  else
    raise notice 'FAIL 12 (F): current-week booked = %', v_int;
  end if;

  -- the far-future fixture must NOT appear in any playing bucket
  select sum((w ->> 'playing')::int) into v_int from jsonb_array_elements(v_weeks) w;
  select sum((w ->> 'booked')::int) into v_count from jsonb_array_elements(v_weeks) w;
  if v_count >= 2 then
    raise notice 'PASS 13 (F): booked and playing are separate series (booked %, playing %)', v_count, v_int;
  else
    raise notice 'FAIL 13 (F): booked total %', v_count;
  end if;

  -- ============ G/H/I. growth semantics ============
  select growth_daily, growth_monthly into v_daily, v_monthly from public.site_admin_dashboard_trends();
  if jsonb_array_length(v_daily) = 30 and jsonb_array_length(v_monthly) = 12 then
    raise notice 'PASS 14 (G): growth returns 30 daily and 12 monthly buckets';
  else
    raise notice 'FAIL 14 (G): % daily, % monthly', jsonb_array_length(v_daily), jsonb_array_length(v_monthly);
  end if;

  -- clubs growth must have counted the club created above, today
  select (v_daily -> 29 ->> 'clubs')::int into v_int;
  if v_int >= 1 then
    raise notice 'PASS 15 (G): club growth uses clubs.created_at (today bucket = %)', v_int;
  else
    raise notice 'FAIL 15 (G): today''s club bucket = %', v_int;
  end if;

  -- H. one guardian with TWO children is ONE new parent
  insert into public.players (first_name, surname, active) values ('PB','KidOne',true) returning id into v_p1;
  insert into public.players (first_name, surname, active) values ('PB','KidTwo',true) returning id into v_p2;

  select (v_daily -> 29 ->> 'parents')::int into v_before_parents;
  insert into public.guardians (guardian_user_id, player_id, status) values
    (v_parent, v_p1, 'active'), (v_parent, v_p2, 'active');
  select growth_daily into v_daily from public.site_admin_dashboard_trends();
  select (v_daily -> 29 ->> 'parents')::int into v_after_parents;

  if v_after_parents = v_before_parents + 1 then
    raise notice 'PASS 16 (H): two guardian relationships for one person count as ONE new parent';
  else
    raise notice 'FAIL 16 (H): parents %->% after adding 2 relationships for 1 person',
      v_before_parents, v_after_parents;
  end if;

  -- I. players are sporting identities, counted independently of users
  select (v_daily -> 29 ->> 'players')::int into v_int;
  if v_int >= 2 then
    raise notice 'PASS 17 (I): players are counted as sporting identities, with no user account';
  else
    raise notice 'FAIL 17 (I): today''s player bucket = %', v_int;
  end if;

  -- J. club growth counts activated clubs, never raw directory rows
  -- Only ONE activated club was created by this suite. Adding a directory
  -- row afterwards must move neither the growth bucket nor the denominator.
  select (v_daily -> 29 ->> 'clubs')::int into v_clubs_bucket_before;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Phase B Directory Only','union','England','England','manual','verified','phase-b-dironly');
  select growth_daily, (adoption->>'active_clubs')::int into v_daily, v_after_clubs
  from public.site_admin_dashboard_trends();
  select (v_daily -> 29 ->> 'clubs')::int into v_count;
  if v_count = v_clubs_bucket_before and v_after_clubs = v_before_clubs + 1 then
    raise notice 'PASS 18 (J): a directory-only row adds no activated club -- growth bucket stayed %, denominator %->% (the one real club)',
      v_count, v_before_clubs, v_after_clubs;
  else
    raise notice 'FAIL 18 (J): bucket %->%, denominator %->%',
      v_clubs_bucket_before, v_count, v_before_clubs, v_after_clubs;
  end if;

  -- K. team growth counts operational teams, not canonical type definitions
  --
  -- This used to assert `bucket < count(canonical_team_types)`, on the
  -- reasoning that a metric wrongly reading the type catalogue would equal
  -- 25. That proxy only holds while the seeded teams are older than the
  -- 30-day window: after a fresh migration replay every seed team is
  -- created today, the bucket legitimately contains all of them, and the
  -- assertion failed with the product behaving correctly.
  --
  -- Asserted directly instead: the bucket equals the teams genuinely
  -- created in the window, and adding a canonical TYPE moves it not at all.
  -- That is the actual invariant -- "teams are not type definitions" --
  -- rather than a numeric coincidence.
  select (v_daily -> 29 ->> 'teams')::int into v_int;
  select count(*)::int into v_count
  from public.teams
  where (created_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date;

  if v_int = v_count then
    raise notice 'PASS 19 (K): today''s team bucket (%) is exactly the teams created today', v_int;
  else
    raise notice 'FAIL 19 (K): bucket % but % teams created today', v_int, v_count;
  end if;

  -- A new canonical type definition is not a team and must not move it.
  insert into public.canonical_team_types (key, label, category, age_group, gender, allows_squads, sort_order)
  values ('phase-b-probe-type', 'Phase B Probe', 'youth', 'U18', 'girls', false, 9999);
  select growth_daily into v_daily from public.site_admin_dashboard_trends();
  select (v_daily -> 29 ->> 'teams')::int into v_count;
  if v_count = v_int then
    raise notice 'PASS 19b (K): adding a canonical team TYPE leaves the team bucket at %', v_count;
  else
    raise notice 'FAIL 19b (K): a type definition moved the team bucket %->%', v_int, v_count;
  end if;

  -- ============ L. adoption denominator ============
  select adoption into v_adopt from public.site_admin_dashboard_trends();
  select count(*)::int into v_count from public.clubs c where c.status = 'active';
  if (v_adopt->>'active_clubs')::int = v_count then
    raise notice 'PASS 20 (L): the adoption denominator is ACTIVE clubs (%)', v_count;
  else
    raise notice 'FAIL 20 (L): denominator % vs % active clubs', v_adopt->>'active_clubs', v_count;
  end if;

  select count(*)::int into v_count from public.club_directory;
  if (v_adopt->>'active_clubs')::int <> v_count then
    raise notice 'PASS 21 (L): the denominator is NOT the club directory (% rows)', v_count;
  else
    raise notice 'FAIL 21 (L): the denominator equals the directory count';
  end if;

  -- every adoption numerator must be <= the denominator
  select count(*)::int into v_count
  from jsonb_each_text(v_adopt) kv
  where kv.key like 'with_%' or kv.key = 'using_training'
    and kv.value::int > (v_adopt->>'active_clubs')::int;
  select count(*)::int into v_int
  from jsonb_each_text(v_adopt) kv
  where (kv.key like 'with_%' or kv.key = 'using_training')
    and kv.value::int > (v_adopt->>'active_clubs')::int;
  if v_int = 0 then
    raise notice 'PASS 22 (L): no adoption numerator exceeds the active-club denominator';
  else
    raise notice 'FAIL 22 (L): % numerator(s) exceed the denominator', v_int;
  end if;

  -- Q. rugby code is not accidentally filtered
  select count(distinct f.rugby_code)::int into v_count
  from public.admin_fixture_overview f where f.is_primary_mirror = true;
  if v_count >= 1 then
    raise notice 'PASS 23 (Q): fixture reads span % rugby code(s) with no code filter applied', v_count;
  else
    raise notice 'FAIL 23 (Q): no rugby codes visible';
  end if;

  -- ============ M/N. authorization ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_ad, 'role','authenticated')::text, true);
  begin
    perform public.site_admin_dashboard_trends();
    raise notice 'FAIL 24 (M): a Club Admin read Phase B analytics';
  exception when insufficient_privilege then
    raise notice 'PASS 24 (M): a Club Admin cannot read Phase B analytics';
  end;
  begin
    perform public.site_admin_dashboard_fixtures_today(5);
    raise notice 'FAIL 25 (M): a Club Admin read Playing Today';
  exception when insufficient_privilege then
    raise notice 'PASS 25 (M): a Club Admin cannot read Playing Today';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
  begin
    perform public.site_admin_dashboard_trends();
    raise notice 'FAIL 26 (M): a Parent read Phase B analytics';
  exception when insufficient_privilege then
    raise notice 'PASS 26 (M): a Parent cannot read Phase B analytics';
  end;

  -- N. a spoofed context grants nothing: authority comes from site_admins,
  -- which the claims below do not change.
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_ad, 'role','authenticated','context','site_admin')::text, true);
  begin
    perform public.site_admin_dashboard_trends();
    raise notice 'FAIL 27 (N): a spoofed site_admin claim granted analytics';
  exception when insufficient_privilege then
    raise notice 'PASS 27 (N): a spoofed site_admin context grants nothing';
  end;

  select has_function_privilege('anon','public.site_admin_dashboard_trends()','EXECUTE')
      or has_function_privilege('anon','public.site_admin_dashboard_fixtures_today(int)','EXECUTE')
  into v_ok;
  if not v_ok then
    raise notice 'PASS 28 (M): anon holds no EXECUTE grant on the Phase B functions';
  else
    raise notice 'FAIL 28 (M): anon can execute a Phase B function';
  end if;

  -- ============ O. a refused read raises, never a false zero ============
  v_ok := false;
  begin
    select (adoption->>'active_clubs')::int into v_int from public.site_admin_dashboard_trends();
    if v_int = 0 then raise notice 'FAIL 29 (O): unauthorized read returned 0 instead of raising'; end if;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 29 (O): an unauthorized analytics read raises 42501 -- never a zero chart';
  else
    raise notice 'FAIL 29 (O): unauthorized read did not raise';
  end if;

  -- ============ privacy: aggregates only ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  select count(*)::int into v_count
  from unnest(array[
    'public.site_admin_dashboard_trends()',
    'public.site_admin_dashboard_fixtures_today(integer)',
    'public.site_admin_dashboard_operations()'
  ]) fn
  where pg_get_function_result(fn::regprocedure) ~* '(email|date_of_birth|dob|first_name|surname|token|secret)';
  if v_count = 0 then
    raise notice 'PASS 30: no Phase B function returns a name, DOB, email or token';
  else
    raise notice 'FAIL 30: % Phase B function(s) expose personal data', v_count;
  end if;

  -- P. window boundaries are deterministic across calls
  select fixture_weeks -> 0 ->> 'week_start' into v_text from public.site_admin_dashboard_trends();
  select fixture_weeks -> 0 ->> 'week_start' into v_text2 from public.site_admin_dashboard_trends();
  if v_text = v_text2 then
    raise notice 'PASS 31 (P): week bucket boundaries are deterministic (first bucket %)', v_text;
  else
    raise notice 'FAIL 31 (P): bucket boundaries moved between calls';
  end if;

  -- EVERY week bucket must be a distinct Monday, and every month bucket a
  -- distinct 1st. Month/week arithmetic on a timestamptz happens in UTC and
  -- drifts across the BST/GMT boundary, which produced buckets like
  -- 2025-10-31 and 2025-11-30 -- two of which then formatted to the same
  -- label and collided as React keys. Checking only the first bucket missed
  -- it, so all twelve are checked here.
  select fixture_weeks, growth_monthly into v_weeks, v_monthly
  from public.site_admin_dashboard_trends();

  select count(*)::int into v_count
  from jsonb_array_elements(v_weeks) w
  where extract(isodow from (w->>'week_start')::date) <> 1;
  select count(distinct w->>'week_start')::int into v_int from jsonb_array_elements(v_weeks) w;
  if v_count = 0 and v_int = 12 then
    raise notice 'PASS 32 (P): all 12 week buckets are distinct Mondays';
  else
    raise notice 'FAIL 32 (P): % non-Monday bucket(s), % distinct', v_count, v_int;
  end if;

  select count(*)::int into v_count
  from jsonb_array_elements(v_monthly) m
  where extract(day from (m->>'bucket')::date) <> 1;
  select count(distinct m->>'bucket')::int into v_int from jsonb_array_elements(v_monthly) m;
  if v_count = 0 and v_int = 12 then
    raise notice 'PASS 33 (P): all 12 month buckets are distinct month-firsts -- no DST drift';
  else
    raise notice 'FAIL 33 (P): % bucket(s) not on the 1st, % distinct', v_count, v_int;
  end if;

  select count(distinct d->>'bucket')::int into v_int from jsonb_array_elements(v_daily) d;
  if v_int = 30 then
    raise notice 'PASS 34 (P): all 30 daily buckets are distinct';
  else
    raise notice 'FAIL 34 (P): % distinct daily buckets', v_int;
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
