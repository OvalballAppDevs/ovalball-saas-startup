-- CLUB MEMBERSHIP STATE MACHINE (Identity/Auth Slice 2, Phase 2 M.1).
--
-- Every edge of a club membership, run as the real database role a caller
-- would have:
--
--   A. A join request opens a PENDING membership; approve and decline decide
--      it once; the requester cannot decide their own.
--   B. Suspend and restore, with reasons, at the right level: a Club Admin
--      cannot lift a Site Admin's suspension. Roles pause and resume with the
--      membership.
--   C. Remove (with a reason) and leave (without one). A removed membership
--      never comes back: not through the RPC, not through a direct write, not
--      through a backend status write. Re-admission is a new row, and the
--      old roles stay revoked.
--   D. The last Club Admin: removing, suspending or demoting the only Club
--      Admin is refused; only a Full Site Admin can override, with a reason.
--   E. Who may act: members, another club's admin, a non-Full Site Admin and
--      anonymous callers are refused; the browser cannot write the row.
--   F. Security events carry the server-derived actor; reasons are not
--      readable through the API.
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
  v_full uuid := gen_random_uuid();
  v_access uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_joiner uuid := gen_random_uuid();
  v_joiner2 uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_leaver uuid := gen_random_uuid();
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid; v_team uuid;
  v_join uuid; v_join2 uuid;
  v_ms_admin uuid; v_ms_admin2 uuid; v_ms_member uuid; v_ms_coach uuid; v_ms_leaver uuid; v_ms_new uuid;
  v_pending uuid;
  v_state text;
  v_text text;
  v_count integer;
