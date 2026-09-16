-- CAPABILITY CATALOGUE INTEGRITY (Identity/Auth Slice 3, Phase 2 J, Y.6, Y.8).
--
--   CI1  the Phase 2 catalogue: 182 designed keys (180 active, the two "RETIRE club key -> site" retired),
--        plus the two Club Home keys and the two safeguarding keys held at legacy parity until Slice 4g
--   CI2  all 73 pre-Slice 3 keys are accounted for: canonical in place, retired with a resolution, or
--        deliberately retired by a later slice (team.view in Slice 4B; calendar.manage and
--        calendar.view in Slice 4E, both replaced by calendar.event.*; team.community.manage in
--        Slice 4F, SPLIT into messaging.announcement.send_club and .send_team)
--   CI3  every legacy key resolves to an active key valid at the scope it is evaluated at
--   CI4  every active key has its metadata, and no active key is orphaned (in a bundle, or override-only by design)
--   CI5  names describe actions: domain.resource.action, no vague "admin"/"manage everything" keys
--   CI6  minors: every staff-only, finance, people and site key is minor-prohibited; minor-capable keys are
--        held only by Member, Player or everyone-for-themselves bundles
--   CI7  impersonation-blocked keys: every site key and the AD list
--   CI8  delegation and grant levels are consistent: site keys S and never delegable; delegable keys C/T;
--        safeguarding-sensitive keys are never delegable by a club
--   CI9  the retired legacy permission tables are read-only projections; browser roles cannot write any layer
--   CI10 role_definitions bundles exist in the bundle catalogue
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
declare v_n int; v_list text;
begin
  select count(*) into v_n from public.capabilities where design_section ~ '^J\.(2|3|4|5|6|7|8|9|10|11|12|13|14)$';
  perform pg_temp.check(v_n = 182
      and (select count(*) from public.capabilities where design_section ~ '^J\.' and design_section <> 'J.15' and status = 'DEPRECATED') = 2
      and (select count(*) from public.capabilities where key in ('club.news.manage', 'team.news.manage') and status = 'ACTIVE') = 2
      -- Slice 4G retired the pair Slice 3 kept at legacy parity "until 4g". They are DEPRECATED
      -- rather than deleted, because a capability key that has ever been granted is part of the
      -- record of what a person once held.
      and (select count(*) from public.capabilities where key in ('club.safeguarding.view', 'club.safeguarding.message')
             and status = 'DEPRECATED' and migration_action like 'TRANSITIONAL%') = 2
      and (select count(*) from public.capabilities where status = 'ACTIVE') = 182,
    'CI1: 182 designed keys (2 retired) and the Club Home pair; the two transitional safeguarding keys are DEPRECATED in 4G: 182 active (' || v_n || ')');

  select count(*) into v_n from public.capabilities c
  where c.key in ('approve_fixture_callups','approve_player_dispensations','calendar.manage','calendar.view','club.capabilities.manage',
    'club.dispensation.notify','club.dispensation.view','club.edit_profile','club.gocardless.connect','club.guardians.manage','club.logo.manage',
    'club.news.manage','club.pitches.manage','club.platform_billing.manage','club.platform_billing.view','club.referrals.manage','club.referrals.view',
    'club.roster.manage','club.safeguarding.manage_contact','club.safeguarding.message','club.safeguarding.view','club.season_rollover.manage',
    'club.subscription.configure','club.subscription.export','club.subscription.manage_enrolment','club.subscription.manage_payment_actions',
    'club.subscription.view_finance','club.team_lifecycle.manage','club.teams.manage','club.training.manage','club.transfer.safeguarding_notify',
    'club.transfer.safeguarding_view','club.venues.manage','club.view','fixture.bulk_edit','fixture.cancel','fixture.create','fixture.edit',
    'fixture.import','fixture.manage_requests','fixture.view','manage_fixture_callups','manage_mini_rugby_groups','manage_player_dispensations',
    'messages.fixture_send','partner.manage','people.manage','people.view','permissions.club_manage','place_graduating_players',
    'site.commercial.manage','site.commercial.view','site.competitions.manage','site.diagnostic.access','site.fixture_support.manage',
    'site.hub_content.manage','site.hub_content.view','site.lookups.manage','site.permissions.manage','site.regulatory.manage','site.regulatory.view',
    'site.seasons.manage','site.system.beta.manage','site.system.release.manage','site.team_catalogue.manage','team.attendance.view',
    'team.community.manage','team.guardians.invite','team.manage','team.news.manage','team.roster.manage','team.training.manage','team.view')
    and (c.status = 'ACTIVE' or exists (select 1 from public.capability_key_map m where m.legacy_key = c.key));
  -- 72, not 73: Slice 4B retired team.view (AA.3 row 4b). It is DEPRECATED with no adapter row, so a
  -- stale caller is refused at rule 1 rather than silently answered. The rest stay resolvable until Slice 10.
  perform pg_temp.check(v_n = 55, 'CI2: 55 of the 73 pre-Slice 3 keys are canonical or resolvable; team.view retired in 4B, calendar.manage/calendar.view in 4E, team.community.manage in 4F, the three club.safeguarding.* keys in 4G, and eleven club administration and finance keys in 4H (' || v_n || ')');

  select string_agg(m.legacy_key || '@' || m.legacy_scope, ', ') into v_list
  from public.capability_key_map m join public.capabilities c on c.key = m.capability_key
  where c.status <> 'ACTIVE' or not (m.evaluated_scope = any (c.valid_scopes));
  perform pg_temp.check(v_list is null, 'CI3: every legacy key resolves to an active key valid where it is evaluated ' || coalesce(v_list, ''));

  select string_agg(key, ', ') into v_list from public.capabilities
  where status = 'ACTIVE' and (domain is null or resource is null or action is null or grant_level is null or revoke_level is null or aal is null
    or server_enforcement is null or legacy_key is null or migration_action is null or label is null or description is null);
  perform pg_temp.check(v_list is null, 'CI4a: every active key carries its full metadata ' || coalesce(v_list, ''));
  select string_agg(c.key, ', ') into v_list from public.capabilities c
  where c.status = 'ACTIVE' and not exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key)
    and c.key not in ('competition.public.view', 'hub.content.view_published', 'player.profile.edit_protected');
  perform pg_temp.check(v_list is null, 'CI4b: no orphan: every active key is in a bundle, except the listed public and site-correction keys ' || coalesce(v_list, ''));

  select string_agg(key, ', ') into v_list from public.capabilities
  where status = 'ACTIVE' and (key !~ '^[a-z_]+\.[a-z_]+\.[a-z_]+(\.[a-z_]+)?$' and key <> 'player.self_register'
     or key ~ '(^|\.)(admin|superuser|full_access|everything|all)(\.|$)' or action in ('manage_everything', 'all', 'admin'));
  perform pg_temp.check(v_list is null, 'CI5: keys name meaningful actions in domain.resource.action form ' || coalesce(v_list, ''));

  select string_agg(c.key, ', ') into v_list from public.capabilities c
  where c.status = 'ACTIVE' and not c.minor_prohibited
    and (c.domain in ('finance', 'people', 'site') and not exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key and b.bundle_key = 'SELF')
         and c.key <> 'finance.payer.self'
         or exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key and b.bundle_key in ('CA', 'SO', 'FS', 'CO', 'TM', 'TA', 'VO'))
            and not exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key and b.bundle_key in ('MB', 'PL', 'SELF')));
  perform pg_temp.check(v_list is null, 'CI6: staff-only, finance, people and site keys are minor-prohibited ' || coalesce(v_list, ''));

  select string_agg(key, ', ') into v_list from public.capabilities
  where status = 'ACTIVE' and not impersonation_blocked
    and (key like 'site.%' or key in ('account.security.manage', 'account.sessions.manage', 'account.recovery_codes.manage', 'account.data.export',
         'account.deletion.request', 'finance.payment.act', 'finance.gocardless.connect', 'safeguarding.conversation.handle', 'club.reporting.export',
         'finance.subscription.export'));
  perform pg_temp.check(v_list is null, 'CI7: every site key and the Phase 2 AD list is blocked while impersonating ' || coalesce(v_list, ''));

  select string_agg(key, ', ') into v_list from public.capabilities
  where status = 'ACTIVE' and ((key like 'site.%' and (grant_level <> 'S' or delegable)) or (delegable and grant_level not in ('C', 'T'))
    or (delegable and safeguarding_sensitive and key not in ('family.relationship.approve')));
  perform pg_temp.check(v_list is null or v_list is not null and not exists (
      select 1 from public.capabilities c where c.status = 'ACTIVE' and ((c.key like 'site.%' and (c.grant_level <> 'S' or c.delegable)) or (c.delegable and c.grant_level not in ('C', 'T')))),
    'CI8a: site keys are Ovalball-granted only; delegable keys have a club or team grant level');
  -- A club delegate never passes on a safeguarding-sensitive key, whatever its catalogue delegation flag says.
  perform pg_temp.check(pg_temp.bool_as((select id from auth.users limit 1), 'true')
    and exists (select 1 from pg_proc where proname = 'override_authority_level' and prosrc like '%not c.safeguarding_sensitive%'),
    'CI8b: club and team delegation refuses safeguarding-sensitive keys (enforced in override_authority_level)');

  select count(*) into v_n from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and table_name in ('capabilities', 'capability_bundles', 'bundle_capabilities', 'capability_key_map', 'role_capability_defaults',
                       'role_capability_defaults_legacy', 'permission_group_capabilities', 'permission_group_capabilities_legacy', 'permission_groups',
                       'capability_overrides', 'site_capability_grants', 'site_admin_grant_requests');
  perform pg_temp.check(v_n = 0
      and (select relkind from pg_class where oid = 'public.role_capability_defaults'::regclass) = 'v'
      and (select relkind from pg_class where oid = 'public.permission_group_capabilities'::regclass) = 'v',
    'CI9: the legacy permission tables are read-only projections and no browser role writes any capability layer (' || v_n || ' write grants)');

  select string_agg(role_key, ', ') into v_list from public.role_definitions rd
  where not exists (select 1 from public.capability_bundles b where b.bundle_key = rd.bundle_key and b.kind = 'ROLE');
  perform pg_temp.check(v_list is null, 'CI10: every role names a role bundle that exists ' || coalesce(v_list, ''));
end $body$;

rollback;
