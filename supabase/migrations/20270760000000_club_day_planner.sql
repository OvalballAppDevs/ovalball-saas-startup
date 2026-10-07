-- =====================================================================================================================
-- THE CLUB-DAY PLANNER (mobile Season Planner)
--
-- A mass-scheduling ASSISTANT over the canonical fixture-request domain -- not a second fixture system. Everything it
-- creates is an ordinary `fixture_request_groups` + `fixture_requests` row, so the existing triggers still decide:
-- age/identity eligibility (`fixture_requests_age_eligibility`), duplicate pending requests
-- (`fixture_requests_not_duplicate`), and who is notified (`fixture_requests_notify_recipients`). Acceptance still
-- creates the fixture through `accept_fixture_request`, and the one-match-per-team-per-day rule is still the
-- fixtures trigger's.
--
-- Authority is the existing bulk-planning check, `internal.can_bulk_plan_fixtures(club)` -- `fixture.planner.use`
-- at CLUB scope (Club Admin, Fixture Secretary) or Ovalball fixture support. It has no team bundle, so team staff
-- never reach mass scheduling (the standing rule), however these are called.
--
-- What is new:
--   * `internal.planner_team_commitments` -- one answer to "what is this team already doing on these dates", that
--     sees BOTH sides of a fixture (the existing availability readers only look at the owning team, so the
--     opposing team of an accepted request looked free), both directions of open requests, and competition matches.
--   * `public.planner_club_day` -- the read model for one opponent + one date: my club's teams, the opponent's
--     compatible sides (canonical eligibility, never names), what each of my teams already has that day and that
--     week, and what has already been arranged with this opponent this season.
--   * `public.planner_send_club_day` -- sends a club day as one request group, re-checking every conflict at SEND
--     time under a per-club lock, inserting each team in its own savepoint and returning a per-team outcome, so a
--     failure on one team never hides behind "all sent". Idempotent by a client batch id: a replay returns what the
--     first call created instead of creating it twice.
--   * `public.planner_season_board` -- every commitment of the club's teams across one season, for the live board.
--   * `fixture_request_groups.planner_batch_id` + source 'season_planner' -- the club day's memory: replay safety and
--     a way to recognise a planned club day without a new business entity.
-- =====================================================================================================================

alter table public.fixture_request_groups add column if not exists planner_batch_id uuid;
create unique index if not exists fixture_request_groups_planner_batch_idx
  on public.fixture_request_groups (planner_batch_id) where planner_batch_id is not null;

alter table public.fixture_request_groups drop constraint if exists fixture_request_groups_source_check;
alter table public.fixture_request_groups add constraint fixture_request_groups_source_check
  check (source = any (array['ovie_assistant'::text, 'season_planner'::text]));

