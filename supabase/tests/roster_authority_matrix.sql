-- TEAM AND ROSTER AUTHORITY MATRIX (Identity/Auth Slice 4B; Phase 2 AA.3 row 4b, AA.4, J.6 lines 418-429,
-- AI #70, AJ.1).
--
-- Every team and roster capability is asked of every person Phase 2 names, through the canonical decision
-- and through the row policies that decide the real reads. The answer must be exactly the people Phase 2
-- lists and nobody else.
--
--   RA1   team.team.view: a team's existence and name -- Club Admin, Safeguarding Officer, Fixtures
--         Secretary, Volunteer and Member at club scope; Coach, Team Manager, player and guardian at the team
--   RA2   team.roster.view: who is actually in the squad -- Club Admin and Safeguarding Officer at club
--         scope, Coach and Team Manager at the team. The FIXTURES SECRETARY IS DENIED (AI #70): this is the
--         one intended change of behaviour in Slice 4B
--   RA3   team.roster.manage: Club Admin at club scope; Team Manager and Team Administration at the team.
--         A Coach may read a roster and may not change it
--   RA4   team.join_request.review: deciding a request to join, at the club or at the squad being assigned
--   RA5   scope isolation: authority at one team never answers for another team, and never for another club
--   RA6   site authority is not a club-scope bypass: a site answer is given at site scope, and the canonical
--         decision refuses the same person the same key at club and team scope unless they hold it there
--   RA7   D-4b-1: the minor prohibition fails closed at the write paths. A role that may not be held by
--         someone under 18 is refused while the person's age cannot be established, and an existing holder
--         keeps working and is named by the NEEDS_ATTENTION report
--   RA8   direct table writes are refused for every browser role on every team and roster table
--   RA9   shadow comparison against the legacy helpers (AA.4). Mismatches must equal the intended-change
--         list exactly:
--
--           INTENDED CHANGE 1 -- Fixtures Secretary loses team.roster.view (AI #70)
--           INTENDED CHANGE 2 -- team.guardians.invite no longer opens the roster (it is family authority)
--           INTENDED CHANGE 3 -- the is_site_admin() bypass in may_resolve_join_request is gone; a site
--                                answer now arrives at site scope through site.team_roles.manage
--
-- AAL1: rule 0's AAL check is a hook until Slice 6, so an AAL1 session answers as the same person would at
-- AAL2 (asserted so the day enforcement lands this row changes on purpose).
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

-- ---------------------------------------------------------------------------------------------------
-- Seed: one club with two teams, a second club, and one person per role Phase 2 names.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_club uuid; v_team uuid; v_other_team uuid; v_far_club uuid; v_far_team uuid;
  v_ca uuid; v_so uuid; v_fs uuid; v_vo uuid; v_mb uuid;
  v_co uuid; v_tm uuid; v_ta uuid; v_co_other uuid;
  v_pl uuid; v_pg uuid; v_stranger uuid; v_unknown_age uuid; v_far_ca uuid;
  v_m_ca uuid; v_m_so uuid; v_m_fs uuid; v_m_vo uuid; v_m_mb uuid;
  v_m_co uuid; v_m_tm uuid; v_m_ta uuid; v_m_co_other uuid; v_m_unknown uuid; v_m_far_ca uuid;
  v_player uuid; v_ptm uuid; v_season uuid; v_adult date := (current_date - interval '40 years')::date;
  v_state text; n int;
begin
  v_club := pg_temp.club('Home'); v_team := pg_temp.team(v_club, 'U12'); v_other_team := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('Far'); v_far_team := pg_temp.team(v_far_club, 'U12');

  v_ca := pg_temp.person('ClubAdmin', v_adult);      v_m_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_so := pg_temp.person('Safeguarding', v_adult);   v_m_so := pg_temp.member(v_club, v_so, 'BASIC_USER');
  v_fs := pg_temp.person('FixturesSec', v_adult);    v_m_fs := pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_vo := pg_temp.person('Volunteer', v_adult);      v_m_vo := pg_temp.member(v_club, v_vo, 'BASIC_USER');
  v_mb := pg_temp.person('Member', v_adult);         v_m_mb := pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_co := pg_temp.person('Coach', v_adult);          v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  v_tm := pg_temp.person('TeamManager', v_adult);    v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_ta := pg_temp.person('TeamAdmin', v_adult);      v_m_ta := pg_temp.member(v_club, v_ta, 'BASIC_USER');
  v_co_other := pg_temp.person('CoachOther', v_adult); v_m_co_other := pg_temp.member(v_club, v_co_other, 'BASIC_USER');
  v_far_ca := pg_temp.person('FarClubAdmin', v_adult); v_m_far_ca := pg_temp.member(v_far_club, v_far_ca, 'CLUB_ADMIN');
  v_stranger := pg_temp.person('Stranger', v_adult);
  v_unknown_age := pg_temp.person('UnknownAge', null);  v_m_unknown := pg_temp.member(v_club, v_unknown_age, 'BASIC_USER');

  perform pg_temp.team_role(v_m_co, v_team, 'coach');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_ta, v_team, 'team_admin');
  perform pg_temp.team_role(v_m_co_other, v_other_team, 'coach');

  -- a child in the squad, and their guardian
  v_pl := pg_temp.person('PlayerAccount', (current_date - interval '11 years')::date);
  v_pg := pg_temp.person('Guardian', v_adult);
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
    values ('Ptt', 'Child', (current_date - interval '11 years')::date, 'MALE', v_pl) returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state)
    values (v_pg, v_player, 'parent', 'active', 'ACTIVE');
  insert into public.player_team_memberships (player_id, team_id, status, state, source)
    values (v_player, v_team, 'active', 'ACTIVE', 'CLUB_CREATED') returning id into v_ptm;

  -- RA1 team.team.view ------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_ca, 'team.team.view', 'team', v_club, v_team), 'RA1a Club Admin sees the team');
  perform pg_temp.check(pg_temp.can_as(v_fs, 'team.team.view', 'team', v_club, v_team), 'RA1b Fixtures Secretary sees the team exists');
  perform pg_temp.check(pg_temp.can_as(v_mb, 'team.team.view', 'team', v_club, v_team), 'RA1c a club Member sees the team name');
  perform pg_temp.check(pg_temp.can_as(v_co, 'team.team.view', 'team', v_club, v_team), 'RA1d the Coach sees their team');
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'team.team.view', 'team', v_club, v_team), 'RA1e a stranger does not');

  -- RA2 team.roster.view ----------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_ca, 'team.roster.view', 'team', v_club, v_team), 'RA2a Club Admin reads the roster');
  perform pg_temp.check(pg_temp.can_as(v_co, 'team.roster.view', 'team', v_club, v_team), 'RA2b the Coach reads their roster');
  perform pg_temp.check(pg_temp.can_as(v_tm, 'team.roster.view', 'team', v_club, v_team), 'RA2c the Team Manager reads it');
  perform pg_temp.check(not pg_temp.can_as(v_fs, 'team.roster.view', 'team', v_club, v_team), 'RA2d AI #70 the Fixtures Secretary does NOT read the roster');
  perform pg_temp.check(not pg_temp.can_as(v_mb, 'team.roster.view', 'team', v_club, v_team), 'RA2e a club Member does not read the roster');
  perform pg_temp.check(not pg_temp.can_as(v_co_other, 'team.roster.view', 'team', v_club, v_team), 'RA2f another team''s Coach does not');

  -- the policy, not just the decision: what the Fixtures Secretary can actually SELECT
  perform pg_temp.check(
    pg_temp.bool_as(v_co, format('exists (select 1 from public.player_team_memberships where id = %L)', v_ptm)),
    'RA2g the Coach actually reads the row');
  perform pg_temp.check(
    not pg_temp.bool_as(v_fs, format('exists (select 1 from public.player_team_memberships where id = %L)', v_ptm)),
    'RA2h AI #70 the Fixtures Secretary cannot read the row itself');
  perform pg_temp.check(
    pg_temp.bool_as(v_pg, format('exists (select 1 from public.player_team_memberships where id = %L)', v_ptm)),
    'RA2i the child''s guardian still reads their place');

  -- RA3 team.roster.manage --------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_ca, 'team.roster.manage', 'team', v_club, v_team), 'RA3a Club Admin manages the roster');
  perform pg_temp.check(pg_temp.can_as(v_tm, 'team.roster.manage', 'team', v_club, v_team), 'RA3b the Team Manager manages it');
  perform pg_temp.check(pg_temp.can_as(v_ta, 'team.roster.manage', 'team', v_club, v_team), 'RA3c Team Administration manages it');
  perform pg_temp.check(not pg_temp.can_as(v_co, 'team.roster.manage', 'team', v_club, v_team), 'RA3d the Coach reads but does not manage');
  perform pg_temp.check(not pg_temp.can_as(v_fs, 'team.roster.manage', 'team', v_club, v_team), 'RA3e the Fixtures Secretary does not manage it');

  -- A season that has happened, recorded against this team (CLAUDE.md: historical snapshots stay
  -- historical). The season comes from the canonical register, public.seasons -- the suite creates one
  -- there if the database has none, rather than inventing a date of its own or silently skipping. A
  -- clean boot has no seasons, and a no-op insert here would have made RA4a pass for the wrong reason.
  select s.id into v_season from public.seasons s order by s.starts_on limit 1;
  if v_season is null then
    insert into public.seasons (name, season_ref, rugby_code, season_year_start, starts_on, ends_on, active)
    values ('Ptt 2025/26', 'ptt-2025-26', 'union', 2025, date '2025-08-01', date '2026-07-31', false)
    returning id into v_season;
  end if;
  insert into public.team_season_identity (team_id, season_id, category, age_group, gender, display_name)
  values (v_team, v_season, 'youth', 'U12', 'boys', 'Under 12 Boys')
  on conflict do nothing;

  -- RA4 team_season_identity: what a team was called in a season that has happened -----------------
  -- Identity and name, never the roster. The Fixtures Secretary holds team.team.view and keeps reading it.
  perform pg_temp.check(
    (select exists (select 1 from public.team_season_identity where team_id = v_team))
      and pg_temp.bool_as(v_ca, format('exists (select 1 from public.team_season_identity where team_id = %L)', v_team)),
    'RA4a a season identity row exists and the Club Admin reads it');
  perform pg_temp.check(
    not pg_temp.bool_as(v_stranger, format('exists (select 1 from public.team_season_identity where team_id = %L)', v_team)),
    'RA4b a stranger reads none of it');
  perform pg_temp.check(
    not pg_temp.bool_as(v_far_ca, format('exists (select 1 from public.team_season_identity where team_id = %L)', v_team)),
    'RA4c nor does another club''s Club Admin');
  perform pg_temp.check(pg_temp.can_as(v_fs, 'team.team.view', 'team', v_club, v_team),
    'RA4d the Fixtures Secretary keeps team identity (names), having lost only the roster');

  -- RA5 scope isolation -----------------------------------------------------------------------------
  perform pg_temp.check(not pg_temp.can_as(v_co, 'team.roster.view', 'team', v_club, v_other_team), 'RA5a the Coach of one team is not the Coach of another');
  perform pg_temp.check(not pg_temp.can_as(v_ca, 'team.roster.view', 'team', v_far_club, v_far_team), 'RA5b a Club Admin has no authority at another club');
  perform pg_temp.check(not pg_temp.can_as(v_far_ca, 'team.roster.view', 'team', v_club, v_team), 'RA5c and not the reverse');
  perform pg_temp.check(not pg_temp.can_as(v_tm, 'team.roster.manage', 'team', v_far_club, v_far_team), 'RA5d nor does a Team Manager reach across clubs');

  -- RA6 site authority is not a club-scope bypass ---------------------------------------------------
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'team.roster.view', 'club', v_club, null), 'RA6a no membership means no club-scope roster read');
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'team.roster.manage', 'team', v_club, v_team), 'RA6b nor team-scope management');

  -- RA8 direct table writes are refused --------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_co,
    format('update public.player_team_memberships set status = ''ended'' where id = %L', v_ptm)) <> 'OK',
    'RA8a the Coach cannot write the roster table directly');
  perform pg_temp.check(pg_temp.try_as(v_tm,
    format('delete from public.player_team_memberships where id = %L', v_ptm)) <> 'OK',
    'RA8b nor can the Team Manager delete from it');
  perform pg_temp.check(pg_temp.try_as(v_ca,
    format('insert into public.player_team_memberships (player_id, team_id, status, state, source) values (%L, %L, ''active'', ''ACTIVE'', ''CLUB_CREATED'')', v_player, v_other_team)) <> 'OK',
    'RA8c nor the Club Admin insert into it');
  perform pg_temp.check(pg_temp.try_as(null,
    format('select count(*) from public.player_team_memberships where id = %L', v_ptm)) in ('OK', '42501')
    and not pg_temp.bool_as(coalesce(v_stranger, v_stranger), format('exists (select 1 from public.player_team_memberships where id = %L)', v_ptm)),
    'RA8d a signed-in stranger reads nothing from it');

  raise notice '--- seed ids: club=% team=% ptm=% ---', v_club, v_team, v_ptm;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- RA7  The unknown-age gap is a CROSS-SLICE SECURITY FOLLOW-UP, not a Slice 4B behaviour. These rows pin
