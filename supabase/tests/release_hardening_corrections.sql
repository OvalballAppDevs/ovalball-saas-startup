-- RELEASE HARDENING CORRECTIONS (8 Oct 2026) -- the pre-release security and migration corrections, proved as the
-- people they are about, against the real functions. Wrapped in a transaction and rolled back.
--   RH-598  count_tournament_age_group_impact answers only the people running the tournament
--   RH-605  tournament_team_entries reads with the caller's rights; a game's pitch is the host's or reserved
--   RH-OPP  a fixture's new opponent never reads the previous opponent's conversation, by any read path
--   RH-SRV  a fixture's conversation (and mirror) is server-owned
--   RH-MRG  the conversation merge is fail-fast, whole, and keeps mute/leave and unread state
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -v ON_ERROR_STOP=0 < supabase/tests/release_hardening_corrections.sql

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rh-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Rh',p_label,'rh-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RH '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','rh-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'rh-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  select p_club, 'RH '||p_key, 'rh-'||p_key||'-'||v_tag, c.category, c.age_group, c.gender, 'union', c.id, true
    from public.canonical_team_types_by_code c where c.rugby_code = 'union' and c.key = p_key returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club,p_user,p_role,'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text) returns void language plpgsql as $$
begin insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership,p_team,p_role_key); end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if; end $$;

-- Acting as a person with a LIVE session (an MFA-elevated one, so no authority is refused for its assurance level).
create or replace function pg_temp.act(p_subject uuid) returns void language plpgsql as $$
declare v_s uuid;
begin
  perform set_config('role','none',true);
  select id into v_s from auth.sessions where user_id = p_subject limit 1;
  if v_s is null then
    v_s := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_s, p_subject, now(), now(), 'aal2');
    insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at)
    values (gen_random_uuid(), v_s, 'totp', now(), now());
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',p_subject,'role','authenticated','aal','aal2','session_id',v_s)::text, true);
  perform set_config('role','authenticated', true);
