-- CAPABILITY PRECEDENCE TRUTH TABLE (Identity/Auth Slice 3, Phase 2 K.4).
--
-- Every row of the Phase 2 truth table, P01-P38, with the row id as the test id. Each row builds its
-- own people, so no row depends on another, and asserts the decision, the decisive rule and -- where
-- the subject is the caller -- that internal.can (the enforcement entry point) agrees.
--
-- P01 (AAL) and P07/P08 (impersonation) exercise rule 0 and rule 1 through their hooks: AAL enforcement
-- belongs to the authentication slice and impersonation to Slice 9, so each of those rows replaces the
-- hook inside this rolled-back transaction to prove the ORDER of evaluation, not a live policy.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

-- D-S5-1: an adult by default. These fixtures grant staff roles, and a staff role now needs a
-- recorded date of birth establishing adulthood; a suite that wants a minor or an unknown age
-- still says so explicitly at the call site.
create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date) returns uuid language plpgsql as $$
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

create or replace function pg_temp.row(p_id text, p_subject uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_player uuid,
                                       p_allowed boolean, p_rule text, p_label text, p_claims jsonb default null) returns void language plpgsql as $$
declare d record; v_can boolean;
begin
  select * into d from pg_temp.decide(p_subject, p_key, p_scope, p_club, p_team, p_player, p_claims);
  v_can := pg_temp.can_as(p_subject, p_key, p_scope, p_club, p_team, p_player, p_claims);
  perform pg_temp.check(d.allowed = p_allowed and d.decisive_rule = p_rule and v_can = p_allowed,
    format('%s: %s (allowed=%s rule=%s reason=%s can=%s)', p_id, p_label, d.allowed, d.decisive_rule, d.reason_code, v_can));
end $$;

grant execute on function pg_temp.can_as(uuid, text, text, uuid, uuid, uuid, jsonb) to public;

do $ptt$
declare
  k constant text := 'fixture.fixture.edit';   -- delegable (C/T), inherits to teams, held by CA/FS/CO/TM
  v_club uuid; v_club_b uuid; v_team uuid; v_team2 uuid; v_team_b uuid;
  v_ca uuid; v_ca2 uuid; v_ms uuid; v_s uuid; v_s_ms uuid; v_full uuid; v_ro uuid; v_ra uuid;
  v_child uuid; v_child_b uuid; v_g uuid; v_session uuid; v_p22 text;
