-- ARENA PLANS THE ESTATE.
--
-- Arena is the club's physical operations view: what is happening across its grounds, pitches and
-- changing rooms on a day, what still needs a pitch or a room, what clashes, and what catering the day
-- needs. It owns no activity. Fixtures, training sessions, tournaments and events stay where they are,
-- and so do their centres; Arena is one more projection of the same rows, read through the one
-- occupancy and conflict engine (20270737), and every change it makes goes through the canonical writers
-- the Match Centre, Training and the board already use -- so a change in Arena is the same change there,
-- with no copy to keep in step.
--
--   1. ONE CATERING COUNT. The Match Centre's catering total and the Event Centre's organiser summary
--      become internal.fixture_catering / internal.club_event_summary, and Arena reads the same two.
--      Attendance that Ovalball cannot see (an opposition not on Ovalball) is reported as not counted,
--      never as zero; only counts leave the server, never names.
--   2. TEAM FACILITY PREFERENCES (public.facility_preferences): ranked venue, match pitch, training pitch
--      and home / away / officials room, for the club as a default and for a team as an override.
--      Preferences, never assignments: hard rules always win.
--   3. THE ARENA READS (get_arena_hub, get_arena_day, get_arena_range, get_arena_allocation_options):
--      one role-aware projection each, built on the server, so the phone renders a day rather than
--      reconstructing one from tables. Venue-pitch-allocation viewers only; numbers, never names.
--   4. A WHAT-IF FORM OF THE ENGINE (internal.arena_blockers): would this activity fit this resource at
--      this time -- the same rules, asked of one placement, which the allocation options and automatic
--      allocation use.
--   5. AUTOMATIC ALLOCATION (preview_arena_allocation / apply_arena_allocation): deterministic, never
--      random; it keeps locks and people's decisions, tries a team's preferences in order, keeps a
--      fixture's rooms together, falls back to any valid resource, and leaves an activity unallocated
--      rather than cause a clash. The preview is computed and returned, not stored; Apply re-checks
--      everything in one transaction and refuses a stale plan.
--   6. LOCKS (set_arena_lock) and ROOM TIMES (save_arena_settings).
--   7. ONE NOTICE PER PERSON PER FIXTURE. An applied plan tells each affected person once per fixture,
--      through the same held-notice batch save_match_details uses (now internal.flush_notice_batch); a
--      preview, a view or an unchanged arrangement tells nobody, and nobody hears about their own change.
--   8. TRAINING CHANGING ROOMS AND TIME OWNERSHIP (sections 2b and 9). A team's plan or one session asks
--      for a changing room in the Training Centre; Arena plans it, one team per room, on the same plan as
--      every pitch. Each activity says who owns its time: Arena moves a kick-off or a session's start only
--      through that time's own writer, and never a tournament's or an event's.

-- =====================================================================================================
-- 1. ONE CATERING COUNT
-- =====================================================================================================

