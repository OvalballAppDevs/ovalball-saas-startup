-- =====================================================================================================
-- A PITCH IS AT A GROUND (Convergence Step 6; command §25, §45)
--
-- Deterministic and self-seeding. Seeds a club with TWO grounds, because the entire defect class is
-- invisible at a club with one.
--
-- WHY THIS SUITE EXISTS RATHER THAN A COUNT OVER LIVE DATA. The first check written during Step 6's
-- archaeology was "how many fixtures have a pitch that is not at their venue", and it returned 0 --
-- out of ZERO fixtures that set both columns. A count of zero over an empty set is not evidence of an
-- invariant, it is evidence that nobody has exercised the path. Every assertion below therefore creates
-- the rows it needs and then tries the thing that used to be allowed.
--
-- The invariant was already written in the training path before Step 6 and missing from the fixture
-- path. So each refusal here is paired with the training equivalent, and with a POSITIVE CONTROL in
-- which the correct pairing is accepted -- a rule that refuses every pitch would pass the refusals just
-- as happily as the real one.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'S6',p_label,p_email,(current_date - interval '35 years')::date,'ACTIVE');
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

/** Runs one statement as one person and returns the SQLSTATE, or OK. */
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    execute p_sql;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  v_tag    text := substr(gen_random_uuid()::text, 1, 8);
  v_admin  uuid;
  v_dir    uuid;
  v_club   uuid;
  v_teamA  uuid;
  v_groundA uuid;
  v_groundB uuid;
  v_pitchA uuid;
  v_pitchB uuid;
  v_fixture uuid;
  v_rc     text;
  v_n      int;
  v_writers text;
  v_derived text;
