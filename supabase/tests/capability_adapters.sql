-- CLUB HOME AND FIXTURE ADAPTERS OVER THE CANONICAL RESOLVER (Identity/Auth Slice 3, brief sections 29-30).
--
-- The Club Home content boundary (may_edit_club_content, may_publish_club_content,
-- may_view_club_member_content) and the fixture boundary (can_bulk_plan_fixtures, can_create_team_fixture)
-- keep their signatures and now ask the canonical resolver.
--
--   CH1-CH9  Club Admin club-wide; Coach and Team Manager their own team only; a member reads but never
--            edits; no cross-team or cross-club reach; suspension and revocation end it; a parent reads their
--            child's team content only; anonymous and non-member Site Admins get nothing
--   FA1-FA8  bulk planning (Planner, Import, Competition Creator, bulk edit) is Club Admin, Fixtures Secretary
--            or explicit Ovalball fixture support -- never team staff, whatever else they hold; a single team
--            fixture is the team's own staff or club authority; fixture.create is not fixture.import; a withhold
--            on bulk planning leaves single fixtures alone and the reverse
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ptt-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Ptt', p_label, 'ptt-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PTT ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ptt-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ptt-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'ptt-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true) returning id into v;
  return v;
end $$;

-- A legacy membership row; the Slice 2 triggers create the canonical membership state and role.
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text) returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership, p_team, p_permission);
end $$;

create or replace function pg_temp.override(p_user uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_effect text, p_level text,
                                            p_by uuid, p_expires timestamptz default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, expires_at, reason)
  values (p_user, p_key, p_scope, p_club, p_team, p_effect, 'active', p_by, p_level, p_expires, 'truth table')
  returning id into v;
  return v;
end $$;