-- WHAT A FIXTURE'S CATERING IS COUNTED FROM: players marked Attending on each side that is on Ovalball. A
-- side that is not on Ovalball is listed as not counted -- its attendance is unknown, never zero.
create or replace function internal.fixture_catering(p_fixture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_side text;
  v_total integer := 0;
  v_parts jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_attending integer;
  v_required boolean;
begin
  select f.catering_required into v_required from public.fixtures f where f.id = p_fixture_id;
  foreach v_side in array array['home', 'away'] loop
    if exists (select 1 from internal.fixture_side_team_ids(p_fixture_id, v_side)) then
      select count(*) filter (where a.status = 'ATTENDING') into v_attending
      from internal.fixture_side_answers(p_fixture_id, v_side) a;
      v_total := v_total + coalesce(v_attending, 0);
      v_parts := v_parts || jsonb_build_object('side', v_side, 'attending', coalesce(v_attending, 0));
    else
      v_missing := v_missing || v_side;
    end if;
  end loop;
  return jsonb_build_object(
    'required', v_required,
    'total', v_total,
    'parts', v_parts,
    'sidesNotCounted', to_jsonb(v_missing),
    'basis', 'Players marked Attending on each Ovalball side. Unsure and awaiting are not counted.');
end;
$function$;
revoke all on function internal.fixture_catering(uuid) from public, anon, authenticated;

-- WHO MAY SEE A FIXTURE'S CATERING NUMBERS: the Match Centre's own rule -- staff of either side, or the
-- site's fixture support.
create or replace function internal.fixture_catering_visible(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select internal.fixture_side_relationship(p_fixture_id, 'home') = 'STAFF'
      or internal.fixture_side_relationship(p_fixture_id, 'away') = 'STAFF'
      or internal.has_site_capability('site.fixtures.view');
$function$;
revoke all on function internal.fixture_catering_visible(uuid) from public, anon, authenticated;

-- =====================================================================================================
-- 2. TEAM FACILITY PREFERENCES
-- =====================================================================================================

create table if not exists public.facility_preferences (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  purpose text not null,
  rank smallint not null,
  venue_id uuid references public.venues(id) on delete cascade,
  pitch_id uuid references public.club_pitches(id) on delete cascade,
  changing_room_id uuid references public.venue_changing_rooms(id) on delete cascade,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facility_preferences_purpose_check
    check (purpose in ('VENUE', 'MATCH_PITCH', 'TRAINING_PITCH', 'HOME_ROOM', 'AWAY_ROOM', 'OFFICIALS_ROOM')),
  constraint facility_preferences_rank_check check (rank between 1 and 10),
  constraint facility_preferences_one_resource check (
       (purpose = 'VENUE' and venue_id is not null and pitch_id is null and changing_room_id is null)
    or (purpose in ('MATCH_PITCH', 'TRAINING_PITCH') and pitch_id is not null and venue_id is null and changing_room_id is null)
    or (purpose in ('HOME_ROOM', 'AWAY_ROOM', 'OFFICIALS_ROOM') and changing_room_id is not null and venue_id is null and pitch_id is null))
);
comment on table public.facility_preferences is
  'Ranked facility preferences for automatic allocation: the club''s default (team_id null) and a team''s override. '
  'A team''s rows for a purpose replace the club''s for that purpose; no rows means any suitable resource. '
  'Preferences, never assignments -- hard rules always win. Written only through save_facility_preferences.';
create unique index if not exists facility_preferences_rank_key
  on public.facility_preferences (club_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose, rank);
create unique index if not exists facility_preferences_resource_key
  on public.facility_preferences (club_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose,
                                  coalesce(venue_id, pitch_id, changing_room_id));
create index if not exists facility_preferences_team_idx on public.facility_preferences (team_id) where team_id is not null;

alter table public.facility_preferences enable row level security;

drop policy if exists facility_preferences_select on public.facility_preferences;
create policy facility_preferences_select on public.facility_preferences
  for select to authenticated
  using (internal.can('venue.pitch_allocation.view', 'club', club_id, null, null)
      or internal.can('venue.pitch_allocation.manage', 'club', club_id, null, null)
      or internal.has_site_capability('site.fixtures.support'));

drop policy if exists facility_preferences_session_ok_required on public.facility_preferences;
create policy facility_preferences_session_ok_required on public.facility_preferences
  as restrictive for all to authenticated
  using (internal.session_ok()) with check (internal.session_ok());

revoke all on public.facility_preferences from anon, authenticated;
grant select on public.facility_preferences to authenticated;

-- WHO MAY SEE AND PLAN A CLUB'S ESTATE: the pitch-allocation authority, exactly as the board -- never
-- inferred from Club Admin or from fixture editing.
create or replace function internal.arena_can_view(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_club_id is not null and (
         internal.can('venue.pitch_allocation.view', 'club', p_club_id, null, null)
      or internal.can('venue.pitch_allocation.manage', 'club', p_club_id, null, null)
      or internal.has_site_capability('site.fixtures.support'));
$function$;
revoke all on function internal.arena_can_view(uuid) from public, anon, authenticated;

create or replace function internal.arena_can_manage(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_club_id is not null and (
         internal.can('venue.pitch_allocation.manage', 'club', p_club_id, null, null)
      or internal.has_site_capability('site.fixtures.support'));
$function$;
revoke all on function internal.arena_can_manage(uuid) from public, anon, authenticated;

-- A TEAM'S PREFERENCE FOR ONE PURPOSE, in order: the team's own when it has set any, otherwise the
-- club's default, otherwise none (any suitable resource).
create or replace function internal.facility_preference_ids(p_club_id uuid, p_team_id uuid, p_purpose text)
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select array_agg(coalesce(fp.venue_id, fp.pitch_id, fp.changing_room_id) order by fp.rank)
     from public.facility_preferences fp
     where fp.club_id = p_club_id and p_team_id is not null and fp.team_id = p_team_id and fp.purpose = p_purpose
     having count(*) > 0),
    (select array_agg(coalesce(fp.venue_id, fp.pitch_id, fp.changing_room_id) order by fp.rank)
     from public.facility_preferences fp
     where fp.club_id = p_club_id and fp.team_id is null and fp.purpose = p_purpose
     having count(*) > 0),
    '{}'::uuid[]);
$function$;
revoke all on function internal.facility_preference_ids(uuid, uuid, text) from public, anon, authenticated;

-- Where a team's preference for a purpose comes from: TEAM, CLUB, or null (none).
create or replace function internal.facility_preference_source(p_club_id uuid, p_team_id uuid, p_purpose text)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when p_team_id is not null and exists (select 1 from public.facility_preferences fp
                                           where fp.club_id = p_club_id and fp.team_id = p_team_id and fp.purpose = p_purpose) then 'TEAM'
    when exists (select 1 from public.facility_preferences fp
                 where fp.club_id = p_club_id and fp.team_id is null and fp.purpose = p_purpose) then 'CLUB'
  end;
$function$;
revoke all on function internal.facility_preference_source(uuid, uuid, text) from public, anon, authenticated;

-- SAVE ONE RANKED LIST: the club's default (p_team_id null) or a team's, for one purpose. An empty list
-- removes it, so the team uses the club's default again (or any suitable resource).
create or replace function public.save_facility_preferences(p_club_id uuid, p_team_id uuid, p_purpose text, p_resource_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ids uuid[] := coalesce(p_resource_ids, '{}'::uuid[]);
  v_bad uuid;
begin
  perform internal.require_live_session();
  if not internal.arena_can_manage(p_club_id) then
    raise exception 'You do not have permission to plan this club''s facilities.' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('VENUE', 'MATCH_PITCH', 'TRAINING_PITCH', 'HOME_ROOM', 'AWAY_ROOM', 'OFFICIALS_ROOM') then
    raise exception 'Choose what the preference is for.' using errcode = '22023';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    raise exception 'That team is not this club''s.' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 10 then
    raise exception 'Rank up to ten choices.' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'Each choice can be ranked once.' using errcode = '22023';
  end if;

  -- Every choice is this club's own, live, and the right kind of thing for the purpose.
  select x into v_bad from unnest(v_ids) x
  where not case
    when p_purpose = 'VENUE' then exists (select 1 from public.venues v where v.id = x and v.club_id = p_club_id and v.active)
    when p_purpose in ('MATCH_PITCH', 'TRAINING_PITCH') then exists (select 1 from public.club_pitches p where p.id = x and p.club_id = p_club_id and p.active)
    else exists (select 1 from public.venue_changing_rooms r where r.id = x and r.club_id = p_club_id and r.active)
  end
  limit 1;
  if v_bad is not null then
    raise exception 'One of those choices is not one of this club''s, or is switched off.' using errcode = '42501';
  end if;

  delete from public.facility_preferences fp
  where fp.club_id = p_club_id and fp.team_id is not distinct from p_team_id and fp.purpose = p_purpose;

  insert into public.facility_preferences (club_id, team_id, purpose, rank, venue_id, pitch_id, changing_room_id, created_by, updated_by)
  select p_club_id, p_team_id, p_purpose, u.ord::smallint,
         case when p_purpose = 'VENUE' then u.id end,
         case when p_purpose in ('MATCH_PITCH', 'TRAINING_PITCH') then u.id end,
         case when p_purpose in ('HOME_ROOM', 'AWAY_ROOM', 'OFFICIALS_ROOM') then u.id end,
         auth.uid(), auth.uid()
  from unnest(v_ids) with ordinality u(id, ord);

  return jsonb_build_object('purpose', p_purpose, 'teamId', p_team_id, 'resourceIds', to_jsonb(v_ids),
                            'source', internal.facility_preference_source(p_club_id, p_team_id, p_purpose));
end;
$function$;
revoke all on function public.save_facility_preferences(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.save_facility_preferences(uuid, uuid, text, uuid[]) to authenticated;

-- =====================================================================================================
-- 2b. A TRAINING SESSION'S CHANGING ROOM, AND WHO OWNS AN ACTIVITY'S TIME
-- =====================================================================================================
-- THE OWNER'S RULES (2026-10-04). Training may share a pitch without limit -- Arena shows how many share,
-- never refuses training for crowding, and a match still holds its whole pitch against training. A team's
-- training plan, or one session, asks for a changing room ("Needs a changing room"); only those sessions
-- are room demand. Arena assigns the room and it is stored on the session, as its pitch is. One team per
-- room: a session holds its room for the session itself and then the club's room turnaround, through the
-- same one-use-at-a-time rule every room already has. There is no room capacity and no training capacity
-- number anywhere, because the owner set none.
--
-- The request belongs to the Training Centre (save_training_plan for the plan, override_training_session
-- for one session, section 9); Arena reads it and plans the room.

alter table public.training_plans
  add column if not exists needs_changing_room boolean not null default false;
comment on column public.training_plans.needs_changing_room is
  'The team asks for a changing room at every session of this plan. A session may say otherwise for itself (training_sessions.needs_changing_room).';

alter table public.training_sessions
  add column if not exists needs_changing_room boolean,
  add column if not exists changing_room_id uuid references public.venue_changing_rooms(id) on delete set null,
  add column if not exists changing_room_locked boolean not null default false,
  add column if not exists changing_room_source text;
comment on column public.training_sessions.needs_changing_room is
  'This session''s own answer to "Needs a changing room"; null means as its training plan says (false without a plan).';
comment on column public.training_sessions.changing_room_id is
  'The changing room Arena gave this session, at the session''s own venue. Held for the session and the club''s room turnaround.';
comment on column public.training_sessions.changing_room_locked is
  'A person locked this session''s changing room: automatic allocation leaves it where it is.';
alter table public.training_sessions drop constraint if exists training_sessions_changing_room_source_check;
alter table public.training_sessions add constraint training_sessions_changing_room_source_check
  check (changing_room_source is null or changing_room_source in ('MANUAL', 'AUTO'));
create index if not exists training_sessions_changing_room_idx
  on public.training_sessions (changing_room_id, occurrence_date) where changing_room_id is not null;

-- WHO IS IN A ROOM, in a sentence: a match's side says which ("Under 13 Boys v Kendal (home)"); a training
-- session is its own name ("Under 12 Boys training"), never "(training)" after it.
create or replace function internal.arena_room_user(p_label text, p_role text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when p_role in ('HOME', 'AWAY', 'OFFICIALS') then format('%s (%s)', p_label, lower(p_role)) else p_label end;
$function$;
revoke all on function internal.arena_room_user(text, text) from public, anon, authenticated;

-- ONE TRAINING SESSION'S ALLOCATION NEEDS, as a home fixture's are said: a time, a pitch, and -- only when
-- the team asked for one -- a changing room its venue can give (none where the venue has no team rooms).
create or replace function internal.arena_training_needs(p_session_id uuid)
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select array_remove(array[
           case when s.start_time is null then 'TIME' end,
           case when s.pitch_id is null then 'PITCH' end,
           case when coalesce(s.needs_changing_room, tp.needs_changing_room, false) and s.changing_room_id is null
                     and (s.venue_id is null
                          or (coalesce(v.changing_rooms_available, true)
                              and exists (select 1 from public.venue_changing_rooms r
                                          where r.venue_id = s.venue_id and r.active and r.room_type <> 'match_officials')))
                then 'ROOMS' end], null)
  from public.training_sessions s
  left join public.training_plans tp on tp.id = s.training_plan_id
  left join public.venues v on v.id = s.venue_id
  where s.id = p_session_id;
$function$;
revoke all on function internal.arena_training_needs(uuid) from public, anon, authenticated;

-- EVERYTHING THAT CLAIMS ONE OF A CLUB'S PITCHES OR CHANGING ROOMS, day by day, in minutes of the day.
--   FIXTURE          a home fixture at this club with a kick-off time. Its pitch from warm-up until the
--                    pitch is cleared (turnaround_until adds the club's gap between matches, which only
--                    automatic allocation keeps); each of its rooms from access -- or the home side's meet
--                    time, if earlier -- until release, plus the room's turnaround.
--   TRAINING         a planned session with a pitch and times: its own start to its own end (a session's
--                    warm-up is part of the session, never extra pitch time). A session that asked for a
--                    changing room and was given one holds it for the session itself, then the club's room
--                    turnaround -- one team per room (role TRAINING). (Redefined in 20270738, section 2b.)
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
  ), training_rooms as (
    select 'TRAINING'::text, s.id, null::uuid,
           coalesce(t.display_name, nullif(btrim(g.alias), ''), g.display_tag, 'Team') || ' training', s.team_id, s.occurrence_date, s.venue_id,
           'ROOM'::text, s.changing_room_id, 'TRAINING'::text,
           internal.minute_of(s.start_time), internal.minute_of(s.start_time),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440),
           least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60)
                 + pol.room_turnaround, 1440),
           null::text, null::numeric, null::integer, s.changing_room_locked, s.changing_room_source
    from public.training_sessions s
    cross join pol
    left join public.teams t on t.id = s.team_id
    left join public.scheduling_groups g on g.id = s.scheduling_group_id
    where s.club_id = p_club_id and s.occurrence_date between p_from and p_until
      and s.status = 'PLANNED' and s.cancelled_at is null
      and s.changing_room_id is not null and s.start_time is not null
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
  union all select * from training_rooms
  union all select * from reservations
  union all select * from games
  union all select * from events;
$function$;
revoke all on function internal.arena_occupancy(uuid, date, date) from public, anon, authenticated;

-- EVERY CLASH ON A CLUB'S ESTATE, IN WORDS (redefined here from 20270737: training rooms, named as themselves). conflict_key names the clash by what it is and who is in it,
-- so a writer can tell a clash it caused from one that was already there.
--   PITCH_RESERVED      an activity on a pitch reserved for a tournament (or two reservations disagreeing)
--   PITCH_EVENT         an activity on a pitch an event has explicitly reserved
--   PITCH_MARKING       two tournaments sharing a pitch marked out differently
--   PITCH_IN_USE        a fixture and a training session on one pitch at once
--   PITCH_FULL          more fixtures on a pitch at once than its layout or its size allows
--   PITCH_TOO_SMALL     a fixture on a pitch smaller than its grade needs
--   PITCH_INACTIVE      something still allocated to a pitch that has been switched off
--   ROOM_IN_USE         two activities in one changing room at once (two training groups included:
--                       one team per room)
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
             when 'ROOM_IN_USE' then format('%s is in use by %s %s, and %s needs it from %s.', r.name,
                    internal.arena_room_user(rp.a_label, rp.a_role), internal.arena_window(rp.a_from, rp.a_until),
                    internal.arena_room_user(rp.b_label, rp.b_role), internal.clock(rp.b_from))
             else format('%s needs %s minutes to turn round after %s leaves at %s, and %s needs it from %s.', r.name,
                    rp.a_turn - rp.a_until, internal.arena_room_user(rp.a_label, rp.a_role), internal.clock(rp.a_until),
                    internal.arena_room_user(rp.b_label, rp.b_role), internal.clock(rp.b_from)) end
    from room_pairs rp join rooms r on r.id = rp.resource_id
  ), room_off as (
    select 'ROOM_INACTIVE'::text, x.day, x.resource_id, x.occupied_from, array[x.activity_id], array[x.activity_type],
           format('%s is switched off, but %s is still in it.', r.name, internal.arena_room_user(x.label, x.room_role))
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

-- WHO OWNS AN ACTIVITY'S TIME, for this viewer: whether Arena may move it, and if not, where it is changed.
-- One canonical source for each time -- Arena changes a time only through that source's own writer:
--   FIXTURE      update_fixture_schedule, for whoever may edit this fixture's schedule; with an opposition
--                on Ovalball the new kick-off is proposed to it, never imposed. A past or cancelled fixture
--                keeps its time.
--   COMPETITION  a fixture the competition schedules: its kick-off is the competition's, changed there.
--   TRAINING     override_training_session, for whoever manages this team's training; a past session keeps
--                its schedule.
--   TOURNAMENT   its reservations are the tournament's own times, set in the tournament.
--   EVENT        its hours are the event's own, set in the event.
create or replace function internal.arena_time_owner(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_date date; v_status text; v_club uuid; v_team uuid;
begin
  if p_kind = 'FIXTURE' then
    if exists (select 1 from public.competition_match_fixtures l where l.fixture_id = p_id) then
      return jsonb_build_object('owner', 'COMPETITION', 'editable', false, 'reason', 'Kick-off is set by the competition.');
    end if;
    select f.kickoff_date, f.status into v_date, v_status from public.fixtures f where f.id = p_id;
    if v_status in ('Cancelled', 'Completed') or v_date < current_date or not internal.can_edit_fixture_schedule(p_id) then
      return jsonb_build_object('owner', 'FIXTURE', 'editable', false, 'reason', 'Kick-off is managed in the fixture.');
    end if;
    return jsonb_build_object('owner', 'FIXTURE', 'editable', true, 'reason', null);
  elsif p_kind = 'TRAINING' then
    select s.occurrence_date, s.club_id, s.team_id into v_date, v_club, v_team from public.training_sessions s where s.id = p_id;
    if v_date < current_date
       or not (internal.can_manage_training(v_club, v_team) or internal.can_manage_club_training(v_club)) then
      return jsonb_build_object('owner', 'TRAINING', 'editable', false, 'reason', 'Training times are set in the Training Centre.');
    end if;
    return jsonb_build_object('owner', 'TRAINING', 'editable', true, 'reason', null);
  elsif p_kind = 'TOURNAMENT' then
    return jsonb_build_object('owner', 'TOURNAMENT', 'editable', false, 'reason', 'Times are set in the tournament.');
  end if;
  return jsonb_build_object('owner', 'EVENT', 'editable', false, 'reason', 'Times are set in the event.');
end;
$function$;
revoke all on function internal.arena_time_owner(text, uuid) from public, anon, authenticated;

-- =====================================================================================================
-- 3. THE WHAT-IF FORM OF THE ENGINE
-- =====================================================================================================

-- A DAY'S OCCUPANCY, held in this transaction so a sequence of placements is checked against every
-- placement before it (as the tournament scheduler holds its units).
create or replace function internal.arena_load_day(p_club_id uuid, p_day date)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  create temp table if not exists arena_occ (
    activity_type text, activity_id uuid, parent_id uuid, label text, team_id uuid, day date, venue_id uuid,
    resource_type text, resource_id uuid, room_role text,
    occupied_from integer, play_from integer, play_until integer, occupied_until integer, turnaround_until integer,
    footprint text, area_m2 numeric, areas integer, locked boolean, allocation_source text,
    proposed boolean not null default false
  ) on commit drop;
  -- `where true`: PostgREST sessions load safeupdate, which refuses a DELETE without a WHERE clause.
  delete from pg_temp.arena_occ where true;
  insert into pg_temp.arena_occ
  select o.*, false from internal.arena_occupancy(p_club_id, p_day, p_day) o;
end;
$function$;
revoke all on function internal.arena_load_day(uuid, date) from public, anon, authenticated;

-- WOULD THIS ACTIVITY FIT THIS RESOURCE AT THIS TIME? Every reason it would not, in the engine's own
-- words, judged against the day held by internal.arena_load_day (the activity's own claims excluded).
-- The same rules as internal.arena_conflicts, asked of one placement:
--   a pitch reserved by a tournament or an event holds against fixtures, training and other events;
--   a fixture and a training session never share a pitch; training sessions may share one;
--   fixtures share a pitch only within its lanes and its size, and automatic allocation also keeps the
--   club's gap between matches (p_spacing);
--   a room takes one activity at a time, with its turnaround between -- a training group included.
create or replace function internal.arena_blockers(
  p_kind text, p_activity_id uuid, p_label text, p_resource_type text, p_resource_id uuid,
  p_from integer, p_play_from integer, p_play_until integer, p_until integer, p_turn_until integer,
  p_footprint text, p_spacing integer default 0)
returns table (code text, message text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_name text; v_lanes integer; v_units integer; v_active boolean; v_mine integer;
  v_probe record;
begin
  if p_resource_type = 'PITCH' then
    select p.display_name, coalesce(p.lane_count, 1), p.active,
           case p.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                else greatest(1, least(4, round(coalesce(p.custom_length_m * p.custom_width_m, 7000) / 7000.0 * 4)::integer)) end
      into v_name, v_lanes, v_active, v_units
    from public.club_pitches p where p.id = p_resource_id;
    if v_name is null then
      return query select 'PITCH_UNKNOWN'::text, 'That pitch is not one of this club''s.'::text;
      return;
    end if;
    if not v_active then
      return query select 'PITCH_INACTIVE'::text, format('%s is switched off.', v_name);
    end if;
    v_mine := case p_footprint when 'quarter' then 1 when 'half' then 2 else 4 end;

    if p_kind in ('FIXTURE', 'TRAINING', 'EVENT') then
      return query
      select 'PITCH_RESERVED'::text, format('%s is reserved for %s %s.', v_name, o.label, internal.arena_window(o.occupied_from, o.occupied_until))
      from pg_temp.arena_occ o
      where o.resource_type = 'PITCH' and o.resource_id = p_resource_id and o.activity_type = 'TOURNAMENT'
        and p_from < o.occupied_until and o.occupied_from < p_until
      order by o.occupied_from limit 1;
    end if;

    return query
    select 'PITCH_EVENT'::text, format('%s is reserved for %s %s.', v_name, o.label, internal.arena_window(o.occupied_from, o.occupied_until))
    from pg_temp.arena_occ o
    where o.resource_type = 'PITCH' and o.resource_id = p_resource_id and o.activity_type = 'EVENT'
      and o.activity_id is distinct from p_activity_id
      and p_from < o.occupied_until and o.occupied_from < p_until
    order by o.occupied_from limit 1;

    if p_kind = 'FIXTURE' then
      return query
      select 'PITCH_IN_USE'::text,
             case when o.occupied_until <= p_play_from
                    then format('%s''s warm-up needs %s from %s, and %s is on it until %s.', coalesce(p_label, 'This match'), v_name,
                                internal.clock(p_from), o.label, internal.clock(o.occupied_until))
                  when o.occupied_from >= p_play_until
                    then format('%s needs %s until %s to clear the pitch, and %s starts at %s.', coalesce(p_label, 'This match'), v_name,
                                internal.clock(p_until), o.label, internal.clock(o.occupied_from))
                  else format('%s is in use by %s %s.', v_name, o.label, internal.arena_window(o.occupied_from, o.occupied_until)) end
      from pg_temp.arena_occ o
      where o.resource_type = 'PITCH' and o.resource_id = p_resource_id and o.activity_type = 'TRAINING'
        and p_from < o.occupied_until and o.occupied_from < p_until
      order by o.occupied_from limit 1;

      if v_mine > v_units then
        return query select 'PITCH_TOO_SMALL'::text,
          format('%s is too small for %s: it needs %s.', v_name, coalesce(p_label, 'this match'),
                 case p_footprint when 'full' then 'a full-size pitch' when 'half' then 'at least half a full-size pitch'
                      else 'a quarter of a full-size pitch' end);
      end if;

      -- At the moment this match claims the pitch, and at every later moment another match joins it.
      for v_probe in
        select t.at,
               count(o.*) as n,
               coalesce(sum(case o.footprint when 'quarter' then 1 when 'half' then 2 else 4 end), 0) as used,
               (array_agg(o.label order by o.occupied_from))[1] as first_label,
               (array_agg(internal.arena_window(o.occupied_from, o.occupied_until) order by o.occupied_from))[1] as first_window
        -- With p_spacing, this match's window is widened by the gap on both sides: no other match may
        -- be on the pitch within that many minutes of it.
        from (select p_from - p_spacing as at
              union
              select x.occupied_from from pg_temp.arena_occ x
              where x.resource_type = 'PITCH' and x.resource_id = p_resource_id and x.activity_type = 'FIXTURE'
                and x.activity_id is distinct from p_activity_id
                and x.occupied_from > p_from - p_spacing and x.occupied_from < p_until + p_spacing) t
        join pg_temp.arena_occ o on o.resource_type = 'PITCH' and o.resource_id = p_resource_id and o.activity_type = 'FIXTURE'
             and o.activity_id is distinct from p_activity_id
             and o.occupied_from <= t.at and t.at < o.occupied_until
        group by t.at
        order by t.at
      loop
        if v_probe.n + 1 > v_lanes or v_probe.used + v_mine > v_units then
          return query select 'PITCH_FULL'::text,
            case when v_lanes <= 1
                   then format('%s is in use by %s %s.', v_name, v_probe.first_label, v_probe.first_window)
                 when v_probe.n + 1 > v_lanes
                   then format('%s takes %s matches at a time, and %s already on it at %s.', v_name, internal.count_word(v_lanes),
                               case when v_probe.n = 1 then 'one is' else internal.count_word(v_probe.n) || ' are' end, internal.clock(v_probe.at))
                 else format('%s has no room for %s at %s: the matches already on it use too much of the pitch.', v_name,
                             coalesce(p_label, 'this match'), internal.clock(v_probe.at)) end;
          exit;
        end if;
      end loop;
    elsif p_kind = 'TRAINING' then
      return query
      select 'PITCH_IN_USE'::text,
             case when p_until <= o.play_from
                    then format('%s''s warm-up needs %s from %s, and %s is on it until %s.', o.label, v_name,
                                internal.clock(o.occupied_from), coalesce(p_label, 'this session'), internal.clock(p_until))
                  when p_from >= o.play_until
                    then format('%s needs %s until %s to clear the pitch, and %s starts at %s.', o.label, v_name,
                                internal.clock(o.occupied_until), coalesce(p_label, 'this session'), internal.clock(p_from))
                  else format('%s is in use by %s %s.', v_name, o.label, internal.arena_window(o.occupied_from, o.occupied_until)) end
      from pg_temp.arena_occ o
      where o.resource_type = 'PITCH' and o.resource_id = p_resource_id and o.activity_type = 'FIXTURE'
        and p_from < o.occupied_until and o.occupied_from < p_until
      order by o.occupied_from limit 1;
    end if;
  else
    select r.display_name, r.active into v_name, v_active from public.venue_changing_rooms r where r.id = p_resource_id;
    if v_name is null then
      return query select 'ROOM_UNKNOWN'::text, 'That changing room is not one of this club''s.'::text;
      return;
    end if;
    if not v_active then
      return query select 'ROOM_INACTIVE'::text, format('%s is switched off.', v_name);
    end if;
    -- One team per room, training included: a training group never shares a room (the owner's rule).
    return query
    select case when p_from < o.occupied_until and o.occupied_from < p_until then 'ROOM_IN_USE' else 'ROOM_TURNAROUND' end,
           case when p_from < o.occupied_until and o.occupied_from < p_until
                  then format('%s is in use by %s %s.', v_name, internal.arena_room_user(o.label, o.room_role), internal.arena_window(o.occupied_from, o.occupied_until))
                when o.occupied_from >= p_until
                  then format('%s needs %s minutes to turn round before %s arrives at %s.', v_name, p_turn_until - p_until,
                              internal.arena_room_user(o.label, o.room_role), internal.clock(o.occupied_from))
                else format('%s needs %s minutes to turn round after %s leaves at %s.', v_name, o.turnaround_until - o.occupied_until,
                            internal.arena_room_user(o.label, o.room_role), internal.clock(o.occupied_until)) end
    from pg_temp.arena_occ o
    where o.resource_type = 'ROOM' and o.resource_id = p_resource_id and o.activity_id is distinct from p_activity_id
      and p_from < o.turnaround_until and o.occupied_from < p_turn_until
    order by o.occupied_from limit 1;
  end if;
end;
$function$;
revoke all on function internal.arena_blockers(text, uuid, text, text, uuid, integer, integer, integer, integer, integer, text, integer)
  from public, anon, authenticated;

-- =====================================================================================================
-- 1b. THE MATCH CENTRE, THE EVENT CENTRE AND save_match_details READ THE SHARED FUNCTIONS
-- =====================================================================================================
-- Each is the live definition with only its own block replaced by the shared function.

-- public.get_match_centre_attendance
CREATE OR REPLACE FUNCTION public.get_match_centre_attendance(p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  f public.fixtures;
  v_sides jsonb := '[]';
  v_side text;
  v_rel text;
  v_my_side text;
  v_is_staff_any boolean := false;
  v_counts jsonb;
  v_names jsonb;
  v_on boolean;
  v_catering jsonb;
  v_total integer := 0;
  v_parts jsonb := '[]';
  v_missing text[] := '{}';
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id;
  if not found or not internal.fixture_visible_to_caller(p_fixture_id) then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;

  foreach v_side in array array['home', 'away'] loop
    v_rel := internal.fixture_side_relationship(p_fixture_id, v_side);
    if v_rel = 'STAFF' then v_is_staff_any := true; end if;
    if v_rel is not null and v_my_side is null then v_my_side := v_side; end if;
  end loop;
  if internal.has_site_capability('site.fixtures.view') then v_is_staff_any := true; end if;

  foreach v_side in array array['home', 'away'] loop
    v_rel := internal.fixture_side_relationship(p_fixture_id, v_side);
    v_on := exists (select 1 from internal.fixture_side_team_ids(p_fixture_id, v_side));

    if v_on then
      select jsonb_build_object(
               'squad', count(*),
               'attending', count(*) filter (where a.status = 'ATTENDING'),
               'cannotAttend', count(*) filter (where a.status = 'CANNOT_ATTEND'),
               'unsure', count(*) filter (where a.status = 'UNSURE'),
               'awaiting', count(*) filter (where a.status is null))
        into v_counts
        from internal.fixture_side_answers(p_fixture_id, v_side) a;
    else
      v_counts := null;
    end if;

    v_names := null;
    if v_on and (v_rel = 'STAFF' or internal.has_site_capability('site.fixtures.view')) then
      select coalesce(jsonb_agg(jsonb_build_object(
               'playerId', p.id,
               'firstName', p.first_name,
               'displayName', nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
               'status', a.status)
             order by p.first_name, p.surname), '[]')
        into v_names
        from internal.fixture_side_answers(p_fixture_id, v_side) a
        join public.players p on p.id = a.player_id;
    end if;

    v_sides := v_sides || jsonb_build_object(
      'side', v_side,
      'onOvalball', v_on,
      'relationship', v_rel,
      -- NAMES only for this side's own staff; NUMBERS for anybody with a relationship to the match.
      -- A family reads its own side's numbers; staff of either side read both sides' numbers.
      'visibility', case when v_names is not null then 'NAMES'
                         when v_on and (v_rel is not null or v_is_staff_any) then 'COUNTS'
                         else 'NONE' end,
      'counts', case when v_on and (v_names is not null or v_rel is not null or v_is_staff_any) then v_counts end,
      'players', v_names);

    if v_on then
      v_total := v_total + coalesce((v_counts ->> 'attending')::int, 0);
      v_parts := v_parts || jsonb_build_object('side', v_side, 'attending', coalesce((v_counts ->> 'attending')::int, 0));
    else
      v_missing := v_missing || v_side;
    end if;
  end loop;

  -- THE ONE CATERING COUNT (internal.fixture_catering), the same Arena reads.
  v_catering := case when v_is_staff_any then internal.fixture_catering(p_fixture_id)
    else jsonb_build_object('required', f.catering_required) end;

  return jsonb_build_object(
    'fixtureId', f.id,
    'viewerSide', v_my_side,
    'open', internal.fixture_attendance_is_open(f.id),
    'opensOn', internal.fixture_attendance_opens_on(f.id),
    'openDays', internal.fixture_attendance_open_days(f.id),
    'openedEarlyAt', f.attendance_opened_at,
    'canOpen', f.attendance_opened_at is null and not internal.fixture_attendance_is_open(f.id)
               and f.cancelled_at is null
               and (internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
                    or (f.mirror_fixture_id is null and f.opponent_team_id is not null
                        and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
                    or (f.mirror_fixture_id is not null and exists (
                          select 1 from public.fixtures m where m.id = f.mirror_fixture_id
                             and internal.can_manage_fixture_side(m.owning_team_id, m.owning_scheduling_group_id)))),
    'sides', v_sides,
    'catering', v_catering);
end;
$function$;

-- AN EVENT'S ORGANISER SUMMARY -- counts and catering, never names: the Event Centre's own block, lifted
-- out so that Arena reads the same numbers rather than a second count.
create or replace function internal.club_event_summary(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  e public.club_events;
  v_heads integer;
  v_wait_count integer;
  v_summary jsonb;
begin
  select * into e from public.club_events ce where ce.id = p_event_id;
  if e.id is null then return null; end if;
  v_heads := internal.club_event_confirmed_heads(e.id);
  select count(*) into v_wait_count from (
    select r.guest_count from public.club_event_responses r where r.event_id = e.id and r.waitlisted_at is not null
    union all select g.guest_count from public.club_event_guests g where g.event_id = e.id and g.waitlisted_at is not null) w;
    with units as (select * from internal.club_event_units(e.id)),
  ans as (
    select u.category, r.status, r.guest_count, r.catering_count, r.dietary, r.waitlisted_at
      from units u
      left join public.club_event_responses r on r.event_id = e.id
           and ((u.unit_kind = 'PLAYER' and r.player_id = u.player_id) or (u.unit_kind = 'PERSON' and r.user_id = u.user_id))
  ),
  conf as (select * from ans where status = 'ATTENDING' and waitlisted_at is null),
  gconf as (select * from public.club_event_guests g where g.event_id = e.id and g.status = 'ATTENDING' and g.waitlisted_at is null),
  diet as (
    select k, sum((v)::int) n from (
      select d.k, d.v from conf c, jsonb_each_text(c.dietary) d(k, v)
      union all select d.k, d.v from gconf g, jsonb_each_text(g.dietary) d(k, v)) z group by k)
  select jsonb_build_object(
    'invited', (select count(*) from units),
    'attending', (select count(*) from ans where status = 'ATTENDING' and waitlisted_at is null),
    'cannotAttend', (select count(*) from ans where status = 'CANNOT_ATTEND'),
    'unsure', (select count(*) from ans where status = 'UNSURE'),
    'awaiting', (select count(*) from ans where status is null),
    'waiting', v_wait_count,
    'externalGuests', (select count(*) from public.club_event_guests g where g.event_id = e.id),
    'peopleConfirmed', v_heads,
    'catering', case when e.catering_required then jsonb_build_object(
        'players', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category = 'PLAYER'),
        'staff', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category = 'STAFF'),
        'members', (select coalesce(sum(least(catering_count, 1)), 0) from conf where category in ('INVITEE', 'MEMBER')),
        'familyAndGuests', (select coalesce(sum(greatest(catering_count - 1, 0)), 0) from conf),
        'externalGuests', (select coalesce(sum(catering_count), 0) from gconf),
        'total', (select coalesce(sum(catering_count), 0) from conf) + (select coalesce(sum(catering_count), 0) from gconf),
        'dietary', coalesce((select jsonb_object_agg(k, n) from diet where n > 0), '{}'::jsonb),
        'otherNotes', (select count(*) from public.club_event_responses r where r.event_id = e.id and r.dietary_note is not null
                        and r.status = 'ATTENDING' and r.waitlisted_at is null)) end)
      into v_summary;
  return v_summary;
end;
$function$;
revoke all on function internal.club_event_summary(uuid) from public, anon, authenticated;

-- public.get_event_centre
CREATE OR REPLACE FUNCTION public.get_event_centre(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  e public.club_events;
  v_manage boolean;
  v_invited boolean;
  v_mine jsonb;
  v_summary jsonb;
  v_heads integer;
  v_wait_count integer;
  v_wait_heads integer;
  v_host jsonb;
  v_venue jsonb;
begin
  perform internal.require_live_session();
  select * into e from public.club_events where id = p_event_id;
  if e.id is null or not internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide) then
    return null;
  end if;
  v_manage := internal.can_manage_club_event(e.id);
  v_invited := internal.club_event_caller_invited(e.id);

  select jsonb_build_object('clubId', c.id, 'clubName', d.name, 'directoryId', d.id,
                            'logoPath', coalesce(c.logo_storage_path, d.logo_storage_path),
                            'teamId', t.id, 'teamName', t.display_name)
    into v_host
    from public.clubs c join public.club_directory d on d.id = c.directory_id
    left join public.teams t on t.id = e.host_team_id
   where c.id = e.club_id;

  if e.location_kind = 'VENUE' then
    select jsonb_build_object('id', v.id, 'name', v.name,
             'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.address_line_2), ''),
                                                  nullif(btrim(v.town), ''), nullif(btrim(v.county), '')), ''), nullif(btrim(v.address), '')),
             'postcode', v.postcode, 'latitude', v.latitude, 'longitude', v.longitude, 'directions', nullif(btrim(v.directions), ''),
             'coverImagePath', v.cover_image_path, 'coverStockKey', v.cover_stock_key)
      into v_venue from public.venues v where v.id = e.venue_id;
  end if;

  -- MY HOUSEHOLD: the players I answer for, and myself where I am invited in my own right.
  select coalesce(jsonb_agg(x order by x ->> 'sort', x ->> 'name'), '[]') into v_mine from (
    select jsonb_build_object(
             'kind', 'PLAYER', 'playerId', p.id, 'userId', null, 'sort', '1',
             'name', nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), 'firstName', p.first_name,
             'teamName', t.display_name, 'isSelf', coalesce(p.user_id = auth.uid(), false),
             'canRespond', internal.resolve_attendance_response_source(p.id) is not null,
             'response', case when r.id is null then null else jsonb_build_object('status', r.status, 'guests', r.guest_count,
                           'catering', r.catering_count, 'dietary', r.dietary, 'dietaryNote', r.dietary_note,
                           'waitlisted', r.waitlisted_at is not null) end) x
      from internal.club_event_units(e.id) u
      join public.players p on p.id = u.player_id
      left join public.teams t on t.id = u.team_id
      left join public.club_event_responses r on r.event_id = e.id and r.player_id = p.id
     where u.unit_kind = 'PLAYER' and internal.can_player_as_family('player.profile.view', p.id)
    union all
    select jsonb_build_object(
             'kind', 'PERSON', 'playerId', null, 'userId', u.user_id, 'sort', '0',
             'name', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'firstName', pr.first_name,
             'teamName', null, 'isSelf', true, 'canRespond', true, 'category', u.category,
             'response', case when r.id is null then null else jsonb_build_object('status', r.status, 'guests', r.guest_count,
                           'catering', r.catering_count, 'dietary', r.dietary, 'dietaryNote', r.dietary_note,
                           'waitlisted', r.waitlisted_at is not null) end)
      from internal.club_event_units(e.id) u
      join public.profiles pr on pr.id = u.user_id
      left join public.club_event_responses r on r.event_id = e.id and r.user_id = u.user_id
     where u.unit_kind = 'PERSON' and u.user_id = auth.uid()
  ) q(x);

  v_heads := internal.club_event_confirmed_heads(e.id);
  select count(*), coalesce(sum(1 + w.guest_count), 0) into v_wait_count, v_wait_heads from (
    select r.guest_count from public.club_event_responses r where r.event_id = e.id and r.waitlisted_at is not null
    union all select g.guest_count from public.club_event_guests g where g.event_id = e.id and g.waitlisted_at is not null) w;

  if v_manage then
    v_summary := internal.club_event_summary(e.id);
  end if;

  return jsonb_build_object(
    'id', e.id, 'name', e.name, 'eventType', e.event_type, 'description', e.description,
    'status', e.status, 'phase', internal.club_event_phase(e.status, e.ends_on), 'statusNote', e.status_note,
    'cancellationReason', e.cancellation_reason,
    'startsOn', e.starts_on, 'endsOn', e.ends_on, 'startTime', to_char(e.start_time, 'HH24:MI'), 'endTime', to_char(e.end_time, 'HH24:MI'),
    'meetTime', to_char(e.meet_time, 'HH24:MI'),
    'host', v_host, 'isClubWide', e.is_club_wide,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) order by t.display_name)
                         from public.club_event_teams cet join public.teams t on t.id = cet.team_id where cet.event_id = e.id), '[]'),
    'invites', jsonb_build_object('players', e.invite_players, 'staff', e.invite_staff, 'members', e.invite_members,
                                  'individuals', (select count(*) from public.club_event_invitees i where i.event_id = e.id)),
    'visibility', e.visibility,
    'location', jsonb_build_object(
      'kind', e.location_kind, 'detail', e.location_detail, 'venue', v_venue,
      'external', case when e.location_kind = 'EXTERNAL' then jsonb_build_object('name', e.external_location_name,
          'address', nullif(concat_ws(', ', e.external_address_line_1, e.external_address_line_2, e.external_town, e.external_county), ''),
          'postcode', e.external_postcode, 'latitude', e.external_latitude, 'longitude', e.external_longitude) end,
      'onlineUrl', case when e.location_kind = 'ONLINE' and (v_manage or v_invited) then e.online_url end,
      -- The pitches this event reserves at its ground (Arena: an event holds only these).
      'pitches', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.display_name) order by cp.sort_order, cp.display_name)
                           from public.club_event_pitches cep join public.club_pitches cp on cp.id = cep.pitch_id
                           where cep.event_id = e.id), '[]'::jsonb)),
    'rsvp', jsonb_build_object('required', e.rsvp_required, 'deadline', e.rsvp_deadline,
                               'open', e.status in ('SCHEDULED', 'POSTPONED') and e.ends_on >= (now() at time zone 'Europe/London')::date
                                       and (e.rsvp_deadline is null or now() <= e.rsvp_deadline)),
    'maxGuests', e.max_guests,
    'catering', jsonb_build_object('required', e.catering_required, 'notes', e.catering_notes, 'deadline', e.catering_deadline),
    'capacity', jsonb_build_object('limit', e.capacity, 'waitingList', e.waiting_list_enabled,
                                   'remaining', case when e.capacity is not null then greatest(e.capacity - v_heads, 0) end,
                                   'full', e.capacity is not null and v_heads >= e.capacity),
    'payment', jsonb_build_object('mode', e.payment_mode, 'note', e.price_note),
    'cover', jsonb_build_object('path', e.cover_image_path, 'stockKey', e.cover_stock_key),
    'invitationsSentAt', e.invitations_sent_at, 'invitationMessage', e.invitation_message,
    'viewer', jsonb_build_object('canManage', v_manage, 'invited', v_invited),
    'mine', v_mine,
    'summary', v_summary);
end;
$function$;

