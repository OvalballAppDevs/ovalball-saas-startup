-- ONE PHYSICAL ESTATE, ONE OCCUPANCY.
--
-- A club's pitches and changing rooms are used by fixtures, training sessions, tournaments and club events,
-- and each of those had its own idea of when a pitch was busy -- or none: the server checked no overlap at
-- all for fixtures, training or events, and a tournament's clash engine looked only at its own games. Arena
-- is the physical view across all of them, so this gives the estate one answer to "can this resource take
-- this activity at this time?" and has every writer that places an activity on a resource ask it.
--
--   1. ONE PITCH-FIT RESOLVER (internal.age_grade_pitch_fit). Ovalball's own verified Regulation 15 register
--      (public.regulatory_facts, VERIFIED, with its citations) already holds the RFU maximum pitch for every
--      grade U7-U14 -- U9 60m x 30m (Appendix 3) and U11 60m x 43m (Appendix 5) among them -- so a grade's
--      size comes from there. Only a grade the register has no size for falls back to its scheduling
--      category (full / reduced = half / mini = quarter of a 100m x 70m pitch), and says so. The copy of
--      three of those sizes that 20270736 put on fixture_scheduling_rules is removed: one source.
--   2. ONE OCCUPANCY (internal.arena_occupancy): every activity's claim on a pitch or room, in minutes of
--      its day -- a fixture's pitch from warm-up to clearing the pitch, its rooms from access to release
--      plus a room's turnaround; a training session for its own times; a tournament's reservation, marked
--      out as its organiser said, and its published games; and a club event's EXPLICIT pitch reservation
--      only (an event at the clubhouse blocks no pitch).
--   3. ONE CONFLICT ENGINE (internal.arena_conflicts) says every clash in words. Fixture against fixture
--      keeps the board's lane-and-size rule; a fixture holds its pitch exclusively against training;
--      training groups may share a pitch with each other; a tournament's or an event's reservation holds
--      its pitch against everything else; two tournaments may share a pitch only when it is marked out the
--      same way for both (their games then share its areas); rooms are one activity at a time, with time
--      to turn round between them.
--   4. EVERY WRITER THAT PLACES AN ACTIVITY ON A RESOURCE refuses a NEW clash it would cause (a clash that
--      was already there does not block an unrelated edit): Match Centre's facilities, the board's schedule
--      and pitch writers, training sessions, tournament reservations and an event's pitches. A kick-off
--      moved elsewhere -- or agreed by the other club -- is not refused; Arena shows what it caused.
--   5. A TOURNAMENT'S CLASH ENGINE COUNTS ANOTHER TOURNAMENT'S PUBLISHED GAMES on a pitch they share, so
--      the two cannot put more games on its areas than it is marked out for.
--   6. AN ALLOCATION KNOWS WHO MADE EACH PART AND WHAT IS LOCKED (fixtures.allocation_auto /
--      allocation_locks, part by part -- pitch, home room, away room, officials' room -- and
--      training_sessions.allocation_source / pitch_locked), so automatic allocation never overwrites a
--      person's decision, and a fixture can hold its match officials' room (officials_changing_room_id).
--   7. ROOM TIMES ARE THEIR OWN SETTING (club_scheduling_policy.room_access/release/turnaround_minutes,
--      platform defaults 60/30/15): Ovalball configuration a club can change, not a governing-body rule.
--   8. THE TOURNAMENT SCHEDULER'S WORKING SET IS CLEARED THE WAY THE API ALLOWS (internal.load_schedule_units,
--      20270736): its `delete from pg_temp.sched_units;` had no WHERE clause, which the API's own sessions
--      refuse (they preload safeupdate), so scheduling through the app failed where psql succeeded.
--      supabase/tests/api_safeupdate_contract.sql now holds every function to that contract.

-- =====================================================================================================
-- 0. SMALL HELPERS
-- =====================================================================================================

create or replace function internal.minute_of(p_time time)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select (extract(hour from p_time) * 60 + extract(minute from p_time))::integer;
$function$;

-- A minute of the day as a clock time; the end of the day reads 24:00.
create or replace function internal.clock(p_minute integer)
returns text
language sql
immutable
set search_path to ''
as $function$
  select lpad((greatest(least(p_minute, 1440), 0) / 60)::text, 2, '0') || ':'
      || lpad((greatest(least(p_minute, 1440), 0) % 60)::text, 2, '0');
$function$;

-- =====================================================================================================
-- 1. ONE PITCH-FIT RESOLVER
-- =====================================================================================================

-- HOW MUCH GROUND A GRADE'S GAME NEEDS. The RFU states a MAXIMUM field of play per grade, and a game is
-- planned onto ground that can hold it (the owner's tournament rule, 2026-10-03). Three answers, in order:
--   REGULATION  Ovalball's verified Regulation 15 register holds the grade's maximum length and width.
--   CATEGORY    The register holds no size for the grade (U6, the senior and colts bands, or a code with no
--               register entry): its scheduling category stands in -- full = a 100m x 70m pitch, reduced =
--               half of one, mini = a quarter. A stand-in, and reported as one; never presented as an RFU
--               size.
--   UNKNOWN     No rule at all: no size is invented (null). Capacity then counts the game as a whole pitch,
--               and suitability does not block on it.
-- The footprint is the share of a standard full-size pitch the size needs: a quarter (up to 1,750 m2), a
-- half (up to 3,500 m2) or the whole pitch.
create or replace function internal.age_grade_pitch_fit(p_rugby_code text, p_age_group text, p_on date default null)
returns table (length_m numeric, width_m numeric, area_m2 numeric, footprint text, basis text, source text)
language sql
stable
security definer
set search_path to ''
as $function$
  with facts as (
    select f.fact_type, f.value_distance_metres as metres, f.effective_from,
           coalesce(substring(f.notes from '\[([^]]+)\]'), f.fact_key) as cite
    from public.regulatory_facts f
    join public.regulatory_fact_applicability a on a.fact_id = f.id
    join public.regulatory_identities i on i.id = a.regulatory_identity_id
    join public.canonical_team_types ctt on ctt.id = i.ovalball_canonical_team_type_id
    where f.status = 'VERIFIED'
      and f.fact_type in ('PITCH_LENGTH', 'PITCH_WIDTH')
      and f.value_distance_metres is not null
      and f.rugby_code = coalesce(p_rugby_code, 'union')
      and i.rugby_code = coalesce(p_rugby_code, 'union')
      and p_age_group is not null and ctt.age_group = p_age_group
      and (f.effective_from is null or f.effective_from <= coalesce(p_on, current_date))
      and (f.effective_to is null or f.effective_to >= coalesce(p_on, current_date))
  ), reg as (
    select (array_agg(x.metres order by x.effective_from desc nulls last) filter (where x.fact_type = 'PITCH_LENGTH'))[1] as len,
           (array_agg(x.metres order by x.effective_from desc nulls last) filter (where x.fact_type = 'PITCH_WIDTH'))[1] as wid,
           (array_agg(x.cite order by x.effective_from desc nulls last) filter (where x.fact_type = 'PITCH_LENGTH'))[1] as cite
    from facts x
  ), rule as (
    select r.min_pitch_size_category as cat, r.source
    from public.fixture_scheduling_rules r
    where r.rugby_code = coalesce(p_rugby_code, 'union')
      and (r.age_group = p_age_group or r.age_group is null)
    order by (r.age_group is null), r.effective_season desc nulls last
    limit 1
  )
  select case when reg.len is not null and reg.wid is not null then reg.len end,
         case when reg.len is not null and reg.wid is not null then reg.wid end,
         case when reg.len is not null and reg.wid is not null then reg.len * reg.wid
              when rule.cat = 'full' then 7000::numeric
              when rule.cat = 'reduced' then 3500::numeric
              when rule.cat = 'mini' then 1750::numeric end,
         case when reg.len is not null and reg.wid is not null then
                case when reg.len * reg.wid <= 1750 then 'quarter' when reg.len * reg.wid <= 3500 then 'half' else 'full' end
              when rule.cat = 'full' then 'full'
              when rule.cat = 'reduced' then 'half'
              when rule.cat = 'mini' then 'quarter' end,
         case when reg.len is not null and reg.wid is not null then 'REGULATION'
              when rule.cat is not null then 'CATEGORY'
              else 'UNKNOWN' end,
         case when reg.len is not null and reg.wid is not null
                then format('%s maximum %sm x %sm', reg.cite, trim(to_char(reg.len, 'FM9999.##')), trim(to_char(reg.wid, 'FM9999.##')))
              when rule.cat is not null
                then format('No verified pitch size is held for %s; counted by its scheduling category (%s).',
                            coalesce(p_age_group, 'this grade'), rule.cat)
              else 'No pitch size or scheduling rule is held for this grade.' end
  from reg left join rule on true;
$function$;
revoke all on function internal.age_grade_pitch_fit(text, text, date) from public, anon, authenticated;

-- Every grade's answer for one code, for a client to present -- reference data, the same for everybody.
create or replace function public.age_grade_pitch_fits(p_rugby_code text)
returns table (age_group text, length_m numeric, width_m numeric, area_m2 numeric, footprint text, basis text, source text)
language sql
stable
security definer
set search_path to ''
as $function$
  with grades as (
    select r.age_group from public.fixture_scheduling_rules r where r.rugby_code = coalesce(p_rugby_code, 'union')
    union
    select ctt.age_group
    from public.regulatory_identities i
    join public.canonical_team_types ctt on ctt.id = i.ovalball_canonical_team_type_id
    where i.rugby_code = coalesce(p_rugby_code, 'union') and ctt.age_group is not null
  )
  select g.age_group, f.length_m, f.width_m, f.area_m2, f.footprint, f.basis, f.source
  from grades g
  cross join lateral internal.age_grade_pitch_fit(coalesce(p_rugby_code, 'union'), g.age_group, current_date) f
  order by g.age_group nulls last;
$function$;
revoke all on function public.age_grade_pitch_fits(text) from public, anon;
grant execute on function public.age_grade_pitch_fits(text) to authenticated;

-- The tournament planner's size for a game is the same resolver's; an unsized grade counts as a whole
-- pitch, as it always has.
create or replace function internal.tournament_game_area_m2(p_tournament_id uuid, p_age_group text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select f.area_m2
     from public.tournaments t
     cross join lateral internal.age_grade_pitch_fit(coalesce(t.rugby_code, 'union'), p_age_group, t.event_date) f
     where t.id = p_tournament_id),
    (select f.area_m2 from internal.age_grade_pitch_fit('union', p_age_group, null) f
     where not exists (select 1 from public.tournaments t where t.id = p_tournament_id)),
    7000::numeric);
$function$;

-- The copy of three Regulation 15 sizes on the scheduling rules (20270736) is no longer read: the register
-- above is the one source.
alter table public.fixture_scheduling_rules drop column if exists max_pitch_length_m;
alter table public.fixture_scheduling_rules drop column if exists max_pitch_width_m;

-- =====================================================================================================
-- 2. ROOM TIMES
-- =====================================================================================================

alter table public.club_scheduling_policy add column if not exists room_access_minutes integer;
alter table public.club_scheduling_policy add column if not exists room_release_minutes integer;
alter table public.club_scheduling_policy add column if not exists room_turnaround_minutes integer;
alter table public.club_scheduling_policy drop constraint if exists club_scheduling_policy_room_access_range;
alter table public.club_scheduling_policy add constraint club_scheduling_policy_room_access_range
  check (room_access_minutes is null or (room_access_minutes between 0 and 120 and room_access_minutes % 5 = 0));
alter table public.club_scheduling_policy drop constraint if exists club_scheduling_policy_room_release_range;
alter table public.club_scheduling_policy add constraint club_scheduling_policy_room_release_range
  check (room_release_minutes is null or (room_release_minutes between 0 and 120 and room_release_minutes % 5 = 0));
alter table public.club_scheduling_policy drop constraint if exists club_scheduling_policy_room_turnaround_range;
alter table public.club_scheduling_policy add constraint club_scheduling_policy_room_turnaround_range
  check (room_turnaround_minutes is null or (room_turnaround_minutes between 0 and 60 and room_turnaround_minutes % 5 = 0));
comment on column public.club_scheduling_policy.room_access_minutes is
  'How long before kick-off a team has its changing room. Null inherits the platform default.';
comment on column public.club_scheduling_policy.room_release_minutes is
  'How long after the final whistle a team keeps its changing room. Null inherits the platform default.';
comment on column public.club_scheduling_policy.room_turnaround_minutes is
  'How long a changing room needs between one team leaving and the next arriving. Null inherits the platform default.';

alter table public.platform_scheduling_defaults add column if not exists room_access_minutes integer not null default 60;
alter table public.platform_scheduling_defaults add column if not exists room_release_minutes integer not null default 30;
alter table public.platform_scheduling_defaults add column if not exists room_turnaround_minutes integer not null default 15;

-- EVERY TIME RULE ARENA PLANS WITH, resolved club -> platform, and where each came from.
create or replace function internal.arena_policy(p_club_id uuid)
returns table (warm_up integer, pack_up integer, turnaround integer,
               room_access integer, room_release integer, room_turnaround integer,
               buffer_source text, room_source text)
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(c.warm_up_minutes, p.warm_up_minutes, 0),
         coalesce(c.pack_up_minutes, p.pack_up_minutes, 0),
         coalesce(c.turnaround_minutes, 15),
         coalesce(c.room_access_minutes, p.room_access_minutes, 60),
         coalesce(c.room_release_minutes, p.room_release_minutes, 30),
         coalesce(c.room_turnaround_minutes, p.room_turnaround_minutes, 15),
         case when c.warm_up_minutes is not null or c.pack_up_minutes is not null then 'club' else 'platform' end,
         case when c.room_access_minutes is not null or c.room_release_minutes is not null
                   or c.room_turnaround_minutes is not null then 'club' else 'platform' end
  from public.platform_scheduling_defaults p
  left join public.club_scheduling_policy c on c.club_id = p_club_id
  where p.id;
