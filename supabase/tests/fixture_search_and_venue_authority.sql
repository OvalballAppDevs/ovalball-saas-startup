-- Fixture Search privacy, and the venue/pitch writers' refusals.
--
-- Two questions Convergence Step 7 has to answer, and both are about what
-- happens WITHOUT the user interface.
--
-- §24 SEARCH MUST NOT EXPOSE A FIXTURE MERELY BECAUSE SOMEBODY IS SIGNED IN.
-- The Control Centre's search is a set of predicates over
-- `admin_fixture_overview`, and the club scope in `buildAdminFixtureQuery` is a
-- convenience filter, not the boundary. The boundary is that the view is
-- `security_invoker = true`, so `fixtures_select_related` answers underneath
-- it. That is asserted here directly -- as a search term that matches another
-- club's fixture and returns nothing, which is the shape the leak would take.
--
-- §6/§15 THE VENUE AND PITCH WRITERS REFUSE A FORGED CALL. Wrong club, wrong
-- venue, wrong pitch, ordinary member, suspended member -- asked of the
-- functions themselves rather than of the screen that usually calls them.
--
-- Self-seeding, and wrapped in begin/rollback: leaves the database exactly as
-- it found it.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_search_and_venue_authority.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin_a uuid := gen_random_uuid();   -- Club Admin at club A
  v_admin_b uuid := gen_random_uuid();   -- Club Admin at club B
  v_member_a uuid := gen_random_uuid();  -- ordinary member of club A
  v_suspended uuid := gen_random_uuid(); -- a suspended Club Admin at club A
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_team_a uuid; v_team_b uuid; v_ctt uuid;
  v_venue_a1 uuid; v_venue_a2 uuid; v_venue_b uuid;
  v_pitch_a1 uuid; v_pitch_a2 uuid; v_pitch_b uuid;
  v_fixture_a uuid; v_fixture_b uuid;
  v_count int; v_text text;
  v_secret text := 'Zzyzx Search Canary RFC';
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin_a,'searcha@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin_b,'searchb@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_member_a,'searchm@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_suspended,'searchs@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin_a,'Search','A','searcha@ovalball-test.invalid'),
    (v_admin_b,'Search','B','searchb@ovalball-test.invalid'),
    (v_member_a,'Search','M','searchm@ovalball-test.invalid'),
    (v_suspended,'Search','S','searchs@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Search Authority A RUFC','union','England','England','manual','verified','search-auth-a'),
    ('Search Authority B RUFC','union','England','England','manual','verified','search-auth-b');
  select id into v_dir_a from public.club_directory where normalized_key='search-auth-a';
  select id into v_dir_b from public.club_directory where normalized_key='search-auth-b';
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'search-auth-a','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'search-auth-b','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN','active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN','active'),
    (v_club_a, v_member_a, 'BASIC_USER','active'),
    (v_club_a, v_suspended, 'CLUB_ADMIN','suspended');

  select id into v_ctt from public.canonical_team_types where key='u12' and is_active limit 1;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (v_club_a,'Under 12 Boys','search-a-u12','youth','U12','boys','union',v_ctt,true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (v_club_b,'Under 12 Boys','search-b-u12','youth','U12','boys','union',v_ctt,true) returning id into v_team_b;

  -- Two grounds at club A, so "a pitch at the wrong ground" is a real case and
  -- not merely an absent one, and one at club B.
  insert into public.venues (club_id, name, slug, active, is_default_home) values
    (v_club_a,'Search A Main','search-a-main',true,true) returning id into v_venue_a1;
  insert into public.venues (club_id, name, slug, active, is_default_home) values
    (v_club_a,'Search A Second','search-a-second',true,false) returning id into v_venue_a2;
  insert into public.venues (club_id, name, slug, active, is_default_home) values
    (v_club_b,'Search B Ground','search-b-ground',true,true) returning id into v_venue_b;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values
    (v_club_a, v_venue_a1, 'A Main Pitch', true) returning id into v_pitch_a1;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values
    (v_club_a, v_venue_a2, 'A Second Pitch', true) returning id into v_pitch_a2;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values
    (v_club_b, v_venue_b, 'B Pitch', true) returning id into v_pitch_b;

  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_id)
  values (v_team_a,'Home','Somebody RFC', current_date + 20, '11:00','Booked','club_created', v_venue_a1)
  returning id into v_fixture_a;
  -- Club B's fixture carries a string nothing else in the database contains.
  -- If a search ever reaches across clubs, this is what it will find.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_id)
  values (v_team_b,'Home', v_secret, current_date + 21, '11:00','Booked','club_created', v_venue_b)
  returning id into v_fixture_b;

  -- =================================================================
  -- A. SEARCH PRIVACY (§24)
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.admin_fixture_overview where id = v_fixture_a;
  if v_count = 1 then
    raise notice 'PASS 1 (A): a club administrator reads their own club''s fixture through the search''s own source';
  else
    raise notice 'FAIL 1 (A): their own fixture was not readable';
  end if;

  select count(*) into v_count from public.admin_fixture_overview where id = v_fixture_b;
  if v_count = 0 then
    raise notice 'PASS 2 (A): another club''s fixture is not readable merely because they are signed in';
  else
    raise notice 'FAIL 2 (A): another club''s fixture was readable';
  end if;

  -- The leak would take the shape of a SEARCH, so it is asked as one: the
  -- exact predicate the Control Centre builds, with a term that matches only
  -- the other club's fixture.
  select count(*) into v_count from public.admin_fixture_overview
  where raw_opposition_text ilike '%' || v_secret || '%'
     or owning_club_name ilike '%' || v_secret || '%'
     or venue_name ilike '%' || v_secret || '%';
  if v_count = 0 then
    raise notice 'PASS 3 (A): a search term that matches another club''s fixture returns nothing';
  else
    raise notice 'FAIL 3 (A): search returned % row(s) from another club', v_count;
  end if;

  -- An ordinary member of the same club is scoped by the same rule, not by the
  -- surface -- the Control Centre route refuses them, but the DATA must too.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.admin_fixture_overview where id = v_fixture_b;
  if v_count = 0 then
    raise notice 'PASS 4 (A): an ordinary member reaches no other club''s fixture either';
  else
    raise notice 'FAIL 4 (A): an ordinary member read another club''s fixture';
  end if;

  -- =================================================================
  -- B. THE VENUE WRITER REFUSES A FORGED CALL (§6, §15)
  -- =================================================================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);

  begin
    perform public.update_fixture_venue(v_fixture_a, v_venue_b);
    raise notice 'FAIL 5 (B): another club''s ground was attached to this fixture';
  exception when others then
    raise notice 'PASS 5 (B): a venue belonging to another club is refused';
  end;

  begin
    perform public.update_fixture_pitch(v_fixture_a, v_pitch_b, null);
    raise notice 'FAIL 6 (B): another club''s pitch was attached to this fixture';
  exception when others then
    raise notice 'PASS 6 (B): a pitch belonging to another club is refused';
  end;

  -- STEP 6'S INVARIANT, RE-PROVED FROM THE FIXTURE WRITER. The pitch is our
  -- own club's, and is still wrong: it is at the other ground.
  begin
    perform public.update_fixture_pitch(v_fixture_a, v_pitch_a2, null);
    raise notice 'FAIL 7 (B): a pitch at a DIFFERENT ground of our own club was accepted';
  exception when others then
    if sqlstate = '23514' then
      raise notice 'PASS 7 (B): our own pitch at the wrong ground is refused as a rule violation (23514)';
    else
      raise notice 'FAIL 7 (B): refused with % rather than 23514', sqlstate;
    end if;
  end;

  -- And the right one is accepted, so the refusals above are about the rule
  -- rather than about the writer refusing everything.
  begin
    perform public.update_fixture_pitch(v_fixture_a, v_pitch_a1, null);
    select pitch_id::text into v_text from public.fixtures where id = v_fixture_a;
    if v_text = v_pitch_a1::text then
      raise notice 'PASS 8 (B): the pitch at this fixture''s own ground is accepted';
    else
      raise notice 'FAIL 8 (B): the correct pitch did not land';
    end if;
  exception when others then
    raise notice 'FAIL 8 (B): the correct pitch was refused -- %', sqlerrm;
  end;

  -- =================================================================
  -- C. WHO MAY CALL IT AT ALL
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated')::text, true);
  begin
    perform public.update_fixture_venue(v_fixture_a, v_venue_b);
    raise notice 'FAIL 9 (C): another club''s administrator set our fixture''s venue';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 9 (C): another club''s administrator is refused on authority (42501)';
    else
      raise notice 'PASS 9 (C): another club''s administrator is refused (%)', sqlstate;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_member_a, 'role','authenticated')::text, true);
  begin
    perform public.update_fixture_venue(v_fixture_a, v_venue_a2);
    raise notice 'FAIL 10 (C): an ordinary member of the owning club changed the venue';
  exception when others then
    raise notice 'PASS 10 (C): an ordinary member of the owning club is refused';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_suspended, 'role','authenticated')::text, true);
  begin
    perform public.update_fixture_venue(v_fixture_a, v_venue_a2);
    raise notice 'FAIL 11 (C): a SUSPENDED Club Admin changed the venue';
  exception when others then
    raise notice 'PASS 11 (C): a suspended Club Admin is refused';
  end;

  -- The refused writes changed nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  select venue_id::text into v_text from public.fixtures where id = v_fixture_a;
  if v_text = v_venue_a1::text then
    raise notice 'PASS 12 (C): after every refusal the fixture is still at its own ground';
  else
    raise notice 'FAIL 12 (C): the fixture''s venue is now %', v_text;
  end if;

  -- =================================================================
  -- D. THE PUBLIC VENUE PROJECTION SAYS ONLY WHAT IT DECLARES (§33)
  -- =================================================================
  -- It is deliberately owner-rights -- that is what makes it public -- so its
  -- column list IS its access boundary, and an address must never appear in it.
  if (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema='public' and table_name='public_venues')
     = 'club_id,id,is_default_home,name,only_pitch_name' then
    raise notice 'PASS 13 (D): public_venues publishes exactly name, club, default flag and the only pitch';
  else
    raise notice 'FAIL 13 (D): public_venues publishes %',
      (select string_agg(column_name, ',' order by column_name) from information_schema.columns
       where table_schema='public' and table_name='public_venues');
  end if;

  -- Club A's second ground has exactly one pitch, so it is named; the main
  -- ground has one too. A ground with two would be null -- asserted by adding
  -- a second pitch and watching the name disappear.
  select only_pitch_name into v_text from public.public_venues where id = v_venue_a2;
  if v_text = 'A Second Pitch' then
    raise notice 'PASS 14 (D): a ground with exactly one pitch names it, so a visiting club knows where to go';
  else
    raise notice 'FAIL 14 (D): only_pitch_name is %', coalesce(v_text, 'null');
  end if;

  insert into public.club_pitches (club_id, venue_id, display_name, active)
  values (v_club_a, v_venue_a2, 'A Second Pitch B', true);
  select only_pitch_name into v_text from public.public_venues where id = v_venue_a2;
  if v_text is null then
    raise notice 'PASS 15 (D): a ground with TWO pitches names neither -- the product asks a person to choose';
  else
    raise notice 'FAIL 15 (D): a two-pitch ground published "%"', v_text;
  end if;
end;
$$;

rollback;
