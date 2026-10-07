-- FIXTURE NOTIFICATIONS, END TO END -- proved where they are produced (20270715000000, 20270716000000).
--
--   NL-1  one domain event, one notification: a pitch change no longer also announces its system note
--         as a "New message"
--   NL-2  the copy names the fixture (home v away, team, date) and never prints a raw timestamp
--   NL-3  a change on a fixture against a club NOT on Ovalball still reaches the side's people
--   NL-4  families hear of pitch and kick-off changes; they never receive result business
--   NL-5  the result lifecycle: submitted -> awaiting (other club) -> disputed -> resubmitted (asks
--         again) -> confirmed -> final; organiser resolution -> final
--   NL-6  every list is newest first, whatever is read or unread
--   NL-7  deleting the target tidies its notifications away (dismissed, not deleted)
--   NL-8  push is independent of in-app: in-app off keeps a hidden row for push; both off sends none
--   NL-9  hidden rows never count as unread
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nl-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email) values (v, 'NL', p_label, 'nl-' || v::text || '@ovalball.test')
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_name text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (p_name, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'nl-' || substr(gen_random_uuid()::text, 1, 10))
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'nl-' || substr(gen_random_uuid()::text, 1, 10), 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_label text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'nl-' || substr(gen_random_uuid()::text, 1, 10), 'youth', 'U12', 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

