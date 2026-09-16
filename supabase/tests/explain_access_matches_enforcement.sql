-- EXPLANATION MATCHES ENFORCEMENT (Identity/Auth Slice 3, Phase 2 AC, attack 63).
--
-- There is one decision function. explain_access (why) and my_capabilities (what the interface may show)
-- are views of that one decision, so for every situation they must give exactly the answer enforcement
-- (internal.can / internal.has_capability) gives, and the explanation must name the same decisive rule.
--
--   X1      explanation = enforcement across a spread of truth-table situations, self and Site Admin view
--   X2-X3   a person sees why without the administrator's identity or reason; the club admin sees both
--   X4-X8   nobody explains another person without people.access.explain where they belong or site.users.view
--   X9      my_capabilities = enforcement for the caller
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
  k constant text := 'fixture.fixture.edit';
  v_club uuid; v_club_b uuid; v_team uuid;
  v_ca uuid; v_ca_b uuid; v_full uuid; v_ro uuid; v_member uuid; v_other uuid;
  v_s uuid; v_ms uuid; v_child uuid; v_g uuid;
  r record; e record; v_can boolean; v_state text; v_n int := 0; v_bad int := 0;
begin
  v_club := pg_temp.club('Explain'); v_club_b := pg_temp.club('Explain B'); v_team := pg_temp.team(v_club);
  v_ca := pg_temp.person('Club Admin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ca_b := pg_temp.person('Other Club Admin'); perform pg_temp.member(v_club_b, v_ca_b, 'CLUB_ADMIN');
  v_full := pg_temp.person('Full'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_ro := pg_temp.person('Read Only'); insert into public.site_admins (user_id, status, admin_role) values (v_ro, 'active', 'read_only');
  v_member := pg_temp.person('Member'); perform pg_temp.member(v_club, v_member);
  v_other := pg_temp.person('Other Member'); perform pg_temp.member(v_club, v_other);

  -- A spread of truth-table situations, one person each.
  create temp table scenarios (id text, subject uuid, key text, scope text, club uuid, team uuid, player uuid) on commit drop;

  v_s := pg_temp.person('E-bundle'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  insert into scenarios values ('bundle-club', v_s, k, 'club', v_club, null, null), ('bundle-team-inherit', v_s, k, 'team', v_club, v_team, null);

  v_s := pg_temp.person('E-suspended-role'); v_ms := pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  update public.role_assignments set state = 'SUSPENDED', suspended_level = 'CLUB', suspended_at = now(), suspended_by = v_ca,
    attributes = attributes || '{"suspension_cause":"ROLE"}' where membership_id = v_ms and role_key = 'FIXTURES_SECRETARY';
  insert into scenarios values ('role-suspended', v_s, k, 'club', v_club, null, null);

  v_s := pg_temp.person('E-site-deny'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'site', null, null, 'deny', 'SITE', v_full);
  insert into scenarios values ('site-deny', v_s, k, 'club', v_club, null, null);

  v_s := pg_temp.person('E-club-allow'); perform pg_temp.member(v_club, v_s);
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  insert into scenarios values ('club-allow', v_s, k, 'club', v_club, null, null), ('club-allow-inherits', v_s, k, 'team', v_club, v_team, null);

  v_s := pg_temp.person('E-team-role-at-club'); v_ms := pg_temp.member(v_club, v_s); perform pg_temp.team_role(v_ms, v_team, 'coach');
  insert into scenarios values ('team-role-at-club', v_s, k, 'club', v_club, null, null), ('team-role-at-team', v_s, k, 'team', v_club, v_team, null);

  insert into scenarios values ('site-admin-club-key', v_full, k, 'club', v_club, null, null),
                               ('site-master-control', v_full, 'site.club_roles.manage', 'site', null, null, null),
                               ('read-only-mutation', v_ro, 'site.clubs.profile.manage', 'site', null, null, null),
                               ('member-no-bundle', v_member, k, 'club', v_club, null, null),
                               ('legacy-key', v_ca, 'club.profile.edit', 'club', v_club, null, null);

  v_g := pg_temp.person('E-guardian');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Exp', 'Child', (current_date - interval '9 years')::date, 'MALE') returning id into v_child;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_g, v_child, 'parent', 'active');
  insert into scenarios values ('guardian-child', v_g, 'matchcentre.attendance.respond', 'child', null, null, v_child);

  -- 1. For every scenario the explanation equals enforcement, for the person themself and for a Site Admin
  for r in select * from scenarios loop
    v_n := v_n + 1;
    v_can := case when r.key like '%.%.%' or r.key like 'site.%' then
               pg_temp.can_as(r.subject, coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = r.key and m.legacy_scope = r.scope), r.key),
                              r.scope, r.club, r.team, r.player)
             else pg_temp.bool_as(r.subject, format('internal.has_capability(%L, %L, %L::uuid, %L::uuid)', r.key, r.scope, r.club, r.team)) end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', r.subject, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select * into e from public.explain_access(r.subject, r.key, r.scope, r.club, r.team, r.player);
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    if e.allowed is distinct from v_can
       or e.decisive_rule is distinct from (select d.decisive_rule from internal.capability_decision(r.subject,
            coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = r.key and m.legacy_scope = r.scope), r.key),
            r.scope, case when r.scope = 'team' then r.club else r.club end, r.team, r.player, false, false) d) then
      v_bad := v_bad + 1;
      raise notice 'mismatch % explain=% rule=% can=%', r.id, e.allowed, e.decisive_rule, v_can;
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_full, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select * into e from public.explain_access(r.subject, r.key, r.scope, r.club, r.team, r.player);
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    if e.allowed is distinct from v_can then
      v_bad := v_bad + 1;
      raise notice 'site-admin view mismatch % explain=% can=%', r.id, e.allowed, v_can;
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0 and v_n = 14, format('X1: explain_access equals enforcement for %s scenarios, self and Site Admin view (%s mismatches)', v_n, v_bad));

  -- 2. The trail names the decisive rule, and a self-explanation withholds who decided and why
  v_s := (select subject from scenarios where id = 'club-allow');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select * into e from public.explain_access(v_s, k, 'club', v_club, null, null);
  perform set_config('role', 'none', true);
  perform pg_temp.check(e.reason_code = 'EXPLICIT_ALLOW' and e.decisive_source ? 'level' and not (e.decisive_source ? 'granted_by')
                        and not (e.decisive_source ? 'reason') and jsonb_array_length(e.trail) >= 3,
    'X2: a person sees why (rule, level, trail) without the administrator''s identity or reason');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select * into e from public.explain_access(v_s, k, 'club', v_club, null, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(e.decisive_source ->> 'granted_by' = v_ca::text and e.decisive_source ->> 'reason' = 'truth table',
    'X3: the club''s administrator (people.access.explain) sees the full provenance');

  -- 3. Attack 63: explaining another person without authority is refused
  v_state := pg_temp.try_as(v_other, format('select * from public.explain_access(%L, %L, ''club'', %L, null, null)', v_member, k, v_club));
  perform pg_temp.check(v_state = '42501', 'X4: a member cannot explain another member (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca_b, format('select * from public.explain_access(%L, %L, ''club'', %L, null, null)', v_member, k, v_club));
  perform pg_temp.check(v_state = '42501', 'X5: another club''s admin cannot explain this club''s member (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca_b, format('select * from public.explain_access(%L, %L, ''club'', %L, null, null)', v_member, k, v_club_b));
  perform pg_temp.check(v_state = '42501', 'X6: nor by naming their own club for a person who does not belong to it (' || v_state || ')');
  v_state := pg_temp.try_as(v_ro, format('select * from public.explain_access(%L, %L, ''club'', %L, null, null)', v_member, k, v_club));
  perform pg_temp.check(v_state = 'OK', 'X7: a Read Only Site Admin may explain (site.users.view is a read) (' || v_state || ')');
  v_state := pg_temp.try_as(null, format('select * from public.explain_access(%L, %L, ''club'', %L, null, null)', v_member, k, v_club));
  perform pg_temp.check(v_state = '42501', 'X8: anonymous callers cannot explain anyone (' || v_state || ')');

  -- 4. my_capabilities answers exactly what enforcement answers, for the caller only
  select count(*) into v_bad
  from (select * from scenarios where scope = 'club' and subject <> v_full) s
  cross join lateral (
    select pg_temp.can_as(s.subject, c.key, 'club', s.club, null, null) as enforced, c.key
    from public.capabilities c where c.status = 'ACTIVE' and 'club' = any (c.valid_scopes) and c.key in (k, 'club.profile.view', 'people.role.assign_club', 'finance.payment.act')
  ) x
  where x.enforced is distinct from pg_temp.bool_as(s.subject, format('(select allowed from public.my_capabilities(''club'', %L::uuid) where capability_key = %L)', s.club, x.key));
  perform pg_temp.check(v_bad = 0, 'X9: my_capabilities agrees with enforcement for every sampled key (' || v_bad || ' mismatches)');
end $body$;

rollback;
