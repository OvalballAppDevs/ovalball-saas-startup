-- CANONICAL MEMBERSHIP BACKFILL VERIFICATION (Identity/Auth Slice 2, Phase 2 AF).
--
-- The invariants the Slice 2 backfill established, checked against whatever
-- data this database holds (seeded locally, empty on a clean boot, real in a
-- read-only production preflight). Each count must be zero:
--
--   A. Memberships: canonical state present; legacy status, role and
--      authority flag derived exactly; every open membership holds a club
--      role; nothing ended still holds an open role; provenance ids present
--      where a source claims them.
--   B. Roles: team roles stay inside their club; Team Administration rests on
--      an open base role; Safeguarding Officers map to an active officer;
--      the team_permissions view projects only open staff roles.
--   C. Relationships and team places: canonical state present; legacy status
--      derived; only ACTIVE relationships read as active (FR-1); one open
--      relationship per pair (FR-2); nobody their own guardian.
--   D. Minors: no minor holds an ACTIVE staff role.
--   E. Compatibility: a legacy insert naming a status is read from that
--      status, not from the ACTIVE default.
--
-- Read-only apart from E, which is rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.zero(p_count bigint, p_label text) returns void
language plpgsql as $$
begin
  if p_count = 0 then raise notice 'PASS %', p_label; else raise notice 'FAIL % (% rows)', p_label, p_count; end if;
end $$;

-- A. Memberships
select pg_temp.zero((select count(*) from public.club_memberships where state is null or source is null), 'A1: every membership has a canonical state and source');
select pg_temp.zero((select count(*) from public.club_memberships where status <> lower(state)), 'A2: legacy status is derived from state');
select pg_temp.zero((select count(*) from public.club_memberships cm where cm.state in ('ACTIVE', 'SUSPENDED') and cm.role is distinct from internal.legacy_club_role(cm.id)), 'A3: legacy role is derived from role assignments');
select pg_temp.zero((select count(*) from public.club_memberships cm where cm.state in ('ACTIVE', 'SUSPENDED') and cm.authority_suspended is distinct from internal.legacy_authority_suspended(cm.id)), 'A4: legacy authority flag is derived from role assignments');
select pg_temp.zero((select count(*) from public.club_memberships cm where cm.state in ('ACTIVE', 'SUSPENDED')
  and not exists (select 1 from public.role_assignments ra where ra.membership_id = cm.id and ra.team_id is null
                  and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and ra.state in ('ACTIVE', 'SUSPENDED'))
  and not exists (select 1 from public.access_review_items ri where ri.membership_id = cm.id and ri.kind = 'MINOR_WITH_STAFF_ROLE')), 'A5: every open membership holds a club role');
select pg_temp.zero((select count(*) from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id
  where cm.state in ('REVOKED', 'DECLINED', 'EXPIRED', 'PENDING') and ra.state <> 'REVOKED'), 'A6: a membership that is not open holds no open role');
select pg_temp.zero((select count(*) from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id
  where cm.state = 'SUSPENDED' and ra.state = 'ACTIVE'), 'A7: a suspended membership holds no ACTIVE role');
select pg_temp.zero((select count(*) from public.club_memberships where (state = 'REVOKED') <> (revoked_at is not null) or (state = 'SUSPENDED') <> (suspended_level is not null)), 'A8: removal and suspension carry their shape');
select pg_temp.zero((select count(*) from public.club_memberships where (source = 'INVITATION' and source_invitation_id is null) or (source = 'JOIN_REQUEST' and source_request_id is null)), 'A9: a source that names evidence carries its id');
select pg_temp.zero((select count(*) from (select club_id, user_id from public.club_memberships where state in ('PENDING', 'ACTIVE', 'SUSPENDED') group by 1, 2 having count(*) > 1) d), 'A10: one open membership per person and club');