-- EACH PERSON ONCE: the notices held under one batch, folded into one per person -- their held sentences
-- together, in the order the changes were made; one change keeps its own title and type, several become
-- "Match details changed". Lifted from save_match_details so that Arena's applied plan says it the same way.
create or replace function internal.flush_notice_batch(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_notified integer := 0;
begin
  with held as (
    select b.user_id, b.type, b.title, b.body, b.data, b.seq,
           row_number() over (partition by b.user_id, coalesce(b.body, '') order by b.seq) as dup
      from internal.notification_batch_items b
     where b.batch_id = p_batch
  ), per_person as (
    select h.user_id,
           count(distinct h.type) as kinds,
           (array_agg(h.type order by h.seq))[1] as first_type,
           (array_agg(h.title order by h.seq))[1] as first_title,
           string_agg(h.body, ' ' order by h.seq) filter (where h.dup = 1) as body,
           (array_agg(h.data order by h.seq))[1] as data
      from held h
     group by h.user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select p.user_id,
         case when p.kinds = 1 then p.first_type else 'fixture_details_changed' end,
         case when p.kinds = 1 then p.first_title else 'Match details changed' end,
         p.body,
         p.data
    from per_person p;
  get diagnostics v_notified = row_count;
  delete from internal.notification_batch_items where batch_id = p_batch;
  return v_notified;
end;
$function$;
revoke all on function internal.flush_notice_batch(uuid) from public, anon, authenticated;

-- public.save_match_details
CREATE OR REPLACE FUNCTION public.save_match_details(p_fixture_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_batch uuid := gen_random_uuid();
  v_facilities jsonb;
  v_meet time;
  v_notified integer := 0;
  f public.fixtures;
  v_sched jsonb;
  v_proposed boolean := false;
  r record;
begin
  perform internal.require_live_session();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;

  perform set_config('ovalball.notice_batch', v_batch::text, true);

  -- The same order the form has always used: home or away and the notes first (a host change re-resolves
  -- the ground), then the schedule and the meet time, then the ground and pitch this form chose.
  if p_patch ? 'details' then
    perform public.update_fixture_details(p_fixture_id, p_patch -> 'details');
  end if;
  if p_patch ? 'kickoff' then
    perform public.update_fixture_kickoff(p_fixture_id, (p_patch -> 'kickoff' ->> 'date')::date, nullif(p_patch -> 'kickoff' ->> 'time', '')::time);
  end if;
  -- THE WEBSITE'S SCHEDULE, in the same save: date, kick-off, ground and pitch through update_fixture_schedule
  -- (which turns a kick-off change on a shared fixture into a proposal). Read after the details, because a
  -- home-or-away switch has already moved the match to the new host's ground; a part not named keeps what the
  -- fixture now has. The website used to call it as a second request, so a Home/Away switch told the other
  -- club's staff twice -- "now at their ground", then "where the match is".
  if p_patch ? 'schedule' then
    v_sched := p_patch -> 'schedule';
    select * into f from public.fixtures where id = p_fixture_id;
    select * into r from public.update_fixture_schedule(
      p_fixture_id,
      coalesce(nullif(v_sched ->> 'date', '')::date, f.kickoff_date),
      case when v_sched ? 'time' then nullif(v_sched ->> 'time', '')::time else f.kickoff_time end,
      case when v_sched ? 'venue_id' then nullif(v_sched ->> 'venue_id', '')::uuid else f.venue_id end,
      case when v_sched ? 'pitch_id' then nullif(v_sched ->> 'pitch_id', '')::uuid
           when v_sched ? 'pitch_text' then null
           else f.pitch_id end,
      case when v_sched ? 'pitch_id' then null
           when v_sched ? 'pitch_text' then nullif(btrim(coalesce(v_sched ->> 'pitch_text', '')), '')
           else f.pitch_allocation end,
      coalesce(nullif(v_sched ->> 'source', ''), 'match_details'));
    v_proposed := coalesce(r.kickoff_proposed, false);
  end if;
  if p_patch ? 'meet_time' then
    v_meet := public.update_fixture_meet_time(p_fixture_id, nullif(p_patch ->> 'meet_time', '')::time);
  end if;
  if p_patch ? 'facilities' then
    v_facilities := public.set_fixture_facilities(p_fixture_id, p_patch -> 'facilities');
  end if;

  perform set_config('ovalball.notice_batch', '', true);

  v_notified := internal.flush_notice_batch(v_batch);

  return jsonb_build_object('facilities', v_facilities, 'meetTime', v_meet, 'notified', v_notified, 'kickoffProposed', v_proposed);
end;
$function$;

-- =====================================================================================================
-- 4. THE ARENA READS
-- =====================================================================================================

-- A team as Arena presents it: its canonical display name and the structured identity a client derives
-- the compact form from (compactTeamLabel). Never a free-text name.
create or replace function internal.arena_team_json(p_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', t.id, 'displayName', t.display_name, 'category', t.category, 'ageGroup', t.age_group,
    'gender', t.gender, 'squadDesignation', t.squad_designation, 'rugbyCode', t.rugby_code,
    'alias', (select a.alias from public.team_aliases a where a.team_id = t.id limit 1))
  from public.teams t where t.id = p_team_id;
$function$;
revoke all on function internal.arena_team_json(uuid) from public, anon, authenticated;

-- ONE HOME FIXTURE'S ALLOCATION NEEDS, in order: a kick-off, a ground, a pitch, and the changing rooms the
-- ground can give (up to two team rooms; none where the ground has none or the match needs none).
create or replace function internal.arena_fixture_needs(p_fixture_id uuid)
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select array_remove(array[
           case when f.kickoff_time is null then 'KICKOFF' end,
           case when f.venue_id is null then 'VENUE' end,
           case when f.pitch_id is null then 'PITCH' end,
           case when f.venue_id is not null and not f.no_changing_rooms and coalesce(v.changing_rooms_available, true)
                     and ((f.home_changing_room_id is null and rooms.n >= 1)
                          or (f.away_changing_room_id is null and rooms.n >= 2))
                then 'ROOMS' end], null)
  from public.fixtures f
  left join public.venues v on v.id = f.venue_id
  cross join lateral (select count(*) as n from public.venue_changing_rooms r
                      where r.venue_id = f.venue_id and r.active and r.room_type <> 'match_officials') rooms
  where f.id = p_fixture_id;
$function$;
revoke all on function internal.arena_fixture_needs(uuid) from public, anon, authenticated;

-- EVERYTHING ARENA PLANNING SHOWS FOR ONE DAY, built on the server. Venues, pitches and rooms; every
-- fixture (home, and away so the day is whole -- an away fixture uses none of this club's facilities),
-- training session, tournament and event; each claim on a pitch or room with its warm-up, play and
-- clearing times; every clash in words; and whether the day is ready. Catering is counted, never named,
-- and only for the people the Match Centre and Event Centre already show those numbers to.
create or replace function public.get_arena_day(p_club_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_manage boolean;
  v_pol record;
  v_club jsonb;
  v_venues jsonb; v_pitches jsonb; v_rooms jsonb;
  v_fixtures jsonb; v_training jsonb; v_tournaments jsonb; v_events jsonb;
  v_occupancy jsonb; v_conflicts jsonb;
  v_readiness jsonb;
begin
  perform internal.require_live_session();
  if p_club_id is null or p_date is null then
    raise exception 'Choose a club and a day.' using errcode = '22023';
  end if;
  if not internal.arena_can_view(p_club_id) then
    raise exception 'Arena is for the people who plan this club''s facilities.' using errcode = '42501';
  end if;
  v_manage := internal.arena_can_manage(p_club_id);
  select * into v_pol from internal.arena_policy(p_club_id);

  select jsonb_build_object('id', c.id, 'name', cd.name, 'rugbyCode', coalesce(cd.rugby_code, 'union'),
                            'logoPath', coalesce(c.logo_storage_path, cd.logo_storage_path),
                            'timezone', coalesce(c.timezone, 'Europe/London'))
    into v_club
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_club_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'name', v.name, 'isDefault', v.is_default_home,
           'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.town), '')), ''), nullif(btrim(v.address), '')),
           'postcode', v.postcode, 'coverImagePath', v.cover_image_path, 'coverStockKey', v.cover_stock_key,
           'changingRoomsAvailable', v.changing_rooms_available, 'cateringAvailable', v.catering_available)
         order by v.is_default_home desc, v.name), '[]'::jsonb)
    into v_venues
  from public.venues v where v.club_id = p_club_id and v.active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'venueId', p.venue_id, 'name', p.display_name, 'active', p.active,
           'size', p.physical_size_category, 'layout', p.layout, 'lanes', coalesce(p.lane_count, 1),
           'customLengthM', p.custom_length_m, 'customWidthM', p.custom_width_m,
           'areaM2', internal.pitch_area_m2(p.id), 'sortOrder', p.sort_order,
           'coverImagePath', p.cover_image_path, 'coverStockKey', p.cover_stock_key)
         order by p.sort_order, p.display_name), '[]'::jsonb)
    into v_pitches
  from public.club_pitches p
  join public.venues v on v.id = p.venue_id and v.active
  where p.club_id = p_club_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'venueId', r.venue_id, 'name', r.display_name, 'roomType', r.room_type, 'active', r.active,
           'sortOrder', r.sort_order, 'coverImagePath', r.cover_image_path, 'coverStockKey', r.cover_stock_key)
         order by r.sort_order, r.display_name), '[]'::jsonb)
    into v_rooms
  from public.venue_changing_rooms r
  join public.venues v on v.id = r.venue_id and v.active
  where r.club_id = p_club_id;

  -- FIXTURES: this club's side at home or away, one row per real match.
  with fx as (
    select f.*, coalesce(ht.club_id = p_club_id, false) as is_home,
           case when ht.club_id = p_club_id then ht.id else awt.id end as our_team_id,
           coalesce(case when f.home_away = 'Home' then f.owning_team_age_group_snapshot else f.opponent_team_age_group_snapshot end,
                    ht.age_group) as home_age,
           coalesce(ht.rugby_code, 'union') as home_code
    from public.fixtures f
    left join public.teams ht on ht.id = f.home_team_id
    left join public.teams awt on awt.id = f.away_team_id
    where f.kickoff_date = p_date and f.archived_at is null and f.cancelled_at is null and f.status <> 'Cancelled'
      and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id)
      and (ht.club_id = p_club_id or awt.club_id = p_club_id)
  ), fxw as (
    select fx.*, internal.arena_match_minutes(fx.home_code, fx.home_age) as play,
           internal.minute_of(fx.kickoff_time) as ko,
           fit.footprint, fit.area_m2, fit.basis, fit.source as fit_source
    from fx cross join lateral internal.age_grade_pitch_fit(fx.home_code, fx.home_age, fx.kickoff_date) fit
  )
  select coalesce(jsonb_agg(j order by sort_at, sort_id), '[]'::jsonb) into v_fixtures
  from (
    select coalesce(w.ko, 1440) as sort_at, w.id::text as sort_id,
      jsonb_build_object(
        'kind', 'FIXTURE', 'id', w.id, 'home', w.is_home,
        'title', case when w.is_home then internal.arena_fixture_label(w.id)
                      else coalesce(internal.arena_fixture_label(w.id), 'Away fixture') end,
        'team', internal.arena_team_json(w.our_team_id),
        'opponentName', case when w.is_home
            then coalesce((select cd.name from public.teams pt join public.clubs pc on pc.id = pt.club_id
                           join public.club_directory cd on cd.id = pc.directory_id where pt.id = w.away_team_id),
                          (select cd.name from public.club_directory cd where cd.id = w.opponent_directory_id),
                          nullif(btrim(w.raw_opposition_text), ''), 'Opposition')
            else coalesce((select cd.name from public.teams ht2 join public.clubs hc on hc.id = ht2.club_id
                           join public.club_directory cd on cd.id = hc.directory_id where ht2.id = w.home_team_id),
                          (select cd.name from public.club_directory cd where cd.id = w.opponent_directory_id),
                          nullif(btrim(w.raw_opposition_text), ''), 'Opposition') end,
        'date', w.kickoff_date, 'kickoff', to_char(w.kickoff_time, 'HH24:MI'), 'playMinutes', w.play,
        'status', w.status, 'meetTime', to_char(w.meet_time, 'HH24:MI'),
        'kickoffProposed', w.kickoff_amendment_proposed_date is not null,
        'requiresOpponentAgreement', w.opponent_team_id is not null and exists (
           select 1 from public.teams ot join public.clubs oc on oc.id = ot.club_id
           where ot.id = w.opponent_team_id and oc.status = 'active'),
        'venueId', w.venue_id,
        'venueName', coalesce((select v.name from public.venues v where v.id = w.venue_id), nullif(btrim(w.venue_address), '')),
        'pitchId', w.pitch_id, 'pitchName', w.pitch_allocation,
        'homeRoomId', w.home_changing_room_id, 'awayRoomId', w.away_changing_room_id,
        'officialsRoomId', w.officials_changing_room_id, 'noChangingRooms', w.no_changing_rooms,
        'pitchWindow', case when w.is_home and w.ko is not null then jsonb_build_object(
            'from', internal.clock(greatest(w.ko - v_pol.warm_up, 0)), 'playFrom', internal.clock(w.ko),
            'playUntil', internal.clock(w.ko + w.play), 'until', internal.clock(least(w.ko + w.play + v_pol.pack_up, 1440))) end,
        'roomWindow', case when w.is_home and w.ko is not null then jsonb_build_object(
            'from', internal.clock(greatest(case when w.meet_time is not null
                                                 then least(internal.minute_of(w.meet_time), w.ko - v_pol.room_access)
                                                 else w.ko - v_pol.room_access end, 0)),
            'awayFrom', internal.clock(greatest(w.ko - v_pol.room_access, 0)),
            'until', internal.clock(least(w.ko + w.play + v_pol.room_release, 1440)),
            'turnaroundUntil', internal.clock(least(w.ko + w.play + v_pol.room_release + v_pol.room_turnaround, 1440))) end,
        'fit', jsonb_build_object('footprint', w.footprint, 'areaM2', w.area_m2, 'basis', w.basis, 'source', w.fit_source),
        'locks', to_jsonb(w.allocation_locks), 'autoAllocated', to_jsonb(w.allocation_auto),
        'needs', case when w.is_home then to_jsonb(internal.arena_fixture_needs(w.id)) else '[]'::jsonb end,
        -- Whether Arena may move the kick-off for this viewer, or where it is changed instead.
        'time', internal.arena_time_owner('FIXTURE', w.id),
        'catering', case when not w.is_home then null
                         when internal.fixture_catering_visible(w.id) then internal.fixture_catering(w.id) || jsonb_build_object('visible', true)
                         else jsonb_build_object('required', w.catering_required, 'visible', false) end
      ) as j
    from fxw w
  ) x;

  -- TRAINING: the club's planned sessions on the day. A session's changing room ("roomId") is the one Arena
  -- gave it; "needsRoom" is whether the team asked for one (the session's own answer, else its plan's), and
  -- "roomRequest" says where that answer was given. The room lock and an automatic room share the fixture's
  -- part name, home_room: a session has one room, its team's.
  select coalesce(jsonb_agg(j order by sort_at, sort_id), '[]'::jsonb) into v_training
  from (
    select coalesce(internal.minute_of(s.start_time), 1440) as sort_at, s.id::text as sort_id,
      jsonb_build_object(
        'kind', 'TRAINING', 'id', s.id,
        'title', coalesce(t.display_name, nullif(btrim(g.alias), ''), g.display_tag, 'Team') || ' training',
        'team', case when s.team_id is not null then internal.arena_team_json(s.team_id) end,
        'groupLabel', case when s.scheduling_group_id is not null then coalesce(nullif(btrim(g.alias), ''), g.display_tag) end,
        'date', s.occurrence_date, 'start', to_char(s.start_time, 'HH24:MI'),
        'end', to_char(coalesce(s.end_time, (s.start_time + make_interval(mins => coalesce(s.duration_minutes, 60)))::time), 'HH24:MI'),
        'venueId', s.venue_id, 'venueName', (select v.name from public.venues v where v.id = s.venue_id),
        'pitchId', s.pitch_id, 'pitchName', (select p.display_name from public.club_pitches p where p.id = s.pitch_id),
        'roomId', s.changing_room_id,
        'needsRoom', coalesce(s.needs_changing_room, tp.needs_changing_room, false),
        'roomRequest', case when s.needs_changing_room is not null then 'SESSION' when tp.id is not null then 'PLAN' end,
        'locks', to_jsonb(array_remove(array[case when s.pitch_locked then 'pitch' end,
                                             case when s.changing_room_locked then 'home_room' end], null)),
        'autoAllocated', to_jsonb(array_remove(array[case when s.allocation_source = 'AUTO' then 'pitch' end,
                                                     case when s.changing_room_source = 'AUTO' then 'home_room' end], null)),
        'source', s.source,
        'needs', to_jsonb(internal.arena_training_needs(s.id)),
        'time', internal.arena_time_owner('TRAINING', s.id)
      ) as j
    from public.training_sessions s
    left join public.training_plans tp on tp.id = s.training_plan_id
    left join public.teams t on t.id = s.team_id
    left join public.scheduling_groups g on g.id = s.scheduling_group_id
    where s.club_id = p_club_id and s.occurrence_date = p_date and s.status = 'PLANNED' and s.cancelled_at is null
  ) x;

  -- TOURNAMENTS this club hosts with a pitch reserved or a game on the day: their reservations as their
  -- organisers marked them, their published games, and their own clashes in their own words.
  select coalesce(jsonb_agg(j order by sort_at, sort_id), '[]'::jsonb) into v_tournaments
  from (
    select coalesce((select min(internal.minute_of(tp.start_time)) from public.tournament_pitches tp
                     where tp.tournament_id = t.id and tp.reserved_on = p_date), 1440) as sort_at, t.id::text as sort_id,
      jsonb_build_object(
        'kind', 'TOURNAMENT', 'id', t.id, 'title', t.name, 'status', t.status,
        'start', (select to_char(min(tp.start_time), 'HH24:MI') from public.tournament_pitches tp where tp.tournament_id = t.id and tp.reserved_on = p_date),
        'end', (select to_char(max(tp.end_time), 'HH24:MI') from public.tournament_pitches tp where tp.tournament_id = t.id and tp.reserved_on = p_date),
        'venueId', t.venue_id,
        'coverImagePath', t.cover_image_path, 'coverStockKey', t.cover_stock_key,
        'reservations', coalesce((select jsonb_agg(jsonb_build_object(
             'id', tp.id, 'pitchId', tp.pitch_id, 'from', to_char(tp.start_time, 'HH24:MI'), 'until', to_char(tp.end_time, 'HH24:MI'),
             'areas', coalesce(tp.playing_areas, p.lane_count, 1), 'markedByOrganiser', tp.playing_areas is not null)
             order by p.sort_order, tp.start_time)
           from public.tournament_pitches tp join public.club_pitches p on p.id = tp.pitch_id
           where tp.tournament_id = t.id and tp.reserved_on = p_date), '[]'::jsonb),
        'gameCount', (select count(*) from public.tournament_games g left join public.tournament_plans pl on pl.id = g.plan_id
                      where g.tournament_id = t.id and g.game_date = p_date and g.status <> 'CANCELLED'
                        and (g.plan_id is null or pl.publication_state = 'PUBLISHED')),
        'hasPublishedPlan', exists (select 1 from public.tournament_plans pl where pl.tournament_id = t.id and pl.publication_state = 'PUBLISHED'),
        'time', internal.arena_time_owner('TOURNAMENT', t.id),
        'conflicts', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'pitchId', c.pitch_id,
                                 'at', to_char(c.at_time, 'HH24:MI'), 'message', c.message) order by c.at_time, c.code)
                               from internal.tournament_schedule_conflicts(t.id) c where c.game_date = p_date), '[]'::jsonb)
      ) as j
    from public.tournaments t
    where t.host_club_id = p_club_id and t.cancelled_at is null
      and (exists (select 1 from public.tournament_pitches tp where tp.tournament_id = t.id and tp.reserved_on = p_date)
           or exists (select 1 from public.tournament_games g where g.tournament_id = t.id and g.game_date = p_date and g.status <> 'CANCELLED'))
  ) x;

  -- EVENTS of the club on the day, wherever they are; only an explicit pitch reservation occupies a pitch.
  select coalesce(jsonb_agg(j order by sort_at, sort_id), '[]'::jsonb) into v_events
  from (
    select case when e.starts_on = p_date and e.start_time is not null then internal.minute_of(e.start_time) else 0 end as sort_at,
           e.id::text as sort_id,
      jsonb_build_object(
        'kind', 'EVENT', 'id', e.id, 'title', e.name, 'status', e.status, 'eventType', e.event_type,
        'start', case when e.starts_on = p_date then to_char(e.start_time, 'HH24:MI') end,
        'end', case when e.ends_on = p_date then to_char(e.end_time, 'HH24:MI') end,
        'allDay', e.start_time is null, 'multiDay', e.ends_on > e.starts_on,
        'locationKind', e.location_kind, 'venueId', e.venue_id,
        'venueName', (select v.name from public.venues v where v.id = e.venue_id),
        'externalName', e.external_location_name, 'locationDetail', e.location_detail,
        'pitchIds', coalesce((select jsonb_agg(cep.pitch_id) from public.club_event_pitches cep where cep.event_id = e.id), '[]'::jsonb),
        'coverImagePath', e.cover_image_path, 'coverStockKey', e.cover_stock_key,
        'time', internal.arena_time_owner('EVENT', e.id),
        'catering', case when sm.summary is not null then
              jsonb_build_object('required', e.catering_required, 'visible', true,
                                 'expected', (sm.summary ->> 'peopleConfirmed')::integer,
                                 'counts', sm.summary -> 'catering')
            else jsonb_build_object('required', e.catering_required, 'visible', false) end
      ) as j
    from public.club_events e
    -- The organiser's numbers, for the people the Event Centre shows them to; names stay there.
    cross join lateral (select case when internal.can_manage_club_event(e.id) then internal.club_event_summary(e.id) end as summary) sm
    where e.club_id = p_club_id and e.status <> 'CANCELLED' and e.starts_on <= p_date and e.ends_on >= p_date
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'activityType', o.activity_type, 'activityId', o.activity_id, 'parentId', o.parent_id, 'label', o.label,
           'resourceType', o.resource_type, 'resourceId', o.resource_id, 'role', o.room_role,
           'from', internal.clock(o.occupied_from), 'playFrom', internal.clock(o.play_from),
           'playUntil', internal.clock(o.play_until), 'until', internal.clock(o.occupied_until),
           'turnaroundUntil', internal.clock(o.turnaround_until),
           'footprint', o.footprint, 'areas', o.areas, 'locked', o.locked)
         order by o.resource_type, o.occupied_from, o.activity_id), '[]'::jsonb)
    into v_occupancy
  from internal.arena_occupancy(p_club_id, p_date, p_date) o;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', c.conflict_key, 'code', c.code, 'severity', c.severity, 'resourceType', c.resource_type,
           'resourceId', c.resource_id, 'at', internal.clock(c.at_minute), 'activityIds', to_jsonb(c.activity_ids),
           'message', c.message)
         order by c.at_minute, c.code), '[]'::jsonb)
    into v_conflicts
  from internal.arena_conflicts(p_club_id, p_date, p_date) c;

  -- ARE WE READY? Facts, never a score: what still needs allocating, what clashes, what catering is known.
  select jsonb_build_object(
    'state', case when n_alloc + n_pitch + n_room + n_tourn > 0 then 'NEEDS_ATTENTION' else 'READY' end,
    'activities', jsonb_array_length(v_fixtures) + jsonb_array_length(v_training) + jsonb_array_length(v_tournaments) + jsonb_array_length(v_events),
    'homeGames', (select count(*) from jsonb_array_elements(v_fixtures) a where (a ->> 'home')::boolean),
    'awayGames', (select count(*) from jsonb_array_elements(v_fixtures) a where not (a ->> 'home')::boolean),
    'training', jsonb_array_length(v_training),
    'tournaments', jsonb_array_length(v_tournaments),
    'events', jsonb_array_length(v_events),
    'needsAllocation', n_alloc,
    'pitchConflicts', n_pitch, 'roomConflicts', n_room, 'tournamentConflicts', n_tourn,
    'warnings', n_warn,
    'cateringKnown', catering_known, 'cateringIncomplete', catering_incomplete)
    into v_readiness
  from (
    select
      (select count(*) from jsonb_array_elements(v_fixtures) a where (a ->> 'home')::boolean and jsonb_array_length(a -> 'needs') > 0)
        + (select count(*) from jsonb_array_elements(v_training) a where jsonb_array_length(a -> 'needs') > 0) as n_alloc,
      (select count(*) from jsonb_array_elements(v_conflicts) c where c ->> 'severity' = 'hard' and c ->> 'resourceType' = 'PITCH') as n_pitch,
      (select count(*) from jsonb_array_elements(v_conflicts) c where c ->> 'severity' = 'hard' and c ->> 'resourceType' = 'ROOM') as n_room,
      (select count(*) from jsonb_array_elements(v_conflicts) c where c ->> 'severity' = 'warning') as n_warn,
      (select coalesce(sum(jsonb_array_length(a -> 'conflicts')), 0) from jsonb_array_elements(v_tournaments) a) as n_tourn,
      (select coalesce(sum((a -> 'catering' ->> 'total')::integer), 0) from jsonb_array_elements(v_fixtures) a
        where (a -> 'catering' ->> 'visible')::boolean and (a -> 'catering' ->> 'required')::boolean)
        + (select coalesce(sum(coalesce((a -> 'catering' -> 'counts' ->> 'total')::integer, (a -> 'catering' ->> 'expected')::integer, 0)), 0)
           from jsonb_array_elements(v_events) a
           where (a -> 'catering' ->> 'visible')::boolean and (a -> 'catering' ->> 'required')::boolean) as catering_known,
      (select count(*) from jsonb_array_elements(v_fixtures) a
        where (a -> 'catering' ->> 'visible')::boolean and (a -> 'catering' ->> 'required')::boolean
          and jsonb_array_length(a -> 'catering' -> 'sidesNotCounted') > 0) as catering_incomplete
  ) n;

  return jsonb_build_object(
    'club', v_club, 'date', p_date, 'canManage', v_manage,
    'policy', jsonb_build_object('warmUp', v_pol.warm_up, 'packUp', v_pol.pack_up, 'turnaround', v_pol.turnaround,
                                 'roomAccess', v_pol.room_access, 'roomRelease', v_pol.room_release,
                                 'roomTurnaround', v_pol.room_turnaround,
                                 'bufferSource', v_pol.buffer_source, 'roomSource', v_pol.room_source,
                                 'autoAllocateHomeFixtures', coalesce((select cp.auto_allocate_home_fixtures from public.club_scheduling_policy cp
                                                                      where cp.club_id = p_club_id), false)),
    'venues', v_venues, 'pitches', v_pitches, 'rooms', v_rooms,
    'activities', v_fixtures || v_training || v_tournaments || v_events,
    'occupancy', v_occupancy, 'conflicts', v_conflicts, 'readiness', v_readiness);