$function$;
revoke all on function internal.arena_policy(uuid) from public, anon, authenticated;

-- How long a grade's match lasts: its scheduling rule's two halves, the code's senior rule, else an hour.
create or replace function internal.arena_match_minutes(p_rugby_code text, p_age_group text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select r.half_minutes * 2 from public.fixture_scheduling_rules r
     where r.rugby_code = coalesce(p_rugby_code, 'union') and r.age_group = p_age_group
     order by r.effective_season desc nulls last limit 1),
    (select r.half_minutes * 2 from public.fixture_scheduling_rules r
     where r.rugby_code = coalesce(p_rugby_code, 'union') and r.age_group is null
     order by r.effective_season desc nulls last limit 1),
    60);
$function$;
revoke all on function internal.arena_match_minutes(text, text) from public, anon, authenticated;

-- =====================================================================================================
-- 3. WHO MADE AN ALLOCATION, WHAT IS LOCKED, AND THE OFFICIALS' ROOM
-- =====================================================================================================

alter table public.fixtures add column if not exists officials_changing_room_id uuid
  references public.venue_changing_rooms(id) on delete set null;
comment on column public.fixtures.officials_changing_room_id is
  'The host club''s changing room for the match officials, at the fixture''s ground. Only for a host club on Ovalball.';

alter table public.fixtures add column if not exists allocation_locks text[] not null default '{}'::text[];
alter table public.fixtures drop constraint if exists fixtures_allocation_locks_check;
alter table public.fixtures add constraint fixtures_allocation_locks_check
  check (allocation_locks <@ array['pitch', 'home_room', 'away_room', 'officials_room']::text[]);
comment on column public.fixtures.allocation_locks is
  'The parts of this fixture''s facility allocation a person has locked: automatic allocation never changes them.';

-- WHICH PARTS AUTOMATIC ALLOCATION MADE. A part a person set (or that was set before Arena) is not in it,
-- so a re-run recalculates only Arena's own work: when Arena completes a person's allocation -- a missing
-- away room -- the person's pitch stays theirs.
alter table public.fixtures add column if not exists allocation_auto text[] not null default '{}'::text[];
alter table public.fixtures drop constraint if exists fixtures_allocation_auto_check;
alter table public.fixtures add constraint fixtures_allocation_auto_check
  check (allocation_auto <@ array['pitch', 'home_room', 'away_room', 'officials_room']::text[]);
comment on column public.fixtures.allocation_auto is
  'The parts of this fixture''s facility allocation Arena''s automatic allocation made. A part a person set is not listed.';

alter table public.training_sessions add column if not exists pitch_locked boolean not null default false;
alter table public.training_sessions add column if not exists allocation_source text;
alter table public.training_sessions drop constraint if exists training_sessions_allocation_source_check;
alter table public.training_sessions add constraint training_sessions_allocation_source_check
  check (allocation_source is null or allocation_source in ('MANUAL', 'AUTO'));
comment on column public.training_sessions.pitch_locked is
  'A person has locked this session''s pitch: automatic allocation never changes it.';
comment on column public.training_sessions.allocation_source is
  'Who chose this session''s pitch: AUTO (Arena''s automatic allocation) or MANUAL. Null is a plan''s or a person''s, kept.';


-- A CHANGE TO SOME PARTS OF AN ALLOCATION: made by automatic allocation, they join allocation_auto; made by
-- a person, they leave it. Who is making the change is said by the caller, never by the browser.
create or replace function internal.allocation_auto_after(p_current text[], p_changed text[])
returns text[]
language sql
stable
set search_path to ''
as $function$
  select case when coalesce(current_setting('ovalball.allocation_source', true), '') = 'AUTO'
              then array(select distinct x from unnest(coalesce(p_current, '{}') || coalesce(p_changed, '{}')) x order by x)
              else array(select x from unnest(coalesce(p_current, '{}')) x where not (x = any (coalesce(p_changed, '{}'))) order by x) end;
$function$;
revoke all on function internal.allocation_auto_after(text[], text[]) from public, anon, authenticated;

-- The host's room for the officials follows the host and the ground exactly as the teams' rooms do.
create or replace function internal.fixture_facilities_follow_host()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  h_new record;
  h_old record;
  v_pitch_club uuid;
  v_pitch_venue uuid;
begin
  select * into h_new from internal.fixture_host_of(new.home_away, new.owning_team_id, new.opponent_team_id, new.opponent_directory_id);

  if tg_op = 'UPDATE'
     and (new.home_away is distinct from old.home_away
          or new.owning_team_id is distinct from old.owning_team_id
          or new.opponent_team_id is distinct from old.opponent_team_id
          or new.opponent_directory_id is distinct from old.opponent_directory_id) then
    select * into h_old from internal.fixture_host_of(old.home_away, old.owning_team_id, old.opponent_team_id, old.opponent_directory_id);
    if h_old.mode is distinct from h_new.mode
       or h_old.host_club_id is distinct from h_new.host_club_id
       or h_old.host_directory_id is distinct from h_new.host_directory_id then
      new.venue_id := case when h_new.mode = 'CANONICAL' then internal.host_default_venue(h_new.host_club_id) end;
      new.venue_address := case when h_new.mode = 'PROVISIONAL' then internal.directory_ground_label(h_new.host_directory_id) end;
      new.pitch_id := null;
      new.pitch_allocation := null;
      new.home_changing_room_id := null;
      new.away_changing_room_id := null;
      new.officials_changing_room_id := null;
      new.home_changing_room_number := null;
      new.away_changing_room_number := null;
      new.no_changing_rooms := false;
      -- A new host's ground carries none of the old host's allocation or its locks.
      new.allocation_locks := '{}'::text[];
      new.allocation_auto := '{}'::text[];
    end if;
  end if;

  -- A PART THAT IS GONE HOLDS NOTHING: no lock or automatic mark stays on a pitch or room the fixture no
  -- longer has (a locked empty room would never be filled again).
  new.allocation_locks := array(select x from unnest(new.allocation_locks) x
                                where (x = 'pitch' and new.pitch_id is not null)
                                   or (x = 'home_room' and new.home_changing_room_id is not null)
                                   or (x = 'away_room' and new.away_changing_room_id is not null)
                                   or (x = 'officials_room' and new.officials_changing_room_id is not null)
                                order by x);
  new.allocation_auto := array(select x from unnest(new.allocation_auto) x
                               where (x = 'pitch' and new.pitch_id is not null)
                                  or (x = 'home_room' and new.home_changing_room_id is not null)
                                  or (x = 'away_room' and new.away_changing_room_id is not null)
                                  or (x = 'officials_room' and new.officials_changing_room_id is not null)
                               order by x);

  if tg_op = 'INSERT'
     or new.venue_id is distinct from old.venue_id or new.pitch_id is distinct from old.pitch_id
     or new.home_changing_room_id is distinct from old.home_changing_room_id
     or new.away_changing_room_id is distinct from old.away_changing_room_id
     or new.officials_changing_room_id is distinct from old.officials_changing_room_id
     or new.home_changing_room_number is distinct from old.home_changing_room_number
     or new.away_changing_room_number is distinct from old.away_changing_room_number
     or new.home_away is distinct from old.home_away then

    if new.venue_id is not null and not exists (
         select 1 from public.venues v where v.id = new.venue_id and v.club_id = h_new.host_club_id) then
      raise exception 'That ground is not the host club''s.' using errcode = '23514';
    end if;

    if new.pitch_id is not null then
      select p.club_id, p.venue_id into v_pitch_club, v_pitch_venue from public.club_pitches p where p.id = new.pitch_id;
      if v_pitch_club is distinct from h_new.host_club_id then
        raise exception 'That pitch is not the host club''s.' using errcode = '23514';
      end if;
      if new.venue_id is not null and v_pitch_venue is not null and v_pitch_venue is distinct from new.venue_id then
        raise exception 'That pitch is not at the chosen ground.' using errcode = '23514';
      end if;
    end if;

    if (new.home_changing_room_id is not null or new.away_changing_room_id is not null or new.officials_changing_room_id is not null)
       and exists (select 1 from public.venue_changing_rooms r
                    where r.id in (new.home_changing_room_id, new.away_changing_room_id, new.officials_changing_room_id)
                      and (r.venue_id is distinct from new.venue_id or r.club_id is distinct from h_new.host_club_id)) then
      raise exception 'That changing room is not at the chosen ground.' using errcode = '23514';
    end if;

    if (new.home_changing_room_number is not null or new.away_changing_room_number is not null)
       and h_new.mode is distinct from 'PROVISIONAL' then
      raise exception 'Numbered changing rooms are only for a ground whose club is not on Ovalball.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

-- =====================================================================================================
-- 4. ONE OCCUPANCY
-- =====================================================================================================

