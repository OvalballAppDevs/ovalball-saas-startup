-- FAMILY AND PLAYER AUTHORITY MATRIX (Identity/Auth Slice 4a; Phase 2 AA.3 row 4a, AJ.1, J.6, N, W, AI #70).
--
-- Every family and player capability is asked of every person Phase 2 AJ.1 names, through the canonical
-- decision, the domain RPC and a direct table write. The answer must be exactly the people Phase 2 lists and
-- nobody else; the legacy helpers are shadow-evaluated for the same questions (AA.4) and may disagree only
-- where the intended-change table below says so.
--
--   FA1   player.profile.view: self/child base rows; staff through player_staff_view (no date of birth)
--   FA2   player.profile.edit / edit_protected: the player or their guardian; a recorded gender is corrected
--         only through site.users.identity.correct
--   FA3   player.pathway.request: Club Admin, Coach, Team Manager of the child's team
--   FA4   family.relationship.approve: a first child by the club or the child's team (TM, TA); an additional
--         guardian by the club only; never the requester or the added person
--   FA5   family.relationship.remove / hold: the club removes; Ovalball holds (site.family.manage); a
--         guardian may always end their own relationship
--   FA6   family.permission.manage, player.account.invite: the child's guardian only
--   FA7   family.duplicate.resolve: the club only
--   FA8   family.child.add: a guardian at the club or an invited parent; a child added by a parent waits for
--         the club (PENDING_APPROVAL confers nothing); club membership alone is not a family relationship
--   FA9   family.relationship.request and player.self_register: adults only
--   FA10  FR-6: an adult player's guardians hold no derived authority (ADULT_PLAYER)
--   FA11  direct table writes refused for every browser role on every family table
--   FA12  pictures: a child's picture is not a coach's; a minor's account picture is private to the family
--         and the staff who may view them
--   FA13  shadow comparison against the legacy helpers (AA.4): mismatches equal the intended-change list
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

-- ---- Slice 4 additions --------------------------------------------------------------------------------

-- The named people a domain matrix asks about (Phase 2 AJ.1 persona list).
create temp table if not exists matrix_person (label text primary key, id uuid, claims jsonb);
grant select on matrix_person to public;

create or replace function pg_temp.persona(p_label text, p_id uuid, p_claims jsonb default null) returns uuid language plpgsql as $$
begin
  insert into matrix_person (label, id, claims) values (p_label, p_id, p_claims)
  on conflict (label) do update set id = excluded.id, claims = excluded.claims;
  return p_id;
end $$;

-- Who, among the named people, gets TRUE for a boolean expression evaluated as themselves (browser role).
create or replace function pg_temp.allowed_for(p_expr text) returns text language plpgsql as $$
declare r record; v boolean; v_out text[] := '{}';
begin
  for r in select * from matrix_person where id is not null order by label loop
    perform set_config('request.jwt.claims', coalesce(r.claims, jsonb_build_object('sub', r.id, 'role', 'authenticated'))::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      execute 'select (' || p_expr || ')::boolean' into v;
    exception when others then
      v := false;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    if coalesce(v, false) then v_out := v_out || r.label; end if;
  end loop;
  return array_to_string(v_out, ',');
end $$;

-- Who, among the named people, can run a statement without an error (browser role), inside a savepoint that is
-- always rolled back so one person's success cannot change the next person's answer.
create or replace function pg_temp.succeeds_for(p_sql text) returns text language plpgsql as $$
declare r record; v_out text[] := '{}';
begin
  for r in select * from matrix_person order by label loop
    perform set_config('request.jwt.claims', case when r.id is null then jsonb_build_object('role', 'anon')
      else coalesce(r.claims, jsonb_build_object('sub', r.id, 'role', 'authenticated')) end::text, true);
    perform set_config('role', case when r.id is null then 'anon' else 'authenticated' end, true);
    begin
      execute p_sql;
      v_out := v_out || r.label;
      raise sqlstate 'ZZ999';
    exception when sqlstate 'ZZ999' then null;
              when others then null;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;
  return array_to_string(v_out, ',');
end $$;

create or replace function pg_temp.expect_set(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
declare v_a text := (select coalesce(string_agg(x, ',' order by x), '') from unnest(string_to_array(nullif(p_actual, ''), ',')) x);
        v_e text := (select coalesce(string_agg(x, ',' order by x), '') from unnest(string_to_array(nullif(p_expected, ''), ',')) x);
begin
  if v_a = v_e then raise notice 'PASS %', p_label;
  else raise notice 'FAIL % -- expected {%} got {%}', p_label, v_e, v_a; end if;
end $$;
create temp table fam (k text primary key, id uuid);
grant select on fam to public;
create or replace function pg_temp.f(p_k text) returns uuid language sql stable as $$ select id from fam where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_id uuid) returns uuid language plpgsql as $$
begin insert into fam values (p_k, p_id) on conflict (k) do update set id = excluded.id; return p_id; end $$;

-- A database with an empty season register (a clean boot) still gets meaningful age-grade expectations: a real
-- season covering today exists for the length of this transaction only when the register has none.
insert into public.seasons (name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture)
select 'Family Matrix Season', current_date - 100, current_date + 100, current_date - 110, 'union', extract(year from current_date - 100)::int, false
where internal.resolve_season_for_date('union', current_date) is null
  and not exists (select 1 from public.seasons where rugby_code = 'union' and season_year_start = extract(year from current_date - 100)::int);

-- ---------------------------------------------------------------------------------------------------------
-- Seed: two clubs; Club A has two teams. Every AJ.1 persona.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_a uuid; v_b uuid; v_t1 uuid; v_t2 uuid; v_tb uuid;
  v_ms uuid; v uuid; v_c1 uuid; v_c2 uuid; v_adult_child uuid;
begin
  v_a := pg_temp.put('clubA', pg_temp.club('Fam A'));
  v_b := pg_temp.put('clubB', pg_temp.club('Fam B'));
  v_t1 := pg_temp.put('teamA1', pg_temp.team(v_a, 'U12'));
  v_t2 := pg_temp.put('teamA2', pg_temp.team(v_a, 'U14'));
  v_tb := pg_temp.put('teamB1', pg_temp.team(v_b, 'U12'));

  v := pg_temp.persona('CA', pg_temp.put('CA', pg_temp.person('Club Admin')));
  perform pg_temp.member(v_a, v, 'CLUB_ADMIN');

  v := pg_temp.persona('SO', pg_temp.put('SO', pg_temp.person('Safeguarding')));
  v_ms := pg_temp.member(v_a, v, 'BASIC_USER');
  insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason, confirmation_state, confirmed_at)
  values (v, v_a, v_ms, 'SAFEGUARDING_OFFICER', 'ACTIVE', 'SAFEGUARDING_APPOINTMENT', pg_temp.f('CA'), 'matrix', 'CONFIRMED', now());

  v := pg_temp.persona('FS', pg_temp.put('FS', pg_temp.person('Fixtures')));
  perform pg_temp.member(v_a, v, 'FIXTURE_SECRETARY');

  v := pg_temp.persona('VO', pg_temp.put('VO', pg_temp.person('Volunteer')));
  v_ms := pg_temp.member(v_a, v, 'BASIC_USER');
  insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason)
  values (v, v_a, v_ms, 'VOLUNTEER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', pg_temp.f('CA'), 'matrix');

  v := pg_temp.persona('MB', pg_temp.put('MB', pg_temp.person('Member')));
  perform pg_temp.member(v_a, v, 'BASIC_USER');

  v := pg_temp.persona('CO', pg_temp.put('CO', pg_temp.person('Coach')));
  perform pg_temp.team_role(pg_temp.member(v_a, v, 'BASIC_USER'), v_t1, 'coach');

  v := pg_temp.persona('TM', pg_temp.put('TM', pg_temp.person('Manager')));
  perform pg_temp.team_role(pg_temp.member(v_a, v, 'BASIC_USER'), v_t1, 'manager');

  v := pg_temp.persona('TA', pg_temp.put('TA', pg_temp.person('TeamAdmin')));
  perform pg_temp.team_role(pg_temp.member(v_a, v, 'BASIC_USER'), v_t1, 'team_admin');

  v := pg_temp.persona('PL', pg_temp.put('PL', pg_temp.person('Adult Player', (current_date - interval '30 years')::date)));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Adult', 'Player', (current_date - interval '30 years')::date, 'MALE', v)
  returning id into v;
  perform pg_temp.put('PL_player', v);

  v := pg_temp.persona('PG', pg_temp.put('PG', pg_temp.person('Parent')));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'One', (current_date - interval '11 years')::date, 'MALE') returning id into v_c1;
  perform pg_temp.put('C1', v_c1);
  insert into public.player_team_memberships (player_id, team_id, status) values (v_c1, v_t1, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v, v_c1, 'parent', 'active');
  perform pg_temp.put('G_PG_C1', (select id from public.guardians where guardian_user_id = v and player_id = v_c1));

  v := pg_temp.persona('OP', pg_temp.put('OP', pg_temp.person('Other Parent')));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'Two', (current_date - interval '13 years')::date, 'MALE') returning id into v_c2;
  perform pg_temp.put('C2', v_c2);
  insert into public.player_team_memberships (player_id, team_id, status) values (v_c2, v_t2, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v, v_c2, 'parent', 'active');

  v := pg_temp.persona('OCA', pg_temp.put('OCA', pg_temp.person('Other Club Admin')));
  perform pg_temp.member(v_b, v, 'CLUB_ADMIN');

  v := pg_temp.persona('OCO', pg_temp.put('OCO', pg_temp.person('Other Team Coach')));
  perform pg_temp.team_role(pg_temp.member(v_a, v, 'BASIC_USER'), v_t2, 'coach');

  v := pg_temp.persona('SUS', pg_temp.put('SUS', pg_temp.person('Suspended Admin')));
  v_ms := pg_temp.member(v_a, v, 'CLUB_ADMIN');
  update public.club_memberships set state = 'SUSPENDED', suspended_level = 'CLUB', suspended_at = now(), suspended_by = pg_temp.f('CA') where id = v_ms;

  v := pg_temp.persona('SITE', pg_temp.put('SITE', pg_temp.person('Full Site Admin')));
  insert into public.site_admins (user_id, status, admin_role) values (v, 'active', 'full');

  -- The parent again, on an AAL1 session (no AAL enforcement until Slice 6).
  perform pg_temp.persona('PG_AAL1', pg_temp.f('PG'), jsonb_build_object('sub', pg_temp.f('PG'), 'role', 'authenticated', 'aal', 'aal1'));

  -- A guardian of a player who is now an adult (FR-6).
  v := pg_temp.put('PG_ADULT', pg_temp.person('Parent Of Adult'));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Grown', 'Up', (current_date - interval '19 years')::date, 'MALE') returning id into v_adult_child;
  perform pg_temp.put('C_ADULT', v_adult_child);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v, v_adult_child, 'parent', 'active');

  -- A 14-year-old with their own login.
  v := pg_temp.put('MINOR', pg_temp.person('Minor', (current_date - interval '14 years')::date));
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Young', 'Login', (current_date - interval '14 years')::date, 'MALE', v)
  returning id into v;
  perform pg_temp.put('MINOR_player', v);
  insert into public.player_team_memberships (player_id, team_id, status) values (v, v_t2, 'active');

  perform pg_temp.persona('ANON', null);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA1 player.profile.view
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_c1 text := quote_literal(pg_temp.f('C1'));
begin
  perform pg_temp.expect_set(pg_temp.allowed_for('internal.can_player_as_family(''player.profile.view'', ' || v_c1 || ')'),
    'PG,PG_AAL1', 'FA1a family view of a child: the guardian only (AAL1 answers as AAL2 until Slice 6)');
  perform pg_temp.expect_set(pg_temp.allowed_for('internal.can_player_at_club_or_team(''player.profile.view'', ' || v_c1 || ')'),
    'CA,CO,SO,TA,TM', 'FA1b staff view of a child: Club Admin, Safeguarding Officer, the team''s Coach and Team Manager (J.6; Team Administration is held with its Team Manager base role)');
  perform pg_temp.expect_set(pg_temp.allowed_for('exists (select 1 from public.players where id = ' || v_c1 || ')'),
    'PG,PG_AAL1,SITE', 'FA1c the players table shows a child to the guardian and site.users.view only');
  perform pg_temp.expect_set(pg_temp.allowed_for('exists (select 1 from public.player_staff_view where id = ' || v_c1 || ')'),
    'CA,CO,FS,SITE,SO,TA,TM', 'FA1d player_staff_view shows the child to the staff who may view them or act on them in team operations (D-4a-1: the FS through call-ups, never the family graph) and to site.users.view');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'player_staff_view'
                                     and column_name in ('date_of_birth', 'user_id', 'playing_pathway')),
    'FA1e player_staff_view carries no date of birth, login id or recorded gender');
  perform pg_temp.check(not exists (select 1 from public.guardians g where g.player_id = pg_temp.f('C1')
                                    and pg_temp.bool_as(pg_temp.f('FS'), format('exists (select 1 from public.guardians where id = %L)', g.id))),
    'FA1h AI #70: the Fixtures Secretary never reads a child''s guardians (the family graph)');
  perform pg_temp.check(pg_temp.bool_as(pg_temp.f('CO'), '(select age_grade from public.player_staff_view where id = ' || v_c1 || ') = '
      || coalesce(quote_literal((select g.canonical_age_group from internal.resolve_player_age_grade('union', internal.resolve_season_for_date('union', current_date),
                          (select date_of_birth from public.players where id = pg_temp.f('C1'))) g)), 'null')),
    'FA1f staff see the age grade instead');
  perform pg_temp.expect_set(pg_temp.allowed_for('exists (select 1 from public.player_staff_view where id = ' || quote_literal(pg_temp.f('C2')) || ')'),
    'CA,FS,OCO,SITE,SO', 'FA1g another team''s child: not this team''s Coach, Team Manager or Team Administration');
