-- SITE ADMIN PROFILE MATRIX (Identity/Auth Slice 3, Phase 2 R, SA-1..SA-7, attacks 36/37).
--
-- Site Admin authority is a set of explicit site capabilities: a profile bundle plus audited add-on grants,
-- evaluated only at site scope (K rule 7). Every profile is checked against every site capability.
--
--   SM1   every profile x every site capability: the resolver answers exactly the profile's bundle
--   SM2   my_site_capabilities (what navigation renders from, SA-4) lists exactly that bundle
--   SM3   Read Only holds view capabilities only and no mutation site capability resolves for it (SA-1)
--   SM4   only Full holds master control (SA-5)
--   SM5   add-ons: grant/revoke resolve immediately; the legacy switches and the grants stay equal both ways
--   SM6   SA-2: no add-on for Read Only or Full, by grant or by switch; safeguarding review only for Support
--   SM7   the catalogue refuses a mutation key in Read Only, master control outside Full, a site key in a role
--   SM8   SA-6: the last active Full Site Admin can be neither narrowed nor revoked
--   SM9   SA-7: ending Site Admin access ends every add-on; a returning admin starts with none
--   SM10  admin_role and profile_key follow each other; profile changes and add-ons are security events
--   SM11  attacks 36/37: Read Only and every non-Full profile are refused by each people-authority RPC
--   SM12  the legacy site helpers answer from the same site capabilities
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
  v_admins jsonb := '{}'::jsonb;
  v_profile text; v_role text; v_uid uuid; v_mismatch text[] := '{}'; v_state text; v_n int;
  v_full uuid; v_ops uuid; v_ro uuid; v_support uuid; v_data uuid;
  v_club uuid; v_team uuid; v_target uuid; v_ms uuid; v_group uuid; r record; v_bool boolean;
