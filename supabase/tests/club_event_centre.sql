-- =====================================================================================================
-- THE EVENT CENTRE (Events brief, 20270729000000_an_event_has_a_centre)
--
--   A  authority: who may create, for which sides, at which venue; a forged team or venue is refused
--   V  visibility: a draft is the organisers'; an invite-only event is the invited's; a club-visible one
--      is every member's; an outsider, another club and a signed-out visitor see nothing
--   I  invitations: whole club, teams, people, members; one notice per person however many ways in;
--      a child is reached through their guardians, never directly; sending again reaches only the new
--   R  answering: a guardian for each child separately, an adult for themselves; guests only as allowed;
--      deadline; finished and cancelled events refuse
--   C  catering: derived from answers, split by who they are, dietary as aggregates for organisers only
--   P  capacity and the waiting list: never overbooked, promoted strictly in order, told when promoted
--   M  messages: the audience is the answers; reach before sending; push is the organiser's choice;
--      no reminder storms
--   L  lifecycle: one notice for one save; postponed keeps answers; cancelled tells everybody once;
--      completed stays readable
--   G  external guests: no account, organiser-only, counted for catering and places
--
-- Self-contained and transactional: everything it creates is rolled back.
-- =====================================================================================================

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
  v_admin uuid := gen_random_uuid();      -- Club Admin
  v_mgr9 uuid := gen_random_uuid();       -- Team Manager, U9
  v_coach12 uuid := gen_random_uuid();    -- Coach, U12 (calendar.event.view only)
  v_parent uuid := gen_random_uuid();     -- guardian of TWO children: one U9, one U12
  v_parent2 uuid := gen_random_uuid();    -- guardian of one U12 child; ALSO a coach of the U9s
  v_adult uuid := gen_random_uuid();      -- an adult player on the senior side, answers for himself
  v_member uuid := gen_random_uuid();     -- a club member with no team
  v_childuser uuid := gen_random_uuid();  -- the U9 child's own login (aged 9)
  v_other uuid := gen_random_uuid();      -- Club Admin elsewhere
  v_dir uuid; v_dir2 uuid; v_club uuid; v_club2 uuid;
  v_u9 uuid; v_u12 uuid; v_sen uuid; v_t2 uuid;
  v_ms uuid;
  v_kid9 uuid; v_kid12 uuid; v_kid12b uuid; v_adultp uuid;
  v_venue uuid; v_venue2 uuid;
  v_e uuid; v_team_e uuid; v_meet uuid; v_cap uuid;
  v_json jsonb; v_n int; v_n2 int; v_txt text; v_g uuid;