end;
$function$;
revoke all on function public.get_arena_day(uuid, date) from public, anon;
grant execute on function public.get_arena_day(uuid, date) to authenticated;

-- A WEEK OR A MONTH, A DAY AT A TIME: what is on, what still needs allocating and what clashes, for the
-- Week and Month views and the Hub's Plan Your Week. Counts only; the day itself is get_arena_day.
create or replace function public.get_arena_range(p_club_id uuid, p_from date, p_until date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_days jsonb;
begin
  perform internal.require_live_session();
  if p_club_id is null or p_from is null or p_until is null or p_until < p_from then
    raise exception 'Choose a club and a range of days.' using errcode = '22023';
  end if;
  if p_until - p_from > 62 then
    raise exception 'Choose up to nine weeks at a time.' using errcode = '22023';
  end if;
  if not internal.arena_can_view(p_club_id) then
    raise exception 'Arena is for the people who plan this club''s facilities.' using errcode = '42501';
  end if;

  with days as (
    select d::date as day from generate_series(p_from, p_until, interval '1 day') d
  ), fx as (
    select f.id, f.kickoff_date as day, coalesce(ht.club_id = p_club_id, false) as is_home, f.kickoff_time,
           case when ht.club_id = p_club_id then ht.id else awt.id end as our_team_id,
           f.home_team_id, f.away_team_id, f.opponent_directory_id, f.raw_opposition_text
    from public.fixtures f
    left join public.teams ht on ht.id = f.home_team_id
    left join public.teams awt on awt.id = f.away_team_id
    where f.kickoff_date between p_from and p_until and f.archived_at is null and f.cancelled_at is null and f.status <> 'Cancelled'
      and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id)
      and (ht.club_id = p_club_id or awt.club_id = p_club_id)
  ), fx_needs as (
    select fx.day, count(*) as n from fx
    where fx.is_home and cardinality(internal.arena_fixture_needs(fx.id)) > 0 group by fx.day
  ), tr as (
    -- A session is unallocated while it lacks a time, a pitch, or the changing room its team asked for.
    select s.occurrence_date as day, count(*) as n, count(*) filter (where cardinality(internal.arena_training_needs(s.id)) > 0) as unallocated
    from public.training_sessions s
    where s.club_id = p_club_id and s.occurrence_date between p_from and p_until and s.status = 'PLANNED' and s.cancelled_at is null
    group by s.occurrence_date
  ), tn as (
    select x.day, count(distinct x.tournament_id) as n, count(distinct x.pitch_id) filter (where x.pitch_id is not null) as pitches
    from (select tp.reserved_on as day, tp.tournament_id, tp.pitch_id
          from public.tournament_pitches tp join public.tournaments t on t.id = tp.tournament_id
          where t.host_club_id = p_club_id and t.cancelled_at is null and tp.reserved_on between p_from and p_until
          union all
          select g.game_date, g.tournament_id, null::uuid
          from public.tournament_games g join public.tournaments t on t.id = g.tournament_id
          where t.host_club_id = p_club_id and t.cancelled_at is null and g.game_date between p_from and p_until
            and g.status <> 'CANCELLED') x
    group by x.day
  ), ev as (
    select d.day, count(*) as n
    from days d join public.club_events e on e.club_id = p_club_id and e.status <> 'CANCELLED'
                                         and e.starts_on <= d.day and e.ends_on >= d.day
    group by d.day
  ), cf as (
    select c.day, count(*) filter (where c.severity = 'hard') as n
    from internal.arena_conflicts(p_club_id, p_from, p_until) c group by c.day
  ), one as (
    -- A DAY WITH ONE THING ON says what it is: "U12 Training · 18:00", not "1 training session".
    select x.day, count(*) as n, (array_agg(x.item order by x.at nulls last))[1] as item
    from (
      select fx.day, fx.kickoff_time as at,
             jsonb_build_object('kind', 'FIXTURE', 'home', fx.is_home, 'team', internal.arena_team_json(fx.our_team_id),
               'title', coalesce(
                 (select cd.name from public.teams ot join public.clubs oc on oc.id = ot.club_id join public.club_directory cd on cd.id = oc.directory_id
                   where ot.id = case when fx.is_home then fx.away_team_id else fx.home_team_id end),
                 (select cd.name from public.club_directory cd where cd.id = fx.opponent_directory_id),
                 nullif(btrim(fx.raw_opposition_text), '')),
               'time', to_char(fx.kickoff_time, 'HH24:MI')) as item
      from fx
      union all
      select s.occurrence_date, s.start_time,
             jsonb_build_object('kind', 'TRAINING', 'team', case when s.team_id is not null then internal.arena_team_json(s.team_id) end,
               'title', case when s.team_id is null then coalesce(nullif(btrim(g.alias), ''), g.display_tag) end,
               'time', to_char(s.start_time, 'HH24:MI'))
      from public.training_sessions s
      left join public.scheduling_groups g on g.id = s.scheduling_group_id
      where s.club_id = p_club_id and s.occurrence_date between p_from and p_until and s.status = 'PLANNED' and s.cancelled_at is null
      union all
      select tp.reserved_on, min(tp.start_time),
             jsonb_build_object('kind', 'TOURNAMENT', 'title', t.name, 'time', to_char(min(tp.start_time), 'HH24:MI'),
                                'pitches', count(distinct tp.pitch_id))
      from public.tournament_pitches tp join public.tournaments t on t.id = tp.tournament_id
      where t.host_club_id = p_club_id and t.cancelled_at is null and tp.reserved_on between p_from and p_until
      group by tp.reserved_on, t.id, t.name
      union all
      select d.day, case when e.starts_on = d.day then e.start_time end,
             jsonb_build_object('kind', 'EVENT', 'title', e.name, 'time', case when e.starts_on = d.day then to_char(e.start_time, 'HH24:MI') end)
      from days d join public.club_events e on e.club_id = p_club_id and e.status <> 'CANCELLED'
                                           and e.starts_on <= d.day and e.ends_on >= d.day
    ) x
    group by x.day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', d.day,
           'homeGames', (select count(*) from fx where fx.day = d.day and fx.is_home),
           'awayGames', (select count(*) from fx where fx.day = d.day and not fx.is_home),
           'training', coalesce(tr.n, 0),
           'tournaments', coalesce(tn.n, 0),
           'pitchesReserved', coalesce(tn.pitches, 0),
           'events', coalesce(ev.n, 0),
           'needsAllocation', coalesce(fxn.n, 0) + coalesce(tr.unallocated, 0),
           'conflicts', coalesce(cf.n, 0),
           'single', case when one.n = 1 then one.item end)
         order by d.day), '[]'::jsonb)
    into v_days
  from days d
  left join fx_needs fxn on fxn.day = d.day
  left join tr on tr.day = d.day
  left join tn on tn.day = d.day
  left join ev on ev.day = d.day
  left join cf on cf.day = d.day
  left join one on one.day = d.day;

  return jsonb_build_object('from', p_from, 'until', p_until, 'canManage', internal.arena_can_manage(p_club_id), 'days', v_days);
end;
$function$;
revoke all on function public.get_arena_range(uuid, date, date) from public, anon;
grant execute on function public.get_arena_range(uuid, date, date) to authenticated;

-- THE ARENA HUB: the club's whole estate and what is happening across it -- live counts that open what
-- they count, each ground with what is in use on it now, today at the club, and the week ahead. "Today"
-- and "now" are the club's own clock.
create or replace function public.get_arena_hub(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tz text;
  v_today date;
  v_now integer;
  v_club jsonb;
  v_venues jsonb;
  v_estate jsonb;
  v_day jsonb;
  v_week jsonb;
  v_next date;
  v_next_day jsonb;
begin
  perform internal.require_live_session();
  if not internal.arena_can_view(p_club_id) then
    raise exception 'Arena is for the people who plan this club''s facilities.' using errcode = '42501';
  end if;
  select coalesce(c.timezone, 'Europe/London') into v_tz from public.clubs c where c.id = p_club_id;
  v_today := (now() at time zone v_tz)::date;
  v_now := internal.minute_of((now() at time zone v_tz)::time);

  select jsonb_build_object('id', c.id, 'name', cd.name, 'logoPath', coalesce(c.logo_storage_path, cd.logo_storage_path),
                            'coverPath', c.cover_storage_path)
    into v_club
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_club_id;

  v_day := public.get_arena_day(p_club_id, v_today);
  v_week := public.get_arena_range(p_club_id, v_today, v_today + 6) -> 'days';

  -- THE NEXT DAY ANYTHING IS ON AT THE CLUB, up to four weeks ahead, as a whole day: when today is quiet the
  -- first screen looks ahead ("Next at the Club") rather than saying nothing is using the facilities. An away
  -- fixture uses none of the club's facilities, so it never makes a day "at the club".
  select min(x.day) into v_next
  from (
    select f.kickoff_date as day
    from public.fixtures f
    join public.teams ht on ht.id = f.home_team_id and ht.club_id = p_club_id
    where f.kickoff_date between v_today + 1 and v_today + 28 and f.archived_at is null and f.cancelled_at is null
      and f.status <> 'Cancelled'
    union all
    select s.occurrence_date from public.training_sessions s
    where s.club_id = p_club_id and s.occurrence_date between v_today + 1 and v_today + 28 and s.status = 'PLANNED' and s.cancelled_at is null
    union all
    select tp.reserved_on from public.tournament_pitches tp join public.tournaments t on t.id = tp.tournament_id
    where t.host_club_id = p_club_id and t.cancelled_at is null and tp.reserved_on between v_today + 1 and v_today + 28
    union all
    select greatest(e.starts_on, v_today + 1) from public.club_events e
    where e.club_id = p_club_id and e.status <> 'CANCELLED' and e.ends_on >= v_today + 1 and e.starts_on <= v_today + 28
  ) x;
  if v_next is not null then
    v_next_day := public.get_arena_day(p_club_id, v_next);
  end if;

  with occ as (
    select o.resource_id, o.occupied_from, o.occupied_until, p.venue_id
    from internal.arena_occupancy(p_club_id, v_today, v_today) o
    join public.club_pitches p on p.id = o.resource_id
    where o.resource_type = 'PITCH'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'name', v.name, 'isDefault', v.is_default_home,
           'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.town), '')), ''), nullif(btrim(v.address), '')),
           'postcode', v.postcode, 'coverImagePath', v.cover_image_path, 'coverStockKey', v.cover_stock_key,
           'pitches', (select count(*) from public.club_pitches p where p.venue_id = v.id and p.active),
           'rooms', (select count(*) from public.venue_changing_rooms r where r.venue_id = v.id and r.active),
           'pitchesInUseNow', (select count(distinct o.resource_id) from occ o
                               where o.venue_id = v.id and o.occupied_from <= v_now and v_now < o.occupied_until),
           'pitchesInUseToday', (select count(distinct o.resource_id) from occ o where o.venue_id = v.id))
         order by v.is_default_home desc, v.name), '[]'::jsonb)
    into v_venues
  from public.venues v where v.club_id = p_club_id and v.active;

  select jsonb_build_object(
    'venues', (select count(*) from public.venues v where v.club_id = p_club_id and v.active),
    'pitches', (select count(*) from public.club_pitches p join public.venues v on v.id = p.venue_id and v.active
                where p.club_id = p_club_id and p.active),
    'rooms', (select count(*) from public.venue_changing_rooms r join public.venues v on v.id = r.venue_id and v.active
              where r.club_id = p_club_id and r.active),
    'upcoming', (select coalesce(sum((d ->> 'homeGames')::int + (d ->> 'awayGames')::int + (d ->> 'training')::int
                                     + (d ->> 'tournaments')::int + (d ->> 'events')::int), 0)
                 from jsonb_array_elements(v_week) d),
    'upcomingDays', 7)
    into v_estate;

  return jsonb_build_object(
    'club', v_club, 'today', v_today, 'now', internal.clock(v_now), 'canManage', internal.arena_can_manage(p_club_id),
    'estate', v_estate, 'venues', v_venues,
    'todayAtTheClub', jsonb_build_object('activities', v_day -> 'activities', 'readiness', v_day -> 'readiness',
                                         'conflicts', v_day -> 'conflicts', 'pitches', v_day -> 'pitches',
                                         'rooms', v_day -> 'rooms'),
    'week', v_week,
    'next', case when v_next is null then null else jsonb_build_object(
      'date', v_next, 'activities', v_next_day -> 'activities', 'readiness', v_next_day -> 'readiness',
      'conflicts', v_next_day -> 'conflicts', 'pitches', v_next_day -> 'pitches', 'rooms', v_next_day -> 'rooms') end);
end;
$function$;
revoke all on function public.get_arena_hub(uuid) from public, anon;
grant execute on function public.get_arena_hub(uuid) to authenticated;

-- =====================================================================================================
-- 5. PLANNING: OPTIONS, AUTOMATIC ALLOCATION, APPLY, LOCKS, SETTINGS, PREFERENCES
-- =====================================================================================================

-- A batch of changes is judged as one arrangement: while Arena applies a plan, each writer's own estate
-- check stands aside, and the whole plan is checked once at the end (two matches swapping pitches is not
-- a clash half-way through). Only a database function can set this; no browser role can.
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
  if coalesce(current_setting('ovalball.arena_batch', true), '') = 'on' then return; end if;
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

-- ONE ACTIVITY AS ARENA PLANS IT: when it claims a pitch and its rooms, how much pitch it needs, whose
-- preferences apply, and what it holds now. Fixtures are home fixtures of this club; training is the
-- club's planned sessions. A session's one changing room is its home_room (its team's room): held for the
-- session itself and the club's room turnaround, and `needs_room` says whether the team asked for one.
-- For a session, `kickoff` is its start time.
drop function if exists internal.arena_activity(text, uuid);
create or replace function internal.arena_activity(p_kind text, p_id uuid)
returns table (
  kind text, id uuid, club_id uuid, day date, label text, team_id uuid,
  venue_id uuid, pitch_id uuid, home_room_id uuid, away_room_id uuid, officials_room_id uuid,
  no_changing_rooms boolean, locks text[], auto_parts text[],
  pitch_from integer, play_from integer, play_until integer, pitch_until integer, pitch_turn integer,
  home_room_from integer, away_room_from integer, room_until integer, room_turn integer,
  footprint text, kickoff text, play_minutes integer, age_group text, category text, needs_room boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  with f as (
    select x.*, ht.club_id as estate_club,
           coalesce(case when x.home_away = 'Home' then x.owning_team_age_group_snapshot else x.opponent_team_age_group_snapshot end, ht.age_group) as age,
           coalesce(ht.rugby_code, 'union') as code,
           internal.minute_of(x.kickoff_time) as ko
    from public.fixtures x join public.teams ht on ht.id = x.home_team_id
    where p_kind = 'FIXTURE' and x.id = p_id
  ), fw as (
    select f.*, internal.arena_match_minutes(f.code, f.age) as play, pol.*, fit.footprint as fp,
           (select t.category from public.teams t where t.id = f.home_team_id) as cat
    from f
    cross join lateral internal.arena_policy(f.estate_club) pol
    cross join lateral internal.age_grade_pitch_fit(f.code, f.age, f.kickoff_date) fit
  )
  select 'FIXTURE', fw.id, fw.estate_club, fw.kickoff_date, internal.arena_fixture_label(fw.id), fw.home_team_id,
         fw.venue_id, fw.pitch_id, fw.home_changing_room_id, fw.away_changing_room_id, fw.officials_changing_room_id,
         fw.no_changing_rooms, fw.allocation_locks, fw.allocation_auto,
         greatest(fw.ko - fw.warm_up, 0), fw.ko, fw.ko + fw.play, least(fw.ko + fw.play + fw.pack_up, 1440),
         least(fw.ko + fw.play + fw.pack_up + fw.turnaround, 1440),
         greatest(case when fw.meet_time is not null then least(internal.minute_of(fw.meet_time), fw.ko - fw.room_access)
                       else fw.ko - fw.room_access end, 0),
         greatest(fw.ko - fw.room_access, 0),
         least(fw.ko + fw.play + fw.room_release, 1440),
         least(fw.ko + fw.play + fw.room_release + fw.room_turnaround, 1440),
         fw.fp, to_char(fw.kickoff_time, 'HH24:MI'), fw.play, fw.age, fw.cat, not fw.no_changing_rooms
  from fw
  union all
  select 'TRAINING', s.id, s.club_id, s.occurrence_date,
         coalesce(t.display_name, nullif(btrim(g.alias), ''), g.display_tag, 'Team') || ' training', s.team_id,
         s.venue_id, s.pitch_id, s.changing_room_id, null, null, false,
         array_remove(array[case when s.pitch_locked then 'pitch' end, case when s.changing_room_locked then 'home_room' end], null)::text[],
         array_remove(array[case when s.allocation_source = 'AUTO' then 'pitch' end,
                            case when s.changing_room_source = 'AUTO' then 'home_room' end], null)::text[],
         sw.st, sw.st, sw.en, sw.en, sw.en,
         sw.st, sw.st, sw.en, least(sw.en + pol.room_turnaround, 1440),
         null, to_char(s.start_time, 'HH24:MI'), sw.en - sw.st,
         t.age_group, t.category, coalesce(s.needs_changing_room, tp.needs_changing_room, false)
  from public.training_sessions s
  cross join lateral (select internal.minute_of(s.start_time) as st,
                             least(internal.minute_of(s.start_time) + coalesce(s.duration_minutes,
                                   case when s.end_time is not null then internal.minute_of(s.end_time) - internal.minute_of(s.start_time) end, 60), 1440) as en) sw
  cross join lateral internal.arena_policy(s.club_id) pol
  left join public.training_plans tp on tp.id = s.training_plan_id
  left join public.teams t on t.id = s.team_id
  left join public.scheduling_groups g on g.id = s.scheduling_group_id
  where p_kind = 'TRAINING' and s.id = p_id;
$function$;
revoke all on function internal.arena_activity(text, uuid) from public, anon, authenticated;

-- How many team changing rooms a ground can give a match: two (home and away), one, or none.
create or replace function internal.arena_team_rooms_needed(p_venue_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case when p_venue_id is null or not coalesce(v.changing_rooms_available, true) then 0
              else least(2, (select count(*) from public.venue_changing_rooms r
                             where r.venue_id = p_venue_id and r.active and r.room_type <> 'match_officials'))::integer end
  from (select 1) one left join public.venues v on v.id = p_venue_id;
$function$;
revoke all on function internal.arena_team_rooms_needed(uuid) from public, anon, authenticated;

-- EVERY PLACE ONE ACTIVITY COULD GO, AND WHY NOT: each ground, pitch and room with its state --
-- PREFERRED (free, and on the team's list), AVAILABLE, OCCUPIED (with the engine's reason), UNSUITABLE,
-- or CURRENT (what it holds now, with any clash it is in). Invalid choices are shown with their reason,
-- never hidden. For the Allocate sheet; one call, never one per resource.
create or replace function public.get_arena_allocation_options(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a record;
  v_pitch_prefs uuid[]; v_venue_prefs uuid[]; v_home_prefs uuid[]; v_away_prefs uuid[]; v_off_prefs uuid[];
  v_pitches jsonb; v_rooms jsonb; v_venues jsonb;
begin
  perform internal.require_live_session();
  if p_kind not in ('FIXTURE', 'TRAINING') then
    raise exception 'Choose a fixture or a training session.' using errcode = '22023';
  end if;
  select * into a from internal.arena_activity(p_kind, p_id);
  if a.id is null or not internal.arena_can_view(a.club_id) then
    raise exception 'That activity is not one Arena can plan for you.' using errcode = '42501';
  end if;
  if a.pitch_from is null then
    raise exception 'Give it a time first: a pitch is planned for a time.' using errcode = '22023';
  end if;

  perform internal.arena_load_day(a.club_id, a.day);
  v_pitch_prefs := internal.facility_preference_ids(a.club_id, a.team_id, case when p_kind = 'FIXTURE' then 'MATCH_PITCH' else 'TRAINING_PITCH' end);
  v_venue_prefs := internal.facility_preference_ids(a.club_id, a.team_id, 'VENUE');
  v_home_prefs := internal.facility_preference_ids(a.club_id, a.team_id, 'HOME_ROOM');
  v_away_prefs := internal.facility_preference_ids(a.club_id, a.team_id, 'AWAY_ROOM');
  v_off_prefs := internal.facility_preference_ids(a.club_id, a.team_id, 'OFFICIALS_ROOM');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'name', v.name, 'current', v.id = a.venue_id,
           'rank', array_position(v_venue_prefs, v.id),
           'teamRoomsNeeded', internal.arena_team_rooms_needed(v.id))
         order by array_position(v_venue_prefs, v.id) nulls last, v.is_default_home desc, v.name), '[]'::jsonb)
    into v_venues
  from public.venues v where v.club_id = a.club_id and v.active;

  select coalesce(jsonb_agg(x.j order by x.ord1 nulls last, x.ord2, x.ord3), '[]'::jsonb) into v_pitches
  from (
    select array_position(v_pitch_prefs, p.id) as ord1, p.sort_order as ord2, p.display_name as ord3,
      jsonb_build_object(
        'id', p.id, 'venueId', p.venue_id, 'name', p.display_name, 'size', p.physical_size_category, 'lanes', coalesce(p.lane_count, 1),
        'rank', array_position(v_pitch_prefs, p.id),
        'current', p.id = a.pitch_id,
        'state', case
            when b.code in ('PITCH_TOO_SMALL', 'PITCH_INACTIVE') then 'UNSUITABLE'
            when p.id = a.pitch_id then 'CURRENT'
            when b.code is not null then 'OCCUPIED'
            when array_position(v_pitch_prefs, p.id) is not null then 'PREFERRED'
            else 'AVAILABLE' end,
        'reason', b.message) as j
    from public.club_pitches p
    join public.venues v on v.id = p.venue_id and v.active
    left join lateral (
      select bl.code, bl.message from internal.arena_blockers(p_kind, a.id, a.label, 'PITCH', p.id,
             a.pitch_from, a.play_from, a.play_until, a.pitch_until, a.pitch_turn, a.footprint, 0) bl
      order by case bl.code when 'PITCH_INACTIVE' then 1 when 'PITCH_TOO_SMALL' then 2 else 3 end limit 1) b on true
    where p.club_id = a.club_id and (p.active or p.id = a.pitch_id)
  ) x;

  if p_kind = 'FIXTURE' then
    select coalesce(jsonb_agg(x.j order by x.ord1, x.ord2), '[]'::jsonb) into v_rooms
    from (
      select r.sort_order as ord1, r.display_name as ord2,
        jsonb_build_object(
          'id', r.id, 'venueId', r.venue_id, 'name', r.display_name, 'roomType', r.room_type,
          'home', jsonb_build_object('rank', array_position(v_home_prefs, r.id), 'current', r.id = a.home_room_id,
                    'state', case when r.id = a.home_room_id then 'CURRENT' when bh.code is not null then 'OCCUPIED'
                                  when array_position(v_home_prefs, r.id) is not null then 'PREFERRED' else 'AVAILABLE' end,
                    'reason', bh.message),
          'away', jsonb_build_object('rank', array_position(v_away_prefs, r.id), 'current', r.id = a.away_room_id,
                    'state', case when r.id = a.away_room_id then 'CURRENT' when ba.code is not null then 'OCCUPIED'
                                  when array_position(v_away_prefs, r.id) is not null then 'PREFERRED' else 'AVAILABLE' end,
                    'reason', ba.message),
          'officials', jsonb_build_object('rank', array_position(v_off_prefs, r.id), 'current', r.id = a.officials_room_id,
                    'state', case when r.id = a.officials_room_id then 'CURRENT' when bo.code is not null then 'OCCUPIED'
                                  when array_position(v_off_prefs, r.id) is not null then 'PREFERRED' else 'AVAILABLE' end,
                    'reason', bo.message)) as j
      from public.venue_changing_rooms r
      join public.venues v on v.id = r.venue_id and v.active
      left join lateral (select bl.code, bl.message from internal.arena_blockers('FIXTURE', a.id, a.label, 'ROOM', r.id,
             a.home_room_from, a.play_from, a.play_until, a.room_until, a.room_turn, null, 0) bl limit 1) bh on true
      left join lateral (select bl.code, bl.message from internal.arena_blockers('FIXTURE', a.id, a.label, 'ROOM', r.id,
             a.away_room_from, a.play_from, a.play_until, a.room_until, a.room_turn, null, 0) bl limit 1) ba on true
      left join lateral (select bl.code, bl.message from internal.arena_blockers('FIXTURE', a.id, a.label, 'ROOM', r.id,
             a.away_room_from, a.play_from, a.play_until, a.room_until, a.room_turn, null, 0) bl limit 1) bo on true
      where r.club_id = a.club_id and (r.active or r.id in (a.home_room_id, a.away_room_id, a.officials_room_id))
    ) x;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'id', a.id, 'title', a.label, 'date', a.day, 'kickoff', a.kickoff,
    'canManage', internal.arena_can_manage(a.club_id),
    'window', jsonb_build_object('from', internal.clock(a.pitch_from), 'playFrom', internal.clock(a.play_from),
                                 'playUntil', internal.clock(a.play_until), 'until', internal.clock(a.pitch_until)),
    'roomWindow', case when p_kind = 'FIXTURE' then jsonb_build_object(
        'homeFrom', internal.clock(a.home_room_from), 'awayFrom', internal.clock(a.away_room_from),
        'until', internal.clock(a.room_until), 'turnaroundUntil', internal.clock(a.room_turn)) end,
    'footprint', a.footprint,
    'current', jsonb_build_object('venueId', a.venue_id, 'pitchId', a.pitch_id, 'homeRoomId', a.home_room_id,
                                  'awayRoomId', a.away_room_id, 'officialsRoomId', a.officials_room_id,
                                  'noChangingRooms', a.no_changing_rooms),
    'locks', to_jsonb(a.locks), 'autoAllocated', to_jsonb(a.auto_parts),
    'preferences', jsonb_build_object('venue', to_jsonb(v_venue_prefs), 'pitch', to_jsonb(v_pitch_prefs),
                                      'homeRoom', to_jsonb(v_home_prefs), 'awayRoom', to_jsonb(v_away_prefs),
                                      'officialsRoom', to_jsonb(v_off_prefs)),
    'venues', v_venues, 'pitches', v_pitches, 'rooms', coalesce(v_rooms, '[]'::jsonb));