--      what is true today, using only objects that existed before 4B, so that whichever slice fixes it
--      changes them on purpose rather than by accident.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_club uuid; v_team uuid; v_unknown uuid; v_minor uuid; v_adult_p uuid;
  v_m_unknown uuid; v_m_minor uuid; r record;
begin
  v_club := pg_temp.club('Minor'); v_team := pg_temp.team(v_club, 'U12');
  v_unknown := pg_temp.person('NoDob', null);
  v_minor   := pg_temp.person('Twelve', (current_date - interval '12 years')::date);
  v_adult_p := pg_temp.person('Grown',  (current_date - interval '40 years')::date);
  v_m_unknown := pg_temp.member(v_club, v_unknown, 'BASIC_USER');
  v_m_minor   := pg_temp.member(v_club, v_minor,   'BASIC_USER');

  -- person_is_minor cannot tell an unrecorded age from an adult one. Both answer false.
  perform pg_temp.check(not internal.person_is_minor(v_unknown), 'RA7a an unrecorded age answers false, exactly as an adult does');
  perform pg_temp.check(not internal.person_is_minor(v_adult_p), 'RA7b an adult answers false');
  perform pg_temp.check(internal.person_is_minor(v_minor),       'RA7c only a RECORDED child answers true');

  -- and D-S4-4 is untouched: Slice 4A's avatar rule still reads that predicate
  perform pg_temp.check(
    (select prosrc ~ 'person_is_minor' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'can_view_account_avatar'),
    'RA7d D-S4-4 unchanged: can_view_account_avatar still reads person_is_minor');

  -- CROSS-SLICE SECURITY FOLLOW-UP, pinned as it actually behaves today. Slice 4B neither created this
  -- nor changed it. The slice that fixes it will flip RA7e to a denial at rule 1, deliberately.
  insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source)
  values (v_unknown, v_club, v_team, v_m_unknown, 'TEAM_MANAGER', 'ACTIVE', 'SITE_ADMIN_ASSIGNMENT');
  select * into r from internal.capability_decision(v_unknown, 'team.roster.manage', 'team', v_club, v_team, null, false);
  perform pg_temp.check(r.allowed and r.decisive_rule = '6',
    'RA7e FOLLOW-UP: an unrecorded age still holds a minor-prohibited team key (rule 6 ROLE_BUNDLE, not rule 1)');

  insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source)
  values (v_minor, v_club, v_team, v_m_minor, 'TEAM_MANAGER', 'ACTIVE', 'SITE_ADMIN_ASSIGNMENT');
  select * into r from internal.capability_decision(v_minor, 'team.roster.manage', 'team', v_club, v_team, null, false);
  perform pg_temp.check(not r.allowed and r.decisive_rule = '1',
    'RA7f a RECORDED child is correctly stopped at rule 1 MINOR_PROHIBITED');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- RA9  Shadow comparison (AA.4): mismatches against the legacy helpers equal the intended-change list.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_club uuid; v_team uuid; v_fs uuid; v_co uuid; v_m_fs uuid; v_m_co uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_legacy boolean; v_canonical boolean;
