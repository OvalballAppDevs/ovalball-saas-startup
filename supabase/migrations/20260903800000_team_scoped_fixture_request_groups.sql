-- Team Manager / Coach permission parity, part 2: fixture_request_groups
-- RLS closes the last gap in "a team-scoped Coach/Manager/Team Admin with
-- no separate club-wide role can create a fixture request for their own
-- team."
--
-- internal.can_manage_team already treats team_admin/coach/manager
-- identically everywhere it's used (fixture_requests itself,
-- fixtures_insert_scoped, training_sessions, messaging/participant
-- policies -- verified by reading every one of those policies this
-- session), and permission_groups already documents Coach/Manager as
-- real, equally-capable groups (20260831240000). The one place that
-- DIDN'T follow that pattern: fixture_request_groups (the club-to-club
-- "ask" a fixture_requests row belongs to) required
-- can_manage_club_fixtures (CLUB_ADMIN/FIXTURE_SECRETARY) alone for
-- insert/update/select, with no team-scoped fallback at all -- so a
-- team-scoped-only Coach could never create the PARENT group row their
-- own team-scoped fixture_requests row needs to reference, even though
-- fixture_requests' own insert policy has always allowed them to create
-- the child row. Found via live verification (test.coach@ovalball.local
-- hit "new row violates row-level security policy for table
-- fixture_request_groups" when submitting Request a Fixture) after fixing
-- the analogous app-layer gate in app/(app)/fixtures/new/page.tsx
-- (manageableClubId no longer required club-wide authority alone).

create or replace function internal.can_manage_club_fixtures_or_any_team(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_site_admin()
    or internal.can_manage_club_fixtures(p_club_id)
    or exists (
      select 1
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id
      join public.teams t on t.id = tp.team_id
      where t.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and tp.permission in ('team_admin', 'coach', 'manager')
    );
$$;

comment on function internal.can_manage_club_fixtures_or_any_team(uuid) is
  'can_manage_club_fixtures widened with a team-scoped fallback: true for Site Admin, club-wide fixture authority (CLUB_ADMIN/FIXTURE_SECRETARY), OR any real team-scoped write authority (team_admin/coach/manager) on ANY team at that club. Used only where the caller is acting as "this club, on behalf of a team I manage" (fixture_request_groups insert/update) -- ordinary per-team authorization keeps using the narrower internal.can_manage_team(team_id) unchanged.';

grant execute on function internal.can_manage_club_fixtures_or_any_team(uuid) to anon, authenticated;

drop policy fixture_request_groups_insert_scoped on public.fixture_request_groups;
create policy fixture_request_groups_insert_scoped on public.fixture_request_groups for insert
  with check (internal.can_manage_club_fixtures_or_any_team(requesting_club_id));

drop policy fixture_request_groups_update_scoped on public.fixture_request_groups;
create policy fixture_request_groups_update_scoped on public.fixture_request_groups for update
  using (internal.can_manage_club_fixtures_or_any_team(requesting_club_id));

-- SELECT widened the same way, but with the SAME precision fixture_requests
-- itself already uses (visible when the caller can see at least one real
-- fixture_requests child row) rather than "any team at the club" -- a Coach
-- should see a fixture_request_groups row when they can see at least one of
-- its real fixture_requests children, never every group the club has ever
-- sent or received regardless of which team it concerns.
--
-- This check MUST go through a SECURITY DEFINER function rather than a
-- plain correlated subquery on fixture_requests directly: fixture_requests'
-- own select policy (fixture_requests_select_scoped, unchanged) already
-- does the mirror-image EXISTS lookup back into fixture_request_groups. Two
-- plain subqueries pointing at each other's RLS-checked tables triggers
-- "infinite recursion detected in policy" the moment either table is
-- queried -- caught by the full regression suite after this migration's
-- first draft. A SECURITY DEFINER function owned by the migration role
-- (postgres, which has BYPASSRLS) reads fixture_requests directly without
-- re-invoking its policy, breaking the cycle while still only exposing
-- exactly the rows the caller could already see via fixture_requests
-- itself.
create or replace function internal.group_has_visible_request(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.fixture_requests fr
    where fr.group_id = p_group_id
      and (internal.can_manage_team(fr.requesting_team_id)
           or (fr.target_team_id is not null and internal.can_manage_team(fr.target_team_id)))
  );
$$;

comment on function internal.group_has_visible_request(uuid) is
  'Whether the caller can already see at least one fixture_requests row belonging to this group, per fixture_requests own visibility rules -- reads fixture_requests directly (bypassing its RLS, since this function runs as its postgres owner) specifically to avoid a policy-recursion cycle with fixture_request_groups_select_scoped, which calls this instead of a plain correlated subquery.';

grant execute on function internal.group_has_visible_request(uuid) to anon, authenticated;

-- created_by = auth.uid() matters beyond "the creator can always see their
-- own row": the app inserts the group, then immediately does
-- .select("id").single() on it BEFORE any fixture_requests child row
-- exists yet (createFixtureRequest, app/(app)/fixtures/new/actions.ts) --
-- without this clause, group_has_visible_request(id) is still false at
-- that exact moment (no children to match yet) and a team-scoped-only
-- Coach's own create-fixture-request flow would silently fail on the
-- immediate read-back, even though the INSERT itself succeeded. Found by
-- reproducing the real app's insert-then-select sequence directly against
-- RLS, not just the insert alone, after the first live browser attempt
-- appeared to succeed but was never independently confirmed past "Send
-- request".
drop policy fixture_request_groups_select_scoped on public.fixture_request_groups;
create policy fixture_request_groups_select_scoped on public.fixture_request_groups for select
  using (
    internal.is_site_admin()
    or internal.can_manage_club_fixtures(requesting_club_id)
    or (opponent_club_id is not null and internal.can_manage_club_fixtures(opponent_club_id))
    or created_by = auth.uid()
    or internal.group_has_visible_request(id)
  );
