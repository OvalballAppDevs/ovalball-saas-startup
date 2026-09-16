-- CAPABILITY ATTACK MATRIX (Identity/Auth Slice 3, brief section 38; Phase 2 attacks 36, 37, 43, 63).
--
-- Every capability path this slice migrated, attacked from each position the brief names. Each attack is
-- a direct database call -- the same request a browser can make through the API without any screen.
--
--   AM1   anonymous caller
--   AM2   signed-in person with no relationship
--   AM3   same club, wrong role
--   AM4   wrong club
--   AM5   wrong team
--   AM6   suspended membership       AM7   revoked membership
--   AM8   suspended role             AM9   revoked role (stale context: the interface may still show the club)
--   AM10  explicit withhold
--   AM11  malformed scope            AM12  forged scope parameters
--   AM13  self-escalation            AM14  grant above the delegator's ceiling
--   AM15  Site Admin profiles against the explicit club-profile site capability (no Read Only write)
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

create or replace function pg_temp.rows_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_n int; v_state text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_state := v_n::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

do $body$
declare
  v_club uuid; v_club_b uuid; v_team uuid; v_team2 uuid; v_team_b uuid;
  v_ca uuid; v_ca2 uuid; v_ca_b uuid; v_fs uuid; v_member uuid; v_member_ms uuid; v_stranger uuid;
  v_ta uuid; v_ta_ms uuid; v_susp uuid; v_susp_ms uuid; v_rev uuid; v_rev_ms uuid; v_rsusp uuid; v_rsusp_ms uuid; v_rrev uuid; v_rrev_ms uuid;
  v_denied uuid; v_full uuid; v_data uuid; v_ro uuid;
  v_set text; v_s text; v_ok boolean; v_bad text[] := '{}'; a record;
