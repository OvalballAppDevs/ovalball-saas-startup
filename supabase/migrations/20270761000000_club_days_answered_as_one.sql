-- =====================================================================================================================
-- CLUB DAYS AS ONE PROPOSAL, AND THE CLUB'S PLAYING DAYS (Season Planner, part two)
--
-- Owner decisions, 7 October 2026:
--   * A Season Planner club day is ONE club-to-club proposal. Underneath it stays canonical individual fixture
--     requests in one `fixture_request_groups` row (source 'season_planner', 20270760000000) -- the group IS the
--     club day, explicitly, never inferred from dates or names. A return club day records which day it returns.
--   * The receiving club answers it as a club: accept or decline all that is still open, or each fixture on its
--     own, with a note on a particular fixture. Each request keeps its own canonical state.
--   * ONE notification announces a planned club day to the receiving club's club-scope schedulers (people who
--     hold fixture.request.respond at CLUB scope), and ONE tells the planning club when the club answers -- not one
--     per fixture, and nothing to each team because its team was included.
--   * The playing day is canonical: a club default, a default per kind of team (senior men, senior women, colts,
--     age grade -- the teams' own category and gender), and a team's own override. A preference, never a rule:
--     any date can still be planned.
-- =====================================================================================================================

-- THE CLUB DAY'S LINKS --------------------------------------------------------------------------------------------
alter table public.fixture_request_groups add column if not exists reverse_of_group_id uuid
  references public.fixture_request_groups(id) on delete set null;
create index if not exists fixture_request_groups_reverse_of_idx on public.fixture_request_groups (reverse_of_group_id)
  where reverse_of_group_id is not null;

-- A NOTE ON ONE FIXTURE from the club answering it ("Could this kick off at 10:30?"). The requester's own note is the
-- existing `note`; a suggested date stays the canonical counter-proposal.
alter table public.fixture_requests add column if not exists response_note text;
alter table public.fixture_requests add column if not exists response_note_by uuid references auth.users(id) on delete set null;
alter table public.fixture_requests add column if not exists response_note_at timestamptz;

-- THE PLAYING DAYS. ISO weekday, 1 Monday ... 7 Sunday. Written only through set_club_playing_days /
-- set_team_playing_day: no client column grant is given for them.
alter table public.club_scheduling_policy add column if not exists default_playing_day smallint check (default_playing_day between 1 and 7);
alter table public.club_scheduling_policy add column if not exists playing_day_senior_mens smallint check (playing_day_senior_mens between 1 and 7);
alter table public.club_scheduling_policy add column if not exists playing_day_senior_womens smallint check (playing_day_senior_womens between 1 and 7);
alter table public.club_scheduling_policy add column if not exists playing_day_colts smallint check (playing_day_colts between 1 and 7);
alter table public.club_scheduling_policy add column if not exists playing_day_age_grade smallint check (playing_day_age_grade between 1 and 7);
alter table public.teams add column if not exists preferred_playing_day smallint check (preferred_playing_day between 1 and 7);

-- THE TWO GROUPED NOTIFICATIONS ------------------------------------------------------------------------------------
insert into public.notification_types (type_key, topic_key) values
  ('club_day_request_received', 'fixture_requests'),
  ('club_day_responded', 'fixture_requests')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- WHO A CLUB'S SCHEDULING NOTICE GOES TO: active members holding fixture.request.respond at CLUB scope (by the
-- capability model, not a role name). When the club has nobody with that authority, the named teams' own staff are
-- told instead -- one notice per person, never one per fixture -- so a club day never reaches nobody.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.club_day_recipients(p_club_id uuid, p_fallback_team_ids uuid[])
 returns table(user_id uuid)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  return query
    select distinct cm.user_id
      from public.club_memberships cm
     where cm.club_id = p_club_id and cm.status = 'active'
       and coalesce((internal.capability_decision(cm.user_id, 'fixture.request.respond', 'club', p_club_id, null, null, false, false)).allowed, false);
  if found then
    return;
  end if;
  return query
    select distinct cm.user_id
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
     where tp.team_id = any(coalesce(p_fallback_team_ids, '{}'::uuid[]))
       and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH');
