-- CLUBHOUSE PROGRAMME -- FIND A FIXTURE FF-1.1/FF-2: REAL MULTI-TEAM MATCHING.
--
-- FF-1 now lets a caller select MORE THAN ONE of their own teams before searching (checkboxes, not a
-- single radio). The temporary bridge that shipped with FF-1 -- `criteria.teamIds[0]` standing in for
-- the whole selection when calling the existing singular `find_fixture_candidate_teams(uuid)` /
-- `find_fixture_candidate_availability(uuid, date[])` -- was accepted for that one pass only, explicitly
-- as a documented limitation, never as the real read model. This migration is the real read model.
--
-- THE SAME RULE, NEVER A SECOND ONE, NOW BATCHED ACROSS TEAMS TOO. Each new function is its singular
-- counterpart with `p_team_id uuid` widened to `p_team_ids uuid[]` and `my_team_id` threaded through
-- every CTE so one round trip answers "for EACH of my selected teams, which opposition teams / which
-- dates" rather than the client looping one RPC call per selected team (an N+1 the owner explicitly
-- ruled out). Same authority check, same `internal.identities_can_play_fixture` predicate, same
-- active-partnership-only availability boundary, same busy/request_pending coarsening -- copied
-- unchanged from `find_fixture_candidate_teams` / `find_fixture_candidate_availability`, kept textually
-- parallel to them deliberately so a reviewer can see nothing else moved.
--
-- NO AUTHORITY WIDENING: every team named in `p_team_ids` is checked individually, in a loop, against
-- the SAME `fixture.request.create` / `fixture.fixture.create` team-scoped capability the singular
-- functions already require. A caller who may arrange fixtures for team A but not team B gets a hard
-- 42501 for the whole call if B is included -- never a partial result that silently drops B, which would
-- let a client discover which teams it lacks authority over by comparing what came back to what it asked
-- for.
--
-- BOUNDS: 1-20 teams (a generous ceiling above any real club's roster in one rugby code), 1-6 dates
-- (unchanged from Section 7).
create or replace function public.find_fixture_candidate_teams_batch(p_team_ids uuid[])
returns table(my_team_id uuid, team_id uuid, club_id uuid, display_name text, age_group text, gender text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_team_id uuid;
  v_club uuid;
  v_team_count integer;
begin
  v_team_count := coalesce(array_length(p_team_ids, 1), 0);
  if v_team_count < 1 or v_team_count > 20 then
    raise exception 'Select between 1 and 20 teams.';
  end if;

  foreach v_team_id in array p_team_ids loop
    select t.club_id into v_club from public.teams t where t.id = v_team_id;
    if v_club is null then
      raise exception 'Team not found.';
    end if;

    if not (internal.can('fixture.request.create', 'team', v_club, v_team_id, null)
         or internal.can('fixture.fixture.create', 'team', v_club, v_team_id, null)) then
      raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
    end if;
  end loop;

  return query
  select me.id, o.id, o.club_id, o.display_name, o.age_group, o.gender
  from public.teams me
  join public.teams o on o.club_id <> me.club_id
  where me.id = any (p_team_ids)
    and coalesce(o.active, true) and o.folded_at is null and o.archived_at is null
    and internal.identities_can_play_fixture(
      me.rugby_code, me.category, me.age_group, me.gender,
      o.rugby_code, o.category, o.age_group, o.gender)
  order by me.id, o.display_name;
end;
$$;

revoke execute on function public.find_fixture_candidate_teams_batch(uuid[]) from public;
grant execute on function public.find_fixture_candidate_teams_batch(uuid[]) to authenticated;

comment on function public.find_fixture_candidate_teams_batch(uuid[]) is
  'Find a Fixture FF-1/FF-2: the multi-team batched form of find_fixture_candidate_teams -- every legitimate compatible opposition team across the whole network, for every one of the callers selected teams, in a single call. Same per-team authority check (fixture.request.create/.fixture.create, checked individually, no widening) and same internal.identities_can_play_fixture rule, kept textually parallel to find_fixture_candidate_teams deliberately. Minimal projection: my_team_id, team_id, club_id, display_name, age_group, gender.';

create or replace function public.find_fixture_candidate_availability_batch(p_team_ids uuid[], p_dates date[])
returns table(my_team_id uuid, opponent_team_id uuid, the_date date, status text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_team_id uuid;
  v_club uuid;
  v_team_count integer;
  v_date_count integer;
begin
  v_team_count := coalesce(array_length(p_team_ids, 1), 0);
  if v_team_count < 1 or v_team_count > 20 then
    raise exception 'Select between 1 and 20 teams.';
  end if;

  foreach v_team_id in array p_team_ids loop
    select t.club_id into v_club from public.teams t where t.id = v_team_id;
    if v_club is null then
      raise exception 'Team not found.';
    end if;

    if not (internal.can('fixture.request.create', 'team', v_club, v_team_id, null)
         or internal.can('fixture.fixture.create', 'team', v_club, v_team_id, null)) then
      raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
    end if;
  end loop;

  v_date_count := coalesce(array_length(p_dates, 1), 0);
  if v_date_count < 1 or v_date_count > 6 then
    raise exception 'Select between 1 and 6 dates.';
  end if;

  return query
  with me as (
    select * from public.teams where id = any (p_team_ids)
  ),
  candidates as (
    select me.id as my_team_id, o.id as team_id, o.club_id
    from public.teams o, me
    where o.club_id <> me.club_id
      and coalesce(o.active, true) and o.folded_at is null and o.archived_at is null
      and internal.identities_can_play_fixture(me.rugby_code, me.category, me.age_group, me.gender, o.rugby_code, o.category, o.age_group, o.gender)
      and exists (
        select 1 from public.club_partnerships cp
        where cp.status = 'active'
          and ((cp.requesting_club_id = me.club_id and cp.partner_club_id = o.club_id)
            or (cp.partner_club_id = me.club_id and cp.requesting_club_id = o.club_id))
      )
  ),
  fixture_hits as (
    select c.my_team_id, f.owning_team_id as team_id, f.kickoff_date as d, 'busy'::text as status
    from public.fixtures f
    join candidates c on c.team_id = f.owning_team_id
    where f.status <> 'Cancelled' and f.kickoff_date = any (p_dates)
  ),
  competition_hits as (
    select c.my_team_id, c.team_id, cm.match_date as d, 'busy'::text
    from public.competition_matches cm
    join public.competition_participants hp on hp.id = cm.home_participant_id
    join public.competition_participants ap on ap.id = cm.away_participant_id
    join candidates c on c.team_id = hp.team_id or c.team_id = ap.team_id
    where cm.status not in ('cancelled', 'draft', 'postponed')
      and cm.match_date = any (p_dates)
      and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = cm.id)
  ),
  training_hits as (
    select c.my_team_id, ts.team_id, ts.session_date as d, 'busy'::text
    from public.training_sessions ts
    join candidates c on c.team_id = ts.team_id
    where ts.status <> 'CANCELLED' and ts.session_date = any (p_dates)
  ),
  club_event_hits as (
    select c.my_team_id, c.team_id, e.starts_on as d, 'busy'::text
    from public.club_events e
    join candidates c on c.club_id = e.club_id
    where e.starts_on = any (p_dates)
      and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = c.team_id))
  ),
  pending_hits as (
    select c.my_team_id, c.team_id, coalesce(r.countered_date, g.proposed_date) as d, 'request_pending'::text
    from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    join candidates c on c.team_id = r.requesting_team_id or c.team_id = r.target_team_id
    where r.status in ('sent', 'counter_proposed')
      and coalesce(r.countered_date, g.proposed_date) = any (p_dates)
  ),
  all_hits as (
    select * from fixture_hits
    union all select * from competition_hits
    union all select * from training_hits
    union all select * from club_event_hits
    union all select * from pending_hits
  )
  select all_hits.my_team_id, all_hits.team_id, all_hits.d, case when bool_or(all_hits.status = 'busy') then 'busy' else 'request_pending' end
  from all_hits
  group by all_hits.my_team_id, all_hits.team_id, all_hits.d;
end;
$$;

revoke execute on function public.find_fixture_candidate_availability_batch(uuid[], date[]) from public;
grant execute on function public.find_fixture_candidate_availability_batch(uuid[], date[]) to authenticated;

comment on function public.find_fixture_candidate_availability_batch(uuid[], date[]) is
  'Find a Fixture FF-1/FF-2: the multi-team batched form of find_fixture_candidate_availability -- batched, privacy-safe date-availability search across every compatible PARTNER club, for every one of the callers selected teams, up to 6 dates, one round trip. Same per-team authority check (no widening), same active-partnership-only boundary, same busy/request_pending coarsening as find_fixture_candidate_availability. Coarse rows only (my_team_id, opponent_team_id, the_date, status) -- absence of a row means no known clash, never returned as a status value; no event detail, no roster, no calendar content.';