-- ---------------------------------------------------------------------------------------------------------------------
-- What a set of teams is already committed to between two dates. Internal: callers gate first.
--   kind: fixture | competition | request_out | request_in
--   status: the canonical status of the underlying record (fixture status, competition status, request status)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.planner_team_commitments(p_team_ids uuid[], p_from date, p_to date)
 returns table(team_id uuid, the_date date, kind text, status text, ref_id uuid, group_id uuid,
               opponent_label text, opponent_club_id uuid, home_away text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  -- FIXTURES, from either side, Mini-Rugby group members included.
  select t.id, f.kickoff_date, 'fixture', f.status, f.id, null::uuid,
         case when f.owning_team_id = t.id or t.id = any(internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id))
              then coalesce(nullif(trim(coalesce(od.name, '') || ' ' || coalesce(ot.display_name, '')), ''), f.raw_opposition_text)
              else trim(coalesce(owd.name, '') || ' ' || coalesce(own.display_name, '')) end,
         case when f.owning_team_id = t.id or t.id = any(internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id))
              then coalesce(ot.club_id, odc.id)
              else own.club_id end,
         case when f.owning_team_id = t.id or t.id = any(internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id))
              then f.home_away
              else case f.home_away when 'Home' then 'Away' when 'Away' then 'Home' else f.home_away end end
    from unnest(p_team_ids) as t(id)
    join public.fixtures f
      on f.kickoff_date between p_from and p_to
     and f.status <> 'Cancelled' and f.archived_at is null
     and (t.id = any(internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id))
          or (f.opponent_team_id is not null
              and t.id = any(internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id))))
    join public.teams own on own.id = f.owning_team_id
    left join public.clubs owc on owc.id = own.club_id
    left join public.club_directory owd on owd.id = owc.directory_id
    left join public.teams ot on ot.id = f.opponent_team_id
    left join public.clubs otc on otc.id = ot.club_id
    left join public.club_directory od on od.id = coalesce(otc.directory_id, f.opponent_directory_id)
    left join public.clubs odc on odc.directory_id = f.opponent_directory_id and odc.status = 'active'
  union all
  -- COMPETITION MATCHES that have no projected fixture (a projected one is already counted above).
  select cp.team_id, m.match_date, 'competition', m.status, m.id, null::uuid,
         coalesce(trim(coalesce(oppd.name, '') || ' ' || coalesce(oppt.display_name, '')), 'Competition match'),
         opp.club_id,
         case when m.home_participant_id = cp.id then 'Home' else 'Away' end
    from public.competition_matches m
    join public.competition_participants cp on cp.id in (m.home_participant_id, m.away_participant_id)
    left join public.competition_participants opp
      on opp.id = case when m.home_participant_id = cp.id then m.away_participant_id else m.home_participant_id end
    left join public.teams oppt on oppt.id = opp.team_id
    left join public.club_directory oppd on oppd.id = opp.club_directory_id
   where cp.team_id = any(p_team_ids)
     and m.match_date between p_from and p_to
     and m.status not in ('cancelled', 'draft', 'postponed')
     and not exists (select 1 from public.competition_match_fixtures cmf where cmf.match_id = m.id)
  union all
  -- REQUESTS I SENT (open, or declined so the board can say so). The date is the live proposal.
  select r.requesting_team_id, coalesce(r.countered_date, g.proposed_date),
         'request_out', r.status, r.id, g.id,
         trim(coalesce(g.raw_opponent_text, '') || coalesce(' ' || tt.display_name, '')),
         g.opponent_club_id,
         case coalesce(r.countered_venue_preference, r.venue_preference) when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end
    from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    left join public.teams tt on tt.id = r.target_team_id
   where r.requesting_team_id = any(p_team_ids)
     and r.status in ('sent', 'counter_proposed', 'declined')
     and coalesce(r.countered_date, g.proposed_date) between p_from and p_to
  union all
  -- REQUESTS SENT TO ME (open only). Venue preference is the requester's, so it is inverted for me.
  select r.target_team_id, coalesce(r.countered_date, g.proposed_date),
         'request_in', r.status, r.id, g.id,
         trim(coalesce(rd.name, '') || ' ' || coalesce(rt.display_name, '')),
         g.requesting_club_id,
         case coalesce(r.countered_venue_preference, r.venue_preference) when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end
    from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    join public.teams rt on rt.id = r.requesting_team_id
    left join public.clubs rc on rc.id = g.requesting_club_id
    left join public.club_directory rd on rd.id = rc.directory_id
   where r.target_team_id = any(p_team_ids)
     and r.status in ('sent', 'counter_proposed')
     and coalesce(r.countered_date, g.proposed_date) between p_from and p_to;
$function$;

revoke all on function internal.planner_team_commitments(uuid[], date, date) from public, anon, authenticated;