end;
$function$;
revoke all on function public.get_arena_allocation_options(text, uuid) from public, anon;
grant execute on function public.get_arena_allocation_options(text, uuid) to authenticated;


-- THE CLUB'S KICK-OFF WINDOWS for a fixture that has no time yet: the board's own preference bands, now
-- on the server so automatic allocation has one engine. A club scheduling PREFERENCE (club_scheduling_
-- policy), never a governing-body rule. Weekdays from the club's earliest weekday kick-off; weekend
-- U6-U16 the morning first, then the early afternoon, and only as a last resort a late band that the
-- proposal says it used; weekend seniors the senior window.
create or replace function internal.arena_kickoff_bands(p_club_id uuid, p_date date, p_age_group text, p_category text)
returns table (band integer, starts integer, ends integer, late boolean)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  c record;
  v_youth boolean;
  v_earliest integer; v_latest integer; v_cut integer;
  v_n integer := 0;
begin
  select coalesce(cp.weekday_earliest_kickoff, '18:00'::time) as weekday,
         coalesce(cp.weekend_youth_earliest, '09:00'::time) as youth_from, coalesce(cp.weekend_youth_latest, '13:00'::time) as youth_until,
         coalesce(cp.weekend_senior_earliest, '13:00'::time) as senior_from, coalesce(cp.weekend_senior_latest, '17:30'::time) as senior_until
    into c
  from (select 1) one left join public.club_scheduling_policy cp on cp.club_id = p_club_id;
  v_youth := case when p_age_group ~ '^U[0-9]+' then substring(p_age_group from '^U([0-9]+)')::integer <= 16
                  else coalesce(p_category, 'youth') = 'youth' end;
  if extract(isodow from p_date) < 6 then
    return query select 1, internal.minute_of(c.weekday), 22 * 60, false;
    return;
  end if;
  if v_youth then
    v_earliest := internal.minute_of(c.youth_from);
    v_latest := internal.minute_of(c.youth_until);
    v_cut := least(v_latest, 12 * 60);
    if v_cut > v_earliest then v_n := v_n + 1; return query select v_n, v_earliest, v_cut, false; end if;
    if v_latest > v_cut then v_n := v_n + 1; return query select v_n, v_cut, v_latest, false; end if;
    v_n := v_n + 1;
    return query select v_n, v_latest, 20 * 60, true;
    return;
  end if;
  return query select 1, internal.minute_of(c.senior_from), internal.minute_of(c.senior_until), false;
end;
$function$;
revoke all on function internal.arena_kickoff_bands(uuid, date, text, text) from public, anon, authenticated;

-- AUTOMATIC ALLOCATION, AS A PROPOSAL. Deterministic -- the same day gives the same plan -- and never a
-- clash to place everything. In this order:
--   1. hard rules first: every placement is asked of internal.arena_blockers (and keeps the club's gap
--      between matches);
--   2. locks are kept; 3. a person's allocation is kept (a re-run recalculates only automatic ones);
--   4-5. a team's preferences in order (pitch, then ground);
--   6. a fixture's home and away rooms together, adjacent where they can be;
--   7. a team stays on the pitch it already has that day; 8. a pitch already in use is filled before a
--      fresh one, and the smallest that fits before a bigger one;
--   9-10. then any valid resource; 11. otherwise it stays unallocated, and the proposal says why.
-- Training is placed on a pitch it may share with other training (no limit), and given a changing room
-- only when its team asked for one -- the team's home-room preference first, one team per room. What stays
-- unplaced is said exactly: who needs which room, and that every suitable room is taken then.
-- Nothing is written. Apply re-checks every part of it.
create or replace function public.preview_arena_allocation(p_club_id uuid, p_date date, p_venue_id uuid default null, p_rerun boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c record; p record; v_pol record;
  v_items jsonb := '[]'::jsonb;
  v_pitch_prefs uuid[]; v_venue_prefs uuid[]; v_home_prefs uuid[]; v_away_prefs uuid[]; v_off_prefs uuid[];
  v_chosen uuid; v_chosen_venue uuid; v_first_reason text; v_first_name text; v_reason text;
  v_pitch_outcome text; v_rooms_outcome text; v_explain text[];
  v_need_home boolean; v_need_away boolean; v_need_off boolean;
  v_home uuid; v_away uuid; v_off uuid; v_rooms_needed integer;
  v_any_room_locked boolean; v_units integer; v_mine integer;
  v_cur jsonb; v_prop jsonb; v_changes text[]; v_locked text[];
  v_pitch_src text; v_venue_src text; v_rule text;
  v_from integer; v_play_from integer; v_play_until integer; v_until integer; v_turn integer;
  v_hfrom integer; v_afrom integer; v_room_until integer; v_room_turn integer;
  v_new_ko integer; v_late boolean; v_slot integer; b record;
  v_ph uuid; v_pa uuid; v_room_venue uuid; v_who text; v_where text;
begin
  perform internal.require_live_session();
  if not internal.arena_can_manage(p_club_id) then
    raise exception 'You do not have permission to plan this club''s facilities.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Choose a day.' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = p_club_id and v.active) then
    raise exception 'That ground is not one of this club''s.' using errcode = '42501';
  end if;
  select * into v_pol from internal.arena_policy(p_club_id);
  perform internal.arena_load_day(p_club_id, p_date);

  create temp table if not exists arena_cand (
    kind text, id uuid, ord_from integer, units integer, needs_pitch boolean, redo_rooms boolean
  ) on commit drop;
  delete from pg_temp.arena_cand where true;  -- safeupdate: see internal.arena_load_day

  -- WHAT THIS RUN MAY PLACE: anything without a pitch, and on a re-run anything Arena placed itself that
  -- nobody has locked. A person's allocation is never in the list. A fixture with no kick-off yet is
  -- placed last and is proposed one inside the club's windows; a fixture's agreed time is never moved.
  insert into pg_temp.arena_cand
  select 'FIXTURE', a.id, coalesce(a.pitch_from, 2000), case a.footprint when 'quarter' then 1 when 'half' then 2 else 4 end,
         a.pitch_id is null or a.kickoff is null or (p_rerun and 'pitch' = any (a.auto_parts) and not ('pitch' = any (a.locks))),
         p_rerun
  from public.fixtures f
  join public.teams ht on ht.id = f.home_team_id and ht.club_id = p_club_id
  cross join lateral internal.arena_activity('FIXTURE', f.id) a
  where f.kickoff_date = p_date
    and f.archived_at is null and f.cancelled_at is null and f.status <> 'Cancelled'
    and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id)
    and (p_venue_id is null or f.venue_id is null or f.venue_id = p_venue_id);

  insert into pg_temp.arena_cand
  select 'TRAINING', a.id, a.pitch_from, 0,
         a.pitch_id is null or (p_rerun and 'pitch' = any (a.auto_parts) and not ('pitch' = any (a.locks))), p_rerun
  from public.training_sessions s
  cross join lateral internal.arena_activity('TRAINING', s.id) a
  where s.club_id = p_club_id and s.occurrence_date = p_date and s.status = 'PLANNED' and s.cancelled_at is null
    and s.start_time is not null
    and (p_venue_id is null or s.venue_id is null or s.venue_id = p_venue_id);

  -- What is being placed again lets go of what it held, so it is judged afresh.
  delete from pg_temp.arena_occ o
  using pg_temp.arena_cand c2
  where o.activity_id = c2.id and o.resource_type = 'PITCH' and c2.needs_pitch;
  delete from pg_temp.arena_occ o
  using pg_temp.arena_cand c2, public.fixtures f
  where c2.kind = 'FIXTURE' and c2.redo_rooms and f.id = c2.id and o.activity_id = c2.id and o.resource_type = 'ROOM'
    and case o.room_role when 'HOME' then 'home_room' when 'AWAY' then 'away_room' else 'officials_room' end = any (f.allocation_auto)
    and not (case o.room_role when 'HOME' then 'home_room' when 'AWAY' then 'away_room' else 'officials_room' end = any (f.allocation_locks));
  delete from pg_temp.arena_occ o
  using pg_temp.arena_cand c2, public.training_sessions ts
  where c2.kind = 'TRAINING' and c2.redo_rooms and ts.id = c2.id and o.activity_id = c2.id and o.resource_type = 'ROOM'
    and ts.changing_room_source = 'AUTO' and not ts.changing_room_locked;

  for c in
    select c2.needs_pitch, c2.redo_rooms, c2.units, c2.ord_from, a.*
    from pg_temp.arena_cand c2
    cross join lateral internal.arena_activity(c2.kind, c2.id) a
    order by c2.ord_from, c2.units desc, case c2.kind when 'FIXTURE' then 0 else 1 end, c2.id
  loop
    v_explain := '{}'; v_pitch_outcome := 'KEPT'; v_rooms_outcome := null; v_changes := '{}';
    v_from := c.pitch_from; v_play_from := c.play_from; v_play_until := c.play_until; v_until := c.pitch_until; v_turn := c.pitch_turn;
    v_hfrom := c.home_room_from; v_afrom := c.away_room_from; v_room_until := c.room_until; v_room_turn := c.room_turn;
    v_new_ko := null; v_late := false;
    v_chosen := c.pitch_id; v_chosen_venue := c.venue_id; v_first_reason := null; v_first_name := null;
    v_pitch_prefs := internal.facility_preference_ids(p_club_id, c.team_id, case when c.kind = 'FIXTURE' then 'MATCH_PITCH' else 'TRAINING_PITCH' end);
    v_venue_prefs := internal.facility_preference_ids(p_club_id, c.team_id, 'VENUE');
    v_pitch_src := internal.facility_preference_source(p_club_id, c.team_id, case when c.kind = 'FIXTURE' then 'MATCH_PITCH' else 'TRAINING_PITCH' end);
    v_venue_src := internal.facility_preference_source(p_club_id, c.team_id, 'VENUE');
    -- THE LIST THAT DECIDES: the team's own before the club's default; within each, a pitch before a ground.
    v_rule := case when v_pitch_src = 'TEAM' then 'PITCH' when v_venue_src = 'TEAM' then 'VENUE'
                   when v_pitch_src = 'CLUB' then 'PITCH' when v_venue_src = 'CLUB' then 'VENUE' end;
    v_any_room_locked := c.kind = 'FIXTURE' and c.locks && array['home_room', 'away_room', 'officials_room']::text[];
    v_mine := case c.footprint when 'quarter' then 1 when 'half' then 2 else 4 end;

    -- A FIXTURE WITH NO KICK-OFF YET: the earliest slot in the club's windows on the best pitch with room,
    -- pitch by pitch in preference order, band by band -- the board's own order.
    if c.kind = 'FIXTURE' and c.kickoff is null then
      v_chosen := null;
      <<bands>>
      for b in select * from internal.arena_kickoff_bands(p_club_id, p_date, c.age_group, c.category) order by band loop
        for p in
          select pp.* from public.club_pitches pp
          join public.venues v on v.id = pp.venue_id and v.active
          where pp.club_id = p_club_id and pp.active and (p_venue_id is null or pp.venue_id = p_venue_id)
            and (not v_any_room_locked or pp.venue_id is not distinct from c.venue_id)
            and (c.footprint is null
                 or (case pp.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                          else greatest(1, least(4, round(coalesce(pp.custom_length_m * pp.custom_width_m, 7000) / 7000.0 * 4)::integer)) end) >= v_mine)
          order by
            case when v_pitch_src = 'TEAM' then coalesce(array_position(v_pitch_prefs, pp.id), 1000) else 1000 end,
            case when v_venue_src = 'TEAM' then coalesce(array_position(v_venue_prefs, pp.venue_id), 1000) else 1000 end,
            case when v_pitch_src = 'CLUB' then coalesce(array_position(v_pitch_prefs, pp.id), 1000) else 1000 end,
            case when v_venue_src = 'CLUB' then coalesce(array_position(v_venue_prefs, pp.venue_id), 1000) else 1000 end,
            case when pp.venue_id = c.venue_id then 0 else 1 end,
            pp.sort_order, pp.display_name, pp.id
        loop
          v_slot := b.starts;
          while v_slot + c.play_minutes <= b.ends loop
            if not exists (select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'PITCH', p.id,
                                greatest(v_slot - v_pol.warm_up, 0), v_slot, v_slot + c.play_minutes,
                                least(v_slot + c.play_minutes + v_pol.pack_up, 1440),
                                least(v_slot + c.play_minutes + v_pol.pack_up + v_pol.turnaround, 1440), c.footprint, v_pol.turnaround)) then
              v_chosen := p.id; v_chosen_venue := p.venue_id; v_new_ko := v_slot; v_late := b.late;
              exit bands;
            end if;
            v_slot := v_slot + 15;
          end loop;
        end loop;
      end loop;
      if v_new_ko is not null then
        v_from := greatest(v_new_ko - v_pol.warm_up, 0); v_play_from := v_new_ko; v_play_until := v_new_ko + c.play_minutes;
        v_until := least(v_play_until + v_pol.pack_up, 1440); v_turn := least(v_until + v_pol.turnaround, 1440);
        v_hfrom := greatest(v_new_ko - v_pol.room_access, 0); v_afrom := v_hfrom;
        v_room_until := least(v_play_until + v_pol.room_release, 1440); v_room_turn := least(v_room_until + v_pol.room_turnaround, 1440);
        insert into pg_temp.arena_occ (activity_type, activity_id, label, team_id, day, venue_id, resource_type, resource_id,
                                       occupied_from, play_from, play_until, occupied_until, turnaround_until, footprint, locked, proposed)
        values ('FIXTURE', c.id, c.label, c.team_id, p_date, v_chosen_venue, 'PITCH', v_chosen,
                v_from, v_play_from, v_play_until, v_until, v_turn, c.footprint, false, true);
        v_pitch_outcome := case when v_rule is null then 'AVAILABLE'
                                when v_rule = 'PITCH' and v_chosen = v_pitch_prefs[1] then 'FIRST_PREFERENCE'
                                when v_rule = 'VENUE' and v_chosen_venue = v_venue_prefs[1] then 'FIRST_PREFERENCE'
                                else 'ALTERNATIVE' end;
        v_explain := v_explain || format('No kick-off time yet: proposed %s on %s.', internal.clock(v_new_ko),
                                         (select pp.display_name from public.club_pitches pp where pp.id = v_chosen));
        if v_late then
          v_explain := v_explain || format('Proposed at %s because no morning slot was free for this age group.', internal.clock(v_new_ko));
        end if;
      else
        v_pitch_outcome := 'UNRESOLVED';
        v_explain := v_explain || 'No kick-off time yet, and no pitch has a free slot in the club''s kick-off windows.'::text;
      end if;
    elsif c.needs_pitch then
      v_chosen := null;
      for p in
        select pp.*, v.is_default_home,
               case pp.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                    else greatest(1, least(4, round(coalesce(pp.custom_length_m * pp.custom_width_m, 7000) / 7000.0 * 4)::integer)) end as units
        from public.club_pitches pp
        join public.venues v on v.id = pp.venue_id and v.active
        where pp.club_id = p_club_id and pp.active
          and (p_venue_id is null or pp.venue_id = p_venue_id)
          -- A pitch too small for the match is never a candidate.
          and (c.kind <> 'FIXTURE' or c.footprint is null
               or (case pp.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                        else greatest(1, least(4, round(coalesce(pp.custom_length_m * pp.custom_width_m, 7000) / 7000.0 * 4)::integer)) end) >= v_mine)
          -- A room or pitch somebody locked holds the match at its ground.
          and (not v_any_room_locked or pp.venue_id is not distinct from c.venue_id)
        order by
          case when v_pitch_src = 'TEAM' then coalesce(array_position(v_pitch_prefs, pp.id), 1000) else 1000 end,
          case when v_venue_src = 'TEAM' then coalesce(array_position(v_venue_prefs, pp.venue_id), 1000) else 1000 end,
          case when v_pitch_src = 'CLUB' then coalesce(array_position(v_pitch_prefs, pp.id), 1000) else 1000 end,
          case when v_venue_src = 'CLUB' then coalesce(array_position(v_venue_prefs, pp.venue_id), 1000) else 1000 end,
          case when pp.venue_id = c.venue_id then 0 else 1 end,
          case when exists (select 1 from pg_temp.arena_occ o where o.resource_type = 'PITCH' and o.resource_id = pp.id
                            and o.team_id = c.team_id and c.team_id is not null) then 0 else 1 end,
          case when c.kind = 'FIXTURE' and coalesce(pp.lane_count, 1) > 1
                    and exists (select 1 from pg_temp.arena_occ o where o.resource_type = 'PITCH' and o.resource_id = pp.id
                                and o.activity_type = 'FIXTURE' and o.occupied_from < v_until and v_from < o.occupied_until)
               then 0 else 1 end,
          case when c.kind = 'FIXTURE' then
                 (case pp.physical_size_category when 'full' then 4 when 'three_quarter' then 3 when 'half' then 2
                       else greatest(1, least(4, round(coalesce(pp.custom_length_m * pp.custom_width_m, 7000) / 7000.0 * 4)::integer)) end) - v_mine
               else 0 end,
          pp.sort_order, pp.display_name, pp.id
      loop
        select bl.message into v_reason
        from internal.arena_blockers(c.kind, c.id, c.label, 'PITCH', p.id, v_from, v_play_from, v_play_until,
                                     v_until, v_turn, c.footprint,
                                     case when c.kind = 'FIXTURE' then v_pol.turnaround else 0 end) bl
        order by case bl.code when 'PITCH_INACTIVE' then 1 when 'PITCH_TOO_SMALL' then 2 else 3 end
        limit 1;
        if v_first_name is null then
          v_first_name := p.display_name; v_first_reason := v_reason;
        end if;
        if v_reason is null then
          v_chosen := p.id; v_chosen_venue := p.venue_id;
          exit;
        end if;
      end loop;

      if v_chosen is null then
        v_pitch_outcome := 'UNRESOLVED';
        v_explain := v_explain || (format('No pitch is free %s. ', internal.arena_window(v_from, v_until))
                                   || coalesce(v_first_reason, 'No active pitch is suitable.'));
      else
        insert into pg_temp.arena_occ (activity_type, activity_id, label, team_id, day, venue_id, resource_type, resource_id,
                                       occupied_from, play_from, play_until, occupied_until, turnaround_until, footprint, locked, proposed)
        values (c.kind, c.id, c.label, c.team_id, p_date, v_chosen_venue, 'PITCH', v_chosen,
                v_from, v_play_from, v_play_until, v_until, v_turn, c.footprint, false, true);
        if v_rule is null then
          v_pitch_outcome := 'AVAILABLE';
          v_explain := v_explain || format('%s (no pitch preference set).', (select pp.display_name from public.club_pitches pp where pp.id = v_chosen));
        elsif v_rule = 'PITCH' and v_chosen = v_pitch_prefs[1] then
          v_pitch_outcome := 'FIRST_PREFERENCE';
          v_explain := v_explain || format('%s, first preference.', (select pp.display_name from public.club_pitches pp where pp.id = v_chosen));
        elsif v_rule = 'VENUE' and v_chosen_venue = v_venue_prefs[1] then
          v_pitch_outcome := 'FIRST_PREFERENCE';
          v_explain := v_explain || format('%s at %s, the first preferred ground.',
                                           (select pp.display_name from public.club_pitches pp where pp.id = v_chosen),
                                           (select v.name from public.venues v where v.id = v_chosen_venue));
        elsif v_rule = 'PITCH' then
          v_pitch_outcome := 'ALTERNATIVE';
          v_explain := v_explain || (coalesce(
                (select bl.message from internal.arena_blockers(c.kind, c.id, c.label, 'PITCH', v_pitch_prefs[1], v_from, v_play_from,
                        v_play_until, v_until, v_turn, c.footprint, case when c.kind = 'FIXTURE' then v_pol.turnaround else 0 end) bl
                 order by case bl.code when 'PITCH_INACTIVE' then 1 when 'PITCH_TOO_SMALL' then 2 else 3 end limit 1),
                format('%s is not available.', (select pp.display_name from public.club_pitches pp where pp.id = v_pitch_prefs[1])))
             || format(' Proposed: %s.', (select pp.display_name from public.club_pitches pp where pp.id = v_chosen)));
        else
          v_pitch_outcome := 'ALTERNATIVE';
          v_explain := v_explain || format('No suitable pitch at %s is free %s. Proposed: %s at %s.',
                                           (select v.name from public.venues v where v.id = v_venue_prefs[1]),
                                           internal.arena_window(v_from, v_until),
                                           (select pp.display_name from public.club_pitches pp where pp.id = v_chosen),
                                           (select v.name from public.venues v where v.id = v_chosen_venue));
        end if;
        if v_chosen_venue is distinct from c.venue_id and c.venue_id is not null then
          v_explain := v_explain || format('Moves to %s.', (select v.name from public.venues v where v.id = v_chosen_venue));
        end if;
      end if;
    end if;

    -- ROOMS, for a home fixture at a ground that has them.
    v_home := c.home_room_id; v_away := c.away_room_id; v_off := c.officials_room_id;
    -- (Rooms are planned for a time: a fixture still without a kick-off gets none.)
    if c.kind = 'FIXTURE' and v_chosen_venue is not null and not c.no_changing_rooms and v_from is not null then
      v_rooms_needed := internal.arena_team_rooms_needed(v_chosen_venue);
      v_home_prefs := internal.facility_preference_ids(p_club_id, c.team_id, 'HOME_ROOM');
      v_away_prefs := internal.facility_preference_ids(p_club_id, c.team_id, 'AWAY_ROOM');
      v_off_prefs := internal.facility_preference_ids(p_club_id, c.team_id, 'OFFICIALS_ROOM');
      -- A room at the old ground goes with the old ground.
      if v_chosen_venue is distinct from c.venue_id then
        if not ('home_room' = any (c.locks)) then v_home := null; end if;
        if not ('away_room' = any (c.locks)) then v_away := null; end if;
        if not ('officials_room' = any (c.locks)) then v_off := null; end if;
      end if;
      -- A room is placed when it is missing, or on a re-run when Arena placed it; a person's room stays.
      v_need_home := v_rooms_needed >= 1 and not ('home_room' = any (c.locks))
                     and (v_home is null or (c.redo_rooms and 'home_room' = any (c.auto_parts)));
      v_need_away := v_rooms_needed >= 2 and not ('away_room' = any (c.locks))
                     and (v_away is null or (c.redo_rooms and 'away_room' = any (c.auto_parts)));
      v_need_off := cardinality(v_off_prefs) > 0 and not ('officials_room' = any (c.locks))
                    and (v_off is null or (c.redo_rooms and 'officials_room' = any (c.auto_parts)));

      if v_need_home or v_need_away then
        select h.id, a2.id into v_ph, v_pa
        from (select r.id, r.sort_order, coalesce(array_position(v_home_prefs, r.id), 100) as rk
              from public.venue_changing_rooms r
              where r.venue_id = v_chosen_venue and r.active and r.room_type <> 'match_officials'
                and (not v_need_home or not exists (
                     select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', r.id, v_hfrom, v_play_from,
                                                            v_play_until, v_room_until, v_room_turn, null, 0)))
                and (v_need_home or r.id = v_home)) h
        join (select r.id, r.sort_order, coalesce(array_position(v_away_prefs, r.id), 100) as rk
              from public.venue_changing_rooms r
              where r.venue_id = v_chosen_venue and r.active and r.room_type <> 'match_officials'
                and (not v_need_away or not exists (
                     select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', r.id, v_afrom, v_play_from,
                                                            v_play_until, v_room_until, v_room_turn, null, 0)))
                and (v_need_away or r.id is not distinct from v_away)
              union all
              select null::uuid, 0, 0 where v_rooms_needed < 2 and v_away is null) a2
          on a2.id is distinct from h.id
        order by h.rk + a2.rk, abs(h.sort_order - a2.sort_order), h.sort_order, a2.sort_order, h.id, a2.id
        limit 1;
        if not found then
          -- NO PAIR IS FREE TOGETHER. A side that already has its room keeps it; the home side is given a room
          -- on its own if one is free; and the proposal says exactly which side is left without one, and why.
          if v_need_home then
            select r.id into v_home
            from public.venue_changing_rooms r
            where r.venue_id = v_chosen_venue and r.active and r.room_type <> 'match_officials'
              and r.id is distinct from (case when v_need_away then null else v_away end)
              and not exists (select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', r.id, v_hfrom, v_play_from,
                                                                    v_play_until, v_room_until, v_room_turn, null, 0))
            order by coalesce(array_position(v_home_prefs, r.id), 100), r.sort_order, r.id
            limit 1;
          end if;
          if v_need_away then
            select r.id into v_away
            from public.venue_changing_rooms r
            where v_rooms_needed >= 2 and r.venue_id = v_chosen_venue and r.active and r.room_type <> 'match_officials'
              and r.id is distinct from v_home
              and not exists (select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', r.id, v_afrom, v_play_from,
                                                                    v_play_until, v_room_until, v_room_turn, null, 0))
            order by coalesce(array_position(v_away_prefs, r.id), 100), r.sort_order, r.id
            limit 1;
          end if;
          v_rooms_outcome := 'UNRESOLVED';
          v_who := coalesce((select t.display_name from public.teams t where t.id = c.team_id), c.label);
          v_where := (select v.name from public.venues v where v.id = v_chosen_venue);
          v_explain := v_explain || format('%s needs %s. Every suitable room at %s is taken %s.', v_who,
            case when v_home is null and v_away is null and v_rooms_needed >= 2 then 'home and away changing rooms'
                 when v_home is null then 'a home changing room'
                 else 'an away changing room' end,
            v_where,
            internal.arena_window(case when v_home is null then v_hfrom else v_afrom end, v_room_until));
        else
          v_home := v_ph; v_away := v_pa;
          v_rooms_outcome := case
            when cardinality(v_home_prefs) = 0 and cardinality(v_away_prefs) = 0 then 'AVAILABLE'
            when (cardinality(v_home_prefs) = 0 or v_home = v_home_prefs[1] or not v_need_home)
             and (cardinality(v_away_prefs) = 0 or v_away is not distinct from v_away_prefs[1] or not v_need_away) then 'FIRST_PREFERENCE'
            else 'ALTERNATIVE' end;
          -- A preferred room passed over says why, in the engine's own words -- as a passed-over pitch does.
          v_explain := v_explain || (
            case when v_rooms_outcome = 'ALTERNATIVE' then
              coalesce(
                (select bl.message
                 from (select v_home_prefs[1] as id, v_hfrom as from_minute, 1 as n
                       where v_need_home and cardinality(v_home_prefs) > 0 and v_home is distinct from v_home_prefs[1]
                       union all
                       select v_away_prefs[1], v_afrom, 2
                       where v_need_away and cardinality(v_away_prefs) > 0 and v_away is distinct from v_away_prefs[1]) pref
                 cross join lateral internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', pref.id, pref.from_minute, v_play_from,
                                                            v_play_until, v_room_until, v_room_turn, null, 0) bl
                 order by pref.n
                 limit 1),
                'The preferred changing rooms are not free together.') || ' Proposed: '
            else '' end
            || concat_ws(' and ',
              (select r.display_name || ' (home)' from public.venue_changing_rooms r where r.id = v_home),
              (select r.display_name || ' (away)' from public.venue_changing_rooms r where r.id = v_away)) || '.');
        end if;
      end if;

      if v_need_off then
        select r.id into v_off
        from public.venue_changing_rooms r
        where r.venue_id = v_chosen_venue and r.active and r.id is distinct from v_home and r.id is distinct from v_away
          and not exists (select 1 from internal.arena_blockers('FIXTURE', c.id, c.label, 'ROOM', r.id, v_afrom, v_play_from,
                                                                v_play_until, v_room_until, v_room_turn, null, 0))
        order by coalesce(array_position(v_off_prefs, r.id), 100), (r.room_type = 'match_officials') desc, r.sort_order, r.id
        limit 1;
        if v_off is null then
          v_explain := v_explain || 'No room is free for the match officials.'::text;
        end if;
      end if;

      -- What this plan now holds is taken before the next activity is placed.
      insert into pg_temp.arena_occ (activity_type, activity_id, label, team_id, day, venue_id, resource_type, resource_id, room_role,
                                     occupied_from, play_from, play_until, occupied_until, turnaround_until, locked, proposed)
      select 'FIXTURE', c.id, c.label, c.team_id, p_date, v_chosen_venue, 'ROOM', x.room, x.role,
             case when x.role = 'HOME' then v_hfrom else v_afrom end,
             v_play_from, v_play_until, v_room_until, v_room_turn, false, true
      from (values (v_home, 'HOME'), (v_away, 'AWAY'), (v_off, 'OFFICIALS')) x(room, role)
      where x.room is not null
        and not exists (select 1 from pg_temp.arena_occ o where o.activity_id = c.id and o.resource_type = 'ROOM'
                        and o.resource_id = x.room and o.room_role = x.role);
    end if;

    -- A TRAINING SESSION'S CHANGING ROOM, only when its team asked for one: at the session's venue (where its
    -- pitch is), the team's home-room preference first, one team per room. A room at another venue stays
    -- there; a person's room and a locked room stay as they are.
    if c.kind = 'TRAINING' and c.needs_room and v_from is not null then
      v_room_venue := coalesce(v_chosen_venue, c.venue_id);
      if v_home is not null and not ('home_room' = any (c.locks))
         and (select r.venue_id from public.venue_changing_rooms r where r.id = v_home) is distinct from v_room_venue then
        v_home := null;
      end if;
      if v_room_venue is not null and internal.arena_team_rooms_needed(v_room_venue) >= 1 and not ('home_room' = any (c.locks))
         and (v_home is null or (c.redo_rooms and 'home_room' = any (c.auto_parts))) then
        v_home_prefs := internal.facility_preference_ids(p_club_id, c.team_id, 'HOME_ROOM');
        select r.id into v_home
        from public.venue_changing_rooms r
        where r.venue_id = v_room_venue and r.active and r.room_type <> 'match_officials'
          and not exists (select 1 from internal.arena_blockers('TRAINING', c.id, c.label, 'ROOM', r.id, v_hfrom, v_play_from,
                                                                v_play_until, v_room_until, v_room_turn, null, 0))
        order by coalesce(array_position(v_home_prefs, r.id), 100), r.sort_order, r.id
        limit 1;
        if v_home is null then
          v_rooms_outcome := 'UNRESOLVED';
          v_explain := v_explain || format('%s needs a changing room. Every suitable room at %s is taken %s.',
            coalesce((select t.display_name from public.teams t where t.id = c.team_id), regexp_replace(c.label, ' training$', '')),
            (select v.name from public.venues v where v.id = v_room_venue),
            internal.arena_window(v_hfrom, v_room_until));
        else
          v_rooms_outcome := case when cardinality(v_home_prefs) = 0 then 'AVAILABLE'
                                  when v_home = v_home_prefs[1] then 'FIRST_PREFERENCE' else 'ALTERNATIVE' end;
          v_explain := v_explain || format('%s for the team''s changing room.',
            (select r.display_name from public.venue_changing_rooms r where r.id = v_home));
          insert into pg_temp.arena_occ (activity_type, activity_id, label, team_id, day, venue_id, resource_type, resource_id, room_role,
                                         occupied_from, play_from, play_until, occupied_until, turnaround_until, locked, proposed)
          values ('TRAINING', c.id, c.label, c.team_id, p_date, v_room_venue, 'ROOM', v_home, 'TRAINING',
                  v_hfrom, v_play_from, v_play_until, v_room_until, v_room_turn, false, true);
        end if;
      end if;
    end if;

    -- A PERSON'S LOCK IS SAID, first, so a re-run's review shows why a part was left exactly where it is.
    v_locked := array_remove(array[
      case when 'pitch' = any (c.locks) then 'the pitch' end,
      case when 'home_room' = any (c.locks) then case when c.kind = 'TRAINING' then 'the changing room' else 'the home changing room' end end,
      case when 'away_room' = any (c.locks) then 'the away changing room' end,
      case when 'officials_room' = any (c.locks) then 'the officials room' end], null);
    if cardinality(v_locked) > 0 then
      v_explain := array[format('Locked: %s %s.',
                                case when cardinality(v_locked) = 1 then v_locked[1]
                                     else array_to_string(v_locked[1:cardinality(v_locked) - 1], ', ') || ' and ' || v_locked[cardinality(v_locked)] end,
                                case when cardinality(v_locked) = 1 then 'stays as it is' else 'stay as they are' end)] || v_explain;
    end if;

    v_cur := jsonb_build_object('venueId', c.venue_id, 'pitchId', c.pitch_id, 'homeRoomId', c.home_room_id,
                                'awayRoomId', c.away_room_id, 'officialsRoomId', c.officials_room_id);
    v_prop := jsonb_build_object('venueId', v_chosen_venue, 'pitchId', v_chosen, 'homeRoomId', v_home,
                                 'awayRoomId', v_away, 'officialsRoomId', v_off);
    if c.kind = 'FIXTURE' and c.kickoff is null then
      v_cur := v_cur || jsonb_build_object('kickoff', null);
      if v_new_ko is not null then
        v_prop := v_prop || jsonb_build_object('kickoff', internal.clock(v_new_ko));
        v_changes := v_changes || 'KICKOFF'::text;
      end if;
    end if;
    if v_chosen_venue is distinct from c.venue_id then v_changes := v_changes || 'VENUE'::text; end if;
    if v_chosen is distinct from c.pitch_id then v_changes := v_changes || 'PITCH'::text; end if;
    if v_home is distinct from c.home_room_id or v_away is distinct from c.away_room_id or v_off is distinct from c.officials_room_id then
      v_changes := v_changes || 'ROOMS'::text;
    end if;

    v_items := v_items || jsonb_build_object(
      -- A title, so Title Case ("Under 8 Mixed Training"); the label stays lower case inside sentences.
      'kind', c.kind, 'id', c.id, 'teamId', c.team_id,
      'title', case when c.kind = 'TRAINING' then regexp_replace(c.label, ' training$', ' Training') else c.label end,
      'window', case when v_from is null then 'No kick-off time yet' else internal.arena_window(v_from, v_until) end,
      'current', v_cur, 'proposed', v_prop, 'changes', to_jsonb(v_changes),
      'pitchOutcome', v_pitch_outcome, 'roomsOutcome', v_rooms_outcome,
      'outcome', case
         when v_pitch_outcome = 'UNRESOLVED' or v_rooms_outcome = 'UNRESOLVED' then 'UNRESOLVED'
         when cardinality(v_changes) = 0 then 'UNCHANGED'
         when 'ALTERNATIVE' in (v_pitch_outcome, coalesce(v_rooms_outcome, '')) then 'ALTERNATIVE'
         when 'FIRST_PREFERENCE' in (v_pitch_outcome, coalesce(v_rooms_outcome, '')) then 'FIRST_PREFERENCE'
         else 'NO_PREFERENCE' end,
      'explanation', to_jsonb(v_explain));
  end loop;

  return jsonb_build_object(
    'date', p_date, 'venueId', p_venue_id, 'rerun', p_rerun, 'items', v_items,
    'summary', jsonb_build_object(
      'firstPreferences', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'outcome' = 'FIRST_PREFERENCE'),
      'alternatives', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'outcome' = 'ALTERNATIVE'),
      'noPreference', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'outcome' = 'NO_PREFERENCE'),
      'unresolved', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'outcome' = 'UNRESOLVED'),
      'unchanged', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'outcome' = 'UNCHANGED'),
      'pitchChanges', (select count(*) from jsonb_array_elements(v_items) i where i -> 'changes' ? 'PITCH'),
      'kickoffProposals', (select count(*) from jsonb_array_elements(v_items) i where i -> 'changes' ? 'KICKOFF'),
      'roomChanges', (select count(*) from jsonb_array_elements(v_items) i where i -> 'changes' ? 'ROOMS'),
      'venueChanges', (select count(*) from jsonb_array_elements(v_items) i where i -> 'changes' ? 'VENUE')));