end;
$function$;
revoke all on function internal.club_day_recipients(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- A TEAM'S PLAYING DAY: its own override, else its kind's default, else the club default, else none.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.team_playing_day(p_team_id uuid)
 returns table(playing_day smallint, source text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(t.preferred_playing_day, k.day, p.default_playing_day),
         case when t.preferred_playing_day is not null then 'team'
              when k.day is not null then 'category'
              when p.default_playing_day is not null then 'club' end
    from public.teams t
    left join public.club_scheduling_policy p on p.club_id = t.club_id
    left join lateral (
      select case
               when t.category = 'senior' and t.gender = 'womens' then p.playing_day_senior_womens
               when t.category = 'senior' then p.playing_day_senior_mens
               when t.category = 'colts' then p.playing_day_colts
               else p.playing_day_age_grade
             end as day
    ) k on true
   where t.id = p_team_id;
$function$;
revoke all on function internal.team_playing_day(uuid) from public, anon, authenticated;

-- A season's team structure, for the planner's honesty: the current season's teams are the club's teams; a later
-- season's are only final once a handover into it has been applied.
create or replace function internal.planner_season_structure(p_club_id uuid, p_season_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select case
           when s.id is null then null
           when coalesce(s.pre_season_starts_on, s.starts_on) <= current_date then 'current'
           when exists (select 1 from public.age_grade_rollovers r where r.club_id = p_club_id and r.to_season_id = s.id and r.applied_at is not null) then 'handed_over'
           else 'not_finalised'
         end
    from public.seasons s where s.id = p_season_id;
$function$;
revoke all on function internal.planner_season_structure(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE FIXTURE-REQUEST NOTIFICATION TRIGGER, unchanged except the two Season Planner branches marked inside: a planned
-- club day is announced once by planner_send_club_day, and answered once by planner_respond_club_day.
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
    -- A CLUB DAY ANSWERED FROM ITS GROUPED RESPONSE tells the planning club once, from
    -- planner_respond_club_day, rather than once per declined fixture (20270761000000).
    if v_group.source = 'season_planner' and coalesce(current_setting('ovalball.club_day_response', true), '') = 'on' then
      return new;
    end if;
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
  -- A SEASON PLANNER CLUB DAY IS ANNOUNCED ONCE, as a club day, by planner_send_club_day -- never as one
  -- "new fixture request" per team to each team's staff (20270761000000).
  if v_group.source = 'season_planner' then
    return new;
  end if;
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

-- THE CLUB DAY READ MODEL, now with each team's playing day and the season's team-structure state.
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
           -- The team's playing day, by its own override, its kind's default or the club's (20270761000000).
           'preferred_day', (select d.playing_day from internal.team_playing_day(t.id) d),
           'preferred_day_source', (select d.source from internal.team_playing_day(t.id) d),
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
      'starts_on', coalesce(v_season_row.pre_season_starts_on, v_season_row.starts_on), 'ends_on', v_season_row.ends_on,
      'structure', internal.planner_season_structure(p_club_id, v_season)) end,
    'club_default_day', (select p.default_playing_day from public.club_scheduling_policy p where p.club_id = p_club_id),
    'teams', v_teams);
end;
$function$;


-- ---------------------------------------------------------------------------------------------------------------------
-- SEND A CLUB DAY (replaces the 760 signature): the same re-checked, per-team, replay-safe send -- now with a note per
-- fixture, the club day it returns (if any), and ONE grouped notice to the receiving club.
-- p_items: [{ requesting_team_id, target_team_id, venue_preference: home|away, acknowledge_pending, note }]
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.planner_send_club_day(uuid, uuid, date, uuid, jsonb);
create or replace function public.planner_send_club_day(p_club_id uuid, p_opponent_club_id uuid, p_date date,
                                                        p_batch_id uuid, p_items jsonb, p_reverse_of uuid default null)
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
  v_my_name text;
  v_group uuid;
  v_existing public.fixture_request_groups;
  v_reverse public.fixture_request_groups;
  v_item jsonb;
  v_req_team uuid;
  v_target uuid;
  v_venue text;
  v_ack boolean;
  v_note text;
  v_clash record;
  v_request uuid;
  v_results jsonb := '[]'::jsonb;
  v_sent int := 0;
  v_targets uuid[] := '{}';
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

  perform pg_advisory_xact_lock(hashtextextended('planner:' || p_club_id::text, 0));

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

  select d.rugby_code, d.name into v_code, v_my_name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = p_club_id;
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
  if p_reverse_of is not null then
    select * into v_reverse from public.fixture_request_groups where id = p_reverse_of;
    if not found or v_reverse.requesting_club_id is distinct from p_club_id or v_reverse.opponent_club_id is distinct from p_opponent_club_id then
      raise exception 'A return club day must return one of this club''s own club days with the same club.' using errcode = '22023';
    end if;
  end if;

  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id,
                                             proposed_date, game_type, source, planner_batch_id, reverse_of_group_id, created_by)
  values (p_club_id, v_opp_name, v_opp_dir, p_opponent_club_id, p_date, 'Friendly', 'season_planner', p_batch_id, p_reverse_of, v_uid)
  returning id into v_group;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_req_team := nullif(v_item->>'requesting_team_id', '')::uuid;
    v_target := nullif(v_item->>'target_team_id', '')::uuid;
    v_venue := v_item->>'venue_preference';
    v_ack := coalesce((v_item->>'acknowledge_pending')::boolean, false);
    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
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
          insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, note, created_by)
          values (v_group, v_req_team, v_target, v_venue, 'sent', v_note, v_uid)
          returning id into v_request;
          v_outcome := 'sent'; v_sent := v_sent + 1; v_targets := v_targets || v_target;
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

  if v_sent = 0 then
    delete from public.fixture_request_groups where id = v_group;
    v_group := null;
  else
    -- ONE notice for the whole club day. No team or player is named: a club, a count and a date.
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'club_day_request_received',
           case when p_reverse_of is null then 'Club Day request' else 'Return Club Day request' end,
           format('%s sent a %sClub Day request · %s %s · %s', v_my_name, case when p_reverse_of is null then '' else 'return ' end,
                  v_sent, case when v_sent = 1 then 'fixture' else 'fixtures' end, to_char(p_date, 'Dy FMDD Mon')),
           jsonb_build_object('group_id', v_group, 'club_id', p_opponent_club_id, 'requesting_club_id', p_club_id, 'fixture_count', v_sent)
      from internal.club_day_recipients(p_opponent_club_id, v_targets) r;
  end if;

  return jsonb_build_object('group_id', v_group, 'replay', false, 'results', v_results);