do $$
declare
  v_ca_a uuid := pg_temp.person('Club Admin A');
  v_ca_b uuid := pg_temp.person('Club Admin B');
  v_site uuid := pg_temp.person('Site Admin');
  v_guardian uuid := pg_temp.person('Guardian A');
  v_club_a uuid := pg_temp.club('NL Ashford RFC');
  v_club_b uuid := pg_temp.club('NL Bramley RFC');
  v_team_a uuid;
  v_team_b uuid;
  v_player uuid;
  v_f_mutual uuid := gen_random_uuid();
  v_f_external uuid := gen_random_uuid();
  v_f_resolve uuid := gen_random_uuid();
  v_n int; v_m int; v_t timestamptz;
  v_body text;
  v_ids uuid[];
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_ca_a, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_ca_b, 'CLUB_ADMIN', 'active');
  insert into public.site_admins (user_id, status) values (v_site, 'active');
  v_team_a := pg_temp.team(v_club_a, 'NL Ashford U12');
  v_team_b := pg_temp.team(v_club_b, 'NL Bramley U12');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Nina', 'Lowe', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status, state) values (v_player, v_team_a, 'active', 'ACTIVE');
  insert into public.guardians (player_id, guardian_user_id, status) values (v_player, v_guardian, 'active');

  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_f_mutual, v_team_a, v_team_b, 'Home', 'NL Bramley RFC', current_date - 1, '10:30', 'Booked', 'club_created');
  insert into public.fixtures (id, owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_f_external, v_team_a, 'Away', 'NL Faraway RFC', current_date + 14, '10:30', 'Booked', 'club_created');
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_f_resolve, v_team_a, v_team_b, 'Home', 'NL Bramley RFC', current_date - 2, '10:30', 'Booked', 'club_created');

  -- ---- NL-1 / NL-2 / NL-4: a pitch change on a mutual fixture ---------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.update_fixture_pitch(v_f_mutual, null, 'Pitch 2');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.notifications where user_id = v_ca_b and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f_mutual::text;
  select count(*) into v_m from public.notifications where user_id = v_ca_b and type = 'new_fixture_message' and data ->> 'fixture_id' = v_f_mutual::text;
  perform pg_temp.check(v_n = 1 and v_m = 0, format('NL-1 one pitch change is one notification to the other club (%s pitch, %s message)', v_n, v_m));
  select body into v_body from public.notifications where user_id = v_ca_b and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f_mutual::text;
  perform pg_temp.check(v_body like '%NL Ashford RFC v NL Bramley RFC (Under 12 Boys)%' and v_body like '%Pitch 2%', format('NL-2 the copy names the fixture: %s', v_body));
  perform pg_temp.check(v_body !~ '\d{4}-\d{2}-\d{2}' and v_body not like '%your fixture%', 'NL-2 and prints no raw date or "your fixture"');
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_guardian and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f_mutual::text),
    'NL-4 the player''s guardian hears of the pitch change');

  -- ---- NL-3 / NL-4: changes on a fixture against a club not on Ovalball --------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.update_fixture_pitch(v_f_external, null, 'Their 3G');
  perform public.update_fixture_kickoff(v_f_external, current_date + 14, '11:30');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_guardian and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f_external::text),
    'NL-3 a pitch change against a club not on Ovalball reaches the family');
  select body into v_body from public.notifications where user_id = v_guardian and type = 'fixture_kickoff_changed' and data ->> 'fixture_id' = v_f_external::text;
  perform pg_temp.check(v_body is not null and v_body like '%11:30%' and v_body !~ '\d{4}-\d{2}-\d{2}', format('NL-3 a direct kick-off change is announced, readably: %s', v_body));

  -- ---- NL-5: the result lifecycle on the mutual fixture -------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.submit_fixture_result(v_f_mutual, 12, 10);
  perform set_config('role', 'none', true);
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_ca_a and type = 'fixture_result_awaiting_confirmation' and data ->> 'fixture_id' = v_f_mutual::text),
    'NL-5a the other club is asked to confirm a submitted result');
  perform pg_temp.check((select body from public.notifications where user_id = v_ca_a and type = 'fixture_result_awaiting_confirmation' and data ->> 'fixture_id' = v_f_mutual::text limit 1)
      like 'A result of 12 - 10 has been submitted for NL Ashford RFC v NL Bramley RFC (Under 12 Boys)%',
    'NL-2 a result notification names the fixture and reads home score first');

  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.submit_fixture_result(v_f_mutual, 10, 12);
  perform set_config('role', 'none', true);
  perform pg_temp.check((select result_status from public.fixtures where id = v_f_mutual) = 'disputed'
    and exists (select 1 from public.notifications where user_id = v_ca_b and type = 'fixture_result_disputed' and data ->> 'fixture_id' = v_f_mutual::text),
    'NL-5b a different score disputes it, and the submitter is told');

  select count(*) into v_n from public.notifications where user_id = v_ca_a and type = 'fixture_result_awaiting_confirmation' and data ->> 'fixture_id' = v_f_mutual::text;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.submit_fixture_result(v_f_mutual, 10, 12);
  perform set_config('role', 'none', true);
  select count(*) into v_m from public.notifications where user_id = v_ca_a and type = 'fixture_result_awaiting_confirmation' and data ->> 'fixture_id' = v_f_mutual::text;
  perform pg_temp.check((select result_status from public.fixtures where id = v_f_mutual) = 'awaiting_confirmation' and v_m = v_n + 1,
    'NL-5c a new score during a dispute asks the other club to confirm again');

  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.submit_fixture_result(v_f_mutual, 10, 12);
  perform set_config('role', 'none', true);
  perform pg_temp.check((select result_status from public.fixtures where id = v_f_mutual) = 'final'
    and exists (select 1 from public.notifications where user_id = v_ca_b and type = 'fixture_result_final' and data ->> 'fixture_id' = v_f_mutual::text),
    'NL-5d confirming the same score makes it final, and the other club is told');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_guardian and type like 'fixture_result_%'),
    'NL-4 families never receive result business');

  -- Organiser resolution.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.submit_fixture_result(v_f_resolve, 5, 5);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_a, 'role', 'authenticated')::text, true);
  perform public.submit_fixture_result(v_f_resolve, 7, 5);
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.resolve_fixture_result_dispute(v_f_resolve, 7, 5, 'Referee''s card');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check((select result_status from public.fixtures where id = v_f_resolve) = 'final'
    and exists (select 1 from public.notifications where user_id = v_ca_a and type = 'fixture_result_final' and data ->> 'fixture_id' = v_f_resolve::text)
    and exists (select 1 from public.notifications where user_id = v_ca_b and type = 'fixture_result_final' and data ->> 'fixture_id' = v_f_resolve::text),
    'NL-5e an organiser''s resolution makes it final and tells both clubs');

  -- ---- NL-6: newest first, whatever is read -------------------------------------------------------
  v_t := now() - interval '1 hour';
  with seeded as (
    insert into public.notifications (user_id, type, title, body, data, created_at, read_at)
    values (v_guardian, 'fixture_details_changed', 'Order 1 (oldest, unread)', 'x', '{}'::jsonb, v_t, null),
           (v_guardian, 'fixture_details_changed', 'Order 2 (read)', 'x', '{}'::jsonb, v_t + interval '1 minute', v_t + interval '5 minutes'),
           (v_guardian, 'fixture_details_changed', 'Order 3 (unread)', 'x', '{}'::jsonb, v_t + interval '2 minutes', null),
           (v_guardian, 'fixture_details_changed', 'Order 4 (newest, read)', 'x', '{}'::jsonb, v_t + interval '3 minutes', v_t + interval '6 minutes')
    returning id
  ) select array_agg(id) into v_ids from seeded;
