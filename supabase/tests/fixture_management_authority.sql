-- Fixture Management authority and the bounded competition-options view
-- (20270271000000).
--
-- Two things are proved here. First, that the new fixture.import and
-- fixture.bulk_edit capabilities resolve through the SAME canonical engine
-- every other capability uses -- site/club/team scope, role defaults, and
-- per-user overrides -- rather than becoming a second permission system
-- bolted onto the planner. Second, that the club ceiling and the Site
-- ceiling behave the way the delegation product promises.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_management_authority.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_coach uuid;
  v_other uuid;
  v_club uuid;
  n integer;
begin
  select id into v_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_coach from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_other from auth.users where email = 'uat.team.manager@ovalball.test';
  select club_id into v_club from public.club_memberships
  where user_id = v_coach and status = 'active' limit 1;

  if v_admin is null or v_coach is null or v_other is null or v_club is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- =================================================================
  -- 1. THE CAPABILITIES EXIST AND ARE SCOPED HONESTLY
  -- Import is a club-wide act, so it is never a team-scope capability;
  -- bulk editing is the batched form of an edit a team role already has.
  -- =================================================================
  select count(*) into n from public.capabilities
  where key in ('fixture.import', 'fixture.bulk_edit', 'people.capability.manage');
  if n = 3 then
    raise notice 'PASS 1: the three fixture-management capabilities are registered';
  else
    raise notice 'FAIL 1: expected 3 capabilities, found %', n;
  end if;

  if not ('team' = any (select unnest(applicable_scopes) from public.capabilities where key = 'fixture.import')) then
    raise notice 'PASS 2: fixture.import is not offered at team scope -- importing a season is club-wide';
  else
    raise notice 'FAIL 2: fixture.import is grantable at team scope';
  end if;

  -- =================================================================
  -- 3. CURRENT ACCESS IS PRESERVED
  -- The roles that could already import (the only club-wide fixture
  -- authorities) must still be able to, or this migration is a silent
  -- removal of an ability somebody had this morning.
  -- =================================================================
  select count(*) into n from public.role_capability_defaults
  where scope_type = 'club' and capability_key = 'fixture.import'
    and role_key in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  if n = 2 then
    raise notice 'PASS 3: Club Admin and Fixture Secretary keep the import authority they already had';
  else
    raise notice 'FAIL 3: only % of the two club-wide roles can import', n;
  end if;

  -- =================================================================
  -- 4. A CLUB MAY WITHHOLD IT FROM AN INDIVIDUAL
  -- This is the whole point of the delegation product: a role is a
  -- starting position, not the final answer.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if internal.has_capability('fixture.create', 'club', v_club, null) then
    raise notice 'PASS 4: the club fixture authority resolves before any override';
  else
    raise notice 'FAIL 4: this identity cannot create fixtures at all -- the rest of the suite is meaningless';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_capability_override(
    v_coach, 'fixture.import', 'club', v_club, null, 'deny', 'automated coverage'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if not internal.has_capability('fixture.import', 'club', v_club, null) then
    raise notice 'PASS 5: a deny override withholds importing from one person without touching their other authority';
  else
    raise notice 'FAIL 5: a deny override did not take effect';
  end if;

  -- 6. AND IT IS SURGICAL. Withholding import must not quietly remove the
  -- ordinary fixture editing the same person does every week.
  if internal.has_capability('fixture.edit', 'club', v_club, null) then
    raise notice 'PASS 6: withholding import leaves ordinary fixture editing intact';
  else
    raise notice 'FAIL 6: denying import also removed unrelated fixture authority';
  end if;

  -- =================================================================
  -- 7. THE COMPETITION-OPTIONS VIEW IS BOUNDED AND HONEST
  -- It must return one row per edition IN USE -- never one per fixture,
  -- which is the unbounded read it replaced.
  -- =================================================================
  select count(*) into n from public.fixture_competition_edition_usage;
  if n <= (select count(*) from public.competition_editions) then
    raise notice 'PASS 7: the view returns at most one row per competition edition (%), not one per fixture', n;
  else
    raise notice 'FAIL 7: the view returned % rows -- more than there are editions', n;
  end if;

  if not exists (
    select 1 from public.fixture_competition_edition_usage u
    where not exists (select 1 from public.fixtures f where f.competition_edition_id = u.competition_edition_id)
  ) then
    raise notice 'PASS 8: every edition the filter offers is one a fixture actually uses';
  else
    raise notice 'FAIL 8: the filter offers an edition no fixture uses';
  end if;

  -- =================================================================
  -- 9-13. A CLUB MAY DELEGATE ITS OWN OPERATIONS, AND ONLY THOSE
  --
  -- set_capability_override was Site-Admin-only, so the delegation the
  -- product promises ("this coach may run training but not fixtures") was
  -- a decision no club could actually make. Widening the caller is only
  -- safe while these boundaries hold.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  begin
    perform public.set_capability_override(
      v_other, 'fixture.import', 'club', v_club, null, 'deny', 'automated coverage'
    );
    raise notice 'PASS 9: a club administrator may withhold an operational capability from one of their own people';
  exception when others then
    raise notice 'FAIL 9: a club administrator could not delegate at all (%)', sqlerrm;
  end;

  -- 10. NO SELF-ESCALATION. Handing out the delegation authority itself
  -- would let one administrator mint others, or strip a peer and lock the
  -- club out of its own permissions screen.
  begin
    perform public.set_capability_override(
      v_other, 'people.capability.manage', 'club', v_club, null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 10: a club administrator granted the delegation authority itself';
  exception when insufficient_privilege then
    raise notice 'PASS 10: the delegation authority is not a club''s to hand out';
  end;

  -- 11. ONLY OPERATIONAL CAPABILITIES. The allow-list is explicit so a
  -- capability added later is not silently a club's to grant.
  begin
    perform public.set_capability_override(
      v_other, 'finance.platform_billing.manage', 'club', v_club, null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 11: a club administrator granted a non-operational capability';
  exception when insufficient_privilege then
    raise notice 'PASS 11: a non-delegable capability is refused';
  end;

  -- 12. AND ONLY THEIR OWN CLUB.
  begin
    perform public.set_capability_override(
      v_other, 'fixture.edit', 'club',
      (select id from public.clubs where id <> v_club limit 1), null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 12: a club administrator reached another club';
  exception when others then
    raise notice 'PASS 12: a club administrator cannot delegate at another club';
  end;

  -- 13. SOMEBODY WITHOUT THE AUTHORITY CANNOT DELEGATE AT ALL, and cannot
  -- reach it by calling the function directly instead of using the screen.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform public.set_capability_override(
      v_coach, 'fixture.edit', 'club', v_club, null, 'deny', 'automated coverage'
    );
    raise notice 'FAIL 13: a member without club.capabilities.manage changed somebody''s capabilities';
  exception when insufficient_privilege then
    raise notice 'PASS 13: delegation requires club.capabilities.manage, not merely club membership';
  end;
end $$;


-- =====================================================================================
-- SLICE 4C -- DETERMINISTIC FIXTURE AUTHORITY MATRIX (Phase 2 AA.3 row 4c, J.6 456-474).
--
-- Everything above this line reads the local UAT identities and SKIPs when they are absent,
-- which means on a seedless clean boot it asserts nothing while still reporting green. This
-- section seeds its own club, teams and people, so the authority contract 4C migrates is
-- proved on any database, including a clean boot, and can never silently skip.
--
--   FA-A  fixture.fixture.view / create / edit / cancel / archive by persona
--   FA-B  the mass-operation boundary: Planner, Import and bulk edit are club-only and no
--         team bundle holds them, while team staff keep their team-scoped fixture authority
--   FA-C  INTENDED CHANGE 1 -- the Full Site Admin's blanket legacy bypass is gone and
--         legitimate support is the explicit site.fixtures.support capability
--   FA-D  INTENDED CHANGE 2 -- a Team Manager may archive and restore their OWN team's
--         fixture (J.6 line 460), while outright delete stays narrower (J.6 line 461)
--   FA-E  call-ups: request is team-or-club, approval is club-only (J.6 469-470)
--   FA-F  requests and results by persona (J.6 465-467)
--   FA-G  scope negatives: wrong team, wrong club, no membership
-- =====================================================================================

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

do $$
declare
  v_club uuid; v_team uuid; v_other uuid; v_far_club uuid; v_far_team uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_ca uuid; v_fs uuid; v_co uuid; v_tm uuid; v_ta uuid; v_mb uuid; v_so uuid;
  v_sa uuid; v_stranger uuid; v_other_co uuid; v_far_ca uuid;
  v_m_co uuid; v_m_tm uuid; v_m_ta uuid; v_m_other_co uuid;
begin
  v_club := pg_temp.club('4CFix'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('4CFar'); v_far_team := pg_temp.team(v_far_club, 'U12');

  v_ca := pg_temp.person('CA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FS', v_adult); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_mb := pg_temp.person('MB', v_adult); perform pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_so := pg_temp.person('SO', v_adult); perform pg_temp.member(v_club, v_so, 'BASIC_USER');
  v_co := pg_temp.person('CO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  v_tm := pg_temp.person('TM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_ta := pg_temp.person('TA', v_adult); v_m_ta := pg_temp.member(v_club, v_ta, 'BASIC_USER');
  v_other_co := pg_temp.person('OtherCO', v_adult); v_m_other_co := pg_temp.member(v_club, v_other_co, 'BASIC_USER');
  v_far_ca := pg_temp.person('FarCA', v_adult); perform pg_temp.member(v_far_club, v_far_ca, 'CLUB_ADMIN');
  v_stranger := pg_temp.person('Stranger', v_adult);
  v_sa := pg_temp.person('SiteAdmin', v_adult);
  insert into public.site_admins (user_id, status, admin_role) values (v_sa, 'active', 'full');

  perform pg_temp.team_role(v_m_co, v_team, 'coach');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_ta, v_team, 'team_admin');
  perform pg_temp.team_role(v_m_other_co, v_other, 'coach');

  -- FA-A  view and create -------------------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_mb, 'fixture.fixture.view', 'club', v_club, null),
    'FA-A1 a club Member sees the club''s fixtures');
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.fixture.view', 'team', v_club, v_team),
    'FA-A2 the Coach sees their team''s fixtures');
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'fixture.fixture.view', 'club', v_club, null),
    'FA-A3 a stranger sees none of them');
  perform pg_temp.check(pg_temp.can_as(v_ca, 'fixture.fixture.create', 'club', v_club, null),
    'FA-A4 the Club Admin creates fixtures club-wide');
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-A5 the Coach creates a fixture for their own team');
  perform pg_temp.check(not pg_temp.can_as(v_mb, 'fixture.fixture.create', 'club', v_club, null),
    'FA-A6 an ordinary Member creates none');

  -- FA-B  the mass-operation boundary (the Slice 4C invariant) --------------------------
  perform pg_temp.check(pg_temp.can_as(v_ca, 'fixture.planner.use', 'club', v_club, null),
    'FA-B1 Planner is the Club Admin''s');
  perform pg_temp.check(pg_temp.can_as(v_fs, 'fixture.import.run', 'club', v_club, null),
    'FA-B2 Import is the Fixtures Secretary''s');
  perform pg_temp.check(not pg_temp.can_as(v_co, 'fixture.planner.use', 'club', v_club, null)
                    and not pg_temp.can_as(v_tm, 'fixture.planner.use', 'club', v_club, null)
                    and not pg_temp.can_as(v_ta, 'fixture.planner.use', 'club', v_club, null),
    'FA-B3 no team role reaches Planner');
  perform pg_temp.check(not pg_temp.can_as(v_co, 'fixture.import.run', 'club', v_club, null)
                    and not pg_temp.can_as(v_tm, 'fixture.import.run', 'club', v_club, null),
    'FA-B4 nor Import');
  perform pg_temp.check(not pg_temp.can_as(v_tm, 'fixture.fixture.bulk_edit', 'club', v_club, null),
    'FA-B5 nor bulk edit');
  perform pg_temp.check(not exists (
      select 1 from public.bundle_capabilities
      where capability_key in ('fixture.planner.use','fixture.import.run','fixture.fixture.bulk_edit')
        and scope_type = 'team'),
    'FA-B6 structurally: no TEAM bundle grants Planner, Import or bulk edit at all');
  perform pg_temp.check(pg_temp.can_as(v_tm, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-B7 but the Team Manager keeps team-scoped fixture creation');

  -- FA-C  INTENDED CHANGE 1: the blanket Site Admin bypass is gone ----------------------
  perform pg_temp.check(not pg_temp.can_as(v_sa, 'fixture.planner.use', 'club', v_club, null),
    'FA-C1 INTENDED: a Full Site Admin holds no club-scope fixture authority by being Site Admin');
  perform pg_temp.check(pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.fixtures.support'')'),
    'FA-C2 INTENDED: their legitimate route is the explicit site.fixtures.support capability');
  perform pg_temp.check(
    (select not (prosrc ~ '\mis_site_admin\(') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'can_bulk_plan_fixtures'),
    'FA-C3 INTENDED: no bare is_site_admin remains in the bulk-planning gate');

  -- FA-D  INTENDED CHANGE 2: Team Manager archive/restore -------------------------------
  perform pg_temp.check(pg_temp.can_as(v_tm, 'fixture.fixture.archive', 'team', v_club, v_team),
    'FA-D1 INTENDED: a Team Manager may archive their OWN team''s fixture (J.6 line 460)');
  perform pg_temp.check(not pg_temp.can_as(v_tm, 'fixture.fixture.delete', 'club', v_club, null),
    'FA-D2 INTENDED: but outright delete stays narrower and is not theirs (J.6 line 461)');
  perform pg_temp.check(pg_temp.can_as(v_ca, 'fixture.fixture.delete', 'club', v_club, null),
    'FA-D3 delete remains the Club Admin''s');
  perform pg_temp.check(not pg_temp.can_as(v_tm, 'fixture.fixture.archive', 'team', v_club, v_other),
    'FA-D4 and archive does not reach another team');

  -- FA-E  call-ups (J.6 469-470) ---------------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.callup.request', 'team', v_club, v_team),
    'FA-E1 the Coach may request a call-up for their team');
  perform pg_temp.check(pg_temp.can_as(v_ca, 'fixture.callup.approve', 'club', v_club, null),
    'FA-E2 approving a call-up is club authority');
  perform pg_temp.check(not pg_temp.can_as(v_co, 'fixture.callup.approve', 'club', v_club, null)
                    and not pg_temp.can_as(v_tm, 'fixture.callup.approve', 'club', v_club, null),
    'FA-E3 team staff never approve their own call-up (team defaults removed)');
  perform pg_temp.check(not exists (
      select 1 from public.bundle_capabilities where capability_key = 'fixture.callup.approve' and scope_type = 'team'),
    'FA-E4 structurally: call-up approval has no team bundle');

  -- FA-F  requests and results (J.6 465-467) ---------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.request.create', 'team', v_club, v_team),
    'FA-F1 the Coach may raise a fixture request');
  perform pg_temp.check(not pg_temp.can_as(v_co, 'fixture.request.respond', 'team', v_club, v_team),
    'FA-F2 but may not answer one -- respond is CA, FS, TM only (J.6 line 466)');
  perform pg_temp.check(pg_temp.can_as(v_tm, 'fixture.request.respond', 'team', v_club, v_team),
    'FA-F3 the Team Manager may answer one');
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.result.record', 'team', v_club, v_team),
    'FA-F4 the Coach may record a result');
  perform pg_temp.check(not pg_temp.can_as(v_mb, 'fixture.result.record', 'club', v_club, null),
    'FA-F5 an ordinary Member may not');

  -- FA-G  scope negatives -----------------------------------------------------------------
  perform pg_temp.check(not pg_temp.can_as(v_other_co, 'fixture.fixture.edit', 'team', v_club, v_team),
    'FA-G1 a Coach of another team in the same club does not edit this team''s fixtures');
  perform pg_temp.check(not pg_temp.can_as(v_far_ca, 'fixture.fixture.edit', 'club', v_club, null),
    'FA-G2 a Club Admin at another club reaches nothing here');
  perform pg_temp.check(not pg_temp.can_as(v_ca, 'fixture.fixture.edit', 'club', v_far_club, null),
    'FA-G3 and not the reverse');
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-G4 no membership means no fixture authority at all');
end $$;