end;
$function$;
revoke all on function public.preview_arena_allocation(uuid, date, uuid, boolean) from public, anon;
grant execute on function public.preview_arena_allocation(uuid, date, uuid, boolean) to authenticated;

-- A FIXTURE WITH A PITCH AND A KICK-OFF IS BOOKED; one that has lost either is planned again. The same
-- lifecycle update_fixture_schedule has always applied, for an allocation Arena makes through the Match
-- Centre's writer.
create or replace function internal.fixture_sync_booking_status(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare f public.fixtures; v_new text;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if f.id is null or f.status not in ('Planned', 'Booked', 'To Be Determined') then return; end if;
  if f.pitch_id is not null and f.kickoff_time is not null then
    v_new := 'Booked';
  elsif f.status = 'Booked' then
    v_new := case when f.home_away = 'TBD' then 'To Be Determined' else 'Planned' end;
  else
    v_new := f.status;
  end if;
  if v_new is distinct from f.status then
    update public.fixtures set status = v_new where id = any (internal.fixture_pair_ids(p_fixture_id));
  end if;
end;
$function$;
revoke all on function internal.fixture_sync_booking_status(uuid) from public, anon, authenticated;

-- APPLY A PLAN: an automatic proposal, or a person's own changes, as one transaction through the same
-- writers the Match Centre and Training use. Each change names what it expects to find; if somebody has
-- changed it since, the whole plan is refused rather than applied over them. The finished arrangement is
-- checked once by the engine, so a plan never leaves a clash it caused. Each person affected hears once
-- per fixture; nobody hears about their own change; a training team hears once about its session.
create or replace function public.apply_arena_allocation(p_club_id uuid, p_date date, p_changes jsonb, p_source text default 'MANUAL')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ch jsonb; e jsonb; s jsonb;
  a record; f public.fixtures; t public.training_sessions;
  v_before text[];
  v_subjects uuid[] := '{}';
  v_batch uuid; v_notified integer := 0; v_applied integer := 0;
  v_venue uuid; v_pitch uuid; v_kickoff time; v_patch jsonb;
  v_pitch_venue uuid; v_label text;
  v_start time; v_room uuid; v_room_venue uuid; v_told boolean;
  v_proposed uuid[] := '{}';
  -- Whose decision each change is: its own `source` when it says (a plan can hold a person's changes and
  -- automatic ones together, still one transaction), otherwise the plan's.
  v_source text;
begin
  perform internal.require_live_session();
  if not internal.arena_can_manage(p_club_id) then
    raise exception 'You do not have permission to plan this club''s facilities.' using errcode = '42501';
  end if;
  if p_source not in ('MANUAL', 'AUTO') then
    raise exception 'Say whether this plan is a person''s or automatic.' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'Nothing to apply.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 200 then
    raise exception 'Apply up to 200 changes at a time.' using errcode = '22023';
  end if;

  v_before := internal.arena_conflict_keys(p_club_id, array[p_date]);
  perform set_config('ovalball.allocation_source', p_source, true);
  perform set_config('ovalball.arena_batch', 'on', true);

  for ch in select value from jsonb_array_elements(p_changes) loop
    e := coalesce(ch -> 'expected', '{}'::jsonb);
    s := coalesce(ch -> 'set', '{}'::jsonb);
    v_source := coalesce(nullif(ch ->> 'source', ''), p_source);
    if v_source not in ('MANUAL', 'AUTO') then
      raise exception 'Say whether this plan is a person''s or automatic.' using errcode = '22023';
    end if;
    perform set_config('ovalball.allocation_source', v_source, true);
    select * into a from internal.arena_activity(ch ->> 'kind', nullif(ch ->> 'id', '')::uuid);
    if a.id is null or a.club_id is distinct from p_club_id or a.day is distinct from p_date then
      raise exception 'One of these changes is not for this club''s day.' using errcode = '42501';
    end if;

    -- NOBODY'S CHANGE IS APPLIED OVER: each part this plan read must still be what it read.
    if (e ? 'venueId' and nullif(e ->> 'venueId', '')::uuid is distinct from a.venue_id)
       or (e ? 'pitchId' and nullif(e ->> 'pitchId', '')::uuid is distinct from a.pitch_id)
       or (e ? 'homeRoomId' and nullif(e ->> 'homeRoomId', '')::uuid is distinct from a.home_room_id)
       or (e ? 'awayRoomId' and nullif(e ->> 'awayRoomId', '')::uuid is distinct from a.away_room_id)
       or (e ? 'officialsRoomId' and nullif(e ->> 'officialsRoomId', '')::uuid is distinct from a.officials_room_id)
       or (e ? 'kickoff' and nullif(e ->> 'kickoff', '') is distinct from a.kickoff) then
      raise exception '% has changed since this plan was made. Refresh Arena Planning and plan it again.', a.label
        using errcode = '22023', hint = 'ARENA_STALE';
    end if;

    if a.kind = 'FIXTURE' then
      -- Automatic allocation never moves what somebody locked.
      if v_source = 'AUTO' and (
           ('pitch' = any (a.locks) and ((s ? 'pitchId' and nullif(s ->> 'pitchId', '')::uuid is distinct from a.pitch_id)
                                         or (s ? 'venueId' and nullif(s ->> 'venueId', '')::uuid is distinct from a.venue_id)))
        or ('home_room' = any (a.locks) and s ? 'homeRoomId' and nullif(s ->> 'homeRoomId', '')::uuid is distinct from a.home_room_id)
        or ('away_room' = any (a.locks) and s ? 'awayRoomId' and nullif(s ->> 'awayRoomId', '')::uuid is distinct from a.away_room_id)
        or ('officials_room' = any (a.locks) and s ? 'officialsRoomId' and nullif(s ->> 'officialsRoomId', '')::uuid is distinct from a.officials_room_id)) then
        raise exception '% is locked. Unlock it to let automatic allocation change it.', a.label using errcode = '22023', hint = 'ARENA_LOCKED';
      end if;

      select * into f from public.fixtures where id = a.id;
      v_venue := case when s ? 'venueId' then nullif(s ->> 'venueId', '')::uuid else f.venue_id end;
      v_pitch := case when s ? 'pitchId' then nullif(s ->> 'pitchId', '')::uuid else f.pitch_id end;
      v_kickoff := case when s ? 'kickoff' then nullif(s ->> 'kickoff', '')::time else f.kickoff_time end;
      if v_pitch is not null then
        select pp.venue_id into v_pitch_venue from public.club_pitches pp where pp.id = v_pitch and pp.club_id = p_club_id;
        if v_pitch_venue is null then
          raise exception 'That pitch is not one of this club''s.' using errcode = '42501';
        end if;
        v_venue := coalesce(v_venue, v_pitch_venue);
        if v_venue is distinct from v_pitch_venue then
          v_venue := v_pitch_venue;
        end if;
      end if;

      v_batch := gen_random_uuid();
      perform set_config('ovalball.notice_batch', v_batch::text, true);
      v_patch := '{}'::jsonb;
      if v_kickoff is distinct from f.kickoff_time then
        -- A MOVE IN TIME goes through the schedule writer, which proposes it to an opposition on Ovalball.
        perform public.update_fixture_schedule(a.id, f.kickoff_date, v_kickoff, v_venue, v_pitch, null, 'ARENA');
        select * into f from public.fixtures where id = a.id;
        -- With an opposition on Ovalball the new time is proposed to it, not applied: say which.
        if f.kickoff_amendment_proposed_date is not null then v_proposed := v_proposed || a.id; end if;
      elsif v_venue is distinct from f.venue_id or v_pitch is distinct from f.pitch_id then
        -- A ground or pitch alone goes through the Match Centre's own writer, which leaves a kick-off
        -- proposal in progress alone and says where the match is.
        v_patch := jsonb_build_object('venue_id', v_venue, 'pitch_id', v_pitch);
      end if;
      if s ? 'homeRoomId' and nullif(s ->> 'homeRoomId', '')::uuid is distinct from f.home_changing_room_id then
        v_patch := v_patch || jsonb_build_object('home_room_id', s ->> 'homeRoomId');
      end if;
      if s ? 'awayRoomId' and nullif(s ->> 'awayRoomId', '')::uuid is distinct from f.away_changing_room_id then
        v_patch := v_patch || jsonb_build_object('away_room_id', s ->> 'awayRoomId');
      end if;
      if s ? 'officialsRoomId' and nullif(s ->> 'officialsRoomId', '')::uuid is distinct from f.officials_changing_room_id then
        v_patch := v_patch || jsonb_build_object('officials_room_id', s ->> 'officialsRoomId');
      end if;
      if v_patch <> '{}'::jsonb then
        perform public.set_fixture_facilities(a.id, v_patch);
      end if;
      perform internal.fixture_sync_booking_status(a.id);
      perform set_config('ovalball.notice_batch', '', true);
      v_notified := v_notified + internal.flush_notice_batch(v_batch);
      v_subjects := v_subjects || internal.fixture_pair_ids(a.id);
    else
      select * into t from public.training_sessions where id = a.id;
      -- Automatic allocation never moves what somebody locked, and never moves a session's time.
      if v_source = 'AUTO' and (
           (t.pitch_locked and s ? 'pitchId' and nullif(s ->> 'pitchId', '')::uuid is distinct from t.pitch_id)
        or (t.changing_room_locked and s ? 'homeRoomId' and nullif(s ->> 'homeRoomId', '')::uuid is distinct from t.changing_room_id)) then
        raise exception '% is locked. Unlock it to let automatic allocation change it.', a.label using errcode = '22023', hint = 'ARENA_LOCKED';
      end if;
      v_start := case when s ? 'kickoff' then nullif(s ->> 'kickoff', '')::time else t.start_time end;
      if v_source = 'AUTO' and v_start is distinct from t.start_time then
        raise exception 'Automatic allocation does not move a training session''s time.' using errcode = '22023';
      end if;
      if v_start is null and t.start_time is not null then
        raise exception '% keeps a start time: choose another time instead.', a.label using errcode = '22023';
      end if;
      v_pitch := case when s ? 'pitchId' then nullif(s ->> 'pitchId', '')::uuid else t.pitch_id end;
      if v_pitch is distinct from t.pitch_id and v_pitch is not null
         and not exists (select 1 from public.club_pitches pp where pp.id = v_pitch and pp.club_id = p_club_id and pp.active) then
        raise exception 'That pitch is not one of this club''s, or is switched off.' using errcode = '42501';
      end if;
      v_venue := coalesce((select pp.venue_id from public.club_pitches pp where pp.id = v_pitch), t.venue_id);

      -- THE CHANGING ROOM: only for a session whose team asked for one, at the session's own venue. A room
      -- left at another venue when the session moves there goes back (as a fixture's does).
      v_room := case when s ? 'homeRoomId' then nullif(s ->> 'homeRoomId', '')::uuid else t.changing_room_id end;
      if v_room is not null then
        select r.venue_id into v_room_venue from public.venue_changing_rooms r where r.id = v_room and r.club_id = p_club_id;
        if v_room_venue is null then
          raise exception 'That changing room is not one of this club''s.' using errcode = '42501';
        end if;
        if s ? 'homeRoomId' and v_room is distinct from t.changing_room_id then
          if not a.needs_room then
            raise exception '% has not asked for a changing room. Its team asks for one in the Training Centre.', a.label using errcode = '22023';
          end if;
          if not exists (select 1 from public.venue_changing_rooms r where r.id = v_room and r.active) then
            raise exception 'That changing room is switched off.' using errcode = '22023';
          end if;
          if v_room_venue is distinct from v_venue then
            raise exception 'That changing room is at another venue from %.', a.label using errcode = '22023';
          end if;
        elsif v_room_venue is distinct from v_venue then
          v_room := null;
        end if;
      end if;

      -- 1. A NEW TIME goes through the Training Centre's own writer: it checks that this person manages this
      --    team's training, refuses a session that has happened, keeps the session's length, makes the change
      --    this session's own, and tells the team -- so Arena never moves a time the Training Centre would not.
      --    (Its own estate check stands aside inside this plan; the whole plan is checked once at the end.)
      v_told := false;
      if v_start is distinct from t.start_time then
        perform public.override_training_session(
          p_session_id => a.id,
          p_start_time => v_start,
          p_duration_minutes => coalesce(t.duration_minutes,
                                         case when t.end_time is not null and t.start_time is not null
                                              then internal.minute_of(t.end_time) - internal.minute_of(t.start_time) end, 60),
          p_venue_id => case when v_pitch is not null and v_pitch is distinct from t.pitch_id then v_venue end,
          p_pitch_id => case when v_pitch is not null and v_pitch is distinct from t.pitch_id then v_pitch end);
        v_told := true;
      end if;
      -- 2. THE PITCH (or taking it away), when the time's writer has not already set it.
      if v_pitch is distinct from (select x.pitch_id from public.training_sessions x where x.id = a.id) then
        update public.training_sessions
           set pitch_id = v_pitch,
               venue_id = coalesce(v_venue, venue_id),
               allocation_source = v_source,
               -- A PITCH ARENA GIVES ONE SESSION IS THAT SESSION'S OWN, as the Training Centre's "this session
               -- only" change is: editing the training plan later regenerates the sessions nobody set by hand
               -- and must not take this pitch away.
               is_overridden = true,
               updated_by = auth.uid()
         where id = a.id;
      end if;
      -- 3. THE ROOM, kept the session's own in the same way.
      if v_room is distinct from t.changing_room_id then
        update public.training_sessions
           set changing_room_id = v_room,
               changing_room_source = case when v_room is null then null else v_source end,
               is_overridden = true,
               updated_by = auth.uid()
         where id = a.id;
      end if;
      -- 4. The team hears once about its session -- not the person who did it. A new time was already told
      --    by the Training Centre's writer, with everything else in the same change.
      if not v_told and t.occurrence_date >= current_date
         and (v_pitch is distinct from t.pitch_id or v_room is distinct from t.changing_room_id) then
        v_label := coalesce((select tm.display_name from public.teams tm where tm.id = t.team_id), 'Your team''s');
        insert into public.notifications (user_id, type, title, body, data)
        select distinct e2.user_id, 'training_session_updated', 'Training updated',
               case when v_pitch is distinct from t.pitch_id and v_pitch is null
                      then format('%s training on %s no longer has a pitch.', v_label, to_char(t.occurrence_date, 'FMDy FMDD Mon'))
                    when v_pitch is distinct from t.pitch_id and v_room is not null and v_room is distinct from t.changing_room_id
                      then format('%s training on %s is now on %s, changing in %s.', v_label, to_char(t.occurrence_date, 'FMDy FMDD Mon'),
                                  (select pp.display_name from public.club_pitches pp where pp.id = v_pitch),
                                  (select r.display_name from public.venue_changing_rooms r where r.id = v_room))
                    when v_pitch is distinct from t.pitch_id
                      then format('%s training on %s is now on %s.', v_label, to_char(t.occurrence_date, 'FMDy FMDD Mon'),
                                  (select pp.display_name from public.club_pitches pp where pp.id = v_pitch))
                    when v_room is null
                      then format('%s training on %s no longer has a changing room.', v_label, to_char(t.occurrence_date, 'FMDy FMDD Mon'))
                    else format('%s training on %s changes in %s.', v_label, to_char(t.occurrence_date, 'FMDy FMDD Mon'),
                                (select r.display_name from public.venue_changing_rooms r where r.id = v_room)) end,
               jsonb_build_object('training_session_id', t.id, 'training_plan_id', t.training_plan_id)
        from internal.player_contact_eligibility(coalesce((
               select array_agg(ptm.player_id) from public.player_team_memberships ptm
               where ptm.status = 'active'
                 and ((t.team_id is not null and ptm.team_id = t.team_id)
                      or (t.scheduling_group_id is not null and ptm.team_id in (
                            select m.team_id from public.scheduling_group_members m where m.group_id = t.scheduling_group_id)))),
               array[]::uuid[])) e2
        where e2.user_id is not null and e2.user_id is distinct from auth.uid();
        get diagnostics v_applied = row_count;
        v_notified := v_notified + v_applied;
      end if;
      v_subjects := v_subjects || a.id;
    end if;
    v_applied := 0;
  end loop;

  perform set_config('ovalball.arena_batch', '', true);
  perform set_config('ovalball.allocation_source', '', true);
  perform internal.refuse_new_arena_conflicts(p_club_id, array[p_date], v_before, v_subjects);

  return jsonb_build_object('applied', jsonb_array_length(p_changes), 'notified', v_notified, 'kickoffProposed', to_jsonb(v_proposed));
end;
$function$;
revoke all on function public.apply_arena_allocation(uuid, date, jsonb, text) from public, anon;
grant execute on function public.apply_arena_allocation(uuid, date, jsonb, text) to authenticated;

-- LOCK WHAT A PERSON DECIDED, so automatic allocation leaves it. A fixture locks its pitch and each of its
-- rooms separately; a training session its pitch and its changing room (its one room: home_room).
create or replace function public.set_arena_lock(p_kind text, p_id uuid, p_locks text[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare a record; v_locks text[] := coalesce(p_locks, '{}'::text[]);
begin
  perform internal.require_live_session();
  select * into a from internal.arena_activity(p_kind, p_id);
  if a.id is null or not internal.arena_can_manage(a.club_id) then
    raise exception 'You do not have permission to plan this club''s facilities.' using errcode = '42501';
  end if;
  if not v_locks <@ array['pitch', 'home_room', 'away_room', 'officials_room']::text[]
     or (p_kind = 'TRAINING' and not v_locks <@ array['pitch', 'home_room']::text[]) then
    raise exception 'Lock a pitch or a changing room.' using errcode = '22023';
  end if;
  v_locks := array(select distinct x from unnest(v_locks) x order by x);
  if p_kind = 'FIXTURE' then
    update public.fixtures set allocation_locks = v_locks, updated_by = auth.uid(), updated_at = now()
     where id = any (internal.fixture_pair_ids(p_id));
  else
    update public.training_sessions
       set pitch_locked = 'pitch' = any (v_locks), changing_room_locked = 'home_room' = any (v_locks), updated_by = auth.uid()
     where id = p_id;
  end if;
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'locks', to_jsonb(v_locks));
end;
$function$;
revoke all on function public.set_arena_lock(text, uuid, text[]) from public, anon;
grant execute on function public.set_arena_lock(text, uuid, text[]) to authenticated;

-- A CLUB'S ROOM TIMES: how long before kick-off a team has its room, how long after the final whistle it
-- keeps it, and how long a room needs between teams. Null inherits the platform default.
create or replace function public.save_arena_settings(p_club_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_pol record;
begin
  perform internal.require_live_session();
  if not internal.arena_can_manage(p_club_id) then
    raise exception 'You do not have permission to plan this club''s facilities.' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  insert into public.club_scheduling_policy (club_id, updated_by) values (p_club_id, auth.uid())
  on conflict (club_id) do nothing;
  update public.club_scheduling_policy
     set room_access_minutes = case when p_patch ? 'roomAccessMinutes' then nullif(p_patch ->> 'roomAccessMinutes', '')::integer else room_access_minutes end,
         room_release_minutes = case when p_patch ? 'roomReleaseMinutes' then nullif(p_patch ->> 'roomReleaseMinutes', '')::integer else room_release_minutes end,
         room_turnaround_minutes = case when p_patch ? 'roomTurnaroundMinutes' then nullif(p_patch ->> 'roomTurnaroundMinutes', '')::integer else room_turnaround_minutes end,
         updated_by = auth.uid(), updated_at = now()
   where club_id = p_club_id;
  select * into v_pol from internal.arena_policy(p_club_id);
  return jsonb_build_object('roomAccess', v_pol.room_access, 'roomRelease', v_pol.room_release,
                            'roomTurnaround', v_pol.room_turnaround, 'roomSource', v_pol.room_source);
exception when check_violation then
  raise exception 'Room times are in 5-minute steps: up to two hours before and after, and up to an hour to turn round.'
    using errcode = '22023';
end;
$function$;
revoke all on function public.save_arena_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_arena_settings(uuid, jsonb) to authenticated;

-- EVERY TEAM'S PREFERENCES, and the club's default, with the club's grounds, pitches and rooms to choose
-- from. Teams show what they have set; anything they have not set uses the club's default.
create or replace function public.get_arena_preferences(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_out jsonb;
begin
  perform internal.require_live_session();
  if not internal.arena_can_view(p_club_id) then
    raise exception 'Arena is for the people who plan this club''s facilities.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'canManage', internal.arena_can_manage(p_club_id),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'isDefault', v.is_default_home)
                                         order by v.is_default_home desc, v.name)
                        from public.venues v where v.club_id = p_club_id and v.active), '[]'::jsonb),
    'pitches', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'venueId', p.venue_id, 'name', p.display_name,
                                                             'size', p.physical_size_category, 'layout', p.layout)
                                          order by p.sort_order, p.display_name)
                         from public.club_pitches p join public.venues v on v.id = p.venue_id and v.active
                         where p.club_id = p_club_id and p.active), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'venueId', r.venue_id, 'name', r.display_name, 'roomType', r.room_type)
                                        order by r.sort_order, r.display_name)
                       from public.venue_changing_rooms r join public.venues v on v.id = r.venue_id and v.active
                       where r.club_id = p_club_id and r.active), '[]'::jsonb),
    'clubDefault', coalesce((select jsonb_object_agg(x.purpose, x.ids) from (
                       select fp.purpose, jsonb_agg(coalesce(fp.venue_id, fp.pitch_id, fp.changing_room_id) order by fp.rank) as ids
                       from public.facility_preferences fp where fp.club_id = p_club_id and fp.team_id is null
                       group by fp.purpose) x), '{}'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                         'team', internal.arena_team_json(t.id),
                         'preferences', coalesce((select jsonb_object_agg(x.purpose, x.ids) from (
                             select fp.purpose, jsonb_agg(coalesce(fp.venue_id, fp.pitch_id, fp.changing_room_id) order by fp.rank) as ids
                             from public.facility_preferences fp where fp.club_id = p_club_id and fp.team_id = t.id
                             group by fp.purpose) x), '{}'::jsonb))
                       order by ctt.sort_order nulls last, t.display_name)
                       from public.teams t
                       left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
                       where t.club_id = p_club_id and t.active and t.archived_at is null and t.folded_at is null), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$function$;
