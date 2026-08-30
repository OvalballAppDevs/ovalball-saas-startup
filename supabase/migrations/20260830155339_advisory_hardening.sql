-- Addresses every finding from `get_advisors` (security + performance) after
-- the initial schema push. All changes are additive/non-destructive: no
-- table, column, or row is dropped. Existing triggers and RLS policies that
-- reference the moved functions keep working unchanged, since Postgres
-- resolves those references by OID at creation time, not by schema-qualified
-- name — moving a function's schema is transparent to them.

-- ============================================================
-- 1. function_search_path_mutable: set_updated_at was missing the
--    search_path pin every other function already had.
-- ============================================================

alter function public.set_updated_at() set search_path = public;

-- ============================================================
-- 2. anon/authenticated_security_definer_function_executable: these four
--    helper functions were only ever meant to be called from inside RLS
--    policies/triggers, not as public PostgREST RPC endpoints
--    (/rest/v1/rpc/is_site_admin etc.). PostgREST only exposes functions
--    from schemas in its configured schema list (public, graphql_public by
--    default), so moving them to a dedicated, unexposed `internal` schema
--    removes the RPC surface entirely while leaving RLS evaluation (which
--    calls them by OID, not by name) completely unaffected.
-- ============================================================

create schema if not exists internal;
grant usage on schema internal to anon, authenticated;

alter function public.is_site_admin() set schema internal;
alter function public.is_club_admin(uuid) set schema internal;
alter function public.can_manage_team(uuid) set schema internal;
alter function public.audit_row_change() set schema internal;

revoke execute on function internal.is_site_admin() from public;
revoke execute on function internal.is_club_admin(uuid) from public;
revoke execute on function internal.can_manage_team(uuid) from public;
revoke execute on function internal.audit_row_change() from public;

grant execute on function internal.is_site_admin() to anon, authenticated;
grant execute on function internal.is_club_admin(uuid) to anon, authenticated;
grant execute on function internal.can_manage_team(uuid) to anon, authenticated;
-- audit_row_change is only ever invoked by the trigger mechanism itself
-- (as the function owner), never directly by a role — no execute grant
-- needed for anon/authenticated.

-- ============================================================
-- 3. multiple_permissive_policies: eight tables each had two separate
--    permissive SELECT policies (a public-active one and an admin one).
--    Functionally equivalent, but Postgres evaluates every permissive
--    policy for a query, so two policies cost more than one ORed
--    together. Recreated as a single policy per table; all NEW policy
--    text below schema-qualifies internal.* since `internal` is not on
--    the default search_path.
-- ============================================================

drop policy club_directory_select_active on public.club_directory;
drop policy club_directory_select_admin on public.club_directory;
create policy club_directory_select on public.club_directory for select
  using (active = true or internal.is_site_admin());

drop policy clubs_select_active on public.clubs;
drop policy clubs_select_admin on public.clubs;
create policy clubs_select on public.clubs for select
  using (status = 'active' or internal.is_site_admin() or internal.is_club_admin(id));

drop policy teams_select_active on public.teams;
drop policy teams_select_admin on public.teams;
create policy teams_select on public.teams for select
  using (active = true or internal.is_site_admin() or internal.is_club_admin(club_id));

drop policy venues_select_active on public.venues;
drop policy venues_select_admin on public.venues;
create policy venues_select on public.venues for select
  using (active = true or internal.is_site_admin());

drop policy competitions_select_active on public.competitions;
drop policy competitions_select_admin on public.competitions;
create policy competitions_select on public.competitions for select
  using (active = true or internal.is_site_admin());

drop policy competition_editions_select_active on public.competition_editions;
drop policy competition_editions_select_admin on public.competition_editions;
create policy competition_editions_select on public.competition_editions for select
  using (active = true or internal.is_site_admin());

drop policy club_contacts_select_public on public.club_contacts;
drop policy club_contacts_select_admin on public.club_contacts;
create policy club_contacts_select on public.club_contacts for select
  using (is_public = true or internal.is_site_admin() or internal.is_club_admin(club_id));

drop policy team_contacts_select_public on public.team_contacts;
drop policy team_contacts_select_admin on public.team_contacts;
create policy team_contacts_select on public.team_contacts for select
  using (
    is_public = true
    or internal.is_site_admin()
    or internal.is_club_admin((select club_id from public.teams where id = team_id))
  );

-- ============================================================
-- 4. auth_rls_initplan: bare auth.uid() calls in a policy are
--    re-evaluated per row; wrapping in (select auth.uid()) lets Postgres
--    evaluate it once as an initPlan. Nine policies affected.
-- ============================================================

alter policy profiles_select_self_or_admin on public.profiles
  using (id = (select auth.uid()) or internal.is_site_admin());