-- The club's own schedulable teams: active, not folded, not archived.
create or replace function internal.planner_club_teams(p_club_id uuid)
 returns table(id uuid, display_name text, rugby_code text, category text, age_group text, gender text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select t.id, t.display_name, t.rugby_code, t.category, t.age_group, t.gender
    from public.teams t
   where t.club_id = p_club_id and t.active and t.folded_at is null and t.archived_at is null;
$function$;

revoke all on function internal.planner_club_teams(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- ONE OPPONENT, ONE DATE: who could play whom, and what is already in the way.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_club_day(p_club_id uuid, p_opponent_club_id uuid, p_date date)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_code text;
  v_opp_code text;
  v_season uuid;
  v_season_row public.seasons;
  v_week_from date := p_date - ((extract(isodow from p_date)::int) - 1);
  v_week_to date;
  v_team_ids uuid[];
  v_teams jsonb;
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  v_week_to := v_week_from + 6;

  select d.rugby_code into v_code from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = p_club_id;
  select d.rugby_code into v_opp_code from public.clubs c join public.club_directory d on d.id = c.directory_id
   where c.id = p_opponent_club_id and c.status = 'active';
  if v_opp_code is null then
    raise exception 'That club is not on Ovalball, so its teams cannot be matched or asked.' using errcode = 'P0002';
  end if;
  if v_opp_code is distinct from v_code then
    raise exception 'That club plays a different rugby code.' using errcode = '22023';
  end if;
  if p_opponent_club_id = p_club_id then
    raise exception 'Choose another club to play.' using errcode = '22023';
  end if;

  v_season := internal.resolve_season_for_date(v_code, p_date);
  if v_season is not null then
    select * into v_season_row from public.seasons where id = v_season;
  end if;

  select array_agg(id) into v_team_ids from internal.planner_club_teams(p_club_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id', t.id,
           'display_name', t.display_name,
           'category', t.category,
           'age_group', t.age_group,
           'gender', t.gender,
           'compatible', coalesce((
             select jsonb_agg(jsonb_build_object('team_id', o.id, 'display_name', o.display_name) order by o.display_name)
               from public.teams o
              where o.club_id = p_opponent_club_id and o.active and o.folded_at is null and o.archived_at is null
                and internal.teams_can_play_fixture(t.id, o.id)), '[]'::jsonb),
           'week', coalesce((
             select jsonb_agg(jsonb_build_object('date', c.the_date, 'kind', c.kind, 'status', c.status, 'ref_id', c.ref_id,
                                                 'group_id', c.group_id, 'opponent', c.opponent_label,
                                                 'opponent_club_id', c.opponent_club_id, 'home_away', c.home_away)
                              order by c.the_date)
               from internal.planner_team_commitments(array[t.id], v_week_from, v_week_to) c
              where not (c.kind = 'request_out' and c.status = 'declined')), '[]'::jsonb),
           'with_opponent', coalesce((
             select jsonb_agg(jsonb_build_object('date', c.the_date, 'kind', c.kind, 'status', c.status, 'ref_id', c.ref_id,
                                                 'group_id', c.group_id, 'home_away', c.home_away) order by c.the_date)
               from internal.planner_team_commitments(array[t.id],
                      coalesce(v_season_row.pre_season_starts_on, v_season_row.starts_on, p_date),
                      coalesce(v_season_row.ends_on, p_date)) c
              where c.opponent_club_id = p_opponent_club_id
                and not (c.kind = 'request_out' and c.status = 'declined')), '[]'::jsonb)
         ) order by t.category, t.age_group nulls last, t.display_name), '[]'::jsonb)
    into v_teams
    from internal.planner_club_teams(p_club_id) t;

  return jsonb_build_object(
    'date', p_date,
    'week_from', v_week_from,
    'week_to', v_week_to,
    'season', case when v_season is null then null else jsonb_build_object(
      'id', v_season_row.id, 'name', v_season_row.name,
      'starts_on', coalesce(v_season_row.pre_season_starts_on, v_season_row.starts_on), 'ends_on', v_season_row.ends_on) end,
    'teams', v_teams);
end;
$function$;

