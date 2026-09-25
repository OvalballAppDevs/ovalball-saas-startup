-- CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE: THE CANONICAL CANDIDATE SEARCH.
--
-- SECTION 6 ANSWERS "WHO COULD WE PLAY?" -- never "who is free" (Section 7) and never a second fixture-
-- request domain (Section 8/9 own that). The existing `compatible_opponent_teams(p_team_id,
-- p_opponent_club_id)` already answers "which of THIS NAMED club's teams could we play" -- exactly
-- right for the composer's own opponent-already-chosen step, and reused unchanged there. What Clubhouse
-- discovery needs is the same rule, batched: across EVERY other club at once, so the client never makes
-- one RPC call per club in the network (today six; designed for hundreds).
--
-- THE SAME RULE, NEVER A SECOND ONE. This function is `compatible_opponent_teams` with the single
-- opponent-club filter removed -- same authority check (a caller must hold `fixture.request.create` or
-- `fixture.fixture.create` at the named TEAM, never club.partners.manage, never inferred from a role
-- name), same `internal.identities_can_play_fixture` compatibility predicate (rugby code, category,
-- age-fixture-band, the girls-always-compatible special case), same active/not-folded/not-archived
-- exclusion, same minimal projection. A future drift between the two would mean two different answers
-- to "could these teams play each other" depending only on which screen asked -- this migration
-- deliberately keeps them textually parallel so that risk stays visible to a reviewer, not hidden behind
-- two independently-evolving predicates.
create or replace function public.find_fixture_candidate_teams(p_team_id uuid)
returns table(team_id uuid, club_id uuid, display_name text, age_group text, gender text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.';
  end if;

  if not (internal.can('fixture.request.create', 'team', v_club, p_team_id, null)
       or internal.can('fixture.fixture.create', 'team', v_club, p_team_id, null)) then
    raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
  end if;

  return query
  select o.id, o.club_id, o.display_name, o.age_group, o.gender
  from public.teams o
  join public.teams me on me.id = p_team_id
  where o.club_id <> v_club
    and coalesce(o.active, true) and o.folded_at is null and o.archived_at is null
    and internal.identities_can_play_fixture(
      me.rugby_code, me.category, me.age_group, me.gender,
      o.rugby_code, o.category, o.age_group, o.gender)
  order by o.display_name;
end;
$$;

revoke execute on function public.find_fixture_candidate_teams(uuid) from public;
grant execute on function public.find_fixture_candidate_teams(uuid) to authenticated;

comment on function public.find_fixture_candidate_teams(uuid) is
  'Clubhouse Programme Section 6: the batched form of compatible_opponent_teams -- every legitimate compatible opposition team across the whole network in one call, never one RPC per candidate club. Same authority (team-scoped fixture.request.create/.fixture.create, never club.partners.manage) and same internal.identities_can_play_fixture rule as compatible_opponent_teams; kept textually parallel to it deliberately. Minimal projection only: team_id, club_id, display_name, age_group, gender -- no roster, no calendar, no fixture history.';
