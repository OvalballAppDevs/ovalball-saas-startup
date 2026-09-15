-- MINOR PROHIBITIONS (Identity/Auth Slice 2, Phase 2 M.2 / I).
--
-- Staff roles (Club Admin, Fixtures Secretary, Volunteer, Coach, Team
-- Manager, Team Administration, Safeguarding Officer) are never held by
-- someone under 18, whichever path asks: assign_role, the legacy adapters,
-- an invitation, or restoring a suspended role. Membership itself is not
-- restricted.
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
  v_minor uuid := gen_random_uuid();
  v_minor_player uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid;
  v_ms_minor uuid; v_ms_minor_player uuid; v_ms_adult uuid;
  v_co uuid;
  v_inv_token text;
  v_text text;
  v_role text;
begin
  foreach v_person in array array[v_admin, v_minor, v_minor_player, v_adult] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mnp-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Mnp', 'Tester', 'mnp-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;
  update public.profiles set date_of_birth = current_date - interval '16 years' where id = v_minor;
  update public.profiles set date_of_birth = current_date - interval '30 years' where id = v_adult;
  -- Known to be under 18 only through their own player record.
  insert into public.players (first_name, surname, date_of_birth, user_id, playing_pathway) values ('Mnp', 'Player', current_date - interval '15 years', v_minor_player, 'MALE');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MNP RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mnp-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mnp-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'mnp-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_minor, 'BASIC_USER', 'active') returning id into v_ms_minor;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_minor_player, 'BASIC_USER', 'active') returning id into v_ms_minor_player;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_adult, 'BASIC_USER', 'active') returning id into v_ms_adult;

  perform pg_temp.check(internal.person_is_minor(v_minor) and internal.person_is_minor(v_minor_player) and not internal.person_is_minor(v_adult) and not internal.person_is_minor(v_admin),
    'A0: under 18 is read from the profile date of birth, else the person''s own player record; unknown is not treated as a minor');

  foreach v_role in array array['CLUB_ADMIN', 'FIXTURES_SECRETARY', 'VOLUNTEER'] loop
    perform pg_temp.act('authenticated', v_admin);
    v_text := pg_temp.try(format('select public.assign_role(%L, %L, null, null)', v_ms_minor, v_role));
    perform pg_temp.act_postgres();
    perform pg_temp.check(v_text = '23514', 'A1: ' || v_role || ' is never given to someone under 18 (' || v_text || ')');
  end loop;
  foreach v_role in array array['COACH', 'TEAM_MANAGER'] loop
    perform pg_temp.act('authenticated', v_admin);
    v_text := pg_temp.try(format('select public.assign_role(%L, %L, %L, null)', v_ms_minor_player, v_role, v_team));
    perform pg_temp.act_postgres();
    perform pg_temp.check(v_text = '23514', 'A2: ' || v_role || ' is never given to a player under 18 (' || v_text || ')');
  end loop;

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.set_team_access(%L, %L, ''coach'', null)', v_ms_minor, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'A3: nor through the legacy team adapter (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''CLUB_ADMIN'', null)', v_ms_minor));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and (select role from public.club_memberships where id = v_ms_minor) = 'BASIC_USER',
    'A4: nor through the club role selector (' || v_text || ')');

  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_ms_minor and role_key = 'MEMBER' and state = 'ACTIVE'),
    'A5: a minor remains a Member');

  -- An invitation that carries a staff role cannot be accepted by a minor.
  insert into public.invitations (club_id, invited_email, created_by, club_role) values (v_club, 'mnp-' || v_minor::text || '@ovalball.test', v_admin, 'FIXTURE_SECRETARY') returning token into v_inv_token;
  perform pg_temp.act('authenticated', v_minor);
  v_text := pg_temp.try(format('select public.accept_invitation(%L)', v_inv_token));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text <> 'OK' and not exists (select 1 from public.role_assignments where membership_id = v_ms_minor and role_key = 'FIXTURES_SECRETARY'),
    'A6: an invitation with a staff role is refused for someone under 18 (' || v_text || ')');

  -- A role held before a date of birth was known: suspended, not restorable.
  perform pg_temp.act('authenticated', v_admin);
  v_co := public.assign_role(v_ms_adult, 'COACH', v_team, null);
  perform public.transition_role_assignment(v_co, 'SUSPENDED', 'Checking age');
  perform pg_temp.act_postgres();
  update public.profiles set date_of_birth = current_date - interval '17 years' where id = v_adult;
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_role_assignment(%L, ''ACTIVE'', ''age checked'')', v_co));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'A7: a suspended staff role is not restored once the holder is known to be under 18 (' || v_text || ')');

  raise notice 'Minor prohibitions complete.';
end $$;

rollback;