begin
  -- ---------------------------------------------------------------------------------------------
  -- SEED: one club, TWO grounds, one pitch at each.
  -- ---------------------------------------------------------------------------------------------
  v_admin := pg_temp.person('Admin', 's6.admin.' || v_tag || '@ovalball.test');

  insert into public.club_directory (name, normalized_key, source, rugby_code, country, nation, verification_status, active)
  values ('Step 6 Two Grounds RFC ' || v_tag, 's6-two-grounds-' || v_tag, 'MANUAL', 'union', 'England', 'England', 'unverified', true)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug) values (v_dir, 's6-club-' || v_tag) returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_admin, 'CLUB_ADMIN', 'active');

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's6-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true)
  returning id into v_teamA;

  insert into public.venues (club_id, name, slug, active, is_default_home)
  values (v_club, 'Ground A ' || v_tag, 's6-ground-a-' || v_tag, true, true) returning id into v_groundA;
  insert into public.venues (club_id, name, slug, active, is_default_home)
  values (v_club, 'Ground B ' || v_tag, 's6-ground-b-' || v_tag, true, false) returning id into v_groundB;

  insert into public.club_pitches (club_id, venue_id, display_name, active)
  values (v_club, v_groundA, 'Pitch A1', true) returning id into v_pitchA;
  insert into public.club_pitches (club_id, venue_id, display_name, active)
  values (v_club, v_groundB, 'Pitch B1', true) returning id into v_pitchB;

  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
  values (v_teamA, current_date + 14, 'Home', 'Step 6 Opposition') returning id into v_fixture;

  -- ---------------------------------------------------------------------------------------------
  -- A. THE DEFECT, in the order it actually happens.
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_venue(%L, %L)', v_fixture, v_groundA));
  perform pg_temp.check(v_rc = 'OK', 'S6VP-01 a home fixture takes a venue belonging to its club (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_pitch(%L, %L)', v_fixture, v_pitchA));
  perform pg_temp.check(v_rc = 'OK', 'S6VP-02 and a pitch AT THAT GROUND (' || v_rc || ')');

  -- Step 3 of the defect: move the ground and leave last week's pitch attached.
  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_venue(%L, %L)', v_fixture, v_groundB));
  perform pg_temp.check(v_rc = '23514',
    'S6VP-03 THE DEFECT: moving the fixture to the other ground while a Ground A pitch is still set is '
    'now refused -- it used to be accepted, leaving the fixture at Ground B on a pitch at Ground A ('
    || v_rc || ')');

  select count(*) into v_n from public.fixtures f join public.club_pitches p on p.id = f.pitch_id
   where f.id = v_fixture and p.venue_id is distinct from f.venue_id;
  perform pg_temp.check(v_n = 0,
    'S6VP-04 and the fixture is still consistent afterwards, so the refusal protected the row rather '
    'than half-applying (' || v_n || ' mismatched)');

  -- The other direction: a pitch at the wrong ground cannot be attached in the first place.
  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_pitch(%L, %L)', v_fixture, v_pitchB));
  perform pg_temp.check(v_rc = '23514',
    'S6VP-05 and a pitch at the OTHER ground cannot be attached to a fixture playing at this one ('
    || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- B. POSITIVE CONTROLS. A rule that refused every pitch would pass everything above.
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_pitch(%L, null)', v_fixture));
  perform pg_temp.check(v_rc = 'OK', 'S6VP-10 POSITIVE CONTROL: the pitch can still be cleared (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_venue(%L, %L)', v_fixture, v_groundB));
  perform pg_temp.check(v_rc = 'OK',
    'S6VP-11 POSITIVE CONTROL: and with no pitch set, the fixture moves ground freely -- the refusal is '
    'about the PAIR, not about moving venues (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_pitch(%L, %L)', v_fixture, v_pitchB));
  perform pg_temp.check(v_rc = 'OK',
    'S6VP-12 POSITIVE CONTROL: and the Ground B pitch is accepted now the fixture is at Ground B ('
    || v_rc || ')');

  -- A fixture with no venue at all keeps working: the rule is conditional, exactly as training's is.
  update public.fixtures set venue_id = null, pitch_id = null where id = v_fixture;
  v_rc := pg_temp.try_as(v_admin, format('select public.update_fixture_pitch(%L, %L)', v_fixture, v_pitchA));
  perform pg_temp.check(v_rc = 'OK',
    'S6VP-13 POSITIVE CONTROL: a fixture with no venue recorded still takes a pitch -- the check is '
    'conditional on there being a ground to contradict (' || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- C. THE RULE IS THE SAME RULE TRAINING ALREADY HAD.
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_admin, format(
    'select public.create_training_session(%L, %L, null, %L, ''18:00'', ''19:00'', %L, null, %L)',
    v_club, v_teamA, current_date + 7, v_pitchB, v_groundA));
  perform pg_temp.check(v_rc <> 'OK',
    'S6VP-20 training still refuses a Ground B pitch at Ground A -- the fixture path now matches the '
    'path that always had this rule (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_admin, format(
    'select public.create_training_session(%L, %L, null, %L, ''18:00'', ''19:00'', %L, null, %L)',
    v_club, v_teamA, current_date + 8, v_pitchA, v_groundA));
  perform pg_temp.check(v_rc = 'OK',
    'S6VP-21 POSITIVE CONTROL: and accepts the matching pair (' || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- D. THE SIBLING RULE, which 20261017000000 already closed, still holds.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    to_regprocedure('public.set_club_pitch_venue(uuid, uuid)') is not null,
    'S6VP-30 set_club_pitch_venue is still the only way to move a pitch between grounds');

  select count(*) into v_n from public.club_pitches where club_id = v_club and venue_id is null;
  perform pg_temp.check(v_n = 0,
    'S6VP-31 and no pitch this suite created is detached from a ground (' || v_n || ')');

  -- ---------------------------------------------------------------------------------------------
  -- E. A VENUE ADDRESS HAS ONE WRITER (Step 6, F-2).
  --
  -- create_venue and update_venue used to write the DERIVED single-line column directly and never
  -- touch the structured ones, so editing a venue in Club Settings set a display line that disagreed
  -- with address_line_1/town/county from that moment on. set_venue_address is now the only writer,
  -- and it regenerates the derived line from the structured parts.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    to_regprocedure('public.create_venue(uuid,text,text,text,text,boolean)') is null
    and to_regprocedure('public.update_venue(uuid,text,text,text,text)') is null,
    'S6VA-01 the old address-writing venue signatures are dropped, not left as overloads PostgREST '
    'would still route to');

  perform pg_temp.check(
    to_regprocedure('public.create_venue(uuid,text,text,boolean)') is not null
    and to_regprocedure('public.update_venue(uuid,text,text)') is not null,
    'S6VA-02 and the replacements exist, owning the name, the directions and the default flag');

  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f'
    and p.prosrc ~ 'update\s+public\.venues'
    and p.prosrc ~ '(address_line_1|address\s*=|postcode\s*=)';
  perform pg_temp.check(v_writers = 'set_venue_address',
    'S6VA-03 exactly ONE function in the schema writes a venue address column (' || v_writers || ')');

  -- It behaves, not merely exists.
  v_rc := pg_temp.try_as(v_admin, format(
    $q$select public.set_venue_address(%L, 'Belvedere Road', '', 'Burnley', 'Lancashire', 'BB10 2LS')$q$, v_groundA));
  perform pg_temp.check(v_rc = 'OK', 'S6VA-04 an address is written through the canonical writer (' || v_rc || ')');

  select address into v_derived from public.venues where id = v_groundA;
  perform pg_temp.check(v_derived = 'Belvedere Road, Burnley, Lancashire',
    'S6VA-05 and the derived display line is regenerated from the structured parts rather than stored '
    'independently (' || coalesce(v_derived, 'NULL') || ')');

  -- THE DEFECT: renaming through update_venue must not disturb the address.
  v_rc := pg_temp.try_as(v_admin, format('select public.update_venue(%L, %L, ''Through the main gate'')', v_groundA, 'Ground A renamed ' || v_tag));
  perform pg_temp.check(v_rc = 'OK', 'S6VA-06 a venue can still be renamed and re-described (' || v_rc || ')');

  select address into v_derived from public.venues where id = v_groundA;
  select count(*) into v_n from public.venues
   where id = v_groundA and address_line_1 = 'Belvedere Road' and town = 'Burnley' and postcode = 'BB10 2LS';
  perform pg_temp.check(v_derived = 'Belvedere Road, Burnley, Lancashire' and v_n = 1,
    'S6VA-07 and renaming leaves BOTH the structured address and its derived line untouched -- the '
    'update path is no longer an address writer at all');

  -- No venue THIS SUITE OWNS may hold a derived line that disagrees with its structured parts.
  --
  -- Scoped to its own club on purpose. An earlier draft asserted it across the whole database and
  -- passed locally and failed on a clean boot, because the seeds insert venue rows directly and a
  -- freshly seeded row had not been through set_venue_address. Depending on ambient data is the
  -- standing anti-pattern here; the seeds were fixed as well, but the assertion should never have been
  -- able to notice.
  select count(*) into v_n from public.venues
   where club_id = v_club
     and coalesce(address_line_1, address_line_2, town, county) is not null
     and address is distinct from nullif(concat_ws(', ', address_line_1, address_line_2, town, county), '');
  perform pg_temp.check(v_n = 0,
    'S6VA-08 no venue this suite created has a display line that contradicts its structured address ('
    || v_n || ')');

  raise notice '--- Step 6 venue/pitch integrity suite complete ---';
end $$;

rollback;
