-- Public season team names for the Club Digital Home.
--
-- Identity/Auth Slice 1 forward-fix. A club's public home labels each upcoming
-- public fixture with the team's identity in that fixture's season (a stored
-- Season Handover snapshot, the live team for the current season, or the
-- projected age grade for a later season). It resolved those names through
-- get_team_identities_for_season_batch, a SECURITY INVOKER function that reads
-- whole teams rows. The Slice 1 perimeter rightly gave anonymous callers only
-- a column allowlist on teams and no execute on that function, so signed-out
-- visitors got 401 and the page fell back to today's team name -- wrong for a
-- fixture in any season other than the current one.
--
-- This adds a deliberate public projection instead of widening teams:
--
--   * input: data identifiers only, a list of (team_id, season_id) pairs;
--   * scope: only pairs that already appear together in public_club_fixtures,
--     the existing public fixture contract, so it reveals nothing about teams,
--     seasons or fixtures that are not already public;
--   * output: team_id, season_id and the season's display name -- nothing
--     else from teams, team_season_identity or seasons;
--   * resolution: the one canonical resolver, get_team_identity_for_season,
--     so the public page and the signed-in surfaces can never disagree.
--
-- Executable by anon only (signed-in pages keep the existing resolver). No
-- table, view or existing function grant changes.

create or replace function public.get_public_team_season_names(p_pairs jsonb)
returns table (team_id uuid, season_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_pairs is null or pg_catalog.jsonb_typeof(p_pairs) <> 'array' then
    return;
  end if;
  if pg_catalog.jsonb_array_length(p_pairs) > 100 then
    raise exception 'Too many team and season pairs.' using errcode = '22023';
  end if;

  return query
    with requested as (
      select distinct e ->> 'team_id' as team_text, e ->> 'season_id' as season_text
      from pg_catalog.jsonb_array_elements(p_pairs) e
      where pg_catalog.jsonb_typeof(e) = 'object'
    ),
    valid as (
      select r.team_text::uuid as team_id, r.season_text::uuid as season_id
      from requested r
      where r.team_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and r.season_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    public_pairs as (
      select v.team_id, v.season_id
      from valid v
      where exists (
        select 1 from public.public_club_fixtures f
        where f.owning_team_id = v.team_id and f.season_id = v.season_id
      )
    )
    select p.team_id, p.season_id, i.display_name
    from public_pairs p
    cross join lateral public.get_team_identity_for_season(p.team_id, p.season_id) i;
end;
$$;

comment on function public.get_public_team_season_names(jsonb) is
  'Public projection: the season-correct display name of a team for (team, season) pairs that appear in public_club_fixtures. Returns team_id, season_id, display_name only. Consumer: lib/club-public/load-club-home.ts for signed-out visitors.';

revoke all on function public.get_public_team_season_names(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_public_team_season_names(jsonb) to anon;
