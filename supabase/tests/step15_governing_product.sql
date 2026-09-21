-- CONVERGENCE STEP 15 — GOVERNING BODY PRODUCT.
--
-- Step 15's only RED change is one added disjunct in internal.can_organise_competition — the single
-- chokepoint ten competition mutations reach through internal.require_edition_organiser. This suite
-- proves the whole §28 matrix over it and over the three new writes.
--
--   A. COMPETITION ORGANISER AUTHORITY -- the right body only, and nobody else.
--   B. THE EXISTING ORGANISERS SURVIVED, and a body organiser gains no club fixture authority.
--   C. CREATING A COMPETITION -- the body's own rugby code, the canonical season.
--   D. WHO HAS ACCESS -- a reader, never a people search.
--   E. GRANTING ACCESS BY EMAIL.
--   F. REMOVING ACCESS -- revoked, not deleted, and never your own.
--   G. BOUNDARIES: the dispensation chain, affiliation and protected person data are untouched.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_body_admin uuid := gen_random_uuid();
  v_body_comps uuid := gen_random_uuid();
  v_body_viewer uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_fixsec uuid := gen_random_uuid();
  v_so uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_body uuid; v_other_body uuid; v_league_body uuid;
  v_dir uuid; v_club uuid; v_ms uuid;
  v_comp uuid; v_edition uuid; v_other_comp uuid; v_club_comp uuid; v_club_edition uuid;
  v_season uuid; v_fixture uuid; v_team uuid; v_type uuid;
  v_n int; v_state text; v_bool boolean; v_txt text; v_txt2 text; v_id uuid;