revoke all on function public.get_arena_preferences(uuid) from public, anon;
grant execute on function public.get_arena_preferences(uuid) to authenticated;


-- =====================================================================================================
-- AN EVENT'S PITCHES, FROM THE EVENT CENTRE TOO
-- =====================================================================================================

-- The website's older event writer (save_club_event) could reserve pitches and the Event Centre's could not,
-- so a phone could neither reserve a pitch for an event nor -- worse -- move an event to another ground
-- without leaving its old ground's pitches reserved for it, which Arena would go on showing as held. The
-- Event Centre's writer now takes `pitch_ids`, keeps them at the event's own ground, and asks the one
-- estate engine before it holds a pitch on any day the event covers. Otherwise unchanged from 20270729.
create or replace function public.save_event(p_event_id uuid, p_club_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  e public.club_events;
  n public.club_events;
  v_id uuid := p_event_id;
  v_club uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_team_ids uuid[];
  v_user_ids uuid[];
  v_club_level boolean;
  v_bad uuid;
  v_changed text[] := '{}';
  v_notified integer := 0;
  v_ext jsonb;
  v_pitch_ids uuid[];
  v_pitches_move boolean := false;
  v_arena_days date[];
  v_arena_before text[];
begin
  perform internal.require_live_session();

  if v_id is not null then
    select * into e from public.club_events where id = v_id for update;
    if e.id is null or not internal.can_manage_club_event(v_id) then
      raise exception 'You do not have permission to manage this event.' using errcode = '42501';
    end if;
    v_club := e.club_id;
  else
    v_club := p_club_id;
  end if;
  if v_club is null or not exists (select 1 from public.clubs c where c.id = v_club) then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  v_club_level := internal.has_site_capability('site.support.act_in_club') or internal.can('calendar.event.manage', 'club', v_club, null, null);

  v_team_ids := case when v_patch ? 'team_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'team_ids') x)
                     else array(select cet.team_id from public.club_event_teams cet where cet.event_id = v_id) end;
  v_user_ids := case when v_patch ? 'individual_user_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'individual_user_ids') x)
                     else array(select i.user_id from public.club_event_invitees i where i.event_id = v_id) end;

  -- The row as it will be: the old row (or defaults) with the patch laid over it.
  if e.id is not null then
    n := e;
  else
    n.club_id := v_club; n.name := ''; n.starts_on := current_date; n.ends_on := current_date; n.is_club_wide := false;
    n.status := 'DRAFT'; n.event_type := 'SOCIAL'; n.location_kind := 'VENUE'; n.visibility := 'INVITED';
    n.invite_players := true; n.invite_staff := true; n.invite_members := false; n.rsvp_required := true; n.max_guests := 0;
    n.catering_required := false; n.waiting_list_enabled := false; n.payment_mode := 'FREE';
  end if;
  n.name := case when v_patch ? 'name' then btrim(coalesce(v_patch ->> 'name', '')) else n.name end;
  n.event_type := coalesce(v_patch ->> 'event_type', n.event_type);
  n.description := case when v_patch ? 'description' then nullif(btrim(coalesce(v_patch ->> 'description', '')), '') else n.description end;
  n.starts_on := coalesce((v_patch ->> 'starts_on')::date, n.starts_on);
  n.ends_on := coalesce((v_patch ->> 'ends_on')::date, case when v_patch ? 'starts_on' and e.id is null then n.starts_on else n.ends_on end);
  if v_patch ? 'starts_on' and not v_patch ? 'ends_on' and n.ends_on < n.starts_on then n.ends_on := n.starts_on; end if;
  n.start_time := case when v_patch ? 'start_time' then nullif(v_patch ->> 'start_time', '')::time else n.start_time end;
  n.end_time := case when v_patch ? 'end_time' then nullif(v_patch ->> 'end_time', '')::time else n.end_time end;
  n.meet_time := case when v_patch ? 'meet_time' then nullif(v_patch ->> 'meet_time', '')::time else n.meet_time end;
  n.host_team_id := case when v_patch ? 'host_team_id' then nullif(v_patch ->> 'host_team_id', '')::uuid else n.host_team_id end;
  n.is_club_wide := coalesce((v_patch ->> 'is_club_wide')::boolean, n.is_club_wide);
  n.invite_players := coalesce((v_patch ->> 'invite_players')::boolean, n.invite_players);
  n.invite_staff := coalesce((v_patch ->> 'invite_staff')::boolean, n.invite_staff);
  n.invite_members := coalesce((v_patch ->> 'invite_members')::boolean, n.invite_members);
  n.visibility := coalesce(v_patch ->> 'visibility', n.visibility);
  n.rsvp_required := coalesce((v_patch ->> 'rsvp_required')::boolean, n.rsvp_required);
  n.rsvp_deadline := case when v_patch ? 'rsvp_deadline' then nullif(v_patch ->> 'rsvp_deadline', '')::timestamptz else n.rsvp_deadline end;
  n.max_guests := coalesce((v_patch ->> 'max_guests')::int, n.max_guests);
  n.catering_required := coalesce((v_patch ->> 'catering_required')::boolean, n.catering_required);
  n.catering_notes := case when v_patch ? 'catering_notes' then nullif(btrim(coalesce(v_patch ->> 'catering_notes', '')), '') else n.catering_notes end;
  n.catering_deadline := case when v_patch ? 'catering_deadline' then nullif(v_patch ->> 'catering_deadline', '')::timestamptz else n.catering_deadline end;
  n.capacity := case when v_patch ? 'capacity' then nullif(v_patch ->> 'capacity', '')::int else n.capacity end;
  n.waiting_list_enabled := coalesce((v_patch ->> 'waiting_list_enabled')::boolean, n.waiting_list_enabled) and n.capacity is not null;
  n.payment_mode := coalesce(v_patch ->> 'payment_mode', n.payment_mode);
  n.price_note := case when v_patch ? 'price_note' then nullif(btrim(coalesce(v_patch ->> 'price_note', '')), '') else n.price_note end;
  n.cover_stock_key := case when v_patch ? 'cover_stock_key' then nullif(v_patch ->> 'cover_stock_key', '') else n.cover_stock_key end;
  n.cover_image_path := case when v_patch ? 'cover_image_path' then nullif(v_patch ->> 'cover_image_path', '') else n.cover_image_path end;
  if v_patch ? 'cover_image_path' and n.cover_image_path is not null then n.cover_stock_key := null; end if;
  if v_patch ? 'cover_stock_key' and n.cover_stock_key is not null then n.cover_image_path := null; end if;
  n.location_detail := case when v_patch ? 'location_detail' then nullif(btrim(coalesce(v_patch ->> 'location_detail', '')), '') else n.location_detail end;
  if v_patch ? 'location_kind' then
    n.location_kind := v_patch ->> 'location_kind';
    n.venue_id := null; n.external_location_name := null; n.online_url := null;
    n.external_address_line_1 := null; n.external_address_line_2 := null; n.external_town := null; n.external_county := null;
    n.external_postcode := null; n.external_country := null; n.external_latitude := null; n.external_longitude := null;
    if n.location_kind = 'VENUE' then n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
    elsif n.location_kind = 'EXTERNAL' then
      v_ext := coalesce(v_patch -> 'external', '{}'::jsonb);
      n.external_location_name := nullif(btrim(coalesce(v_ext ->> 'name', '')), '');
      n.external_address_line_1 := nullif(btrim(coalesce(v_ext ->> 'address_line_1', '')), '');
      n.external_address_line_2 := nullif(btrim(coalesce(v_ext ->> 'address_line_2', '')), '');
      n.external_town := nullif(btrim(coalesce(v_ext ->> 'town', '')), '');
      n.external_county := nullif(btrim(coalesce(v_ext ->> 'county', '')), '');
      n.external_postcode := nullif(upper(btrim(coalesce(v_ext ->> 'postcode', ''))), '');
      n.external_country := nullif(btrim(coalesce(v_ext ->> 'country', '')), '');
      n.external_latitude := nullif(v_ext ->> 'latitude', '')::numeric;
      n.external_longitude := nullif(v_ext ->> 'longitude', '')::numeric;
      n.external_address_provider_ref := nullif(v_ext ->> 'provider_ref', '');
    elsif n.location_kind = 'ONLINE' then n.online_url := nullif(btrim(coalesce(v_patch ->> 'online_url', '')), '');
    else raise exception 'A place is a club venue, an external address or online.' using errcode = '22023';
    end if;
  elsif v_patch ? 'venue_id' and n.location_kind = 'VENUE' then
    n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
  end if;

  -- AUTHORITY OVER THE AUDIENCE. Below club level, only an event confined to sides you manage.
  if not v_club_level then
    if n.is_club_wide then raise exception 'Only club administration can make an event club-wide.' using errcode = '42501'; end if;
    if coalesce(array_length(v_team_ids, 1), 0) = 0 then
      raise exception 'Choose the sides this event is for.' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(v_team_ids) t(id) where not internal.can('calendar.event.manage', 'team', v_club, t.id, null)) then
      raise exception 'You do not have permission to include one of those teams.' using errcode = '42501';
    end if;
    if n.visibility = 'CLUB' then raise exception 'Only club administration can show an event to the whole club.' using errcode = '42501'; end if;
  end if;

  -- SHAPE.
  if length(n.name) = 0 or length(n.name) > 100 then raise exception 'An event needs a name of up to 100 characters.' using errcode = '22023'; end if;
  if n.ends_on < n.starts_on then raise exception 'An event cannot end before it starts.' using errcode = '22023'; end if;
  if n.ends_on = n.starts_on and n.start_time is not null and n.end_time is not null and n.end_time < n.start_time then
    raise exception 'An event cannot finish before it begins.' using errcode = '22023';
  end if;
  if n.meet_time is not null and n.start_time is not null and n.meet_time > n.start_time then
    raise exception 'The arrival time is before the start.' using errcode = '22023';
  end if;
  if n.location_kind = 'VENUE' and (n.venue_id is null or not exists (select 1 from public.venues v where v.id = n.venue_id and v.club_id = v_club and v.active)) then
    raise exception 'Choose one of the club''s own venues.' using errcode = '42501';
  end if;
  if n.location_kind = 'EXTERNAL' and n.external_location_name is null then
    raise exception 'Name the external place.' using errcode = '22023';
  end if;
  if n.location_kind = 'ONLINE' and (n.online_url is null or n.online_url !~* '^https://') then
    raise exception 'An online event needs a meeting link starting https://.' using errcode = '22023';
  end if;
  if n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) > 0 then
    raise exception 'A club-wide event covers every team and does not list them individually.' using errcode = '22023';
  end if;
  if not n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) = 0 and coalesce(array_length(v_user_ids, 1), 0) = 0 and v_patch ? 'team_ids' then
    raise exception 'Invite the whole club, some teams or some people.' using errcode = '22023';
  end if;
  select t.id into v_bad from unnest(v_team_ids) t(id)
   where not exists (select 1 from public.teams tm where tm.id = t.id and tm.club_id = v_club) limit 1;
  if v_bad is not null then raise exception 'One of those teams does not belong to this club.' using errcode = '42501'; end if;
  if n.host_team_id is not null and not exists (select 1 from public.teams tm where tm.id = n.host_team_id and tm.club_id = v_club) then
    raise exception 'The host team must belong to this club.' using errcode = '42501';
  end if;
  if n.host_team_id is not null and not v_club_level and not internal.can('calendar.event.manage', 'team', v_club, n.host_team_id, null) then
    raise exception 'You can only host an event for a team you manage.' using errcode = '42501';
  end if;
  -- A NAMED PERSON must already belong to the club (a member, or the family of one of its players).
  select u.id into v_bad from unnest(v_user_ids) u(id)
   where not exists (select 1 from public.club_memberships cm where cm.user_id = u.id and cm.club_id = v_club and cm.status = 'active')
     and not exists (select 1 from public.guardians g join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
                       join public.teams t on t.id = ptm.team_id where g.guardian_user_id = u.id and g.status = 'active' and t.club_id = v_club)
   limit 1;
  if v_bad is not null then raise exception 'You can invite people from your own club only.' using errcode = '42501'; end if;
  if n.cover_stock_key is not null and not internal.stock_media_allowed(n.cover_stock_key, 'EVENT') then
    raise exception 'That is not an Ovalball event picture.' using errcode = '22023';
  end if;
  if n.cover_image_path is not null and split_part(n.cover_image_path, '/', 1) <> coalesce(v_id::text, '') then
    raise exception 'Upload the picture to this event first.' using errcode = '22023';
  end if;

  -- AN EVENT'S PITCHES (Arena: an event holds only the pitches it reserves). Given as a set, or kept as
  -- they were; always at the event's own ground, so a ground that changes takes its pitches with it and a
  -- place that is not one of the club's grounds holds none.
  v_pitch_ids := case when v_patch ? 'pitch_ids' then array(select distinct (x)::uuid from jsonb_array_elements_text(v_patch -> 'pitch_ids') x)
                      else array(select cep.pitch_id from public.club_event_pitches cep where cep.event_id = v_id) end;
  if n.location_kind is distinct from 'VENUE' or n.venue_id is null then
    if v_patch ? 'pitch_ids' and cardinality(v_pitch_ids) > 0 then
      raise exception 'Pitches are reserved at one of the club''s own grounds.' using errcode = '22023';
    end if;
    v_pitch_ids := '{}';
  else
    if v_patch ? 'pitch_ids' and exists (
         select 1 from unnest(v_pitch_ids) p(id)
         where not exists (select 1 from public.club_pitches cp
                           where cp.id = p.id and cp.club_id = v_club and cp.venue_id = n.venue_id and cp.active)) then
      raise exception 'Choose pitches at this event''s ground.' using errcode = '42501';
    end if;
    v_pitch_ids := array(select p.id from unnest(v_pitch_ids) p(id)
                         join public.club_pitches cp on cp.id = p.id and cp.venue_id = n.venue_id);
  end if;
  v_pitches_move := v_patch ? 'pitch_ids'
                    or (e.id is not null and exists (select 1 from public.club_event_pitches cep where cep.event_id = v_id)
                        and (n.venue_id is distinct from e.venue_id or n.location_kind is distinct from e.location_kind
                             or n.starts_on is distinct from e.starts_on or n.ends_on is distinct from e.ends_on
                             or n.start_time is distinct from e.start_time or n.end_time is distinct from e.end_time));
  -- AN EVENT THAT RESERVES A PITCH HOLDS IT: it must not take one somebody else is using, on any day it
  -- now covers (or used to, so a clash it leaves behind is not mistaken for a new one).
  if v_pitches_move and cardinality(v_pitch_ids) > 0 then
    v_arena_days := array(select distinct x.d::date from (
        select generate_series(n.starts_on, least(n.ends_on, n.starts_on + 30), interval '1 day') as d
        union all
        select generate_series(e.starts_on, least(e.ends_on, e.starts_on + 30), interval '1 day') where e.id is not null) x);
    v_arena_before := internal.arena_conflict_keys(v_club, v_arena_days);
  end if;

  if v_id is null then
    insert into public.club_events (club_id, name, event_type, description, starts_on, ends_on, start_time, end_time, meet_time,
        host_team_id, is_club_wide, invite_players, invite_staff, invite_members, visibility, rsvp_required, rsvp_deadline,
        max_guests, catering_required, catering_notes, catering_deadline, capacity, waiting_list_enabled, payment_mode, price_note,
        cover_stock_key, location_kind, location_detail, venue_id, external_location_name, external_address_line_1,
        external_address_line_2, external_town, external_county, external_postcode, external_country, external_latitude,
        external_longitude, external_address_provider_ref, online_url, status, created_by, updated_by, season_id)
    values (v_club, n.name, n.event_type, n.description, n.starts_on, n.ends_on, n.start_time, n.end_time, n.meet_time,
        n.host_team_id, n.is_club_wide, n.invite_players, n.invite_staff, n.invite_members, n.visibility, n.rsvp_required, n.rsvp_deadline,
        n.max_guests, n.catering_required, n.catering_notes, n.catering_deadline, n.capacity, n.waiting_list_enabled, n.payment_mode, n.price_note,
        n.cover_stock_key, n.location_kind, n.location_detail, n.venue_id, n.external_location_name, n.external_address_line_1,
        n.external_address_line_2, n.external_town, n.external_county, n.external_postcode, n.external_country, n.external_latitude,
        n.external_longitude, n.external_address_provider_ref, n.online_url, 'DRAFT', auth.uid(), auth.uid(),
        (select s.id from public.seasons s join public.clubs c on c.id = v_club join public.club_directory d on d.id = c.directory_id
          where s.rugby_code = d.rugby_code and n.starts_on between s.starts_on and s.ends_on order by s.starts_on desc limit 1))
    returning id into v_id;
  else
    if e.status = 'CANCELLED' then raise exception 'A cancelled event cannot be changed.' using errcode = '22023'; end if;
    if n.starts_on is distinct from e.starts_on or n.ends_on is distinct from e.ends_on then v_changed := array_append(v_changed, 'date'); end if;
    if n.start_time is distinct from e.start_time or n.end_time is distinct from e.end_time or n.meet_time is distinct from e.meet_time then v_changed := array_append(v_changed, 'time'); end if;
    if n.location_kind is distinct from e.location_kind or n.venue_id is distinct from e.venue_id
       or n.external_location_name is distinct from e.external_location_name or n.external_postcode is distinct from e.external_postcode
       or n.online_url is distinct from e.online_url then v_changed := array_append(v_changed, 'place'); end if;
    update public.club_events set
      name = n.name, event_type = n.event_type, description = n.description, starts_on = n.starts_on, ends_on = n.ends_on,
      start_time = n.start_time, end_time = n.end_time, meet_time = n.meet_time, host_team_id = n.host_team_id,
      is_club_wide = n.is_club_wide, invite_players = n.invite_players, invite_staff = n.invite_staff, invite_members = n.invite_members,
      visibility = n.visibility, rsvp_required = n.rsvp_required, rsvp_deadline = n.rsvp_deadline, max_guests = n.max_guests,
      catering_required = n.catering_required, catering_notes = n.catering_notes, catering_deadline = n.catering_deadline,
      capacity = n.capacity, waiting_list_enabled = n.waiting_list_enabled, payment_mode = n.payment_mode, price_note = n.price_note,
      cover_stock_key = n.cover_stock_key, cover_image_path = n.cover_image_path, location_kind = n.location_kind,
      location_detail = n.location_detail, venue_id = n.venue_id, external_location_name = n.external_location_name,
      external_address_line_1 = n.external_address_line_1, external_address_line_2 = n.external_address_line_2,
      external_town = n.external_town, external_county = n.external_county, external_postcode = n.external_postcode,
      external_country = n.external_country, external_latitude = n.external_latitude, external_longitude = n.external_longitude,
      external_address_provider_ref = n.external_address_provider_ref, online_url = n.online_url,
      -- A postponed event given a new date is back on.
      status = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then 'SCHEDULED' else e.status end,
      status_note = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then null else e.status_note end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id;
    -- Guests beyond the new rule are trimmed rather than left over the limit; food follows.
    update public.club_event_responses set guest_count = least(guest_count, n.max_guests),
           catering_count = case when n.catering_required then least(catering_count, least(guest_count, n.max_guests) + 1) else 0 end,
           dietary = case when n.catering_required then dietary else '{}'::jsonb end, updated_at = now()
     where event_id = v_id and (guest_count > n.max_guests or (not n.catering_required and catering_count > 0));
  end if;

  delete from public.club_event_teams where event_id = v_id and not (team_id = any(v_team_ids));
  insert into public.club_event_teams (event_id, team_id) select v_id, t from unnest(v_team_ids) t on conflict do nothing;
  delete from public.club_event_invitees where event_id = v_id and not (user_id = any(v_user_ids));
  insert into public.club_event_invitees (event_id, user_id, added_by) select v_id, u, auth.uid() from unnest(v_user_ids) u on conflict do nothing;

  if v_pitches_move then
    delete from public.club_event_pitches where event_id = v_id and not (pitch_id = any (v_pitch_ids));
    insert into public.club_event_pitches (event_id, pitch_id) select v_id, p from unnest(v_pitch_ids) p on conflict do nothing;
    if v_arena_days is not null then
      perform internal.refuse_new_arena_conflicts(v_club, v_arena_days, v_arena_before, array[v_id]);
    end if;
  end if;

  -- ONE NOTICE FOR ONE SAVE, only once people have been invited, only for what changes their plans.
  if e.id is not null and e.invitations_sent_at is not null and e.status in ('SCHEDULED', 'POSTPONED') and cardinality(v_changed) > 0 then
    select * into n from public.club_events where id = v_id;
    v_notified := internal.club_event_notify(v_id, array(select r.user_id from internal.club_event_recipients(v_id) r),
      'event_updated', n.name || ' updated',
      'The event is now ' || internal.club_event_date_label(n) || ' at ' || coalesce(internal.club_event_place_label(n), 'a place to be confirmed') || '.',
      jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  if e.id is not null and n.capacity is distinct from e.capacity then
    perform internal.club_event_promote_waiting(v_id);
  end if;

  return jsonb_build_object('eventId', v_id, 'notified', v_notified, 'changed', to_jsonb(v_changed), 'pitchIds', to_jsonb(v_pitch_ids));
end;
$function$;

-- =====================================================================================================
-- THE ONE STOCK MEDIA LIBRARY GROWS (Arena pass): approved pictures a person may choose
-- =====================================================================================================

-- Mirrors packages/contracts/src/media/stock-library.ts: each key, the kinds of object it may stand for, and
-- its chip. These are choices only (`fallback: false` there), so no existing stand-in moves.
insert into internal.stock_media (key, domains, category) values
  ('arena-estate-01', array['VENUE']::text[], 'Arena'),
  ('venue-pavilion-posts-01', array['VENUE']::text[], 'Grounds'),
  ('venue-timber-pavilion-01', array['VENUE']::text[], 'Grounds'),
  ('venue-clubhouse-dusk-02', array['VENUE']::text[], 'Grounds'),
  ('pitch-touchline-01', array['VENUE', 'PITCH']::text[], 'Pitches'),
  ('pitch-through-posts-01', array['PITCH']::text[], 'Pitches'),
  ('event-family-fun-day-02', array['EVENT']::text[], 'Community'),
  ('training-equipment-01', array['PITCH']::text[], 'Training'),
  ('event-awards-02', array['EVENT']::text[], 'Awards'),
  ('event-winter-social-01', array['EVENT']::text[], 'Social'),
  -- Arena Home's destination photographs (the owner's approved hub mock-up): choices, never stand-ins.
  ('changing-oak-hooks-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('tournament-festival-aerial-01', array['TOURNAMENT']::text[], 'Festivals')
on conflict (key) do update set domains = excluded.domains, category = excluded.category;

-- =====================================================================================================
-- WHAT IS BOOKED ON A PITCH OR ROOM FROM TODAY -- said before anybody switches it off
-- =====================================================================================================

-- Deactivating a pitch or a changing room keeps everything already recorded on it, and the estate engine then
-- flags each booking still on it (PITCH_INACTIVE). The person deciding should know that before they confirm,
-- in words: what is on it from today, by kind, from the one occupancy -- so nothing is orphaned unawares.
create or replace function public.get_resource_bookings_ahead(p_resource_type text, p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_club uuid;
  v_tz text;
  v_today date;
  v_rows jsonb;
begin
  perform internal.require_live_session();
  if p_resource_type = 'PITCH' then
    select p.club_id into v_club from public.club_pitches p where p.id = p_resource_id;
  elsif p_resource_type = 'ROOM' then
    select r.club_id into v_club from public.venue_changing_rooms r where r.id = p_resource_id;
  elsif p_resource_type = 'VENUE' then
    -- A whole ground: everything on any of its pitches or in any of its rooms.
    select v.club_id into v_club from public.venues v where v.id = p_resource_id;
  else
    raise exception 'Choose a ground, a pitch or a changing room.' using errcode = '22023';
  end if;
  if v_club is null or not internal.arena_can_view(v_club) then
    raise exception 'You do not have permission to see this club''s facilities.' using errcode = '42501';
  end if;
  select coalesce(c.timezone, 'Europe/London') into v_tz from public.clubs c where c.id = v_club;
  v_today := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'count', x.n, 'first', x.first_day) order by x.kind), '[]'::jsonb)
    into v_rows
  from (
    -- A tournament counts once, however many of its reservations and games are on the resource.
    select case o.activity_type when 'TOURNAMENT_GAME' then 'TOURNAMENT' else o.activity_type end as kind,
           count(distinct case when o.activity_type in ('TOURNAMENT', 'TOURNAMENT_GAME') then o.parent_id else o.activity_id end) as n,
           min(o.day) as first_day
    from internal.arena_occupancy(v_club, v_today, v_today + 365) o
    where (p_resource_type = 'VENUE' and o.venue_id = p_resource_id)
       or (o.resource_type = p_resource_type and o.resource_id = p_resource_id)
    group by 1
  ) x;
  return jsonb_build_object('from', v_today, 'bookings', v_rows);