-- =====================================================================================
-- FA-H  CANONICAL FIXTURE CREATION and the retirement of the direct-insert bypass
--       (AA.3 row 4c "direct fixture writes"; J.6 line 457).
--
-- The product invariant is that a fixture against another Ovalball club is ASKED, never
-- booked. It used to live only in the createFixture server action, so a direct REST insert
-- could name another club's team and skip verification entirely. These rows pin the fix.
-- =====================================================================================
do $$
declare
  v_club uuid; v_team uuid; v_far_club uuid; v_far_team uuid; v_other uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_ca uuid; v_fs uuid; v_tm uuid; v_co uuid; v_mb uuid; v_vo uuid; v_so uuid;
  v_pg uuid; v_far_ca uuid; v_other_co uuid; v_stranger uuid; v_sa uuid;
  v_m_tm uuid; v_m_co uuid; v_m_other uuid;
  v_msg text; r jsonb; n_fix int; n_req int; v_player uuid;
begin
  v_club := pg_temp.club('Create4C'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('Rival4C'); v_far_team := pg_temp.team(v_far_club, 'U12');

  v_ca := pg_temp.person('cCA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('cFS', v_adult); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_mb := pg_temp.person('cMB', v_adult); perform pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_vo := pg_temp.person('cVO', v_adult); perform pg_temp.member(v_club, v_vo, 'BASIC_USER');
  v_so := pg_temp.person('cSO', v_adult); perform pg_temp.member(v_club, v_so, 'BASIC_USER');
  v_tm := pg_temp.person('cTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_co := pg_temp.person('cCO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  v_other_co := pg_temp.person('cOther', v_adult); v_m_other := pg_temp.member(v_club, v_other_co, 'BASIC_USER');
  v_far_ca := pg_temp.person('cFarCA', v_adult); perform pg_temp.member(v_far_club, v_far_ca, 'CLUB_ADMIN');
  v_stranger := pg_temp.person('cStranger', v_adult);
  v_pg := pg_temp.person('cGuardian', v_adult);
  v_sa := pg_temp.person('cSiteAdmin', v_adult);
  insert into public.site_admins (user_id, status, admin_role) values (v_sa, 'active', 'full');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_co, v_team, 'coach');
  perform pg_temp.team_role(v_m_other, v_other, 'coach');

  -- a family relationship with no fixture authority whatsoever
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Create', 'Child', (current_date - interval '11 years')::date, 'MALE') returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state)
  values (v_pg, v_player, 'parent', 'active', 'ACTIVE');
  insert into public.player_team_memberships (player_id, team_id, status, state, source)
  values (v_player, v_team, 'active', 'ACTIVE', 'CLUB_CREATED');

  -- FA-H1  the bypass is closed at the privilege layer -------------------------------
  perform pg_temp.check(not exists (
      select 1 from information_schema.role_table_grants
      where table_name = 'fixtures' and grantee in ('anon','authenticated') and privilege_type = 'INSERT'),
    'FA-H1 no browser role holds INSERT on public.fixtures -- creation has no direct path');
  perform pg_temp.check(pg_temp.try_as(v_tm, format(
      'insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source) '
      || 'values (%L, %L, ''Home'', ''Rival'', current_date + 30, ''Booked'', ''club_created'')', v_team, v_far_team)) <> 'OK',
    'FA-H2 a direct insert naming another Ovalball club is refused, however authorised the caller is');

  -- FA-H3/4  the canonical path, external opposition ---------------------------------
  select count(*) into n_fix from public.fixtures where owning_team_id = v_team;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'External RFC', (current_date + 31)::date, 'Booked');
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((r->>'pendingRequest')::boolean = false and (r->>'fixtureId') is not null
                        and (select count(*) from public.fixtures where owning_team_id = v_team) = n_fix + 1,
    'FA-H3 external opposition is recorded directly -- nobody on the other side can answer');
  perform pg_temp.check((select source from public.fixtures where id = (r->>'fixtureId')::uuid) = 'club_created',
    'FA-H4 source is server-derived, never taken from the caller');
  -- FA-H4b  ...and "derived" means derived, not fixed to one constant. fixtures.source separates
  -- club work from Site Admin work, and the Site Admin fixtures list filters on it, so a caller
  -- authorised only by the site capability must not have their fixture recorded as the club's.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sa, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'External RFC', (current_date + 32)::date, 'Booked');
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((select source from public.fixtures where id = (r->>'fixtureId')::uuid) = 'site_admin_manual',
    'FA-H4b a fixture created purely on the site capability is recorded as site_admin_manual, not as the club''s own');

  -- FA-H5/6  the canonical path, Ovalball opposition ---------------------------------
  select count(*) into n_fix from public.fixtures where owning_team_id = v_team;
  select count(*) into n_req from public.fixture_requests;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'Rival U12', (current_date + 32)::date, 'Booked', v_far_team);
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((r->>'pendingRequest')::boolean = true and (r->>'fixtureId') is null
                        and (select count(*) from public.fixtures where owning_team_id = v_team) = n_fix,
    'FA-H5 an Ovalball opponent is ASKED, never booked -- no fixture is created');
  perform pg_temp.check((select count(*) from public.fixture_requests) = n_req + 1,
    'FA-H6 and the other club gets a request to answer');

  -- FA-H7  suppression attempt: hide the Ovalball opponent behind free text only -------
  select count(*) into n_req from public.fixture_requests;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'Rival4C RUFC', (current_date + 33)::date, 'Booked',
                             null, (select directory_id from public.clubs where id = v_far_club));
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((r->>'pendingRequest')::boolean = true
                        and (select count(*) from public.fixture_requests) = n_req + 1,
    'FA-H7 naming the club by directory instead of team still routes to verification');
  -- FA-H7b  ...and that request must still say WHICH side is being asked for. When the opposition is
  -- a claimed club that has not named a team, Central Fixture Participant Resolution carries the
  -- structured identity on the request; without it the other club receives something it cannot
  -- answer. FA-H7c pins the other half: once a real opponent team is named, the structured fields
  -- are ignored rather than contradicting it.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'Rival4C RUFC', (current_date + 34)::date, 'Booked',
                             null, (select directory_id from public.clubs where id = v_far_club),
                             null, null, null, null, null, null, 'U12', 'girls', 'B');
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check(exists (
      select 1 from public.fixture_requests
      where group_id = (r->>'requestGroupId')::uuid
        and target_team_age_group = 'U12' and target_team_gender = 'girls'
        and target_team_squad_designation = 'B'),
    'FA-H7b an unnamed opponent team still carries the structured identity the other club answers against');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'Rival U12', (current_date + 35)::date, 'Booked',
                             v_far_team, null, null, null, null, null, null, null, 'U18', 'boys', 'C');
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check(exists (
      select 1 from public.fixture_requests
      where group_id = (r->>'requestGroupId')::uuid and target_team_id = v_far_team
        and target_team_age_group is null and target_team_gender is null
        and target_team_squad_designation is null),
    'FA-H7c a named opponent team wins -- the structured fields are ignored, never contradicting it');

  -- FA-H8..H13  who may create at all ---------------------------------------------------
  perform pg_temp.check(pg_temp.can_as(v_ca, 'fixture.fixture.create', 'club', v_club, null),
    'FA-H8 the Club Admin creates club-wide');
  perform pg_temp.check(pg_temp.can_as(v_fs, 'fixture.fixture.create', 'club', v_club, null),
    'FA-H9 the Fixtures Secretary creates administratively');
  perform pg_temp.check(pg_temp.can_as(v_co, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-H10 the Coach creates for their own team');
  perform pg_temp.check(not pg_temp.can_as(v_other_co, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-H11 a Coach of another team in the same club may not');
  perform pg_temp.check(not pg_temp.can_as(v_far_ca, 'fixture.fixture.create', 'club', v_club, null),
    'FA-H12 a Club Admin at another club may not');
  perform pg_temp.check(not pg_temp.can_as(v_stranger, 'fixture.fixture.create', 'team', v_club, v_team)
                    and not pg_temp.can_as(v_mb, 'fixture.fixture.create', 'club', v_club, null)
                    and not pg_temp.can_as(v_vo, 'fixture.fixture.create', 'club', v_club, null)
                    and not pg_temp.can_as(v_so, 'fixture.fixture.create', 'club', v_club, null)
                    and not pg_temp.can_as(v_pg, 'fixture.fixture.create', 'team', v_club, v_team),
    'FA-H13 no unrelated identity, Member, Volunteer, Safeguarding Officer or guardian creates a fixture');

  -- FA-H14  the RPC refuses, not just the capability -------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_mb, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    r := public.create_fixture(v_team, 'Home', 'External RFC', (current_date + 34)::date, 'Booked');
    v_msg := 'ALLOWED';
  exception when others then get stacked diagnostics v_msg = message_text;
  end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check(v_msg like '%not authorised%',
    'FA-H14 create_fixture itself refuses an unauthorised caller, not merely the capability check');

  -- FA-H15  the Full Site Admin path is the explicit capability, not a bypass --------------
  perform pg_temp.check(not pg_temp.can_as(v_sa, 'fixture.fixture.create', 'club', v_club, null),
    'FA-H15 a Full Site Admin holds no club-scope creation authority by being Site Admin');

  -- FA-H16  mass operations are still separate -------------------------------------------
  perform pg_temp.check(not pg_temp.can_as(v_tm, 'fixture.planner.use', 'club', v_club, null)
                    and not pg_temp.can_as(v_tm, 'fixture.import.run', 'club', v_club, null),
    'FA-H16 holding fixture.create never implies Planner or Import');
end $$;

-- =====================================================================================
-- FA-I  ATTACK TESTS against the canonical creation contract.
--       Every refusal must leave zero state behind.
-- =====================================================================================
do $$
declare
  v_club uuid; v_team uuid; v_far_club uuid; v_far_team uuid; v_other uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_tm uuid; v_m_tm uuid; v_stranger uuid; v_far_tm uuid; v_m_far uuid;
  v_msg text; r jsonb; n_fix int; n_req int; n_fix2 int; n_req2 int;
begin
  v_club := pg_temp.club('Atk4C'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('AtkFar'); v_far_team := pg_temp.team(v_far_club, 'U12');
  v_tm := pg_temp.person('aTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  v_far_tm := pg_temp.person('aFarTM', v_adult); v_m_far := pg_temp.member(v_far_club, v_far_tm, 'BASIC_USER');
  perform pg_temp.team_role(v_m_far, v_far_team, 'manager');
  v_stranger := pg_temp.person('aStranger', v_adult);

  select count(*) into n_fix from public.fixtures;
  select count(*) into n_req from public.fixture_requests;

  -- I1 direct REST-style INSERT, every shape
  perform pg_temp.check(pg_temp.try_as(v_tm, format(
    'insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source) '
    || 'values (%L, ''Home'', ''X'', current_date + 5, ''Booked'', ''club_created'')', v_team)) <> 'OK',
    'FA-I1 direct INSERT is refused for an authorised team manager');
  perform pg_temp.check(pg_temp.try_as(v_stranger, format(
    'insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source) '
    || 'values (%L, ''Home'', ''X'', current_date + 5, ''Booked'', ''club_created'')', v_team)) <> 'OK',
    'FA-I2 and for an unrelated identity');
  perform pg_temp.check(pg_temp.try_as(null, format(
    'insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source) '
    || 'values (%L, ''Home'', ''X'', current_date + 5, ''Booked'', ''club_created'')', v_team)) <> 'OK',
    'FA-I3 and anonymously');

  -- I4 team-id substitution: create for a team you do not run
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    r := public.create_fixture(v_other, 'Home', 'X', (current_date + 6)::date, 'Booked');
    v_msg := 'ALLOWED';
  exception when others then get stacked diagnostics v_msg = message_text;
  end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check(v_msg like '%not authorised%', 'FA-I4 substituting another team of the same club is refused');

  -- I5 cross-club team substitution
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    r := public.create_fixture(v_far_team, 'Home', 'X', (current_date + 7)::date, 'Booked');
    v_msg := 'ALLOWED';
  exception when others then get stacked diagnostics v_msg = message_text;
  end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check(v_msg like '%not authorised%', 'FA-I5 substituting another club''s team is refused');

  -- I6 verification suppression: name the Ovalball opponent only as free text
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'AtkFar RUFC pretending to be external', (current_date + 8)::date, 'Booked', v_far_team);
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((r->>'pendingRequest')::boolean = true,
    'FA-I6 free-text opposition cannot disguise a named Ovalball team -- still asked');

  -- I7 verification manufacture: a caller cannot pre-set resulting_fixture_id or decide a request
  perform pg_temp.check(pg_temp.try_as(v_tm,
    'update public.fixture_requests set status = ''accepted'', decided_by = auth.uid() where true') <> 'OK'
    or (select count(*) from public.fixture_requests where status = 'accepted' and decided_by = v_tm) = 0,
    'FA-I7 a requester cannot accept their own request by direct update');

  -- I8 replay: the same request twice raises two requests, never a silent fixture
  select count(*) into n_fix2 from public.fixtures;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tm, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  r := public.create_fixture(v_team, 'Home', 'AtkFar U12', (current_date + 9)::date, 'Booked', v_far_team);
  r := public.create_fixture(v_team, 'Home', 'AtkFar U12', (current_date + 9)::date, 'Booked', v_far_team);
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  perform pg_temp.check((select count(*) from public.fixtures) = n_fix2,
    'FA-I8 replaying a creation against an Ovalball club never yields a fixture');

  -- I9 nothing leaked: refusals left no rows
  perform pg_temp.check((select count(*) from public.fixtures where owning_team_id in (v_other, v_far_team)) = 0,
    'FA-I9 every refused creation left zero fixture state');
end $$;

-- =====================================================================================
-- FA-J  Gate-level and row-level coverage that mutation testing showed was missing:
--       the owning-team binding inside internal.can_create_team_fixture, and the
--       result-submission row policy, which nothing previously read.
-- =====================================================================================
do $$
declare
  v_club uuid; v_team uuid; v_other uuid; v_far_club uuid; v_far_team uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_ca uuid; v_tm uuid; v_co uuid; v_mb uuid; v_m_tm uuid; v_m_co uuid;
  v_fixture uuid; v_sub uuid;
begin
  v_club := pg_temp.club('Gap4C'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('GapFar'); v_far_team := pg_temp.team(v_far_club, 'U12');
  v_ca := pg_temp.person('gCA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_mb := pg_temp.person('gMB', v_adult); perform pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_tm := pg_temp.person('gTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_co := pg_temp.person('gCO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_co, v_other, 'coach');

  -- FA-J1/J2  internal.can_create_team_fixture must bind to the OWNING TEAM, not merely the club
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_create_team_fixture(%L,%L)', v_club, v_team)),
    'FA-J1 the Team Manager may create for their own team');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_create_team_fixture(%L,%L)', v_club, v_other)),
    'FA-J2 and NOT for another team of the same club -- the gate binds to the team, not the club');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_create_team_fixture(%L,%L)', v_club, v_other)),
    'FA-J3 while a Club Admin, holding it club-wide, may create for any of their teams');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_create_team_fixture(%L,%L)', v_far_club, v_far_team)),
    'FA-J4 and nobody reaches another club''s team');

  -- FA-J5..J8  the result-submission row policy
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_team, 'Home', 'Gap External RFC', current_date + 20, 'Booked', 'club_created') returning id into v_fixture;
  insert into public.fixture_result_submissions (fixture_id, kind, submitted_by, home_score, away_score)
  values (v_fixture, 'initial', v_tm, 10, 5) returning id into v_sub;

  perform pg_temp.check(pg_temp.bool_as(v_tm, format('exists (select 1 from public.fixture_result_submissions where id = %L)', v_sub)),
    'FA-J5 the Team Manager of the owning team reads the result submission');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('exists (select 1 from public.fixture_result_submissions where id = %L)', v_sub)),
    'FA-J6 so does the Club Admin');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('exists (select 1 from public.fixture_result_submissions where id = %L)', v_sub)),
    'FA-J7 an ordinary club Member does not');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('exists (select 1 from public.fixture_result_submissions where id = %L)', v_sub)),
    'FA-J8 nor a Coach of a different team in the same club');
