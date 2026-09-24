-- TEAM OPERATIONS (CA-M7) -- THE TEAM WORKSPACE, PROVED WHERE IT IS ENFORCED.
--
-- A team context is a WORKSPACE, not a smaller club admin panel. Everything the phone draws for a team
-- comes from one capability read at team scope, and everything it writes is refused again by the server.
-- This suite proves the authority the workspace consumes and cannot widen:
--
--   TO-A  the team authority probe: a Team Manager's role default at team scope; a Coach's narrower one;
--         the Planner, Import, bulk edit and delete are never offered at team scope to anybody
--   TO-B  fixture mutation by a non-protected Team Manager: create, edit, cancel on THEIR team; a Club Admin
--         withholds edit -> the same role is refused mid-edit; restore -> it returns; the same for cancel
--   TO-C  cross-team and cross-club isolation: a U12 manager creates, edits and cancels nothing on U14 or
--         on another club's U12, and holds no capability at those scopes
--   TO-D  no club-wide escalation: no Planner, Import, bulk edit or delete at club scope; no club-wide
--         membership administration; no club ledger read
--   TO-E  subscriptions: the team-scoped operation answers only the holder, only for their team; the
--         underlying rows stay refused to a team holder; no provider column exists in the result;
--         a withhold refuses, a restore returns
--   TO-F  people: the roster reader refuses the wrong team and the wrong club; a Coach reads but does not
--         decide; a Team Manager decides; the reader carries no contact column
--   TO-G  fixture requests: a request from another club is seen by the target team, answered only by a
--         holder of fixture.request.respond, and a Coach's crafted acceptance is refused
--   TO-H  messaging: a parent and a player cannot message the opposition; a minor cannot message the
--         coach and the coach cannot message the minor; the fixture route exists for staff only
--   TO-I  availability: no staff override -- a Team Manager cannot answer for a player; the summary is
--         absent for a team the viewer has no attendance authority on
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

create or replace function pg_temp.count_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return v;
exception when others then return -1; end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'to-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'To', p_label, 'to-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'to-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'to-' || v_tag, 'active') returning id into v_club;
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