-- WHO IS PLAYING HOME, AS ONE LINE: the club's own side by its display name, against the visitors.
create or replace function internal.arena_fixture_label(p_fixture_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(ht.display_name, 'Home team') || ' v ' ||
         coalesce(case when f.home_away = 'Away'
                       then (select cd.name from public.teams ot join public.clubs oc on oc.id = ot.club_id
                             join public.club_directory cd on cd.id = oc.directory_id where ot.id = f.owning_team_id)
                       else coalesce((select cd.name from public.teams pt join public.clubs pc on pc.id = pt.club_id
                                      join public.club_directory cd on cd.id = pc.directory_id where pt.id = f.opponent_team_id),
                                     (select cd.name from public.club_directory cd where cd.id = f.opponent_directory_id),
                                     nullif(btrim(f.raw_opposition_text), '')) end,
                  'the visitors')
  from public.fixtures f
  left join public.teams ht on ht.id = f.home_team_id
  where f.id = p_fixture_id;
$function$;
revoke all on function internal.arena_fixture_label(uuid) from public, anon, authenticated;

-- EVERYTHING THAT CLAIMS ONE OF A CLUB'S PITCHES OR CHANGING ROOMS, day by day, in minutes of the day.
--   FIXTURE          a home fixture at this club with a kick-off time. Its pitch from warm-up until the
--                    pitch is cleared (turnaround_until adds the club's gap between matches, which only
--                    automatic allocation keeps); each of its rooms from access -- or the home side's meet
--                    time, if earlier -- until release, plus the room's turnaround.
--   TRAINING         a planned session with a pitch and times: its own start to its own end (a session's
--                    warm-up is part of the session, never extra pitch time).
--   TOURNAMENT       a tournament's reservation of a pitch, marked out as its organiser said (areas).
--   TOURNAMENT_GAME  a published (or plan-less) tournament game on a pitch, inside its reservation.
--   EVENT            a club event's EXPLICIT pitch reservation, for the event's own hours that day.
create or replace function internal.arena_occupancy(p_club_id uuid, p_from date, p_until date)
returns table (
  activity_type text, activity_id uuid, parent_id uuid, label text, team_id uuid,
  day date, venue_id uuid, resource_type text, resource_id uuid, room_role text,
  occupied_from integer, play_from integer, play_until integer, occupied_until integer, turnaround_until integer,
  footprint text, area_m2 numeric, areas integer, locked boolean, allocation_source text)
language sql
stable
security definer
set search_path to ''
as $function$
  with pol as (
    select * from internal.arena_policy(p_club_id)
  ), code as (
    select coalesce((select cd.rugby_code from public.clubs c join public.club_directory cd on cd.id = c.directory_id
                     where c.id = p_club_id), 'union') as rugby_code
  ), fx as (
    select f.id, f.kickoff_date as day, internal.minute_of(f.kickoff_time) as ko, f.venue_id, f.pitch_id,
           f.home_changing_room_id, f.away_changing_room_id, f.officials_changing_room_id,
           f.meet_time, f.allocation_locks, f.allocation_auto, f.home_team_id,
           coalesce(case when f.home_away = 'Home' then f.owning_team_age_group_snapshot
                         else f.opponent_team_age_group_snapshot end, ht.age_group) as age_group,
           coalesce(ht.rugby_code, (select rugby_code from code)) as rugby_code
    from public.fixtures f
    join public.teams ht on ht.id = f.home_team_id and ht.club_id = p_club_id
    where f.kickoff_date between p_from and p_until and f.kickoff_time is not null
      and f.archived_at is null and f.cancelled_at is null and f.status <> 'Cancelled'
      and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id)
  ), fxw as (
    select fx.*, internal.arena_match_minutes(fx.rugby_code, fx.age_group) as play,
           fit.footprint, fit.area_m2, internal.arena_fixture_label(fx.id) as label
    from fx
    cross join lateral internal.age_grade_pitch_fit(fx.rugby_code, fx.age_group, fx.day) fit
  ), fixture_pitch as (
    select 'FIXTURE'::text, w.id, null::uuid, w.label, w.home_team_id, w.day, w.venue_id,
           'PITCH'::text, w.pitch_id, null::text,
           greatest(w.ko - pol.warm_up, 0), w.ko, w.ko + w.play,
           least(w.ko + w.play + pol.pack_up, 1440), least(w.ko + w.play + pol.pack_up + pol.turnaround, 1440),
           w.footprint, w.area_m2, null::integer, 'pitch' = any (w.allocation_locks),
           case when 'pitch' = any (w.allocation_auto) then 'AUTO' end
    from fxw w cross join pol
    where w.pitch_id is not null
  ), fixture_rooms as (
    select 'FIXTURE'::text, w.id, null::uuid, w.label, w.home_team_id, w.day, w.venue_id,
           'ROOM'::text, r.room_id, r.role,
           greatest(case when r.role = 'HOME' and w.meet_time is not null
                         then least(internal.minute_of(w.meet_time), w.ko - pol.room_access)
                         else w.ko - pol.room_access end, 0),
           w.ko, w.ko + w.play,
           least(w.ko + w.play + pol.room_release, 1440), least(w.ko + w.play + pol.room_release + pol.room_turnaround, 1440),
           null::text, null::numeric, null::integer, r.lock_key = any (w.allocation_locks),
           case when r.lock_key = any (w.allocation_auto) then 'AUTO' end
    from fxw w cross join pol
    cross join lateral (values ('HOME', w.home_changing_room_id, 'home_room'),
                               ('AWAY', w.away_changing_room_id, 'away_room'),
                               ('OFFICIALS', w.officials_changing_room_id, 'officials_room')) r(role, room_id, lock_key)
    where r.room_id is not null
  ), training as (
    select 'TRAINING'::text, s.id, null::uuid,
           coalesce(t.display_name, nullif(btrim(g.alias), ''), g.display_tag, 'Team') || ' training', s.team_id, s.occurrence_date, s.venue_id,
           'PITCH'::text, s.pitch_id, null::text,
           internal.minute_of(s.start_time), internal.minute_of(s.start_time),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440),
           null::text, null::numeric, null::integer, s.pitch_locked, s.allocation_source
    from public.training_sessions s
    left join public.teams t on t.id = s.team_id
    left join public.scheduling_groups g on g.id = s.scheduling_group_id
    where s.club_id = p_club_id and s.occurrence_date between p_from and p_until
      and s.status = 'PLANNED' and s.cancelled_at is null
      and s.pitch_id is not null and s.start_time is not null
  ), reservations as (
    select 'TOURNAMENT'::text, tp.id, tp.tournament_id, t.name, null::uuid, tp.reserved_on, p.venue_id,
           'PITCH'::text, tp.pitch_id, null::text,
           internal.minute_of(tp.start_time), internal.minute_of(tp.start_time),
           case when tp.end_time = '00:00'::time then 1440 else internal.minute_of(tp.end_time) end,
           case when tp.end_time = '00:00'::time then 1440 else internal.minute_of(tp.end_time) end,
           case when tp.end_time = '00:00'::time then 1440 else internal.minute_of(tp.end_time) end,
           null::text, null::numeric, coalesce(tp.playing_areas, p.lane_count, 1), true, null::text
    from public.tournament_pitches tp
    join public.tournaments t on t.id = tp.tournament_id and t.cancelled_at is null
    join public.club_pitches p on p.id = tp.pitch_id and p.club_id = p_club_id
    where tp.reserved_on between p_from and p_until
  ), games as (
    select 'TOURNAMENT_GAME'::text, g.id, g.tournament_id, t.name, null::uuid, g.game_date, p.venue_id,
           'PITCH'::text, g.pitch_id, null::text,
           internal.minute_of(g.start_time), internal.minute_of(g.start_time),
           least(internal.minute_of(g.start_time) + coalesce(g.duration_minutes, pl.game_duration_minutes, 20), 1440),
           least(internal.minute_of(g.start_time) + coalesce(g.duration_minutes, pl.game_duration_minutes, 20), 1440),
           least(internal.minute_of(g.start_time) + coalesce(g.duration_minutes, pl.game_duration_minutes, 20)
                 + coalesce(pl.changeover_minutes, 0), 1440),
           fit.footprint, internal.tournament_game_area_m2(g.tournament_id, g.age_group), null::integer, true, null::text
    from public.tournament_games g
    join public.tournaments t on t.id = g.tournament_id and t.cancelled_at is null
    join public.club_pitches p on p.id = g.pitch_id and p.club_id = p_club_id
    left join public.tournament_plans pl on pl.id = g.plan_id
    cross join lateral internal.age_grade_pitch_fit(coalesce(t.rugby_code, 'union'), g.age_group, g.game_date) fit
    where g.game_date between p_from and p_until and g.status <> 'CANCELLED' and g.start_time is not null
      and (g.plan_id is null or pl.publication_state = 'PUBLISHED')
  ), events as (
    select 'EVENT'::text, e.id, null::uuid, e.name, null::uuid, d.day::date, coalesce(p.venue_id, e.venue_id),
           'PITCH'::text, cep.pitch_id, null::text,
           case when d.day::date = e.starts_on and e.start_time is not null then internal.minute_of(e.start_time) else 0 end,
           case when d.day::date = e.starts_on and e.start_time is not null then internal.minute_of(e.start_time) else 0 end,
           case when d.day::date = e.ends_on and e.end_time is not null and e.end_time <> '00:00'::time then internal.minute_of(e.end_time) else 1440 end,
           case when d.day::date = e.ends_on and e.end_time is not null and e.end_time <> '00:00'::time then internal.minute_of(e.end_time) else 1440 end,
           case when d.day::date = e.ends_on and e.end_time is not null and e.end_time <> '00:00'::time then internal.minute_of(e.end_time) else 1440 end,
           null::text, null::numeric, null::integer, true, null::text
    from public.club_events e
    join public.club_event_pitches cep on cep.event_id = e.id
    join public.club_pitches p on p.id = cep.pitch_id and p.club_id = p_club_id
    cross join lateral generate_series(greatest(e.starts_on, p_from), least(e.ends_on, p_until), interval '1 day') d(day)
    where e.club_id = p_club_id and e.status not in ('CANCELLED', 'POSTPONED')
      and e.starts_on <= p_until and e.ends_on >= p_from
  )
  select * from fixture_pitch
  union all select * from fixture_rooms
  union all select * from training
  union all select * from reservations
  union all select * from games
  union all select * from events;
$function$;
revoke all on function internal.arena_occupancy(uuid, date, date) from public, anon, authenticated;

-- =====================================================================================================
-- 5. ONE CONFLICT ENGINE
-- =====================================================================================================

-- A window in words: "from 10:30 to 12:40", or "all day".
create or replace function internal.arena_window(p_from integer, p_until integer)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when p_from <= 0 and p_until >= 1440 then 'all day'
              else format('from %s to %s', internal.clock(p_from), internal.clock(p_until)) end;
$function$;

-- EVERY CLASH ON A CLUB'S ESTATE, IN WORDS. conflict_key names the clash by what it is and who is in it,
-- so a writer can tell a clash it caused from one that was already there.
--   PITCH_RESERVED      an activity on a pitch reserved for a tournament (or two reservations disagreeing)
--   PITCH_EVENT         an activity on a pitch an event has explicitly reserved
--   PITCH_MARKING       two tournaments sharing a pitch marked out differently
--   PITCH_IN_USE        a fixture and a training session on one pitch at once
--   PITCH_FULL          more fixtures on a pitch at once than its layout or its size allows
--   PITCH_TOO_SMALL     a fixture on a pitch smaller than its grade needs
--   PITCH_INACTIVE      something still allocated to a pitch that has been switched off
--   ROOM_IN_USE         two activities in one changing room at once
--   ROOM_TURNAROUND     a room's next use starting inside its turnaround
--   ROOM_INACTIVE       something still allocated to a room that has been switched off
--   ROOM_SHARED         (a warning) both teams of one fixture in one room
create or replace function internal.arena_conflicts(p_club_id uuid, p_from date, p_until date)
returns table (conflict_key text, code text, severity text, day date, resource_type text, resource_id uuid,
               at_minute integer, activity_ids uuid[], activity_types text[], message text)
language sql
stable
security definer
set search_path to ''
as $function$
  with o as (
    select * from internal.arena_occupancy(p_club_id, p_from, p_until)
  ), pitches as (
    select p.id, p.display_name as name, p.active, coalesce(p.lane_count, 1) as lanes,
           case p.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                else greatest(1, least(4, round(coalesce(p.custom_length_m * p.custom_width_m, 7000) / 7000.0 * 4)::integer)) end as units
    from public.club_pitches p where p.club_id = p_club_id
  ), rooms as (
    select r.id, r.display_name as name, r.active from public.venue_changing_rooms r where r.club_id = p_club_id
  ), op as (
    select o.*, case o.footprint when 'quarter' then 1 when 'half' then 2 else 4 end as units
    from o where o.resource_type = 'PITCH'
  ), reserved as (
    -- A RESERVATION HOLDS ITS PITCH: a fixture, a session or an event on a pitch a tournament has reserved.
    select 'PITCH_RESERVED'::text as code, x.day, x.resource_id, greatest(x.occupied_from, t.occupied_from) as at_minute,
           array[x.activity_id, t.activity_id] as ids, array[x.activity_type, t.activity_type] as types,
           case when x.activity_type = 'EVENT'
                then format('%s is reserved for both %s (%s) and %s (%s).', p.name, t.label,
                            internal.arena_window(t.occupied_from, t.occupied_until), x.label,
                            internal.arena_window(x.occupied_from, x.occupied_until))
                else format('%s is reserved for %s %s, and %s needs it %s.', p.name, t.label,
                            internal.arena_window(t.occupied_from, t.occupied_until), x.label,
                            internal.arena_window(x.occupied_from, x.occupied_until)) end as message
    from op x
    join op t on t.activity_type = 'TOURNAMENT' and t.resource_id = x.resource_id and t.day = x.day
             and x.occupied_from < t.occupied_until and t.occupied_from < x.occupied_until
    join pitches p on p.id = x.resource_id
    where x.activity_type in ('FIXTURE', 'TRAINING', 'EVENT')
  ), event_held as (
    -- AN EVENT'S EXPLICIT RESERVATION HOLDS ITS PITCH against fixtures, sessions and other events.
    select 'PITCH_EVENT'::text, x.day, x.resource_id, greatest(x.occupied_from, e.occupied_from),
           array[x.activity_id, e.activity_id], array[x.activity_type, e.activity_type],
           case when x.activity_type = 'EVENT'
                then format('%s is reserved for both %s (%s) and %s (%s).', p.name, e.label,
                            internal.arena_window(e.occupied_from, e.occupied_until), x.label,
                            internal.arena_window(x.occupied_from, x.occupied_until))
                else format('%s is reserved for %s %s, and %s needs it %s.', p.name, e.label,
                            internal.arena_window(e.occupied_from, e.occupied_until), x.label,
                            internal.arena_window(x.occupied_from, x.occupied_until)) end
    from op x
    join op e on e.activity_type = 'EVENT' and e.resource_id = x.resource_id and e.day = x.day
             and x.occupied_from < e.occupied_until and e.occupied_from < x.occupied_until
             and (x.activity_type <> 'EVENT' or x.activity_id < e.activity_id)
    join pitches p on p.id = x.resource_id
    where x.activity_type in ('FIXTURE', 'TRAINING', 'EVENT')
  ), marking as (
    -- TWO TOURNAMENTS MAY SHARE A PITCH ONLY MARKED OUT ONE WAY: then their games share its areas (the
    -- tournament engine counts them together). Marked two ways at once is not a pitch anybody can lay out.
    select 'PITCH_MARKING'::text, a.day, a.resource_id, greatest(a.occupied_from, b.occupied_from),
           array[a.activity_id, b.activity_id], array['TOURNAMENT', 'TOURNAMENT']::text[],
           format('%s is reserved for %s, marked out for %s, and for %s, marked out for %s, %s. A pitch two tournaments share is marked out one way: mark it the same for both, or use another pitch or time.',
                  p.name, a.label, internal.count_word(a.areas) || case when a.areas = 1 then ' game' else ' games' end,
                  b.label, internal.count_word(b.areas) || case when b.areas = 1 then ' game' else ' games' end,
                  internal.arena_window(greatest(a.occupied_from, b.occupied_from), least(a.occupied_until, b.occupied_until)))
    from op a
    join op b on a.activity_type = 'TOURNAMENT' and b.activity_type = 'TOURNAMENT'
             and a.resource_id = b.resource_id and a.day = b.day and a.parent_id <> b.parent_id
             and a.activity_id < b.activity_id
             and a.occupied_from < b.occupied_until and b.occupied_from < a.occupied_until
             and a.areas <> b.areas
    join pitches p on p.id = a.resource_id
  ), in_use as (
    -- A FIXTURE HOLDS ITS PITCH AGAINST TRAINING, warm-up to clearing the pitch. Said by which part of the
    -- match needs the pitch, because "warm-up" is the part people forget.
    select 'PITCH_IN_USE'::text, f.day, f.resource_id, greatest(f.occupied_from, s.occupied_from),
           array[f.activity_id, s.activity_id], array['FIXTURE', 'TRAINING']::text[],
           case when s.occupied_until <= f.play_from
                  then format('%s''s warm-up needs %s from %s, and %s is on it until %s.', f.label, p.name,
                              internal.clock(f.occupied_from), s.label, internal.clock(s.occupied_until))
                when s.occupied_from >= f.play_until
                  then format('%s needs %s until %s to clear the pitch, and %s starts at %s.', f.label, p.name,
                              internal.clock(f.occupied_until), s.label, internal.clock(s.occupied_from))
                else format('%s has %s (%s) and %s (%s) at the same time.', p.name, f.label,
                            internal.arena_window(f.occupied_from, f.occupied_until), s.label,
                            internal.arena_window(s.occupied_from, s.occupied_until)) end
    from op f
    join op s on s.activity_type = 'TRAINING' and s.resource_id = f.resource_id and s.day = f.day
             and f.occupied_from < s.occupied_until and s.occupied_from < f.occupied_until
    join pitches p on p.id = f.resource_id
    where f.activity_type = 'FIXTURE'
  ), probe as (
    -- FIXTURES SHARING A PITCH: at every moment one of them claims it, how many are on it and how much of
    -- it they need, against the club's layout (lanes) and the pitch's size (quarter-pitch units).
    -- Each moment once, however many matches start at it (counting it per match counted two as four).
    select a.day, a.resource_id, a.occupied_from as at_minute,
           array_agg(b.activity_id order by b.occupied_from, b.activity_id) as ids,
           array_agg(b.label order by b.occupied_from, b.activity_id) as labels,
           array_agg(internal.clock(b.occupied_from) || '–' || internal.clock(b.occupied_until) order by b.occupied_from, b.activity_id) as windows,
           count(*) as n, sum(b.units) as used, max(b.units) as biggest
    from (select distinct x.day, x.resource_id, x.occupied_from from op x where x.activity_type = 'FIXTURE') a
    join op b on b.activity_type = 'FIXTURE' and b.resource_id = a.resource_id and b.day = a.day
             and b.occupied_from <= a.occupied_from and a.occupied_from < b.occupied_until
    group by a.day, a.resource_id, a.occupied_from
  ), full_rows as (
    select distinct on (pr.day, pr.resource_id, pr.ids)
           'PITCH_FULL'::text, pr.day, pr.resource_id, pr.at_minute, pr.ids,
           array_fill('FIXTURE'::text, array[cardinality(pr.ids)]),
           case when p.lanes <= 1
                  then format('%s takes one match at a time, and %s overlap: %s.', p.name,
                              internal.count_word(pr.n) || ' matches',
                              (select string_agg(l || ' (' || w || ')', ', ' order by ord)
                               from unnest(pr.labels, pr.windows) with ordinality u(l, w, ord)))
                when pr.n > p.lanes
                  then format('%s takes %s matches at a time, and %s overlap at %s.', p.name, internal.count_word(p.lanes),
                              internal.count_word(pr.n), internal.clock(pr.at_minute))
                else format('%s has no room for all of %s at %s: together they need more of the pitch than it has.', p.name,
                            array_to_string(pr.labels, ', '), internal.clock(pr.at_minute)) end
    from probe pr join pitches p on p.id = pr.resource_id
    where pr.n > 1 and (pr.n > p.lanes or pr.used > p.units)
    order by pr.day, pr.resource_id, pr.ids, pr.at_minute
  ), too_small as (
    select 'PITCH_TOO_SMALL'::text, x.day, x.resource_id, x.occupied_from, array[x.activity_id], array[x.activity_type],
           format('%s is too small for %s: it needs %s.', p.name, x.label,
                  case x.footprint when 'full' then 'a full-size pitch' when 'half' then 'at least half a full-size pitch'
                       else 'a quarter of a full-size pitch' end)
    from op x join pitches p on p.id = x.resource_id
    where x.activity_type = 'FIXTURE' and x.footprint is not null and x.units > p.units
  ), off_pitch as (
    select 'PITCH_INACTIVE'::text, x.day, x.resource_id, x.occupied_from, array[x.activity_id], array[x.activity_type],
           format('%s is switched off, but %s is still on it.', p.name, x.label)
    from op x join pitches p on p.id = x.resource_id
    where not p.active and x.day >= current_date and x.activity_type in ('FIXTURE', 'TRAINING', 'EVENT', 'TOURNAMENT')
  ), orr as (
    select o.* from o where o.resource_type = 'ROOM'
  ), room_pairs as (
    -- ONE ACTIVITY IN A ROOM AT A TIME, and time between to turn it round.
    select case when a.occupied_from < b.occupied_until and b.occupied_from < a.occupied_until
                then 'ROOM_IN_USE' else 'ROOM_TURNAROUND' end as code,
           a.day, a.resource_id, greatest(a.occupied_from, b.occupied_from) as at_minute,
           array[a.activity_id, b.activity_id] as ids, array[a.activity_type, b.activity_type] as types,
           a.label as a_label, a.room_role as a_role, a.occupied_from as a_from, a.occupied_until as a_until,
           a.turnaround_until as a_turn,
           b.label as b_label, b.room_role as b_role, b.occupied_from as b_from, b.occupied_until as b_until
    from orr a
    join orr b on b.resource_id = a.resource_id and b.day = a.day and a.activity_id <> b.activity_id
             and (a.occupied_from, a.activity_id) < (b.occupied_from, b.activity_id)
             and a.occupied_from < b.turnaround_until and b.occupied_from < a.turnaround_until
  ), room_rows as (
    select rp.code, rp.day, rp.resource_id, rp.at_minute, rp.ids, rp.types,
           case rp.code
             when 'ROOM_IN_USE' then format('%s is in use by %s (%s) %s, and %s (%s) needs it from %s.', r.name,
                    rp.a_label, lower(rp.a_role), internal.arena_window(rp.a_from, rp.a_until),
                    rp.b_label, lower(rp.b_role), internal.clock(rp.b_from))
             else format('%s needs %s minutes to turn round after %s (%s) leaves at %s, and %s (%s) needs it from %s.', r.name,
                    rp.a_turn - rp.a_until, rp.a_label, lower(rp.a_role), internal.clock(rp.a_until),
                    rp.b_label, lower(rp.b_role), internal.clock(rp.b_from)) end
    from room_pairs rp join rooms r on r.id = rp.resource_id
  ), room_off as (
    select 'ROOM_INACTIVE'::text, x.day, x.resource_id, x.occupied_from, array[x.activity_id], array[x.activity_type],
           format('%s is switched off, but %s (%s) is still in it.', r.name, x.label, lower(x.room_role))
    from orr x join rooms r on r.id = x.resource_id
    where not r.active and x.day >= current_date
  ), room_shared as (
    select 'ROOM_SHARED'::text, a.day, a.resource_id, a.occupied_from, array[a.activity_id], array['FIXTURE']::text[],
           format('%s has both teams in %s.', a.label, r.name)
    from orr a
    join orr b on b.activity_id = a.activity_id and b.resource_id = a.resource_id and a.room_role = 'HOME' and b.room_role = 'AWAY'
    join rooms r on r.id = a.resource_id
  ), everything as (
    select code, day, resource_id, at_minute, ids, types, message, 'PITCH'::text as rtype, 'hard'::text as severity from reserved
    union all select *, 'PITCH', 'hard' from event_held
    union all select *, 'PITCH', 'hard' from marking
    union all select *, 'PITCH', 'hard' from in_use
    union all select *, 'PITCH', 'hard' from full_rows
    union all select *, 'PITCH', 'hard' from too_small
    union all select *, 'PITCH', 'hard' from off_pitch
    union all select *, 'ROOM', 'hard' from room_rows
    union all select *, 'ROOM', 'hard' from room_off
    union all select *, 'ROOM', 'warning' from room_shared
  )
  select e.code || ':' || e.resource_id::text || ':' ||
         (select string_agg(x::text, ',' order by x::text) from unnest(e.ids) x) as conflict_key,
         e.code, e.severity, e.day, e.rtype, e.resource_id, e.at_minute, e.ids, e.types, e.message
  from everything e;