alter policy profiles_insert_self on public.profiles
  with check (id = (select auth.uid()));

alter policy profiles_update_self_or_admin on public.profiles
  using (id = (select auth.uid()) or internal.is_site_admin());

alter policy club_claims_insert_self on public.club_claims
  with check (claimant_user_id = (select auth.uid()));

alter policy club_join_requests_insert_self on public.club_join_requests
  with check (requesting_user_id = (select auth.uid()));

alter policy directory_requests_insert_self on public.directory_requests
  with check (submitted_by = (select auth.uid()));

alter policy club_memberships_select_scoped on public.club_memberships
  using (
    user_id = (select auth.uid())
    or internal.is_site_admin()
    or internal.is_club_admin(club_id)
  );

alter policy terms_acceptances_select_scoped on public.terms_acceptances
  using (user_id = (select auth.uid()) or internal.is_site_admin());

alter policy terms_acceptances_insert_self on public.terms_acceptances
  with check (user_id = (select auth.uid()));

-- ============================================================
-- 5. unindexed_foreign_keys: 44 FK columns (mostly created_by/updated_by
--    audit columns) had no covering index.
-- ============================================================

create index audit_log_changed_by_idx on public.audit_log (changed_by);
create index club_aliases_created_by_idx on public.club_aliases (created_by);
create index club_claims_claimant_user_id_idx on public.club_claims (claimant_user_id);
create index club_claims_decided_by_idx on public.club_claims (decided_by);
create index club_contacts_created_by_idx on public.club_contacts (created_by);
create index club_contacts_updated_by_idx on public.club_contacts (updated_by);
create index club_directory_created_by_idx on public.club_directory (created_by);
create index club_directory_updated_by_idx on public.club_directory (updated_by);
create index club_join_requests_decided_by_idx on public.club_join_requests (decided_by);
create index club_join_requests_requesting_user_id_idx on public.club_join_requests (requesting_user_id);
create index club_memberships_created_by_idx on public.club_memberships (created_by);
create index club_memberships_updated_by_idx on public.club_memberships (updated_by);
create index club_opponent_notes_created_by_idx on public.club_opponent_notes (created_by);
create index club_opponent_notes_directory_id_idx on public.club_opponent_notes (directory_id);
create index club_opponent_notes_updated_by_idx on public.club_opponent_notes (updated_by);
create index clubs_created_by_idx on public.clubs (created_by);
create index clubs_updated_by_idx on public.clubs (updated_by);
create index competition_edition_teams_created_by_idx on public.competition_edition_teams (created_by);
create index competition_editions_created_by_idx on public.competition_editions (created_by);
create index competition_editions_updated_by_idx on public.competition_editions (updated_by);
create index competitions_created_by_idx on public.competitions (created_by);
create index competitions_updated_by_idx on public.competitions (updated_by);
create index directory_requests_created_directory_id_idx on public.directory_requests (created_directory_id);
create index directory_requests_reviewed_by_idx on public.directory_requests (reviewed_by);
create index directory_requests_submitted_by_idx on public.directory_requests (submitted_by);
create index fixtures_created_by_idx on public.fixtures (created_by);
create index fixtures_opponent_team_id_idx on public.fixtures (opponent_team_id);
create index fixtures_updated_by_idx on public.fixtures (updated_by);
create index fixtures_venue_id_idx on public.fixtures (venue_id);
create index seasons_created_by_idx on public.seasons (created_by);
create index seasons_updated_by_idx on public.seasons (updated_by);
create index site_admins_granted_by_idx on public.site_admins (granted_by);
create index site_admins_revoked_by_idx on public.site_admins (revoked_by);
create index team_contacts_created_by_idx on public.team_contacts (created_by);
create index team_contacts_updated_by_idx on public.team_contacts (updated_by);
create index team_permissions_created_by_idx on public.team_permissions (created_by);
create index team_permissions_team_id_idx on public.team_permissions (team_id);
create index teams_created_by_idx on public.teams (created_by);
create index teams_updated_by_idx on public.teams (updated_by);
create index unresolved_names_resolved_by_idx on public.unresolved_names (resolved_by);
create index unresolved_names_resolved_directory_id_idx on public.unresolved_names (resolved_directory_id);
create index venues_club_id_idx on public.venues (club_id);
create index venues_created_by_idx on public.venues (created_by);
create index venues_updated_by_idx on public.venues (updated_by);

-- Not addressed: `unused_index` (24 findings). Every index on this database
-- is "unused" simply because zero queries have run against it yet — that's
-- expected on a freshly migrated, empty database and not a real finding to
-- fix; it will resolve itself as the advisor re-evaluates against real
-- query traffic later.
