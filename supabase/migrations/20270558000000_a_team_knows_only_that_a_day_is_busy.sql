-- CLUBHOUSE PROGRAMME SECTION 7 -- AVAILABILITY DISCOVERY.
--
-- FORENSIC FINDING, NOT ASSUMED: `team_scheduling_availability` (CA-M11.4, already shipped and in live
-- use by app/(app)/fixtures/new/availability-panel.tsx and apps/mobile/src/fixture-requests/
-- availability-calendar.tsx) authorises the CALLER's own side correctly (`internal.can_manage_team` /
-- `internal.can_manage_club_fixtures`, already team-scope-friendly -- no gap there), but has NO
-- relationship check between the viewer and `p_target_team_id` whatsoever. Any legitimate team manager
-- could call it directly with an arbitrary team id copied from anywhere and read that team's FULL
-- fixture/training/club_event/pending-request status -- not coarsened to "Busy", the literal category --
-- for a team they have no partnership, no compatibility, no relationship with at all. This is corrected
-- here, in the same migration that gives Clubhouse's own batched candidate search its real read model,
-- because both are the same underlying privacy question Section 7 exists to answer properly.
--
-- THE FIX, PRECISELY SCOPED:
--   1. p_target_team_id = p_viewer_team_id (a team's own calendar) is COMPLETELY UNCHANGED -- same
--      specific categories, same behaviour the existing composer panels already rely on.
--   2. p_target_team_id <> p_viewer_team_id now requires BOTH: the two teams are canonically compatible
--      opposition (internal.identities_can_play_fixture -- never trusting a client's own pre-filtered
--      picker) AND the viewer's club holds an ACTIVE partnership with the target's club. This is the
--      SAME "partners only, not all compatible clubs" boundary get_partner_team_availability already
--      established -- Section 7 does not silently broaden it because Find a Fixture would be nicer.
--   3. For that non-own case, every specific category (fixture/training/club_event) is coarsened to a
--      single 'busy' value -- the opposition never learns WHICH kind of commitment blocks a date, only
--      that it does. 'request_pending' remains distinct (a real, useful, non-alarming product
--      distinction: a tentative hold reads differently from a firm commitment).
--
-- THE MOST IMPORTANT FIX, FOUND WRITING THIS MIGRATION'S OWN PERMANENT TEST: the pre-existing query
-- fell through to `'available'` for EVERY unblocked date, on EVERY team, including the opponent side --
-- and the shared TypeScript contract's own `partnerLabel()` (packages/contracts/src/fixtures/
-- availability.ts, plus its two client-local duplicates) then rendered that literally as the word
-- "Available" for a PARTNER CLUB'S day. This is the exact "EMPTY CALENDAR != AVAILABLE" violation
-- Section 7 exists to close, already shipped and live before this migration. Fixed by returning a new,
-- honest `'no_known_clash'` value for that case instead -- `'available'` is now returned ONLY when
-- `p_target_team_id = p_viewer_team_id` (a team truthfully describing its own calendar); no other case
-- may ever claim it.
--
-- TWO SMALL CORRECTNESS FIXES MADE IN THE SAME PASS, BOTH FOUND AUDITING THIS EXACT FUNCTION:
--   - Competition matches were never included as a blocking source at all. A club's own canonical
--     architecture note (Competition Match is the competition's canonical schedule; Fixture is only the
--     club's own operational projection) already warns a competition commitment can exist before its
--     Fixture projection does (`internal.project_competition_match` deliberately returns early while a
--     match's verification is still `awaiting`) -- confirmed live this section against the real
--     `internal.project_competition_match`/`internal.issue_competition_matches` flow. Added as a
--     blocking source for both the viewer's own side and, coarsened, the opponent's.
--   - The training_sessions filter read `occurrence_date`, which is only ever populated for a
--     schedule-rule-generated recurring session -- every MANUALLY created session in the live local
--     database (source = 'MANUAL') has `occurrence_date` null and was silently invisible to this
--     function. `session_date` is the column every row actually carries. Corrected in the same touched
--     query block; the underlying training_sessions row shape is unchanged.
create or replace function public.team_scheduling_availability(p_viewer_team_id uuid, p_target_team_id uuid, p_from date, p_to date)
returns table(the_date date, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_viewer_club_id uuid;
  v_target_club_id uuid;
  v_own boolean;
begin
  select club_id into v_viewer_club_id from public.teams where id = p_viewer_team_id;
  if v_viewer_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not (
    internal.has_site_capability('site.fixtures.support')
    or internal.can_manage_team(p_viewer_team_id)
    or internal.can_manage_club_fixtures(v_viewer_club_id)
  ) then
    raise exception 'Not authorized to view scheduling availability for this team.' using errcode = '42501';
  end if;
  if p_target_team_id is null then
    raise exception 'Target team is required.';
  end if;
  if p_to < p_from then
    raise exception 'Date range is invalid.';
  end if;
  if p_to > p_from + 90 then
    raise exception 'Date range must be 90 days or fewer.';
  end if;

  v_own := p_target_team_id = p_viewer_team_id;

  if not v_own then
    select t.club_id into v_target_club_id from public.teams t where t.id = p_target_team_id;
    if v_target_club_id is null then
      raise exception 'Team not found.';
    end if;
    if not exists (
      select 1 from public.teams me, public.teams o
      where me.id = p_viewer_team_id and o.id = p_target_team_id
        and internal.identities_can_play_fixture(me.rugby_code, me.category, me.age_group, me.gender, o.rugby_code, o.category, o.age_group, o.gender)
    ) then
      raise exception 'These teams are not compatible opposition.' using errcode = '42501';
    end if;
    if not (
      internal.has_site_capability('site.fixtures.support')
      or exists (
        select 1 from public.club_partnerships cp
        where cp.status = 'active'
          and ((cp.requesting_club_id = v_viewer_club_id and cp.partner_club_id = v_target_club_id)
            or (cp.partner_club_id = v_viewer_club_id and cp.requesting_club_id = v_target_club_id))
      )
    ) then
      raise exception 'No active calendar-sharing agreement with this club.' using errcode = '42501';
    end if;
  end if;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  fixture_days as (
    select distinct kickoff_date as d
    from public.fixtures f
    where f.owning_team_id = p_target_team_id
      and f.status <> 'Cancelled'
      and f.kickoff_date between p_from and p_to
  ),
  competition_days as (
    select distinct cm.match_date as d
    from public.competition_matches cm
    join public.competition_participants hp on hp.id = cm.home_participant_id
    join public.competition_participants ap on ap.id = cm.away_participant_id
    where (hp.team_id = p_target_team_id or ap.team_id = p_target_team_id)
      and cm.status not in ('cancelled', 'draft', 'postponed')
      and cm.match_date between p_from and p_to
      -- Not double-counted once a Fixture has actually been projected for it -- that case is already
      -- covered by fixture_days above, from the same source of truth sync_competition_match_fixtures
      -- keeps in step with the match itself.
      and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = cm.id)
  ),
  training_days as (
    select distinct session_date as d
    from public.training_sessions ts
    where ts.team_id = p_target_team_id
      and ts.status <> 'CANCELLED'
      and ts.session_date between p_from and p_to
  ),
  club_event_days as (
    select distinct e.starts_on as d
    from public.club_events e
    join public.teams t on t.club_id = e.club_id and t.id = p_target_team_id
    where e.starts_on between p_from and p_to
      and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = p_target_team_id))
  ),
  pending_days as (
    select distinct coalesce(r.countered_date, g.proposed_date) as d
    from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    where (r.requesting_team_id = p_target_team_id or r.target_team_id = p_target_team_id)
      and r.status in ('sent', 'counter_proposed')
      and coalesce(r.countered_date, g.proposed_date) between p_from and p_to
  )
  select
    d.d,
    case
      when v_own and exists (select 1 from fixture_days x where x.d = d.d) then 'fixture'
      when v_own and exists (select 1 from competition_days x where x.d = d.d) then 'fixture'
      when v_own and exists (select 1 from pending_days x where x.d = d.d) then 'request_pending'
      when v_own and exists (select 1 from club_event_days x where x.d = d.d) then 'club_event'
      when v_own and exists (select 1 from training_days x where x.d = d.d) then 'training'
      when not v_own and (
        exists (select 1 from fixture_days x where x.d = d.d)
        or exists (select 1 from competition_days x where x.d = d.d)
        or exists (select 1 from club_event_days x where x.d = d.d)
        or exists (select 1 from training_days x where x.d = d.d)
      ) then 'busy'
      when not v_own and exists (select 1 from pending_days x where x.d = d.d) then 'request_pending'
      -- CLUBHOUSE PROGRAMME SECTION 7'S OWN CENTRAL FIX: found live, testing this exact function --
      -- the pre-existing query fell through to 'available' for EVERY team on EVERY unblocked date,
      -- including the OPPONENT side, which the shared TypeScript contract's own partnerLabel() then
      -- rendered as the word "Available". An absence of a known clash is not a declaration of
      -- availability; only a team's own calendar may truthfully say 'available' about itself.
      when v_own then 'available'
      else 'no_known_clash'
    end
  from days d
  order by d.d;