$function$;
revoke all on function internal.arena_conflicts(uuid, date, date) from public, anon, authenticated;

-- THE HARD CLASHES ON THESE DAYS, by key -- what a writer remembers before it changes anything.
create or replace function internal.arena_conflict_keys(p_club_id uuid, p_days date[])
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(array_agg(c.conflict_key), '{}'::text[])
  from unnest(coalesce(p_days, '{}'::date[])) d(day)
  cross join lateral internal.arena_conflicts(p_club_id, d.day, d.day) c
  where d.day is not null and p_club_id is not null and c.severity = 'hard';
$function$;
revoke all on function internal.arena_conflict_keys(uuid, date[]) from public, anon, authenticated;

-- REFUSE A CLASH THIS CHANGE CAUSED, in the engine's own words. A clash that was already there, or one
-- among other activities, is left for Arena to show -- an unrelated edit is never blocked by it.
create or replace function internal.refuse_new_arena_conflicts(p_club_id uuid, p_days date[], p_before text[], p_subjects uuid[])
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_message text;
begin
  if p_club_id is null then return; end if;
  select c.message into v_message
  from unnest(coalesce(p_days, '{}'::date[])) d(day)
  cross join lateral internal.arena_conflicts(p_club_id, d.day, d.day) c
  where d.day is not null and c.severity = 'hard'
    and c.activity_ids && coalesce(p_subjects, '{}'::uuid[])
    and not (c.conflict_key = any (coalesce(p_before, '{}'::text[])))
  order by c.at_minute, c.code
  limit 1;
  if v_message is not null then
    raise exception '%', v_message using errcode = '22023', hint = 'ARENA_FACILITY_IN_USE';
  end if;
end;
$function$;
revoke all on function internal.refuse_new_arena_conflicts(uuid, date[], text[], uuid[]) from public, anon, authenticated;