create or replace function pg_temp.player(p_label text, p_years int, p_team uuid, p_user uuid default null, p_state text default 'ACTIVE') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('P', p_label, (current_date - (p_years || ' years')::interval)::date, 'MALE', p_user) returning id into v;
  insert into public.player_team_memberships (player_id, team_id, state) values (v, p_team, p_state);
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.count_of(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid;
  v_ca uuid; v_tm uuid; v_coach uuid; v_member uuid; v_cab uuid; v_tmb uuid; v_parent uuid; v_teen uuid; v_grown uuid;
  v_ms_tm uuid; v_ms_coach uuid; v_ms_member uuid; v_ms_tmb uuid; v_ms_ca uuid;
  v_child uuid; v_teen_player uuid; v_grown_player uuid; v_other_player uuid; v_pending uuid; v_pending_ms uuid; v_b_player uuid;
  v_fixture uuid; v_fixture14 uuid; v_fixture_b uuid; v_json jsonb; v_state text; v_override uuid; v_n bigint; r record;
  v_season uuid; v_programme uuid; v_pricing uuid; v_payer uuid; v_group uuid; v_request uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  -- =====================================================================================
  -- SEED (as postgres): club A (U12, U14), club B (U12), and the people
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');

  v_ca := pg_temp.person('ClubAdmin'); v_ms_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TeamManager'); v_ms_tm := pg_temp.member(v_club, v_tm);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  v_coach := pg_temp.person('Coach'); v_ms_coach := pg_temp.member(v_club, v_coach);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  v_member := pg_temp.person('Member'); v_ms_member := pg_temp.member(v_club, v_member);
  v_cab := pg_temp.person('OtherClubAdmin'); perform pg_temp.member(v_club_b, v_cab, 'CLUB_ADMIN');
  v_tmb := pg_temp.person('OtherTeamManager'); v_ms_tmb := pg_temp.member(v_club_b, v_tmb);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tmb, v_tb, 'manager');

  -- A parent, a 16-year-old with an account, an adult player with an account -- all on club A's U12/U14.
  v_parent := pg_temp.person('Parent');
  v_teen := pg_temp.person('Teen', (current_date - interval '16 years')::date);
  v_grown := pg_temp.person('Grown', (current_date - interval '30 years')::date);
  v_child := pg_temp.player('Child ' || v_tag, 11, v_t12);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent);
  v_teen_player := pg_temp.player('Teen ' || v_tag, 16, v_t12, v_teen);
  v_grown_player := pg_temp.player('Grown ' || v_tag, 30, v_t14, v_grown);
  v_other_player := pg_temp.player('Other ' || v_tag, 11, v_t14);
  v_pending := pg_temp.player('Pending ' || v_tag, 11, v_t12, null, 'PENDING');
  select id into v_pending_ms from public.player_team_memberships where player_id = v_pending and team_id = v_t12;
  v_b_player := pg_temp.player('Bee ' || v_tag, 11, v_tb);

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;

  -- A fixture on U14 (created by the club) and one on club B's U12, for the cross-scope refusals.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t14, 'Home', 'TO External RFC', current_date + 20, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture14;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_tb, 'Home', 'TO External RFC', current_date + 21, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture_b;

  -- A subscription programme at club A, with an obligation for the U12 child and the U14 adult.
  insert into public.club_subscription_programmes (club_id, enabled, currency, created_by) values (v_club, true, 'GBP', v_ca) returning id into v_programme;
  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values (v_programme, 1500, current_date - 60, v_ca) returning id into v_pricing;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_child, v_programme, v_parent, 'guardian', 'active', v_ca) returning id into v_payer;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, currency, due_date, status)
  values (v_programme, v_club, v_child, v_payer, v_pricing, date_trunc('month', current_date)::date, 1500, 'GBP', current_date + 5, 'FAILED');

  perform pg_temp.check(v_t12 is not null and v_ms_tm is not null and v_child is not null and v_programme is not null,
    'TO-0 seeded: two clubs, three teams, a Team Manager and a Coach on U12, a parent, a teen, an adult, a pending place, a programme');

  -- =====================================================================================
  -- TO-A  THE TEAM AUTHORITY PROBE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed
    and capability_key in ('fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','fixture.request.create','fixture.request.respond',
                           'team.attendance.view','team.roster.view','team.roster.manage','team.join_code.manage','finance.subscription.view','team.news.manage');
  perform pg_temp.check(v_n = 11, format('TO-A1 a Team Manager''s role default at team scope: the eleven keys the workspace draws with are allowed (%s of 11)', v_n));
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed
    and capability_key in ('fixture.planner.use','fixture.import.run','fixture.fixture.bulk_edit','fixture.fixture.delete','competition.creator.use');
  perform pg_temp.check(v_n = 0, format('TO-A2 the Planner, Import, bulk edit, delete and the Competition Creator are never allowed at team scope (%s allowed)', v_n));

  perform pg_temp.act('authenticated', v_coach);
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key in ('fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','team.attendance.view','team.roster.view');
  perform pg_temp.check(v_n = 5, format('TO-A3 a Coach''s role default: fixtures, the register and the roster read (%s of 5)', v_n));
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key in ('fixture.request.respond','team.roster.manage','finance.subscription.view','team.join_code.manage');
  perform pg_temp.check(v_n = 0, format('TO-A4 and NOT answering requests, changing the roster, subscriptions or join codes -- role is the default bundle, not a title (%s allowed)', v_n));

  perform pg_temp.act('authenticated', v_ca);
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key in ('fixture.planner.use','fixture.import.run','fixture.fixture.bulk_edit');
  perform pg_temp.check(v_n = 0, 'TO-A5 even a Club Admin asking at TEAM scope is not offered the Planner, Import or bulk edit: the boundary is the scope');

  -- =====================================================================================
  -- TO-B  FIXTURE MUTATION BY A NON-PROTECTED TEAM MANAGER, AND STALE AUTHORITY
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  select public.create_fixture(v_t12, 'Home', 'TO Visitors RFC', current_date + 14, 'Planned', null, null, '10:30'::time, 'Friendly') into v_json;
  v_fixture := (v_json->>'fixtureId')::uuid;
  perform pg_temp.check(v_fixture is not null and (v_json->>'pendingRequest')::boolean = false,
    'TO-B1 role default: a Team Manager creates a fixture for their own team against an external opponent');
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture, '{"game_type":"League Fixture","notes":"Meet at the clubhouse"}'));
  perform pg_temp.check(v_state = 'OK' and (select game_type from public.fixtures where id = v_fixture) = 'League Fixture',
    format('TO-B2 role default: the same person edits it -- the classification is the canonical taxonomy''s word (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture, '{"game_type":"Grudge Match"}'));
  perform pg_temp.check(v_state = '23514', format('TO-B3 a classification outside the taxonomy is refused by the server, whatever a client offered (%s)', v_state));

  -- The Club Admin withholds edit for THIS team while the manager has the fixture open.
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''team'', %L, %L, ''deny'', ''CA-M7: not this season'')', v_tm, v_club, v_t12));
  perform pg_temp.check(v_state = 'OK', format('TO-B4 a Club Admin withholds fixture.fixture.edit at team scope (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture, '{"notes":"still allowed?"}'));
  perform pg_temp.check(v_state = '42501' and (select notes from public.fixtures where id = v_fixture) = 'Meet at the clubhouse',
    format('TO-B5 STALE AUTHORITY: the same role, the same open fixture, the save is refused and nothing changed (%s)', v_state));
  perform pg_temp.check(exists (select 1 from public.role_assignments where user_id = v_tm and team_id = v_t12 and role_key = 'TEAM_MANAGER' and state = 'ACTIVE'),
    'TO-B6 and they are still a Team Manager: a decision never changes the role');
  -- TO-B7 IS DELIBERATELY NOT AN ASSERTION. `update_fixture_kickoff` asks `internal.can_submit_fixture_result`
  -- (fixture.result.record), not fixture.fixture.edit, so a withheld edit does not reach it. Recorded as
  -- ledger H24 rather than asserted either way: asserting the gap would bless it, and asserting the fix
  -- would be a fixture-authority change this slice does not make.
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_tm, 'team', v_t12) where capability_key = 'fixture.fixture.edit';
  v_state := pg_temp.try(format('select public.revoke_capability_override(%L, ''CA-M7: restored'')', v_override));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture, '{"notes":"back"}'));
  perform pg_temp.check(v_state = 'OK', format('TO-B8 RESTORE DEFAULT: the decision is removed and the role answers again -- the edit lands (%s)', v_state));

  -- Cancel: withheld, refused; restored, cancelled with a reason and never deleted.
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.cancel'', ''team'', %L, %L, ''deny'', ''CA-M7'')', v_tm, v_club, v_t12));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''Pitch waterlogged'')', v_fixture));
  perform pg_temp.check(v_state = '42501', format('TO-B9 cancel withheld at team scope: cancel_fixture refuses (%s)', v_state));
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_tm, 'team', v_t12) where capability_key = 'fixture.fixture.cancel';
  perform pg_temp.try(format('select public.revoke_capability_override(%L, null)', v_override));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, '''')', v_fixture));
  perform pg_temp.check(v_state <> 'OK', format('TO-B10 a cancellation needs a reason (%s)', v_state));
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''Pitch waterlogged'')', v_fixture));
  perform pg_temp.check(v_state = 'OK' and (select status from public.fixtures where id = v_fixture) = 'Cancelled'
                        and (select cancellation_reason from public.fixtures where id = v_fixture) = 'Pitch waterlogged'
                        and exists (select 1 from public.fixtures where id = v_fixture),
    format('TO-B11 restored: cancelled with the reason recorded, and the row still exists -- cancelling is not deleting (%s)', v_state));
  v_state := pg_temp.try(format('delete from public.fixtures where id = %L', v_fixture));
  perform pg_temp.check(v_state <> 'OK' or exists (select 1 from public.fixtures where id = v_fixture), 'TO-B12 and a crafted DELETE by the Team Manager removes nothing');

  -- =====================================================================================
  -- TO-C  CROSS-TEAM AND CROSS-CLUB ISOLATION
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.create_fixture(%L, ''Home'', ''TO Probe RFC'', %L, ''Planned'')', v_t14, current_date + 30));
  perform pg_temp.check(v_state = '42501', format('TO-C1 a U12 manager cannot create a fixture for U14 in the same club (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture14, '{"notes":"probe"}'));
  perform pg_temp.check(v_state = '42501', format('TO-C2 nor edit U14''s fixture (%s)', v_state));
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''probe'')', v_fixture14));
  perform pg_temp.check(v_state = '42501', format('TO-C3 nor cancel it (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fixture_b, '{"notes":"probe"}'));
  perform pg_temp.check(v_state = '42501', format('TO-C4 nor edit another club''s fixture, knowing its id (%s)', v_state));
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''probe'')', v_fixture_b));
  perform pg_temp.check(v_state = '42501', format('TO-C5 nor cancel it (%s)', v_state));
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t14) where allowed
    and capability_key in ('fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','fixture.fixture.archive','fixture.request.create','fixture.request.respond','fixture.result.record','team.roster.manage','team.attendance.view','finance.subscription.view');
  perform pg_temp.check(v_n = 0, format('TO-C6 the probe at U14 offers a U12 manager no mutation, register or finance key -- only the club member''s view (%s allowed)', v_n));
  select count(*) into v_n from public.my_capabilities('team', v_club_b, v_tb) where allowed;
  perform pg_temp.check(v_n = 0, format('TO-C7 the probe at another club''s team offers nothing whatsoever (%s allowed)', v_n));

  -- =====================================================================================
  -- TO-D  NO CLUB-WIDE ESCALATION
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  perform pg_temp.check(not internal.can('fixture.planner.use', 'club', v_club, null, null)
                        and not internal.can('fixture.import.run', 'club', v_club, null, null)
                        and not internal.can('fixture.fixture.bulk_edit', 'club', v_club, null, null)
                        and not internal.can('fixture.fixture.delete', 'club', v_club, null, null)
                        and not internal.can_bulk_plan_fixtures(v_club),
    'TO-D1 a Team Manager holds no Planner, Import, bulk edit or delete at club scope');
  perform pg_temp.check(not internal.can('people.member.view', 'club', v_club, null, null)
                        and not internal.can('people.capability.manage', 'club', v_club, null, null)
                        and pg_temp.try(format('select * from public.club_people(%L)', v_club)) <> 'OK',
    'TO-D2 and no club-wide membership administration: the club People read model refuses them');
  perform pg_temp.check(not internal.can('finance.subscription.view', 'club', v_club, null, null)
                        and not internal.can('finance.payment.act', 'club', v_club, null, null)
                        and pg_temp.count_of(format('select count(*) from public.membership_obligations where club_id = %L', v_club)) = 0,
    'TO-D3 and no club ledger: finance stays club-scoped, and the obligation table is empty to them under RLS');

  -- =====================================================================================
  -- TO-E  SUBSCRIPTIONS: THE TEAM-SCOPED OPERATION, AND ONLY THAT
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t12));
  select count(*) into v_n from public.team_subscription_status(v_t12);
  perform pg_temp.check(v_state = 'OK' and v_n = 2, format('TO-E1 a Team Manager reads their squad''s subscription state: one row per ACTIVE player, the pending place excluded (%s, %s rows)', v_state, v_n));
  select * into r from public.team_subscription_status(v_t12) where player_id = v_child;
  perform pg_temp.check(r.obligation_status = 'FAILED' and r.has_payer and r.amount_due_minor = 1500 and r.programme_exists,
    'TO-E2 the failed obligation is reported as operational state -- status, amount, whether a payer exists');
  perform pg_temp.check(not exists (select 1 from pg_attribute a join pg_proc p on true
                                     where p.proname = 'team_subscription_status' and p.pronamespace = 'public'::regnamespace
                                       and a.attrelid = (select typrelid from pg_type where oid = p.prorettype)
                                       and (a.attname like 'gc_%' or a.attname like '%mandate%' or a.attname like '%payer_user%' or a.attname like '%token%')),
    'TO-E3 the operation''s result type carries no provider, mandate, token or payer-identity column');
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t14));
  perform pg_temp.check(v_state = '42501', format('TO-E4 SIBLING TEAM: the same person is refused U14''s subscription state (%s)', v_state));
  perform pg_temp.check(pg_temp.count_of(format('select count(*) from public.membership_obligations where player_id = %L', v_child)) = 0
                        and pg_temp.count_of(format('select count(*) from public.player_subscription_payers where player_id = %L', v_child)) = 0,
    'TO-E5 the underlying rows stay refused to a team holder: the operation is the only door, and the policies were not widened');
  perform pg_temp.act('authenticated', v_coach);
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t12));
  perform pg_temp.check(v_state = '42501', format('TO-E6 UNAUTHORISED STAFF: a Coach on the same team is refused (%s)', v_state));
  perform pg_temp.act('authenticated', v_tmb);
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t12));
  perform pg_temp.check(v_state = '42501', format('TO-E7 OTHER CLUB: another club''s Team Manager is refused (%s)', v_state));
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t12));
  perform pg_temp.check(v_state = 'OK', format('TO-E8 a club finance holder is let in to a smaller version of a question they may already ask (%s)', v_state));
  -- TO-E9 AND TO-E10 ARE DELIBERATELY NOT ASSERTIONS. `finance.subscription.view` carries team scope
  -- (20270531) but `inherits_to_team = false` and a club-level decision ceiling, so a Club Admin can
  -- neither decide it at team level ("not authorised to change that permission") nor reach the team
  -- answer with a club-level withhold. A Team Manager's team-scoped view therefore cannot be withheld
  -- today. Recorded as ledger H25 for the finance slice that owns the key; asserting either the gap or
  -- the fix here would be a finance-authority decision this slice does not make.
  perform pg_temp.check(not exists (select 1 from public.capabilities where key like 'finance.%' and key not in ('finance.subscription.view','finance.payer.self') and 'team' = any(valid_scopes)),
    'TO-E11 no other finance capability holds team scope: the catalogue is as 20270531 left it');

  -- =====================================================================================
  -- TO-F  PEOPLE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  select count(*) into v_n from public.team_people(v_t12) where kind = 'player' and status = 'active';
  perform pg_temp.check(v_n = 2, format('TO-F1 a Team Manager reads the roster: the two active players (%s)', v_n));
  select count(*) into v_n from public.team_people(v_t12) where kind = 'player' and status = 'requested';
  perform pg_temp.check(v_n = 1, format('TO-F2 and the one waiting to join (%s)', v_n));
  select count(*) into v_n from public.team_people(v_t12) where kind = 'guardian';
  perform pg_temp.check(v_n = 1, format('TO-F3 and the child''s parent, by name only (%s)', v_n));
  perform pg_temp.check(not exists (select 1 from pg_attribute a join pg_proc p on true
                                     where p.proname = 'team_people' and p.pronamespace = 'public'::regnamespace
                                       and a.attrelid = (select typrelid from pg_type where oid = p.prorettype)
                                       and (a.attname like '%email%' or a.attname like '%phone%' or a.attname like '%birth%' or a.attname like '%medical%')),
    'TO-F4 the roster reader carries no email, phone, date of birth or medical column');
  v_state := pg_temp.try(format('select * from public.team_people(%L)', v_t14));
  perform pg_temp.check(v_state = '42501', format('TO-F5 SIBLING TEAM: U14''s roster is refused (%s)', v_state));
  perform pg_temp.act('authenticated', v_tmb);
  v_state := pg_temp.try(format('select * from public.team_people(%L)', v_t12));
  perform pg_temp.check(v_state = '42501', format('TO-F6 OTHER CLUB: refused (%s)', v_state));
  perform pg_temp.act('authenticated', v_coach);
  v_state := pg_temp.try(format('select * from public.team_people(%L)', v_t12));
  perform pg_temp.check(v_state = 'OK', format('TO-F7 a Coach reads the roster (%s)', v_state));
  v_state := pg_temp.try(format('select public.approve_pending_team_membership(%L)', v_pending_ms));
  perform pg_temp.check(v_state = '42501', format('TO-F8 but a Coach''s crafted approval of a place request is refused: reading is not deciding (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.approve_pending_team_membership(%L)', v_pending_ms));
  perform pg_temp.check(v_state = 'OK' and (select state from public.player_team_memberships where id = v_pending_ms) = 'ACTIVE',
    format('TO-F9 a Team Manager approves it through the canonical operation (%s)', v_state));

  -- =====================================================================================
  -- TO-G  FIXTURE REQUESTS
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tmb);
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by)
  values (v_club_b, 'TO Home RUFC', v_club, current_date + 40, v_tmb) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group, v_tb, v_t12, 'either', 'sent', v_tmb) returning id into v_request;
  perform pg_temp.check(v_request is not null, 'TO-G1 another club''s Team Manager asks our U12 for a match');
  perform pg_temp.act('authenticated', v_tm);
  perform pg_temp.check(pg_temp.count_of(format('select count(*) from public.fixture_requests where target_team_id = %L and status = ''sent''', v_t12)) = 1,
    'TO-G2 the target team''s manager sees it waiting: the Needs Attention count comes from the same rows');
  perform pg_temp.act('authenticated', v_coach);
  v_state := pg_temp.try(format('select public.accept_fixture_request(%L)', v_request));
  perform pg_temp.check(v_state = '42501', format('TO-G3 a Coach may raise a request but not answer one: crafted acceptance refused (%s)', v_state));
  v_state := pg_temp.try(format('update public.fixture_requests set status = ''declined'' where id = %L', v_request));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status from public.fixture_requests where id = v_request) = 'sent',
    'TO-G4 and a crafted decline by the Coach changes nothing: the policy filters the row');
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.accept_fixture_request(%L)', v_request));
  perform pg_temp.check(v_state = 'OK' and (select status from public.fixture_requests where id = v_request) = 'accepted',
    format('TO-G5 the Team Manager accepts it through the canonical operation (%s)', v_state));

  -- =====================================================================================
  -- TO-H  MESSAGING BOUNDARIES ARE THE SERVER'S, AND THE TEAM WORKSPACE ADDS NO ROUTE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(not internal.may_direct_message(v_tmb), 'TO-H1 PARENT -> OPPOSITION: refused, even with an accepted fixture between the clubs');
  perform pg_temp.act('authenticated', v_grown);
  perform pg_temp.check(not internal.may_direct_message(v_tmb), 'TO-H2 PLAYER -> OPPOSITION: refused');
  perform pg_temp.act('authenticated', v_teen);
  perform pg_temp.check(not internal.may_direct_message(v_coach), 'TO-H3 U18 -> COACH: refused by the age boundary');
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(not internal.may_direct_message(v_teen), 'TO-H4 COACH -> MINOR: refused the same way -- the rule is symmetric');
  v_state := pg_temp.try(format('select public.open_direct_conversation(%L)', v_teen));
  perform pg_temp.check(v_state = '42501', format('TO-H5 and the operation refuses, not merely the predicate (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  perform pg_temp.check(internal.may_direct_message(v_tmb), 'TO-H6 the one legitimate cross-club route: fixture staff on opposite sides of a live fixture may message each other');

  -- =====================================================================================
  -- TO-I  AVAILABILITY: NO STAFF OVERRIDE; THE SUMMARY IS ABSENT WHERE THERE IS NO AUTHORITY
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture14, v_other_player));
  perform pg_temp.check(v_state = '42501', format('TO-I1 a Team Manager cannot answer for a player: there is no staff override on the platform (%s)', v_state));
  select count(*) into v_n from public.fixture_availability_summary(array[v_fixture14]);
  perform pg_temp.check(v_n = 0, format('TO-I2 the summary for a sibling team''s fixture is ABSENT -- not zeroes (%s rows)', v_n));
  select count(*) into v_n from public.fixture_availability_summary(array[v_fixture_b]);
  perform pg_temp.check(v_n = 0, format('TO-I3 and absent for another club''s (%s rows)', v_n));
  perform pg_temp.act('authenticated', v_parent);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture14, v_other_player));
  perform pg_temp.check(v_state = '42501', format('TO-I4 a parent cannot answer for somebody else''s child (%s)', v_state));

  perform pg_temp.act_postgres();
end $$;

rollback;
