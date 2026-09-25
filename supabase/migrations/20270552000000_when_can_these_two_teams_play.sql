-- CA-M11.4 -- FIXTURE REQUEST SHARED SCHEDULING CALENDAR (Section 13-20 of the owner's brief).
--
-- The confirmed gap, after a full audit of the fixture-request domain (docs/mobile/CA_M11_4_FIXTURE_
-- REQUEST_PARTNER_CALENDAR_MAP.md): request creation, accept/decline/withdraw, partner clubs, external
-- opposition, notifications, Action Centre and capability gating are all already built, on both
-- clients, to a high standard. What is genuinely missing is a way to see WHEN two teams can realistically
-- play, while composing a request -- today the date is a bare field with no scheduling context.
--
-- PRIVACY IS THE WHOLE POINT (Section 15). "Available" for an opponent team is never "no Fixture row" --
-- it is a coarse, deliberately lossy STATUS, computed server-side, that never leaks which specific match,
-- who the opponent was, training content, attendance, or any club-internal detail. The caller receives
-- exactly one of: fixture / request_pending / training / available -- nothing else, for ANY team, not
-- just ones they manage, which is the entire reason this needs to be its own SECURITY DEFINER function
-- rather than a client query over fixtures/training_sessions (whose RLS is correctly club-scoped and
-- would refuse a cross-club read outright).
--
-- AUTHORITY IS TIED TO THE ACTUAL ACTION, NOT A BLANKET "ANY SIGNED-IN PERSON MAY BROWSE AVAILABILITY".
-- The caller must be authorised to raise a fixture request FROM p_viewer_team_id -- the exact same
-- can_manage_team/can_manage_club_fixtures check fixture_requests_insert_scoped already uses. This
-- means the SAME function, called once with the viewer's own team as the target and once with the
-- prospective opponent's team as the target, gives a symmetric compare view: your own side always
-- passes (you may see your own availability while legitimately composing a request), and the partner
-- side is exposed only to someone who could legitimately ask them for a match in the first place --
-- never to a parent, a player, or staff of an unrelated third club (Sections 58/71/72).

create or replace function public.team_scheduling_availability(p_viewer_team_id uuid, p_target_team_id uuid, p_from date, p_to date)
returns table(the_date date, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer_club_id uuid;
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
  training_days as (
    select distinct occurrence_date as d
    from public.training_sessions ts
    where ts.team_id = p_target_team_id
      and ts.status <> 'CANCELLED'
      and ts.occurrence_date is not null
      and ts.occurrence_date between p_from and p_to
  ),
  club_event_days as (
    select distinct e.starts_on as d
    from public.club_events e
    join public.teams t on t.club_id = e.club_id and t.id = p_target_team_id
    where e.starts_on between p_from and p_to
      and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = p_target_team_id))
  ),
  pending_days as (
    select distinct g.proposed_date as d
    from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    where (r.requesting_team_id = p_target_team_id or r.target_team_id = p_target_team_id)
      and r.status = 'sent'
      and g.proposed_date between p_from and p_to
  )
  select
    d.d,
    case
      when exists (select 1 from fixture_days f where f.d = d.d) then 'fixture'
      when exists (select 1 from pending_days p where p.d = d.d) then 'request_pending'
      when exists (select 1 from club_event_days c where c.d = d.d) then 'club_event'
      when exists (select 1 from training_days t where t.d = d.d) then 'training'
      else 'available'
    end
  from days d
  order by d.d;
end;
$$;

comment on function public.team_scheduling_availability(uuid, uuid, date, date) is
  'CA-M11.4 shared scheduling calendar: a coarse, privacy-safe per-day status (fixture/request_pending/club_event/training/available) for p_target_team_id, over at most 90 days. Authority is checked against p_viewer_team_id -- the same fixture-request-creation authority as fixture_requests_insert_scoped -- so this never becomes a general cross-club calendar-browsing tool. Never returns event names, opponents, or any other detail.';

grant execute on function public.team_scheduling_availability(uuid, uuid, date, date) to authenticated;
grant execute on function public.team_scheduling_availability(uuid, uuid, date, date) to service_role;
