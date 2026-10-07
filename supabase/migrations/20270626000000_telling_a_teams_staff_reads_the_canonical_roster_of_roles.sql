-- =====================================================================================================
-- TELLING A TEAM'S STAFF READS THE CANONICAL ROSTER OF ROLES.
--
-- `public.accept_fixture_request` notifies both teams' staff by reading `public.team_permissions`, the
-- Slice 2 compatibility view. It uses nothing the view adds: not the legacy `permission` string, not
-- its highest-role-per-membership rule -- only "who holds a role on this team". That is a row in
-- `role_assignments`, which the view itself selects from.
--
-- SO IT ASKS THE SOURCE. The same people, under the same liveness rule the view applies: an ACTIVE
-- assignment, or one suspended at SITE level for a club-authority reason, which the view deliberately
-- still counts -- a club whose authority is suspended still has staff who must hear that a fixture is
-- confirmed.
--
-- THE OTHER TEN FUNCTIONS THAT READ THIS VIEW ARE NOT TOUCHED, because they read the legacy
-- `permission` string ('team_admin' / 'manager' / 'coach') and converting those to canonical role keys
-- is the Slice 10 drop itself rather than a side-effect of a tournament release. This one needed none
-- of that, so it is migrated now rather than waiting.
--
-- `team_scoped_fixture_requests`, `notification_catalogue` and `recipient_audience_engine` are the
-- suites that would notice if the audience changed.
-- =====================================================================================================

do $$
declare
  v_def text;
  v_legacy constant text :=
    'from public.team_permissions tp' || chr(10) ||
    '  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = ''active''' || chr(10) ||
    '  where tp.team_id = ';
  v_canonical constant text :=
    'from public.role_assignments ra' || chr(10) ||
    '  join public.club_memberships cm on cm.id = ra.membership_id and cm.status = ''active''' || chr(10) ||
    '  where ra.state in (''ACTIVE'', ''SUSPENDED'') and ra.team_id = ';
  v_legacy_indented constant text :=
    'from public.team_permissions tp' || chr(10) ||
    '    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = ''active''' || chr(10) ||
    '    where tp.team_id = ';
  v_canonical_indented constant text :=
    'from public.role_assignments ra' || chr(10) ||
    '    join public.club_memberships cm on cm.id = ra.membership_id and cm.status = ''active''' || chr(10) ||
    '    where ra.state in (''ACTIVE'', ''SUSPENDED'') and ra.team_id = ';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'accept_fixture_request';
  if v_def is null then raise exception 'accept_fixture_request is missing.'; end if;
  if v_def !~ '\yteam_permissions\y' then return; end if;

  v_def := replace(v_def, v_legacy, v_canonical);
  v_def := replace(v_def, v_legacy_indented, v_canonical_indented);

  if v_def ~ '\yteam_permissions\y' then
    raise exception
      'accept_fixture_request reads team_permissions in a shape this migration does not know -- migrate it by hand rather than leaving a partial rewrite.';
  end if;

  execute v_def;
end $$;

do $$
begin
  if (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'accept_fixture_request') ~ '\yteam_permissions\y' then
    raise exception 'accept_fixture_request is reading the compatibility view again.';
  end if;
end $$;