end $$;
create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;
create or replace function pg_temp.as_int(p_subject uuid, p_sql text) returns int language plpgsql as $$
declare v int;
begin perform pg_temp.act(p_subject); execute p_sql into v; perform pg_temp.act_postgres(); return v; end $$;
create or replace function pg_temp.as_bool(p_subject uuid, p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin perform pg_temp.act(p_subject); execute p_sql into v; perform pg_temp.act_postgres(); return v; end $$;
-- An internal authority helper asked AS a person: their identity and live session, evaluated by the owner role
-- (the helpers are not all executable by a browser role; what matters is the answer they give for this person).
create or replace function pg_temp.claims_bool(p_subject uuid, p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.act(p_subject);
  perform set_config('role','none',true);
  execute p_sql into v;
  perform pg_temp.act_postgres();
  return v;
end $$;
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin perform pg_temp.act(p_subject); v := pg_temp.try(p_sql); perform pg_temp.act_postgres(); return v; end $$;

grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.act(uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.as_int(uuid, text) to public;
grant execute on function pg_temp.as_bool(uuid, text) to public;
grant execute on function pg_temp.try_as(uuid, text) to public;
grant execute on function pg_temp.claims_bool(uuid, text) to public;

do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_a13 uuid; v_a14 uuid; v_a12 uuid; v_b13 uuid; v_c13 uuid; v_c12 uuid; v_coach_c12 uuid;
  v_ca_a uuid; v_ca_b uuid; v_ca_c uuid; v_member_a uuid; v_coach_a13 uuid; v_coach_b13 uuid; v_coach_c13 uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_m uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid;
  v_t uuid; v_side_a uuid; v_side_b uuid; v_pitch_a uuid; v_pitch_b uuid; v_day date := current_date + 30;
  v_fx uuid; v_conv1 uuid; v_conv2 uuid; v_msg_old uuid; v_msg_new uuid; v_path text;
  v_f1 uuid; v_f2 uuid; v_f3 uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_g1 uuid; v_g2 uuid; v_fold1 uuid; v_fold2 uuid;
  v_req uuid; v_rgroup uuid; v_req_msg uuid; v_req_conv_before uuid;
  v_state text; v_n int; v_n2 int; v_reads_before int; v_notif_before int; v_cursor timestamptz;
begin
  v_a := pg_temp.club('Ashby'); v_b := pg_temp.club('Burnley'); v_c := pg_temp.club('Clitheroe');
  select directory_id into v_dir_a from public.clubs where id = v_a;
  select directory_id into v_dir_b from public.clubs where id = v_b;
  select directory_id into v_dir_c from public.clubs where id = v_c;
  v_a13 := pg_temp.team(v_a,'u13'); v_a14 := pg_temp.team(v_a,'u14'); v_a12 := pg_temp.team(v_a,'u12');
  v_b13 := pg_temp.team(v_b,'u13'); v_c13 := pg_temp.team(v_c,'u13'); v_c12 := pg_temp.team(v_c,'u12');

  v_ca_a := pg_temp.person('CA-A'); perform pg_temp.member(v_a, v_ca_a, 'CLUB_ADMIN');
  v_ca_b := pg_temp.person('CA-B'); perform pg_temp.member(v_b, v_ca_b, 'CLUB_ADMIN');
  v_ca_c := pg_temp.person('CA-C'); perform pg_temp.member(v_c, v_ca_c, 'CLUB_ADMIN');
  v_member_a := pg_temp.person('MEMBER-A'); perform pg_temp.member(v_a, v_member_a);
  v_coach_a13 := pg_temp.person('COACH-A13'); v_m := pg_temp.member(v_a, v_coach_a13); perform pg_temp.team_role(v_m, v_a13, 'COACH');
  v_coach_b13 := pg_temp.person('COACH-B13'); v_m := pg_temp.member(v_b, v_coach_b13); perform pg_temp.team_role(v_m, v_b13, 'COACH');
  v_coach_c13 := pg_temp.person('COACH-C13'); v_m := pg_temp.member(v_c, v_coach_c13); perform pg_temp.team_role(v_m, v_c13, 'COACH');
  v_coach_c12 := pg_temp.person('COACH-C12'); v_m := pg_temp.member(v_c, v_coach_c12); perform pg_temp.team_role(v_m, v_c12, 'COACH');

  -- ==============================================================================================================
  -- RH-598  WHAT AN AGE-GROUP CHANGE WOULD COST IS ASKED ONLY BY THE PEOPLE RUNNING THE TOURNAMENT
  -- ==============================================================================================================
  insert into public.tournaments (name, host_club_id, host_directory_id, event_date, ends_on, rugby_code, visibility)
  values ('RH Festival', v_a, v_dir_a, v_day, v_day, 'union', 'private') returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U13'), (v_t, 'U12');
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_a, v_a, v_a13, 'U13', 'added') returning id into v_side_a;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_b, v_b, v_b13, 'U13', 'accepted') returning id into v_side_b;

  v_state := pg_temp.try_as(v_ca_a, format('select count(*) from public.count_tournament_age_group_impact(%L, array[''U12''])', v_t));
  perform pg_temp.check(v_state = 'OK', format('RH-598a the host Club Admin (tournament manager) is answered (%s)', v_state));
  v_n := pg_temp.as_int(v_ca_a, format('select coalesce(sum(other_teams),0)::int from public.count_tournament_age_group_impact(%L, array[''U12''])', v_t));
  perform pg_temp.check(v_n = 2, format('RH-598b and the answer is the true count of sides the removal would affect (%s)', v_n));
  v_state := pg_temp.try_as(v_member_a, format('select count(*) from public.count_tournament_age_group_impact(%L, null)', v_t));
  perform pg_temp.check(v_state = '42501', format('RH-598c a same-club member without the authority is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_b, format('select count(*) from public.count_tournament_age_group_impact(%L, null)', v_t));
  perform pg_temp.check(v_state = '42501', format('RH-598d a participating club''s admin who does not run it is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_c, format('select count(*) from public.count_tournament_age_group_impact(%L, null)', v_t));
  perform pg_temp.check(v_state = '42501', format('RH-598e an unrelated club''s admin is refused (%s)', v_state));
  perform set_config('request.jwt.claims', json_build_object('sub',v_ca_a,'role','authenticated','aal','aal2','session_id',gen_random_uuid())::text, true);
  perform set_config('role','authenticated', true);
  v_state := pg_temp.try(format('select count(*) from public.count_tournament_age_group_impact(%L, null)', v_t));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('RH-598f with a dead session (revoked or unknown) even the manager is refused (%s)', v_state));
  perform set_config('role','anon', true);
  v_state := pg_temp.try(format('select count(*) from public.count_tournament_age_group_impact(%L, null)', v_t));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('RH-598g a signed-out caller cannot even execute it (%s)', v_state));

  -- ==============================================================================================================
  -- RH-605  THE COMPATIBILITY VIEW READS WITH THE CALLER'S RIGHTS; A GAME'S PITCH IS THE HOST'S OR RESERVED
  -- ==============================================================================================================
  perform pg_temp.check(
    (select coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'tournament_team_entries') = 'true',
    'RH-605a tournament_team_entries is a caller-rights view');
  v_n := pg_temp.as_int(v_ca_c, format('select count(*)::int from public.tournament_team_entries where tournament_id = %L', v_t));
  v_n2 := pg_temp.as_int(v_ca_c, format('select count(*)::int from public.tournament_participants where tournament_id = %L', v_t));
  perform pg_temp.check(v_n = 0 and v_n2 = 0, format('RH-605b an unrelated club reads no host side through the view, as through the table (%s, %s)', v_n, v_n2));
  v_n := pg_temp.as_int(v_ca_a, format('select count(*)::int from public.tournament_team_entries where tournament_id = %L', v_t));
  perform pg_temp.check(v_n = 1, format('RH-605c the host club still reads its own side (%s)', v_n));

  insert into public.club_pitches (club_id, display_name) values (v_a, 'RH Host Pitch') returning id into v_pitch_a;
  insert into public.club_pitches (club_id, display_name) values (v_b, 'RH Elsewhere Pitch') returning id into v_pitch_b;
  v_state := pg_temp.try(format('insert into public.tournament_games (tournament_id, game_date, side_a_id, side_b_id, age_group, pitch_id) values (%L, %L, %L, %L, ''U13'', %L)', v_t, v_day, v_side_a, v_side_b, v_pitch_a));
  perform pg_temp.check(v_state = 'OK', format('RH-605d a game on the host club''s own pitch is accepted (%s)', v_state));
  v_state := pg_temp.try(format('insert into public.tournament_games (tournament_id, game_date, side_a_id, side_b_id, age_group, pitch_id) values (%L, %L, %L, %L, ''U13'', %L)', v_t, v_day, v_side_a, v_side_b, v_pitch_b));
  perform pg_temp.check(v_state = '23514', format('RH-605e a game on another club''s unreserved pitch is refused (%s)', v_state));
  -- A tournament reserves only its host's pitches (an existing rule), so a reserved pitch is a host pitch.
  insert into public.club_pitches (club_id, display_name) values (v_a, 'RH Host Pitch Two') returning id into v_pitch_b;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time) values (v_t, v_pitch_b, v_day, '09:00', '17:00');
  v_state := pg_temp.try(format('insert into public.tournament_games (tournament_id, game_date, side_a_id, side_b_id, age_group, pitch_id) values (%L, %L, %L, %L, ''U13'', %L)', v_t, v_day, v_side_a, v_side_b, v_pitch_b));
  perform pg_temp.check(v_state = 'OK', format('RH-605f a game on the tournament''s reserved pitch is accepted (%s)', v_state));
  v_state := pg_temp.try(format('update public.tournament_games set pitch_id = (select id from public.club_pitches where display_name = ''RH Elsewhere Pitch'' order by created_at desc limit 1) where tournament_id = %L', v_t));
  perform pg_temp.check(v_state = '23514', format('RH-605f2 moving a game onto another club''s pitch by update is refused (%s)', v_state));
  perform pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'internal' and p.proname = 'validate_tournament_game_pitch'
                                      and pg_get_functiondef(p.oid) ~ 'pitch_allocation'),
    'RH-605g the pitch rule is about the pitch, not about who places it: it asks no pitch-allocation authority');

  -- ==============================================================================================================
  -- RH-OPP  A NEW OPPONENT NEVER READS THE PREVIOUS OPPONENT'S CONVERSATION
  -- ==============================================================================================================
  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_a13, v_b13, v_dir_b, current_date + 10, 'Home', 'RH Burnley U13') returning id into v_fx;
  select conversation_id into v_conv1 from public.fixtures where id = v_fx;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'Meet at 9 -- see you Saturday', 'text')
  returning id into v_msg_old;
  v_path := 'f/' || v_fx::text || '/' || v_msg_old::text || '/team-sheet.pdf';
  insert into public.fixture_message_attachments (message_id, size_bytes, uploaded_by, storage_path, original_filename, mime_type)
  values (v_msg_old, 1000, v_coach_a13, v_path, 'team-sheet.pdf', 'application/pdf');
  perform pg_temp.check(pg_temp.as_int(v_coach_b13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 1,
    'RH-OPP-a precondition: the opponent at the time reads the thread');

  -- The opponent changes through the canonical edit, as the owning club's admin.
  v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_opposition(%L, %L, %L, ''RH Clitheroe U13'')', v_fx, v_c13, v_dir_c));
  perform pg_temp.check(v_state = 'OK', format('RH-OPP-b the owning club changes the opponent (%s)', v_state));
  select conversation_id into v_conv2 from public.fixtures where id = v_fx;
  perform pg_temp.check(v_conv2 is distinct from v_conv1, 'RH-OPP-c the fixture starts a conversation of its own, even though it was alone in the old one');
  perform pg_temp.check((select conversation_id from public.fixture_messages where id = v_msg_old) = v_conv1,
    'RH-OPP-d the earlier message stays, in the conversation it was written in (nothing deleted or moved)');

  perform pg_temp.check(pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 0,
    'RH-OPP-e the NEW opponent cannot read the earlier message through the table');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_read_attached_message(%L)', v_msg_old)),
    'RH-OPP-f nor through the receipt / read-marking / attachment-row check');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_post_to_message(%L)', v_msg_old)),
    'RH-OPP-g nor react to it or reply to it');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_access_message(m) from public.fixture_messages m where m.id = %L', v_msg_old)),
    'RH-OPP-h nor report it');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_access_message_attachment_path(%L, false)', v_path)),
    'RH-OPP-i nor download its file through storage, although the path names the fixture');
  perform pg_temp.check(pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_message_attachments where message_id = %L', v_msg_old)) = 0,
    'RH-OPP-j nor see the attachment row');
  v_state := pg_temp.try_as(v_coach_c13, format('select public.set_message_reaction(%L, ''👍'')', v_msg_old));
  perform pg_temp.check(v_state <> 'OK', format('RH-OPP-k a reaction from the new opponent is refused (%s)', v_state));

  perform pg_temp.check(pg_temp.as_int(v_coach_a13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 1,
    'RH-OPP-l the owning side keeps its own history');
  perform pg_temp.check(pg_temp.as_int(v_coach_b13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 1,
    'RH-OPP-m the previous opponent keeps the conversation it was part of (no access removed from its parties)');
  perform pg_temp.check(pg_temp.claims_bool(v_coach_b13, format('select internal.can_access_message_attachment_path(%L, false)', v_path)),
    'RH-OPP-n and its file');

  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'New kick-off is 10:30', 'text')
  returning id into v_msg_new;
  v_state := pg_temp.try_as(v_coach_a13, format('select public.send_conversation_message(''fixture'', %L, ''Re: the old plan'', gen_random_uuid(), %L)', v_fx, v_msg_old));
  perform pg_temp.check(v_state = '22023', format('RH-OPP-t a reply in the new conversation cannot quote a message from the old one (%s)', v_state));
  perform pg_temp.check((select conversation_id from public.fixture_messages where id = v_msg_new) = v_conv2,
    'RH-OPP-o a new message goes to the new conversation');
  perform pg_temp.check(pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_new)) = 1,
    'RH-OPP-p the new opponent reads the new conversation');
  perform pg_temp.check(pg_temp.as_int(v_coach_b13, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_new)) = 0,
    'RH-OPP-q and the previous opponent does not');

  -- A directory club that joins later: the external fixture's thread is not handed to the newly linked team.
  insert into public.fixtures (owning_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_a12, v_dir_c, current_date + 12, 'Home', 'RH Clitheroe Juniors') returning id into v_fx;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_ca_a, 'Internal: their coach is new', 'text')
  returning id into v_msg_old;
  update public.fixtures set opponent_team_id = v_c12 where id = v_fx;
  perform pg_temp.check(pg_temp.as_int(v_coach_c12, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 0,
    'RH-OPP-r a club linked later does not read what the owning club wrote before it was linked');
  perform pg_temp.check(pg_temp.as_int(v_ca_a, format('select count(*)::int from public.fixture_messages where id = %L', v_msg_old)) = 1,
    'RH-OPP-s while the owning club still does');

  -- ==============================================================================================================
  -- RH-SRV  A FIXTURE'S CONVERSATION IS SERVER-OWNED
  -- ==============================================================================================================
  select id into v_fx from public.fixtures where owning_team_id = v_a13 limit 1;
  v_state := pg_temp.try_as(v_ca_a, format('update public.fixtures set conversation_id = %L where id = %L', v_conv1, v_fx));
  perform pg_temp.check(v_state = '42501', format('RH-SRV-a a side''s admin cannot point their fixture at another conversation (%s)', v_state));
  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_b13, v_c13, v_dir_c, current_date + 14, 'Home', 'RH Victim Pair') returning id into v_g1;
  v_state := pg_temp.try_as(v_ca_a, format('update public.fixtures set mirror_fixture_id = %L where id = %L', v_g1, v_fx));
  perform pg_temp.check(v_state = '42501', format('RH-SRV-b nor adopt another fixture''s conversation by naming it as a mirror (%s)', v_state));
  -- The supported client edits of a fixture are untouched by the guard (an opponent change goes through the
  -- canonical RPC, RH-OPP-b, where the server picks the conversation). Since 20270766000000 (D-001) every client edit
  -- is a controlled action: the direct write is refused, the RPC works.
  v_state := pg_temp.try_as(v_ca_a, format('update public.fixtures set notes = ''Bring the spare kit'' where id = %L', v_fx));
  perform pg_temp.check(v_state = '42501', format('RH-SRV-c0 a direct edit of a fixture is refused, even on their own fixture (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('notes', 'Bring the spare kit')));
  perform pg_temp.check(v_state = 'OK', format('RH-SRV-c an ordinary edit of their own fixture still works (%s)', v_state));

  -- A fixture update that is not HOT recomputes every index, including the expression index on the opponent key, as
  -- the writer: the writer must be able to execute it, or such updates fail intermittently with permission denied.
  perform pg_temp.check(has_function_privilege('authenticated', 'internal.fixture_opponent_key(uuid,uuid,uuid,text,text)', 'execute'),
    'RH-SRV-d a signed-in writer can maintain the opponent-key index (no intermittent permission failure on fixture updates)');
  for v_n in 1..12 loop
    v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('notes', 'Kit check ' || v_n)));
    exit when v_state <> 'OK';
  end loop;
  perform pg_temp.check(v_state = 'OK', format('RH-SRV-e twelve successive client edits of the same fixture all succeed (%s)', v_state));

  -- ==============================================================================================================
  -- RH-MRG  THE MERGE: FAIL-FAST, WHOLE, AND IT KEEPS WHAT PEOPLE CHOSE AND WHAT THEY HAVE NOT READ
  -- ==============================================================================================================
  v_u1 := v_coach_a13;                                                   -- read their own thread, never the others
  v_u2 := pg_temp.person('MANAGER-A13'); v_m := pg_temp.member(v_a, v_u2); perform pg_temp.team_role(v_m, v_a13, 'TEAM_MANAGER');
  v_u3 := v_ca_a;

  -- Three fixtures against one external side, split into three conversations as before 757.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 30, 'Home', 'RH Merge Vale') returning id into v_f1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 20, 'Away', 'RH Merge Vale') returning id into v_f2;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 10, 'Home', 'RH Merge Vale') returning id into v_f3;
  update public.fixtures set conversation_id = gen_random_uuid() where id in (v_f2, v_f3);
  select conversation_id into v_c1 from public.fixtures where id = v_f1;
  select conversation_id into v_c2 from public.fixtures where id = v_f2;
  select conversation_id into v_c3 from public.fixtures where id = v_f3;
  perform pg_temp.check(v_c1 <> v_c2 and v_c2 <> v_c3 and v_c1 <> v_c3, 'RH-MRG-a precondition: three threads for one opposing side');

  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type, created_at) values (v_f1, v_u1, 'first', 'text', now() - interval '5 days') returning id into v_m1;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type, created_at) values (v_f2, v_u2, 'second', 'text', now() - interval '4 days') returning id into v_m2;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type, created_at) values (v_f2, v_u2, 'third', 'text', now() - interval '3 days') returning id into v_m3;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type, created_at) values (v_f3, v_u3, 'fourth', 'text', now() - interval '2 days') returning id into v_m4;

  -- U1 has read their own thread (C1) and nothing else; U2 has read C2 only.
  insert into public.thread_read_cursors (thread_key, user_id, last_read_at) values (v_c1, v_u1, now() - interval '1 day');
  insert into public.thread_read_cursors (thread_key, user_id, last_read_at) values (v_c2, v_u2, now() - interval '3 days');
  -- U1 muted C1 three days ago and unmuted C2 two days ago (latest real choice: unmuted).
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at, updated_at) values (v_f1, v_u1, true, null, now() - interval '3 days');
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at, updated_at) values (v_f2, v_u1, false, null, now() - interval '2 days');
  -- U2 left C3 and touched C1 at the same moment (a tie: the more withdrawn choice, leaving, wins).
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at, updated_at) values (v_f3, v_u2, false, now() - interval '1 day', now() - interval '1 day');
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at, updated_at) values (v_f1, v_u2, false, null, now() - interval '1 day');

  -- A request thread between the clubs is a separate thing and must come through untouched.
  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, game_type, raw_opponent_text, created_by)
  values (v_b, v_a, current_date + 40, 'Friendly', 'RH Ashby', v_ca_b) returning id into v_rgroup;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by)
  values (v_rgroup, v_b13, v_a13, 'sent', 'either', v_ca_b) returning id into v_req;
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body, content_type) values (v_req, v_ca_b, 'Fancy a game?', 'text')
  returning id into v_req_msg;
  select conversation_id into v_req_conv_before from public.fixture_messages where id = v_req_msg;

  select count(*) into v_reads_before from public.message_reads;
  select count(*) into v_notif_before from public.notifications where read_at is null;

  -- FAIL-FAST: a second pair whose fixture the validators refuse to move (its team folded) aborts the whole merge.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a14, current_date - 15, 'Home', 'RH Folded Opp') returning id into v_fold1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values (v_a14, current_date + 15, 'Home', 'RH Folded Opp', 'Planned') returning id into v_fold2;
  update public.fixtures set conversation_id = gen_random_uuid() where id = v_fold2;
  perform set_config('ovalball.maintenance', 'on', true);
  update public.teams set active = false where id = v_a14;
  perform set_config('ovalball.maintenance', 'off', true);
  v_state := pg_temp.try('select internal.merge_fixture_conversations_by_opponent()');
  perform pg_temp.check(v_state <> 'OK', format('RH-MRG-b a fixture the validators refuse to move aborts the merge with its own error (%s)', v_state));
  perform pg_temp.check((select count(distinct conversation_id) from public.fixtures where id in (v_f1, v_f2, v_f3)) = 3,
    'RH-MRG-c and nothing was half-merged: the other pair is untouched too');

  perform set_config('ovalball.maintenance', 'on', true);
  update public.teams set active = true where id = v_a14;
  perform set_config('ovalball.maintenance', 'off', true);
  v_state := pg_temp.try('select internal.merge_fixture_conversations_by_opponent()');
  perform pg_temp.check(v_state = 'OK', format('RH-MRG-d with the refusal gone, the merge completes (%s)', v_state));

  perform pg_temp.check((select count(distinct conversation_id) from public.fixtures where id in (v_f1, v_f2, v_f3)) = 1,
    'RH-MRG-e one conversation for the opposing side');
  perform pg_temp.check((select count(distinct m.conversation_id) from public.fixture_messages m where m.id in (v_m1, v_m2, v_m3, v_m4)) = 1
                        and (select conversation_id from public.fixture_messages where id = v_m2) = (select conversation_id from public.fixtures where id = v_f1),
    'RH-MRG-f every message is in it, with its fixture');
  perform pg_temp.check((select count(*) from public.fixture_messages where id in (v_m1, v_m2, v_m3, v_m4)) = 4, 'RH-MRG-g no message lost');
  perform pg_temp.check((select conversation_id from public.fixture_messages where id = v_req_msg) is not distinct from v_req_conv_before
                        and (select fixture_request_id from public.fixture_messages where id = v_req_msg) = v_req,
    'RH-MRG-h the fixture-request thread is separate and untouched');

  select last_read_at into v_cursor from public.thread_read_cursors where user_id = v_u1 and thread_key = (select conversation_id from public.fixtures where id = v_f1);
  perform pg_temp.check(v_cursor < (select created_at from public.fixture_messages where id = v_m2),
    'RH-MRG-i U1''s read position sits before the first message they never read (the latest-cursor merge would have skipped it)');
  select last_read_at into v_cursor from public.thread_read_cursors where user_id = v_u2 and thread_key = (select conversation_id from public.fixtures where id = v_f1);
  perform pg_temp.check(v_cursor < (select created_at from public.fixture_messages where id = v_m1),
    'RH-MRG-j U2''s read position sits before U1''s message, which U2 never read');
  perform pg_temp.check((select count(*) from public.message_reads) = v_reads_before
                        and (select count(*) from public.notifications where read_at is null) = v_notif_before,
    'RH-MRG-k the merge marks nothing read: no receipt and no notification changes');
  perform pg_temp.check(not exists (select 1 from public.thread_read_cursors where thread_key in (v_c2, v_c3)
                                    and thread_key not in (select conversation_id from public.fixtures where id = v_f1)),
    'RH-MRG-l no read position is left on a merged-away thread');

  v_n := pg_temp.as_int(v_u1, format('select public.mark_thread_read(%L)', v_m4));
  perform pg_temp.check(v_n = 3, format('RH-MRG-m reading the merged thread now receipts the three messages U1 had never read (%s)', v_n));

  perform pg_temp.check((select bool_and(not s.muted and s.left_at is null) and count(*) = 3 from public.fixture_conversation_subscriptions s
                          where s.user_id = v_u1 and s.fixture_id in (v_f1, v_f2, v_f3)),
    'RH-MRG-n U1''s latest real choice (unmuted) applies to the whole merged conversation');
  perform pg_temp.check((select bool_and(s.left_at is not null) and count(*) = 3 from public.fixture_conversation_subscriptions s
                          where s.user_id = v_u2 and s.fixture_id in (v_f1, v_f2, v_f3)),
    'RH-MRG-o on a tie, U2''s leaving wins: a merge never quietly rejoins anybody');
  perform pg_temp.check(not exists (select 1 from public.fixture_conversation_subscriptions s where s.user_id = v_u3 and s.fixture_id in (v_f1, v_f2, v_f3)),
    'RH-MRG-p nobody gets a choice they never made');
  perform pg_temp.check((select max(s.updated_at) from public.fixture_conversation_subscriptions s where s.user_id = v_u1 and s.fixture_id in (v_f1, v_f2, v_f3))
                        < now() - interval '1 day',
    'RH-MRG-q the choice keeps the time it was made, so a later merge still compares real choices');
  perform pg_temp.check(pg_temp.as_int(v_u1, format('select count(*)::int from public.fixture_messages where id in (%L, %L, %L, %L)', v_m1, v_m2, v_m3, v_m4)) = 4,
    'RH-MRG-r the owning side reads the whole merged conversation');
end $$;

rollback;