end;
$function$;

-- ============================================================================================
-- THE BATCHED CANDIDATE SEARCH -- "which of our compatible partner clubs have a viable date?"
-- ============================================================================================
--
-- Exactly one round trip for many candidate teams across up to 6 dates -- never candidate x date x
-- RPC. Reuses the SAME two predicates Section 6/this migration already established rather than a third
-- copy: internal.identities_can_play_fixture (compatibility) and an active club_partnerships row
-- (the same "partners only" boundary team_scheduling_availability now enforces above). A compatible
-- but NON-partner club is simply never returned by this function at all -- the caller (the shared
-- TypeScript contract) already knows from Section 6's own marker/partnership read model which
-- candidates are partners and shows UNKNOWN for the rest without needing this function to say so.
--
-- MINIMAL ROWS ONLY: only a date genuinely blocked (busy or tentative) is returned, exactly the
-- existing idiom get_partner_team_availability/team_scheduling_availability already use -- a date not
-- present in the result, within the requested set, is NO KNOWN CLASH, never fabricated as a row.
create or replace function public.find_fixture_candidate_availability(p_team_id uuid, p_dates date[])
returns table(opponent_team_id uuid, the_date date, status text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_club uuid;
  v_date_count integer;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.';
  end if;

  if not (internal.can('fixture.request.create', 'team', v_club, p_team_id, null)
       or internal.can('fixture.fixture.create', 'team', v_club, p_team_id, null)) then
    raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
  end if;

  v_date_count := coalesce(array_length(p_dates, 1), 0);
  if v_date_count < 1 or v_date_count > 6 then
    raise exception 'Select between 1 and 6 dates.';
  end if;

  return query
  with me as (
    select * from public.teams where id = p_team_id
  ),
  candidates as (
    select o.id as team_id, o.club_id
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
    select f.owning_team_id as team_id, f.kickoff_date as d, 'busy'::text as status
    from public.fixtures f
    join candidates c on c.team_id = f.owning_team_id
    where f.status <> 'Cancelled' and f.kickoff_date = any (p_dates)
  ),
  competition_hits as (
    select c.team_id, cm.match_date as d, 'busy'::text
    from public.competition_matches cm
    join public.competition_participants hp on hp.id = cm.home_participant_id
    join public.competition_participants ap on ap.id = cm.away_participant_id
    join candidates c on c.team_id = hp.team_id or c.team_id = ap.team_id
    where cm.status not in ('cancelled', 'draft', 'postponed')
      and cm.match_date = any (p_dates)
      and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = cm.id)
  ),
  training_hits as (
    select ts.team_id, ts.session_date as d, 'busy'::text
    from public.training_sessions ts
    join candidates c on c.team_id = ts.team_id
    where ts.status <> 'CANCELLED' and ts.session_date = any (p_dates)
  ),
  club_event_hits as (
    select c.team_id, e.starts_on as d, 'busy'::text
    from public.club_events e
    join candidates c on c.club_id = e.club_id
    where e.starts_on = any (p_dates)
      and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = c.team_id))
  ),
  pending_hits as (
    select c.team_id, coalesce(r.countered_date, g.proposed_date) as d, 'request_pending'::text
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
  select team_id, d, case when bool_or(all_hits.status = 'busy') then 'busy' else 'request_pending' end
  from all_hits
  group by team_id, d;
end;
$$;

revoke execute on function public.find_fixture_candidate_availability(uuid, date[]) from public;
grant execute on function public.find_fixture_candidate_availability(uuid, date[]) to authenticated;

comment on function public.find_fixture_candidate_availability(uuid, date[]) is
  'Clubhouse Programme Section 7: batched, privacy-safe date-availability search across every compatible PARTNER club for one team, up to 6 dates, in one round trip. Never returns a non-partner club (Section 6''s own read model already knows which candidates are partners). Coarse busy/request_pending rows only, minimal columns (opponent_team_id, the_date, status) -- no event detail, no roster, no calendar content.';
