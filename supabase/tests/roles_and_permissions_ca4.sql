-- ROLES & PERMISSIONS (CA-M4) -- THE PERMISSION MODEL, PROVED WHERE IT IS ENFORCED.
--
-- ROLE = default bundle. DECISION = a scoped ALLOW or WITHHOLD on top of it. INHERIT = no decision.
-- RESTORE DEFAULT = the decision is removed, never opposed. The SERVER computes every effective answer.
--
--   RP-A  role default + no decision; role default + withhold; no default + allow; restore; club vs team
--         scope; two team scopes; two roles on two teams
--   RP-B  THE FIXTURE CASE: a Coach withheld fixture creation for one team keeps the role, keeps the view,
--         is refused create_fixture there, keeps create on the other team, and gets it back on restore;
--         the inverse: a Volunteer allowed fixture creation for one team can create there and never
--         reaches the Planner, an import or a bulk edit
--   RP-C  ceilings: non-delegable, site, safeguarding-sensitive, self; no club-level decision can touch
--         people.capability.manage, so no override path can leave a club without a permission admin
--   RP-D  subject and scope: not a member; no role on the team; a TEAM allow lapses when the team role goes
--   RP-E  admin stale authority: the decider loses people.capability.manage mid-edit
--   RP-F  R: stale authenticator refused, fresh accepted, fresh but capability gone refused -- for a
--         decision, a restore and a suspension
--   RP-G  membership operations ask people.membership.suspend / .revoke; a Fixture Secretary is refused
--   RP-H  cancel_fixture asks fixture.fixture.cancel; pitch allocation asks venue.pitch_allocation.*
--   RP-I  cross-club isolation; a read-only persona; no title authority; a role change with a decision
--   RP-J  audit: security events with actor, subject, capability, scope and reason; the club timeline
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.msg(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v = message_text; return v; end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rp-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Rp', p_label, 'rp-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RP ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rp-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rp-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.session_for(p_user uuid, p_aal text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), p_aal::auth.aal_level);
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.msg(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t10 uuid; v_tb uuid;
  v_ca uuid; v_ca2 uuid; v_fs uuid; v_coach uuid; v_vol uuid; v_member uuid; v_full uuid; v_cab uuid; v_titled uuid;
  v_ms_ca uuid; v_ms_coach uuid; v_ms_vol uuid; v_ms_member uuid; v_ms_fs uuid; v_ms_titled uuid;
  r record; v_state text; v_msg text; v_n int; v_override uuid; v_override2 uuid; v_site_deny uuid;
  v_fixture uuid; v_json jsonb; v_sess uuid; v_events_before int;
begin
  -- =====================================================================================
  -- SEED (as postgres): one club with two teams, a second club, and the people
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t10 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');
  v_ca := pg_temp.person('ClubAdmin'); v_ms_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ca2 := pg_temp.person('SecondAdmin'); perform pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FixtureSec'); v_ms_fs := pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_coach := pg_temp.person('Coach'); v_ms_coach := pg_temp.member(v_club, v_coach);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t10, 'manager');
  v_vol := pg_temp.person('Volunteer'); v_ms_vol := pg_temp.member(v_club, v_vol);
  v_member := pg_temp.person('Member'); v_ms_member := pg_temp.member(v_club, v_member);
  v_titled := pg_temp.person('Titled'); v_ms_titled := pg_temp.member(v_club, v_titled);
  v_full := pg_temp.person('SiteFull'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_cab := pg_temp.person('OtherClubAdmin'); perform pg_temp.member(v_club_b, v_cab, 'CLUB_ADMIN');

  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.assign_role(%L, ''VOLUNTEER'', %L, null)', v_ms_vol, v_t10)) = 'OK',
    'RP-0 seeded: a Coach on Under 12 who manages Under 14, and a Volunteer on Under 14');

  -- =====================================================================================
  -- RP-A  ROLE DEFAULTS AND DECISIONS
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  select * into r from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(r.effective and r.source = 'role' and r.role_default and r.role_default_role = 'Coach' and r.override_id is null and r.editable,
    format('RP-A1 role default allow + no decision: effective from the Coach role, decidable here (%s/%s/%s)', r.source, r.role_default_role, r.editable));

  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''deny'', ''CA-M4: not this season'')', v_coach, v_club, v_t12));
  select * into r from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(v_state = 'OK' and not r.effective and r.source = 'denied' and r.role_default and r.override_effect = 'deny' and r.override_level = 'CLUB'
                        and r.override_reason = 'CA-M4: not this season' and r.reason_code = 'EXPLICIT_DENY',
    format('RP-A2 role default allow + explicit withhold: role default still true, decision deny, effective false (%s)', v_state));
  perform pg_temp.check(exists (select 1 from public.role_assignments where user_id = v_coach and team_id = v_t12 and role_key = 'COACH' and state = 'ACTIVE'),
    'RP-A3 the person is still a Coach: a decision never changes the role');
  perform pg_temp.check(not exists (select 1 from public.bundle_capabilities where bundle_key = 'CO' and capability_key = 'fixture.fixture.create') = false,
    'RP-A4 and the Coach bundle itself is untouched');

  select * into r from public.club_person_permissions(v_club, v_vol, 'team', v_t10) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(not r.effective and r.source = 'none' and not r.role_default and r.override_id is null,
    'RP-A5 no role default + no decision: not allowed, nothing to remove');
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''grant'', null)', v_vol, v_club, v_t10));
  select * into r from public.club_person_permissions(v_club, v_vol, 'team', v_t10) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(v_state = 'OK' and r.effective and r.source = 'granted' and not r.role_default and r.override_effect = 'grant' and r.reason_code = 'EXPLICIT_ALLOW',
    format('RP-A6 no role default + explicit allow: effective from the decision, role default still false (%s)', v_state));

  select override_id into v_override from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  v_state := pg_temp.try(format('select public.revoke_capability_override(%L, ''CA-M4: back to the role'')', v_override));
  select * into r from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(v_state = 'OK' and r.effective and r.source = 'role' and r.override_id is null
                        and (select status from public.capability_overrides where id = v_override) = 'revoked'
                        and not exists (select 1 from public.capability_overrides where user_id = v_coach and capability_key = 'fixture.fixture.create' and status = 'active'),
    format('RP-A7 restore default REMOVES the decision -- no row is active, no opposite decision exists, the role answers (%s)', v_state));

  -- club vs team scope, and two team scopes
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''deny'', ''CA-M4: U12 only'')', v_coach, v_club, v_t12));
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(v_state = 'OK' and not internal.can('fixture.fixture.create', 'team', v_club, v_t12, null)
                        and internal.can('fixture.fixture.create', 'team', v_club, v_t10, null)
                        and not internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'RP-A8 a team withhold reaches that team only: Under 14 (their manager side) is unaffected, and club-wide stays what it was');
  perform pg_temp.act('authenticated', v_ca);
  select role_default_role into v_msg from public.club_person_permissions(v_club, v_coach, 'team', v_t10) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(v_msg = 'Team Manager', format('RP-A9 two roles on two teams: the read model names the role that supplies each scope (%s)', v_msg));
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''club'', %L, null, ''deny'', ''CA-M4: club-wide'')', v_fs, v_club));
  perform pg_temp.act('authenticated', v_fs);
  perform pg_temp.check(v_state = 'OK' and not internal.can('fixture.fixture.create', 'club', v_club, null, null)
                        and not internal.can('fixture.fixture.create', 'team', v_club, v_t12, null),
    'RP-A10 a CLUB withhold of an inheriting key reaches every team; a Fixture Secretary loses creation everywhere at the club');
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_fs, 'club') where capability_key = 'fixture.fixture.create';
  perform pg_temp.try(format('select public.revoke_capability_override(%L, null)', v_override));

  -- =====================================================================================
  -- RP-B  THE FIXTURE CASE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_t12, null) and not internal.can_create_team_fixture(v_club, v_t12),
    'RP-B1 withheld for Under 12: the Coach still sees the team''s fixtures and the create authority is gone');
  v_state := pg_temp.try(format('select public.create_fixture(%L, ''Home'', ''Probe RFC'', %L, ''Planned'')', v_t12, current_date + 30));
  perform pg_temp.check(v_state = '42501', format('RP-B2 create_fixture for Under 12 is refused by the server (%s)', v_state));
  v_msg := pg_temp.msg(format('select public.create_fixture(%L, ''Home'', ''Probe RFC'', %L, ''Planned'')', v_t10, current_date + 30));
  perform pg_temp.check(v_msg = 'OK', format('RP-B3 and the same person still creates for Under 14, where nothing was decided (%s)', v_msg));
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.try(format('select public.revoke_capability_override(%L, ''CA-M4: restored'')', v_override));
  perform pg_temp.act('authenticated', v_coach);
  v_state := pg_temp.try(format('select public.create_fixture(%L, ''Home'', ''Probe RFC'', %L, ''Planned'')', v_t12, current_date + 31));
  perform pg_temp.check(v_state = 'OK' and internal.can_create_team_fixture(v_club, v_t12), format('RP-B4 restore default: the Coach role permits creation again (%s)', v_state));

  -- the inverse: the Volunteer allowed at Under 14 (RP-A6) can create there and nowhere near the club tools
  perform pg_temp.act('authenticated', v_vol);
  v_state := pg_temp.try(format('select public.create_fixture(%L, ''Home'', ''Probe RFC'', %L, ''Planned'')', v_t10, current_date + 32));
  perform pg_temp.check(v_state = 'OK', format('RP-B5 inverse: no role default + team allow -> create_fixture for that team succeeds (%s)', v_state));
  v_state := pg_temp.try(format('select public.create_fixture(%L, ''Home'', ''Probe RFC'', %L, ''Planned'')', v_t12, current_date + 32));
  perform pg_temp.check(v_state = '42501', format('RP-B6 and not for the other team (%s)', v_state));
  perform pg_temp.check(not internal.can('fixture.planner.use', 'club', v_club, null, null) and not internal.can('fixture.import.run', 'club', v_club, null, null)
                        and not internal.can('fixture.fixture.bulk_edit', 'club', v_club, null, null) and not internal.can_bulk_plan_fixtures(v_club)
                        and not internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'RP-B7 NO PLANNER ESCALATION: a team allow confers no Planner, import, bulk edit or club-wide fixture authority');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.capabilities where key in ('fixture.planner.use', 'fixture.import.run', 'fixture.fixture.bulk_edit', 'fixture.fixture.delete') and 'team' = any (valid_scopes);
  perform pg_temp.check(v_n = 0, 'RP-B8 and none of those can even be named at team scope');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(not exists (select 1 from public.club_person_permissions(v_club, v_vol, 'team', v_t10) where capability_key in ('fixture.planner.use', 'fixture.import.run', 'fixture.fixture.bulk_edit')),
    'RP-B9 so the team read model never offers them');

  -- =====================================================================================
  -- RP-C  CEILINGS
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''people.role.assign_club'', ''club'', %L, null, ''grant'', null)', v_member, v_club)) = '42501',
    'RP-C1 a non-delegable key cannot be allowed by the club');
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''people.capability.manage'', ''club'', %L, null, ''deny'', ''lockout attempt'')', v_ca2, v_club)) = '42501',
    'RP-C2 nor can people.capability.manage be withheld by the club -- no override path can leave the club without a permission administrator');
  perform pg_temp.check(not exists (select 1 from public.club_person_permissions(v_club, v_member, 'club') where capability_key in ('people.role.assign_club', 'people.capability.manage', 'people.membership.suspend', 'people.membership.revoke')),
    'RP-C3 and the read model does not list them');
  v_msg := pg_temp.msg(format('select public.set_capability_override(%L, ''site.users.view'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_msg like 'Site capabilities are given through Site Admin profiles%', format('RP-C4 SITE ADMIN BOUNDARY: a site.* key is refused by name (%s)', v_msg));
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''site'', null, null, ''grant'', null)', v_member)) = '42501',
    'RP-C5 and a crafted site-scope decision by a Club Admin is refused');
  perform pg_temp.check(not exists (select 1 from public.club_person_permissions(v_club, v_member, 'club') where capability_key like 'site.%'),
    'RP-C6 no site key is ever in a club read model');
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''people.member.view_contact'', ''club'', %L, null, ''grant'', null)', v_member, v_club)) = '42501'
                        and not exists (select 1 from public.club_person_permissions(v_club, v_member, 'club') where capability_key like 'safeguarding.%' or capability_key = 'people.member.view_contact'),
    'RP-C7 SAFEGUARDING BOUNDARY: safeguarding-sensitive keys are neither decidable nor listed');
  v_msg := pg_temp.msg(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''club'', %L, null, ''deny'', ''self'')', v_ca, v_club));
  perform pg_temp.check(v_msg = 'You cannot change your own permissions.' and not exists (select 1 from public.club_person_permissions(v_club, v_ca, 'club') where editable),
    format('RP-C8 SELF: a Club Admin cannot decide their own permissions, and their own rows are not editable (%s)', v_msg));

  -- =====================================================================================
  -- RP-D  SUBJECT AND SCOPE
  -- =====================================================================================
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_t12)) = '23514',
    'RP-D1 a team decision about somebody with no role on that team is refused (23514)');
  perform pg_temp.check(pg_temp.try(format('select * from public.club_person_permissions(%L, %L, ''team'', %L)', v_club, v_member, v_t12)) = '23514'
                        and not exists (select 1 from public.club_person_permission_scopes(v_club, v_member) where scope_type = 'team'),
    'RP-D2 and the read model offers no such scope for them');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''CA-M4: stale-subject proof'', false)', v_ms_titled));
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''club'', %L, null, ''grant'', null)', v_titled, v_club)) = '23514',
    'RP-D3 STALE SUBJECT: a decision about somebody whose membership is no longer active is refused');
  perform pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''CA-M4: restored'', false)', v_ms_titled));
  -- a TEAM allow lapses when the team role goes
  perform pg_temp.act('authenticated', v_vol);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_t10, null), 'RP-D4 SETUP: the Volunteer''s team allow answers while they hold the team role');
  perform pg_temp.act('authenticated', v_ca);
  select id into v_override from public.role_assignments where user_id = v_vol and team_id = v_t10 and role_key = 'VOLUNTEER' and state = 'ACTIVE';
  v_state := pg_temp.try(format('select public.transition_role_assignment(%L, ''REVOKED'', ''CA-M4: left the side'', false)', v_override));
  perform pg_temp.act('authenticated', v_vol);
  perform pg_temp.check(v_state = 'OK' and not internal.can('fixture.fixture.create', 'team', v_club, v_t10, null)
                        and exists (select 1 from public.capability_overrides where user_id = v_vol and capability_key = 'fixture.fixture.create' and status = 'active'),
    format('RP-D5 NO ORPHANED GRANT: the allow stops answering the moment the team role ends, without anybody touching the decision (%s)', v_state));
  select trail into v_json from public.explain_access(v_vol, 'fixture.fixture.create', 'team', v_club, v_t10);
  perform pg_temp.check(v_json::text like '%TEAM_ROLE_LAPSED%', 'RP-D6 and the engine says why: TEAM_ROLE_LAPSED');

  -- =====================================================================================
  -- RP-E  ADMIN STALE AUTHORITY
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_full);
  v_site_deny := public.set_capability_override(v_ca, 'people.capability.manage', 'club', v_club, null, 'deny', 'CA-M4: stale-admin proof');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''calendar.event.manage'', ''club'', %L, null, ''grant'', null)', v_member, v_club)) = '42501',
    'RP-E1 the decider whose people.capability.manage was withheld mid-edit is refused by the server');
  select count(*) into v_n from public.my_capabilities('club', v_club) where capability_key = 'people.capability.manage' and allowed;
  perform pg_temp.check(v_n = 0 and not exists (select 1 from public.club_person_permissions(v_club, v_member, 'club') where editable),
    'RP-E2 the capability read says no, and every row reads as not editable (they may still SEE: people.access.explain is held)');
  perform pg_temp.act('authenticated', v_full);
  perform public.revoke_capability_override(v_site_deny, 'CA-M4: restored');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(exists (select 1 from public.club_person_permissions(v_club, v_member, 'club') where editable), 'RP-E3 revoking the withhold restores the decider');

  -- =====================================================================================
  -- RP-F  RECENT AUTHENTICATOR (R)
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_sess := pg_temp.session_for(v_ca, 'aal2');
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_msg := pg_temp.msg(format('select public.set_capability_override(%L, ''calendar.event.manage'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_msg = 'Enter a code from your authenticator to continue.',
    format('RP-F1 an AAL2 session that never entered a code is refused a permission decision (%s)', v_msg));
  perform pg_temp.act_postgres();
  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v_sess, 'totp', now() - interval '2 minutes', now() - interval '2 minutes');
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''calendar.event.manage'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = 'OK', format('RP-F2 a code entered two minutes ago satisfies R and the decision is recorded (%s)', v_state));
  select override_id into v_override from public.club_person_permissions(v_club, v_member, 'club') where capability_key = 'calendar.event.manage';
  perform pg_temp.act_postgres();
  update auth.mfa_amr_claims set updated_at = now() - interval '4 hours' where session_id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_msg := pg_temp.msg(format('select public.revoke_capability_override(%L, null)', v_override));
  perform pg_temp.check(v_msg = 'Enter a code from your authenticator to continue.', format('RP-F3 four hours later the same session is refused a restore (%s)', v_msg));
  v_msg := pg_temp.msg(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''CA-M4: R on suspension'', false)', v_ms_member));
  perform pg_temp.check(v_msg = 'Enter a code from your authenticator to continue.', format('RP-F4 and a suspension, which carries the same R (%s)', v_msg));
  perform pg_temp.act_postgres();
  update auth.mfa_amr_claims set updated_at = now() - interval '1 minute' where session_id = v_sess;
  perform pg_temp.act('authenticated', v_full);
  v_site_deny := public.set_capability_override(v_ca, 'people.capability.manage', 'club', v_club, null, 'deny', 'CA-M4: R vs authority');
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_msg := pg_temp.msg(format('select public.revoke_capability_override(%L, null)', v_override));
  perform pg_temp.check(v_msg = 'You are not authorised to change that permission.',
    format('RP-F5 AUTHENTICATION IS NOT AUTHORISATION: a fresh code with the capability gone is refused as unauthorised, not asked for a code (%s)', v_msg));
  perform pg_temp.act('authenticated', v_full);
  perform public.revoke_capability_override(v_site_deny, 'CA-M4: restored');
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.revoke_capability_override(%L, ''CA-M4: fresh and authorised'')', v_override));
  perform pg_temp.check(v_state = 'OK', format('RP-F6 fresh code + capability held: the restore proceeds (%s)', v_state));
  v_state := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''CA-M4: fresh suspension'', false)', v_ms_member));
  perform pg_temp.check(v_state = 'OK', format('RP-F7 and so does a suspension (%s)', v_state));
  perform pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''CA-M4: restored'', false)', v_ms_member));

  -- =====================================================================================
  -- RP-G  MEMBERSHIP OPERATIONS ASK THEIR OWN KEYS
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_fs);
  perform pg_temp.check(pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''no'', false)', v_ms_member)) = '42501'
                        and pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''no'', false)', v_ms_member)) = '42501',
    'RP-G1 a Fixture Secretary (no people.membership.* key) can neither suspend nor remove');
  perform pg_temp.act('authenticated', v_full);
  v_site_deny := public.set_capability_override(v_ca, 'people.membership.revoke', 'club', v_club, null, 'deny', 'CA-M4: revoke withheld');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.transition_club_membership(%L, ''REVOKED'', ''try'', false)', v_ms_titled)) = '42501'
                        and pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''still allowed'', false)', v_ms_titled)) = 'OK',
    'RP-G2 people.membership.revoke withheld: removal refused, suspension (its own key) still allowed -- the operation asks the key the catalogue names');
  perform pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''restored'', false)', v_ms_titled));
  perform pg_temp.act('authenticated', v_full);
  perform public.revoke_capability_override(v_site_deny, 'CA-M4: restored');
  perform pg_temp.act_postgres();
  select count(distinct bundle_key) into v_n from public.bundle_capabilities where capability_key in ('people.membership.suspend', 'people.membership.revoke');
  perform pg_temp.check(v_n = 1 and (select grant_level from public.capabilities where key = 'people.membership.suspend') = 'N',
    'RP-G3 NO BROADENING: only the Club Admin bundle holds the membership keys and a club cannot delegate them');

  -- =====================================================================================
  -- RP-H  CANCEL AND PITCH ALLOCATION ASK THE KEYS THEIR SWITCHES NAME
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  execute format('select public.create_fixture(%L, ''Home'', ''Cancel Probe RFC'', %L, ''Planned'')', v_t12, current_date + 40) into v_json;
  v_fixture := (v_json ->> 'fixtureId')::uuid;
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.cancel'', ''team'', %L, %L, ''deny'', ''CA-M4: cancel withheld'')', v_coach, v_club, v_t12));
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(v_state = 'OK' and internal.can('fixture.result.record', 'team', v_club, v_t12, null)
                        and pg_temp.try(format('select public.cancel_fixture(%L, ''rain'')', v_fixture)) = '42501',
    'RP-H1 cancel_fixture asks fixture.fixture.cancel: a Coach who may still record a result but has cancel withheld is refused');
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.cancel';
  perform pg_temp.try(format('select public.revoke_capability_override(%L, null)', v_override));
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(pg_temp.try(format('select public.cancel_fixture(%L, ''rain'')', v_fixture)) = 'OK', 'RP-H2 and may cancel again once the decision is removed');
  -- pitch allocation
  perform pg_temp.act('authenticated', v_fs);
  perform pg_temp.check(pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, status) values (%L, %L, ''draft'')', v_club, current_date + 7)) = 'OK',
    'RP-H3 a Fixture Secretary (venue.pitch_allocation.manage by bundle) may open a pitch allocation proposal');
  perform pg_temp.act('authenticated', v_full);
  v_site_deny := public.set_capability_override(v_fs, 'venue.pitch_allocation.manage', 'club', v_club, null, 'deny', 'CA-M4: allocation withheld');
  perform pg_temp.act('authenticated', v_fs);
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'club', v_club, null, null)
                        and pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, status) values (%L, %L, ''draft'')', v_club, current_date + 8)) <> 'OK',
    'RP-H4 with venue.pitch_allocation.manage withheld the same person -- who still edits fixtures -- cannot: the switch decides what it names');
  perform pg_temp.act('authenticated', v_full);
  perform public.revoke_capability_override(v_site_deny, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(not exists (select 1 from pg_policies where tablename like 'pitch_allocation%' and (coalesce(qual, '') like '%fixture.edit%' or coalesce(with_check, '') like '%fixture.edit%'))
                        and exists (select 1 from pg_policies where tablename = 'pitch_allocation_proposals' and coalesce(with_check, '') like '%venue.pitch_allocation.manage%'),
    'RP-H5 structurally: the pitch allocation policies name venue.pitch_allocation.* and no longer the fixture-edit key');

  -- =====================================================================================
  -- RP-I  ISOLATION, THE READ-ONLY PERSONA, TITLES, ROLE CHANGE WITH A DECISION
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_cab);
  perform pg_temp.check(pg_temp.try(format('select * from public.club_person_permissions(%L, %L, ''club'')', v_club, v_coach)) = '42501'
                        and pg_temp.try(format('select * from public.club_person_permission_scopes(%L, %L)', v_club, v_coach)) = '42501'
                        and pg_temp.try(format('select * from public.club_member_capabilities(%L)', v_club)) = '42501',
    'RP-I1 CROSS-CLUB: another club''s admin cannot read this club''s permission model');
  perform pg_temp.check(pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''club'', %L, null, ''deny'', ''x'')', v_coach, v_club)) = '42501'
                        and pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''grant'', null)', v_coach, v_club_b, v_t12)) = '42501'
                        and pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''grant'', null)', v_coach, v_club, v_t12)) = '42501',
    'RP-I2 nor write one, nor target this club''s team from their own club, even knowing every id');
  perform pg_temp.act('authenticated', v_fs);
  perform pg_temp.check(pg_temp.try(format('select * from public.club_person_permissions(%L, %L, ''club'')', v_club, v_coach)) = '42501'
                        and pg_temp.try(format('select public.set_capability_override(%L, ''calendar.event.view'', ''club'', %L, null, ''grant'', null)', v_member, v_club)) = '42501'
                        and (select count(*) from public.my_capabilities('club', v_club) where capability_key in ('people.capability.manage', 'people.access.explain') and allowed) = 0,
    'RP-I3 READ-ONLY PERSONA: a Fixture Secretary sees People but no permission model, and a crafted decision is refused');
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select public.set_membership_governance_title(%L, ''Fixtures Secretary'')', v_ms_titled));
  perform pg_temp.act('authenticated', v_titled);
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'club', v_club, null, null) and not internal.can('fixture.fixture.create', 'team', v_club, v_t12, null),
    format('RP-I4 NO TITLE AUTHORITY: a governance title reading "Fixtures Secretary" grants nothing (%s)', v_state));
  -- role change with a decision in place
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.create'', ''team'', %L, %L, ''deny'', ''CA-M4: survives a role change'')', v_coach, v_club, v_t12));
  v_state := pg_temp.try(format('select public.set_team_access(%L, %L, ''manager'', ''CA-M4: promoted'')', v_ms_coach, v_t12));
  select * into r from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.check(v_state = 'OK' and r.role_default_role = 'Team Manager' and r.override_effect = 'deny' and not r.effective,
    format('RP-I5 ROLE CHANGE WITH A DECISION: the withhold persists across Coach -> Team Manager and still decides; the read model shows the new role default (%s/%s)', v_state, r.role_default_role));
  select override_id into v_override from public.club_person_permissions(v_club, v_coach, 'team', v_t12) where capability_key = 'fixture.fixture.create';
  perform pg_temp.try(format('select public.revoke_capability_override(%L, null)', v_override));

  -- =====================================================================================
  -- RP-J  AUDIT
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  select count(*) into v_events_before from public.security_events where club_id = v_club and event_type like 'override.%';
  v_override := public.set_capability_override(v_member, 'calendar.event.manage', 'club', v_club, null, 'deny', 'CA-M4: audit probe');
  perform public.revoke_capability_override(v_override, 'CA-M4: audit probe restored');
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.security_events e where e.event_type = 'override.granted' and e.actor_user_id = v_ca and e.subject_user_id = v_member
                                  and e.club_id = v_club and e.reason = 'CA-M4: audit probe' and e.metadata ->> 'capability_key' = 'calendar.event.manage'
                                  and e.metadata ->> 'effect' = 'deny' and e.metadata ->> 'scope_type' = 'club' and e.metadata ->> 'override_id' = v_override::text)
                        and exists (select 1 from public.security_events e where e.event_type = 'override.revoked' and e.actor_user_id = v_ca and e.subject_user_id = v_member
                                  and e.reason = 'CA-M4: audit probe restored' and e.metadata ->> 'override_id' = v_override::text)
                        and exists (select 1 from public.audit_log a where a.table_name = 'capability_overrides' and a.record_id = v_override and a.actor_user_id = v_ca),
    'RP-J1 every decision and every restore is a security event with actor, subject, capability, scope and reason, plus a row-level audit entry');
  perform pg_temp.act('authenticated', v_ca);
  select count(*) into v_n from public.club_access_history(v_club, v_member, 50) h where h.event_type like 'override.%' and h.capability_key = 'Manage Calendar';
  perform pg_temp.check(v_n >= 2, format('RP-J2 the club''s own timeline shows them with the human label (%s rows)', v_n));
  perform pg_temp.act('authenticated', v_cab);
  perform pg_temp.check(pg_temp.try(format('select * from public.club_access_history(%L, %L, 10)', v_club, v_member)) = '42501', 'RP-J3 and another club cannot read it');
end $$;

rollback;