-- B. Roles
select pg_temp.zero((select count(*) from public.role_assignments ra join public.teams t on t.id = ra.team_id where t.club_id <> ra.club_id), 'B1: team roles stay inside their club');
select pg_temp.zero((select count(*) from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id where cm.club_id <> ra.club_id or cm.user_id <> ra.user_id), 'B2: a role belongs to its own membership');
select pg_temp.zero((select count(*) from public.role_assignments ta
  where ta.role_key = 'TEAM_ADMINISTRATION' and ta.state = 'ACTIVE'
    and not exists (select 1 from public.role_assignments b where b.id = ta.base_assignment_id and b.state = 'ACTIVE' and b.team_id = ta.team_id and b.role_key in ('COACH', 'TEAM_MANAGER'))), 'B3: ACTIVE Team Administration rests on an ACTIVE base role on the same team');
select pg_temp.zero((select count(*) from public.club_safeguarding_officers o where o.status = 'active' and o.user_id is not null
  and not exists (select 1 from public.role_assignments ra where ra.user_id = o.user_id and ra.club_id = o.club_id and ra.role_key = 'SAFEGUARDING_OFFICER' and ra.state in ('ACTIVE', 'SUSPENDED'))), 'B4: every active Safeguarding Officer with an account holds the role');
select pg_temp.zero((select count(*) from public.team_permissions tp
  where tp.permission not in ('team_admin', 'manager', 'coach')
     or not exists (select 1 from public.role_assignments ra where ra.id = tp.id and (ra.state = 'ACTIVE' or (ra.state = 'SUSPENDED' and ra.suspended_level = 'SITE' and ra.attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY')))), 'B5: the team_permissions view projects only open staff roles');
select pg_temp.zero((select count(*) from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
  where (rd.scope = 'CLUB' and ra.team_id is not null) or (rd.scope = 'TEAM' and ra.team_id is null)), 'B6: every role has its scope');

-- C. Relationships and team places
select pg_temp.zero((select count(*) from public.guardians where state is null or source is null or verification_state is null), 'C1: every relationship has state, source and verification');
select pg_temp.zero((select count(*) from public.guardians where status <> case state when 'PENDING_APPROVAL' then 'pending' else lower(state) end), 'C2: legacy guardian status is derived from state');
select pg_temp.zero((select count(*) from public.guardians where (status = 'active') <> (state = 'ACTIVE')), 'C3: only an ACTIVE relationship reads as active (FR-1)');
select pg_temp.zero((select count(*) from (select guardian_user_id, player_id from public.guardians where state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED') group by 1, 2 having count(*) > 1) d), 'C4: one open relationship per adult and child (FR-2)');
select pg_temp.zero((select count(*) from public.guardians g join public.players p on p.id = g.player_id where p.user_id = g.guardian_user_id), 'C5: nobody is their own guardian');
select pg_temp.zero((select count(*) from public.guardians where (state = 'REVOKED') <> (revoked_at is not null)), 'C6: a removed relationship records when');
select pg_temp.zero((select count(*) from public.guardians where source in ('LINK_REQUEST', 'ADDITIONAL_GUARDIAN_REQUEST') and source_request_id is null), 'C7: a request-sourced relationship names its request');
select pg_temp.zero((select count(*) from public.player_team_memberships where state is null or source is null or status <> lower(state)), 'C8: every team place has state and source, and its legacy status is derived');
select pg_temp.zero((select count(*) from (select player_id, team_id from public.player_team_memberships where state = 'ACTIVE' group by 1, 2 having count(*) > 1) d), 'C9: one active place per player and team');

-- D. Minors
select pg_temp.zero((select count(*) from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key and rd.minor_prohibited
  where ra.state = 'ACTIVE' and internal.person_is_minor(ra.user_id)), 'D1: no minor holds an ACTIVE staff role');

-- F. Identity/Auth Slice 3 (Phase 2 AF): capabilities, overrides, Site Admin profiles
select pg_temp.zero((select count(*) from public.capabilities where status = 'ACTIVE' and (domain is null or grant_level is null or aal is null)), 'F1: every active capability carries its catalogue metadata');
select pg_temp.zero((select count(*) from public.capabilities c where c.status = 'ACTIVE' and c.key not like 'site.%' and c.grant_level <> 'S'
  and c.valid_scopes <> array['public']::text[] and not exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key)), 'F2: every active non-site key has a default bundle');
select pg_temp.zero((select count(*) from public.capability_overrides where granted_level is null), 'F3: every override records the level it was decided at');
select pg_temp.zero((select count(*) from public.capability_overrides o join public.capability_key_map m on m.legacy_key = o.capability_key and m.legacy_scope = o.scope_type
  where m.capability_key <> o.capability_key), 'F4: no override is stored under a legacy key');
select pg_temp.zero((select count(*) from public.site_admins where profile_key is null or profile_key is distinct from internal.site_profile_for_admin_role(admin_role)), 'F5: every Site Admin has a profile, equal to its legacy role');
select pg_temp.zero((select count(*) from public.site_admins sa where sa.status = 'active' and sa.profile_key not in ('SITE_FULL', 'SITE_RO') and (
    (sa.diagnostic_club_access <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.support.view_club'))
 or (sa.manage_team_catalogue <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.team_catalogue.manage'))
 or (sa.manage_competitions <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.competitions.manage'))
 or (sa.manage_fixture_support <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.fixtures.support'))
 or (sa.manage_global_lookups <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.lookups.manage'))
 or (sa.manage_permissions <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.permissions.manage'))
 or (sa.manage_seasons <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.seasons.manage'))
 or (sa.view_commercial <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.commercial.view'))
 or (sa.manage_hub_content <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.hub.manage'))
 or (sa.manage_regulatory_content <> exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null and g.capability_key = 'site.regulatory.manage')))),
 'F6: for every add-on-capable Site Admin the legacy switches equal the add-on grants');
select pg_temp.zero((select count(*) from public.site_admins sa where sa.profile_key = 'SITE_RO' and (sa.diagnostic_club_access or sa.manage_team_catalogue
  or sa.manage_competitions or sa.manage_fixture_support or sa.manage_global_lookups or sa.manage_permissions or sa.manage_seasons or sa.manage_system
  or sa.view_commercial or sa.view_regulatory_content or sa.manage_regulatory_content or sa.view_hub_content or sa.manage_hub_content
  or exists (select 1 from public.site_capability_grants g where g.user_id = sa.user_id and g.revoked_at is null))), 'F7: no Read Only Site Admin carries an add-on');
select pg_temp.zero((select count(*) from (select scope_type, role_key, capability_key from public.role_capability_defaults_legacy
  except select scope_type, role_key, capability_key from public.role_capability_defaults) x) - 49, 'F8: legacy role defaults lost only the 49 intended removals (bundle_legacy_parity names them)');

-- E. Compatibility for legacy inserts (rolled back)
do $$
declare
  v_user uuid := gen_random_uuid();
  v_club uuid := (select id from public.clubs limit 1);
  v_player uuid;
  v_state text;
begin
  if v_club is null then
    raise notice 'PASS E0: no club on this database, so there is no legacy insert to check';
    return;
  end if;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bfv-' || v_user::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_user, 'CLUB_ADMIN', 'revoked') returning state into v_state;
  if v_state = 'REVOKED' and not exists (select 1 from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id where cm.user_id = v_user and ra.state <> 'REVOKED') then
    raise notice 'PASS E1: a legacy insert of a revoked membership is REVOKED and grants no role';
  else
    raise notice 'FAIL E1: a legacy revoked insert became %', v_state;
  end if;
  insert into public.players (first_name, surname, date_of_birth) values ('Bfv', 'Child', current_date - 3000) returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_user, v_player, 'guardian', 'revoked') returning state into v_state;
  if v_state = 'REVOKED' then raise notice 'PASS E2: a legacy insert of a revoked relationship is REVOKED';
  else raise notice 'FAIL E2: a legacy revoked relationship became %', v_state; end if;
end $$;

rollback;
