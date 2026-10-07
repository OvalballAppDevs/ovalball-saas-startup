-- =====================================================================================================
-- WHO A CONVERSATION IS BETWEEN (integration audit, 20270735000000_who_a_conversation_is_between)
--
-- A fixture, request or club conversation's People list and the role beside each message were assembled
-- on the device from club_memberships and team_permissions -- rows a person may read only for their own
-- club -- so a coach saw herself and nobody else, and every message from the other side was "Member" of
-- "Ovalball". `conversation_people` answers it once, for anybody the conversation admits:
--
--   CP  the officials of both clubs and of both teams, by name, club and role, for a party on EITHER side
--   AD  anybody explicitly added appears as added; somebody who left is still named, and marked
--   CL  a club conversation lists both clubs' officials
--   NO  a guardian, an official of a club not in it, an unknown key and a signed-out caller get nothing
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

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Conv', p_label, 'cp-' || v::text || '@ovalball.test', (current_date - interval '40 years')::date)
  on conflict (id) do nothing;
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_admin_h uuid := pg_temp.person('AdminHome');
  v_admin_a uuid := pg_temp.person('AdminAway');
  v_coach_h uuid := pg_temp.person('CoachHome');
  v_coach_a uuid := pg_temp.person('CoachAway');
  v_member_h uuid := pg_temp.person('MemberHome');   -- added to the conversation by name
  v_parent_h uuid := pg_temp.person('ParentHome');
  v_stranger uuid := pg_temp.person('Stranger');     -- Club Admin of a club that is not in it
  v_dir_h uuid; v_dir_a uuid; v_dir_c uuid;
  v_club_h uuid; v_club_a uuid; v_club_c uuid;
  v_team_h uuid; v_team_a uuid;
  v_ms uuid; v_f uuid; v_conv uuid; v_cc uuid;
  v_n int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CP Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cp-h-' || v_tag) returning id into v_dir_h;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CP Away RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cp-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CP Elsewhere RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cp-c-' || v_tag) returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_h, 'cp-h-' || v_tag, 'active') returning id into v_club_h;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'cp-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'cp-c-' || v_tag, 'active') returning id into v_club_c;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_h, 'Under 12 Boys', 'cp-h-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_h;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'cp-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_h, v_admin_h, 'CLUB_ADMIN', 'active'), (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (v_club_h, v_member_h, 'BASIC_USER', 'active'), (v_club_h, v_parent_h, 'BASIC_USER', 'active'),
    (v_club_c, v_stranger, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_h, v_coach_h, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach_h, v_ms, v_club_h, v_team_h, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_coach_a, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach_a, v_ms, v_club_a, v_team_a, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'CP Away RFC', current_date + 5, '10:30', 'Booked', 'club_created') returning id, conversation_id into v_f, v_conv;

  -- ===============================================================================================
  -- CP. BOTH SIDES, FOR A PARTY ON EITHER SIDE
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(not exists (select 1 from public.club_memberships where club_id = v_club_h and user_id <> v_coach_a),
    'CP0 the away coach cannot read the home club''s memberships -- why the device listed only her');
  select count(*) into v_n from public.conversation_people(v_conv, null);
  perform pg_temp.check(v_n = 4, format('CP1 the away coach is told who the conversation is between: both Club Admins and both coaches (%s)', v_n));
  perform pg_temp.check(exists (select 1 from public.conversation_people(v_conv, null)
                                where user_id = v_admin_h and role_kind = 'club' and role_key = 'CLUB_ADMIN'
                                  and club_id = v_club_h and club_name = 'CP Home RUFC ' || v_tag and surname = 'AdminHome'),
    'CP2 the other club''s Club Admin by name, club and role');
  perform pg_temp.check(exists (select 1 from public.conversation_people(v_conv, null)
                                where user_id = v_coach_h and role_kind = 'team' and role_key = 'COACH' and club_id = v_club_h),
    'CP3 the other team''s coach as a coach of the other club, by the canonical role key');
  perform pg_temp.check(not exists (select 1 from public.conversation_people(v_conv, null) where user_id in (v_parent_h, v_member_h, v_stranger)),
    'CP4 a parent, an ordinary member and an outsider are not in it');

  perform pg_temp.act('authenticated', v_admin_h);
  select count(*) into v_n from public.conversation_people(v_conv, null);
  perform pg_temp.check(v_n = 4, format('CP5 the home Club Admin is told the same four people (%s)', v_n));

  -- ===============================================================================================
  -- AD. ADDED BY NAME; LEFT AND STILL NAMED
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_f, v_member_h, v_admin_h);
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(exists (select 1 from public.conversation_people(v_conv, null)
                                where user_id = v_member_h and role_kind = 'added' and club_id = v_club_h and not left_conversation),
    'AD1 somebody added to this conversation is in it, at their own club, as added');
  perform pg_temp.act_postgres();
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, left_at) values (v_f, v_admin_h, now())
  on conflict do nothing;
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(exists (select 1 from public.conversation_people(v_conv, null) where user_id = v_admin_h and left_conversation),
    'AD2 somebody who left is still named, and marked -- their earlier messages keep a name; the People list leaves them out');

  -- ===============================================================================================
  -- CL. A CLUB CONVERSATION
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  insert into public.club_conversations (requesting_club_id, recipient_club_id, status, requested_by)
  values (v_club_h, v_club_a, 'accepted', v_admin_h) returning id into v_cc;
  perform pg_temp.act('authenticated', v_admin_a);
  perform pg_temp.check((select array_agg(user_id order by user_id) from public.conversation_people(v_cc, null))
                        = (select array_agg(u order by u) from unnest(array[v_admin_h, v_admin_a]) u),
    'CL1 a club conversation is between the two clubs'' officials');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(not exists (select 1 from public.conversation_people(v_cc, null)),
    'CL2 a coach the club conversation does not admit is told nothing about it');

  -- ===============================================================================================
  -- NO. NOTHING FOR ANYBODY IT DOES NOT ADMIT
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(not exists (select 1 from public.conversation_people(v_conv, null)),
    'NO1 a guardian at the home club is told nothing about the staff conversation');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(not exists (select 1 from public.conversation_people(v_conv, null)),
    'NO2 a Club Admin of a club not in it is told nothing');
  perform pg_temp.check(not exists (select 1 from public.conversation_people(gen_random_uuid(), null))
                        and not exists (select 1 from public.conversation_people(null, gen_random_uuid()))
                        and not exists (select 1 from public.conversation_people(null, null)),
    'NO3 an unknown key, or none, is simply nothing -- never an error that would confirm a fixture exists');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select count(*) from public.conversation_people(%L, null)', v_conv)) <> 'OK',
    'NO4 a signed-out caller cannot ask');
  perform pg_temp.act_postgres();
end $$;

rollback;
