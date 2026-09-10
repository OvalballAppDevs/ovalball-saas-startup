-- =====================================================================
-- THE CALENDAR VIEW OF TOURNAMENTS SHOWS THEM TO THE PEOPLE GOING
--
-- public.club_visible_tournaments answered "which tournaments may this
-- ADMINISTRATOR manage" -- can_manage_club_fixtures at the host, or an
-- accepted participant's team. That was right when a tournament was purely an
-- inter-club negotiation between two fixture secretaries.
--
-- It is wrong now. A player in the U12 side going to a festival, and the
-- parent driving them there, could not see it on their own Calendar at all,
-- because neither holds a fixture-management capability. The tournament they
-- are attending was invisible to exactly the people attending it.
--
-- The predicate becomes internal.tournament_visible_row -- the one canonical
-- answer to "who can see this tournament", already used by every RLS policy
-- on the tournament tables -- so the Calendar and the row policies can never
-- disagree about who a tournament is for.
--
-- It also gains `name` and `ends_on`, so the Calendar can label a tournament
-- by what it is called rather than by its host and date, and can span a
-- multi-day festival across the days it actually runs.
-- =====================================================================
drop view if exists public.club_visible_tournaments;

create view public.club_visible_tournaments
with (security_invoker = true)
as
select distinct
  t.id,
  t.name,
  t.host_club_id,
  t.host_team_id,
  t.host_directory_id,
  t.rugby_code,
  t.season_id,
  t.competition_edition_id,
  t.event_date,
  t.ends_on,
  t.kickoff_time,
  t.pitch_id,
  t.venue_notes,
  t.status,
  t.notes,
  t.conversation_id,
  t.created_by,
  t.updated_by,
  t.created_at,
  t.updated_at,
  t.cancelled_at,
  t.cancellation_reason,
  t.venue_id
from public.tournaments t
where t.status in ('confirmed', 'completed')
  and internal.tournament_visible_row(t.id);

grant select on public.club_visible_tournaments to authenticated;