-- The decision for a subject, evaluated as that subject's own request (rule 0 applies).
create or replace function pg_temp.decide(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns table (allowed boolean, decisive_rule text, reason_code text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  return query select d.allowed, d.decisive_rule, d.reason_code
    from internal.capability_decision(p_subject, p_key, p_scope, p_club, p_team, p_player, true, false) d;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- What internal.can says for the same question, run as the browser role.
create or replace function pg_temp.can_as(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  perform set_config('role', 'authenticated', true);
  v := internal.can(p_key, p_scope, p_club, p_team, p_player);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- Runs one statement as a signed-in person (the browser role) and returns OK or the SQLSTATE.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_subject, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

-- Evaluates a boolean expression as a signed-in person.
create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select (' || p_expr || ')::boolean' into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v, false);
end $$;

grant execute on function pg_temp.can_as(uuid, text, text, uuid, uuid, uuid, jsonb) to public;

do $body$
declare
  v_club uuid; v_club_b uuid; v_team uuid; v_team2 uuid; v_team_b uuid;
  v_ca uuid; v_ca_ms uuid; v_tm uuid; v_tm_ms uuid; v_co uuid; v_co_ms uuid; v_member uuid; v_parent uuid; v_child uuid;
  v_fs uuid; v_full uuid; v_ops uuid; v_ro uuid; v_ca2 uuid; v_ra uuid; v_state text;
begin
  v_club := pg_temp.club('Adapters'); v_club_b := pg_temp.club('Adapters B');
  v_team := pg_temp.team(v_club); v_team2 := pg_temp.team(v_club, 'U14'); v_team_b := pg_temp.team(v_club_b);
  v_ca := pg_temp.person('CA'); v_ca_ms := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ca2 := pg_temp.person('CA2'); perform pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TM'); v_tm_ms := pg_temp.member(v_club, v_tm); perform pg_temp.team_role(v_tm_ms, v_team, 'manager');
  v_co := pg_temp.person('CO'); v_co_ms := pg_temp.member(v_club, v_co); perform pg_temp.team_role(v_co_ms, v_team, 'coach');
  v_member := pg_temp.person('Member'); perform pg_temp.member(v_club, v_member);
  v_fs := pg_temp.person('FS'); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_parent := pg_temp.person('Parent');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Ad', 'Child', (current_date - interval '10 years')::date, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_parent, v_child, 'parent', 'active');
  v_full := pg_temp.person('Full'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_ops := pg_temp.person('Ops'); insert into public.site_admins (user_id, status, admin_role) values (v_ops, 'active', 'fixture_ops');
  v_ro := pg_temp.person('RO'); insert into public.site_admins (user_id, status, admin_role) values (v_ro, 'active', 'read_only');

  -- Club Home
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.may_edit_club_content(%L, null)', v_club))
                        and pg_temp.bool_as(v_ca, format('internal.may_publish_club_content(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_ca, format('internal.may_edit_club_content(%L, null)', v_club_b))
                        and not pg_temp.bool_as(v_ca, format('internal.may_edit_club_content(%L, %L)', v_club, v_team_b)),
    'CH1: a Club Admin edits and publishes club and team content at their club only; a foreign team named under it gives nothing');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.may_edit_club_content(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_tm, format('internal.may_edit_club_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_tm, format('internal.may_edit_club_content(%L, %L)', v_club, v_team2)),
    'CH2: a Team Manager edits their own team''s content, not the club''s and not another team''s');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.may_publish_club_content(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_co, format('internal.may_publish_club_content(%L, %L)', v_club_b, v_team_b)),
    'CH3: a Coach publishes their own team''s content only');
  perform pg_temp.check(not pg_temp.bool_as(v_member, format('internal.may_edit_club_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_member, format('internal.may_edit_club_content(%L, %L)', v_club, v_team))
                        and pg_temp.bool_as(v_member, format('internal.may_view_club_member_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_member, format('internal.may_view_club_member_content(%L, null)', v_club_b)),
    'CH4: an ordinary member reads their club''s member content and edits nothing');
  perform pg_temp.check(pg_temp.bool_as(v_parent, format('internal.may_view_club_member_content(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_parent, format('internal.may_view_club_member_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_parent, format('internal.may_view_club_member_content(%L, %L)', v_club, v_team2))
                        and not pg_temp.bool_as(v_parent, format('internal.may_edit_club_content(%L, %L)', v_club, v_team)),
    'CH5: a parent reads their child''s team content (J.5 team.team.view), not club-wide or another team''s, and edits nothing');
  v_state := pg_temp.try_as(v_ca2, format('select public.transition_club_membership(%L, ''SUSPENDED'', ''adapter suite'')', v_ca_ms));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.bool_as(v_ca, format('internal.may_edit_club_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_ca, format('internal.may_view_club_member_content(%L, null)', v_club)),
    'CH6: a suspended Club Admin edits and reads nothing (' || v_state || ')');
  select id into v_ra from public.role_assignments where membership_id = v_tm_ms and role_key = 'TEAM_MANAGER' and state = 'ACTIVE';
  v_state := pg_temp.try_as(v_ca2, format('select public.transition_role_assignment(%L, ''REVOKED'', ''adapter suite'')', v_ra));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.bool_as(v_tm, format('internal.may_edit_club_content(%L, %L)', v_club, v_team)),
    'CH7: a revoked Team Manager edits nothing (' || v_state || ')');
  perform pg_temp.check(not pg_temp.bool_as(v_full, format('internal.may_edit_club_content(%L, null)', v_club))
                        and not pg_temp.bool_as(v_full, format('internal.may_view_club_member_content(%L, null)', v_club)),
    'CH8: a Site Admin who is not a member has no club content authority (no club bypass)');
  v_state := pg_temp.try_as(null, format('do $a$ begin if internal.may_view_club_member_content(%L, null) then raise exception ''visible'' using errcode = ''P0001''; end if; end $a$', v_club));
  perform pg_temp.check(v_state in ('OK', '42501'), 'CH9: anonymous readers see no member content (' || v_state || ')');

  -- Fixtures
  perform pg_temp.check(pg_temp.bool_as(v_ca2, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and pg_temp.bool_as(v_fs, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and not pg_temp.bool_as(v_fs, format('internal.can_bulk_plan_fixtures(%L)', v_club_b)),
    'FA1: Club Admin and Fixtures Secretary plan in bulk at their own club only');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and not pg_temp.can_as(v_co, 'fixture.planner.use', 'club', v_club)
                        and not pg_temp.can_as(v_co, 'fixture.import.run', 'club', v_club)
                        and not pg_temp.can_as(v_co, 'competition.creator.use', 'club', v_club)
                        and not pg_temp.bool_as(v_co, format('internal.has_capability(''fixture.import'', ''club'', %L::uuid, null)', v_club))
                        and not pg_temp.bool_as(v_co, format('internal.has_capability(''fixture.bulk_edit'', ''team'', %L::uuid, %L::uuid)', v_club, v_team)),
    'FA2: team staff get no Planner, Import, Competition Creator or bulk edit, by canonical or legacy key');
  v_tm := pg_temp.person('TM everywhere'); v_tm_ms := pg_temp.member(v_club, v_tm);
  perform pg_temp.team_role(v_tm_ms, v_team, 'team_admin'); perform pg_temp.team_role(v_tm_ms, v_team2, 'manager');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and pg_temp.bool_as(v_tm, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team)),
    'FA3: running every team (with Team Administration) still gives single fixtures only, never bulk');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_co, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team2))
                        and pg_temp.bool_as(v_fs, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team2))
                        and not pg_temp.bool_as(v_member, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team)),
    'FA4: a single team fixture is the team''s own staff or club fixture authority; never a member');
  perform pg_temp.check(pg_temp.bool_as(v_full, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and pg_temp.bool_as(v_ops, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and pg_temp.bool_as(v_full, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team))
                        and not pg_temp.bool_as(v_ro, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and not pg_temp.bool_as(v_ro, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team)),
    'FA5: Ovalball fixture support (Full, Fixture Operations) plans through the explicit site capability; Read Only does not');
  perform pg_temp.override(v_fs, 'fixture.planner.use', 'club', v_club, null, 'deny', 'CLUB', v_ca2);
  perform pg_temp.check(not pg_temp.bool_as(v_fs, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and pg_temp.bool_as(v_fs, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team)),
    'FA6: withholding bulk planning leaves single fixtures in place');
  v_fs := pg_temp.person('FS2'); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_fs, 'fixture.fixture.create', 'club', v_club, null, 'deny', 'CLUB', v_ca2);
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                        and not pg_temp.bool_as(v_fs, format('internal.can_create_team_fixture(%L, %L)', v_club, v_team)),
    'FA7: and withholding fixture.create leaves bulk planning in place: fixture.create is not fixture.import');
  perform pg_temp.check(not exists (select 1 from public.bundle_capabilities b
      where b.bundle_key in ('CO', 'TM', 'TA', 'VO', 'PL', 'PG', 'MB', 'SELF')
        and b.capability_key in ('fixture.planner.use', 'fixture.import.run', 'competition.creator.use', 'fixture.fixture.bulk_edit')),
    'FA8: no team or relationship bundle holds a bulk fixture capability');
end $body$;

rollback;