end $$;

-- =====================================================================================
-- FA-K  Gate- and row-level coverage for bulk planning and call-ups. Asserting the
--       capability is not enough: mutation testing showed a gate could drop its club
--       binding, and a policy could open to everyone, while every capability assertion
--       still passed.
-- =====================================================================================
do $$
declare
  v_club uuid; v_team uuid; v_other uuid; v_far_club uuid; v_far_team uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_ca uuid; v_tm uuid; v_mb uuid; v_far_ca uuid; v_m_tm uuid;
  v_fixture uuid; v_player uuid; v_callup uuid;
begin
  v_club := pg_temp.club('Gate4C'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('GateFar'); v_far_team := pg_temp.team(v_far_club, 'U12');
  v_ca := pg_temp.person('kCA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_mb := pg_temp.person('kMB', v_adult); perform pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_tm := pg_temp.person('kTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_tm, v_other, 'manager');
  v_far_ca := pg_temp.person('kFarCA', v_adult); perform pg_temp.member(v_far_club, v_far_ca, 'CLUB_ADMIN');

  -- FA-K1..K4  internal.can_bulk_plan_fixtures must bind to the club it is ASKED about
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_bulk_plan_fixtures(%L)', v_club)),
    'FA-K1 the Club Admin may bulk plan at their OWN club');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('internal.can_bulk_plan_fixtures(%L)', v_far_club)),
    'FA-K2 and NOT at another club -- the gate binds to the club it is asked about');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_bulk_plan_fixtures(%L)', v_club)),
    'FA-K3 nor the reverse');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_bulk_plan_fixtures(%L)', v_club))
                    and not pg_temp.bool_as(v_mb, format('internal.can_bulk_plan_fixtures(%L)', v_club)),
    'FA-K4 and no team role or ordinary member reaches it at any club');

  -- FA-K5..K8  the call-up ROW policy, not merely the capability
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_other, 'Home', 'Gate External RFC', current_date + 25, 'Booked', 'club_created') returning id into v_fixture;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Gate', 'Child', (current_date - interval '11 years')::date, 'MALE') returning id into v_player;
  -- A call-up moves a player UP an age grade (RFU/RFL rule the database enforces), so the player
  -- belongs to the U12 side and is called up to the U14 one.
  insert into public.player_team_memberships (player_id, team_id, status, state, source)
  values (v_player, v_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, status, eligibility_rule_reference)
  values (v_fixture, v_player, v_team, v_other, 'requested', 'RFU Regulation 15 - playing up one age grade')
  returning id into v_callup;

  perform pg_temp.check(pg_temp.bool_as(v_tm, format('exists (select 1 from public.fixture_player_call_up where id = %L)', v_callup)),
    'FA-K5 the target team''s manager reads the call-up');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('exists (select 1 from public.fixture_player_call_up where id = %L)', v_callup)),
    'FA-K6 so does the club''s approver');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('exists (select 1 from public.fixture_player_call_up where id = %L)', v_callup)),
    'FA-K7 an ordinary club Member does not');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('exists (select 1 from public.fixture_player_call_up where id = %L)', v_callup)),
    'FA-K8 nor a Club Admin at another club -- a call-up is not public to every signed-in person');