begin
  foreach v_person in array array[v_full, v_access, v_admin, v_admin2, v_other_admin, v_member, v_joiner, v_joiner2, v_coach, v_leaver] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'msm-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v_person, 'Msm', 'Tester', 'msm-' || v_person::text || '@ovalball.test', (current_date - interval '35 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full'), (v_access, 'active', 'user_access');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MSM Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'msm-a-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MSM Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'msm-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'msm-a-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'msm-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'msm-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;

  -- Legacy-shaped seed through the compatibility layer, as a backend session.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active') returning id into v_ms_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active') returning id into v_ms_member;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_leaver, 'BASIC_USER', 'active') returning id into v_ms_leaver;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_other_admin, 'CLUB_ADMIN', 'active');

  -- ===============================================================
  -- A. Join requests
  -- ===============================================================
  perform pg_temp.act('authenticated', v_joiner);
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values (v_club, v_joiner, 'Coach') returning id into v_join;
  perform pg_temp.act_postgres();
  select id, state into v_pending, v_state from public.club_memberships where club_id = v_club and user_id = v_joiner;
  perform pg_temp.check(v_state = 'PENDING' and (select status from public.club_memberships where id = v_pending) = 'pending'
    and (select source_request_id from public.club_memberships where id = v_pending) = v_join,
    'A1: a join request opens a PENDING membership linked to the request');
  perform pg_temp.check(not exists (select 1 from public.role_assignments where membership_id = v_pending),
    'A2: a PENDING membership holds no role at all');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'membership.requested' and subject_user_id = v_joiner and actor_user_id = v_joiner),
    'A3: membership.requested is recorded, attributed to the person asking');

  perform pg_temp.act('authenticated', v_joiner);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''APPROVE'', null)', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A4: the requester cannot approve their own join request (' || v_text || ')');

  perform pg_temp.act('authenticated', v_member);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''APPROVE'', null)', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A5: a plain member cannot decide a join request (' || v_text || ')');

  perform pg_temp.act('authenticated', v_other_admin);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''APPROVE'', null)', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A6: another club''s admin cannot decide it (' || v_text || ')');

  perform pg_temp.act('authenticated', v_access);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''APPROVE'', ''x'')', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A7: a Site Admin without Full authority cannot decide it (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''DECLINE'', null)', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'A8: declining without a reason is refused (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''APPROVE'', null)', v_join));
  perform pg_temp.act_postgres();
  select state into v_state from public.club_memberships where id = v_pending;
  perform pg_temp.check(v_text = 'OK' and v_state = 'ACTIVE'
    and (select approved_by from public.club_memberships where id = v_pending) = v_admin
    and (select status from public.club_join_requests where id = v_join) = 'approved'
    and exists (select 1 from public.role_assignments where membership_id = v_pending and role_key = 'MEMBER' and state = 'ACTIVE' and source = 'JOIN_REQUEST')
    and (select count(*) from public.role_assignments where membership_id = v_pending) = 1,
    'A9: approval makes the SAME row ACTIVE with only the Member role, and records who approved');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'membership.approved' and subject_user_id = v_joiner and actor_user_id = v_admin),
    'A10: membership.approved is recorded with the approving Club Admin as actor');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''DECLINE'', ''too late'')', v_join));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and (select state from public.club_memberships where id = v_pending) = 'ACTIVE',
    'A11: a decided request cannot be decided again (' || v_text || ')');

  perform pg_temp.act('authenticated', v_joiner2);
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values (v_club, v_joiner2, 'Parent') returning id into v_join2;
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.decide_club_join_request(%L, ''DECLINE'', ''Not known to the club'')', v_join2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK'
    and (select state from public.club_memberships where club_id = v_club and user_id = v_joiner2) = 'DECLINED'
    and (select status from public.club_join_requests where id = v_join2) = 'rejected'
    and not exists (select 1 from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id where cm.user_id = v_joiner2),
    'A12: declining makes the membership DECLINED, with no role');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_joiner2 and body like '%Not known%'),
    'A13: the decline reason is not sent to the person who asked');

  -- An unanswered request expires (no scheduler yet runs this; the edge is
  -- valid from PENDING only, and terminal).
  perform pg_temp.act('authenticated', v_leaver);
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values (v_club_b, v_leaver, 'Parent');
  perform pg_temp.act_postgres();
  v_text := pg_temp.try(format('update public.club_memberships set state = ''EXPIRED'' where club_id = %L and user_id = %L', v_club_b, v_leaver));
  perform pg_temp.check(v_text = 'OK' and (select state || '|' || status from public.club_memberships where club_id = v_club_b and user_id = v_leaver) = 'EXPIRED|expired',
    'A14: a PENDING membership can expire (' || v_text || ')');
  v_text := pg_temp.try(format('update public.club_memberships set state = ''ACTIVE'' where club_id = %L and user_id = %L', v_club_b, v_leaver));
  perform pg_temp.check(v_text = '23514', 'A15: an expired membership is terminal (' || v_text || ')');
  v_text := pg_temp.try(format('update public.club_memberships set state = ''EXPIRED'' where id = %L', v_ms_member));
  perform pg_temp.check(v_text = '23514', 'A16: only a PENDING membership can expire, never an ACTIVE one (' || v_text || ')');

  -- ===============================================================
  -- B. Suspend and restore
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.set_team_access(v_ms_coach, v_team, 'team_admin', null);
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', null)', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'B1: suspending without a reason is refused (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''Under review'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK'
    and (select state || '|' || suspended_level || '|' || status from public.club_memberships where id = v_ms_coach) = 'SUSPENDED|CLUB|suspended'
    and not exists (select 1 from public.role_assignments where membership_id = v_ms_coach and state = 'ACTIVE')
    and (select count(*) from public.role_assignments where membership_id = v_ms_coach and state = 'SUSPENDED') = 3
    and not exists (select 1 from public.team_permissions where membership_id = v_ms_coach),
    'B2: a Club Admin suspends at CLUB level; every role pauses and team access disappears');

  perform pg_temp.act('authenticated', v_coach);
  select count(*) into v_count from public.team_permissions where team_id = v_team;
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''let me back'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B3: the suspended person cannot restore themselves (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''Review complete'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state from public.club_memberships where id = v_ms_coach) = 'ACTIVE'
    and (select count(*) from public.role_assignments where membership_id = v_ms_coach and state = 'ACTIVE') = 3
    and (select permission from public.team_permissions where membership_id = v_ms_coach and team_id = v_team) = 'team_admin',
    'B4: restoring returns every paused role, including Team Admin');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''Safeguarding referral'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select suspended_level from public.club_memberships where id = v_ms_coach) = 'SITE',
    'B5: a Full Site Admin suspends at SITE level');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''We disagree'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501' and (select state from public.club_memberships where id = v_ms_coach) = 'SUSPENDED',
    'B6: a Club Admin cannot lift a Site Admin''s suspension (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''Referral closed'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state from public.club_memberships where id = v_ms_coach) = 'ACTIVE',
    'B7: the Site Admin lifts it');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''no'')', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B8: nobody suspends their own membership (' || v_text || ')');

  -- ===============================================================
  -- C. Remove, leave, no resurrection, re-admission
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', null)', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C1: an admin removal needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''Left coaching'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK'
    and (select state || '|' || status || '|' || revocation_reason || '|' || (revoked_by = v_admin)::text from public.club_memberships where id = v_ms_coach) = 'REVOKED|revoked|Left coaching|true'
    and not exists (select 1 from public.role_assignments where membership_id = v_ms_coach and state <> 'REVOKED'),
    'C2: removal revokes the membership and every role it held, with the reason and actor');

  perform pg_temp.act('authenticated', v_leaver);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', null)', v_ms_leaver));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state || '|' || revocation_reason from public.club_memberships where id = v_ms_leaver) = 'REVOKED|Left the club',
    'C3: a person can leave a club themselves without giving a reason');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''come back'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'C4: the RPC has no REVOKED -> ACTIVE edge (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''come back'')', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'C5: not even for a Full Site Admin (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('update public.club_memberships set status = ''active'' where id = %L', v_ms_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C6: the browser cannot write a membership row at all (' || v_text || ')');

  v_text := pg_temp.try(format('update public.club_memberships set status = ''active'' where id = %L', v_ms_coach));
  perform pg_temp.check(v_text = '23514' and (select state from public.club_memberships where id = v_ms_coach) = 'REVOKED',
    'C7: a backend status write cannot revive it either (' || v_text || ')');
  v_text := pg_temp.try(format('update public.club_memberships set state = ''ACTIVE'' where id = %L', v_ms_coach));
  perform pg_temp.check(v_text = '23514', 'C8: nor a backend state write (' || v_text || ')');

  v_text := pg_temp.try(format('insert into public.club_memberships (club_id, user_id, role, status) values (%L, %L, ''BASIC_USER'', ''active'')', v_club, v_member));
  perform pg_temp.check(v_text = '23505', 'C9: a person holds at most one open membership of a club (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.grant_club_membership(%L, %L, ''back'')', v_club, v_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C10: a Club Admin cannot re-admit directly (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.grant_club_membership(%L, %L, null)', v_club, v_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C11: Site Admin re-admission needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.grant_club_membership(%L, %L, ''Returning volunteer, confirmed by the club'')', v_club, v_coach));
  perform pg_temp.act_postgres();
  select id into v_ms_new from public.club_memberships where club_id = v_club and user_id = v_coach and state = 'ACTIVE';
  perform pg_temp.check(v_text = 'OK' and v_ms_new is not null and v_ms_new <> v_ms_coach
    and (select state from public.club_memberships where id = v_ms_coach) = 'REVOKED'
    and (select source from public.club_memberships where id = v_ms_new) = 'SITE_ADMIN_ASSIGNMENT'
    and (select string_agg(role_key, ',') from public.role_assignments where membership_id = v_ms_new and state = 'ACTIVE') = 'MEMBER'
    and not exists (select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id where cm.user_id = v_coach),
    'C12: re-admission is a NEW row as Member only; the old row and its roles stay revoked');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.grant_club_membership(%L, %L, ''again'')', v_club, v_coach));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'C13: re-admission is refused while an open membership exists (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.grant_club_membership(%L, %L, ''myself'')', v_club, v_full));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C14: a Site Admin cannot admit themselves (' || v_text || ')');

  -- ===============================================================
  -- D. The last Club Admin
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''BASIC_USER'', null)', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and (select role from public.club_memberships where id = v_ms_admin) = 'CLUB_ADMIN',
    'D1: the only Club Admin cannot demote themselves (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', null)', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'D2: the only Club Admin cannot leave the club (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''Investigation'')', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'D3: even a Full Site Admin is refused without the explicit override (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''x'', true)', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'D4: a Club Admin cannot use the override (' || v_text || ')');

  -- A second admin makes the change possible.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin2, 'BASIC_USER', 'active') returning id into v_ms_admin2;
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''CLUB_ADMIN'', null)', v_ms_admin2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select role from public.club_memberships where id = v_ms_admin2) = 'CLUB_ADMIN'
    and not exists (select 1 from public.role_assignments where membership_id = v_ms_admin2 and role_key = 'MEMBER' and state = 'ACTIVE'),
    'D5: a Club Admin makes someone else Club Admin (the Member role is replaced)');

  perform pg_temp.act('authenticated', v_admin2);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''BASIC_USER'', null)', v_ms_admin));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select role from public.club_memberships where id = v_ms_admin) = 'BASIC_USER'
    and exists (select 1 from public.role_assignments where membership_id = v_ms_admin and role_key = 'MEMBER' and state = 'ACTIVE')
    and exists (select 1 from public.role_assignments where membership_id = v_ms_admin and role_key = 'CLUB_ADMIN' and state = 'REVOKED'),
    'D6: with another admin in place the first can be demoted; the Club Admin role is revoked history');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', null, true)', v_ms_admin2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'D7: the Site Admin override still needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''Club dissolved its committee; recovery by Site Admin'', true)', v_ms_admin2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state from public.club_memberships where id = v_ms_admin2) = 'REVOKED'
    and exists (select 1 from public.security_events where event_type = 'membership.revoked' and subject_user_id = v_admin2 and actor_user_id = v_full
                and (metadata ->> 'override_last_club_admin')::boolean),
    'D8: a Full Site Admin can override with a reason, and the override is recorded');

  -- ===============================================================
  -- E. Who may act
  -- ===============================================================
  perform pg_temp.act('authenticated', v_member);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''x'')', v_ms_new));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'E1: a member cannot remove another member (' || v_text || ')');

  perform pg_temp.act('authenticated', v_other_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''x'')', v_ms_new));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'E2: another club''s admin cannot suspend here (' || v_text || ')');

  perform pg_temp.act('authenticated', v_access);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''x'')', v_ms_new));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'E3: a user-access Site Admin is not a Full Site Admin (' || v_text || ')');

  perform pg_temp.act('anon');
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''x'')', v_ms_new));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'E4: anonymous callers cannot reach the RPC (' || v_text || ')');

  perform pg_temp.act('authenticated', v_member);
  v_text := pg_temp.try('select count(*) from (select revocation_reason from public.club_memberships) s');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'E5: the browser cannot read removal reasons (' || v_text || ')');

  perform pg_temp.act('authenticated', v_member);
  v_text := pg_temp.try('select count(*) from (select state, source, suspended_level from public.club_memberships) s');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'E6: state and provenance remain readable where RLS allows the row');

  -- ===============================================================
  -- F. Events
  -- ===============================================================
  perform pg_temp.check((select count(*) from public.security_events where event_type = 'membership.suspended' and subject_user_id = v_coach) = 2
    and exists (select 1 from public.security_events where event_type = 'membership.suspended' and subject_user_id = v_coach and actor_user_id = v_full and reason = 'Safeguarding referral'),
    'F1: each suspension is an event with its actor and reason');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'membership.granted' and subject_user_id = v_coach and actor_user_id = v_full
                                and metadata ->> 'source' = 'SITE_ADMIN_ASSIGNMENT'),
    'F2: re-admission is membership.granted with its source');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'role.revoked' and subject_user_id = v_admin and actor_user_id = v_admin2
                                and metadata ->> 'role_key' = 'CLUB_ADMIN'),
    'F3: a role change records role.revoked for the role that ended');
  perform pg_temp.check(not exists (select 1 from public.security_events where event_type like 'membership.%' and actor_user_id is null
                                    and subject_user_id in (v_admin, v_admin2, v_coach, v_joiner, v_joiner2, v_leaver)),
    'F4: no membership event from an RPC lacks its actor');

  raise notice 'Membership state machine complete.';
end $$;

rollback;
