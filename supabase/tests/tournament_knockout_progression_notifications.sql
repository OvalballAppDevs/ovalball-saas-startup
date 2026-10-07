-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE G: knockout progression notifications -- confirmed entirely
-- absent by the audit. Proves, through the REAL path (resolve_tournament_game_result ->
-- tournament_game_progression trigger -> internal.advance_tournament_bracket ->
-- internal.fill_bracket_slot), not a direct call to internal functions:
--   - the side that wins first is told it is through, with no opponent yet
--   - the side that wins second is told it is through, WITH its opponent named inline
--   - the side that won first then gets a separate follow-up once the opponent becomes known
--   - the opening draw being SET (round 1) notifies nobody -- only an actual advance does
--   - nobody outside the advancing side's own staff is notified
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/tournament_knockout_progression_notifications.sql
--
-- Self-contained and rolled back.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kop-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Kop', p_label, 'kop-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Kop ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'kop-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'kop-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.directory_only(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Kop ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry', 'kop-' || v_tag)
  returning id into v_dir;
  return v_dir;
end $$;

-- A DISTINCT display name per side, not the generic "Under 12 Boys" every age-grade team shares --
-- the body-text assertions below need to tell the host's and the away side's own notifications apart.
create or replace function pg_temp.team(p_club uuid, p_label text, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'kop-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir_host uuid; v_h_u12 uuid; v_host_ca uuid;
  v_away uuid; v_dir_away uuid; v_a_u12 uuid; v_away_ca uuid;
  v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid;
  v_side_host uuid; v_side_away uuid; v_side_x uuid; v_side_y uuid;
  v_order uuid[];
  v_g_host uuid; v_g_away uuid;
  v_host_is_a boolean; v_away_is_a boolean;
  v_n int;
begin
  v_host := pg_temp.club('Host'); select directory_id into v_dir_host from public.clubs where id = v_host;
  v_h_u12 := pg_temp.team(v_host, 'Host Hornets U12');
  v_host_ca := pg_temp.person('HostCA', v_adult); perform pg_temp.member(v_host, v_host_ca, 'CLUB_ADMIN');

  v_away := pg_temp.club('Away'); select directory_id into v_dir_away from public.clubs where id = v_away;
  v_a_u12 := pg_temp.team(v_away, 'Away Albatrosses U12');
  v_away_ca := pg_temp.person('AwayCA', v_adult); perform pg_temp.member(v_away, v_away_ca, 'CLUB_ADMIN');

  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (v_host, 'Kop Ground', 'kop-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
  returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
  values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
    conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, v_dir_host, 'union', current_date - 1, current_date - 1, 'confirmed', 'Progression Test Cup',
    gen_random_uuid(), 'knockout', 'private', v_venue, '09:00', '16:00')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

  -- A CLEAN FOUR-PLACE BRACKET: two real, answerable Ovalball sides, each facing a directory-only
  -- filler in round 1 -- no byes, nothing to complicate reading who was actually notified.
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_side_host;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_away, v_away, v_a_u12, 'U12', 'added') returning id into v_side_away;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('FillerX'), null, 'U12', 'A', 'added') returning id into v_side_x;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('FillerY'), null, 'U12', 'A', 'added') returning id into v_side_y;

  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (v_t, v_pitch, current_date - 1, '09:00', '16:00', v_host_ca);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_host_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[(current_date - 1)::date]);
  perform public.set_tournament_plan_settings(v_plan, 20);
  perform public.set_tournament_knockout_settings(v_plan, p_tie_resolution => 'organiser_decision', p_third_place_playoff => false);
  -- Host v Filler X in one pairing, Away v Filler Y in the other, so Host and Away meet in the Final.
  v_order := array[v_side_host, v_side_x, v_side_away, v_side_y];
  perform public.set_tournament_bracket_draw(v_plan, v_order);
  perform public.generate_tournament_knockout_fixtures(v_plan);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  -- PUBLISHED BEFORE IT IS PLAYED (20270721): a draft game has no result, so the draw is published --
  -- directly, as the knockout parity suite does -- before anybody submits a score.
  update public.tournament_plans set publication_state = 'PUBLISHED', published_at = now(), published_by = created_by where id = v_plan;

  -- ============ A. THE OPENING DRAW NOTIFIES NOBODY ============
  -- EVERY COUNT IN THIS SUITE IS THIS TOURNAMENT'S. It counted the whole table, so on a development
  -- database that had ever played a real knockout through to a second round (the simulator UAT of
  -- 2026-10-02 did) tests 1, 6, 12 and 13 failed on somebody else's notifications. Scoping to the
  -- suite's own tournament keeps every exact count exactly as strict for the progression it proves.
  select count(*) into v_n from public.notifications where type in ('tournament_side_advanced', 'tournament_opponent_known')
    and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.check(v_n = 0, '1 (A): generating the draw and round-1 fixtures notifies nobody -- nothing has advanced yet');

  -- ============ B. THE FIRST WINNER IS THROUGH, WITH NO OPPONENT YET ============
  -- The classic seeding order (1v4, 2v3 -- not 1v2, 3v4) decides who actually pairs with whom, not the
  -- array position passed to set_tournament_bracket_draw -- so which column (side_a/side_b) a given
  -- participant lands in is read back, never assumed, and the winning score is put on THAT column.
  select g.id, (g.side_a_id = v_side_host) into v_g_host, v_host_is_a from public.tournament_games g
  where g.plan_id = v_plan and g.round_number = 1 and (g.side_a_id = v_side_host or g.side_b_id = v_side_host);

  perform pg_temp.check(
    pg_temp.try_as(v_host_ca, format('select public.submit_tournament_game_result(%L::uuid, %s, %s)', v_g_host,
      case when v_host_is_a then 30 else 5 end, case when v_host_is_a then 5 else 30 end)) = 'OK',
    '2 (B): Host submits a score');
  perform pg_temp.check(
    pg_temp.try_as(v_host_ca, format('select public.resolve_tournament_game_result(%L::uuid, %s, %s, %L)', v_g_host,
      case when v_host_is_a then 30 else 5 end, case when v_host_is_a then 5 else 30 end, 'Walkover, recorded by the host')) = 'OK',
    '3 (B): and the host-side organiser resolves it (the opponent cannot answer)');

  select count(*) into v_n from public.notifications where user_id = v_host_ca and type = 'tournament_side_advanced';
  perform pg_temp.check(v_n = 1, '4 (B): the host club''s own admin is told they are through');

  select count(*) into v_n from public.notifications
  where user_id = v_host_ca and type = 'tournament_side_advanced' and body like '%schedule will update%';
  perform pg_temp.check(v_n = 1, '5 (B): with no opponent yet -- the away side has not won its own game');

  select count(*) into v_n from public.notifications where type = 'tournament_opponent_known'
    and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.check(v_n = 0, '6 (B): and no opponent-known follow-up exists yet either');

  -- ============ C. THE SECOND WINNER IS THROUGH, OPPONENT NAMED INLINE ============
  select g.id, (g.side_a_id = v_side_away) into v_g_away, v_away_is_a from public.tournament_games g
  where g.plan_id = v_plan and g.round_number = 1 and (g.side_a_id = v_side_away or g.side_b_id = v_side_away);

  perform pg_temp.check(
    pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, %s, %s)', v_g_away,
      case when v_away_is_a then 25 else 3 end, case when v_away_is_a then 3 else 25 end)) = 'OK',
    '7 (C): Away submits a score');
  -- Resolution is the TOURNAMENT HOST's job, not either playing side's -- v_host_ca is the tournament's
  -- own host_club_id admin (unlike v_away_ca, a merely-participating club's admin).
  perform pg_temp.check(
    pg_temp.try_as(v_host_ca, format('select public.resolve_tournament_game_result(%L::uuid, %s, %s, %L)', v_g_away,
      case when v_away_is_a then 25 else 3 end, case when v_away_is_a then 3 else 25 end, 'Walkover, recorded by the organiser')) = 'OK',
    '8 (C): and the tournament''s own organiser resolves it');

  select count(*) into v_n from public.notifications
  where user_id = v_away_ca and type = 'tournament_side_advanced' and body like '%Host%';
  perform pg_temp.check(v_n = 1, '9 (C): the away club''s admin is told they are through, WITH the opponent''s name');

  -- ============ D. THE FIRST WINNER NOW GETS THE FOLLOW-UP ============
  select count(*) into v_n from public.notifications
  where user_id = v_host_ca and type = 'tournament_opponent_known' and body like '%Away%';
  perform pg_temp.check(v_n = 1, '10 (D): the host club''s admin -- who was already through -- now learns the opponent, once');

  select count(*) into v_n from public.notifications where user_id = v_away_ca and type = 'tournament_opponent_known';
  perform pg_temp.check(v_n = 0, '11 (D): the away club does not ALSO get the follow-up -- it already had the name inline');

  -- ============ E. NOBODY ELSE HEARS ANYTHING ============
  select count(*) into v_n from public.notifications
  where type in ('tournament_side_advanced', 'tournament_opponent_known')
    and user_id not in (v_host_ca, v_away_ca)
    and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.check(v_n = 0, '12 (E): no eliminated side, no bystander, hears about this progression');

  select count(*) into v_n from public.notifications where type = 'tournament_side_advanced'
    and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.check(v_n = 2, '13 (E): exactly two advance notifications total -- one per side, never duplicated by a later no-op call');
end $$;

rollback;