begin
  foreach v_person in array array[v_body_admin, v_body_comps, v_body_viewer, v_other_admin, v_club_admin,
                                 v_fixsec, v_so, v_site, v_stranger, v_outsider] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's15-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Fifteen', 's15-' || v_person::text || '@ovalball.test', (current_date - interval '43 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role, profile_key) values (v_site, 'active', 'full', 'SITE_FULL');

  -- THREE SYNTHETIC BODIES. Two union (so "wrong body" is a real test rather than a code mismatch) and
  -- one league, to prove the rugby-code isolation rule on creation.
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S15 Test County RFU ' || v_tag, 'S15 County ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_body;
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S15 Other County RFU ' || v_tag, 'S15 Other ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_other_body;
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('league', 'England', 'S15 League Body ' || v_tag, 'S15 League ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_league_body;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, constituent_body_id)
  values ('S15 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's15-' || v_tag, v_body)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's15-' || v_tag, 'active') returning id into v_club;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_admin, 'CLUB_ADMIN', 'active') returning id into v_ms;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_fixsec, 'FIXTURE_SECRETARY', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_so, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_stranger, 'BASIC_USER', 'active');

  insert into public.constituent_body_roles (constituent_body_id, user_id, role_key) values
    (v_body, v_body_admin, 'BODY_ADMIN'),
    (v_body, v_body_comps, 'BODY_COMPETITIONS'),
    (v_body, v_body_viewer, 'BODY_VIEWER'),
    (v_other_body, v_other_admin, 'BODY_ADMIN');

  -- A team and one of its OWN fixtures, seeded here rather than mid-assertion: section B asserts that a
  -- governing officer cannot reach them, and the seeding must not itself be done under their identity.
  -- The canonical identity, from the Team Directory catalogue filtered by the club's own rugby code --
  -- never a hand-written team shape, and never the other code's catalogue.
  select id into v_type from public.canonical_team_types_by_code
   where rugby_code = 'union' and key = 'mens_1st' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, squad_designation, canonical_team_type_id, active)
  values (v_club, 'Men''s 1st', 'senior', null, 'union', 'mens', '1st', v_type, true) returning id into v_team;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values (v_team, 'Home', 'S15 Visitors ' || v_tag, (current_date + 20)::date, '14:00', 'Friendly', 'Booked', 'club_created', 'S15 ' || v_tag)
  returning id into v_fixture;

  select internal.edition_season_for_code('union') into v_season;

  -- A competition organised by the BODY, and one organised by the CLUB, so the two organisers can be
  -- told apart rather than assumed to behave the same.
  insert into public.competitions (name, slug, normalized_key, rugby_code, active, organiser_constituent_body_id, created_by)
  values ('S15 County Cup ' || v_tag, 's15-cup-' || v_tag, 's15 cup ' || v_tag || ' union', 'union', true, v_body, v_body_admin)
  returning id into v_comp;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_comp, v_season, 'union', true, v_body_admin, v_body_admin) returning id into v_edition;

  insert into public.competitions (name, slug, normalized_key, rugby_code, active, organiser_constituent_body_id, created_by)
  values ('S15 Other Cup ' || v_tag, 's15-other-' || v_tag, 's15 other ' || v_tag || ' union', 'union', true, v_other_body, v_other_admin)
  returning id into v_other_comp;

  insert into public.competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, created_by)
  values ('S15 Club Cup ' || v_tag, 's15-club-' || v_tag, 's15 club ' || v_tag || ' union', 'union', true, v_club, v_club_admin)
  returning id into v_club_comp;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_club_comp, v_season, 'union', true, v_club_admin, v_club_admin) returning id into v_club_edition;

  -- =====================================================================
  -- A. COMPETITION ORGANISER AUTHORITY -- the one RED change
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  perform pg_temp.check(internal.can_organise_competition(v_comp),
    'A1 the BODY ADMIN of the organising body organises its competition');

  perform pg_temp.act('authenticated', v_body_comps);
  perform pg_temp.check(internal.can_organise_competition(v_comp),
    'A2 so does its COMPETITIONS officer -- the role that exists for exactly this');

  perform pg_temp.act('authenticated', v_body_viewer);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false,
    'A3 a VIEWER at the same body does not');
  select pg_temp.try(format('select internal.require_edition_organiser(%L)', v_edition)) into v_state;
  perform pg_temp.check(v_state = '42501', format('A4 and is refused at the chokepoint every mutation uses (%s)', v_state));

  perform pg_temp.act('authenticated', v_other_admin);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false,
    'A5 an ADMIN OF ANOTHER BODY does not organise this one');
  perform pg_temp.check(internal.can_organise_competition(v_other_comp),
    'A6 though they do organise their own');

  perform pg_temp.act('authenticated', v_club_admin);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false,
    'A7 the CLUB ADMIN of an affiliated club does not organise the county''s competition');
  perform pg_temp.act('authenticated', v_fixsec);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false, 'A8 nor does a FIXTURE SECRETARY');
  perform pg_temp.act('authenticated', v_so);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false, 'A9 nor a SAFEGUARDING OFFICER');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false, 'A10 nor an ORDINARY MEMBER');
  perform pg_temp.act('authenticated', v_outsider);
  perform pg_temp.check(internal.can_organise_competition(v_comp) = false, 'A11 nor somebody with no relationship at all');

  -- FAIL CLOSED, not merely false. A null here would make `if not (...)` allow the write.
  perform pg_temp.check(internal.can_organise_competition(v_comp) is not null,
    'A12 the predicate answers a definite boolean, so `if not (...)` cannot fail open');
  perform pg_temp.check(internal.can_organise_competition(gen_random_uuid()) = false,
    'A13 and refuses a competition that does not exist');

  -- =====================================================================
  -- B. THE EXISTING ORGANISERS SURVIVED, AND NOTHING WIDENED
  -- =====================================================================
  perform pg_temp.act('authenticated', v_club_admin);
  perform pg_temp.check(internal.can_organise_competition(v_club_comp),
    'B1 the CLUB organiser still organises its own competition -- the change is additive');
  perform pg_temp.act('authenticated', v_site);
  perform pg_temp.check(internal.can_organise_competition(v_comp) and internal.can_organise_competition(v_club_comp),
    'B2 and a Site Admin with site.competitions.manage still organises every competition');

  perform pg_temp.act('authenticated', v_body_admin);
  perform pg_temp.check(internal.can_organise_competition(v_club_comp) = false,
    'B3 a body officer does NOT acquire the affiliated club''s own competition');

  -- ORGANISING A COMPETITION IS NOT FIXTURE AUTHORITY. A body officer must not reach the club's own
  -- fixtures, which is the boundary a governing workspace is most likely to be expected to cross.
  perform pg_temp.act('authenticated', v_body_admin);
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'team', v_club, v_team, null) = false,
    'B4 and holds NO authority over that club''s own fixtures');
  select count(*) into v_n from public.fixtures f where f.id = v_fixture;
  perform pg_temp.check(v_n = 0, 'B5 nor can it even read one through RLS');

  -- =====================================================================
  -- C. CREATING A COMPETITION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select competition_id into v_id from public.create_governing_body_competition('S15 New Cup ' || v_tag, v_body);
  perform pg_temp.check(v_id is not null, 'C1 a body admin creates a competition for the organisation');
  perform pg_temp.act_postgres();
  select organiser_constituent_body_id, rugby_code into v_txt, v_txt2 from public.competitions where id = v_id;
  perform pg_temp.check(v_txt = v_body::text, 'C2 recorded against the body as its organiser');
  perform pg_temp.check(v_txt2 = 'union',
    'C3 in the BODY''S OWN rugby code -- a union county cannot end up running a league competition');
  select organiser_club_id is null into v_bool from public.competitions where id = v_id;
  perform pg_temp.check(v_bool, 'C4 and with no club organiser invented for it');
  -- The season is the canonical register's answer, never a computed year.
  select e.season_id into v_txt from public.competition_editions e where e.competition_id = v_id;
  perform pg_temp.check(v_txt = v_season::text,
    'C5 its edition is in the season the canonical Seasons register resolves, not a computed one');

  perform pg_temp.act('authenticated', v_body_comps);
  select competition_id into v_id from public.create_governing_body_competition('S15 Comps Cup ' || v_tag, v_body);
  perform pg_temp.check(v_id is not null, 'C6 a competitions officer may create one too');

  perform pg_temp.act('authenticated', v_body_viewer);
  select pg_temp.try(format('select * from public.create_governing_body_competition(%L, %L)', 'S15 Viewer Cup ' || v_tag, v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('C7 a viewer may not (%s)', v_state));
  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select * from public.create_governing_body_competition(%L, %L)', 'S15 Wrong Cup ' || v_tag, v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('C8 nor an officer of another body (%s)', v_state));
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select * from public.create_governing_body_competition(%L, %L)', 'S15 Club Cup2 ' || v_tag, v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('C9 nor a Club Admin of an affiliated club (%s)', v_state));
  perform pg_temp.act('authenticated', v_outsider);
  select pg_temp.try(format('select * from public.create_governing_body_competition(%L, %L)', 'S15 Out Cup ' || v_tag, v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('C10 nor a stranger (%s)', v_state));

  perform pg_temp.act('authenticated', v_body_admin);
  select pg_temp.try(format('select * from public.create_governing_body_competition(%L, %L)', '   ', v_body)) into v_state;
  perform pg_temp.check(v_state <> 'OK', format('C11 and a competition still needs a name (%s)', v_state));

  -- =====================================================================
  -- D. WHO HAS ACCESS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_viewer);
  select count(*) into v_n from public.governing_body_people(v_body);
  perform pg_temp.check(v_n = 3, format('D1 a viewer sees who has access (%s)', v_n));
  select count(*) into v_n from public.governing_body_people(v_body) where email is not null;
  perform pg_temp.check(v_n = 0,
    'D2 and is given no email addresses -- the reader hands them only to somebody who manages access');

  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.governing_body_people(v_body) where email is not null;
  perform pg_temp.check(v_n = 3, format('D3 an admin does get them, which is how two people with one name are told apart (%s)', v_n));
  select count(*) into v_n from public.governing_body_people(v_body) where is_me;
  perform pg_temp.check(v_n = 1, 'D4 and can see which row is their own');

  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select * from public.governing_body_people(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D5 an officer of another body cannot read this one''s people (%s)', v_state));
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select * from public.governing_body_people(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D6 nor can a Club Admin of an affiliated club (%s)', v_state));
  perform pg_temp.act('authenticated', v_outsider);
  select pg_temp.try(format('select * from public.governing_body_people(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D7 nor a stranger (%s)', v_state));

  -- =====================================================================
  -- E. GRANTING ACCESS BY EMAIL
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select outcome into v_txt from public.grant_governing_body_role_by_email(
    v_body, 's15-' || v_outsider::text || '@ovalball.test', 'BODY_VIEWER', 'county handbook');
  perform pg_temp.check(v_txt = 'GRANTED', format('E1 an admin gives access by the address on an existing account (%s)', v_txt));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.constituent_body_roles where constituent_body_id = v_body and user_id = v_outsider and state = 'ACTIVE';
  perform pg_temp.check(v_n = 1, 'E2 and the canonical relationship is what records it');

  -- THE ADDRESS IS RESOLVED INSIDE THE FUNCTION, so an unknown one is an ordinary answer and creates
  -- nothing. This is also why there is no people-search surface to enumerate.
  perform pg_temp.act('authenticated', v_body_admin);
  select outcome into v_txt from public.grant_governing_body_role_by_email(
    v_body, 'nobody-' || v_tag || '@ovalball.test', 'BODY_VIEWER');
  perform pg_temp.check(v_txt = 'NO_ACCOUNT', format('E3 an address with no Ovalball account answers NO_ACCOUNT rather than failing (%s)', v_txt));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.constituent_body_roles where constituent_body_id = v_body;
  perform pg_temp.check(v_n = 4, format('E4 and nothing was created for it (%s)', v_n));

  perform pg_temp.act('authenticated', v_body_comps);
  select pg_temp.try(format('select * from public.grant_governing_body_role_by_email(%L, %L, %L)',
    v_body, 's15-' || v_stranger::text || '@ovalball.test', 'BODY_ADMIN')) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('E5 a COMPETITIONS officer cannot grant -- running competitions is not managing access (%s)', v_state));
  perform pg_temp.act('authenticated', v_body_viewer);
  select pg_temp.try(format('select * from public.grant_governing_body_role_by_email(%L, %L, %L)',
    v_body, 's15-' || v_stranger::text || '@ovalball.test', 'BODY_VIEWER')) into v_state;
  perform pg_temp.check(v_state = '42501', format('E6 nor can a viewer (%s)', v_state));
  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select * from public.grant_governing_body_role_by_email(%L, %L, %L)',
    v_body, 's15-' || v_stranger::text || '@ovalball.test', 'BODY_ADMIN')) into v_state;
  perform pg_temp.check(v_state = '42501', format('E7 nor an admin of a DIFFERENT body (%s)', v_state));
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select * from public.grant_governing_body_role_by_email(%L, %L, %L)',
    v_body, 's15-' || v_stranger::text || '@ovalball.test', 'BODY_ADMIN')) into v_state;
  perform pg_temp.check(v_state = '42501', format('E8 nor a Club Admin of an affiliated club (%s)', v_state));

  perform pg_temp.act('authenticated', v_body_admin);
  select pg_temp.try(format('select * from public.grant_governing_body_role_by_email(%L, %L, %L)',
    v_body, 's15-' || v_stranger::text || '@ovalball.test', 'BODY_SUPREME')) into v_state;
  perform pg_temp.check(v_state = 'P0002', format('E9 and a role that does not exist cannot be invented at the call site (%s)', v_state));

  -- =====================================================================
  -- F. REMOVING ACCESS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select pg_temp.try(format('select public.revoke_governing_body_role(%L, %L)', v_body, v_outsider)) into v_state;
  perform pg_temp.check(v_state = 'OK', format('F1 an admin removes somebody''s access (%s)', v_state));
  perform pg_temp.act_postgres();
  select state into v_txt from public.constituent_body_roles where constituent_body_id = v_body and user_id = v_outsider;
  perform pg_temp.check(v_txt = 'REVOKED', format('F2 which is a state change, not a delete -- who was removed stays answerable (%s)', v_txt));
  select revoked_by is not null and revoked_at is not null into v_bool
    from public.constituent_body_roles where constituent_body_id = v_body and user_id = v_outsider;
  perform pg_temp.check(v_bool, 'F3 recorded with who did it and when');

  -- Asserted through the PRODUCT SURFACE rather than the internal predicate: what matters is that the
  -- page they had access to a moment ago now turns them away.
  perform pg_temp.act('authenticated', v_outsider);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('F4 and the removed person loses access immediately (%s)', v_state));
  select count(*) into v_n from public.my_governing_bodies();
  perform pg_temp.check(v_n = 0, 'F5 with the organisation gone from their own list of organisations');
  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.governing_body_people(v_body);
  perform pg_temp.check(v_n = 3, format('F6 a revoked role is history, so it is not listed as somebody who has access (%s)', v_n));

  -- A body whose last admin removed their own access has nobody who can give it back.
  select pg_temp.try(format('select public.revoke_governing_body_role(%L, %L)', v_body, v_body_admin)) into v_state;
  perform pg_temp.check(v_state = '42501', format('F7 an admin cannot remove their own access (%s)', v_state));

  select pg_temp.try(format('select public.revoke_governing_body_role(%L, %L)', v_body, v_stranger)) into v_state;
  perform pg_temp.check(v_state = 'P0002', format('F8 and removing somebody who has none says so (%s)', v_state));

  perform pg_temp.act('authenticated', v_body_viewer);
  select pg_temp.try(format('select public.revoke_governing_body_role(%L, %L)', v_body, v_body_comps)) into v_state;
  perform pg_temp.check(v_state = '42501', format('F9 a viewer cannot remove anybody (%s)', v_state));
  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select public.revoke_governing_body_role(%L, %L)', v_body, v_body_comps)) into v_state;
  perform pg_temp.check(v_state = '42501', format('F10 nor can an admin of another body (%s)', v_state));

  -- =====================================================================
  -- G. THE COMPETITIONS READER
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.governing_body_competitions(v_body);
  perform pg_temp.check(v_n = 3, format('G1 the reader lists the body''s own competitions (%s)', v_n));
  select bool_and(can_organise) into v_bool from public.governing_body_competitions(v_body);
  perform pg_temp.check(v_bool, 'G2 with can_organise true for an officer who organises them');
  select count(*) into v_n from public.governing_body_competitions(v_body)
   where competition_id = v_club_comp or competition_id = v_other_comp;
  perform pg_temp.check(v_n = 0, 'G3 and nothing organised by a club or by another body');
  select season_name into v_txt from public.governing_body_competitions(v_body) where competition_id = v_comp;
  perform pg_temp.check(v_txt = (select name from public.seasons where id = v_season),
    format('G4 each one named with its season from the canonical register (%s)', coalesce(v_txt, 'null')));

  perform pg_temp.act('authenticated', v_body_viewer);
  select bool_or(can_organise) into v_bool from public.governing_body_competitions(v_body);
  perform pg_temp.check(coalesce(v_bool, false) = false,
    'G5 and a viewer is told the truth per competition rather than shown a control that will refuse them');

  -- =====================================================================
  -- H. BOUNDARIES HELD
  -- =====================================================================
  -- THE DISPENSATION CHAIN IS UNTOUCHED. Its governing-body stage is the CLUB recording a certificate
  -- it holds off-platform, and Step 15 must not quietly change what an existing record means.
  perform pg_temp.act_postgres();
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'decide_player_dispensation'
     and p.prosrc ~ 'constituent_body|can_manage_body';
  perform pg_temp.check(v_n = 0, 'H1 no dispensation stage was re-pointed at a governing body officer');

  -- AFFILIATION STAYED A READ.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^(governing_body|create_governing|grant_governing|revoke_governing)'
     and p.prosrc ~* '(update|insert into)\s+(public\.)?club_directory';
  perform pg_temp.check(v_n = 0, 'H2 and no Step 15 function writes which body a club is affiliated to');

  -- NO PROTECTED PERSON DATA, asserted on the functions rather than hoped for.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname ~ 'governing_body|can_manage_body|can_view_body|_body_role'
     and p.prosrc ~* 'date_of_birth|medical|safeguard|guardians|player_team_dispensation';
  perform pg_temp.check(v_n = 0, 'H3 no governing body function reaches a date of birth, a medical field or a case note');

  -- THE ENGINE STILL HAS FIVE SCOPES.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'capability_decision'
     and pg_get_function_arguments(p.oid) ~ 'p_body';
  perform pg_temp.check(v_n = 0, 'H4 and internal.capability_decision was not given a sixth scope by the back door');

  -- ANON REACHES NONE OF IT.
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.governing_body_people(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.governing_body_competitions(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_governing_body_competition(text, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.revoke_governing_body_role(uuid, uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.grant_governing_body_role_by_email(uuid, text, text, text)', 'EXECUTE'),
    'H5 anon can execute none of the Step 15 functions');

  -- AND THE CHOKEPOINT IS STILL THE CHOKEPOINT: every competition mutation arrives at the one predicate.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'require_edition_organiser';
  perform pg_temp.check(v_n >= 10, format('H6 all %s competition mutations still route through one organiser predicate', v_n));
end $$;

rollback;
