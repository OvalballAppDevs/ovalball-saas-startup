-- CAPABILITY SCOPE ISOLATION AND MULTI-ROLE RESOLUTION (Identity/Auth Slice 3, brief sections 32-37).
--
-- One human, one identity, many legitimate contexts. Authority is resolved for the action and the scope
-- asked about, never from a "current role", and never carried from one scope into another.
--
--   SI1   Club Admin at Club A and Player at Club B: each authority works only in its own scope
--   SI2   Coach of Team A and Parent of a child in Team B: team, family and club scopes stay separate
--   SI3   one identity holding Site authority, Club Admin, Coach, Player and Parent/Guardian at once
--   SI4   the scope is the only input: the same person gets different answers per scope, and no context
--         selection exists in the decision (the interface's context cookie cannot reach it)
--   SI5   membership SUSPENDED / restored / REVOKED / re-admitted: authority follows the state immediately
--   SI6   role SUSPENDED / REVOKED: immediate
--   SI7   team place ended: the player's team authority ends; another team's place is unaffected
--   SI8   family: PENDING_APPROVAL and SUSPENDED give nothing; ACTIVE gives the child's scope only;
--         REVOKED ends it; nothing is inferred from surname, club membership, player creation or coaching
--   SI9   a Site Admin is not a member: no club, team or family authority from the site profile
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
  v_club_a uuid; v_club_b uuid; v_club_c uuid; v_team_a uuid; v_team_a2 uuid; v_team_b uuid; v_team_c uuid;
  v_ca_c uuid;
  v_p uuid; v_ms uuid; v_ms2 uuid; v_player uuid; v_ptm uuid; v_ptm2 uuid; v_child uuid; v_child2 uuid; v_g uuid; v_rel uuid;
  v_multi uuid; v_full uuid; v_ra uuid; v_state text;
begin
  v_club_a := pg_temp.club('Iso A'); v_club_b := pg_temp.club('Iso B'); v_club_c := pg_temp.club('Iso C');
  v_team_a := pg_temp.team(v_club_a); v_team_a2 := pg_temp.team(v_club_a, 'U14'); v_team_b := pg_temp.team(v_club_b); v_team_c := pg_temp.team(v_club_c);
  v_ca_c := pg_temp.person('CA of C'); perform pg_temp.member(v_club_c, v_ca_c, 'CLUB_ADMIN');
  v_full := pg_temp.person('Full'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');

  -- SI1: Club Admin at A, adult Player at B
  v_p := pg_temp.person('SI1'); perform pg_temp.member(v_club_a, v_p, 'CLUB_ADMIN');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Iso', 'Adult', (current_date - interval '30 years')::date, 'MALE', v_p) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team_b, 'active');
  perform pg_temp.check(pg_temp.can_as(v_p, 'finance.payment.act', 'club', v_club_a)
                        and pg_temp.can_as(v_p, 'fixture.fixture.edit', 'team', v_club_a, v_team_a)
                        and not pg_temp.can_as(v_p, 'finance.payment.act', 'club', v_club_b)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.edit', 'club', v_club_b)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.edit', 'team', v_club_b, v_team_b)
                        and not pg_temp.can_as(v_p, 'team.roster.view', 'team', v_club_b, v_team_b),
    'SI1a: Club A admin authority works at Club A and not at Club B, not even on the team they play for');
  perform pg_temp.check(pg_temp.can_as(v_p, 'fixture.fixture.view', 'team', v_club_b, v_team_b)
                        and pg_temp.can_as(v_p, 'matchcentre.attendance.respond', 'self', null, null, v_player)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.view', 'team', v_club_b, (select id from public.teams where club_id = v_club_b and id <> v_team_b limit 1))
                        and not pg_temp.bool_as(v_p, format('internal.has_capability(''club.profile.edit'', ''club'', %L::uuid, null)', v_club_b)),
    'SI1b: their player authority works in their Club B player scope only');

  -- SI2: Coach of Team A, Parent of a child in Team C (another club)
  v_p := pg_temp.person('SI2'); v_ms := pg_temp.member(v_club_a, v_p); perform pg_temp.team_role(v_ms, v_team_a, 'coach');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Iso', 'Child C', (current_date - interval '9 years')::date, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_team_c, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_p, v_child, 'parent', 'active');
  perform pg_temp.check(pg_temp.can_as(v_p, 'fixture.fixture.create', 'team', v_club_a, v_team_a)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.create', 'team', v_club_c, v_team_c)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.create', 'team', v_club_a, v_team_a2)
                        and not pg_temp.can_as(v_p, 'team.roster.view', 'team', v_club_c, v_team_c),
    'SI2a: coaching authority stays on the coached team: not the child''s team, not another team at the same club');
  perform pg_temp.check(pg_temp.can_as(v_p, 'matchcentre.attendance.respond', 'child', null, null, v_child)
                        and pg_temp.can_as(v_p, 'team.team.view', 'team', v_club_c, v_team_c)
                        and not pg_temp.can_as(v_p, 'people.member.view', 'club', v_club_c)
                        and not pg_temp.can_as(v_p, 'club.profile.view', 'club', v_club_c),
    'SI2b: parental authority covers the child and the child''s team view, never Club C membership authority');

  -- SI3: one identity, five legitimate roles
  v_multi := pg_temp.person('SI3 Multi');
  insert into public.site_admins (user_id, status, admin_role) values (v_multi, 'active', 'club_data');
  perform pg_temp.member(v_club_a, v_multi, 'CLUB_ADMIN');
  v_ms := pg_temp.member(v_club_b, v_multi); perform pg_temp.team_role(v_ms, v_team_b, 'coach');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Iso', 'Multi', (current_date - interval '28 years')::date, 'MALE', v_multi) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team_c, 'active');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Iso', 'Multi Child', (current_date - interval '8 years')::date, 'MALE') returning id into v_child2;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child2, v_team_a2, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_multi, v_child2, 'guardian', 'active');
  perform pg_temp.check(
        pg_temp.can_as(v_multi, 'site.clubs.profile.manage', 'site')            -- site (Club Data profile)
    and not pg_temp.can_as(v_multi, 'site.admins.manage', 'site')
    and pg_temp.can_as(v_multi, 'people.role.assign_club', 'club', v_club_a)      -- Club Admin, A
    and not pg_temp.can_as(v_multi, 'people.role.assign_club', 'club', v_club_b)
    and pg_temp.can_as(v_multi, 'training.plan.manage', 'team', v_club_b, v_team_b) -- Coach, B
    and not pg_temp.can_as(v_multi, 'training.plan.manage', 'club', v_club_b)
    and pg_temp.can_as(v_multi, 'fixture.fixture.view', 'team', v_club_c, v_team_c) -- Player, C
    and not pg_temp.can_as(v_multi, 'fixture.fixture.edit', 'team', v_club_c, v_team_c)
    and pg_temp.can_as(v_multi, 'player.profile.edit', 'child', null, null, v_child2) -- Guardian
    and pg_temp.can_as(v_multi, 'fixture.fixture.edit', 'team', v_club_a, v_team_a2)  -- (Club Admin of the child's club, by club authority)
    and not pg_temp.can_as(v_multi, 'site.clubs.profile.manage', 'club', v_club_b),
    'SI3: one identity resolves each of site, Club Admin, Coach, Player and Guardian authority independently per scope');
  perform pg_temp.check(
    (select count(*) from internal.capability_decision(v_multi, 'fixture.fixture.edit', 'club', v_club_a, null, null, false, false) d where d.allowed and d.decisive_source ->> 'role_key' = 'CLUB_ADMIN') = 1
    and (select d.decisive_source ->> 'kind' from internal.capability_decision(v_multi, 'fixture.fixture.view', 'team', v_club_c, v_team_c, null, false, false) d) = 'PLAYER'
    and (select d.decisive_source ->> 'kind' from internal.capability_decision(v_multi, 'player.profile.edit', 'child', null, null, v_child2, false, false) d) = 'GUARDIAN'
    and (select d.decisive_source ->> 'kind' from internal.capability_decision(v_multi, 'site.clubs.profile.manage', 'site', null, null, null, false, false) d) = 'SITE_PROFILE',
    'SI3b: each answer names the relationship it came from');

  -- SI4: the decision has no context input
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'internal' and p.proname in ('capability_decision', 'bundle_source', 'can', 'has_capability')
                  and (p.prosrc ~* 'ovalball_ctx|active_context|current_setting\(''request\.cookies' or p.prosrc ~* 'request\.headers'))
    and pg_temp.bool_as(v_multi, format('(select allowed from public.my_capabilities(''club'', %L::uuid) where capability_key = ''people.role.assign_club'')', v_club_a))
    and not pg_temp.bool_as(v_multi, format('coalesce((select allowed from public.my_capabilities(''club'', %L::uuid) where capability_key = ''people.role.assign_club''), false)', v_club_b)),
    'SI4: the decision reads no context cookie or header; my_capabilities differs only by the scope asked');

  -- SI5: membership state, immediately
  v_p := pg_temp.person('SI5'); v_ms := pg_temp.member(v_club_c, v_p, 'FIXTURE_SECRETARY');
  perform pg_temp.check(pg_temp.can_as(v_p, 'fixture.planner.use', 'club', v_club_c), 'SI5a: active Fixtures Secretary plans fixtures');
  v_state := pg_temp.try_as(v_ca_c, format('select public.transition_club_membership(%L, ''SUSPENDED'', ''isolation suite'')', v_ms));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.can_as(v_p, 'fixture.planner.use', 'club', v_club_c)
                        and not pg_temp.can_as(v_p, 'fixture.fixture.view', 'team', v_club_c, v_team_c),
    'SI5b: suspending the membership removes authority on the next decision (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca_c, format('select public.transition_club_membership(%L, ''ACTIVE'', ''isolation suite'')', v_ms));
  perform pg_temp.check(v_state = 'OK' and pg_temp.can_as(v_p, 'fixture.planner.use', 'club', v_club_c), 'SI5c: restoring it restores authority (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca_c, format('select public.transition_club_membership(%L, ''REVOKED'', ''isolation suite'')', v_ms));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.can_as(v_p, 'fixture.planner.use', 'club', v_club_c)
    and (select reason_code from internal.capability_decision(v_p, 'fixture.planner.use', 'club', v_club_c, null, null, false, false)) = 'MEMBERSHIP_INACTIVE',
    'SI5d: revoking it removes authority, explained as MEMBERSHIP_INACTIVE (' || v_state || ')');
  v_state := pg_temp.try_as(v_full, format('select public.grant_club_membership(%L, %L, ''isolation suite readmission'')', v_club_c, v_p));
  perform pg_temp.check(not pg_temp.can_as(v_p, 'fixture.planner.use', 'club', v_club_c) and pg_temp.can_as(v_p, 'club.profile.view', 'club', v_club_c),
    'SI5e: re-admission creates new history: a Member again, not the old Fixtures Secretary (' || v_state || ')');

  -- SI6: role state, immediately
  v_p := pg_temp.person('SI6'); v_ms := pg_temp.member(v_club_c, v_p); perform pg_temp.team_role(v_ms, v_team_c, 'manager');
  select id into v_ra from public.role_assignments where membership_id = v_ms and role_key = 'TEAM_MANAGER' and state = 'ACTIVE';
  perform pg_temp.check(pg_temp.can_as(v_p, 'team.roster.manage', 'team', v_club_c, v_team_c), 'SI6a: active Team Manager manages the roster');
  v_state := pg_temp.try_as(v_ca_c, format('select public.transition_role_assignment(%L, ''SUSPENDED'', ''isolation suite'')', v_ra));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.can_as(v_p, 'team.roster.manage', 'team', v_club_c, v_team_c)
                        and pg_temp.can_as(v_p, 'club.profile.view', 'club', v_club_c),
    'SI6b: suspending the role removes its authority at once and leaves membership authority (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca_c, format('select public.transition_role_assignment(%L, ''REVOKED'', ''isolation suite'')', v_ra));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.can_as(v_p, 'team.roster.manage', 'team', v_club_c, v_team_c), 'SI6c: revoked stays gone (' || v_state || ')');

  -- SI7: team place ended
  v_p := pg_temp.person('SI7');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Iso', 'Mover', (current_date - interval '24 years')::date, 'MALE', v_p) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team_a, 'active') returning id into v_ptm;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team_a2, 'active') returning id into v_ptm2;
  update public.player_team_memberships set state = 'ENDED', status = 'ended', ended_at = now() where id = v_ptm;
  perform pg_temp.check(not pg_temp.can_as(v_p, 'fixture.fixture.view', 'team', v_club_a, v_team_a)
                        and pg_temp.can_as(v_p, 'fixture.fixture.view', 'team', v_club_a, v_team_a2),
    'SI7: an ended team place ends that team''s player authority and leaves the other place alone');

  -- SI8: family states
  v_g := pg_temp.person('SI8 Guardian');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by) values ('Iso', 'Family', (current_date - interval '7 years')::date, 'MALE', v_g) returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_team_c, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_g, v_child, 'parent', 'pending') returning id into v_rel;
  perform pg_temp.check(not pg_temp.can_as(v_g, 'player.profile.edit', 'child', null, null, v_child)
                        and not pg_temp.can_as(v_g, 'team.team.view', 'team', v_club_c, v_team_c),
    'SI8a: a PENDING_APPROVAL relationship gives nothing (creating the player does not make them its guardian)');
  update public.guardians set state = 'ACTIVE', status = 'active' where id = v_rel;
  perform pg_temp.check(pg_temp.can_as(v_g, 'player.profile.edit', 'child', null, null, v_child), 'SI8b: ACTIVE gives the child''s scope');
  update public.guardians set state = 'SUSPENDED', status = 'suspended', suspended_at = now(), suspended_by = v_ca_c, suspension_reason = 'hold' where id = v_rel;
  perform pg_temp.check(not pg_temp.can_as(v_g, 'player.profile.edit', 'child', null, null, v_child), 'SI8c: a held (SUSPENDED) relationship gives nothing');
  update public.guardians set state = 'REVOKED', status = 'revoked', revoked_at = now(), revoked_by = v_ca_c, revocation_reason = 'ended' where id = v_rel;
  perform pg_temp.check(not pg_temp.can_as(v_g, 'player.profile.edit', 'child', null, null, v_child)
                        and not pg_temp.can_as(v_g, 'team.team.view', 'team', v_club_c, v_team_c),
    'SI8d: REVOKED ends it everywhere');
  -- nothing inferred: same surname, same club membership, coaching the child's team
  v_p := pg_temp.person('Family');
  v_ms := pg_temp.member(v_club_c, v_p); perform pg_temp.team_role(v_ms, v_team_c, 'coach');
  perform pg_temp.check(not pg_temp.can_as(v_p, 'player.profile.edit', 'child', null, null, v_child)
                        and not pg_temp.can_as(v_p, 'matchcentre.attendance.respond', 'child', null, null, v_child)
                        and not pg_temp.can_as(v_ca_c, 'player.profile.edit', 'child', null, null, v_child),
    'SI8e: no family authority from a matching surname, club membership, coaching the team or being Club Admin');

  -- SI9
  perform pg_temp.check(not pg_temp.can_as(v_full, 'club.profile.view', 'club', v_club_a)
                        and not pg_temp.can_as(v_full, 'fixture.fixture.view', 'team', v_club_a, v_team_a)
                        and not pg_temp.can_as(v_full, 'player.profile.edit', 'child', null, null, v_child2)
                        and pg_temp.can_as(v_full, 'site.clubs.view', 'site'),
    'SI9: a Full Site Admin who is not a member holds no club, team or family authority');
end $body$;

rollback;