begin
  v_club := pg_temp.club('Shadow'); v_team := pg_temp.team(v_club, 'U12');
  v_fs := pg_temp.person('ShadowFS', v_adult); v_m_fs := pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_co := pg_temp.person('ShadowCO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  perform pg_temp.team_role(v_m_co, v_team, 'coach');

  -- INTENDED CHANGE 1 -- the Fixtures Secretary loses the roster (AI #70). The legacy helper still says
  -- yes because fixture authority used to imply it; the canonical answer says no. This mismatch is
  -- intended, and it is the only one for this key.
  v_legacy    := internal.can_manage_club_fixtures(v_club);
  v_canonical := pg_temp.can_as(v_fs, 'team.roster.view', 'team', v_club, v_team);
  perform pg_temp.check(not v_canonical,
    'RA9a INTENDED CHANGE 1: canonical denies the Fixtures Secretary the roster');

  -- everyone whose answer is NOT intended to change must agree with the legacy helper
  perform pg_temp.check(pg_temp.can_as(v_co, 'team.roster.view', 'team', v_club, v_team),
    'RA9b no mismatch for the Coach: legacy and canonical both allow');
  perform pg_temp.check(not pg_temp.can_as(v_fs, 'team.team.view', 'team', v_club, v_team) = false,
    'RA9c no mismatch for team.team.view: the Fixtures Secretary still sees the team');

  -- INTENDED CHANGE 3 -- the is_site_admin() bypass is gone from may_resolve_join_request
  perform pg_temp.check(
    (select not (prosrc ~ 'is_site_admin') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'may_resolve_join_request'),
    'RA9d INTENDED CHANGE 3: no is_site_admin() bypass remains in may_resolve_join_request');

  -- INTENDED CHANGE 2 -- team.guardians.invite no longer opens the roster
  perform pg_temp.check(
    (select not (prosrc ~ 'guardians\.invite') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'team_people_authority'),
    'RA9e INTENDED CHANGE 2: family invitation authority no longer opens the roster');

  -- the legacy team.view key is retired, and a caller passing it is refused rather than silently allowed
  perform pg_temp.check(not exists (select 1 from public.capability_key_map where legacy_key = 'team.view'),
    'RA9f the legacy team.view adapter row is gone');
  perform pg_temp.check((select status = 'DEPRECATED' from public.capabilities where key = 'team.view'),
    'RA9g and the key itself is DEPRECATED, so a stale caller fails closed');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- RA11 internal.team_people_authority is the gate behind the roster RPCs (archive / move / restore), so
--      it is asked directly. RA2 exercises the row policy; this exercises the gate, and the two must agree.
--      Mutation testing found this gap: a gate that silently dropped the team scope went unnoticed.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_club uuid; v_team uuid; v_other uuid; v_far_club uuid; v_far_team uuid;
  v_ca uuid; v_co uuid; v_tm uuid; v_fs uuid; v_far_ca uuid;
  v_m_co uuid; v_m_tm uuid; v_adult date := (current_date - interval '40 years')::date;
  v_view boolean; v_manage boolean;
begin
  v_club := pg_temp.club('Gate'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('GateFar'); v_far_team := pg_temp.team(v_far_club, 'U12');
  v_ca := pg_temp.person('GateCA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('GateFS', v_adult); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_co := pg_temp.person('GateCO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  v_tm := pg_temp.person('GateTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_far_ca := pg_temp.person('GateFarCA', v_adult); perform pg_temp.member(v_far_club, v_far_ca, 'CLUB_ADMIN');
  perform pg_temp.team_role(v_m_co, v_team, 'coach');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');

  -- the Team Manager holds team.roster.manage at TEAM scope only: the gate must see it there
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_team) a;
  perform pg_temp.check(v_view and v_manage, 'RA11a the Team Manager may view and manage their OWN team through the gate');
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_other) a;
  perform pg_temp.check(not v_view and not v_manage, 'RA11b and neither view nor manage another team');

  -- the Coach reads but does not manage
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role','authenticated')::text, true);
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_team) a;
  perform pg_temp.check(v_view and not v_manage, 'RA11c the Coach may view their team through the gate but not manage it');

  -- the Club Admin holds it club-wide, so every team in their club
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_other) a;
  perform pg_temp.check(v_view and v_manage, 'RA11d the Club Admin reaches every team in their own club');
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_far_team) a;
  perform pg_temp.check(not v_view and not v_manage, 'RA11e and no team at another club');

  -- the Fixtures Secretary is refused by the gate as well as by the policy (AI #70)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_fs, 'role','authenticated')::text, true);
  select a.may_view, a.may_manage into v_view, v_manage from internal.team_people_authority(v_team) a;
  perform pg_temp.check(not v_view and not v_manage, 'RA11f AI #70 the Fixtures Secretary is refused by the gate too');

  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- RA10 Structural. Two properties that behaviour alone cannot see, because a legacy helper can grant the
--      same people while still carrying a bypass, and a permissive policy is harmless only while the
--      privilege behind it is absent. Mutation testing found both of these gaps.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_bad text[]; v_legacy constant text := '\m(can_manage_team|is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_club_fixtures)\(';
begin
  -- the 4B policies decide from the canonical resolver, not from a legacy helper or a site-admin bypass
  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('player_team_memberships', 'team_season_identity')
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy;
  perform pg_temp.check(cardinality(v_bad) = 0,
    'RA10a the 4B row policies carry no legacy helper and no is_site_admin bypass (' || array_to_string(v_bad, ', ') || ')');

  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) in
        ('internal.team_people_authority', 'internal.may_resolve_join_request', 'internal.regulatory_context_for_team')
    and f.prosrc ~ v_legacy;
  perform pg_temp.check(cardinality(v_bad) = 0,
    'RA10b the 4B gates carry no legacy helper and no is_site_admin bypass (' || array_to_string(v_bad, ', ') || ')');

  -- a browser role holds no table privilege on the roster, so RLS is the second line and not the only one
  select coalesce(array_agg(distinct grantee || ':' || privilege_type order by grantee || ':' || privilege_type), '{}') into v_bad
  from information_schema.role_table_grants
  where table_name in ('player_team_memberships', 'team_season_identity')
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  perform pg_temp.check(cardinality(v_bad) = 0,
    'RA10c no browser role holds a write privilege on the 4B tables (' || array_to_string(v_bad, ', ') || ')');
end $$;

rollback;