begin
  v_club := pg_temp.club('Alpha'); v_club_b := pg_temp.club('Bravo');
  v_team := pg_temp.team(v_club); v_team2 := pg_temp.team(v_club, 'U14'); v_team_b := pg_temp.team(v_club_b);
  v_ca := pg_temp.person('Club Admin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ca2 := pg_temp.person('Second Club Admin'); perform pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_full := pg_temp.person('Full Site Admin'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_ro := pg_temp.person('Read Only Site Admin'); insert into public.site_admins (user_id, status, admin_role) values (v_ro, 'active', 'read_only');

  -- P01: an AAL1 session decides nothing (rule 0 through the AAL hook)
  v_s := pg_temp.person('P01'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  execute $f$create or replace function internal.session_aal_ok() returns boolean language sql stable set search_path = '' as $b$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $b$$f$;
  perform pg_temp.row('P01', v_s, k, 'club', v_club, null, null, false, '0', 'no authority below AAL2',
    jsonb_build_object('sub', v_s, 'role', 'authenticated', 'aal', 'aal1'));
  perform pg_temp.row('P01b', v_s, k, 'club', v_club, null, null, true, '5', 'the same request at AAL2 is decided normally',
    jsonb_build_object('sub', v_s, 'role', 'authenticated', 'aal', 'aal2'));
  execute $f$create or replace function internal.session_aal_ok() returns boolean language sql stable set search_path = '' as $b$ select true $b$$f$;

  -- P02: a minor never holds a minor-prohibited key, whatever allows it
  -- A minor on the PROFILE, not only on a player row: internal.person_is_minor reads the profile
  -- date of birth first, so a fixture that records the age only on the player record is relying
  -- on the profile being blank -- which D-S5-1 makes a different thing entirely.
  v_s := pg_temp.person('P02', (current_date - interval '15 years')::date); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Ptt', 'Minor', (current_date - interval '15 years')::date, 'MALE', v_s);
  perform pg_temp.row('P02', v_s, k, 'club', v_club, null, null, false, '1', 'hard prohibition beats every allow');

  -- P03: a suspended account decides nothing, even with a site allow
  v_s := pg_temp.person('P03'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'SITE', v_full);
  update public.profiles set account_state = 'SUSPENDED' where id = v_s;
  perform pg_temp.row('P03', v_s, k, 'club', v_club, null, null, false, '1', 'suspension beats a site allow');

  -- P04: a suspended membership gates club scope
  v_s := pg_temp.person('P04'); v_ms := pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  update public.club_memberships set state = 'SUSPENDED', suspended_level = 'CLUB', suspended_at = now(), suspended_by = v_ca where id = v_ms;
  perform pg_temp.row('P04', v_s, k, 'club', v_club, null, null, false, '1', 'membership state gates club scope');

  -- P05: a suspended role assignment contributes nothing
  v_s := pg_temp.person('P05'); v_ms := pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  update public.role_assignments set state = 'SUSPENDED', suspended_level = 'CLUB', suspended_at = now(), suspended_by = v_ca,
    attributes = attributes || '{"suspension_cause":"ROLE"}' where membership_id = v_ms and role_key = 'FIXTURES_SECRETARY';
  perform pg_temp.row('P05', v_s, k, 'club', v_club, null, null, false, '8', 'a suspended assignment contributes nothing');
  perform pg_temp.check((select reason_code from pg_temp.decide(v_s, k, 'club', v_club)) = 'ROLE_SUSPENDED', 'P05b: explained as ROLE_SUSPENDED');

  -- P06: a deactivated club denies club and team keys
  v_s := pg_temp.person('P06');
  declare v_club_d uuid := pg_temp.club('Deactivated'); begin
    perform pg_temp.member(v_club_d, v_s, 'FIXTURE_SECRETARY');
    perform pg_temp.override(v_s, k, 'club', v_club_d, null, 'grant', 'CLUB', v_ca);
    update public.clubs set status = 'deactivated' where id = v_club_d;
    perform pg_temp.row('P06', v_s, k, 'club', v_club_d, null, null, false, '1', 'inactive club denies club and team keys');
  end;

  -- P07: view-only impersonation refuses a write key (rule 1 through the impersonation hook)
  v_s := pg_temp.person('P07'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  execute $f$create or replace function internal.impersonation_mode() returns text language sql stable set search_path = '' as $b$ select 'VIEW'::text $b$$f$;
  perform pg_temp.row('P07', v_s, k, 'club', v_club, null, null, false, '1', 'view-only impersonation cannot write');
  perform pg_temp.row('P07b', v_s, 'fixture.fixture.view', 'club', v_club, null, null, true, '6', 'but may still view');

  -- P08: act-as impersonation refuses an impersonation-blocked key
  v_s := pg_temp.person('P08'); perform pg_temp.member(v_club, v_s, 'CLUB_ADMIN');
  execute $f$create or replace function internal.impersonation_mode() returns text language sql stable set search_path = '' as $b$ select 'ACT'::text $b$$f$;
  perform pg_temp.row('P08', v_s, 'finance.payment.act', 'club', v_club, null, null, false, '1', 'blocked list refuses while acting as someone');
  execute $f$create or replace function internal.impersonation_mode() returns text language sql stable set search_path = '' as $b$ select null::text $b$$f$;

  -- P09: a site withhold beats a club allow and the bundle
  v_s := pg_temp.person('P09'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'site', null, null, 'deny', 'SITE', v_full);
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P09', v_s, k, 'club', v_club, null, null, false, '2', 'site deny beats club allow and bundle');

  -- P10: a site withhold beats a site allow
  v_s := pg_temp.person('P10'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'site', null, null, 'deny', 'SITE', v_full);
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'SITE', v_full);
  perform pg_temp.row('P10', v_s, k, 'club', v_club, null, null, false, '2', 'deny beats allow at the same level');

  -- P11: a club withhold beats a club allow
  v_s := pg_temp.person('P11'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER'); perform pg_temp.team_role(v_ms, v_team, 'coach');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'deny', 'CLUB', v_ca);
  perform pg_temp.override(v_s, k, 'team', v_club, v_team, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P11', v_s, k, 'team', v_club, v_team, null, false, '3', 'club deny beats club allow');

  -- P12: a club withhold on an inheriting key reaches the team; a team allow cannot defeat it
  v_s := pg_temp.person('P12'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER'); perform pg_temp.team_role(v_ms, v_team, 'manager');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'deny', 'CLUB', v_ca);
  -- the team allow comes from a Team Admin of that team
  declare v_ta uuid := pg_temp.person('P12 Team Admin'); v_ta_ms uuid; begin
    v_ta_ms := pg_temp.member(v_club, v_ta, 'BASIC_USER'); perform pg_temp.team_role(v_ta_ms, v_team, 'team_admin');
    perform pg_temp.override(v_s, k, 'team', v_club, v_team, 'grant', 'TEAM', v_ta);
  end;
  perform pg_temp.row('P12', v_s, k, 'team', v_club, v_team, null, false, '3', 'a club deny on an inheriting key applies to the team');

  -- P13: a club withhold is scoped to its club
  v_s := pg_temp.person('P13'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.override(v_s, k, 'club', v_club_b, null, 'deny', 'CLUB', v_ca);
  perform pg_temp.row('P13', v_s, k, 'club', v_club, null, null, true, '6', 'deny is scoped to its club');

  -- P14: a team withhold beats an allow
  v_s := pg_temp.person('P14'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER'); perform pg_temp.team_role(v_ms, v_team, 'coach');
  perform pg_temp.override(v_s, k, 'team', v_club, v_team, 'deny', 'TEAM', v_ca);
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P14', v_s, k, 'team', v_club, v_team, null, false, '4', 'team deny beats an allow');

  -- P15: a team withhold is scoped to its team
  v_s := pg_temp.person('P15'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER'); perform pg_temp.team_role(v_ms, v_team, 'coach');
  perform pg_temp.override(v_s, k, 'team', v_club, v_team2, 'deny', 'TEAM', v_ca);
  perform pg_temp.row('P15', v_s, k, 'team', v_club, v_team, null, true, '6', 'deny scoped to its team');

  -- P16: a valid delegated allow
  v_s := pg_temp.person('P16'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P16', v_s, k, 'club', v_club, null, null, true, '5', 'valid delegated allow while the grantor is still Club Admin');

  -- P17: an allow whose grantor is no longer Club Admin is ignored
  v_s := pg_temp.person('P17'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  declare v_ex uuid := pg_temp.person('P17 former admin'); v_ex_ms uuid; begin
    v_ex_ms := pg_temp.member(v_club, v_ex, 'CLUB_ADMIN');
    perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ex);
    perform pg_temp.row('P17a', v_s, k, 'club', v_club, null, null, true, '5', 'valid while the grantor holds authority');
    update public.role_assignments set state = 'REVOKED', revoked_at = now(), revoked_by = v_ca, revocation_reason = 'truth table'
      where membership_id = v_ex_ms and role_key = 'CLUB_ADMIN';
    perform pg_temp.row('P17', v_s, k, 'club', v_club, null, null, false, '8', 'allow re-validated against current grantor authority');
  end;
  -- P17b: a grantor who still holds the key but no longer the delegation authority (Club Admin -> Fixtures Secretary)
  v_s := pg_temp.person('P17b'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  declare v_demoted uuid := pg_temp.person('P17b demoted admin'); v_d_ms uuid; begin
    v_d_ms := pg_temp.member(v_club, v_demoted, 'CLUB_ADMIN');
    perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_demoted);
    update public.role_assignments set state = 'REVOKED', revoked_at = now(), revoked_by = v_ca, revocation_reason = 'truth table'
      where membership_id = v_d_ms and role_key = 'CLUB_ADMIN';
    insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason)
      values (v_demoted, v_club, v_d_ms, 'FIXTURES_SECRETARY', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', v_ca, 'truth table');
    perform pg_temp.row('P17b', v_s, k, 'club', v_club, null, null, false, '8', 'holding the key is not enough: the grantor must still hold delegation authority');
  end;

  -- P18: a club-level allow on a non-delegable key is ignored
  v_s := pg_temp.person('P18'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, 'people.role.assign_club', 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P18', v_s, 'people.role.assign_club', 'club', v_club, null, null, false, '8', 'non-delegable key: a legacy club allow is ignored');

  -- P19: a site-level allow on a non-delegable key is valid
  v_s := pg_temp.person('P19'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, 'people.role.assign_club', 'club', v_club, null, 'grant', 'SITE', v_full);
  perform pg_temp.row('P19', v_s, 'people.role.assign_club', 'club', v_club, null, null, true, '5', 'site may grant any club key except hard prohibitions');

  -- P20: an allow never broadens upward
  v_s := pg_temp.person('P20'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, k, 'team', v_club, v_team, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P20', v_s, k, 'club', v_club, null, null, false, '8', 'a team allow does not answer the club');

  -- P21: a club allow flows down to teams when the key inherits
  v_s := pg_temp.person('P21'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P21', v_s, k, 'team', v_club, v_team, null, true, '5', 'club allow flows down when inheriting');

  -- P22: no downward flow without inheritance (a test-only key, since every catalogue club+team key inherits)
  v_p22 := 'fixture.truth_table.act';
  insert into public.capabilities (key, domain, resource, action, label, description, category, valid_scopes, inherits_to_team,
                                   grant_level, revoke_level, delegable, aal, safeguarding_sensitive)
  values (v_p22, 'fixture', 'truth_table', 'act', 'Truth Table Key', 'Test only.', 'fixture', array['club', 'team'], false, 'C', 'C', true, 'A2', false);
  insert into public.bundle_capabilities (bundle_key, capability_key, scope_type) values ('CA', v_p22, 'club');
  v_s := pg_temp.person('P22'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, v_p22, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  perform pg_temp.row('P22', v_s, v_p22, 'team', v_club, v_team, null, false, '8', 'no downward flow without inheritance');
  perform pg_temp.row('P22b', v_ca, v_p22, 'team', v_club, v_team, null, false, '8', 'nor for a club role bundle entry on a non-inheriting key');
  perform pg_temp.row('P22c', v_ca, v_p22, 'club', v_club, null, null, true, '6', 'which still answers at the club');

  -- P23: a Fixtures Secretary answers team fixture checks
  v_s := pg_temp.person('P23'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  perform pg_temp.row('P23', v_s, k, 'team', v_club, v_team, null, true, '6', 'club role inherits to the team');

  -- P24: a team role never answers a club key
  v_s := pg_temp.person('P24'); v_ms := pg_temp.member(v_club, v_s, 'BASIC_USER'); perform pg_temp.team_role(v_ms, v_team, 'coach');
  perform pg_temp.row('P24', v_s, k, 'club', v_club, null, null, false, '8', 'a team role never answers club keys');
  perform pg_temp.row('P24b', v_s, k, 'team', v_club, v_team, null, true, '6', 'while it answers its own team');

  -- P25: no blanket Site Admin bypass
  perform pg_temp.row('P25', v_full, k, 'club', v_club, null, null, false, '8', 'a Full Site Admin holds no club key by being Site Admin');

  -- P26: master control is a site key
  perform pg_temp.row('P26', v_full, 'site.club_roles.manage', 'site', null, null, null, true, '7', 'master control is a site capability');

  -- P27: Read Only has no mutation site keys
  perform pg_temp.row('P27', v_ro, 'site.clubs.profile.manage', 'site', null, null, null, false, '8', 'READ_ONLY has no mutation site keys');

  -- P28: a club withhold aimed at a site key has no effect on the site decision (and is refused on write)
  perform pg_temp.member(v_club, v_full, 'BASIC_USER');
  perform pg_temp.override(v_full, 'site.club_roles.manage', 'club', v_club, null, 'deny', 'CLUB', v_ca);
  perform pg_temp.row('P28', v_full, 'site.club_roles.manage', 'site', null, null, null, true, '7', 'site decisions ignore club overrides');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  begin
    perform public.set_capability_override(v_full, 'site.club_roles.manage', 'club', v_club, null, 'deny', 'no');
    perform pg_temp.check(false, 'P28b: a club override targeting a site key is refused on write');
  exception when others then
    perform pg_temp.check(sqlstate in ('22023', '42501'), 'P28b: a club override targeting a site key is refused on write (' || sqlstate || ')');
  end;
  perform set_config('request.jwt.claims', '', true);

  -- P29: a site withhold on a Site Admin's own person applies to their club authority
  declare v_sa uuid := pg_temp.person('P29 Site Admin and Club Admin'); begin
    insert into public.site_admins (user_id, status, admin_role) values (v_sa, 'active', 'full');
    perform pg_temp.member(v_club, v_sa, 'CLUB_ADMIN');
    perform pg_temp.override(v_sa, k, 'club', v_club, null, 'deny', 'SITE', v_full);
    perform pg_temp.row('P29', v_sa, k, 'club', v_club, null, null, false, '2', 'site deny on their own person applies to club authority');
    perform pg_temp.row('P29b', v_sa, 'site.clubs.view', 'site', null, null, null, true, '7', 'and leaves their site capabilities alone');
  end;

  -- P30: revocation of Site Admin is effective on the next request
  declare v_gone uuid := pg_temp.person('P30'); begin
    insert into public.site_admins (user_id, status, admin_role) values (v_gone, 'active', 'full');
    perform pg_temp.row('P30a', v_gone, 'site.users.view', 'site', null, null, null, true, '7', 'active Full Site Admin');
    update public.site_admins set status = 'revoked', revoked_at = now(), revoked_by = v_full where user_id = v_gone;
    perform pg_temp.row('P30', v_gone, 'site.users.view', 'site', null, null, null, false, '8', 'revocation effective next request');
  end;

  -- P31: a revoked allow is ignored
  v_s := pg_temp.person('P31'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  v_ra := pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca);
  update public.capability_overrides set status = 'revoked', revoked_at = now(), revoked_by = v_ca where id = v_ra;
  perform pg_temp.row('P31', v_s, k, 'club', v_club, null, null, false, '8', 'revoked overrides are ignored');

  -- P32: an expired allow is ignored
  v_s := pg_temp.person('P32'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, k, 'club', v_club, null, 'grant', 'CLUB', v_ca, now() - interval '1 minute');
  perform pg_temp.row('P32', v_s, k, 'club', v_club, null, null, false, '8', 'expiry honoured at decision time');

  -- P33-P35: family authority comes from the ACTIVE relationship, per child
  v_g := pg_temp.person('Guardian');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Ptt', 'Child A', (current_date - interval '10 years')::date, 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Ptt', 'Child B', (current_date - interval '10 years')::date, 'MALE') returning id into v_child_b;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_g, v_child, 'parent', 'active');
  perform pg_temp.row('P33', v_g, 'matchcentre.attendance.respond', 'child', null, null, v_child, true, '6', 'family derives from the relationship');
  perform pg_temp.row('P35', v_g, 'matchcentre.attendance.respond', 'child', null, null, v_child_b, false, '8', 'LC scope is per child');
  update public.guardians set status = 'revoked', state = 'REVOKED', revoked_at = now(), revoked_by = v_ca, revocation_reason = 'truth table'
    where guardian_user_id = v_g and player_id = v_child;
  perform pg_temp.row('P34', v_g, 'matchcentre.attendance.respond', 'child', null, null, v_child, false, '8', 'removal immediately removes derived access');

  -- P36: a club delegate cannot remove a site-level withhold
  v_s := pg_temp.person('P36'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  declare v_site_deny uuid := pg_temp.override(v_s, k, 'club', v_club, null, 'deny', 'SITE', v_full); begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
    begin
      perform public.revoke_capability_override(v_site_deny, 'club tries to lift it');
      perform pg_temp.check(false, 'P36: a club delegate removed a site-level deny');
    exception when others then
      perform pg_temp.check(sqlstate = '42501' and exists (select 1 from public.capability_overrides where id = v_site_deny and status = 'active'),
        'P36: a lower level cannot remove a higher decision (' || sqlstate || ')');
    end;
    perform set_config('request.jwt.claims', '', true);
  end;

  -- P37: a club delegate cannot add a club allow where a site withhold exists
  v_s := pg_temp.person('P37'); perform pg_temp.member(v_club, v_s, 'BASIC_USER');
  perform pg_temp.override(v_s, k, 'site', null, null, 'deny', 'SITE', v_full);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  begin
    perform public.set_capability_override(v_s, k, 'club', v_club, null, 'grant', 'club allow');
    perform pg_temp.check(false, 'P37: a club delegate added an allow under a site deny');
  exception when others then
    perform pg_temp.check(sqlstate = '42501' and not exists (select 1 from public.capability_overrides where user_id = v_s and effect = 'grant'),
      'P37: an ineffective and misleading allow is refused (' || sqlstate || ')');
  end;
  perform set_config('request.jwt.claims', '', true);

  -- P38: a revoked session (row deleted) decides nothing, though its JWT has not expired
  v_s := pg_temp.person('P38'); perform pg_temp.member(v_club, v_s, 'FIXTURE_SECRETARY');
  v_session := gen_random_uuid();
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_session, v_s, now(), now(), 'aal1');
  perform pg_temp.row('P38a', v_s, k, 'club', v_club, null, null, true, '6', 'a live session is decided normally',
    jsonb_build_object('sub', v_s, 'role', 'authenticated', 'session_id', v_session));
  delete from auth.sessions where id = v_session;
  perform pg_temp.row('P38', v_s, k, 'club', v_club, null, null, false, '0', 'per-session revocation',
    jsonb_build_object('sub', v_s, 'role', 'authenticated', 'session_id', v_session));
end $ptt$;

rollback;
