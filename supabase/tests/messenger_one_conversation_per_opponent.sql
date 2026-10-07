-- ONE CONVERSATION PER OPPOSING TEAM (20270757000000). Self-seeding and rolled back; NOTICE PASS/FAIL lines.
--
--   K  fixtures between the same two sides share one conversation; another side, another conversation
--   M  a changed opponent leaves the shared conversation; a mirror row agrees with its fixture
--   A  access is not widened: an outsider still reads nothing, the other club still reads its own side only
--   S  mute and leave follow the conversation, and a new fixture inherits them
--   R  reading clears every fixture's notifications, only for the reader, only where they may read

\set ON_ERROR_STOP 0
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
create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
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
  v_home_admin uuid := gen_random_uuid();
  v_away_admin uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_dir1 uuid; v_dir2 uuid; v_dir3 uuid; v_club1 uuid; v_club2 uuid; v_club3 uuid;
  v_type uuid; v_season uuid;
  v_home uuid; v_away uuid; v_third uuid;
  v_f1 uuid; v_f2 uuid; v_f3 uuid; v_f4 uuid; v_ext1 uuid; v_ext2 uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_e1 uuid; v_e2 uuid;
  v_n int; v_txt text; v_b boolean;
begin
  foreach v_person in array array[v_home_admin, v_away_admin, v_outsider] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ocp-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'One', 'Conversation', 'ocp-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('OCP Home ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ocp-h-' || v_tag) returning id into v_dir1;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('OCP Away ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ocp-a-' || v_tag) returning id into v_dir2;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('OCP Third ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ocp-t-' || v_tag) returning id into v_dir3;
  insert into public.clubs (directory_id, slug, status) values (v_dir1, 'ocp-h-' || v_tag, 'active') returning id into v_club1;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'ocp-a-' || v_tag, 'active') returning id into v_club2;
  insert into public.clubs (directory_id, slug, status) values (v_dir3, 'ocp-t-' || v_tag, 'active') returning id into v_club3;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club1, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_home;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club2, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_away;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club3, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_third;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club1, v_home_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_away_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club3, v_outsider, 'CLUB_ADMIN', 'active');
  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;

  -- =====================================================================
  -- K. ONE CONVERSATION PER PAIR OF SIDES
  -- =====================================================================
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, v_away, 'Home', 'OCP Away', current_date + 7, 'Booked', 'club_created', v_season) returning id, conversation_id into v_f1, v_c1;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, v_away, 'Away', 'OCP Away', current_date + 21, 'Booked', 'club_created', v_season) returning id, conversation_id into v_f2, v_c2;
  perform pg_temp.check(v_c1 = v_c2, 'K1 a second fixture between the same two sides joins the first one''s conversation');
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_away, v_home, 'Home', 'OCP Home', current_date + 35, 'Booked', 'club_created', v_season) returning id, conversation_id into v_f3, v_c3;
  perform pg_temp.check(v_c3 = v_c1, 'K2 the pair is unordered: their home fixture against us is the same conversation');
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, v_third, 'Home', 'OCP Third', current_date + 14, 'Booked', 'club_created', v_season) returning id, conversation_id into v_f4, v_c4;
  perform pg_temp.check(v_c4 <> v_c1, 'K3 a different opposing team is a different conversation');
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, 'Home', 'Old Boys RFC', current_date + 9, 'Booked', 'club_created', v_season) returning id, conversation_id into v_ext1, v_e1;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, 'Away', '  old boys   rfc ', current_date + 30, 'Booked', 'club_created', v_season) returning id, conversation_id into v_ext2, v_e2;
  perform pg_temp.check(v_e1 = v_e2 and v_e1 <> v_c1, 'K4 an off-platform opponent typed twice (any spacing or case) is one conversation of its own');

  -- =====================================================================
  -- M. A CHANGED OPPONENT
  -- =====================================================================
  update public.fixtures set opponent_team_id = v_third where id = v_f2;
  select conversation_id into v_c2 from public.fixtures where id = v_f2;
  perform pg_temp.check(v_c2 = v_c4, 'M1 a fixture whose opponent changes moves to that opponent''s conversation');
  update public.fixtures set opponent_team_id = null, raw_opposition_text = 'Brand New RFC' where id = v_f4;
  select conversation_id into v_c4 from public.fixtures where id = v_f4;
  perform pg_temp.check(v_c4 not in (v_c1, v_c2, v_e1), 'M2 and a fixture against a side nobody has played yet gets a conversation of its own');
  perform pg_temp.check((select conversation_id from public.fixtures where id = v_f3) = v_c1, 'M3 the others stay where they were');

  -- =====================================================================
  -- A. ACCESS IS NOT WIDENED
  -- =====================================================================
  insert into public.fixture_messages (fixture_id, sender_user_id, body, kind, content_type)
  values (v_f1, v_home_admin, 'First match: pitch 2', 'message', 'text');
  insert into public.fixture_messages (fixture_id, sender_user_id, body, kind, content_type)
  values (v_f3, v_away_admin, 'Return match: our place', 'message', 'text');
  perform pg_temp.act('authenticated', v_home_admin);
  select count(*) into v_n from public.fixture_messages where conversation_id = v_c1;
  perform pg_temp.check(v_n = 2, format('A1 one side reads the whole conversation, both matches (%s)', v_n));
  perform pg_temp.act('authenticated', v_away_admin);
  select count(*) into v_n from public.fixture_messages where conversation_id = v_c1;
  perform pg_temp.check(v_n = 2, format('A2 so does the other side (%s)', v_n));
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n from public.fixture_messages where conversation_id = v_c1;
  perform pg_temp.check(v_n = 0, format('A3 a third club reads nothing of it (%s)', v_n));
  v_txt := pg_temp.try(format('select public.send_conversation_message(''fixture'', %L, ''hi'', %L, null)', v_f1, gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('A4 nor posts into it (%s)', v_txt));

  -- =====================================================================
  -- S. MUTE AND LEAVE FOLLOW THE CONVERSATION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_home_admin);
  perform public.set_fixture_conversation_mute(v_f1, null, true);
  perform pg_temp.act_postgres();
  select bool_and(muted) into v_b from public.fixture_conversation_subscriptions where user_id = v_home_admin and fixture_id in (v_f1, v_f3);
  select count(*) into v_n from public.fixture_conversation_subscriptions where user_id = v_home_admin and fixture_id in (v_f1, v_f3);
  perform pg_temp.check(v_b and v_n = 2, format('S1 muting through one match mutes the conversation (%s fixtures muted)', v_n));
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_home, v_away, 'Home', 'OCP Away', current_date + 50, 'Booked', 'club_created', v_season) returning id into v_f2;
  perform pg_temp.check(coalesce((select muted from public.fixture_conversation_subscriptions where user_id = v_home_admin and fixture_id = v_f2), false),
    'S2 a newly arranged match against them inherits the mute');
  perform pg_temp.act('authenticated', v_home_admin);
  perform public.set_fixture_conversation_mute(v_f3, null, false);
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.fixture_conversation_subscriptions where user_id = v_home_admin and fixture_id in (v_f1, v_f2, v_f3) and muted;
  perform pg_temp.check(v_n = 0, format('S3 and unmuting through any match unmutes all of it (%s still muted)', v_n));

  -- =====================================================================
  -- R. READING CLEARS THE CONVERSATION
  -- =====================================================================
  delete from public.notifications where user_id in (v_home_admin, v_away_admin, v_outsider) and type = 'new_fixture_message';
  insert into public.notifications (user_id, type, title, body, data) values
    (v_home_admin, 'new_fixture_message', 't', 'b', jsonb_build_object('fixture_id', v_f1)),
    (v_home_admin, 'new_fixture_message', 't', 'b', jsonb_build_object('fixture_id', v_f3)),
    (v_home_admin, 'new_fixture_message', 't', 'b', jsonb_build_object('fixture_id', v_ext1)),
    (v_away_admin, 'new_fixture_message', 't', 'b', jsonb_build_object('fixture_id', v_f1));
  perform pg_temp.act('authenticated', v_home_admin);
  v_n := public.mark_fixture_conversation_read(v_f3);
  perform pg_temp.check(v_n = 2, format('R1 opening any match reads every match''s messages in the conversation (%s)', v_n));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select read_at is null from public.notifications where user_id = v_home_admin and data ->> 'fixture_id' = v_ext1::text),
    'R2 a different conversation is left unread');
  perform pg_temp.check((select read_at is null from public.notifications where user_id = v_away_admin and data ->> 'fixture_id' = v_f1::text),
    'R3 nobody else''s notifications are touched');
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.mark_fixture_conversation_read(%L)', v_f1));
  perform pg_temp.check(v_txt = '42501', format('R4 an outsider cannot use a fixture id to touch the conversation (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.mark_fixture_conversation_read(%L)', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('R5 an id that does not exist gets the same answer (%s)', v_txt));
end $$;

rollback;
