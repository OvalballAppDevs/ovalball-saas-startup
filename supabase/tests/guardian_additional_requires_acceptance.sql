-- ADDITIONAL GUARDIAN REQUIRES ACCEPTANCE (Identity/Auth Slice 2, Phase 2 AH R11).
--
-- A club may approve another adult as a child's guardian only after that
-- adult has accepted, and only that adult can accept: not the guardian who
-- asked, not a stranger, not someone approving themselves. An adult without
-- an account accepts once signed in with the invited address.
--
-- Self-seeding and rolled back.

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

-- Runs one statement as the current role; returns OK or the SQLSTATE.
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
  v_admin uuid := gen_random_uuid();
  v_parent1 uuid := gen_random_uuid();
  v_parent_other uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_newcomer uuid := gen_random_uuid();
  v_newcomer_email text := 'gar-new-' || gen_random_uuid()::text || '@ovalball.test';
  v_dir uuid; v_club uuid; v_team uuid; v_player uuid;
  v_req uuid; v_req2 uuid;
  v_text text;
begin
  foreach v_person in array array[v_admin, v_parent1, v_parent_other, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gar-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Gar', 'Tester', 'gar-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('GAR RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gar-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'gar-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'gar-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Gar', 'Child', (current_date - interval '11 years 6 months')::date, 'MALE') returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_parent1, v_player, 'parent', 'active');

  -- A. The added adult has an account.
  perform pg_temp.act('authenticated', v_parent1);
  select request_id into v_req from public.request_additional_guardian(v_player, 'gar-' || v_parent_other::text || '@ovalball.test');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_parent1);
  v_text := pg_temp.try(format('select public.respond_to_additional_guardian_request(%L, ''ACCEPT'')', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501' and (select subject_response from public.guardian_link_requests where id = v_req) is null,
    'A1: the requester cannot accept on the other adult''s behalf (' || v_text || ')');

  perform pg_temp.act('authenticated', v_stranger);
  v_text := pg_temp.try(format('select public.respond_to_additional_guardian_request(%L, ''ACCEPT'')', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A2: nobody else can answer it (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent1);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A3: an existing guardian cannot approve an additional guardian (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent_other);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A4: the added adult cannot approve themselves (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and not exists (select 1 from public.guardians where guardian_user_id = v_parent_other and state = 'ACTIVE'),
    'A5: the club cannot approve before acceptance (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent_other);
  perform public.respond_to_additional_guardian_request(v_req, 'ACCEPT');
  v_text := pg_temp.try(format('select public.respond_to_additional_guardian_request(%L, ''DECLINE'')', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and (select subject_response from public.guardian_link_requests where id = v_req) = 'ACCEPTED',
    'A6: an answer is given once (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and exists (select 1 from public.guardians where guardian_user_id = v_parent_other and player_id = v_player and state = 'ACTIVE'),
    'A7: after acceptance the club approves (' || v_text || ')');

  -- B. The added adult has no account yet.
  perform pg_temp.act('authenticated', v_parent1);
  select request_id into v_req2 from public.request_additional_guardian(v_player, v_newcomer_email);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select subject_user_id from public.guardian_link_requests where id = v_req2) is null
    and not exists (select 1 from public.guardians g join public.guardian_link_requests r on r.id = v_req2 where g.id = r.relationship_id),
    'B1: a request to someone without an account opens no relationship yet');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text <> 'OK', 'B2: nothing can be approved before they have an account (' || v_text || ')');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_newcomer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_newcomer_email, '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email) values (v_newcomer, 'Gar', 'Newcomer', v_newcomer_email) on conflict (id) do nothing;

  perform pg_temp.act('authenticated', v_newcomer);
  v_text := pg_temp.try(format('select public.respond_to_additional_guardian_request(%L, ''ACCEPT'')', v_req2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK'
    and (select subject_user_id from public.guardian_link_requests where id = v_req2) = v_newcomer
    and exists (select 1 from public.guardians where guardian_user_id = v_newcomer and player_id = v_player and state = 'PENDING_APPROVAL'),
    'B3: once signed in with the invited address they accept, and the relationship opens awaiting approval (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  perform public.reject_guardian_link_request(v_req2, 'Could not verify');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.guardians where guardian_user_id = v_newcomer and player_id = v_player) = 'DECLINED',
    'B4: the club can still reject after acceptance; the relationship is declined');

  raise notice 'Additional guardian acceptance complete.';
end $$;

rollback;