-- The club whose estate a fixture uses: its home side's, when that club is on Ovalball.
create or replace function internal.fixture_estate_club(p_fixture_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select t.club_id from public.fixtures f join public.teams t on t.id = f.home_team_id where f.id = p_fixture_id;
$function$;
revoke all on function internal.fixture_estate_club(uuid) from public, anon, authenticated;

-- =====================================================================================================
-- 7. EVERY WRITER THAT PLACES AN ACTIVITY ON A RESOURCE ASKS THE ENGINE
-- =====================================================================================================
-- Each is the live definition with only the estate check (and, on fixtures, the officials room and who
-- made the allocation) added. update_fixture_schedule also moves a match between two of the host's grounds
-- in one statement, letting go of rooms that are not at the new ground: two separate updates refused it.

-- public.set_fixture_facilities
CREATE OR REPLACE FUNCTION public.set_fixture_facilities(p_fixture_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  f public.fixtures;
  h record;
  v_venue uuid; v_venue_text text; v_pitch uuid; v_pitch_text text;
  v_home_room uuid; v_away_room uuid; v_home_no smallint; v_away_no smallint; v_none boolean;
  v_officials_room uuid;
  v_club uuid; v_days date[]; v_before text[]; v_officials_changed boolean;
  v_notes text; v_catering boolean;
  v_cleared text[] := '{}';
  v_where_changed boolean; v_rooms_changed boolean;
  v_ground text; v_pitch_label text; v_body text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found or not internal.can_edit_fixture_schedule(p_fixture_id) then
    raise exception 'You are not authorised to arrange this fixture.' using errcode = '42501';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    raise exception 'This fixture has been cancelled.' using errcode = '22023';
  end if;
  select * into h from internal.fixture_host(p_fixture_id);
  if h.mode = 'UNDECIDED' and (p_patch ?| array['venue_id','venue_text','pitch_id','pitch_text','home_room_id','away_room_id',
                                                 'home_room_number','away_room_number','no_changing_rooms','officials_room_id']) then
    raise exception 'Agree home or away first: the ground is the home side''s.' using errcode = '22023';
  end if;

  v_venue := case when p_patch ? 'venue_id' then nullif(p_patch->>'venue_id', '')::uuid else f.venue_id end;
  v_venue_text := case when p_patch ? 'venue_text' then nullif(btrim(coalesce(p_patch->>'venue_text', '')), '') else f.venue_address end;
  v_pitch := case when p_patch ? 'pitch_id' then nullif(p_patch->>'pitch_id', '')::uuid else f.pitch_id end;
  v_pitch_text := case when p_patch ? 'pitch_text' then nullif(btrim(coalesce(p_patch->>'pitch_text', '')), '') else f.pitch_allocation end;
  v_home_room := case when p_patch ? 'home_room_id' then nullif(p_patch->>'home_room_id', '')::uuid else f.home_changing_room_id end;
  v_away_room := case when p_patch ? 'away_room_id' then nullif(p_patch->>'away_room_id', '')::uuid else f.away_changing_room_id end;
  v_officials_room := case when p_patch ? 'officials_room_id' then nullif(p_patch->>'officials_room_id', '')::uuid else f.officials_changing_room_id end;
  v_home_no := case when p_patch ? 'home_room_number' then nullif(p_patch->>'home_room_number', '')::smallint else f.home_changing_room_number end;
  v_away_no := case when p_patch ? 'away_room_number' then nullif(p_patch->>'away_room_number', '')::smallint else f.away_changing_room_number end;
  v_none := case when p_patch ? 'no_changing_rooms' then coalesce((p_patch->>'no_changing_rooms')::boolean, false) else f.no_changing_rooms end;
  v_notes := case when p_patch ? 'changing_room_notes' then nullif(btrim(coalesce(p_patch->>'changing_room_notes', '')), '') else f.changing_room end;
  v_catering := case when p_patch ? 'catering_required' then coalesce((p_patch->>'catering_required')::boolean, false) else f.catering_required end;

  if v_venue_text is not null and length(v_venue_text) > 200 then
    raise exception 'Keep the ground under 200 characters.' using errcode = '22023';
  end if;
  if v_pitch_text is not null and length(v_pitch_text) > 80 then
    raise exception 'Keep the pitch name under 80 characters.' using errcode = '22023';
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Keep the arrival notes under 500 characters.' using errcode = '22023';
  end if;
  if (v_home_no is not null and v_home_no not between 1 and 20) or (v_away_no is not null and v_away_no not between 1 and 20) then
    raise exception 'Choose a changing room from 1 to 20.' using errcode = '22023';
  end if;

  if h.mode = 'CANONICAL' then
    -- The host's records, referenced. A typed ground or numbered room has no place beside them.
    if v_venue is not null then v_venue_text := null; end if;
    if p_patch ? 'pitch_text' and not (p_patch ? 'pitch_id') and v_pitch_text is not null then
      raise exception 'Choose one of the host club''s pitches.' using errcode = '22023';
    end if;
    if p_patch ? 'home_room_number' and v_home_no is not null or p_patch ? 'away_room_number' and v_away_no is not null then
      raise exception 'Choose one of the host club''s changing rooms.' using errcode = '22023';
    end if;
    v_home_no := null; v_away_no := null;
    -- A pitch or room that no longer fits the ground is cleared, and said so.
    if v_pitch is not null and v_venue is not null
       and exists (select 1 from public.club_pitches p where p.id = v_pitch and p.venue_id is not null and p.venue_id <> v_venue)
       and not (p_patch ? 'pitch_id') then
      v_pitch := null; v_cleared := array_append(v_cleared, 'pitch');
    end if;
    if v_home_room is not null and not (p_patch ? 'home_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_home_room and r.venue_id = v_venue) then
      v_home_room := null; v_cleared := array_append(v_cleared, 'home_room');
    end if;
    if v_away_room is not null and not (p_patch ? 'away_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_away_room and r.venue_id = v_venue) then
      v_away_room := null; v_cleared := array_append(v_cleared, 'away_room');
    end if;
    if v_officials_room is not null and not (p_patch ? 'officials_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_officials_room and r.venue_id = v_venue) then
      v_officials_room := null; v_cleared := array_append(v_cleared, 'officials_room');
    end if;
    v_pitch_text := case when v_pitch is not null then (select p.display_name from public.club_pitches p where p.id = v_pitch) end;
  elsif h.mode = 'PROVISIONAL' then
    if v_venue is not null or v_pitch is not null or v_home_room is not null or v_away_room is not null or v_officials_room is not null then
      if p_patch ?| array['venue_id','pitch_id','home_room_id','away_room_id','officials_room_id']
         and (nullif(p_patch->>'venue_id','') is not null or nullif(p_patch->>'pitch_id','') is not null
              or nullif(p_patch->>'home_room_id','') is not null or nullif(p_patch->>'away_room_id','') is not null
              or nullif(p_patch->>'officials_room_id','') is not null) then
        raise exception 'The host club is not on Ovalball, so its ground, pitch and rooms are written for this match.' using errcode = '22023';
      end if;
      v_venue := null; v_pitch := null; v_home_room := null; v_away_room := null; v_officials_room := null;
    end if;
  end if;

  if v_none then
    v_home_room := null; v_away_room := null; v_home_no := null; v_away_no := null; v_officials_room := null;
  end if;

  -- WHERE THE MATCH IS, by what the record references. A ground or pitch held as an id is compared as the
  -- id: its name is only a cached copy (create_fixture stores a pitch without one), so a rooms-only save is
  -- never announced to families as a new location. Typed text is compared only where it is the record.
  v_where_changed := v_venue is distinct from f.venue_id or v_pitch is distinct from f.pitch_id
                  or (v_venue is null and v_venue_text is distinct from f.venue_address)
                  or (v_pitch is null and v_pitch_text is distinct from f.pitch_allocation);
  v_rooms_changed := v_home_room is distinct from f.home_changing_room_id or v_away_room is distinct from f.away_changing_room_id
                  or v_home_no is distinct from f.home_changing_room_number or v_away_no is distinct from f.away_changing_room_number
                  or v_none is distinct from f.no_changing_rooms;

  v_officials_changed := v_officials_room is distinct from f.officials_changing_room_id;
  -- WHAT THE ESTATE LOOKED LIKE BEFORE, so a clash this change causes can be told from one already there.
  v_club := case when h.mode = 'CANONICAL' then h.host_club_id end;
  v_days := array[f.kickoff_date];
  if v_club is not null and (v_where_changed or v_rooms_changed or v_officials_changed) then
    v_before := internal.arena_conflict_keys(v_club, v_days);
  end if;

  update public.fixtures
     set venue_id = v_venue, venue_address = v_venue_text,
         pitch_id = v_pitch, pitch_allocation = v_pitch_text,
         home_changing_room_id = v_home_room, away_changing_room_id = v_away_room,
         home_changing_room_number = v_home_no, away_changing_room_number = v_away_no,
         no_changing_rooms = v_none,
         officials_changing_room_id = v_officials_room,
         allocation_auto = internal.allocation_auto_after(allocation_auto, array_remove(array[
                             case when v_pitch is distinct from f.pitch_id or v_venue is distinct from f.venue_id then 'pitch' end,
                             case when v_home_room is distinct from f.home_changing_room_id then 'home_room' end,
                             case when v_away_room is distinct from f.away_changing_room_id then 'away_room' end,
                             case when v_officials_room is distinct from f.officials_changing_room_id then 'officials_room' end], null)),
         changing_room = v_notes, catering_required = v_catering,
         updated_by = auth.uid(), updated_at = now()
   where id = any (internal.fixture_pair_ids(p_fixture_id));

  if v_club is not null and (v_where_changed or v_rooms_changed or v_officials_changed) then
    perform internal.refuse_new_arena_conflicts(v_club, v_days, v_before, internal.fixture_pair_ids(p_fixture_id));
  end if;

  if f.kickoff_date >= current_date and auth.uid() is not null then
    v_ground := coalesce((select v.name from public.venues v where v.id = v_venue), v_venue_text);
    v_pitch_label := v_pitch_text;
    if v_where_changed then
      -- ALWAYS THE WHOLE LOCATION. A home-or-away switch has already moved the match to the new host's
      -- ground before this save chooses the pitch, so "the pitch has been set" alone would leave a family
      -- driving to the old ground.
      v_body := case
        when v_pitch_label is null and v_pitch is distinct from f.pitch_id and v_ground is not null
             and v_venue is not distinct from f.venue_id and v_venue_text is not distinct from f.venue_address then
          'The pitch for your fixture has been removed. It is still at ' || v_ground || '.'
        else 'Your fixture is now at ' || coalesce(v_ground, 'a ground still to be confirmed')
               || coalesce(', ' || v_pitch_label, '') || '.' end;
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Where the match is', v_body);
    elsif v_rooms_changed and internal.fixture_attendance_is_open(f.id) then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct r.user_id, 'fixture_arrangements_changed',
             case when v_none then 'No changing rooms' else 'Changing rooms allocated' end,
             coalesce(internal.fixture_notice_label(p_fixture_id), 'Your match') || ': '
               || case when v_none then 'there are no changing rooms at the ground for this match. Come changed.'
                       else 'the changing rooms have been set. See Arena Details.' end,
             jsonb_build_object('fixture_id', p_fixture_id)
        from internal.fixture_family_recipients(p_fixture_id) r
       where r.user_id is not null and r.user_id is distinct from auth.uid();
    end if;
  end if;

  return jsonb_build_object('mode', h.mode, 'cleared', to_jsonb(v_cleared));
end;
$function$;


-- public.update_fixture_schedule
CREATE OR REPLACE FUNCTION public.update_fixture_schedule(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS TABLE(applied_kickoff_date date, applied_kickoff_time time without time zone, applied_venue_id uuid, applied_pitch_id uuid, kickoff_proposed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_final public.fixtures;
  v_home_club_id uuid;
  v_caller_club_id uuid;
  v_is_external boolean;
  v_old_pitch_text text;
  v_new_pitch_text text;
  v_venue_changing boolean;
  v_pitch_changing boolean;
  v_kickoff_changing boolean;
  v_new_status text;
  v_club uuid;
  v_days date[];
  v_before text[];
  v_guard boolean;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  v_venue_changing := p_venue_id is distinct from f.venue_id;
  v_pitch_changing := (p_pitch_id is distinct from f.pitch_id)
    or (p_pitch_id is null and coalesce(nullif(trim(p_pitch_text), ''), '') is distinct from coalesce(f.pitch_allocation, ''));
  v_kickoff_changing := (p_kickoff_date is distinct from f.kickoff_date)
    or (p_kickoff_time is distinct from f.kickoff_time)
    or f.kickoff_amendment_proposed_date is not null;

  -- A CHANGE THAT PUTS THE MATCH ON A PITCH, OR MOVES IT THERE ON THE BOARD, must not cause a clash on the
  -- estate. A kick-off moved anywhere else -- or agreed by the other club -- is not refused: Arena shows it.
  v_club := internal.fixture_estate_club(p_fixture_id);
  v_guard := v_club is not null and (v_pitch_changing or v_venue_changing
             or (v_kickoff_changing and coalesce(p_source, '') in ('PITCH_ALLOCATION', 'ARENA')));
  v_days := array_remove(array[f.kickoff_date, p_kickoff_date], null);
  if v_guard then
    v_before := internal.arena_conflict_keys(v_club, v_days);
  end if;

  -- ===== VENUE =====
  if v_venue_changing then
    if p_venue_id is not null then
      if f.home_team_id is null then
        raise exception 'A venue can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_home_club_id and v.active) then
        raise exception 'That venue does not belong to this fixture''s home club, or is archived.';
      end if;
    end if;
    update public.fixtures
       set venue_id = p_venue_id,
           pitch_id = case when v_pitch_changing then p_pitch_id else pitch_id end,
           home_changing_room_id = case when home_changing_room_id is not null and not exists (
               select 1 from public.venue_changing_rooms r where r.id = home_changing_room_id and r.venue_id = p_venue_id)
             then null else home_changing_room_id end,
           away_changing_room_id = case when away_changing_room_id is not null and not exists (
               select 1 from public.venue_changing_rooms r where r.id = away_changing_room_id and r.venue_id = p_venue_id)
             then null else away_changing_room_id end,
           officials_changing_room_id = case when officials_changing_room_id is not null and not exists (
               select 1 from public.venue_changing_rooms r where r.id = officials_changing_room_id and r.venue_id = p_venue_id)
             then null else officials_changing_room_id end
     where id = any (internal.fixture_pair_ids(p_fixture_id));
  end if;

  -- ===== PITCH =====
  if v_pitch_changing then
    if p_pitch_id is not null then
      if f.home_team_id is null then
        raise exception 'A named pitch can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
        raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
      end if;
      select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
    else
      v_new_pitch_text := nullif(trim(p_pitch_text), '');
    end if;
    v_old_pitch_text := f.pitch_allocation;

    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
             allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
             allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = f.mirror_fixture_id;
    end if;

    if coalesce(v_old_pitch_text, '') <> coalesce(v_new_pitch_text, '') or f.pitch_id is distinct from p_pitch_id then
      if f.opponent_team_id is not null then
        perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
          case when v_new_pitch_text is null then 'Pitch allocation removed.'
               else format('Pitch allocated: %s', v_new_pitch_text) end);
      end if;
      -- Told whether or not the opposition is on Ovalball.
      if auth.uid() is not null then
        perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
          case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
               else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
      end if;
    end if;
  end if;

  -- ===== KICKOFF (unchanged verbatim -- already either-side-aware) =====
  if v_kickoff_changing then
    if p_kickoff_date is null then
      raise exception 'A kick-off date is required.';
    end if;
    if f.status = 'Cancelled' then
      raise exception 'This fixture is cancelled -- its kick-off cannot be changed.';
    end if;

    v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
    v_is_external := f.opponent_team_id is null
      or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

    if f.kickoff_date = p_kickoff_date and f.kickoff_time is not distinct from p_kickoff_time and f.kickoff_amendment_proposed_date is null then
      null;
    elsif v_is_external or internal.has_site_capability('site.fixtures.support') then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
            kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
            kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      if f.opponent_team_id is not null then
        perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off changed: %s %s -> %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      end if;
      -- NO OPPONENT TO AGREE WITH IS NOT NOBODY TO TELL: the side's staff and families hear of it.
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off changed',
        format('Your fixture now kicks off %s.', internal.kickoff_phrase(p_kickoff_date, p_kickoff_time)));
    elsif f.kickoff_amendment_proposed_date is null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
            kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change proposed: %s %s -> %s %s. Awaiting the other club''s agreement.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off change proposed',
        format('A change to %s %s has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    elsif v_caller_club_id = f.kickoff_amendment_proposed_by_club_id then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
    elsif p_kickoff_date = f.kickoff_amendment_proposed_date and p_kickoff_time is not distinct from f.kickoff_amendment_proposed_time then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
            kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
            kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off confirmed: %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off confirmed',
        format('The kick-off for your fixture is now %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    else
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
            kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off counter-proposed: %s %s (was proposing %s %s).', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)'), f.kickoff_amendment_proposed_date, coalesce(f.kickoff_amendment_proposed_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off counter-proposed',
        format('A different kick-off (%s %s) has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    end if;
  end if;

  if v_guard then
    perform internal.refuse_new_arena_conflicts(v_club, v_days, v_before, internal.fixture_pair_ids(p_fixture_id));
  end if;

  select * into v_final from public.fixtures where id = p_fixture_id;

  -- ===== STATUS LIFECYCLE (Sections 11/12/16) =====
  if v_final.status in ('Planned', 'Booked', 'To Be Determined') then
    if v_final.pitch_id is not null and v_final.kickoff_time is not null then
      v_new_status := 'Booked';
    elsif v_final.status = 'Booked' then
      -- Was Booked, but its pitch (or kickoff time) is no longer set --
      -- no longer satisfies this product's definition of "booked", so it
      -- must not stay falsely Booked. home_away = 'TBD' is this schema's
      -- own existing marker for a genuinely undetermined side; anything
      -- else reverts to the ordinary "scheduled, no pitch yet" state.
      v_new_status := case when v_final.home_away = 'TBD' then 'To Be Determined' else 'Planned' end;
    else
      v_new_status := v_final.status;
    end if;

    if v_new_status is distinct from v_final.status then
      update public.fixtures set status = v_new_status where id = p_fixture_id;
      if v_final.mirror_fixture_id is not null then
        update public.fixtures set status = v_new_status where id = v_final.mirror_fixture_id;
      end if;
      v_final.status := v_new_status;
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values (
    'fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', f.venue_id, 'pitch_id', f.pitch_id, 'pitch_allocation', f.pitch_allocation, 'kickoff_date', f.kickoff_date, 'kickoff_time', f.kickoff_time, 'status', f.status),
    jsonb_build_object('source', p_source, 'venue_id', p_venue_id, 'pitch_id', p_pitch_id, 'kickoff_date', p_kickoff_date, 'kickoff_time', p_kickoff_time, 'status', v_final.status)
  );

  return query select v_final.kickoff_date, v_final.kickoff_time, v_final.venue_id, v_final.pitch_id, v_final.kickoff_amendment_proposed_date is not null;
end;
$function$;


-- public.update_fixture_pitch
CREATE OR REPLACE FUNCTION public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
  v_club uuid;
  v_before text[];
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;
  v_club := internal.fixture_estate_club(p_fixture_id);
  if v_club is not null and p_pitch_id is distinct from f.pitch_id then
    v_before := internal.arena_conflict_keys(v_club, array[f.kickoff_date]);
  end if;

  if p_pitch_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;

    -- STEP 6: and it has to be a pitch at the ground the fixture is actually being played at.
    select cp.venue_id into v_pitch_venue_id from public.club_pitches cp where cp.id = p_pitch_id;
    if f.venue_id is not null and v_pitch_venue_id is distinct from f.venue_id then
      raise exception 'The selected pitch does not belong to the selected venue. Choose a pitch at this fixture''s ground, or change the fixture''s venue first.'
        using errcode = '23514';
    end if;

    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
           allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
           allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = f.mirror_fixture_id;
  end if;

  if v_club is not null and p_pitch_id is distinct from f.pitch_id then
    perform internal.refuse_new_arena_conflicts(v_club, array[f.kickoff_date], v_before, internal.fixture_pair_ids(p_fixture_id));
  end if;

  if coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id then
    if f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
        case when v_new_pitch_text is null then 'Pitch allocation removed.'
             else format('Pitch allocated: %s', v_new_pitch_text) end);
    end if;
    -- Told whether or not the opposition is on Ovalball.
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$function$;


-- public.create_training_session
CREATE OR REPLACE FUNCTION public.create_training_session(p_club_id uuid, p_team_id uuid, p_scheduling_group_id uuid, p_session_date date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_pitch_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_duration_minutes integer;
  v_venue_id uuid;
  v_before text[];
begin
  if not internal.can_manage_training(p_club_id, p_team_id) then
    raise exception 'Not authorized to schedule training for this club.' using errcode = '42501';
  end if;
  if num_nonnulls(p_team_id, p_scheduling_group_id) <> 1 then
    raise exception 'Training must belong to exactly one team or one shared mini-rugby group, never both.';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id) then
    raise exception 'That team does not belong to this club.';
  end if;
  if p_scheduling_group_id is not null and not exists (select 1 from public.scheduling_groups where id = p_scheduling_group_id and club_id = p_club_id and active) then
    raise exception 'That shared mini-rugby group does not belong to this club, or is not active.';
  end if;
  if p_pitch_id is not null and not exists (select 1 from public.club_pitches where id = p_pitch_id and club_id = p_club_id and active) then
    raise exception 'That pitch does not belong to this club, or is archived.';
  end if;

  -- Section 31: manual training still needs a real venue. An explicit
  -- p_venue_id wins; otherwise fall back to the chosen pitch's own venue
  -- (matching how public.fixtures already resolves venue_id/pitch venue --
  -- Section 9/10's "no free-text venue" without forcing every existing
  -- manual-scheduling caller to start passing one explicitly).
  if p_venue_id is not null then
    if p_pitch_id is not null and not exists (select 1 from public.club_pitches where id = p_pitch_id and venue_id = p_venue_id) then
      raise exception 'The selected pitch does not belong to the selected venue.';
    end if;
    v_venue_id := p_venue_id;
  elsif p_pitch_id is not null then
    select venue_id into v_venue_id from public.club_pitches where id = p_pitch_id;
  end if;

  if p_start_time is not null and p_end_time is not null then
    v_duration_minutes := round(extract(epoch from (p_end_time - p_start_time)) / 60)::integer;
  end if;

  if p_pitch_id is not null and p_start_time is not null then
    v_before := internal.arena_conflict_keys(p_club_id, array[p_session_date]);
  end if;

  insert into public.training_sessions (
    club_id, team_id, scheduling_group_id, session_date, occurrence_date, start_time, end_time, pitch_id, venue_id,
    duration_minutes, source, status, notes, created_by, updated_by
  )
  values (
    p_club_id, p_team_id, p_scheduling_group_id, p_session_date, p_session_date, p_start_time, p_end_time, p_pitch_id, v_venue_id,
    v_duration_minutes, 'MANUAL', 'PLANNED', nullif(trim(p_notes), ''), auth.uid(), auth.uid()
  )
  returning id into v_id;

  if p_pitch_id is not null and p_start_time is not null then
    update public.training_sessions set allocation_source = 'MANUAL' where id = v_id;
    perform internal.refuse_new_arena_conflicts(p_club_id, array[p_session_date], v_before, array[v_id]);
  end if;

  return v_id;
end;
$function$;


-- public.override_training_session
CREATE OR REPLACE FUNCTION public.override_training_session(p_session_id uuid, p_session_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_duration_minutes integer DEFAULT NULL::integer, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_cancel boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_agenda text DEFAULT NULL::text, p_further_notes text DEFAULT NULL::text, p_warm_up_minutes integer DEFAULT NULL::integer, p_pack_up_minutes integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_further_notes text;
  v_changed boolean := false;
  v_schedule_changed boolean := false;
  v_team_label text;
  v_before text[];
  v_days date[];
  v_guarded boolean;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.can_manage_club_training(s.club_id) then
    raise exception 'You are not authorized to change this Training Session.' using errcode = '42501';
  end if;
  if p_cancel then
    perform public.cancel_training_session(p_session_id, p_reason);
    return;
  end if;

  if p_venue_id is not null and p_pitch_id is not null and not exists (
    select 1 from public.club_pitches where id = p_pitch_id and club_id = s.club_id and venue_id = p_venue_id
  ) then
    raise exception 'The selected pitch does not belong to the selected venue.';
  end if;
  if p_agenda is not null and char_length(trim(p_agenda)) = 0 then
    raise exception 'Agenda cannot be blank.';
  end if;
  if p_agenda is not null and char_length(p_agenda) > 4000 then
    raise exception 'Agenda is too long.';
  end if;
  v_further_notes := case when p_further_notes is not null then nullif(trim(p_further_notes), '') else null end;
  if p_further_notes is not null and char_length(p_further_notes) > 2000 then
    raise exception 'Further notes are too long.';
  end if;
  if p_warm_up_minutes is not null and (p_warm_up_minutes < 0 or p_warm_up_minutes > 60 or p_warm_up_minutes % 5 <> 0) then
    raise exception 'Warm up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if p_pack_up_minutes is not null and (p_pack_up_minutes < 0 or p_pack_up_minutes > 60 or p_pack_up_minutes % 5 <> 0) then
    raise exception 'Cool down / pack up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;

  v_schedule_changed := (p_session_date is not null and p_session_date is distinct from s.session_date)
    or (p_start_time is not null and p_start_time is distinct from s.start_time)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from s.duration_minutes)
    or (p_venue_id is not null and p_venue_id is distinct from s.venue_id)
    or (p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id)
    or (p_warm_up_minutes is not null and p_warm_up_minutes is distinct from s.warm_up_minutes)
    or (p_pack_up_minutes is not null and p_pack_up_minutes is distinct from s.pack_up_minutes);

  if v_schedule_changed and s.occurrence_date is not null and s.occurrence_date < current_date then
    raise exception 'A completed training session''s schedule cannot be changed -- only its agenda and notes can still be recorded.' using errcode = '42501';
  end if;

  -- A SESSION MOVED ON TO, OR ON, A PITCH must not cause a clash on the estate.
  v_guarded := v_schedule_changed and coalesce(p_pitch_id, s.pitch_id) is not null;
  v_days := array_remove(array[s.occurrence_date, p_session_date], null);
  if v_guarded then
    v_before := internal.arena_conflict_keys(s.club_id, v_days);
  end if;

  v_changed := v_schedule_changed
    or (p_agenda is not null and trim(p_agenda) is distinct from s.agenda)
    or (p_further_notes is not null and v_further_notes is distinct from s.further_notes);

  update public.training_sessions set
    session_date = coalesce(p_session_date, session_date),
    occurrence_date = coalesce(p_session_date, occurrence_date),
    start_time = coalesce(p_start_time, start_time),
    duration_minutes = coalesce(p_duration_minutes, duration_minutes),
    end_time = case when p_start_time is not null or p_duration_minutes is not null
      then (coalesce(p_start_time, start_time) + make_interval(mins => coalesce(p_duration_minutes, duration_minutes)))::time
      else end_time end,
    venue_id = coalesce(p_venue_id, venue_id),
    pitch_id = coalesce(p_pitch_id, pitch_id),
    allocation_source = case when p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id
                             then coalesce(nullif(current_setting('ovalball.allocation_source', true), ''), 'MANUAL')
                             else allocation_source end,
    agenda = coalesce(nullif(trim(p_agenda), ''), agenda),
    further_notes = case when p_further_notes is not null then v_further_notes else further_notes end,
    warm_up_minutes = coalesce(p_warm_up_minutes, warm_up_minutes),
    pack_up_minutes = coalesce(p_pack_up_minutes, pack_up_minutes),
    is_overridden = true,
    updated_by = auth.uid()
  where id = p_session_id;

  if v_guarded then
    perform internal.refuse_new_arena_conflicts(s.club_id, v_days, v_before, array[p_session_id]);
  end if;

  if v_changed then
    select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = s.team_id;
    perform internal.notify_training_participants(
      p_session_id, 'training_session_updated', 'Training updated',
      format('%s training on %s has been updated.', v_team_label, to_char(coalesce(p_session_date, s.session_date), 'DD Mon'))
    );
  end if;
end;
$function$;


-- public.reserve_tournament_pitch
CREATE OR REPLACE FUNCTION public.reserve_tournament_pitch(p_tournament_id uuid, p_pitch_id uuid, p_reserved_on date, p_start_time time without time zone, p_end_time time without time zone, p_playing_areas integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_before text[]; v_club uuid; v_estate text[];
begin
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to reserve pitches for this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  if p_playing_areas is not null and (p_playing_areas < 1 or p_playing_areas > 4) then
    raise exception 'A pitch is marked out for 1, 2, 3 or 4 games at once.' using errcode = '22023';
  end if;
  v_before := internal.pitch_day_clashes(p_tournament_id, p_pitch_id, p_reserved_on);
  -- AND AGAINST EVERYTHING ELSE ON THE ESTATE: fixtures, training, events and other tournaments.
  select t.host_club_id into v_club from public.tournaments t where t.id = p_tournament_id;
  v_estate := internal.arena_conflict_keys(v_club, array[p_reserved_on]);
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, playing_areas, created_by)
  values (p_tournament_id, p_pitch_id, p_reserved_on, p_start_time, p_end_time, p_playing_areas, auth.uid())
  on conflict (tournament_id, pitch_id, reserved_on, start_time)
    do update set end_time = excluded.end_time,
                  playing_areas = coalesce(excluded.playing_areas, public.tournament_pitches.playing_areas)
  returning id into v_id;
  perform internal.refuse_stranded_tournament_games(p_tournament_id, p_pitch_id, p_reserved_on);
  perform internal.refuse_new_pitch_clashes(p_tournament_id, p_pitch_id, p_reserved_on, v_before);
  perform internal.refuse_new_arena_conflicts(v_club, array[p_reserved_on], v_estate, array[v_id]);
  return v_id;
end;
$function$;


-- public.set_tournament_pitch_areas
CREATE OR REPLACE FUNCTION public.set_tournament_pitch_areas(p_reservation_id uuid, p_playing_areas integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r public.tournament_pitches; v_before text[]; v_club uuid; v_estate text[];
begin
  perform internal.require_live_session();
  select * into v_r from public.tournament_pitches where id = p_reservation_id;
  if v_r.id is null then raise exception 'That reservation does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_r.tournament_id) then
    raise exception 'You do not have permission to change this tournament''s pitches.' using errcode = '42501';
  end if;
  if p_playing_areas is not null and (p_playing_areas < 1 or p_playing_areas > 4) then
    raise exception 'A pitch is marked out for 1, 2, 3 or 4 games at once.' using errcode = '22023';
  end if;
  v_before := internal.pitch_day_clashes(v_r.tournament_id, v_r.pitch_id, v_r.reserved_on);
  select t.host_club_id into v_club from public.tournaments t where t.id = v_r.tournament_id;
  v_estate := internal.arena_conflict_keys(v_club, array[v_r.reserved_on]);
  update public.tournament_pitches set playing_areas = p_playing_areas where id = p_reservation_id;
  perform internal.refuse_new_pitch_clashes(v_r.tournament_id, v_r.pitch_id, v_r.reserved_on, v_before);
  perform internal.refuse_new_arena_conflicts(v_club, array[v_r.reserved_on], v_estate, array[p_reservation_id]);
end;
$function$;


-- public.save_club_event
CREATE OR REPLACE FUNCTION public.save_club_event(p_club_id uuid, p_name text, p_starts_on date, p_ends_on date, p_event_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_is_club_wide boolean DEFAULT false, p_team_ids uuid[] DEFAULT '{}'::uuid[], p_pitch_ids uuid[] DEFAULT '{}'::uuid[], p_venue_id uuid DEFAULT NULL::uuid, p_external_location_name text DEFAULT NULL::text, p_external_address_line_1 text DEFAULT NULL::text, p_external_address_line_2 text DEFAULT NULL::text, p_external_town text DEFAULT NULL::text, p_external_county text DEFAULT NULL::text, p_external_postcode text DEFAULT NULL::text, p_external_country text DEFAULT NULL::text, p_external_latitude numeric DEFAULT NULL::numeric, p_external_longitude numeric DEFAULT NULL::numeric, p_external_address_provider_ref text DEFAULT NULL::text, p_season_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id uuid := p_event_id;
  v_arena_days date[];
  v_arena_before text[];
  v_name text := btrim(coalesce(p_name, ''));
  v_season_id uuid := p_season_id;
  v_bad uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- AUTHORITY.
  --
  -- Creating is club-scoped, or team-scoped when the event is confined to a
  -- team the caller manages. Editing re-checks against the event as it stands
  -- AND against the team set being written, so an event cannot be widened out
  -- of the caller's own authority by the same call that edits it.
  if v_event_id is null then
    if not (
      internal.has_site_capability('site.support.act_in_club')
      or internal.can('calendar.event.manage', 'club', p_club_id, null, null)
      or (
        not coalesce(p_is_club_wide, false)
        and array_length(p_team_ids, 1) is not null
        and not exists (
          select 1 from unnest(p_team_ids) t(id)
          where not internal.can('calendar.event.manage', 'team', p_club_id, t.id, null)
        )
      )
    ) then
      raise exception 'You do not have permission to create events for this club.' using errcode = '42501';
    end if;
  else
    if not internal.can_manage_club_event(v_event_id) then
      raise exception 'You do not have permission to manage this event.' using errcode = '42501';
    end if;
    -- The edit must also be within authority for the teams it will now name.
    if not (
      internal.has_site_capability('site.support.act_in_club')
      or internal.can('calendar.event.manage', 'club', p_club_id, null, null)
    ) then
      if coalesce(p_is_club_wide, false) then
        raise exception 'Only club administration can make an event club-wide.' using errcode = '42501';
      end if;
      if exists (
        select 1 from unnest(p_team_ids) t(id)
        where not internal.can('calendar.event.manage', 'team', p_club_id, t.id, null)
      ) then
        raise exception 'You do not have permission to include one of those teams.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- SHAPE.
  if length(v_name) = 0 or length(v_name) > 160 then
    raise exception 'An event needs a name of 160 characters or fewer.' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'An event needs a start date and an end date.' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'An event cannot end before it starts.' using errcode = '22023';
  end if;
  if p_ends_on = p_starts_on and p_start_time is not null and p_end_time is not null and p_end_time < p_start_time then
    raise exception 'An event cannot finish before it begins.' using errcode = '22023';
  end if;

  -- LOCATION: exactly one model, and a venue must belong to this club.
  if (p_venue_id is not null) = (btrim(coalesce(p_external_location_name, '')) <> '') then
    raise exception 'An event needs either a club venue or an external location, not both.' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.club_id = p_club_id
  ) then
    raise exception 'That venue does not belong to this club.' using errcode = '42501';
  end if;

  -- SCOPE: club-wide carries no team rows; a scoped event needs at least one.
  if coalesce(p_is_club_wide, false) then
    if array_length(p_team_ids, 1) is not null and array_length(p_team_ids, 1) > 0 then
      raise exception 'A club-wide event covers every team and does not list them individually.' using errcode = '22023';
    end if;
  elsif array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) = 0 then
    raise exception 'Choose at least one team, or make this a club-wide event.' using errcode = '22023';
  end if;

  -- EVERY TEAM AND PITCH MUST BELONG TO THIS CLUB. This is the forged-id
  -- boundary: ids arrive from a browser and are checked against ownership
  -- here, never trusted because a form offered them.
  select t.id into v_bad
  from unnest(p_team_ids) t(id)
  where not exists (select 1 from public.teams tm where tm.id = t.id and tm.club_id = p_club_id)
  limit 1;
  if v_bad is not null then
    raise exception 'One of those teams does not belong to this club.' using errcode = '42501';
  end if;

  select p.id into v_bad
  from unnest(p_pitch_ids) p(id)
  where not exists (select 1 from public.club_pitches cp where cp.id = p.id and cp.club_id = p_club_id)
  limit 1;
  if v_bad is not null then
    raise exception 'One of those pitches does not belong to this club.' using errcode = '42501';
  end if;

  -- AN EVENT THAT RESERVES A PITCH HOLDS IT: it must not take one somebody else is using.
  if array_length(p_pitch_ids, 1) is not null then
    v_arena_days := array(select d::date from generate_series(p_starts_on, least(p_ends_on, p_starts_on + 30), interval '1 day') d);
    v_arena_before := internal.arena_conflict_keys(p_club_id, v_arena_days);
  end if;

  -- SEASON comes from the canonical register. Resolved from the start date
  -- only when the caller did not state one, and by ASKING the register which
  -- season contains the date rather than computing a year from it.
  if v_season_id is null then
    select s.id into v_season_id
    from public.seasons s
    join public.clubs c on c.id = p_club_id
    join public.club_directory d on d.id = c.directory_id
    where s.rugby_code = d.rugby_code
      and p_starts_on between s.starts_on and s.ends_on
    order by s.starts_on desc
    limit 1;
  end if;

  if v_event_id is null then
    insert into public.club_events (
      club_id, season_id, name, description,
      starts_on, start_time, ends_on, end_time,
      is_club_wide, venue_id,
      external_location_name, external_address_line_1, external_address_line_2,
      external_town, external_county, external_postcode, external_country,
      external_latitude, external_longitude, external_address_provider_ref,
      created_by, updated_by
    ) values (
      p_club_id, v_season_id, v_name, nullif(btrim(coalesce(p_description, '')), ''),
      p_starts_on, p_start_time, p_ends_on, p_end_time,
      coalesce(p_is_club_wide, false), p_venue_id,
      nullif(btrim(coalesce(p_external_location_name, '')), ''), p_external_address_line_1, p_external_address_line_2,
      p_external_town, p_external_county, p_external_postcode, p_external_country,
      p_external_latitude, p_external_longitude, p_external_address_provider_ref,
      auth.uid(), auth.uid()
    )
    returning id into v_event_id;
  else
    update public.club_events set
      season_id = v_season_id,
      name = v_name,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      starts_on = p_starts_on,
      start_time = p_start_time,
      ends_on = p_ends_on,
      end_time = p_end_time,
      is_club_wide = coalesce(p_is_club_wide, false),
      venue_id = p_venue_id,
      external_location_name = nullif(btrim(coalesce(p_external_location_name, '')), ''),
      external_address_line_1 = p_external_address_line_1,
      external_address_line_2 = p_external_address_line_2,
      external_town = p_external_town,
      external_county = p_external_county,
      external_postcode = p_external_postcode,
      external_country = p_external_country,
      external_latitude = p_external_latitude,
      external_longitude = p_external_longitude,
      external_address_provider_ref = p_external_address_provider_ref,
      updated_by = auth.uid(),
      updated_at = now()
    where id = v_event_id;
  end if;

  -- Teams and pitches are replaced as sets. Attendance rows are keyed on the
  -- EVENT, not on the team list, so a player who answered and whose team is
  -- still involved keeps their answer through an edit.
  delete from public.club_event_teams where event_id = v_event_id;
  if array_length(p_team_ids, 1) is not null then
    insert into public.club_event_teams (event_id, team_id)
    select v_event_id, t.id from unnest(p_team_ids) t(id)
    on conflict do nothing;
  end if;

  delete from public.club_event_pitches where event_id = v_event_id;
  if array_length(p_pitch_ids, 1) is not null then
    insert into public.club_event_pitches (event_id, pitch_id)
    select v_event_id, p.id from unnest(p_pitch_ids) p(id)
    on conflict do nothing;
    perform internal.refuse_new_arena_conflicts(p_club_id, v_arena_days, v_arena_before, array[v_event_id]);
  end if;

  return v_event_id;
end;
$function$;

-- =====================================================================================================
-- 6. A TOURNAMENT'S CLASH ENGINE COUNTS ANOTHER TOURNAMENT'S GAMES ON A SHARED PITCH
-- =====================================================================================================

-- EVERYTHING THAT OCCUPIES A PITCH IN A TOURNAMENT (20270736), and now also the PUBLISHED games of any
-- OTHER tournament on a pitch this one has reserved that day ('foreign', named by owner_name). Two
-- tournaments share a pitch only marked out one way (the estate engine refuses two markings), so their
-- games share its areas: a foreign game takes an area exactly as one of this tournament's would. It is
-- never this tournament's to move, so it is treated like history -- counted, never reported alone.
drop function if exists internal.tournament_schedule_units(uuid);
create or replace function internal.tournament_schedule_units(p_tournament_id uuid)
returns table (
  unit_id uuid, kind text, game_id uuid, place_id uuid, plan_id uuid, age_group text,
  game_date date, start_time time, end_time time, occupied_until time,
  pitch_id uuid, side_ids uuid[], game_area numeric, is_history boolean,
  stage_round integer, is_third boolean, owner_name text)
language sql
stable
security definer
set search_path to ''
as $function$
  with plans as (
    select p.id, p.age_group, p.game_duration_minutes as dur, coalesce(p.changeover_minutes, 0) as ch,
           internal.tournament_plan_format(p.id) as fmt
    from public.tournament_plans p
    where p.tournament_id = p_tournament_id and p.publication_state <> 'SUPERSEDED'
  ), raw as (
    select g.id as unit_id, 'game'::text as kind, g.id as game_id, null::uuid as place_id, g.plan_id, g.age_group,
           g.game_date, g.start_time,
           coalesce(g.duration_minutes, pl.dur, 20) as dur, coalesce(pl.ch, 0) as ch,
           g.pitch_id, array[g.side_a_id, g.side_b_id] as side_ids,
           internal.tournament_game_is_history(g.id) as is_history,
           case when pl.fmt = 'swiss' then g.round_number
                when pl.fmt in ('knockout', 'hybrid') and g.bracket_position is not null then g.round_number
                when pl.fmt = 'hybrid' then 0 end as stage_round,
           coalesce(g.is_third_place, false) as is_third,
           null::text as owner_name
    from public.tournament_games g
    left join plans pl on pl.id = g.plan_id
    where g.tournament_id = p_tournament_id and g.status <> 'CANCELLED' and g.start_time is not null
      and (g.plan_id is null or pl.id is not null)
    union all
    select bp.id, 'place', null, bp.id, bp.plan_id, pl.age_group, bp.game_date, bp.start_time,
           pl.dur, pl.ch, bp.pitch_id, '{}'::uuid[], false,
           case when pl.fmt in ('knockout', 'hybrid', 'swiss') then bp.round_number end,
           coalesce(bp.is_third_place, false), null::text
    from public.tournament_bracket_pairings bp
    join plans pl on pl.id = bp.plan_id
    where bp.game_id is null and bp.start_time is not null and bp.game_date is not null
    union all
    select g.id, 'foreign', g.id, null, g.plan_id, g.age_group, g.game_date, g.start_time,
           coalesce(g.duration_minutes, fp.game_duration_minutes, 20), coalesce(fp.changeover_minutes, 0),
           g.pitch_id, '{}'::uuid[], true, null::integer, false, ft.name
    from public.tournament_games g
    join public.tournaments ft on ft.id = g.tournament_id and ft.cancelled_at is null
    left join public.tournament_plans fp on fp.id = g.plan_id
    where g.tournament_id <> p_tournament_id and g.status <> 'CANCELLED'
      and g.start_time is not null and g.pitch_id is not null
      and (g.plan_id is null or fp.publication_state = 'PUBLISHED')
      and exists (select 1 from public.tournament_pitches tp
                  where tp.tournament_id = p_tournament_id and tp.pitch_id = g.pitch_id and tp.reserved_on = g.game_date)
  ), grades as (
    select distinct r.age_group, internal.tournament_game_area_m2(p_tournament_id, r.age_group) as area from raw r
  )
  select r.unit_id, r.kind, r.game_id, r.place_id, r.plan_id, r.age_group, r.game_date, r.start_time,
         internal.time_after(r.start_time, r.dur),
         internal.time_after(r.start_time, r.dur + r.ch),
         r.pitch_id, r.side_ids, gr.area, r.is_history, r.stage_round, r.is_third, r.owner_name
  from raw r join grades gr on gr.age_group = r.age_group;
$function$;
revoke all on function internal.tournament_schedule_units(uuid) from public, anon, authenticated;

-- internal.tournament_schedule_conflicts
CREATE OR REPLACE FUNCTION internal.tournament_schedule_conflicts(p_tournament_id uuid)
 RETURNS TABLE(code text, unit_ids uuid[], pitch_id uuid, game_date date, at_time time without time zone, message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with u as (
    select * from internal.tournament_schedule_units(p_tournament_id)
  ), pc as (
    select p.id, p.display_name as name, internal.pitch_area_m2(p.id) as area
    from public.club_pitches p
    where p.id in (select distinct u.pitch_id from u where u.pitch_id is not null)
  ), kickoffs as (
    -- EVERY MOMENT A PITCH GETS BUSIER is a kick-off on it, so those are the only moments to look at --
    -- once each, however many games share one.
    select distinct x.pitch_id, x.game_date, x.start_time as at_time from u x where x.pitch_id is not null
  ), probe as (
    -- WHAT IS ON A PITCH AT EACH KICK-OFF: what is playing then, and what is still turning round.
    -- HOW IT IS MARKED OUT AT THAT MOMENT is the organiser's, for the reservation covering it.
    select k.pitch_id, k.game_date, k.at_time,
           internal.tournament_pitch_areas_at(p_tournament_id, k.pitch_id, k.game_date, k.at_time) as areas,
           count(*) filter (where k.at_time < b.end_time) as playing,
           count(*) as occupying,
           array_agg(b.unit_id) as ids,
           bool_and(b.is_history) as all_history,
           (array_agg(b.age_group order by b.game_area desc, b.start_time) filter (where k.at_time < b.end_time))[1] as biggest_grade,
           max(b.game_area) filter (where k.at_time < b.end_time) as biggest_area,
           max(b.end_time) filter (where b.end_time <= k.at_time) as finished_at,
           max((extract(epoch from (b.occupied_until - b.end_time)) / 60)::int) filter (where b.end_time <= k.at_time) as turnaround,
           string_agg(distinct b.owner_name, ' and ') filter (where b.owner_name is not null) as foreign_names
    from kickoffs k
    join u b on b.pitch_id = k.pitch_id and b.game_date = k.game_date
            and b.start_time <= k.at_time and k.at_time < b.occupied_until
    group by k.pitch_id, k.game_date, k.at_time
  ), pitch_rows as (
    -- EACH GAME MUST FIT ONE OF THE AREAS (its RFU pitch within the pitch's ground shared by the areas),
    -- and no more games may play at once than there are areas.
    select case
             when pr.biggest_area > pc.area / greatest(pr.areas, 1) + 0.001 then 'PITCH_TOO_SMALL'
             when pr.playing > pr.areas then 'PITCH_CLASH'
             when pr.occupying > pr.areas then 'PITCH_TURNAROUND'
           end as code,
           pr.*, pc.name
    from probe pr join pc on pc.id = pr.pitch_id
    where not pr.all_history
  ), side_rows as (
    select a.unit_id as a_id, b.unit_id as b_id, a.game_date, a.start_time as a_start, b.start_time as b_start,
           (select x from unnest(a.side_ids) x where x = any (b.side_ids) limit 1) as side_id
    from u a
    join u b on a.kind = 'game' and b.kind = 'game' and a.unit_id < b.unit_id
            and a.game_date = b.game_date and a.side_ids && b.side_ids
            and a.start_time < b.end_time and b.start_time < a.end_time
    where not (a.is_history and b.is_history)
  ), round_rows as (
    -- A ROUND STARTS ONCE THE ROUND BEFORE IT HAS FINISHED: a Final's sides come out of its Semi Finals.
    select b.unit_id, b.plan_id, b.game_date, b.start_time, b.stage_round, b.is_third,
           (array_agg(a.unit_id order by a.game_date desc, a.end_time desc))[1] as blocking_id,
           (array_agg(a.stage_round order by a.game_date desc, a.end_time desc))[1] as blocking_round,
           max(a.game_date + a.end_time) as earlier_end,
           bool_and(a.is_history) and b.is_history as all_history
    from u b
    join u a on a.plan_id = b.plan_id and a.stage_round < b.stage_round
            and (b.game_date + b.start_time) < (a.game_date + a.end_time)
    where b.stage_round is not null
    group by b.unit_id, b.plan_id, b.game_date, b.start_time, b.stage_round, b.is_third, b.is_history
  )
  select r.code, r.ids, r.pitch_id, r.game_date, r.at_time,
         case r.code
           when 'PITCH_TOO_SMALL' then
             case when r.areas <= 1
                  then format('%s is too small for a %s game. Move it to a bigger pitch.', r.name, r.biggest_grade)
                  else format('%s is marked out for %s games at %s, and a %s game needs more room than one of those areas. Mark it out for fewer games, or move this one.',
                              r.name, internal.count_word(r.areas), to_char(r.at_time, 'HH24:MI'), r.biggest_grade)
             end
           when 'PITCH_CLASH' then
             case when r.areas <= 1
                  then format('%s has %s games at %s, but it takes one game at a time.', r.name, internal.count_word(r.playing), to_char(r.at_time, 'HH24:MI'))
                  else format('%s has %s games at %s, but it is marked out for %s.', r.name, internal.count_word(r.playing), to_char(r.at_time, 'HH24:MI'), internal.count_word(r.areas))
             end
           else
             format('%s needs %s minutes between games: a game finishes at %s and the next kicks off at %s.',
                    r.name, coalesce(r.turnaround, 0), to_char(r.finished_at, 'HH24:MI'), to_char(r.at_time, 'HH24:MI'))
         end
         || case when r.foreign_names is not null then format(' %s also has a game on it then.', r.foreign_names) else '' end
  from pitch_rows r
  where r.code is not null
  union all
  select 'SIDE_CLASH', array[s.a_id, s.b_id], null::uuid, s.game_date, greatest(s.a_start, s.b_start),
         case when s.a_start = s.b_start
              then format('%s %s is scheduled in two games at %s.',
                          internal.tournament_side_summary(s.side_id, null) ->> 'clubName',
                          internal.tournament_side_summary(s.side_id, null) ->> 'label', to_char(s.a_start, 'HH24:MI'))
              else format('%s %s is scheduled in two games at once, at %s and %s.',
                          internal.tournament_side_summary(s.side_id, null) ->> 'clubName',
                          internal.tournament_side_summary(s.side_id, null) ->> 'label',
                          to_char(least(s.a_start, s.b_start), 'HH24:MI'), to_char(greatest(s.a_start, s.b_start), 'HH24:MI'))
         end
  from side_rows s
  union all
  select 'ROUND_ORDER', array[r.unit_id, r.blocking_id], null::uuid, r.game_date, r.start_time,
         format('%s cannot kick off at %s: the last game of %s ends at %s. A round starts once the round before it has finished.',
                internal.schedule_round_label(r.plan_id, r.stage_round, r.is_third, false),
                to_char(r.start_time, 'HH24:MI'),
                internal.schedule_round_label(r.plan_id, r.blocking_round, false, true),
                to_char(r.earlier_end, 'HH24:MI'))
  from round_rows r
  where not r.all_history
  union all
  select 'PITCH_NOT_RESERVED', array[x.unit_id], x.pitch_id, x.game_date, x.start_time,
         format('%s is not reserved for this tournament from %s to %s on %s.',
                coalesce(p.display_name, 'That pitch'), to_char(x.start_time, 'HH24:MI'), to_char(x.end_time, 'HH24:MI'),
                to_char(x.game_date, 'FMDy FMDD Mon'))
  from u x
  left join public.club_pitches p on p.id = x.pitch_id
  where x.pitch_id is not null and not x.is_history
    and not internal.tournament_pitch_covers(p_tournament_id, x.pitch_id, x.game_date, x.start_time, x.end_time);
$function$;

-- public.get_tournament_plan_schedule
CREATE OR REPLACE FUNCTION public.get_tournament_plan_schedule(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_plan public.tournament_plans; v_t public.tournaments; v_mine uuid[];
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  select * into v_t from public.tournaments where id = v_plan.tournament_id;

  select array_agg(z.id) into v_mine from (
    select g.id from public.tournament_games g where g.plan_id = p_plan_id
    union all
    select bp.id from public.tournament_bracket_pairings bp where bp.plan_id = p_plan_id and bp.game_id is null) z;

  return jsonb_build_object(
    'planId', v_plan.id,
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', v_plan.age_group,
    'format', coalesce(v_plan.format, v_t.format),
    'publicationState', v_plan.publication_state,
    'publishedAt', v_plan.published_at,
    'gameDurationMinutes', v_plan.game_duration_minutes,
    'changeoverMinutes', coalesce(v_plan.changeover_minutes, 0),
    'dayStartTime', to_char(v_plan.day_start_time, 'HH24:MI'),
    'dayEndTime', to_char(v_plan.day_end_time, 'HH24:MI'),
    'maxDurationMinutes', (select r.half_minutes * 2 from public.fixture_scheduling_rules r
                           where r.rugby_code = v_t.rugby_code and r.age_group = v_plan.age_group
                           order by r.effective_season desc nulls last limit 1),
    -- How much ground one of this competition's games needs, in square metres (its RFU pitch, where sourced).
    'gameAreaM2', internal.tournament_game_area_m2(v_t.id, v_plan.age_group),
    'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                      from public.tournament_plan_days d where d.plan_id = p_plan_id), '[]'::jsonb),
    -- EVERY PITCH THE TOURNAMENT HAS, its ground, the club's own layout, and when it is reserved -- each
    -- reservation with how the organiser has marked the pitch out for it.
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pitchId', p.id, 'name', p.display_name,
               'areas', coalesce(p.lane_count, 1), 'areaM2', internal.pitch_area_m2(p.id),
               'layout', p.layout,
               'reservations', (select jsonb_agg(jsonb_build_object('id', tp.id, 'date', tp.reserved_on,
                                                                     'startTime', to_char(tp.start_time, 'HH24:MI'),
                                                                     'endTime', to_char(tp.end_time, 'HH24:MI'),
                                                                     'playingAreas', coalesce(tp.playing_areas, p.lane_count, 1),
                                                                     'markedByOrganiser', tp.playing_areas is not null)
                                                  order by tp.reserved_on, tp.start_time)
                                from public.tournament_pitches tp
                                where tp.tournament_id = v_t.id and tp.pitch_id = p.id))
             order by p.sort_order, p.display_name)
      from public.club_pitches p
      where p.id in (select tp.pitch_id from public.tournament_pitches tp where tp.tournament_id = v_t.id)
         or p.id in (select g.pitch_id from public.tournament_games g where g.plan_id = p_plan_id)), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(x.j order by x.d nulls last, x.s nulls last, x.pitch_name nulls last, x.ord)
      from (
        select g.game_date as d, g.start_time as s, cp.display_name as pitch_name, g.sort_order as ord,
               jsonb_build_object(
                 'id', g.id, 'kind', 'game', 'gameId', g.id, 'placeId', bp.id,
                 'round', g.round_number, 'tableId', g.table_id, 'tableName', tt.name,
                 'stageRound', case when internal.tournament_plan_format(p_plan_id) = 'swiss' then g.round_number
                                    when g.bracket_position is not null then g.round_number
                                    when internal.tournament_plan_format(p_plan_id) = 'hybrid' then 0 end,
                 'isThirdPlace', coalesce(g.is_third_place, false),
                 'roundLabel', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                    then internal.tournament_game_round_label(p_plan_id, g.round_number, g.is_third_place) end,
                 -- The words a round-order clash uses, so the editor says exactly what the server will.
                 'roundSubject', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                      then internal.schedule_round_label(p_plan_id, g.round_number, g.is_third_place, false) end,
                 'roundWhole', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                    then internal.schedule_round_label(p_plan_id, g.round_number, false, true)
                                    when internal.tournament_plan_format(p_plan_id) = 'hybrid' then 'the group stage' end,
                 'sideA', internal.tournament_plan_side_json(g.side_a_id, v_t.host_club_id),
                 'sideB', internal.tournament_plan_side_json(g.side_b_id, v_t.host_club_id),
                 'date', g.game_date,
                 'startTime', to_char(g.start_time, 'HH24:MI'),
                 'durationMinutes', coalesce(g.duration_minutes, v_plan.game_duration_minutes),
                 'pitchId', g.pitch_id, 'pitchName', cp.display_name,
                 'placedByHand', g.placed_by_hand,
                 'isHistory', internal.tournament_game_is_history(g.id),
                 'status', g.status, 'resultStatus', g.result_status,
                 'sideAScore', g.side_a_score, 'sideBScore', g.side_b_score) as j
        from public.tournament_games g
        left join public.tournament_plan_tables tt on tt.id = g.table_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        left join public.tournament_bracket_pairings bp on bp.game_id = g.id
        where g.plan_id = p_plan_id
        union all
        -- A KNOCKOUT PLACE NOT YET PAIRED still has a time and a pitch, and is moved like a game.
        select bp.game_date, bp.start_time, cp.display_name, 100000 + bp.round_number * 100 + bp.game_position,
               jsonb_build_object(
                 'id', bp.id, 'kind', 'place', 'gameId', null, 'placeId', bp.id,
                 'round', bp.round_number, 'gamePosition', bp.game_position, 'tableId', null, 'tableName', null,
                 'stageRound', bp.round_number,
                 'isThirdPlace', coalesce(bp.is_third_place, false),
                 'roundLabel', internal.tournament_game_round_label(p_plan_id, bp.round_number, bp.is_third_place),
                 'roundSubject', internal.schedule_round_label(p_plan_id, bp.round_number, bp.is_third_place, false),
                 'roundWhole', internal.schedule_round_label(p_plan_id, bp.round_number, false, true),
                 'sideA', null, 'sideB', null,
                 'date', bp.game_date,
                 'startTime', to_char(bp.start_time, 'HH24:MI'),
                 'durationMinutes', v_plan.game_duration_minutes,
                 'pitchId', bp.pitch_id, 'pitchName', cp.display_name,
                 'placedByHand', bp.placed_by_hand,
                 'isHistory', false, 'status', 'SCHEDULED', 'resultStatus', 'none',
                 'sideAScore', null, 'sideBScore', null)
        from public.tournament_bracket_pairings bp
        left join public.club_pitches cp on cp.id = bp.pitch_id
        where bp.plan_id = p_plan_id and bp.game_id is null) x), '[]'::jsonb),
    -- WHAT THE TOURNAMENT'S OTHER COMPETITIONS HAVE ON THESE PITCHES, so a move is checked against them.
    'others', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unitId', u.unit_id, 'ageGroup', u.age_group, 'date', u.game_date,
               'startTime', to_char(u.start_time, 'HH24:MI'), 'endTime', to_char(u.end_time, 'HH24:MI'),
               'occupiedUntil', to_char(u.occupied_until, 'HH24:MI'),
               'pitchId', u.pitch_id, 'gameAreaM2', u.game_area,
               'sideIds', to_jsonb(u.side_ids), 'isHistory', u.is_history,
               'tournamentName', u.owner_name)
             order by u.game_date, u.start_time)
      from internal.tournament_schedule_units(v_t.id) u
      where u.plan_id is distinct from p_plan_id), '[]'::jsonb),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'unitIds', to_jsonb(c.unit_ids), 'pitchId', c.pitch_id,
                                          'date', c.game_date, 'at', to_char(c.at_time, 'HH24:MI'), 'message', c.message)
                       order by c.game_date, c.at_time, c.code)
      from internal.tournament_schedule_conflicts(v_t.id) c
      where c.unit_ids && coalesce(v_mine, '{}'::uuid[])), '[]'::jsonb),
    'readiness', internal.tournament_plan_readiness(p_plan_id)
  );
end;
$function$;

-- =====================================================================================================
-- 8. THE TOURNAMENT SCHEDULER'S WORKING SET, CLEARED THE WAY THE API ALLOWS
-- =====================================================================================================

-- Unchanged from 20270736 except the WHERE: a request through the API runs with safeupdate loaded, which
-- refuses an UPDATE or DELETE without one ("DELETE requires a WHERE clause") -- even inside this
-- SECURITY DEFINER function, and even on an empty temporary table.
create or replace function internal.load_schedule_units(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  create temp table if not exists sched_units (
    unit_id uuid primary key, plan_id uuid, game_date date, pitch_id uuid,
    s time, e time, oe time, game_area numeric, side_ids uuid[]
  ) on commit drop;
  delete from pg_temp.sched_units where true;
  insert into pg_temp.sched_units
  select x.unit_id, x.plan_id, x.game_date, x.pitch_id, x.start_time, x.end_time, x.occupied_until, x.game_area, x.side_ids
  from internal.tournament_schedule_units(p_tournament_id) x
  where x.pitch_id is not null;
end;
$function$;
