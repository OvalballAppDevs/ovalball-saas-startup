-- =====================================================================
-- A FIXTURE IS NOT ANONYMOUSLY OPERATIONAL
--
-- The integrity audit measured this as anon: 10 of 10 fixtures readable,
-- including meet_time / notes / changing_room / pitch_allocation on 6 of them,
-- because `fixtures_select_all` was USING (true) granted to anon and
-- authenticated. Nothing was protecting the operational columns except one
-- page remembering to select a narrow field list -- app-side discipline
-- standing in for a database boundary, which is precisely what an audit is
-- supposed to refuse.
--
-- WHAT THE PUBLIC SURFACE ACTUALLY NEEDS, derived rather than assumed.
--
-- Exactly ONE anonymous route reads fixtures: app/club/[slug]/page.tsx. Every
-- other public route is marketing or legal and reads none. That page selects:
--
--   id, kickoff_date, kickoff_time, home_away, raw_opposition_text,
--   owning_team_id, season_id, teams(club_id, display_name)
--
-- filtered to status 'Booked', kickoff_date >= today, limit 10.
--
-- So the minimum public projection is those columns and those rows. Anything
-- else a public club page might one day want -- a result, a past fixture -- is
-- a deliberate extension of this view, made once, here, in the open.
--
-- MEET TIME IS NOT PUBLIC. The audit asked this explicitly. The public page
-- does not select it, no other anonymous surface reads it, and it is the time
-- a child is told to arrive at a ground -- participant information, not
-- advertising. It is absent from the projection and now unreadable
-- anonymously.
--
-- Neither are notes, changing_room, pitch_allocation, venue_address, venue_id,
-- pitch_id, scores, opponent_team_id, mirror_fixture_id or the confirmation
-- and audit columns.
--
-- THE SHAPE:
--   private canonical fixtures  ->  public_club_fixtures projection  ->  anon
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHO MAY SEE A FIXTURE AT ALL.
--
-- The same shape as internal.training_session_visible_row, deliberately: two
-- event kinds, one idea of "you have a legitimate relationship to this".
-- Written over the row's own columns so the policy needs no second lookup.
-- ---------------------------------------------------------------------
create or replace function internal.fixture_visible_row(
  p_owning_team_id uuid,
  p_opponent_team_id uuid,
  p_owning_group_id uuid,
  p_opponent_group_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with sides as (
    -- Both teams named directly on the fixture...
    select unnest(array[p_owning_team_id, p_opponent_team_id]) as team_id
    union
    -- ...plus every member team of either scheduling group, which is how
    -- Mini-Rugby fixtures name their sides.
    select sgm.team_id from public.scheduling_group_members sgm
    where sgm.group_id in (p_owning_group_id, p_opponent_group_id)
  ),
  side_teams as (select team_id from sides where team_id is not null)
  select
    internal.is_site_admin()

    -- Anybody holding a role at either club involved. A club's own fixture
    -- list is a club-wide artefact, and this is who already reads it.
    or exists (
      select 1 from side_teams s
      join public.teams t on t.id = s.team_id
      join public.club_memberships cm on cm.club_id = t.club_id
      where cm.user_id = auth.uid() and cm.status = 'active'
    )

    -- The people it is actually about: a player on either side, or the adult
    -- responsible for one. Guardians routinely hold no club_memberships row,
    -- so without this a parent would lose their own child's fixtures.
    or exists (
      select 1 from side_teams s
      join public.player_team_memberships ptm on ptm.team_id = s.team_id and ptm.status = 'active'
      where internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id)
    );
$$;

comment on function internal.fixture_visible_row(uuid, uuid, uuid, uuid) is
  'THE visibility rule for a fixture: site admin, a role at either club, or a participant/their guardian. Mirrors internal.training_session_visible_row so the two event kinds answer one question the same way.';

-- ---------------------------------------------------------------------
-- 2. THE CANONICAL TABLE STOPS BEING ANONYMOUS.
-- ---------------------------------------------------------------------
drop policy if exists fixtures_select_all on public.fixtures;

create policy fixtures_select_related on public.fixtures
  for select
  to authenticated
  using (
    internal.fixture_visible_row(owning_team_id, opponent_team_id, owning_scheduling_group_id, opponent_scheduling_group_id)
  );

-- ---------------------------------------------------------------------
-- 3. THE PUBLIC PROJECTION.
--
-- security_invoker = false is stated EXPLICITLY rather than left to the
-- server default: this view is deliberately the one controlled hole in the
-- boundary above, and that intent should be readable in the migration rather
-- than inferred from a Postgres version.
--
-- The row filter lives IN the view, so anon cannot widen it: no past
-- fixtures, nothing unconfirmed, nothing archived.
-- ---------------------------------------------------------------------
drop view if exists public.public_club_fixtures;

create view public.public_club_fixtures
with (security_invoker = false)
as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.raw_opposition_text,
  f.owning_team_id,
  f.season_id,
  t.club_id,
  t.display_name as team_display_name
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
where f.status = 'Booked'
  and f.archived_at is null
  and f.kickoff_date >= current_date;

comment on view public.public_club_fixtures is
  'The ONLY fixture data an anonymous visitor may read: confirmed, future fixtures, public identity columns only. No meet time, no notes, no changing room, no pitch allocation, no venue detail, no scores. Extending this view is a deliberate decision about what Ovalball publishes.';

grant select on public.public_club_fixtures to anon, authenticated;

-- NO TABLE-LEVEL REVOKE FROM anon, and that is deliberate.
--
-- Revoking the grant looked like useful belt-and-braces and was a booby trap:
-- other tables' RLS policies join to public.fixtures (player_fixture_attendance
-- does), so with the grant gone an anonymous caller reading THOSE tables got
-- `permission denied for table fixtures` instead of zero rows. A policy
-- evaluation is not supposed to be able to fail like that, and it turned a
-- clean empty result into an error on any public surface that touched one.
--
-- The policy above is `TO authenticated`, so an anonymous caller matches no
-- permissive policy on fixtures and reads zero rows -- which is the same
-- security outcome, reached the way RLS is meant to reach it. Caught by
-- supabase/tests/match_centre_core.sql, which is exactly what that test is
-- for.