revoke all on function public.planner_club_day(uuid, uuid, date) from public, anon;
grant execute on function public.planner_club_day(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- SEND A CLUB DAY. p_items: [{ "requesting_team_id", "target_team_id", "venue_preference": "home"|"away",
--                             "acknowledge_pending": bool }]
-- Returns { group_id, replay, results: [{ requesting_team_id, target_team_id, outcome, request_id, reason }] }
--   outcome: sent | blocked | needs_acknowledgement | failed
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_send_club_day(p_club_id uuid, p_opponent_club_id uuid, p_date date,
                                                        p_batch_id uuid, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_opp_code text;
  v_opp_dir uuid;
  v_opp_name text;
  v_group uuid;
  v_existing public.fixture_request_groups;
  v_item jsonb;
  v_req_team uuid;
  v_target uuid;
  v_venue text;
  v_ack boolean;
  v_clash record;
  v_request uuid;
  v_results jsonb := '[]'::jsonb;
  v_sent int := 0;
  v_reason text;
  v_outcome text;
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'A planner batch id is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one team.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'A club day can hold at most 40 teams.' using errcode = '22023';
  end if;

  -- ONE PLANNER AT A TIME PER CLUB: two administrators sending at once are serialised, so the second sees the
  -- first one's requests when it re-checks.
  perform pg_advisory_xact_lock(hashtextextended('planner:' || p_club_id::text, 0));

  -- REPLAY: the same batch already went through -- return what it created rather than creating it again.
  select * into v_existing from public.fixture_request_groups where planner_batch_id = p_batch_id;
  if found then
    if v_existing.requesting_club_id is distinct from p_club_id then
      raise exception 'That batch belongs to another club.' using errcode = '42501';
    end if;
    return jsonb_build_object('group_id', v_existing.id, 'replay', true, 'results', coalesce((
      select jsonb_agg(jsonb_build_object('requesting_team_id', r.requesting_team_id, 'target_team_id', r.target_team_id,
                                          'outcome', 'sent', 'request_id', r.id, 'reason', null))
        from public.fixture_requests r where r.group_id = v_existing.id), '[]'::jsonb));
  end if;

  select d.rugby_code into v_code from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = p_club_id;
  select d.rugby_code, d.id, d.name into v_opp_code, v_opp_dir, v_opp_name
    from public.clubs c join public.club_directory d on d.id = c.directory_id
   where c.id = p_opponent_club_id and c.status = 'active';
  if v_opp_code is null then
    raise exception 'That club is not on Ovalball, so there is nobody to send a request to.' using errcode = 'P0002';
  end if;
  if v_opp_code is distinct from v_code or p_opponent_club_id = p_club_id then
    raise exception 'That club cannot be asked for these fixtures.' using errcode = '22023';
  end if;
  if internal.resolve_season_for_date(v_code, p_date) is null then
    raise exception 'That date is not inside an Ovalball season.' using errcode = '22023';
  end if;
  if p_date < current_date then
    raise exception 'That date has already passed.' using errcode = '22023';
  end if;

  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id,
                                             proposed_date, game_type, source, planner_batch_id, created_by)
  values (p_club_id, v_opp_name, v_opp_dir, p_opponent_club_id, p_date, 'Friendly', 'season_planner', p_batch_id, v_uid)
  returning id into v_group;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_req_team := nullif(v_item->>'requesting_team_id', '')::uuid;
    v_target := nullif(v_item->>'target_team_id', '')::uuid;
    v_venue := v_item->>'venue_preference';
    v_ack := coalesce((v_item->>'acknowledge_pending')::boolean, false);
    v_request := null; v_reason := null; v_outcome := null;

    if v_venue is null or v_venue not in ('home', 'away') then
      v_outcome := 'failed'; v_reason := 'Choose Home or Away.';
    elsif not exists (select 1 from internal.planner_club_teams(p_club_id) t where t.id = v_req_team) then
      v_outcome := 'failed'; v_reason := 'That team is not one of this club''s active teams.';
    elsif v_target is null or not exists (
            select 1 from public.teams o where o.id = v_target and o.club_id = p_opponent_club_id
               and o.active and o.folded_at is null and o.archived_at is null) then
      v_outcome := 'failed'; v_reason := 'The other club no longer has that team.';
    elsif not internal.teams_can_play_fixture(v_req_team, v_target) then
      v_outcome := 'failed'; v_reason := 'Those two teams cannot play each other.';
    else
      -- RE-CHECKED NOW, not trusted from the screen.
      select * into v_clash from internal.planner_team_commitments(array[v_req_team], p_date, p_date) c
       where not (c.kind = 'request_out' and c.status = 'declined')
       order by case c.kind when 'fixture' then 0 when 'competition' then 1 when 'request_in' then 2 else 3 end
       limit 1;
      if found and v_clash.kind = 'fixture' then
        v_outcome := 'blocked'; v_reason := 'Already playing ' || coalesce(v_clash.opponent_label, 'another fixture') || ' that day.';
      elsif found and v_clash.kind = 'competition' then
        v_outcome := 'blocked'; v_reason := 'Has a competition match that day.';
      elsif found and v_clash.opponent_club_id = p_opponent_club_id then
        v_outcome := 'blocked'; v_reason := case v_clash.kind when 'request_in' then 'They have already asked you for this day -- reply to their request.'
                                              else 'A request to them for this day is already open.' end;
      elsif found and not v_ack then
        v_outcome := 'needs_acknowledgement';
        v_reason := 'Already has a pending request with ' || coalesce(v_clash.opponent_label, 'another club') || ' that day.';
      else
        begin
          insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
          values (v_group, v_req_team, v_target, v_venue, 'sent', v_uid)
          returning id into v_request;
          v_outcome := 'sent'; v_sent := v_sent + 1;
        exception when others then
          v_outcome := 'failed';
          v_reason := case sqlstate when '23505' then 'A request between these two teams for this day is already open.'
                                    when '23514' then sqlerrm
                                    else 'This request could not be created.' end;
        end;
      end if;
    end if;

    v_results := v_results || jsonb_build_object('requesting_team_id', v_req_team, 'target_team_id', v_target,
                                                 'outcome', v_outcome, 'request_id', v_request, 'reason', v_reason);
  end loop;

  -- Nothing went: no empty group is left behind (and a retry with the same batch id evaluates afresh).
  if v_sent = 0 then
    delete from public.fixture_request_groups where id = v_group;
    v_group := null;
  end if;

  return jsonb_build_object('group_id', v_group, 'replay', false, 'results', v_results);
end;
$function$;

revoke all on function public.planner_send_club_day(uuid, uuid, date, uuid, jsonb) from public, anon;
grant execute on function public.planner_send_club_day(uuid, uuid, date, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE LIVE SEASON BOARD: every commitment of the club's teams in one season.
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.planner_season_board(uuid, uuid);
create or replace function public.planner_season_board(p_club_id uuid, p_season_id uuid)
 returns table(team_id uuid, team_name text, the_date date, kind text, status text, ref_id uuid, group_id uuid,
               opponent_label text, opponent_club_id uuid, opponent_club_name text, home_away text, planned boolean)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_code text;
  v_season public.seasons;
  v_team_ids uuid[];
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  select d.rugby_code into v_code from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = p_club_id;
  select * into v_season from public.seasons s where s.id = p_season_id and s.rugby_code = v_code;
  if not found then
    raise exception 'That season is not one of this club''s seasons.' using errcode = '22023';
  end if;
  select array_agg(t.id) into v_team_ids from internal.planner_club_teams(p_club_id) t;
  if v_team_ids is null then
    return;
  end if;
  -- A fixture that came from a request keeps that request's group, so a planned club day can still be read as one
  -- day ("2 confirmed, 1 declined") after some of it has become fixtures.
  return query
    with c as (
      select c.*, coalesce(c.group_id, (select r.group_id from public.fixture_requests r
                                         where c.kind = 'fixture' and r.resulting_fixture_id = c.ref_id limit 1)) as day_group
        from internal.planner_team_commitments(v_team_ids, coalesce(v_season.pre_season_starts_on, v_season.starts_on), v_season.ends_on) c
    )
    select c.team_id, t.display_name, c.the_date, c.kind, c.status, c.ref_id, c.day_group,
           c.opponent_label, c.opponent_club_id,
           (select d.name from public.clubs oc join public.club_directory d on d.id = oc.directory_id where oc.id = c.opponent_club_id),
           c.home_away,
           exists (select 1 from public.fixture_request_groups g where g.id = c.day_group and g.source = 'season_planner')
      from c
      join public.teams t on t.id = c.team_id
     order by c.the_date, t.display_name;
end;
$function$;

revoke all on function public.planner_season_board(uuid, uuid) from public, anon;
grant execute on function public.planner_season_board(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- A REQUEST TO A TEAM WITH NO STAFF STILL REACHES SOMEBODY. Unchanged except the fallback marked inside: the named
-- team's staff are told as before; when it has none, its club's Club Admin and Fixture Secretary are told instead.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.notify_fixture_request_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group public.fixture_request_groups;
  v_requesting_club_name text;
  v_target_club_name text;
  v_notify_team_id uuid;
  v_proposer_club_name text;
begin
  if tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'declined' then
    select * into v_group from public.fixture_request_groups where id = new.group_id;
    select cd.name into v_target_club_name
    from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory cd on cd.id = c.directory_id
    where t.id = new.target_team_id;

    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_declined', 'Fixture request declined',
      format('%s declined your fixture request for %s.', coalesce(v_target_club_name, 'The opponent'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.requesting_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
    union
    select cm.user_id, 'fixture_request_declined', 'Fixture request declined',
      format('%s declined your fixture request for %s.', coalesce(v_target_club_name, 'The opponent'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.club_memberships cm
    where cm.club_id = v_group.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

    return new;
  end if;

  -- CA-M11.5: a genuine new counter is an UPDATE landing on status='counter_proposed' whose countered_at
  -- just changed -- fires once per round, including a second or third, never on an unrelated column update.
  if tg_op = 'UPDATE' and new.status = 'counter_proposed' and old.countered_at is distinct from new.countered_at then
    select * into v_group from public.fixture_request_groups where id = new.group_id;
    -- Notify whichever side did NOT just make this counter -- the one whose turn it now is.
    v_notify_team_id := case when new.last_proposed_by_team_id = new.requesting_team_id then new.target_team_id else new.requesting_team_id end;
    select cd.name into v_proposer_club_name
    from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory cd on cd.id = c.directory_id
    where t.id = new.last_proposed_by_team_id;

    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_countered', 'Alternative date proposed',
      format('%s suggested %s at %s for your fixture request.', coalesce(v_proposer_club_name, 'The other club'),
             coalesce(to_char(new.countered_date, 'DD Mon YYYY'), 'another date'), coalesce(to_char(new.countered_kickoff_time, 'HH24:MI'), 'a time to confirm')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_notify_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH');

    return new;
  end if;

  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then
    return new;
  end if;

  select * into v_group from public.fixture_request_groups where id = new.group_id;
  select cd.name into v_requesting_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = v_group.requesting_club_id;

  if new.target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.target_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH');
    -- A NAMED TEAM WITH NOBODY ON IT is asked through its club: when the team has no active staff, the opposing
    -- club's fixture administrators (who hold fixture.request.respond at club scope) are told instead. Without
    -- this a request to an unstaffed team notified nobody at all (20270760000000).
    if not found then
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'fixture_request_received', 'New fixture request',
        format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
        jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
      from public.teams tt
      join public.club_memberships cm on cm.club_id = tt.club_id
      where tt.id = new.target_team_id
        and cm.status = 'active'
        and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
    end if;
  elsif v_group.opponent_club_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.club_memberships cm
    where cm.club_id = v_group.opponent_club_id
      and cm.status = 'active'
      and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return new;
end;
$function$;