end $$;

-- A gap in the canonical season register (between seasons) must not take the staff projection down with it.
do $$
begin
  update public.seasons set ends_on = current_date - 1
  where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on;
  perform pg_temp.check(internal.resolve_season_for_date('union', current_date) is null
      and pg_temp.bool_as(pg_temp.f('CO'), format('exists (select 1 from public.player_staff_view where id = %L and age_grade is null)', pg_temp.f('C1'))),
    'FA1i with no season covering today the staff view still answers, with no age grade rather than an error');
  raise exception using errcode = 'ZZ998';
exception when sqlstate 'ZZ998' then null;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA2 player.profile.edit / edit_protected
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_c1 text := quote_literal(pg_temp.f('C1'));
begin
  perform pg_temp.expect_set(pg_temp.allowed_for('internal.can_player_as_family(''player.profile.edit'', ' || v_c1 || ')'),
    'PG,PG_AAL1', 'FA2a player.profile.edit for a child: the guardian only');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.set_player_playing_pathway(' || v_c1 || ', ''MALE'')'),
    'PG,PG_AAL1,SITE', 'FA2b recording a child''s gender: guardian, or Ovalball through site.users.identity.correct; never staff');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.set_player_playing_pathway(' || v_c1 || ', ''FEMALE'')'),
    'SITE', 'FA2c changing a recorded gender: site.users.identity.correct only (set once for the guardian)');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.set_player_avatar(' || v_c1 || ', '''')'),
    'PG,PG_AAL1', 'FA2d changing a child''s picture: the guardian only');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA3 player.pathway.request
-- ---------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.request_player_playing_pathway(' || quote_literal(pg_temp.f('C1')) || ')'),
    'CA,CO,TA,TM', 'FA3 asking a child''s guardians for missing information: Club Admin, the team''s Coach and Team Manager (and Team Administration through its base role)');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA4 family.relationship.approve
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_req uuid; v_add uuid; v_requester uuid; v_added uuid;
begin
  -- A first-child request, matched to the child already on Team A1.
  v_requester := pg_temp.persona('REQ', pg_temp.put('REQ', pg_temp.person('Requester')));
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code,
    submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id)
  values ('FIRST_CHILD', 'PENDING', v_requester, v_requester, pg_temp.f('clubA'), 'union', 'Child', 'One',
    (select date_of_birth from public.players where id = pg_temp.f('C1')), pg_temp.f('C1'))
  returning id into v_req;
  perform pg_temp.put('REQ_first', v_req);
  perform pg_temp.expect_set(pg_temp.allowed_for('internal.can_decide_guardian_link_request(' || quote_literal(v_req) || ')'),
    'CA,TA,TM', 'FA4a a first child is decided by the club or the child''s team (TM, TA); never the requester, a coach, the FS, SO or the child''s existing guardian');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.reject_guardian_link_request(' || quote_literal(v_req) || ', ''matrix'')'),
    'CA,TA,TM', 'FA4b the decision RPC refuses everyone else, including the requester');

  -- An additional guardian the added person has accepted.
  v_added := pg_temp.put('ADDED', pg_temp.person('Added Guardian'));
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, invited_email, club_id, target_player_id,
    subject_response, subject_responded_at)
  values ('ADDITIONAL_GUARDIAN', 'PENDING', pg_temp.f('PG'), v_added, 'added@ovalball.test', pg_temp.f('clubA'), pg_temp.f('C1'), 'ACCEPTED', now())
  returning id into v_add;
  perform pg_temp.persona('ADDED', v_added);
  perform pg_temp.expect_set(pg_temp.allowed_for('internal.can_decide_guardian_link_request(' || quote_literal(v_add) || ')'),
    'CA', 'FA4c an additional guardian is decided at club level only; not the team, the requesting parent or the added person');
  delete from matrix_person where label in ('REQ', 'ADDED');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA5 removal and hold
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_g text := quote_literal(pg_temp.f('G_PG_C1'));
begin
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.remove_guardian_relationship(' || v_g || ', ''matrix'')'),
    'CA', 'FA5a a club removes a guardian relationship through family.relationship.remove at the child''s club');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.transition_guardian_relationship(' || v_g || ', ''REVOKED'', ''matrix'')'),
    'CA,PG,PG_AAL1,SITE', 'FA5b ending a relationship: the club, Ovalball, or the guardian themselves');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.transition_guardian_relationship(' || v_g || ', ''SUSPENDED'', ''matrix'', true)'),
    'SITE', 'FA5c a hold is Ovalball''s (site.family.manage, AN-7); never the club or the guardian');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA6 family.permission.manage and player.account.invite; FA7 family.duplicate.resolve
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_c1 text := quote_literal(pg_temp.f('C1')); v_review uuid;
begin
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.set_guardian_player_permission(' || v_c1 || ', ''view_fixtures'', true)'),
    'PG,PG_AAL1', 'FA6a a child''s consent settings: the child''s own guardian only');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.invite_player_account(' || v_c1 || ', ''child1@ovalball.test'')'),
    'PG,PG_AAL1', 'FA6b inviting a child''s own login: the child''s guardian only');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.get_player_permission_summary(' || v_c1 || ')'),
    'PG,PG_AAL1,SITE', 'FA6c reading a child''s consent summary: the guardian, or Ovalball through site.family.manage');

  insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway,
    matched_player_id, submitted_by, requesting_guardian_user_id)
  values (pg_temp.f('teamA1'), 'Child', 'One', (select date_of_birth from public.players where id = pg_temp.f('C1')), 'MALE', pg_temp.f('C1'),
    pg_temp.f('OP'), pg_temp.f('OP'))
  returning id into v_review;
  perform pg_temp.expect_set(pg_temp.succeeds_for('select public.resolve_player_duplicate_review_as_existing(' || quote_literal(v_review) || ')'),
    'CA', 'FA7a a possible duplicate child is resolved by the club only (never a coach, team manager or the applicant)');
  perform pg_temp.expect_set(pg_temp.allowed_for('exists (select 1 from public.player_duplicate_reviews where id = ' || quote_literal(v_review) || ')'),
    'CA,OP,SITE', 'FA7b a duplicate review is read by the club, the applicant and site.family.manage');
  perform pg_temp.expect_set(pg_temp.succeeds_for('select * from public.get_team_guardian_directory(' || quote_literal(pg_temp.f('teamA1')) || ') limit 1'),
    'CA,CO,FS,MB,OCA,OCO,OP,PG,PG_AAL1,PL,SITE,SO,SUS,TA,TM,VO', 'FA7c the guardian directory is not anonymous; it answers the signed in (rows are filtered inside)');
  perform pg_temp.expect_set(pg_temp.allowed_for('exists (select 1 from public.get_team_guardian_directory(' || quote_literal(pg_temp.f('teamA1')) || '))'),
    'CA,SITE', 'FA7d but lists a team''s guardians only to the club and site.family.manage');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA8 family.child.add
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_dob date := (current_date - interval '9 years')::date; r record; v_child uuid; v_req uuid;
begin
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('MB'),
    format('select * from public.add_child_for_guardian(%L, %L, %L, %L, %L, %L)', 'Member', 'Child', v_dob, pg_temp.f('clubA'), 'union', 'MALE')) = '42501',
    'FA8a a club member with no child at the club cannot add one (membership is not a family relationship)');
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('OCA'),
    format('select * from public.add_child_for_guardian(%L, %L, %L, %L, %L, %L)', 'Other', 'Child', v_dob, pg_temp.f('clubA'), 'union', 'MALE')) = '42501',
    'FA8b another club''s admin cannot add a child at this club');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.f('PG'), 'role', 'authenticated')::text, true);
  select * into r from public.add_child_for_guardian('Second', 'Child', v_dob, pg_temp.f('clubA'), 'union', 'MALE');
  perform set_config('request.jwt.claims', '', true);
  v_child := r.player_id;
  perform pg_temp.check(r.result = 'under_review' and v_child is not null, 'FA8c a guardian at the club adds a second child: it waits for the club');
  perform pg_temp.check((select state from public.guardians where player_id = v_child and guardian_user_id = pg_temp.f('PG')) = 'PENDING_APPROVAL',
    'FA8d the relationship is PENDING_APPROVAL (N.1 SELF_ADDED_CHILD)');
  perform pg_temp.check(not pg_temp.bool_as(pg_temp.f('PG'), format('internal.can_player_as_family(%L, %L)', 'player.profile.view', v_child)),
    'FA8e PENDING_APPROVAL confers nothing: the parent cannot yet view the child they added');
  select id into v_req from public.guardian_link_requests where kind = 'SELF_ADDED_CHILD' and target_player_id = v_child;
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('PG'), format('select * from public.approve_guardian_link_request(%L)', v_req)) = '42501',
    'FA8f the parent cannot approve their own added child');
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('CA'), format('select * from public.approve_guardian_link_request(%L)', v_req)) = 'OK',
    'FA8g the club approves it');
  perform pg_temp.check((select state from public.guardians where player_id = v_child and guardian_user_id = pg_temp.f('PG')) = 'ACTIVE'
                        and pg_temp.bool_as(pg_temp.f('PG'), format('internal.can_player_as_family(%L, %L)', 'player.profile.view', v_child)),
    'FA8h once approved the relationship is ACTIVE and the parent sees the child');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA9 adults only
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_dob date := (current_date - interval '10 years')::date;
begin
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('MINOR'),
    format('select * from public.request_child_link(%L, %L, %L, %L)', 'Some', 'Child', v_dob, pg_temp.f('clubA'))) = '42501',
    'FA9a a minor cannot ask to be linked to a child (family.relationship.request is minor-prohibited)');
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('MB'),
    format('select * from public.request_child_link(%L, %L, %L, %L)', 'Some', 'Child', v_dob, pg_temp.f('clubA'))) = 'OK',
    'FA9b an adult can ask (the request confers nothing)');
  perform pg_temp.check(pg_temp.try_as(pg_temp.put('YOUNG', pg_temp.person('Under Eighteen', (current_date - interval '16 years')::date)),
    format('select public.create_own_player_profile(%L, %L, %L, %L)', 'Under', 'Eighteen', (current_date - interval '16 years')::date, 'MALE')) in ('42501', '23514'),
    'FA9c self-registration as a player is for adults (player.self_register, age gate)');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA10 FR-6
-- ---------------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  select * into r from pg_temp.decide(pg_temp.f('PG_ADULT'), 'player.profile.view', 'child', null, null, pg_temp.f('C_ADULT'));
  perform pg_temp.check(not r.allowed and r.reason_code = 'ADULT_PLAYER', 'FA10a an adult player''s guardian holds no child-scope authority (ADULT_PLAYER)');
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('PG_ADULT'), format('select public.set_player_playing_pathway(%L, %L)', pg_temp.f('C_ADULT'), 'MALE')) = '42501',
    'FA10b nor can they record the adult''s details');
  perform pg_temp.check((select state from public.guardians where player_id = pg_temp.f('C_ADULT')) = 'ACTIVE',
    'FA10c the relationship row and its history stay');
  select * into r from pg_temp.decide(pg_temp.f('PG'), 'player.profile.view', 'child', null, null, pg_temp.f('C1'));
  perform pg_temp.check(r.allowed and r.decisive_rule = '6', 'FA10d a child under 18 is unaffected');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA14 the guard behind the guard: cases where one check would hide the absence of another (mutation testing)
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_own uuid; v_req uuid; v_dual uuid; v_teen uuid;
begin
  -- A Club Admin who is also a parent never decides their own request (N.1), though they decide everyone else's.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Admins', 'Own', (current_date - interval '9 years')::date, 'MALE')
  returning id into v_own;
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code, target_player_id,
    submitted_first_name, submitted_surname, submitted_date_of_birth)
  values ('SELF_ADDED_CHILD', 'PENDING', pg_temp.f('CA'), pg_temp.f('CA'), pg_temp.f('clubA'), 'union', v_own, 'Admins', 'Own', (current_date - interval '9 years')::date)
  returning id into v_req;
  perform pg_temp.check(not pg_temp.bool_as(pg_temp.f('CA'), format('internal.can_decide_guardian_link_request(%L)', v_req))
      and pg_temp.try_as(pg_temp.f('CA'), format('select public.approve_guardian_link_request(%L)', v_req)) = '42501',
    'FA14a a Club Admin cannot approve the child they added themselves (the requester never decides)');

  -- Club Admin at Club B and a plain member at Club A: B's authority never answers for A's players.
  v_dual := pg_temp.person('Dual Club');
  perform pg_temp.member(pg_temp.f('clubA'), v_dual, 'BASIC_USER');
  perform pg_temp.member(pg_temp.f('clubB'), v_dual, 'CLUB_ADMIN');
  perform pg_temp.check(not pg_temp.bool_as(v_dual, format('internal.can_player_at_club_or_team(%L, %L)', 'player.profile.view', pg_temp.f('C1')))
      and pg_temp.bool_as(pg_temp.f('CA'), format('internal.can_player_at_club_or_team(%L, %L)', 'player.profile.view', pg_temp.f('C1'))),
    'FA14b authority at one of my clubs never answers for a player at another club where I am only a member');

  -- FR-6: the guardian row of an adult player stays, but it no longer manages their consent settings.
  perform pg_temp.check(pg_temp.try_as(pg_temp.f('PG_ADULT'), format('select public.set_guardian_player_permission(%L, %L, true)', pg_temp.f('C_ADULT'), 'view_fixtures')) = '42501',
    'FA14c an adult player''s guardian cannot change their consent settings (ADULT_PLAYER, though the relationship row is ACTIVE)');

  -- A 14-year-old's account cannot self-register by typing an adult date of birth: the account's age decides.
  v_teen := pg_temp.person('Teen No Player', (current_date - interval '14 years')::date);
  perform pg_temp.check(pg_temp.try_as(v_teen, format('select public.create_own_player_profile(%L, %L, %L, %L)', 'Teen', 'Claims', (current_date - interval '25 years')::date, 'MALE')) = '42501'
      and not exists (select 1 from public.players where user_id = v_teen),
    'FA14d a minor account cannot self-register as a player by claiming an adult date of birth (player.self_register is minor-prohibited)');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA11 direct table writes
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_table text; v_people text; v_c1 uuid := pg_temp.f('C1');
begin
  foreach v_table in array array['players', 'guardians', 'guardian_link_requests', 'guardian_player_permissions',
                                  'player_account_invitations', 'player_duplicate_reviews', 'guardian_invitations'] loop
    perform pg_temp.expect_set(pg_temp.succeeds_for(format('delete from public.%I where false', v_table)), '',
      format('FA11 %s: no browser role can delete', v_table));
    perform pg_temp.expect_set(pg_temp.succeeds_for(format('update public.%I set id = id where false', v_table)), '',
      format('FA11 %s: no browser role can update', v_table));
  end loop;
  perform pg_temp.expect_set(pg_temp.succeeds_for(format('insert into public.guardians (guardian_user_id, player_id, relationship_type) values (auth.uid(), %L, ''parent'')', v_c1)), '',
    'FA11 guardians: nobody inserts a relationship directly');
  perform pg_temp.expect_set(pg_temp.succeeds_for(format('insert into public.players (first_name, surname) values (''Direct'', ''Insert'')')), '',
    'FA11 players: nobody inserts a player directly');
  perform pg_temp.expect_set(pg_temp.succeeds_for(format('insert into public.guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, actor) values (%L, ''view_fixtures'', auth.uid(), true, auth.uid())', v_c1)), '',
    'FA11 guardian_player_permissions: consent is written only through its RPC');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA12 pictures
-- ---------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.expect_set(pg_temp.allowed_for(format('internal.can_access_player_avatar(%L)', pg_temp.f('C1'))),
    'CA,PG,PG_AAL1', 'FA12a a child''s picture: the guardian and the club; a coach does not get a photo library');
  perform pg_temp.expect_set(pg_temp.allowed_for(format('internal.can_view_account_avatar(%L)', pg_temp.f('MINOR'))),
    'CA,OCO,SO', 'FA12b a 14-year-old''s account picture: staff who may view them (their team''s coach, the club, the SO) and nobody else here');
  perform pg_temp.check(pg_temp.bool_as(pg_temp.f('MINOR'), format('internal.can_view_account_avatar(%L)', pg_temp.f('MINOR'))),
    'FA12c the minor sees their own picture');
  perform pg_temp.expect_set(pg_temp.allowed_for(format('internal.can_view_account_avatar(%L)', pg_temp.f('CA'))),
    'CA,CO,FS,MB,OCA,OCO,OP,PG,PG_AAL1,PL,SITE,SO,SUS,TA,TM,VO', 'FA12d an adult''s account picture: any signed-in person (a suspended membership does not suspend the account)');
  perform pg_temp.check((select not public from storage.buckets where id = 'avatars'), 'FA12e the account picture bucket is private');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- FA13 shadow comparison (AA.4): the retained legacy helpers answer the same questions; every disagreement
-- must be one Phase 2 names. "+X" = X now allowed where the legacy helper refused; "-X" = X now refused.
-- ---------------------------------------------------------------------------------------------------------
create or replace function pg_temp.shadow(p_legacy text, p_new text) returns text language plpgsql as $$
declare v_l text[] := string_to_array(nullif(p_legacy, ''), ','); v_n text[] := string_to_array(nullif(p_new, ''), ',');
begin
  return coalesce((select string_agg(x, ',' order by substr(x, 2), x) from (
    select '+' || n as x from unnest(coalesce(v_n, '{}')) n where not (n = any (coalesce(v_l, '{}')))
    union all
    select '-' || l from unnest(coalesce(v_l, '{}')) l where not (l = any (coalesce(v_n, '{}')))
  ) d), '');
end $$;

do $$
declare v_c1 text := quote_literal(pg_temp.f('C1')); v_club text := quote_literal(pg_temp.f('clubA'));
        v_team text := quote_literal(pg_temp.f('teamA1')); v_req text := quote_literal(pg_temp.f('REQ_first'));
        v_legacy text; v_new text;
begin
  -- S1 seeing a child at all (base row or staff projection)
  v_legacy := pg_temp.allowed_for('internal.is_site_admin() or internal.is_active_player_guardian(' || v_c1 || ') or internal.can_manage_player(' || v_c1 || ')');
  v_new := pg_temp.allowed_for('exists (select 1 from public.players where id = ' || v_c1 || ') or exists (select 1 from public.player_staff_view where id = ' || v_c1 || ')');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '+SO',
    'FA13a seeing a child: the Safeguarding Officer gains the minimal view (T, J.6); the Fixtures Secretary keeps names through team operations only (D-4a-1) -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S2 asking a child's guardians for missing information
  v_legacy := pg_temp.allowed_for('internal.can_manage_player(' || v_c1 || ') or internal.is_site_admin()');
  v_new := pg_temp.succeeds_for('select public.request_player_playing_pathway(' || v_c1 || ')');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '-FS,-SITE',
    'FA13b asking for missing information: the Fixtures Secretary and a Site Admin without a club role lose it (J.6 player.pathway.request CO/TM/CA, no site master) -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S3 deciding a first-child request
  v_legacy := pg_temp.allowed_for('internal.has_capability(''club.guardians.manage'', ''club'', ' || v_club || ', null) or exists (select 1 from public.guardians g where g.guardian_user_id = auth.uid() and g.state = ''ACTIVE'' and g.player_id = ' || v_c1 || ')');
  v_new := pg_temp.allowed_for('internal.can_decide_guardian_link_request(' || v_req || ')');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '-PG,-PG_AAL1,+TA,+TM',
    'FA13c deciding a first child: the child''s existing guardian no longer decides; the team''s Team Manager / Team Administration do (N.1, J.6) -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S4 resolving a duplicate child
  v_legacy := pg_temp.allowed_for('internal.has_capability(''team.guardians.invite'', ''team'', ' || v_club || ', ' || v_team || ') or internal.has_capability(''team.guardians.invite'', ''club'', ' || v_club || ', null)');
  v_new := pg_temp.allowed_for('internal.can(''family.duplicate.resolve'', ''club'', ' || v_club || ', null, null)');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) in ('-CO,-TA,-TM', '-CO,-TM,-TA'),
    'FA13d resolving a duplicate child: team staff lose it; the club keeps it (J.6 family.duplicate.resolve CL) -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S5 removing a guardian relationship at the club
  v_legacy := pg_temp.allowed_for('internal.has_capability(''club.guardians.manage'', ''club'', ' || v_club || ', null)');
  v_new := pg_temp.allowed_for('internal.can(''family.relationship.remove'', ''club'', ' || v_club || ', null, null)');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '', 'FA13e removing a relationship at the club: no change -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S6 recording a child's gender
  v_legacy := pg_temp.allowed_for('internal.may_complete_player_profile(' || v_c1 || ')');
  v_new := pg_temp.allowed_for('internal.can_player_as_family(''player.profile.edit_protected'', ' || v_c1 || ') or internal.has_site_capability(''site.users.identity.correct'')');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '', 'FA13f recording a child''s gender: no change -- ' || pg_temp.shadow(v_legacy, v_new));

  -- S7 a child's picture
  v_legacy := pg_temp.allowed_for('internal.is_active_player_guardian(' || v_c1 || ') or internal.has_capability(''club.guardians.manage'', ''club'', ' || v_club || ', null)');
  v_new := pg_temp.allowed_for('internal.can_access_player_avatar(' || v_c1 || ')');
  perform pg_temp.check(pg_temp.shadow(v_legacy, v_new) = '', 'FA13g a child''s picture: no change -- ' || pg_temp.shadow(v_legacy, v_new));
end $$;

rollback;