end $$;

-- =====================================================================================================
-- FA-L. The last two owned policies: raising a fixture request, and deleting a fixture.
-- Both carried a legacy helper until 4C. `fixture_requests_insert_scoped` asked can_manage_team, which
-- is wider than raising a request and does not inherit from club scope; `fixtures_delete_admin` was a
-- bare is_site_admin() bypass.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_team uuid; v_other uuid; v_far_club uuid; v_far_team uuid;
  v_adult date := (current_date - interval '40 years')::date;
  v_ca uuid; v_co uuid; v_tm uuid; v_mb uuid; v_sa uuid; v_m_tm uuid; v_m_co uuid;
  v_dir uuid; v_group uuid; v_fixture uuid;
begin
  v_club := pg_temp.club('Del4C'); v_team := pg_temp.team(v_club, 'U12'); v_other := pg_temp.team(v_club, 'U14');
  v_far_club := pg_temp.club('DelFar'); v_far_team := pg_temp.team(v_far_club, 'U12');
  v_ca := pg_temp.person('dCA', v_adult); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_mb := pg_temp.person('dMB', v_adult); perform pg_temp.member(v_club, v_mb, 'BASIC_USER');
  v_tm := pg_temp.person('dTM', v_adult); v_m_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  v_co := pg_temp.person('dCO', v_adult); v_m_co := pg_temp.member(v_club, v_co, 'BASIC_USER');
  perform pg_temp.team_role(v_m_tm, v_team, 'manager');
  perform pg_temp.team_role(v_m_co, v_team, 'coach');
  v_sa := pg_temp.person('dSA', v_adult);
  insert into public.site_admins (user_id, status, admin_role) values (v_sa, 'active', 'full');

  select c.directory_id into v_dir from public.clubs c where c.id = v_far_club;
  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
  values (v_club, v_far_club, 'DelFar RFC', current_date + 20, v_ca) returning id into v_group;

  -- FA-L1..L5  raising a request is fixture.request.create, and it binds to the requesting TEAM
  perform pg_temp.check(
    pg_temp.try_as(v_co, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group, v_team, v_far_team)) = 'OK',
    'FA-L1 a Coach may RAISE a fixture request for their own team (J.6 line 466)');
  perform pg_temp.check(
    pg_temp.try_as(v_co, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group, v_other, v_far_team)) <> 'OK',
    'FA-L2 but NOT for another team of the same club -- the write binds to the team, as the old can_manage_team did not');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group, v_other, v_far_team)) = 'OK',
    'FA-L3 while a Club Admin, holding it club-wide, may raise for any of their teams');
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group, v_team, v_far_team)) <> 'OK',
    'FA-L4 an ordinary club Member may not raise a fixture request');
  perform pg_temp.check(
    pg_temp.try_as(null, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group, v_team, v_far_team)) <> 'OK',
    'FA-L5 nor may an anonymous caller');

  -- FA-L6..L9  deleting a fixture.
  --
  -- Honest scope note. `fixtures_delete_admin` is migrated off the bare is_site_admin() bypass onto
  -- site.fixtures.delete, and that lowers the PG15 legacy-policy count. But the authority change is
  -- NOT OBSERVABLE through any browser role, and the suite says so rather than staging a scenario that
  -- implies otherwise: DELETE on public.fixtures is granted only to postgres and service_role, and both
  -- carry BYPASSRLS, so the policy is evaluated by nobody who can reach the table. What is observable,
  -- and is what actually protects a fixture from deletion, is the privilege layer. The capability
  -- assertions below are the real behavioural claim; the two structural ones pin the closure.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_team, 'Home', 'Del External RFC', current_date + 25, 'Booked', 'club_created') returning id into v_fixture;
  perform pg_temp.check(not pg_temp.bool_as(v_ca, 'internal.has_site_capability(''site.fixtures.delete'')'),
    'FA-L6 a Club Admin does not hold site.fixtures.delete -- a club archives, it does not delete');
  perform pg_temp.check(pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.fixtures.delete'')'),
    'FA-L7 while a Full Site Admin does, through the SITE_FULL bundle rather than the bare role');
  perform pg_temp.check(
    not has_table_privilege('authenticated', 'public.fixtures', 'DELETE')
      and not has_table_privilege('anon', 'public.fixtures', 'DELETE'),
    'FA-L8 and no browser role holds DELETE on public.fixtures at all -- closed at the privilege layer');
  perform pg_temp.check(
    exists (select 1 from pg_policies where tablename = 'fixtures' and policyname = 'fixtures_delete_admin'
            and qual like '%site.fixtures.delete%' and qual not like '%is_site_admin%'),
    'FA-L9 the delete policy names the capability and no longer carries the is_site_admin bypass');
end $$;

rollback;