end;
$function$;
revoke all on function public.planner_send_club_day(uuid, uuid, date, uuid, jsonb, uuid) from public, anon;
grant execute on function public.planner_send_club_day(uuid, uuid, date, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- WHO MAY SEE A CLUB DAY: club-scope fixture authority at either club (or Ovalball fixture support).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.club_day_side(p_group public.fixture_request_groups)
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select case
           when internal.can_bulk_plan_fixtures(p_group.requesting_club_id)
             or internal.can('fixture.request.respond', 'club', p_group.requesting_club_id, null, null)
             or internal.can('fixture.request.create', 'club', p_group.requesting_club_id, null, null) then 'sent'
           when p_group.opponent_club_id is not null
            and (internal.can_bulk_plan_fixtures(p_group.opponent_club_id)
                 or internal.can('fixture.request.respond', 'club', p_group.opponent_club_id, null, null)) then 'received'
         end;
$function$;
revoke all on function internal.club_day_side(public.fixture_request_groups) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- ONE CLUB DAY, as either club sees it: the two clubs, the date, and every fixture in it with its own canonical state.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_club_day_detail(p_group_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_group public.fixture_request_groups;
  v_side text;
begin
  perform internal.require_live_session();
  select * into v_group from public.fixture_request_groups where id = p_group_id;
  if not found or v_group.source is distinct from 'season_planner' then
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;
  v_side := internal.club_day_side(v_group);
  if v_side is null then
    -- Same answer as a missing one: a club day is never confirmed to exist for somebody it is not for.
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'group_id', v_group.id,
    'side', v_side,
    'date', v_group.proposed_date,
    'created_at', v_group.created_at,
    'reverse_of_group_id', v_group.reverse_of_group_id,
    'return_group_ids', coalesce((select jsonb_agg(g.id order by g.proposed_date) from public.fixture_request_groups g where g.reverse_of_group_id = v_group.id), '[]'::jsonb),
    'requesting_club', (select jsonb_build_object('id', c.id, 'name', d.name, 'logo_path', d.logo_storage_path)
                          from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.requesting_club_id),
    'opponent_club', (select jsonb_build_object('id', c.id, 'name', d.name, 'logo_path', d.logo_storage_path)
                        from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.opponent_club_id),
    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_id', r.id,
               'status', r.status,
               'requesting_team_id', r.requesting_team_id,
               'requesting_team', rt.display_name,
               'requesting_age_group', rt.age_group,
               'target_team_id', r.target_team_id,
               'target_team', tt.display_name,
               'venue', coalesce(r.countered_venue_preference, r.venue_preference),
               'kickoff', r.preferred_kickoff_time,
               'date', coalesce(r.countered_date, v_group.proposed_date),
               'countered', r.status = 'counter_proposed',
               'countered_by_requester', r.last_proposed_by_team_id = r.requesting_team_id,
               'note', r.note,
               'counter_note', r.counter_note,
               'response_note', r.response_note,
               'resulting_fixture_id', r.resulting_fixture_id,
               'decided_at', r.decided_at)
             order by rt.category, rt.age_group nulls last, rt.display_name)
        from public.fixture_requests r
        join public.teams rt on rt.id = r.requesting_team_id
        left join public.teams tt on tt.id = r.target_team_id
       where r.group_id = v_group.id), '[]'::jsonb));
