-- FIND A FIXTURE -- GAME WEEK AWARENESS (visual-lock Section A5-A9).
--
-- A team may play Friday night, Saturday and Sunday inside the same rugby working week. Section 7's
-- own exact-date busy/tentative/no_known_clash rule (find_fixture_candidate_availability_batch) answers
-- "is this team free on THIS SPECIFIC date" -- correctly, and unchanged here. It cannot answer "does
-- this team already have a game elsewhere this week", and presenting an empty Sunday as simply "clear"
-- when the same team played Friday night would be a truthful-looking answer that omits the one fact a
-- club actually needs before asking for that date.
--
-- A NEW, NARROWER FUNCTION, NOT A SECOND AVAILABILITY ENGINE. Same per-team authority loop (checked
-- individually, no widening), same compatible-and-partnered candidates CTE, kept textually parallel to
-- find_fixture_candidate_availability_batch deliberately -- but two things are deliberately different:
--   1. THE DATE RANGE WIDENS to the full Monday-Sunday week(s) spanning the requested dates (Postgres's
--      own date_trunc('week', ...) already truncates to Monday, so this needs no separate weekday
--      arithmetic), never just the exact requested dates.
--   2. THE SOURCES NARROW to real fixtures and competition matches only -- training sessions, club
--      events and pending fixture requests are not "the team already has a game this week" (Section
--      A9), and are deliberately excluded here even though they already count toward the exact-date
--      busy/tentative rule in the other function. Duplicating them here would conflate "the club is busy
--      with something" (the exact-date question) with "the team has rugby elsewhere this week" (this
--      question), which are genuinely different facts.
--
-- COARSENING, DELIBERATELY LESS THAN THE EXACT-DATE FORM. This returns the RAW commitment date per
-- (my_team_id, opponent_team_id), never collapsed to a single status -- the client needs to know WHICH
-- day in the week is already spoken for to display "Busy this week -- Fri 9 Oct", not just that one is.
-- This is still safe: it is the caller's OWN partnered network, exactly the same audience the exact-date
-- function already discloses busy/tentative dates to; nothing here is disclosed to a wider audience or a
-- less-authorised one.
create or replace function public.find_fixture_candidate_game_week_batch(p_team_ids uuid[], p_dates date[])
returns table(my_team_id uuid, opponent_team_id uuid, commitment_date date)
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
  weeks as (
    select distinct
      date_trunc('week', d)::date as week_start,
      (date_trunc('week', d) + interval '6 days')::date as week_end
    from unnest(p_dates) as d
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
    select c.my_team_id, f.owning_team_id as team_id, f.kickoff_date as d
    from public.fixtures f
    join candidates c on c.team_id = f.owning_team_id
    join weeks w on f.kickoff_date between w.week_start and w.week_end
    where f.status <> 'Cancelled'
  ),
  competition_hits as (
    select c.my_team_id, c.team_id, cm.match_date as d
    from public.competition_matches cm
    join public.competition_participants hp on hp.id = cm.home_participant_id
    join public.competition_participants ap on ap.id = cm.away_participant_id
    join candidates c on c.team_id = hp.team_id or c.team_id = ap.team_id
    join weeks w on cm.match_date between w.week_start and w.week_end
    where cm.status not in ('cancelled', 'draft', 'postponed')
      and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = cm.id)
  )
  select distinct all_hits.my_team_id, all_hits.team_id, all_hits.d
  from (
    select * from fixture_hits
    union all
    select * from competition_hits
  ) all_hits
  order by 1, 2, 3;
end;
$$;

revoke execute on function public.find_fixture_candidate_game_week_batch(uuid[], date[]) from public;
grant execute on function public.find_fixture_candidate_game_week_batch(uuid[], date[]) to authenticated;

comment on function public.find_fixture_candidate_game_week_batch(uuid[], date[]) is
  'Find a Fixture game-week awareness: for every one of the caller''s selected teams, every real fixture/competition-match commitment (never training/events/pending requests) any compatible PARTNER opposition team has anywhere in the Monday-Sunday game week(s) spanning the requested dates. Same per-team authority as find_fixture_candidate_availability_batch, checked individually, no widening. Deliberately narrower sources (real matches only) over a wider date range -- a companion to the exact-date function, never a second availability engine.';