begin
  for v_profile, v_role in select * from (values ('SITE_FULL', 'full'), ('SITE_OPS', 'fixture_ops'), ('SITE_DATA', 'club_data'),
      ('SITE_SUPPORT', 'user_access'), ('SITE_MOD', 'message_moderator'), ('SITE_CONTENT', 'content'), ('SITE_RO', 'read_only')) p loop
    v_uid := pg_temp.person(v_profile);
    insert into public.site_admins (user_id, status, admin_role) values (v_uid, 'active', v_role);
    v_admins := v_admins || jsonb_build_object(v_profile, v_uid);
  end loop;
  v_full := (v_admins ->> 'SITE_FULL')::uuid; v_ops := (v_admins ->> 'SITE_OPS')::uuid; v_ro := (v_admins ->> 'SITE_RO')::uuid;
  v_support := (v_admins ->> 'SITE_SUPPORT')::uuid; v_data := (v_admins ->> 'SITE_DATA')::uuid;

  -- SM1 / SM2
  for r in
    select a.key as profile, a.value::uuid as uid, c.key as capability,
           exists (select 1 from public.bundle_capabilities b where b.bundle_key = a.key and b.capability_key = c.key) as expected
    from jsonb_each_text(v_admins) a
    cross join public.capabilities c
    where c.status = 'ACTIVE' and 'site' = any (c.valid_scopes)
  loop
    if pg_temp.can_as(r.uid, r.capability, 'site') is distinct from r.expected then
      v_mismatch := v_mismatch || (r.profile || ':' || r.capability);
    end if;
  end loop;
  perform pg_temp.check(array_length(v_mismatch, 1) is null,
    'SM1: every profile answers exactly its bundle for every site capability ' || coalesce(array_to_string(v_mismatch, ', '), ''));

  v_mismatch := '{}';
  for r in select a.key as profile, a.value::uuid as uid from jsonb_each_text(v_admins) a loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    if (select array_agg(k order by k) from public.my_site_capabilities() k)
       is distinct from (select array_agg(b.capability_key order by b.capability_key) from public.bundle_capabilities b
                         join public.capabilities c on c.key = b.capability_key and c.status = 'ACTIVE' where b.bundle_key = r.profile) then
      v_mismatch := v_mismatch || r.profile;
    end if;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;
  perform pg_temp.check(array_length(v_mismatch, 1) is null, 'SM2: my_site_capabilities lists exactly each profile''s bundle ' || coalesce(array_to_string(v_mismatch, ', '), ''));

  -- SM3
  select count(*) into v_n from public.bundle_capabilities where bundle_key = 'SITE_RO' and capability_key !~ '\.view(_[a-z_]+)?$';
  perform pg_temp.check(v_n = 0 and not exists (
      select 1 from public.capabilities c where c.status = 'ACTIVE' and 'site' = any (c.valid_scopes) and c.key !~ '\.view(_[a-z_]+)?$'
        and pg_temp.can_as(v_ro, c.key, 'site')),
    'SM3: Read Only holds view capabilities only, and no mutation site capability resolves for it');

  -- SM4
  select count(*) into v_n from public.bundle_capabilities
  where capability_key in ('site.memberships.manage', 'site.club_roles.manage', 'site.team_roles.manage', 'site.family.manage',
                           'site.users.create', 'site.admins.manage', 'site.capabilities.override') and bundle_key <> 'SITE_FULL';
  perform pg_temp.check(v_n = 0 and pg_temp.can_as(v_full, 'site.admins.manage', 'site') and not pg_temp.can_as(v_support, 'site.admins.manage', 'site'),
    'SM4: master control belongs to the Full profile alone');

  -- SM5: add-ons, both directions of the legacy switch
  insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_ops, 'site.team_catalogue.manage', v_full, 'matrix');
  perform pg_temp.check(pg_temp.can_as(v_ops, 'site.team_catalogue.manage', 'site')
                        and (select manage_team_catalogue from public.site_admins where user_id = v_ops),
    'SM5a: an add-on grant resolves immediately and sets the matching legacy switch');
  update public.site_capability_grants set revoked_at = now(), revoked_by = v_full, revocation_reason = 'matrix'
    where user_id = v_ops and capability_key = 'site.team_catalogue.manage' and revoked_at is null;
  perform pg_temp.check(not pg_temp.can_as(v_ops, 'site.team_catalogue.manage', 'site')
                        and not (select manage_team_catalogue from public.site_admins where user_id = v_ops),
    'SM5b: revoking it ends the capability and clears the switch');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_full, 'role', 'authenticated')::text, true);
  perform public.set_site_admin_seasons_capability(v_ops, true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(pg_temp.can_as(v_ops, 'site.seasons.manage', 'site')
                        and exists (select 1 from public.site_capability_grants where user_id = v_ops and capability_key = 'site.seasons.manage' and revoked_at is null),
    'SM5c: the legacy per-capability RPC becomes an audited grant');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_full, 'role', 'authenticated')::text, true);
  perform public.set_site_admin_seasons_capability(v_ops, false);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(not pg_temp.can_as(v_ops, 'site.seasons.manage', 'site'), 'SM5d: and switching it off revokes the grant');

  -- SM6
  begin
    insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_ro, 'site.hub.manage', v_full, 'matrix');
    perform pg_temp.check(false, 'SM6a: an add-on was given to a Read Only admin');
  exception when check_violation then
    perform pg_temp.check(true, 'SM6a: no add-on grant for Read Only');
  end;
  begin
    update public.site_admins set manage_hub_content = true where user_id = v_ro;
    perform pg_temp.check(false, 'SM6b: a legacy switch was turned on for Read Only');
  exception when check_violation then
    perform pg_temp.check(true, 'SM6b: nor through the legacy switch');
  end;
  begin
    insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_full, 'site.hub.manage', v_full, 'matrix');
    perform pg_temp.check(false, 'SM6c: a redundant add-on was given to Full');
  exception when check_violation then
    perform pg_temp.check(true, 'SM6c: Full holds everything already; no add-on');
  end;
  begin
    insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_data, 'site.safeguarding.review', v_full, 'matrix');
    perform pg_temp.check(false, 'SM6d: safeguarding review was given to a non-Support profile');
  exception when check_violation then
    perform pg_temp.check(true, 'SM6d: safeguarding review is a Support add-on only (AN-9)');
  end;
  begin
    insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_ops, 'site.admins.manage', v_full, 'matrix');
    perform pg_temp.check(false, 'SM6e: master control was added to a non-Full profile');
  exception when check_violation then
    perform pg_temp.check(true, 'SM6e: master control is never an add-on');
  end;

  -- SM7
  v_mismatch := '{}';
  for r in select * from (values ('SITE_RO', 'site.clubs.profile.manage', 'site'), ('SITE_OPS', 'site.club_roles.manage', 'site'),
                                 ('CA', 'site.users.view', 'club'), ('VO', 'fixture.fixture.edit', 'club'),
                                 ('CO', 'fixture.planner.use', 'club'), ('SITE_FULL', 'club.profile.edit', 'site')) x (b, k, s) loop
    begin
      insert into public.bundle_capabilities (bundle_key, capability_key, scope_type) values (r.b, r.k, r.s);
      v_mismatch := v_mismatch || (r.b || ':' || r.k);
    exception when check_violation then null;
    end;
  end loop;
  perform pg_temp.check(array_length(v_mismatch, 1) is null,
    'SM7: the catalogue refuses Read Only mutation, master control outside Full, site keys in roles, Volunteer mutation and team bulk tools ' || coalesce(array_to_string(v_mismatch, ', '), ''));

  -- SM8: with every other Full Site Admin stood down inside this transaction, the test's Full is the last.
  update public.site_admins set status = 'revoked', revoked_at = now(), revoked_by = v_full
  where profile_key = 'SITE_FULL' and status = 'active' and user_id <> v_full;
  begin
    update public.site_admins set profile_key = 'SITE_OPS' where user_id = v_full;
    perform pg_temp.check(false, 'SM8a: the last Full Site Admin was narrowed');
  exception when others then
    perform pg_temp.check(sqlerrm like '%last remaining Full Site Admin%', 'SM8a: the last Full Site Admin cannot be narrowed (' || sqlerrm || ')');
  end;
  begin
    update public.site_admins set status = 'revoked', revoked_at = now() where user_id = v_full;
    perform pg_temp.check(false, 'SM8b: the last Full Site Admin was revoked');
  exception when others then
    perform pg_temp.check(sqlerrm like '%last remaining Full Site Admin%', 'SM8b: nor revoked');
  end;

  -- SM9
  insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_ops, 'site.lookups.manage', v_full, 'matrix');
  update public.site_admins set status = 'revoked', revoked_at = now(), revoked_by = v_full where user_id = v_ops;
  perform pg_temp.check(not exists (select 1 from public.site_capability_grants where user_id = v_ops and revoked_at is null)
                        and not (select manage_global_lookups from public.site_admins where user_id = v_ops),
    'SM9a: ending Site Admin access ends every add-on and clears the switches');
  update public.site_admins set status = 'active', revoked_at = null, revoked_by = null where user_id = v_ops;
  perform pg_temp.check(not pg_temp.can_as(v_ops, 'site.lookups.manage', 'site')
                        and not exists (select 1 from public.site_capability_grants where user_id = v_ops and revoked_at is null),
    'SM9b: a returning Site Admin starts with no add-ons (fresh capability set)');
  insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_ops, 'site.lookups.manage', v_full, 'matrix');
  update public.site_admins set profile_key = 'SITE_RO' where user_id = v_ops;
  perform pg_temp.check(not exists (select 1 from public.site_capability_grants where user_id = v_ops and revoked_at is null)
                        and (select admin_role from public.site_admins where user_id = v_ops) = 'read_only',
    'SM9c: moving to Read Only drops add-ons (SA-2)');

  -- SM10
  update public.site_admins set admin_role = 'user_access' where user_id = v_data;
  perform pg_temp.check((select profile_key from public.site_admins where user_id = v_data) = 'SITE_SUPPORT', 'SM10a: a legacy admin_role write sets the profile');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_full, 'role', 'authenticated')::text, true);
  update public.site_admins set profile_key = 'SITE_DATA' where user_id = v_data;
  insert into public.site_capability_grants (user_id, capability_key, granted_by, reason) values (v_data, 'site.lookups.manage', v_full, 'matrix');
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check((select admin_role from public.site_admins where user_id = v_data) = 'club_data'
    and exists (select 1 from public.security_events where subject_user_id = v_data and event_type = 'site_admin.profile_changed'
                and metadata ->> 'to_profile' = 'SITE_DATA' and actor_user_id = v_full)
    and exists (select 1 from public.security_events where subject_user_id = v_data and event_type = 'site_admin.capability_added'
                and metadata ->> 'capability_key' = 'site.lookups.manage' and actor_user_id = v_full),
    'SM10b: profile changes and add-ons are security events attributed to the session actor');

  -- SM11: attacks 36/37 against the people-authority RPCs that exist today
  v_club := pg_temp.club('Matrix'); v_team := pg_temp.team(v_club);
  v_target := pg_temp.person('Target'); v_ms := pg_temp.member(v_club, v_target);
  select id into v_group from public.permission_groups where maps_to_role = 'CLUB_ADMIN' limit 1;
  v_mismatch := '{}';
  for r in select a.key as profile, a.value::uuid as uid from jsonb_each_text(v_admins) a where a.key <> 'SITE_FULL' loop
    foreach v_state in array array[
      format('select public.assign_role(%L, ''CLUB_ADMIN'', null, ''matrix reason'')', v_ms),
      format('select public.set_team_access(%L, %L, ''coach'', ''matrix reason'')', v_ms, v_team),
      format('select public.transition_club_membership(%L, ''SUSPENDED'', ''matrix reason'')', v_ms),
      format('select public.change_membership_access_profile(%L, %L, ''[]''::jsonb, ''matrix reason'')', v_ms, v_group),
      format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''club'', %L, null, ''grant'', ''matrix reason'')', v_target, v_club),
      format('select public.set_site_admin_seasons_capability(%L, true)', v_target)
    ] loop
      if pg_temp.try_as(r.uid, v_state) <> '42501' then
        v_mismatch := v_mismatch || (r.profile || ':' || split_part(split_part(v_state, '(', 1), '.', 2));
      end if;
    end loop;
  end loop;
  perform pg_temp.check(array_length(v_mismatch, 1) is null
      and (select state from public.club_memberships where id = v_ms) = 'ACTIVE'
      and not exists (select 1 from public.capability_overrides where user_id = v_target)
      and not exists (select 1 from public.role_assignments where membership_id = v_ms and role_key <> 'MEMBER'),
    'SM11: every non-Full profile, Read Only included, is refused by each people-authority RPC and nothing changed ' || coalesce(array_to_string(v_mismatch, ', '), ''));

  -- SM12
  v_mismatch := '{}';
  for r in select a.key as profile, a.value::uuid as uid from jsonb_each_text(v_admins) a loop
    if pg_temp.bool_as(r.uid, 'internal.can_manage_competitions()') is distinct from pg_temp.can_as(r.uid, 'site.competitions.manage', 'site')
       or pg_temp.bool_as(r.uid, 'internal.can_manage_fixture_support()') is distinct from pg_temp.can_as(r.uid, 'site.fixtures.support', 'site')
       or pg_temp.bool_as(r.uid, 'internal.can_manage_global_lookups()') is distinct from pg_temp.can_as(r.uid, 'site.lookups.manage', 'site')
       or pg_temp.bool_as(r.uid, 'internal.can_manage_permissions()') is distinct from pg_temp.can_as(r.uid, 'site.permissions.manage', 'site')
       or pg_temp.bool_as(r.uid, 'internal.can_manage_team_catalogue()') is distinct from pg_temp.can_as(r.uid, 'site.team_catalogue.manage', 'site')
       or pg_temp.bool_as(r.uid, 'internal.has_capability(''site.hub_content.manage'', ''site'')') is distinct from pg_temp.can_as(r.uid, 'site.hub.manage', 'site') then
      v_mismatch := v_mismatch || r.profile;
    end if;
  end loop;
  perform pg_temp.check(array_length(v_mismatch, 1) is null, 'SM12: legacy site helpers and legacy site keys answer from the same site capabilities ' || coalesce(array_to_string(v_mismatch, ', '), ''));
end $body$;

rollback;