begin
  v_club := pg_temp.club('Attack'); v_club_b := pg_temp.club('Attack B');
  v_team := pg_temp.team(v_club); v_team2 := pg_temp.team(v_club, 'U14'); v_team_b := pg_temp.team(v_club_b);
  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ca2 := pg_temp.person('CA2'); perform pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_ca_b := pg_temp.person('CA B'); perform pg_temp.member(v_club_b, v_ca_b, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FS'); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_member := pg_temp.person('Member'); v_member_ms := pg_temp.member(v_club, v_member);
  v_stranger := pg_temp.person('Stranger');
  v_ta := pg_temp.person('TA'); v_ta_ms := pg_temp.member(v_club, v_ta); perform pg_temp.team_role(v_ta_ms, v_team, 'team_admin');
  v_susp := pg_temp.person('Suspended CA'); v_susp_ms := pg_temp.member(v_club, v_susp, 'CLUB_ADMIN');
  perform pg_temp.try_as(v_ca, format('select public.transition_club_membership(%L, ''SUSPENDED'', ''attack matrix'')', v_susp_ms));
  v_rev := pg_temp.person('Revoked CA'); v_rev_ms := pg_temp.member(v_club, v_rev, 'CLUB_ADMIN');
  perform pg_temp.try_as(v_ca, format('select public.transition_club_membership(%L, ''REVOKED'', ''attack matrix'')', v_rev_ms));
  v_rsusp := pg_temp.person('Role-suspended CA'); v_rsusp_ms := pg_temp.member(v_club, v_rsusp, 'CLUB_ADMIN');
  perform pg_temp.try_as(v_ca, format('select public.transition_role_assignment((select id from public.role_assignments where membership_id = %L and role_key = ''CLUB_ADMIN''), ''SUSPENDED'', ''attack matrix'')', v_rsusp_ms));
  v_rrev := pg_temp.person('Role-revoked CA'); v_rrev_ms := pg_temp.member(v_club, v_rrev, 'CLUB_ADMIN');
  perform pg_temp.try_as(v_ca, format('select public.transition_role_assignment((select id from public.role_assignments where membership_id = %L and role_key = ''CLUB_ADMIN''), ''REVOKED'', ''attack matrix'')', v_rrev_ms));
  v_denied := pg_temp.person('Withheld CA'); perform pg_temp.member(v_club, v_denied, 'CLUB_ADMIN');
  v_full := pg_temp.person('Full'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_data := pg_temp.person('Data'); insert into public.site_admins (user_id, status, admin_role) values (v_data, 'active', 'club_data');
  v_ro := pg_temp.person('RO'); insert into public.site_admins (user_id, status, admin_role) values (v_ro, 'active', 'read_only');
  perform pg_temp.override(v_denied, 'people.capability.manage', 'club', v_club, null, 'deny', 'SITE', v_full);
  perform pg_temp.override(v_denied, 'club.profile.edit', 'club', v_club, null, 'deny', 'SITE', v_full);
  perform pg_temp.override(v_denied, 'people.role.assign_club', 'club', v_club, null, 'deny', 'SITE', v_full);
  perform pg_temp.override(v_denied, 'people.role.assign_team', 'club', v_club, null, 'deny', 'SITE', v_full);

  perform pg_temp.check(
    (select state from public.club_memberships where id = v_susp_ms) = 'SUSPENDED' and (select state from public.club_memberships where id = v_rev_ms) = 'REVOKED'
    and exists (select 1 from public.role_assignments where membership_id = v_rsusp_ms and role_key = 'CLUB_ADMIN' and state = 'SUSPENDED')
    and exists (select 1 from public.role_assignments where membership_id = v_rrev_ms and role_key = 'CLUB_ADMIN' and state = 'REVOKED'),
    'AM0: attacker positions seeded');

  v_set := format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''club'', %L, null, ''grant'', null)', v_member, v_club);

  -- AM1 anonymous: every Slice 3 entry point refuses
  foreach v_s in array array[
    'select * from public.my_capabilities(''club'', ' || quote_literal(v_club) || ')',
    'select * from public.my_site_capabilities()',
    format('select * from public.explain_access(%L, ''club.profile.edit'', ''club'', %L)', v_member, v_club),
    v_set,
    format('select public.revoke_capability_override(%L)', gen_random_uuid()),
    format('select * from public.club_member_capabilities(%L)', v_club),
    format('select public.has_capability(''club.profile.edit'', ''club'', %L, null)', v_club)
  ] loop
    if pg_temp.try_as(null, v_s) <> '42501' then v_bad := v_bad || ('AM1 ' || left(v_s, 50)); end if;
  end loop;

  -- AM2-AM9, AM10: the delegation entry point and the club write path from each position
  for a in select * from (values
      ('AM2 no relationship', v_stranger), ('AM3 same club wrong role (FS)', v_fs), ('AM3 same club member', v_member),
      ('AM4 wrong club admin', v_ca_b), ('AM6 suspended membership', v_susp), ('AM7 revoked membership', v_rev),
      ('AM8 suspended role', v_rsusp), ('AM9 revoked role', v_rrev), ('AM10 withheld', v_denied)) x (label, who)
  loop
    if a.who = v_member then
      v_s := pg_temp.try_as(a.who, format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''club'', %L, null, ''grant'', null)', v_fs, v_club));
    else
      v_s := pg_temp.try_as(a.who, v_set);
    end if;
    if v_s <> '42501' then v_bad := v_bad || (a.label || ' set_override=' || v_s); end if;
    v_s := pg_temp.try_as(a.who, format('select * from public.club_member_capabilities(%L)', v_club));
    if v_s <> '42501' then v_bad := v_bad || (a.label || ' provenance=' || v_s); end if;
    v_s := pg_temp.rows_as(a.who, format('update public.clubs set bio = ''attack'' where id = %L', v_club));
    if v_s <> '0' then v_bad := v_bad || (a.label || ' clubs update rows=' || v_s); end if;
    v_s := pg_temp.try_as(a.who, format('select public.assign_role(%L, ''COACH'', %L, null)', v_member_ms, v_team));
    if v_s <> '42501' then v_bad := v_bad || (a.label || ' assign_role=' || v_s); end if;
    if pg_temp.bool_as(a.who, format('internal.has_capability(''club.profile.edit'', ''club'', %L::uuid, null)', v_club)) then
      v_bad := v_bad || (a.label || ' has_capability'); end if;
    if pg_temp.bool_as(a.who, format('exists (select 1 from public.my_capabilities(''club'', %L::uuid) where allowed and capability_key in (''club.profile.edit'', ''people.capability.manage''))', v_club)) then
      v_bad := v_bad || (a.label || ' my_capabilities'); end if;
  end loop;

  -- AM5 wrong team: Team Administration of one team on another
  v_s := pg_temp.try_as(v_ta, format('select public.assign_role(%L, ''COACH'', %L, null)', v_member_ms, v_team2));
  if v_s <> '42501' then v_bad := v_bad || ('AM5 assign on another team=' || v_s); end if;
  v_s := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''training.communication.send'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team2));
  if v_s <> '42501' then v_bad := v_bad || ('AM5 override on another team=' || v_s); end if;

  -- AM11 malformed scope
  if pg_temp.bool_as(v_ca, format('internal.has_capability(''club.profile.edit'', ''team'', %L::uuid, null)', v_club))
     or pg_temp.can_as(v_ca, 'club.profile.edit', 'club', v_club, v_team)
     or pg_temp.can_as(v_ca, 'club.profile.edit', 'organisation', v_club)
     or pg_temp.can_as(v_ca, 'club.profile.edit', 'site')
     or pg_temp.can_as(v_ca, 'people.role.assign_club', 'club', null)
     or pg_temp.bool_as(v_ca, 'exists (select 1 from public.my_capabilities(''organisation'') where allowed)') then
    v_bad := v_bad || 'AM11 malformed scope answered'::text;
  end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''club'', %L, %L, ''grant'', null)', v_member, v_club, v_team));
  if v_s <> '22023' then v_bad := v_bad || ('AM11 override with a club scope naming a team=' || v_s); end if;

  -- AM12 forged scope parameters
  if pg_temp.bool_as(v_ca, format('internal.has_capability(''fixture.edit'', ''team'', %L::uuid, %L::uuid)', v_club, v_team_b))
     or pg_temp.can_as(v_ca, 'fixture.fixture.edit', 'team', v_club, v_team_b)
     or (select reason_code from internal.capability_decision(v_ca, 'fixture.fixture.edit', 'team', v_club, v_team_b, null, false, false)) <> 'SCOPE_TAMPERED' then
    v_bad := v_bad || 'AM12 forged team/club pair answered'::text;
  end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team_b));
  if v_s <> '42501' then v_bad := v_bad || ('AM12 forged override scope=' || v_s); end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_team_access(%L, %L, ''coach'', null)', v_member_ms, v_team_b));
  if v_s not in ('42501') then v_bad := v_bad || ('AM12 forged team access=' || v_s); end if;

  -- AM13 self-escalation
  foreach v_s in array array[
    format('select public.set_capability_override(%L, ''club.profile.edit'', ''club'', %L, null, ''grant'', null)', v_member, v_club),
    format('select public.set_capability_override(%L, ''site.clubs.profile.manage'', ''site'', null, null, ''grant'', null)', v_member)
  ] loop
    if pg_temp.try_as(v_member, v_s) not in ('42501', '22023') then v_bad := v_bad || ('AM13 member self ' || left(v_s, 60)); end if;
  end loop;
  v_s := pg_temp.try_as(v_ta, format('select public.set_team_access(%L, %L, ''team_admin'', null)', v_ta_ms, v_team2));
  if v_s <> '42501' then v_bad := v_bad || ('AM13 Team Admin extends own authority=' || v_s); end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''people.capability.manage'', ''club'', %L, null, ''grant'', null)', v_ca, v_club));
  if v_s <> '42501' then v_bad := v_bad || ('AM13 Club Admin self decision=' || v_s); end if;
  v_s := pg_temp.rows_as(v_member, format('insert into public.site_capability_grants (user_id, capability_key) values (%L, ''site.lookups.manage'')', v_member));
  if v_s <> '42501' then v_bad := v_bad || ('AM13 direct site grant insert=' || v_s); end if;
  v_s := pg_temp.rows_as(v_member, format('insert into public.bundle_capabilities (bundle_key, capability_key, scope_type) values (''MB'', ''club.profile.edit'', ''club'')'));
  if v_s <> '42501' then v_bad := v_bad || ('AM13 direct bundle insert=' || v_s); end if;
  v_s := pg_temp.rows_as(v_member, format('insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, granted_level) values (%L, ''club.profile.edit'', ''club'', %L, ''grant'', ''SITE'')', v_member, v_club));
  if v_s <> '42501' then v_bad := v_bad || ('AM13 direct override insert=' || v_s); end if;

  -- AM14 above the delegator's ceiling
  v_s := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''fixture.fixture.bulk_edit'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team));
  if v_s not in ('42501', '23514') then v_bad := v_bad || ('AM14 team delegate gives a club-only key=' || v_s); end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''site.users.view'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  if v_s not in ('42501', '22023') then v_bad := v_bad || ('AM14 club delegate gives a site key=' || v_s); end if;
  v_s := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''finance.payment.act'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  if v_s <> '42501' then v_bad := v_bad || ('AM14 club delegate gives a non-delegable finance key=' || v_s); end if;

  perform pg_temp.check(array_length(v_bad, 1) is null, 'AM1-AM14: every attack refused ' || coalesce(array_to_string(v_bad, ' | '), ''));

  -- AM15: the explicit site capability for club profiles
  perform pg_temp.check(pg_temp.rows_as(v_ro, format('update public.clubs set bio = ''ro'' where id = %L', v_club)) = '0'
                        and pg_temp.rows_as(v_data, format('update public.clubs set bio = ''data'' where id = %L', v_club)) = '1'
                        and pg_temp.rows_as(v_full, format('update public.clubs set bio = ''full'' where id = %L', v_club)) = '1'
                        and pg_temp.rows_as(v_ca_b, format('update public.clubs set bio = ''other club'' where id = %L', v_club)) = '0'
                        and pg_temp.rows_as(v_ca, format('update public.clubs set bio = ''own club'' where id = %L', v_club)) = '1',
    'AM15a: club profiles are written by the club''s admin or site.clubs.profile.manage (Full, Club Data); never Read Only or another club');
  perform pg_temp.check(pg_temp.rows_as(v_ro, format('insert into storage.objects (bucket_id, name) values (''club-logos'', %L)', v_club::text || '/attack.png')) = '42501'
                        and pg_temp.rows_as(v_data, format('insert into storage.objects (bucket_id, name) values (''club-logos'', %L)', v_club::text || '/data.png')) = '1'
                        and pg_temp.rows_as(v_ca_b, format('insert into storage.objects (bucket_id, name) values (''club-logos'', %L)', v_club::text || '/other.png')) = '42501',
    'AM15b: and so is the club crest in storage');
end $body$;

rollback;