end;
$function$;
revoke all on function public.planner_club_day_detail(uuid) from public, anon;
grant execute on function public.planner_club_day_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- ANSWER A CLUB DAY. p_action: 'accept' | 'decline'. p_request_ids: the fixtures to answer (null = every fixture still
-- waiting for this club: status 'sent'). p_notes: { "<request id>": "note" } kept on that fixture.
-- Each request is re-checked and answered through the canonical path (accept_fixture_request / the canonical
-- decline) in its own savepoint; a fixture already answered is left exactly as it is. Concurrent answers to one club
-- day are serialised on the group row, so two people pressing Accept All create each fixture once.
-- Returns { results: [{ request_id, outcome: accepted|declined|already_resolved|not_actionable|failed, reason,
-- fixture_id }], summary: { accepted, declined, pending, countered, total } }
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_respond_club_day(p_group_id uuid, p_action text, p_request_ids uuid[] default null,
                                                           p_notes jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_group public.fixture_request_groups;
  v_req public.fixture_requests;
  v_results jsonb := '[]'::jsonb;
  v_changed int := 0;
  v_fixture uuid;
  v_outcome text;
  v_reason text;
  v_note text;
  v_opp_name text;
  v_summary jsonb;
begin
  perform internal.require_live_session();
  if p_action is null or p_action not in ('accept', 'decline') then
    raise exception 'Choose accept or decline.' using errcode = '22023';
  end if;
  -- One answer at a time per club day.
  select * into v_group from public.fixture_request_groups where id = p_group_id for update;
  if not found or v_group.source is distinct from 'season_planner' or internal.club_day_side(v_group) is distinct from 'received' then
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;

  -- The canonical decline trigger stays quiet for this club day; one grouped notice goes instead (below).
  perform set_config('ovalball.club_day_response', 'on', true);

  for v_req in
    select r.* from public.fixture_requests r
     where r.group_id = v_group.id
       and (p_request_ids is null or r.id = any(p_request_ids))
     order by r.created_at, r.id
  loop
    v_outcome := null; v_reason := null; v_fixture := null;
    v_note := case when p_notes is not null then nullif(left(trim(coalesce(p_notes->>v_req.id::text, '')), 500), '') end;

    if v_req.status in ('accepted', 'declined', 'cancelled', 'expired') then
      v_outcome := 'already_resolved';
      v_reason := 'Already ' || case v_req.status when 'accepted' then 'accepted' when 'declined' then 'declined' when 'cancelled' then 'withdrawn' else 'expired' end || '.';
    elsif p_request_ids is null and v_req.status <> 'sent' then
      -- "All remaining" never answers a fixture under discussion: a suggested date is answered on its own.
      v_outcome := 'not_actionable'; v_reason := 'Another date has been suggested -- answer it on its own.';
    elsif v_req.target_team_id is null or not internal.can('fixture.request.respond', 'team', v_group.opponent_club_id, v_req.target_team_id, null) then
      v_outcome := 'not_actionable'; v_reason := 'You cannot answer for this team.';
    else
      begin
        -- THE NOTE TRAVELS WITH THE ANSWER: a decline and its note are one change, and an accept's note is in place
        -- before the canonical accept, so the negotiation history records each answer with the words given for it.
        if p_action = 'accept' then
          if v_note is not null then
            update public.fixture_requests set response_note = v_note, response_note_by = v_uid, response_note_at = now() where id = v_req.id;
          end if;
          v_fixture := public.accept_fixture_request(v_req.id);
          v_outcome := 'accepted';
        else
          update public.fixture_requests
             set status = 'declined', decided_by = v_uid, decided_at = now(),
                 response_note = coalesce(v_note, response_note),
                 response_note_by = case when v_note is not null then v_uid else response_note_by end,
                 response_note_at = case when v_note is not null then now() else response_note_at end
           where id = v_req.id and status in ('sent', 'counter_proposed');
          if not found then
            v_outcome := 'already_resolved'; v_reason := 'Already answered.';
          else
            v_outcome := 'declined';
          end if;
        end if;
        if v_outcome in ('accepted', 'declined') then
          v_changed := v_changed + 1;
        end if;
      exception when others then
        v_outcome := 'failed';
        v_reason := case sqlstate when '23514' then sqlerrm
                                  when '40001' then 'It changed while you were answering. Look again.'
                                  when '42501' then 'You cannot answer for this team.'
                                  else coalesce(nullif(sqlerrm, ''), 'This fixture could not be answered.') end;
      end;
    end if;

    v_results := v_results || jsonb_build_object('request_id', v_req.id, 'outcome', v_outcome, 'reason', v_reason, 'fixture_id', v_fixture);
  end loop;

  select jsonb_build_object(
           'total', count(*),
           'accepted', count(*) filter (where r.status = 'accepted'),
           'declined', count(*) filter (where r.status = 'declined'),
           'pending', count(*) filter (where r.status = 'sent'),
           'countered', count(*) filter (where r.status = 'counter_proposed'),
           'withdrawn', count(*) filter (where r.status in ('cancelled', 'expired')))
    into v_summary
    from public.fixture_requests r where r.group_id = v_group.id;

  -- ONE notice back to the planning club, only when something actually changed (a retry changes nothing).
  if v_changed > 0 then
    select d.name into v_opp_name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.opponent_club_id;
    -- ONE LIVE SUMMARY PER CLUB DAY. Answering fixture by fixture would otherwise leave a trail of unread notices, each
    -- describing a state that no longer exists. The newest summary replaces an UNREAD earlier one for the same club
    -- day; one already read stays as the history it is.
    delete from public.notifications n
     where n.type = 'club_day_responded'
       and n.read_at is null
       and n.data->>'group_id' = v_group.id::text
       and n.user_id in (select r.user_id from internal.club_day_recipients(v_group.requesting_club_id,
                                                array(select q.requesting_team_id from public.fixture_requests q where q.group_id = v_group.id)) r);
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'club_day_responded', 'Club Day answered',
           format('%s responded to your Club Day · %s', coalesce(v_opp_name, 'The other club'),
                  concat_ws(' · ',
                    case when (v_summary->>'accepted')::int > 0 then (v_summary->>'accepted') || ' accepted' end,
                    case when (v_summary->>'declined')::int > 0 then (v_summary->>'declined') || ' declined' end,
                    case when (v_summary->>'pending')::int + (v_summary->>'countered')::int > 0
                         then ((v_summary->>'pending')::int + (v_summary->>'countered')::int)::text || ' awaiting decision' end)),
           jsonb_build_object('group_id', v_group.id, 'club_id', v_group.requesting_club_id)
      from internal.club_day_recipients(v_group.requesting_club_id,
                                        array(select r.requesting_team_id from public.fixture_requests r where r.group_id = v_group.id)) r;
  end if;

  return jsonb_build_object('results', v_results, 'summary', v_summary);
end;
$function$;
revoke all on function public.planner_respond_club_day(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.planner_respond_club_day(uuid, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- A NOTE ON ONE FIXTURE OF A CLUB DAY, without answering it: the receiving club's note (response_note) or the planning
-- club's own (note). Shown on that fixture in the club day; no notification of its own.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_note_club_day_fixture(p_request_id uuid, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_side text;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  perform internal.require_live_session();
  select * into v_req from public.fixture_requests where id = p_request_id;
  if found then
    select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  end if;
  if not found or v_group.source is distinct from 'season_planner' then
    raise exception 'That fixture could not be found.' using errcode = 'P0002';
  end if;
  v_side := internal.club_day_side(v_group);
  if v_side = 'received' then
    if not internal.can('fixture.request.respond', 'team', v_group.opponent_club_id, v_req.target_team_id, null) then
      raise exception 'You cannot answer for this team.' using errcode = '42501';
    end if;
    update public.fixture_requests set response_note = v_note, response_note_by = auth.uid(), response_note_at = now() where id = p_request_id;
  elsif v_side = 'sent' then
    if not internal.can_bulk_plan_fixtures(v_group.requesting_club_id) then
      raise exception 'You cannot change this club day.' using errcode = '42501';
    end if;
    update public.fixture_requests set note = v_note where id = p_request_id;
  else
    raise exception 'That fixture could not be found.' using errcode = 'P0002';
  end if;
end;
$function$;
revoke all on function public.planner_note_club_day_fixture(uuid, text) from public, anon;
grant execute on function public.planner_note_club_day_fixture(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE CLUB'S CLUB DAYS IN A SEASON, sent and received, each with its own live counts.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_club_days(p_club_id uuid, p_season_id uuid)
 returns table(group_id uuid, direction text, the_date date, opponent_club_id uuid, opponent_name text, opponent_logo_path text,
               total int, accepted int, pending int, countered int, declined int, withdrawn int, reverse_of_group_id uuid, has_return boolean)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_season public.seasons;
begin
  perform internal.require_live_session();
  if not (internal.can_bulk_plan_fixtures(p_club_id) or internal.can('fixture.request.respond', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorised to see this club''s club days.' using errcode = '42501';
  end if;
  select * into v_season from public.seasons where id = p_season_id;
  if not found then
    raise exception 'That season could not be found.' using errcode = '22023';
  end if;
  return query
    select g.id,
           case when g.requesting_club_id = p_club_id then 'sent' else 'received' end,
           g.proposed_date,
           case when g.requesting_club_id = p_club_id then g.opponent_club_id else g.requesting_club_id end,
           d.name, d.logo_storage_path,
           count(r.id)::int,
           (count(r.id) filter (where r.status = 'accepted'))::int,
           (count(r.id) filter (where r.status = 'sent'))::int,
           (count(r.id) filter (where r.status = 'counter_proposed'))::int,
           (count(r.id) filter (where r.status = 'declined'))::int,
           (count(r.id) filter (where r.status in ('cancelled', 'expired')))::int,
           g.reverse_of_group_id,
           exists (select 1 from public.fixture_request_groups x where x.reverse_of_group_id = g.id)
      from public.fixture_request_groups g
      join public.fixture_requests r on r.group_id = g.id
      join public.clubs oc on oc.id = case when g.requesting_club_id = p_club_id then g.opponent_club_id else g.requesting_club_id end
      join public.club_directory d on d.id = oc.directory_id
     where g.source = 'season_planner'
       and (g.requesting_club_id = p_club_id or g.opponent_club_id = p_club_id)
       and g.proposed_date between coalesce(v_season.pre_season_starts_on, v_season.starts_on) and v_season.ends_on
     group by g.id, d.name, d.logo_storage_path
     order by g.proposed_date, g.created_at;
end;
$function$;
revoke all on function public.planner_club_days(uuid, uuid) from public, anon;
grant execute on function public.planner_club_days(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE CLUB'S PLAYING DAYS: read for the planner, written by the club's fixture planners.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.planner_playing_days(p_club_id uuid, p_season_id uuid default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_policy public.club_scheduling_policy;
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  select * into v_policy from public.club_scheduling_policy where club_id = p_club_id;
  return jsonb_build_object(
    'club_default', v_policy.default_playing_day,
    'categories', jsonb_build_object('senior_mens', v_policy.playing_day_senior_mens, 'senior_womens', v_policy.playing_day_senior_womens,
                                     'colts', v_policy.playing_day_colts, 'age_grade', v_policy.playing_day_age_grade),
    'season_structure', case when p_season_id is null then null else internal.planner_season_structure(p_club_id, p_season_id) end,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.id, 'display_name', t.display_name, 'category', t.category, 'gender', t.gender,
                                          'override', tt.preferred_playing_day, 'effective', d.playing_day, 'source', d.source)
                       order by t.category, t.age_group nulls last, t.display_name)
        from internal.planner_club_teams(p_club_id) t
        join public.teams tt on tt.id = t.id
        cross join lateral internal.team_playing_day(t.id) d), '[]'::jsonb));
end;
$function$;
revoke all on function public.planner_playing_days(uuid, uuid) from public, anon;
grant execute on function public.planner_playing_days(uuid, uuid) to authenticated;

create or replace function public.set_club_playing_days(p_club_id uuid, p_default smallint, p_senior_mens smallint default null,
                                                        p_senior_womens smallint default null, p_colts smallint default null,
                                                        p_age_grade smallint default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(array[p_default, p_senior_mens, p_senior_womens, p_colts, p_age_grade]) d where d is not null and d not between 1 and 7) then
    raise exception 'A playing day is a day of the week.' using errcode = '22023';
  end if;
  insert into public.club_scheduling_policy (club_id, default_playing_day, playing_day_senior_mens, playing_day_senior_womens,
                                             playing_day_colts, playing_day_age_grade, updated_by, updated_at)
  values (p_club_id, p_default, p_senior_mens, p_senior_womens, p_colts, p_age_grade, auth.uid(), now())
  on conflict (club_id) do update set
    default_playing_day = excluded.default_playing_day,
    playing_day_senior_mens = excluded.playing_day_senior_mens,
    playing_day_senior_womens = excluded.playing_day_senior_womens,
    playing_day_colts = excluded.playing_day_colts,
    playing_day_age_grade = excluded.playing_day_age_grade,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$function$;
revoke all on function public.set_club_playing_days(uuid, smallint, smallint, smallint, smallint, smallint) from public, anon;
grant execute on function public.set_club_playing_days(uuid, smallint, smallint, smallint, smallint, smallint) to authenticated;

create or replace function public.set_team_playing_day(p_team_id uuid, p_day smallint)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
begin
  perform internal.require_live_session();
  select club_id into v_club from public.teams where id = p_team_id;
  if v_club is null or not internal.can_bulk_plan_fixtures(v_club) then
    raise exception 'You are not authorised to plan this team''s fixtures.' using errcode = '42501';
  end if;
  if p_day is not null and p_day not between 1 and 7 then
    raise exception 'A playing day is a day of the week.' using errcode = '22023';
  end if;
  update public.teams set preferred_playing_day = p_day where id = p_team_id;
end;
$function$;
revoke all on function public.set_team_playing_day(uuid, smallint) from public, anon;
grant execute on function public.set_team_playing_day(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- WHOSE WORDS A HISTORY ENTRY CARRIES. The negotiation history read every update's note as coalesce(counter_note, note),
-- so an answer from the other club was shown quoting the requesting club's OWN note ("Response from Calder Moor RFC:
-- Accepted -- 'Could this kick off at 10:30?'", words Ashby Brook wrote). Each entry now carries only the words that
-- belong to that event: the request's own note when it was made; the suggested-date note on a counter-proposal; the
-- answering club's note when it accepts or declines; and a note added or changed on its own. Same authority, same
-- columns, same audit source.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.fixture_request_history(p_request_id uuid)
returns table(
  changed_at timestamptz,
  changed_by_club_name text,
  status_before text,
  status_after text,
  date_after text,
  kickoff_time_after text,
  note_after text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
begin
  select * into v_req from public.fixture_requests where id = p_request_id;
  if not found then
    raise exception 'Fixture request not found.' using errcode = '42501';
  end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if not (
    (internal.can('fixture.request.create', 'team', (select t.club_id from public.teams t where t.id = v_req.requesting_team_id), v_req.requesting_team_id, null))
    or (v_req.target_team_id is not null and internal.can('fixture.request.respond', 'team', (select t.club_id from public.teams t where t.id = v_req.target_team_id), v_req.target_team_id, null))
    or internal.can('fixture.request.create', 'club', v_group.requesting_club_id, null, null)
    or (v_group.opponent_club_id is not null and internal.can('fixture.request.respond', 'club', v_group.opponent_club_id, null, null))
    or internal.has_site_capability('site.fixtures.support')
  ) then
    raise exception 'You are not authorized to view this fixture request.' using errcode = '42501';
  end if;

  return query
  select
    a.changed_at,
    cd.name,
    a.before ->> 'status',
    a.after ->> 'status',
    coalesce(a.after ->> 'countered_date', case when a.action = 'insert' then to_char(v_group.proposed_date, 'YYYY-MM-DD') end),
    coalesce(a.after ->> 'countered_kickoff_time', case when a.action = 'insert' then a.after ->> 'preferred_kickoff_time' end),
    case
      when a.action = 'insert' then a.after ->> 'note'
      when (a.after ->> 'status') is distinct from (a.before ->> 'status') and (a.after ->> 'status') = 'counter_proposed' then a.after ->> 'counter_note'
      when (a.after ->> 'status') is distinct from (a.before ->> 'status') and (a.after ->> 'status') in ('accepted', 'declined') then a.after ->> 'response_note'
      when (a.after ->> 'response_note') is distinct from (a.before ->> 'response_note') then a.after ->> 'response_note'
      when (a.after ->> 'counter_note') is distinct from (a.before ->> 'counter_note') then a.after ->> 'counter_note'
      when (a.after ->> 'note') is distinct from (a.before ->> 'note') then a.after ->> 'note'
    end
  from public.audit_log a
  left join public.club_memberships cm on cm.user_id = a.changed_by and cm.status = 'active'
  left join public.clubs c on c.id = cm.club_id
  left join public.club_directory cd on cd.id = c.directory_id
  where a.table_name = 'fixture_requests' and a.record_id = p_request_id
  order by a.changed_at;
end;
$$;