begin
  foreach v_person in array array[v_admin, v_mgr9, v_coach12, v_parent, v_parent2, v_adult, v_member, v_childuser, v_other] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ev-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Event', 'Person' || substr(v_person::text, 1, 4), 'ev-' || v_person::text || '@ovalball.test',
            case when v_person = v_childuser then (current_date - interval '9 years')::date else (current_date - interval '40 years')::date end)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('EV Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ev-h-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('EV Other RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ev-o-' || v_tag) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ev-h-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'ev-o-' || v_tag, 'active') returning id into v_club2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 9 Mixed', 'ev-u9-' || v_tag, 'youth', 'U9', 'mixed', 'union', true) returning id into v_u9;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'ev-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_u12;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Men''s 1st Team', 'ev-sen-' || v_tag, 'senior', null, 'mens', 'union', true) returning id into v_sen;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club2, 'Under 9 Mixed', 'ev-o9-' || v_tag, 'youth', 'U9', 'mixed', 'union', true) returning id into v_t2;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN', 'active'), (v_club, v_parent, 'BASIC_USER', 'active'), (v_club, v_member, 'BASIC_USER', 'active'),
    (v_club, v_adult, 'BASIC_USER', 'active'), (v_club2, v_other, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_mgr9, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values (v_mgr9, v_ms, v_club, v_u9, 'TEAM_MANAGER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach12, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values (v_coach12, v_ms, v_club, v_u12, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent2, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values (v_parent2, v_ms, v_club, v_u9, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Nina', 'Nine' || v_tag, (current_date - interval '9 years')::date, 'FEMALE', v_childuser) returning id into v_kid9;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Toby', 'Twelve' || v_tag, (current_date - interval '12 years')::date, 'MALE') returning id into v_kid12;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Sam', 'Second' || v_tag, (current_date - interval '12 years')::date, 'MALE') returning id into v_kid12b;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Adam', 'Adult' || v_tag, (current_date - interval '25 years')::date, 'MALE', v_adult) returning id into v_adultp;
  insert into public.player_team_memberships (player_id, team_id, status, state) values
    (v_kid9, v_u9, 'active', 'ACTIVE'), (v_kid12, v_u12, 'active', 'ACTIVE'), (v_kid12b, v_u12, 'active', 'ACTIVE'), (v_adultp, v_sen, 'active', 'ACTIVE');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent, v_kid9, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent),
    (v_parent, v_kid12, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent),
    (v_parent2, v_kid12b, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent2);

  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club, 'EV Clubhouse', 'ev-v-' || v_tag, true, true) returning id into v_venue;
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club2, 'EV Other Ground', 'ev-v2-' || v_tag, true, true) returning id into v_venue2;

  -- ===============================================================================================
  -- A. AUTHORITY
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  v_json := public.save_event(null, v_club, jsonb_build_object('name', 'Christmas Party', 'event_type', 'SOCIAL', 'starts_on', current_date + 30,
    'start_time', '18:00', 'end_time', '21:00', 'is_club_wide', true, 'invite_members', true, 'location_kind', 'VENUE', 'venue_id', v_venue,
    'location_detail', 'Function Room', 'max_guests', 3, 'catering_required', true, 'capacity', 12, 'waiting_list_enabled', true));
  v_e := (v_json ->> 'eventId')::uuid;
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status = 'DRAFT' and location_kind = 'VENUE' and venue_id = v_venue from public.club_events where id = v_e),
    'A1 the Club Admin creates a club-wide event at the club''s own venue; it starts as a DRAFT');

  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
    jsonb_build_object('name', 'X', 'starts_on', current_date + 3, 'is_club_wide', true, 'location_kind', 'VENUE', 'venue_id', v_venue2))) = '42501',
    'A2 another club''s venue is refused');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
    jsonb_build_object('name', 'X', 'starts_on', current_date + 3, 'team_ids', jsonb_build_array(v_t2), 'location_kind', 'EXTERNAL', 'external', jsonb_build_object('name', 'Park')))) = '42501',
    'A3 another club''s team is refused');

  perform pg_temp.act('authenticated', v_mgr9);
  v_json := public.save_event(null, v_club, jsonb_build_object('name', 'U9 Charity Run', 'event_type', 'FUNDRAISING', 'starts_on', current_date + 20,
    'start_time', '10:00', 'meet_time', '09:30', 'host_team_id', v_u9, 'team_ids', jsonb_build_array(v_u9), 'location_kind', 'EXTERNAL',
    'external', jsonb_build_object('name', 'Walton Gardens', 'address_line_1', 'Walton Lea Road', 'postcode', 'wa4 6sn'), 'max_guests', 2));
  v_team_e := (v_json ->> 'eventId')::uuid;
  perform pg_temp.check(v_team_e is not null, 'A4 the U9 Team Manager creates the U9''s own event at an external address');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select external_postcode = 'WA4 6SN' and host_team_id = v_u9 and meet_time = '09:30' from public.club_events where id = v_team_e),
    'A5 stored as the team''s event, with its arrival time and a tidied postcode');
  perform pg_temp.act('authenticated', v_mgr9);
  perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
    jsonb_build_object('name', 'X', 'starts_on', current_date + 3, 'team_ids', jsonb_build_array(v_u12), 'location_kind', 'VENUE', 'venue_id', v_venue))) = '42501',
    'A6 a Team Manager cannot create for a side they do not manage');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
    jsonb_build_object('name', 'X', 'starts_on', current_date + 3, 'is_club_wide', true, 'location_kind', 'VENUE', 'venue_id', v_venue))) = '42501',
    'A7 nor make an event club-wide');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_e, '{"name":"Hijack"}')) = '42501',
    'A8 nor edit the club''s event');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_team_e, jsonb_build_object('team_ids', jsonb_build_array(v_u9, v_u12)))) = '42501',
    'A9 nor widen their own event to a side they do not manage');
  foreach v_person in array array[v_coach12, v_parent, v_member, v_other] loop
    perform pg_temp.act('authenticated', v_person);
    perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
      jsonb_build_object('name', 'X', 'starts_on', current_date + 3, 'team_ids', jsonb_build_array(v_u12), 'location_kind', 'VENUE', 'venue_id', v_venue))) = '42501',
      'A10 nobody without event authority can create one');
  end loop;
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('select public.save_event(null, %L, %L::jsonb)', v_club,
    jsonb_build_object('name', 'Zoom', 'starts_on', current_date + 3, 'is_club_wide', true, 'location_kind', 'ONLINE', 'online_url', 'http://insecure.example'))) = '22023',
    'A11 an online event needs an https link');
  v_meet := (public.save_event(null, v_club, jsonb_build_object('name', 'Coach Education Evening', 'event_type', 'EDUCATION', 'starts_on', current_date + 10,
    'start_time', '19:00', 'team_ids', jsonb_build_array(v_u9, v_u12), 'invite_players', false, 'invite_staff', true,
    'location_kind', 'ONLINE', 'online_url', 'https://meet.example/coaches')) ->> 'eventId')::uuid;
  perform pg_temp.check(v_meet is not null, 'A12 a staff-only online meeting for two sides');

  -- ===============================================================================================
  -- V. VISIBILITY (draft first)
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(public.get_event_centre(v_e) is null and not exists (select 1 from public.club_events where id = v_e),
    'V1 a draft is invisible to the people it will invite');
  perform pg_temp.act('authenticated', v_admin);
  v_n := (public.preview_event_invitations(v_e) ->> 'recipients')::int;
  v_json := public.send_event_invitations(v_e, 'Come and celebrate the year!');
  perform pg_temp.check((v_json ->> 'sent')::int = v_n, format('V1a the count shown before sending is exactly the number sent (%s / %s)', v_n, v_json ->> 'sent'));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status = 'SCHEDULED' and invitations_sent_at is not null from public.club_events where id = v_e),
    'V2 sending the invitations publishes the event');
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(public.get_event_centre(v_e) is not null and exists (select 1 from public.club_events where id = v_e),
    'V3 now the invited family sees it, on the calendar and in the Centre');
  perform pg_temp.act('authenticated', v_other);
  perform pg_temp.check(public.get_event_centre(v_e) is null and not exists (select 1 from public.club_events where id = v_e),
    'V4 another club''s admin sees nothing, by id or by query');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select public.get_event_centre(%L)', v_e)) <> 'OK', 'V5 a signed-out visitor is refused');

  -- The coaches' meeting: invited coaches only.
  perform pg_temp.act('authenticated', v_admin);
  perform public.send_event_invitations(v_meet, null);
  perform pg_temp.act('authenticated', v_coach12);
  v_json := public.get_event_centre(v_meet);
  perform pg_temp.check(v_json is not null and v_json -> 'location' ->> 'onlineUrl' = 'https://meet.example/coaches',
    'V6 an invited coach sees the meeting and its link');
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(public.get_event_centre(v_meet) is null and not exists (select 1 from public.club_events where id = v_meet),
    'V7 a parent is not invited to the coaches'' meeting and cannot find it');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(public.get_event_centre(v_meet) is null, 'V8 nor can an ordinary member');

  -- ===============================================================================================
  -- I. INVITATIONS -- who is told, once, through the right person
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent and type = 'event_invitation' and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 1, format('I1 a guardian of two invited children is told ONCE (%s)', v_n));
  select count(*) into v_n from public.notifications where user_id = v_childuser and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 0, 'I2 the nine-year-old''s own login is never told directly');
  select count(*) into v_n from public.notifications where user_id = v_parent2 and type = 'event_invitation' and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 1, format('I3 a coach who is also a parent is told once (%s)', v_n));
  select count(*) into v_n from public.notifications where user_id in (v_member, v_adult, v_coach12, v_mgr9) and type = 'event_invitation' and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 4, format('I4 the member, the adult player, the coach and the manager are each told (%s)', v_n));
  select count(*) into v_n from public.notifications where user_id = v_admin and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 0, 'I5 never the organiser who sent them');
  select count(*) into v_n from public.notifications where user_id = v_other and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 0, 'I6 nor anybody at another club');
  perform pg_temp.check((select body like '%Come and celebrate the year!%' from public.notifications where user_id = v_parent and type = 'event_invitation' and data ->> 'event_id' = v_e::text),
    'I7 the personal message travels with the invitation');

  perform pg_temp.act('authenticated', v_admin);
  v_json := public.send_event_invitations(v_e, null);
  perform pg_temp.check((v_json ->> 'newlyInvited')::int = 0, 'I8 sending again reaches nobody already asked');

  -- Units: the coach-parent is not a separate PERSON beside the child they answer for.
  perform pg_temp.act_postgres();
  select count(*) into v_n from internal.club_event_units(v_e) where unit_kind = 'PERSON' and user_id = v_parent2;
  perform pg_temp.check(v_n = 0, 'I9 a coach who is also a parent comes in the child''s party, not as a second place');
  select count(*) into v_n from internal.club_event_units(v_e) where unit_kind = 'PLAYER';
  perform pg_temp.check(v_n = 4, format('I10 every invited player is one unit (%s)', v_n));

  -- A named person on a team event.
  perform pg_temp.act('authenticated', v_mgr9);
  perform public.save_event(v_team_e, null, jsonb_build_object('individual_user_ids', jsonb_build_array(v_member)));
  perform public.send_event_invitations(v_team_e, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_member and type = 'event_invitation' and data ->> 'event_id' = v_team_e::text)
                        and not exists (select 1 from public.notifications where user_id = v_coach12 and data ->> 'event_id' = v_team_e::text),
    'I11 a team event reaches its own side and the named member, not another side''s coach');
  perform pg_temp.act('authenticated', v_mgr9);
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_team_e, jsonb_build_object('individual_user_ids', jsonb_build_array(v_other)))) = '42501',
    'I12 a person from another club cannot be named');

  -- ===============================================================================================
  -- R. ANSWERING
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent);
  v_json := public.get_event_centre(v_e);
  perform pg_temp.check(jsonb_array_length(v_json -> 'mine') = 2, 'R1 a guardian of two sees both children to answer for');
  perform public.respond_to_event(v_e, v_kid9, 'ATTENDING', 2, 3, '{"vegetarian": 1, "nut_allergy": 1}'::jsonb, null);
  perform public.respond_to_event(v_e, v_kid12, 'CANNOT_ATTEND');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status = 'ATTENDING' and guest_count = 2 and catering_count = 3 and response_source = 'guardian' from public.club_event_responses where event_id = v_e and player_id = v_kid9)
                        and (select status = 'CANNOT_ATTEND' and guest_count = 0 from public.club_event_responses where event_id = v_e and player_id = v_kid12),
    'R2 one child attending with two family, the sibling not -- answered separately');
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'')', v_e, v_kid12b)) = '42501',
    'R3 nobody else''s child');
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'', 4)', v_e, v_kid12)) = '22023',
    'R4 never more guests than the event allows');
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'', 1, 5)', v_e, v_kid12)) = '22023',
    'R5 nor food for more people than the party');
  perform pg_temp.act('authenticated', v_childuser);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'')', v_e, v_kid9)) = '42501',
    'R6 a nine-year-old cannot answer for themselves');
  perform pg_temp.act('authenticated', v_adult);
  perform public.respond_to_event(v_e, v_adultp, 'ATTENDING', 1, 2, '{"vegan": 1}'::jsonb, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select response_source = 'player' from public.club_event_responses where event_id = v_e and player_id = v_adultp),
    'R7 an adult player answers for himself, with a guest');
  perform pg_temp.act('authenticated', v_member);
  perform public.respond_to_event(v_e, null, 'UNSURE');
  perform pg_temp.act('authenticated', v_coach12);
  perform public.respond_to_event(v_e, null, 'ATTENDING', 0, 1, '{"gluten_free": 1, "other": 1}'::jsonb, 'No mushrooms');
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, null, ''ATTENDING'')', v_team_e)) = '42501',
    'R8 a coach not invited to the U9 run cannot answer for it');
  perform pg_temp.act('authenticated', v_mgr9);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, null, ''ATTENDING'', 0, 1, %L::jsonb)', v_e, '{"caviar": 1}')) = '22023',
    'R9 only the dietary requirements Ovalball records');

  -- ===============================================================================================
  -- C. CATERING AND PRIVACY
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  v_json := public.get_event_centre(v_e) -> 'summary';
  perform pg_temp.check((v_json ->> 'attending')::int = 3 and (v_json ->> 'cannotAttend')::int = 1 and (v_json ->> 'unsure')::int = 1,
    format('C1 the organiser''s counts come from the answers (%s)', v_json));
  perform pg_temp.check((v_json -> 'catering' ->> 'total')::int = 6 and (v_json -> 'catering' ->> 'players')::int = 2
                        and (v_json -> 'catering' ->> 'staff')::int = 1 and (v_json -> 'catering' ->> 'familyAndGuests')::int = 3,
    format('C2 catering: 3 for Nina''s party + 2 for Adam''s + 1 coach = 6, split by who they are (%s)', v_json -> 'catering'));
  perform pg_temp.check(v_json -> 'catering' -> 'dietary' = '{"vegan": 1, "other": 1, "vegetarian": 1, "gluten_free": 1, "nut_allergy": 1}'::jsonb
                        and (v_json -> 'catering' ->> 'otherNotes')::int = 1,
    format('C3 dietary needs as aggregates (%s)', v_json -> 'catering' -> 'dietary'));
  perform pg_temp.check((v_json ->> 'peopleConfirmed')::int = 6, 'C4 six places taken, guests included');

  perform pg_temp.act('authenticated', v_parent);
  v_json := public.get_event_centre(v_e);
  perform pg_temp.check(v_json -> 'summary' = 'null'::jsonb, 'C5 a parent receives no totals and no dietary aggregates');
  perform pg_temp.check(position('Mushroom' in v_json::text) = 0 and position('gluten' in v_json::text) = 0, 'C6 nor anybody else''s dietary detail');
  perform pg_temp.check(pg_temp.try(format('select public.get_event_guest_list(%L)', v_e)) = '42501', 'C7 nor the guest list');
  perform pg_temp.check(pg_temp.try(format('select public.event_audience_counts(%L)', v_e)) = '42501', 'C8 nor the audience counts');
  perform pg_temp.check(pg_temp.try('select count(*) from public.club_event_responses') = '42501', 'C9 and the answer rows themselves are not a browser table');
  perform pg_temp.check((select (r ->> 'playerId')::uuid = v_kid9 from jsonb_array_elements(v_json -> 'mine') r where r -> 'response' ->> 'status' = 'ATTENDING') ,
    'C10 the parent reads their own household''s answers');
  perform pg_temp.act('authenticated', v_coach12);
  perform pg_temp.check(pg_temp.try(format('select public.get_event_guest_list(%L)', v_e)) = '42501', 'C11 a coach is not the club event''s organiser either');
  perform pg_temp.act('authenticated', v_admin);
  v_json := public.get_event_guest_list(v_e);
  perform pg_temp.check((select r ->> 'dietaryNote' = 'No mushrooms' from jsonb_array_elements(v_json -> 'people') r where (r ->> 'userId')::uuid = v_coach12),
    'C12 the organiser sees the individual "Other" note, which is the operational need');

  -- Catering off: the questions disappear and the counts go.
  perform pg_temp.act('authenticated', v_mgr9);
  perform public.respond_to_event(v_team_e, null, 'ATTENDING', 0, 1, '{"vegan": 1}'::jsonb, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select catering_count = 0 and dietary = '{}'::jsonb from public.club_event_responses where event_id = v_team_e and user_id = v_mgr9),
    'C13 with catering off, no food numbers and no dietary data are kept at all');

  -- ===============================================================================================
  -- P. CAPACITY AND THE WAITING LIST (capacity 12; 6 confirmed)
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent2);
  v_json := public.respond_to_event(v_e, v_kid12b, 'ATTENDING', 3);
  perform pg_temp.check(not (v_json ->> 'waitlisted')::boolean, 'P1 a party of 4 fits (10 of 12)');
  perform pg_temp.act('authenticated', v_mgr9);
  v_json := public.respond_to_event(v_e, null, 'ATTENDING', 3);
  perform pg_temp.check((v_json ->> 'waitlisted')::boolean, 'P2 a party of 4 when 2 places are left goes on the waiting list');
  perform pg_temp.act('authenticated', v_member);
  v_json := public.respond_to_event(v_e, null, 'ATTENDING', 0);
  perform pg_temp.check((v_json ->> 'waitlisted')::boolean, 'P3 and a party of 1 behind them waits its turn -- no jumping the queue');
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check((public.get_event_centre(v_e) -> 'summary' ->> 'peopleConfirmed')::int = 10, 'P4 waiting parties are not counted as places');
  perform pg_temp.check((public.get_event_centre(v_e) -> 'summary' -> 'catering' ->> 'total')::int = 10, 'P5 nor for catering');

  -- Nina's party of 3 drops out: 5 free. The manager's 4 is promoted; then the member's 1.
  perform pg_temp.act('authenticated', v_parent);
  v_json := public.respond_to_event(v_e, v_kid9, 'CANNOT_ATTEND');
  perform pg_temp.check((v_json ->> 'promoted')::int = 2, format('P6 freed places promote the queue in order (%s)', v_json));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select waitlisted_at is null from public.club_event_responses where event_id = v_e and user_id = v_mgr9)
                        and (select waitlisted_at is null from public.club_event_responses where event_id = v_e and user_id = v_member),
    'P7 both waiting parties are now confirmed');
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_mgr9 and type = 'event_waitlist_promoted' and data ->> 'event_id' = v_e::text),
    'P8 and each is told');
  perform pg_temp.check(internal.club_event_confirmed_heads(v_e) <= 12, 'P9 never more than capacity');
  perform pg_temp.act('authenticated', v_parent);
  v_txt := pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'', 3)', v_e, v_kid9));
  perform pg_temp.check(v_txt = 'OK'
                        and exists (select 1 from jsonb_array_elements(public.get_event_centre(v_e) -> 'mine') m
                                     where (m ->> 'playerId')::uuid = v_kid9 and (m -> 'response' ->> 'waitlisted')::boolean),
    'P10 coming back to a full event puts you on the list, not over the limit');
  perform pg_temp.act('authenticated', v_admin);
  perform public.save_event(v_e, null, '{"waiting_list_enabled": false}'::jsonb);
  perform pg_temp.act('authenticated', v_adult);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'', 1)', v_e, v_adultp)) = 'OK',
    'P11 a confirmed party keeping its size is never bumped');

  -- ===============================================================================================
  -- G. EXTERNAL GUESTS
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.save_event(v_e, null, '{"capacity": 40, "waiting_list_enabled": true}'::jsonb);
  v_g := public.save_event_guest(v_e, null, jsonb_build_object('name', 'Sponsor Sue', 'email', 'sue@example.com', 'status', 'ATTENDING', 'guests', 1, 'dietary', '{"vegetarian": 1}'::jsonb));
  perform pg_temp.check((public.get_event_centre(v_e) -> 'summary' -> 'catering' ->> 'externalGuests')::int = 2,
    'G1 an external guest with a plus-one is counted for food, without an account');
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(pg_temp.try(format('select public.save_event_guest(%L, null, %L::jsonb)', v_e, '{"name":"Gatecrasher"}')) = '42501',
    'G2 only organisers record external guests');
  perform pg_temp.check(position('Sponsor Sue' in public.get_event_centre(v_e)::text) = 0 and position('sue@example.com' in public.get_event_centre(v_e)::text) = 0,
    'G3 and an invitee never sees them');

  -- ===============================================================================================
  -- M. MESSAGES
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  v_json := public.event_audience_counts(v_e);
  perform pg_temp.check((v_json ->> 'CANNOT_ATTEND')::int >= 1 and (v_json ->> 'ALL')::int >= (v_json ->> 'ATTENDING')::int,
    format('M1 the reach of each audience is shown before sending (%s)', v_json));
  v_json := public.send_event_message(v_e, 'ANNOUNCEMENT', 'ATTENDING', 'Parking is behind the clubhouse.', false);
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_parent2 and type = 'event_announcement' and body like 'Parking%' and data ->> 'push' = 'false'),
    'M2 an announcement to Attending reaches an attending family, in the app only when push is off');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_childuser and type = 'event_announcement'),
    'M3 never a child directly');
  perform pg_temp.act('authenticated', v_parent2);
  perform pg_temp.check(jsonb_array_length(public.get_event_messages(v_e)) = 1, 'M4 the family reads what was sent to them');
  perform pg_temp.check((public.get_event_messages(v_e) -> 0 -> 'reach') = 'null'::jsonb, 'M5 but not how many it went to');
  perform pg_temp.check(pg_temp.try(format('select public.send_event_message(%L, ''ANNOUNCEMENT'', ''ALL'', ''hi'', true)', v_e)) = '42501',
    'M6 only organisers send');
  perform pg_temp.act('authenticated', v_member);
  perform public.respond_to_event(v_e, null, 'UNSURE');
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check((public.send_event_message(v_e, 'REMINDER', 'UNSURE', null, true) ->> 'sent')::int = 1, 'M6a a reminder reaches the unsure member');
  -- 20270731 (found in live UAT): the reminder to the people still to answer carries no words of its own, and the
  -- body rule refused it outright because REMIND_AWAITING was missing from the reminder actions it allows.
  perform pg_temp.check(pg_temp.try(format('select public.send_event_message(%L, ''REMINDER'', ''AWAITING'', null, true)', v_e)) = 'OK',
    'M6b a reminder to the people still to answer goes out with no message of its own');
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.fixture_communications c where c.event_id = v_e and c.action = 'REMIND_AWAITING' and c.body is null),
    'M6c and is recorded as that reminder, with no body');
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('select public.send_event_message(%L, ''REMINDER'', ''UNSURE'', null, true)', v_e)) = '22023',
    'M7 the same reminder twice within six hours is refused');
  perform pg_temp.check(pg_temp.try(format('select public.send_event_message(%L, ''REMINDER'', ''ATTENDING'', null, true)', v_e)) = '22023',
    'M8 a reminder goes only to people still to answer or unsure');

  -- ===============================================================================================
  -- L. LIFECYCLE
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'event_updated' and data ->> 'event_id' = v_e::text;
  perform pg_temp.act('authenticated', v_admin);
  v_json := public.save_event(v_e, null, jsonb_build_object('starts_on', current_date + 37, 'start_time', '19:00', 'description', 'Now with a band'));
  perform pg_temp.act_postgres();
  select count(*) - v_n into v_n2 from public.notifications where type = 'event_updated' and data ->> 'event_id' = v_e::text and user_id = v_parent;
  perform pg_temp.check(v_n2 = 1 and v_json -> 'changed' ? 'date' and v_json -> 'changed' ? 'time',
    format('L1 a date and time change in one save is ONE notice per person (%s)', v_n2));
  perform pg_temp.check((select body like '%now %at 19:00 at EV Clubhouse%' from public.notifications where user_id = v_parent and type = 'event_updated' and data ->> 'event_id' = v_e::text order by created_at desc limit 1),
    'L2 naming the new date, time and place');
  select count(*) into v_n from public.notifications where type = 'event_updated' and data ->> 'event_id' = v_e::text;
  perform pg_temp.act('authenticated', v_admin);
  perform public.save_event(v_e, null, jsonb_build_object('description', 'Band confirmed', 'catering_notes', 'Festive buffet'));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select count(*) from public.notifications where type = 'event_updated' and data ->> 'event_id' = v_e::text) = v_n,
    'L3 a change that does not move anybody''s plans sends nothing');

  perform pg_temp.act('authenticated', v_admin);
  perform public.postpone_event(v_e, 'Venue flooded');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status = 'POSTPONED' from public.club_events where id = v_e)
                        and exists (select 1 from public.club_event_responses where event_id = v_e and player_id = v_kid12b and status = 'ATTENDING'),
    'L4 postponed keeps the event and every answer');
  perform pg_temp.act('authenticated', v_admin);
  perform public.save_event(v_e, null, jsonb_build_object('starts_on', current_date + 44));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status = 'SCHEDULED' from public.club_events where id = v_e), 'L5 a new date puts it back on');

  perform pg_temp.act('authenticated', v_mgr9);
  perform pg_temp.check(pg_temp.try(format('select public.cancel_club_event(%L, ''x'')', v_e)) = '42501', 'L6 a Team Manager cannot cancel the club''s event');
  perform pg_temp.act('authenticated', v_admin);
  perform public.cancel_club_event(v_e, 'Not enough people');
  perform public.cancel_club_event(v_e, 'Again');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent and type = 'event_cancelled' and data ->> 'event_id' = v_e::text;
  perform pg_temp.check(v_n = 1, format('L7 cancelling tells each family once, even if pressed twice (%s)', v_n));
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(public.get_event_centre(v_e) ->> 'phase' = 'CANCELLED'
                        and pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'')', v_e, v_kid12)) = '22023',
    'L8 a cancelled event stays readable and refuses answers');

  perform pg_temp.act_postgres();
  update public.club_events set starts_on = current_date - 3, ends_on = current_date - 3 where id = v_team_e;
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(public.get_event_centre(v_team_e) ->> 'phase' = 'COMPLETED'
                        and pg_temp.try(format('select public.respond_to_event(%L, %L, ''ATTENDING'')', v_team_e, v_kid9)) = '22023',
    'L9 a past event is COMPLETED, still readable, and closed');

  -- Calendar projection: my answers only.
  perform pg_temp.act('authenticated', v_parent2);
  select count(*) into v_n from public.my_event_answers(array[v_e, v_team_e, v_meet]);
  -- Sam's guardian (also a U9 coach): Sam for the party, himself for the U9 run and the coaches' meeting.
  perform pg_temp.check(v_n = 3 and not exists (select 1 from public.my_event_answers(array[v_e, v_team_e, v_meet]) a
                                                 where a.player_id is not null and a.player_id <> v_kid12b),
    format('L10 the calendar reads only my household''s answers -- nobody else''s child (%s)', v_n));
end $$;

rollback;