end;
$function$;
revoke all on function public.get_resource_bookings_ahead(text, uuid) from public, anon;
grant execute on function public.get_resource_bookings_ahead(text, uuid) to authenticated;


-- =====================================================================================================
-- 9. "NEEDS A CHANGING ROOM", ASKED FOR IN THE TRAINING CENTRE
-- =====================================================================================================
-- The two Training Centre writers gain one trailing optional parameter each (null keeps today's behaviour,
-- so every caller by name is unchanged): save_training_plan's p_needs_changing_room is the team's answer for
-- every session of the plan, override_training_session's is one session's own answer. Arena reads the
-- answer and plans the room; it never asks on the team's behalf. Everything else in each body is the live
-- definition (save_training_plan from 20270584, override_training_session from 20270737).
create or replace function public.save_training_plan(p_plan_id uuid, p_club_id uuid, p_team_id uuid, p_schedule_mode text, p_season_id uuid, p_preferred_venue_id uuid, p_preferred_pitch_id uuid, p_rules jsonb, p_warm_up_minutes integer DEFAULT 0, p_pack_up_minutes integer DEFAULT 0, p_default_session_notes text DEFAULT NULL::text, p_needs_changing_room boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan_id uuid;
  v_rule jsonb;
  v_needs_attention_reason text := null;
  v_status text := 'ACTIVE';
  v_season public.seasons;
  v_removed_count integer;
  v_is_new boolean := (p_plan_id is null);
  v_team_label text;
  v_venue_label text;
  v_schedule_summary text;
  v_warm_up integer := coalesce(p_warm_up_minutes, 0);
  v_pack_up integer := coalesce(p_pack_up_minutes, 0);
  v_notes text := nullif(trim(coalesce(p_default_session_notes, '')), '');
begin
  if not internal.can('training.plan.manage', 'club', p_club_id, null, null) then
    raise exception 'You are not authorized to manage Training Plans for this club.' using errcode = '42501';
  end if;

  if p_team_id is null then raise exception 'A team is required.'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id and active) then
    raise exception 'That is not an active team at this club.';
  end if;
  if p_schedule_mode not in ('SEASON', 'SEASON_PRE_SEASON', 'CUSTOM') then
    raise exception 'Invalid schedule mode.';
  end if;
  if p_schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') and p_season_id is null then
    raise exception 'A season is required for this schedule mode.';
  end if;
  if p_preferred_venue_id is null then raise exception 'A preferred training venue is required.'; end if;
  if p_preferred_pitch_id is null then raise exception 'A preferred training pitch is required.'; end if;
  if not exists (select 1 from public.venues where id = p_preferred_venue_id and (club_id = p_club_id or club_id is null) and active) then
    raise exception 'That venue is not available to this club.';
  end if;
  if not exists (select 1 from public.club_pitches where id = p_preferred_pitch_id and club_id = p_club_id and active and venue_id = p_preferred_venue_id) then
    raise exception 'The preferred pitch must belong to the selected venue.';
  end if;
  if p_rules is null or jsonb_array_length(p_rules) = 0 then
    raise exception 'At least one schedule rule is required.';
  end if;
  if v_warm_up < 0 or v_warm_up > 60 or v_warm_up % 5 <> 0 then
    raise exception 'Warm up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if v_pack_up < 0 or v_pack_up > 60 or v_pack_up % 5 <> 0 then
    raise exception 'Cool down / pack up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long.';
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    if v_rule->>'weekday' is null or (v_rule->>'weekday')::integer not between 0 and 6 then
      raise exception 'Each schedule rule requires a valid weekday.';
    end if;
    if v_rule->>'start_time' is null then
      raise exception 'Each schedule rule requires a start time.';
    end if;
    if v_rule->>'duration_minutes' is null or (v_rule->>'duration_minutes')::integer < 15 or (v_rule->>'duration_minutes')::integer > 240 then
      raise exception 'Each schedule rule requires a valid duration.';
    end if;
    if p_schedule_mode = 'CUSTOM' then
      if v_rule->>'starts_on' is null or v_rule->>'ends_on' is null then
        raise exception 'Each custom schedule row requires a from and to date.';
      end if;
      if (v_rule->>'starts_on')::date > (v_rule->>'ends_on')::date then
        raise exception 'A schedule row''s from date cannot be after its to date.';
      end if;
      if not exists (
        select 1 from generate_series((v_rule->>'starts_on')::date, (v_rule->>'ends_on')::date, interval '1 day') d
        where extract(dow from d) = (v_rule->>'weekday')::integer
      ) then
        raise exception 'This schedule row''s date range never includes the selected weekday.';
      end if;
    end if;
  end loop;

  if p_schedule_mode = 'SEASON_PRE_SEASON' then
    select * into v_season from public.seasons where id = p_season_id;
    if not found or v_season.pre_season_starts_on is null then
      v_status := 'NEEDS_ATTENTION';
      v_needs_attention_reason := 'This season has no canonical pre-season start date configured -- ask a Site Admin to set one, or switch this plan to Season only.';
    end if;
  end if;

  if p_plan_id is null then
    insert into public.training_plans (
      club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id,
      status, needs_attention_reason, warm_up_minutes, pack_up_minutes, default_session_notes, needs_changing_room, created_by, updated_by
    ) values (
      p_club_id, p_team_id, p_season_id, p_schedule_mode, p_preferred_venue_id, p_preferred_pitch_id,
      v_status, v_needs_attention_reason, v_warm_up, v_pack_up, v_notes, coalesce(p_needs_changing_room, false), auth.uid(), auth.uid()
    ) returning id into v_plan_id;
  else
    v_plan_id := p_plan_id;
    if not exists (select 1 from public.training_plans where id = v_plan_id and club_id = p_club_id) then
      raise exception 'Training plan not found for this club.';
    end if;
    update public.training_plans set
      team_id = p_team_id, season_id = p_season_id, schedule_mode = p_schedule_mode,
      preferred_venue_id = p_preferred_venue_id, preferred_pitch_id = p_preferred_pitch_id,
      status = v_status, needs_attention_reason = v_needs_attention_reason,
      warm_up_minutes = v_warm_up, pack_up_minutes = v_pack_up, default_session_notes = v_notes,
      needs_changing_room = coalesce(p_needs_changing_room, needs_changing_room),
      updated_by = auth.uid()
    where id = v_plan_id;

    -- A team that no longer asks for a changing room gives back the rooms its coming sessions held for it --
    -- every session that follows the plan's answer (a session that said otherwise keeps its own).
    if p_needs_changing_room is false then
      update public.training_sessions
         set changing_room_id = null, changing_room_source = null, changing_room_locked = false
       where training_plan_id = v_plan_id and occurrence_date >= current_date
         and needs_changing_room is null and changing_room_id is not null and status <> 'CANCELLED';
    end if;

    update public.training_sessions
    set status = 'CANCELLED', cancellation_reason = 'Training Plan schedule was edited.'
    where training_plan_id = v_plan_id
      and occurrence_date >= current_date
      and is_overridden = false
      and status <> 'CANCELLED';
    get diagnostics v_removed_count = row_count;

    delete from public.training_plan_schedule_rules where training_plan_id = v_plan_id;
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    insert into public.training_plan_schedule_rules (training_plan_id, weekday, starts_on, ends_on, start_time, duration_minutes)
    values (
      v_plan_id, (v_rule->>'weekday')::integer,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'starts_on')::date else null end,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'ends_on')::date else null end,
      (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
    );
  end loop;

  if v_status = 'ACTIVE' then
    perform public.generate_training_plan_sessions(v_plan_id);
  end if;

  select display_name into v_team_label from public.teams where id = p_team_id;
  select name into v_venue_label from public.venues where id = p_preferred_venue_id;
  select string_agg(
    (case r.weekday
      when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday' when 3 then 'Wednesday'
      when 4 then 'Thursday' when 5 then 'Friday' when 6 then 'Saturday'
    end) || ' ' || to_char(r.start_time, 'FMHH24:MI'),
    ', ' order by r.weekday
  ) into v_schedule_summary
  from (
    select distinct weekday, start_time from public.training_plan_schedule_rules where training_plan_id = v_plan_id
  ) r;

  if v_is_new then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_created', 'Training plan created',
      format('%s''s training schedule is now available: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  elsif coalesce(v_removed_count, 0) > 0 then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_schedule_changed', 'Training plan updated',
      format('%s''s training schedule has changed from today: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  end if;

  return v_plan_id;
end;
$function$;
revoke all on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text, boolean) from public, anon;
grant execute on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text, boolean) to authenticated;
-- The old overload goes, so no caller can keep reaching a version that cannot say "Needs a changing room".
drop function if exists public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text);

create or replace function public.override_training_session(p_session_id uuid, p_session_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_duration_minutes integer DEFAULT NULL::integer, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_cancel boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_agenda text DEFAULT NULL::text, p_further_notes text DEFAULT NULL::text, p_warm_up_minutes integer DEFAULT NULL::integer, p_pack_up_minutes integer DEFAULT NULL::integer, p_needs_changing_room boolean DEFAULT NULL::boolean)
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
  v_guarded := v_schedule_changed and (coalesce(p_pitch_id, s.pitch_id) is not null or s.changing_room_id is not null);
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
    -- "Needs a changing room", for this session alone. A session that no longer needs one, or that moves
    -- to a venue its room is not at, gives the room back; Arena plans it again.
    needs_changing_room = coalesce(p_needs_changing_room, needs_changing_room),
    changing_room_id = case when p_needs_changing_room is false
                              or (p_venue_id is not null and p_venue_id is distinct from s.venue_id and changing_room_id is not null
                                  and not exists (select 1 from public.venue_changing_rooms r where r.id = changing_room_id and r.venue_id = p_venue_id))
                            then null else changing_room_id end,
    changing_room_source = case when p_needs_changing_room is false
                                  or (p_venue_id is not null and p_venue_id is distinct from s.venue_id and changing_room_id is not null
                                      and not exists (select 1 from public.venue_changing_rooms r where r.id = changing_room_id and r.venue_id = p_venue_id))
                                then null else changing_room_source end,
    changing_room_locked = case when p_needs_changing_room is false then false else changing_room_locked end,
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
revoke all on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer, boolean) to authenticated;
drop function if exists public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer);
comment on function public.override_training_session is 'The ONE occurrence-level override RPC. Coalesce-only-what-changed semantics; computes end_time server-side. A past occurrence''s agenda/further_notes stay editable (administrative recording), but date/start_time/duration/venue/pitch/warm_up/pack_up are refused once occurrence_date < current_date, mirroring cancel_training_session''s existing historical guard -- history is not silently rewritten just because a coach opens an old session. p_needs_changing_room is this session''s own "Needs a changing room" (20270738).';

-- get_training_session_card: the live definition (20270586) plus the session's changing room, so the Training
-- Centre shows what the team asked for and what Arena gave it: `needs_changing_room` is the session's own
-- answer else its plan's, `changing_room_request` says which (SESSION / PLAN, or null for a one-off session
-- that asked nothing), `changing_room_name` the room it has. The row shape changed (new trailing columns),
-- which CREATE OR REPLACE cannot do -- the function is dropped first.
drop function if exists public.get_training_session_card(uuid);
create function public.get_training_session_card(p_training_session_id uuid)
returns table (
  id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid, season_id uuid,
  training_plan_id uuid, session_date date, start_time time, end_time time, duration_minutes integer,
  venue_id uuid, venue_name text, pitch_id uuid, pitch_name text, status text, source text, agenda text,
  further_notes text, notes text, cancelled_at timestamptz, cancellation_reason text, cancelled_by_name text,
  my_attendance_status text, can_manage boolean, can_view_register boolean,
  is_overridden boolean, warm_up_minutes integer, pack_up_minutes integer,
  needs_changing_room boolean, changing_room_request text, changing_room_name text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
  v_can_manage boolean;
  v_can_view_register boolean;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  if not internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id) then
    raise exception 'You are not authorized to view this training session.' using errcode = '42501';
  end if;

  v_can_manage := internal.can_manage_training(s.club_id, s.team_id) or internal.can_manage_club_training(s.club_id);
  v_can_view_register := v_can_manage
    or internal.can('team.attendance.view', 'team', s.club_id, s.team_id, null)
    or internal.can('team.attendance.view', 'club', s.club_id, null, null);

  return query
  select
    sess.id, sess.club_id, sess.team_id,
    coalesce(t.display_name, sg.display_tag, 'Team'),
    sess.scheduling_group_id, sess.season_id, sess.training_plan_id,
    sess.session_date, sess.start_time, sess.end_time, sess.duration_minutes,
    sess.venue_id, v.name, sess.pitch_id, cp.display_name,
    sess.status, sess.source, sess.agenda, sess.further_notes, sess.notes,
    sess.cancelled_at, sess.cancellation_reason,
    case when sess.cancelled_by is not null then trim(coalesce(prof.first_name, '') || ' ' || coalesce(prof.surname, '')) else null end,
    (
      select a.status from public.player_fixture_attendance a
      join public.players p on p.id = a.player_id
      where a.training_session_id = sess.id
        and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
      order by a.updated_at desc limit 1
    ),
    v_can_manage, v_can_view_register,
    sess.is_overridden,
    coalesce(sess.warm_up_minutes, tp.warm_up_minutes),
    coalesce(sess.pack_up_minutes, tp.pack_up_minutes),
    coalesce(sess.needs_changing_room, tp.needs_changing_room, false),
    case when sess.needs_changing_room is not null then 'SESSION' when tp.id is not null then 'PLAN' end,
    cr.display_name
  from public.training_sessions sess
  left join public.teams t on t.id = sess.team_id
  left join public.scheduling_groups sg on sg.id = sess.scheduling_group_id
  left join public.venues v on v.id = sess.venue_id
  left join public.club_pitches cp on cp.id = sess.pitch_id
  left join public.profiles prof on prof.id = sess.cancelled_by
  left join public.training_plans tp on tp.id = sess.training_plan_id
  left join public.venue_changing_rooms cr on cr.id = sess.changing_room_id
  where sess.id = p_training_session_id;
end;
$function$;
revoke all on function public.get_training_session_card(uuid) from public, anon;
grant execute on function public.get_training_session_card(uuid) to authenticated;