end $$;

-- NL-6 assertions, outside the block above so the arrays are plain text.
do $$
declare v_guardian uuid; v_titles text[]; v_bell text[];
begin
  select user_id into v_guardian from public.notifications where title = 'Order 1 (oldest, unread)' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select array_agg(title) into v_titles from (select title from public.my_notifications(50) where title like 'Order %') x;
  select array_agg(title) into v_bell from (select title from public.my_bell_notifications(50) where title like 'Order %') y;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_titles = array['Order 4 (newest, read)', 'Order 3 (unread)', 'Order 2 (read)', 'Order 1 (oldest, unread)'],
    format('NL-6 the paged feed is newest first regardless of read state: %s', v_titles));
  perform pg_temp.check(v_bell = v_titles, format('NL-6 the website''s bell is the same order: %s', v_bell));
end $$;

-- NL-10: mixed families with interleaved timestamps -- read, unread, action-required, resolved -- keep
-- exactly the same newest-first order before and after reading them and resolving their job.
do $$
declare
  v_user uuid := pg_temp.person('Order Mixed');
  v_session uuid := gen_random_uuid();
  v_t timestamptz := now() - interval '3 hours';
  v_before text[]; v_after text[]; v_bell text[];
  v_ids uuid[];
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_session, v_user, now(), now(), 'aal1');
  insert into public.notifications (user_id, type, title, body, data, created_at, read_at) values
    (v_user, 'fixture_pitch_changed',                  'M1 fixture (read)',            'x', '{}'::jsonb, v_t + interval '10 minutes', v_t),
    (v_user, 'tournament_result_awaiting_confirmation','M2 tournament ask (unread)',   'x', '{}'::jsonb, v_t + interval '40 minutes', null),
    (v_user, 'new_fixture_message',                    'M3 message (unread)',          'x', '{}'::jsonb, v_t + interval '20 minutes', null),
    (v_user, 'fixture_result_awaiting_confirmation',   'M4 fixture ask (unread)',      'x', '{}'::jsonb, v_t + interval '30 minutes', null),
    (v_user, 'tournament_schedule_published',          'M5 tournament info (read)',    'x', '{}'::jsonb, v_t + interval '50 minutes', v_t),
    (v_user, 'training_session_updated',               'M6 training (unread)',         'x', '{}'::jsonb, v_t + interval '5 minutes',  null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated', 'session_id', v_session)::text, true);
  perform set_config('role', 'authenticated', true);
  select array_agg(title) into v_before from (select title from public.my_notifications(50) where title like 'M%') x;
  -- Read the two asks and the oldest row; the business jobs they were about are resolved elsewhere.
  select array_agg(id) into v_ids from public.notifications where user_id = v_user and title in ('M2 tournament ask (unread)', 'M4 fixture ask (unread)', 'M6 training (unread)');
  perform public.mark_notification_read(v_ids[1]); perform public.mark_notification_read(v_ids[2]); perform public.mark_notification_read(v_ids[3]);
  select array_agg(title) into v_after from (select title from public.my_notifications(50) where title like 'M%') x;
  select array_agg(title) into v_bell from (select title from public.my_bell_notifications(50) where title like 'M%') y;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.check(v_before = array['M5 tournament info (read)', 'M2 tournament ask (unread)', 'M4 fixture ask (unread)', 'M1 fixture (read)', 'M6 training (unread)'],
    format('NL-10 mixed families are strictly newest first, read or not, asking or not: %s', v_before));
  perform pg_temp.check(v_after = v_before, 'NL-10 reading and resolving moves nothing');
  perform pg_temp.check(v_bell = v_before, 'NL-10 the website bell has the same order');
  perform pg_temp.check(not ('M3 message (unread)' = any(v_before)), 'NL-10 a message lives in Messages, not the notification feed, and so never reorders it');
end $$;

-- ---- NL-7 / NL-8 / NL-9 ----------------------------------------------------------------------------
do $$
declare
  v_guardian uuid; v_f uuid; v_n int; v_before int; v_after int;
begin
  select user_id into v_guardian from public.notifications where title = 'Order 1 (oldest, unread)' limit 1;
  select (data ->> 'fixture_id')::uuid into v_f from public.notifications
   where user_id = v_guardian and type = 'fixture_kickoff_changed' limit 1;

  -- NL-7: delete the fixture; its notifications are tidied away, not deleted.
  select count(*) into v_before from public.notifications where user_id = v_guardian and data ->> 'fixture_id' = v_f::text;
  delete from public.fixtures where id = v_f;
  select count(*) into v_after from public.notifications where user_id = v_guardian and data ->> 'fixture_id' = v_f::text and dismissed_at is not null;
  perform pg_temp.check(v_before > 0 and v_after = v_before, format('NL-7 deleting a fixture dismisses its %s notification(s), keeping the record', v_before));
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.my_notifications(50) where data ->> 'fixture_id' = v_f::text;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 0, 'NL-7 and they no longer appear in the feed');

  -- NL-8: in-app off, push on -> a hidden row (push can still send); both off -> nothing.
  insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled, push_enabled)
  values (v_guardian, 'fixture_updates', false, true, true)
  on conflict (user_id, topic_key) do update set in_app_enabled = false, push_enabled = true;
  insert into public.notifications (user_id, type, title, body, data) values (v_guardian, 'fixture_details_changed', 'Push only', 'x', '{}'::jsonb);
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_guardian and title = 'Push only' and dismissed_at is not null and read_at is not null),
    'NL-8 in-app off keeps the row for push, hidden and read');
  update public.notification_preferences set push_enabled = false where user_id = v_guardian and topic_key = 'fixture_updates';
  insert into public.notifications (user_id, type, title, body, data) values (v_guardian, 'fixture_details_changed', 'Nowhere', 'x', '{}'::jsonb);
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_guardian and title = 'Nowhere'),
    'NL-8 with in-app and push both off, nothing is stored');

  -- NL-9: hidden rows never count as unread.
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select notifications into v_n from public.my_unread_counts();
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_n = (select count(*) from public.notifications n left join public.notification_types t on t.type_key = n.type
                                where n.user_id = v_guardian and n.read_at is null and n.dismissed_at is null
                                  and coalesce(t.topic_key, '') <> 'messages' and n.type <> 'support_ticket_update'),
    format('NL-9 the bell count is exactly the visible unread rows (%s)', v_n));
end $$;

rollback;
