-- BUNDLE / LEGACY PARITY (Identity/Auth Slice 3, Phase 2 AF).
--
-- The role bundles replaced role_capability_defaults. Parity rule: every legacy role default is still
-- held by the role's bundle, except the intended removals Phase 2 lists (AF, J.7, J.15, U) -- written
-- out below, row by row, so an accidental loss cannot hide among them.
--
--   BP1  the archive of the old defaults is intact (139 rows)
--   BP2  every archived default is in the bundle projection, or is one of the 31 intended removals
--   BP3  the intended removals are exactly those 31
--   BP4  behaviour: a real person holding each legacy role passes has_capability for every retained default
--   BP5  behaviour: and fails for each intended removal
--   BP6  the retained additions beyond the J bundles (legacy authority kept) are exactly the three recorded
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

create temp table intended_removals (scope_type text, role_key text, capability_key text, why text) on commit drop;
insert into intended_removals values
  ('club', 'CLUB_MEMBER', 'people.view', 'J.3: the member list is CA/FS/SO; the key was never enforced'),
  ('club', 'FIXTURE_SECRETARY', 'approve_player_dispensations', 'U: club dispensation approval is excluded from FS'),
  ('team', 'CLUB_ADMIN', 'approve_player_dispensations', 'J.7 SPLIT: CA decides the club stage; the team stage is TM/TA'),
  ('team', 'TEAM_MANAGER', 'approve_fixture_callups', 'AF: call-up approval is club-only'),
  ('team', 'TEAM_MANAGER', 'fixture.bulk_edit', 'AF: bulk edit is club-only'),
  ('team', 'TEAM_MEMBER', 'calendar.view', 'J.15: TEAM_MEMBER dropped'),
  ('team', 'TEAM_MEMBER', 'fixture.view', 'J.15: TEAM_MEMBER dropped'),
  ('team', 'TEAM_MEMBER', 'team.view', 'J.15: TEAM_MEMBER dropped'),
  ('team', 'TEAM_STAFF', 'approve_fixture_callups', 'AF: call-up approval is club-only'),
  ('team', 'TEAM_STAFF', 'approve_player_dispensations', 'AF: team dispensation approval defaults removed for coaches'),
  ('team', 'TEAM_STAFF', 'fixture.bulk_edit', 'AF: bulk edit is club-only'),
  -- Slice 4B (AA.3 row 4b) retires the legacy team.view key. Its replacement team.team.view is held by
  -- every one of these bundles, so nobody loses sight of a team; what goes is the legacy key itself and
  -- the roster implication it used to carry for the Fixtures Secretary (AI #70).
  ('club', 'CLUB_ADMIN', 'team.view', 'AA.3 4b: retired in favour of team.team.view'),
  ('club', 'FIXTURE_SECRETARY', 'team.view', 'AA.3 4b: retired; FS keeps team.team.view and gains no roster (AI #70)'),
  ('club', 'CLUB_MEMBER', 'team.view', 'AA.3 4b: retired in favour of team.team.view'),
  ('team', 'CLUB_ADMIN', 'team.view', 'AA.3 4b: retired in favour of team.team.view'),
  ('team', 'TEAM_STAFF', 'team.view', 'AA.3 4b: retired in favour of team.team.view'),
  ('team', 'TEAM_MANAGER', 'team.view', 'AA.3 4b: retired in favour of team.team.view'),
  -- Slice 4E (AA.3 row 4e) retires the legacy calendar.manage and calendar.view keys. Their
  -- replacements calendar.event.manage and calendar.event.view are held by every one of these
  -- bundles, so nobody loses a calendar; what goes is the legacy key. team/TEAM_MEMBER/calendar.view
  -- is NOT repeated here -- it is already listed above under J.15, where the whole role was dropped.
  ('club', 'CLUB_ADMIN', 'calendar.manage', 'AA.3 4e: retired in favour of calendar.event.manage'),
  ('club', 'FIXTURE_SECRETARY', 'calendar.manage', 'AA.3 4e: retired in favour of calendar.event.manage'),
  ('team', 'CLUB_ADMIN', 'calendar.manage', 'AA.3 4e: retired in favour of calendar.event.manage'),
  ('team', 'TEAM_MANAGER', 'calendar.manage', 'AA.3 4e: retired in favour of calendar.event.manage'),
  ('club', 'CLUB_ADMIN', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  ('club', 'CLUB_MEMBER', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  ('club', 'FIXTURE_SECRETARY', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  ('team', 'CLUB_ADMIN', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  ('team', 'TEAM_MANAGER', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  ('team', 'TEAM_STAFF', 'calendar.view', 'AA.3 4e: retired in favour of calendar.event.view'),
  -- Slice 4F (AA.3 row 4f) retires the legacy team.community.manage key. Design J.10 lines 514-515
  -- SPLIT it into messaging.announcement.send_club at club scope and messaging.announcement.send_team
  -- at team scope, and the adapter already mapped it to exactly those two, so no holder loses the
  -- ability to speak to their club or their team -- only the legacy key goes.
  ('club', 'CLUB_ADMIN', 'team.community.manage', 'AA.3 4f: SPLIT into messaging.announcement.send_club'),
  ('team', 'CLUB_ADMIN', 'team.community.manage', 'AA.3 4f: SPLIT into messaging.announcement.send_team'),
  ('team', 'TEAM_MANAGER', 'team.community.manage', 'AA.3 4f: SPLIT into messaging.announcement.send_team'),
  ('team', 'TEAM_STAFF', 'team.community.manage', 'AA.3 4f: SPLIT into messaging.announcement.send_team');

do $body$
declare
  v_n int; v_club uuid; v_team uuid; v_ca uuid; v_fs uuid; v_mb uuid; v_tm uuid; v_co uuid; v_ms uuid;
  r record; v_bad text[] := '{}'; v_ok boolean;
begin
  select count(*) into v_n from public.role_capability_defaults_legacy;
  perform pg_temp.check(v_n = 139, 'BP1: the archived legacy defaults are intact (' || v_n || ' rows)');

  select count(*) into v_n from (
    select scope_type, role_key, capability_key from public.role_capability_defaults_legacy
    except select scope_type, role_key, capability_key from public.role_capability_defaults
    except select scope_type, role_key, capability_key from intended_removals) x;
  perform pg_temp.check(v_n = 0, 'BP2: every legacy default is held by its bundle or is a listed intended removal (' || v_n || ' unexplained losses)');

  select count(*) into v_n from (
    select scope_type, role_key, capability_key from public.role_capability_defaults_legacy
    except select scope_type, role_key, capability_key from public.role_capability_defaults) x;
  perform pg_temp.check(v_n = 31 and not exists (
      select scope_type, role_key, capability_key from intended_removals
      except (select scope_type, role_key, capability_key from public.role_capability_defaults_legacy
              except select scope_type, role_key, capability_key from public.role_capability_defaults)),
    'BP3: the intended removals are exactly the 31 listed (' || v_n || ')');

  -- Behaviour, through the enforcement entry point, for a real holder of each legacy role.
  v_club := pg_temp.club('Parity'); v_team := pg_temp.team(v_club);
  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FS'); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_mb := pg_temp.person('MB'); perform pg_temp.member(v_club, v_mb);
  v_tm := pg_temp.person('TM'); v_ms := pg_temp.member(v_club, v_tm); perform pg_temp.team_role(v_ms, v_team, 'manager');
  v_co := pg_temp.person('CO'); v_ms := pg_temp.member(v_club, v_co); perform pg_temp.team_role(v_ms, v_team, 'coach');

  for r in
    select l.*, case l.role_key when 'CLUB_ADMIN' then v_ca when 'FIXTURE_SECRETARY' then v_fs when 'CLUB_MEMBER' then v_mb
                                 when 'TEAM_MANAGER' then v_tm when 'TEAM_STAFF' then v_co end as person,
           exists (select 1 from intended_removals i where i.scope_type = l.scope_type and i.role_key = l.role_key and i.capability_key = l.capability_key) as removed
    from public.role_capability_defaults_legacy l where l.role_key <> 'TEAM_MEMBER'
  loop
    v_ok := pg_temp.bool_as(r.person, format('internal.has_capability(%L, %L, %L::uuid, %L::uuid)', r.capability_key, r.scope_type, v_club,
                                              case when r.scope_type = 'team' then v_team end));
    -- A team-stage dispensation approval by a Club Admin is still reachable through the club stage key the
    -- consumer also checks, so the removal is asserted only for the roles that actually lose it.
    if (not r.removed and not v_ok) or (r.removed and v_ok and not (r.role_key = 'CLUB_ADMIN' and r.capability_key = 'approve_player_dispensations')) then
      v_bad := v_bad || format('%s/%s/%s=%s', r.scope_type, r.role_key, r.capability_key, v_ok);
    end if;
  end loop;
  perform pg_temp.check(array_length(v_bad, 1) is null, 'BP4/BP5: real holders keep every retained default and lose only the intended removals ' || coalesce(array_to_string(v_bad, ', '), ''));

  -- BP6: legacy authority kept beyond the J bundles, recorded in the Slice 3 report (section L)
  perform pg_temp.check(
    exists (select 1 from public.bundle_capabilities where bundle_key = 'CO' and capability_key = 'fixture.fixture.cancel' and scope_type = 'team')
    and exists (select 1 from public.bundle_capabilities where bundle_key = 'CO' and capability_key = 'team.graduation.place' and scope_type = 'team')
    and exists (select 1 from public.bundle_capabilities b join public.capabilities c on c.key = b.capability_key
                where b.bundle_key = 'CA' and b.capability_key = 'team.news.manage' and b.scope_type = 'club' and c.inherits_to_team),
    'BP6: the three retained legacy defaults (coach cancel, coach graduation placement, Club Admin team news) are held');
end $body$;

rollback;
