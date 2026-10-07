-- A MATCH CENTRE IS ONE PLACE (Match Centre consolidation, 2026-10-03).
--
-- The owner's brief makes Match Centre the one destination for a game: one surface whose sections --
-- Overview, Arena Details, Result, Attendance, Changing Room, Rewards & Recognition -- are filled by
-- what the SERVER says this viewer may see and do. Nothing here is a second model. It extends the
-- canonical ones:
--
--   * attendance stays `player_fixture_attendance`, now OPENING six days before the match (staff can
--     open it earlier), and its rows are no longer readable by the OTHER side's staff -- the opposition
--     gets numbers, never names;
--   * one read, `get_match_centre_attendance`, answers per side with names, numbers or nothing, and
--     derives the catering headcount from the same answers;
--   * the changing-room allocation references the venue's own `venue_changing_rooms`;
--   * announcements stay `send_fixture_communication`, with the audiences the brief names, and now
--     remember who they reached so the Changing Room can show them;
--   * awards stay the match community model (20270522), now opening at kick-off, configured club
--     default -> team override, given directly by staff where the award is staff-chosen, with one
--     parents' vote per child;
--   * public club and team pages are projections of the canonical records, squad and media shared only
--     where the club or team says so.

-- =====================================================================================================
-- 1. ATTENDANCE OPENS SIX DAYS BEFORE THE MATCH
-- =====================================================================================================

alter table public.platform_scheduling_defaults
  add column if not exists attendance_open_days integer not null default 6;
alter table public.platform_scheduling_defaults drop constraint if exists platform_scheduling_defaults_attendance_open_days_range;
alter table public.platform_scheduling_defaults add constraint platform_scheduling_defaults_attendance_open_days_range
  check (attendance_open_days between 1 and 60);
comment on column public.platform_scheduling_defaults.attendance_open_days is
  'How many days before kick-off a fixture''s attendance opens by default (owner rule: six).';

alter table public.club_scheduling_policy add column if not exists attendance_open_days integer;
alter table public.club_scheduling_policy drop constraint if exists club_scheduling_policy_attendance_open_days_range;
alter table public.club_scheduling_policy add constraint club_scheduling_policy_attendance_open_days_range
  check (attendance_open_days is null or attendance_open_days between 1 and 60);
comment on column public.club_scheduling_policy.attendance_open_days is
  'A club''s own opening window; null inherits the platform default.';

alter table public.fixtures add column if not exists attendance_opened_at timestamptz;
alter table public.fixtures add column if not exists attendance_opened_by uuid references auth.users(id);
comment on column public.fixtures.attendance_opened_at is
  'When staff opened this side''s attendance early. Null means it opens on the default window.';

-- The window that applies to one fixture row: its owning club's setting, else the platform's.
create or replace function internal.fixture_attendance_open_days(p_fixture_id uuid)
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
           (select csp.attendance_open_days
              from public.fixtures f
              join public.teams t on t.id = f.owning_team_id
              join public.club_scheduling_policy csp on csp.club_id = t.club_id
             where f.id = p_fixture_id),
           (select d.attendance_open_days from public.platform_scheduling_defaults d limit 1),
           6);
$function$;

-- The day a fixture row's attendance opens on its own, without staff opening it early.
create or replace function internal.fixture_attendance_opens_on(p_fixture_id uuid)
returns date
language sql
stable security definer
set search_path to ''
as $function$
  select f.kickoff_date - internal.fixture_attendance_open_days(p_fixture_id)
    from public.fixtures f where f.id = p_fixture_id;
$function$;

create or replace function internal.fixture_attendance_is_open(p_fixture_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select f.attendance_opened_at is not null
         or current_date >= internal.fixture_attendance_opens_on(p_fixture_id)
    from public.fixtures f where f.id = p_fixture_id;
$function$;

-- THE ONE FIXTURE-LEVEL RULE the writer and every reader apply, extended with the opening window, so a
-- parent is never offered a control the write will refuse.
create or replace function internal.fixture_accepts_attendance(p_fixture_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return 'This fixture could not be found.';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    return 'This fixture has been cancelled, so no answer is needed.';
  end if;
  if not internal.fixture_attendance_is_open(p_fixture_id) then
    return 'Attendance opens on '
           || to_char(internal.fixture_attendance_opens_on(p_fixture_id), 'FMDay FMDD FMMonth')
           || ', '
           || internal.fixture_attendance_open_days(p_fixture_id)
           || ' days before the match.';
  end if;
  return null;
end;
$function$;

-- The players a fixture row asks: its OWN side's, so a mirrored pair never invites one family twice.
-- An Ovalball opponent without a row of its own yet (no mirror) is asked from this row as before.
create or replace function internal.fixture_side_outstanding_players(p_fixture_id uuid)
returns table(player_id uuid)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  with f as (select * from public.fixtures where id = p_fixture_id),
  side_teams as (
    select f.owning_team_id as team_id from f where f.owning_team_id is not null
    union
    select sgm.team_id from f join public.scheduling_group_members sgm on sgm.group_id = f.owning_scheduling_group_id
    union
    select f.opponent_team_id from f where f.opponent_team_id is not null and f.mirror_fixture_id is null
    union
    select sgm.team_id from f join public.scheduling_group_members sgm on sgm.group_id = f.opponent_scheduling_group_id
     where f.mirror_fixture_id is null
  ),
  participants as (
    select distinct ptm.player_id
      from public.player_team_memberships ptm
      join side_teams s on s.team_id = ptm.team_id
     where ptm.status = 'active'
    union
    select distinct c.player_id
      from public.fixture_player_call_up c
      join side_teams s on s.team_id = c.target_team_id
     where c.fixture_id = p_fixture_id and c.status = 'approved'
  )
  select p.player_id from participants p
   where not exists (select 1 from public.player_fixture_attendance a
                      where a.fixture_id = p_fixture_id and a.player_id = p.player_id);
$function$;

-- Ask one fixture row's families now: the job below, and staff opening attendance early, both use it.
-- THE OTHER CLUB, BY NAME -- for a sentence a family reads ("against Preston Grasshoppers RFC"). The
-- opposing side's club as the Club Directory names it, never its team's own label ("Under 12 Boys",
-- which every side at that age shares); for a side that is only a name, the name that was typed.
create or replace function internal.fixture_opponent_name(p_fixture_id uuid, p_for_team_id uuid default null)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when p_for_team_id is not null and p_for_team_id = f.opponent_team_id then
      (select cd.name from public.teams t join public.clubs c on c.id = t.club_id
         join public.club_directory cd on cd.id = c.directory_id where t.id = f.owning_team_id)
    else coalesce(
      (select cd.name from public.teams t join public.clubs c on c.id = t.club_id
         join public.club_directory cd on cd.id = c.directory_id where t.id = f.opponent_team_id),
      (select cd.name from public.club_directory cd where cd.id = f.opponent_directory_id),
      nullif(btrim(f.raw_opposition_text), ''))
  end
  from public.fixtures f where f.id = p_fixture_id;
$function$;
revoke all on function internal.fixture_opponent_name(uuid, uuid) from public, anon, authenticated;

create or replace function internal.send_fixture_attendance_invitations_for(p_fixture_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_fixture record;
  v_inserted integer := 0;
begin
  select f.id, f.kickoff_date, f.kickoff_time, f.meet_time,
         coalesce(t.display_name, 'Your team') as team_label,
         internal.fixture_opponent_name(f.id, f.owning_team_id) as opponent_label
    into v_fixture
    from public.fixtures f
    left join public.teams t on t.id = f.owning_team_id
   where f.id = p_fixture_id
     and f.cancelled_at is null and f.status not in ('Completed', 'Cancelled')
     and f.kickoff_date >= current_date;
  if v_fixture.id is null then
    return 0;
  end if;

  with eligible as (
    select distinct e.user_id
    from internal.player_contact_eligibility(
      array(select player_id from internal.fixture_side_outstanding_players(v_fixture.id))
    ) e
    where e.user_id is not null
      and not exists (
        select 1 from public.fixture_attendance_invitations i
        where i.fixture_id = v_fixture.id and i.user_id = e.user_id
      )
  ),
  recorded as (
    insert into public.fixture_attendance_invitations (fixture_id, user_id)
    select v_fixture.id, e.user_id from eligible e
    on conflict do nothing
    returning user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select
    rec.user_id,
    'fixture_attendance_invitation',
    'Attendance is open',
    v_fixture.team_label
      || coalesce(' v ' || v_fixture.opponent_label, '')
      || ', '
      || to_char(v_fixture.kickoff_date, 'FMDay FMDD FMMonth')
      || coalesce(', meet ' || to_char(v_fixture.meet_time, 'HH24:MI'), '')
      || coalesce(', kick-off ' || to_char(v_fixture.kickoff_time, 'HH24:MI'), '')
      || '. Let the team know if you can make it.',
    jsonb_build_object('fixture_id', v_fixture.id)
  from recorded rec;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

-- THE WINDOW, NOT A FORTNIGHT. A fixture row is due once its attendance is open -- by the default
-- window or because staff opened it early -- and until it is played.
create or replace function internal.fixtures_due_attendance_invitation()
returns table(fixture_id uuid)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select f.id
  from public.fixtures f
  where f.cancelled_at is null
    and f.status not in ('Completed', 'Cancelled')
    and f.kickoff_date >= current_date
    and internal.fixture_attendance_is_open(f.id);
$function$;

create or replace function internal.send_due_fixture_attendance_invitations()
returns integer
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_sent integer := 0;
  r record;
begin
  for r in select d.fixture_id from internal.fixtures_due_attendance_invitation() d loop
    v_sent := v_sent + internal.send_fixture_attendance_invitations_for(r.fixture_id);
  end loop;
  return v_sent;
end;
$function$;

-- STAFF MAY OPEN IT EARLIER. Their own side's row (and its families are asked at once); a manager of
-- both sides opens both.
create or replace function public.open_fixture_attendance(p_fixture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  m public.fixtures;
  v_opened integer := 0;
  v_invited integer := 0;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    raise exception 'This fixture has been cancelled.' using errcode = '22023';
  end if;
  select * into m from public.fixtures where id = f.mirror_fixture_id;

  if internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id) then
    update public.fixtures set attendance_opened_at = coalesce(attendance_opened_at, now()),
                               attendance_opened_by = coalesce(attendance_opened_by, auth.uid())
     where id = f.id;
    v_opened := v_opened + 1;
    v_invited := v_invited + internal.send_fixture_attendance_invitations_for(f.id);
  end if;
  -- An Ovalball opponent with no row of its own yet opens on this row, which asks both sides.
  if m.id is null and v_opened = 0 and f.opponent_team_id is not null
     and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id) then
    update public.fixtures set attendance_opened_at = coalesce(attendance_opened_at, now()),
                               attendance_opened_by = coalesce(attendance_opened_by, auth.uid())
     where id = f.id;
    v_opened := v_opened + 1;
    v_invited := v_invited + internal.send_fixture_attendance_invitations_for(f.id);
  end if;
  if m.id is not null and internal.can_manage_fixture_side(m.owning_team_id, m.owning_scheduling_group_id) then
    update public.fixtures set attendance_opened_at = coalesce(attendance_opened_at, now()),
                               attendance_opened_by = coalesce(attendance_opened_by, auth.uid())
     where id = m.id;
    v_opened := v_opened + 1;
    v_invited := v_invited + internal.send_fixture_attendance_invitations_for(m.id);
  end if;
  if v_opened = 0 then
    raise exception 'You are not authorised to open attendance for this fixture.' using errcode = '42501';
  end if;
  return jsonb_build_object('opened', v_opened, 'invited', v_invited);
end;
$function$;
revoke all on function public.open_fixture_attendance(uuid) from public, anon;
grant execute on function public.open_fixture_attendance(uuid) to authenticated;

-- =====================================================================================================
-- 2. THE OTHER SIDE'S STAFF READ NUMBERS, NEVER NAMES
--
-- `player_fixture_attendance_select_scoped` let a member of staff on EITHER side read every row on the
-- fixture, so an opposition coach could read the home side's player ids and answers directly. A row is
-- now readable by staff only for a player in a team they hold attendance authority for. The other
-- side's numbers come from `get_match_centre_attendance`, which never returns a name across the line.
-- =====================================================================================================

create or replace function internal.can_view_fixture_attendance_of(p_fixture_id uuid, p_player_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from internal.fixture_participant_team_ids(p_fixture_id) pt
      join public.teams t on t.id = pt.team_id
     where (internal.can('team.attendance.view', 'team', t.club_id, t.id, null)
            or internal.can('team.attendance.view', 'club', t.club_id, null, null))
       and (exists (select 1 from public.player_team_memberships ptm
                     where ptm.player_id = p_player_id and ptm.team_id = t.id and ptm.status = 'active')
            or exists (select 1 from public.fixture_player_call_up c
                        where c.fixture_id = p_fixture_id and c.player_id = p_player_id
                          and c.target_team_id = t.id and c.status = 'approved'))
  );
$function$;

drop policy if exists player_fixture_attendance_select_scoped on public.player_fixture_attendance;
create policy player_fixture_attendance_select_scoped on public.player_fixture_attendance
  for select to authenticated
  using (
    internal.has_site_capability('site.fixtures.view')
    or internal.is_active_player_guardian(player_id)
    or internal.is_own_linked_player(player_id)
    or (fixture_id is not null and internal.can_view_fixture_attendance_of(fixture_id, player_id))
  );

-- =====================================================================================================
-- 3. WHO IS LOOKING -- the viewer's relationship to each side, from canonical relationships only
-- =====================================================================================================

-- Can the caller read this fixture row at all: the same expression `fixtures_select_related` applies.
create or replace function internal.fixture_visible_to_caller(p_fixture_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.fixtures f
     where f.id = p_fixture_id
       and (f.owning_team_id in (select unnest(internal.viewable_fixture_teams()))
         or f.opponent_team_id in (select unnest(internal.viewable_fixture_teams()))
         or f.owning_team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs())))
         or f.opponent_team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs())))
         or f.owning_scheduling_group_id in (
              select sgm.group_id from public.scheduling_group_members sgm
               where sgm.team_id in (select unnest(internal.viewable_fixture_teams()))
                  or sgm.team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs()))))
         or f.opponent_scheduling_group_id in (
              select sgm.group_id from public.scheduling_group_members sgm
               where sgm.team_id in (select unnest(internal.viewable_fixture_teams()))
                  or sgm.team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs()))))
         or internal.fixture_family_visible_row(f.owning_team_id, f.opponent_team_id, f.owning_scheduling_group_id, f.opponent_scheduling_group_id)
         or internal.has_site_capability('site.fixtures.view'))
  );
$function$;

-- The teams that make up one side of a fixture row: its anchor team and any scheduling-group members.
create or replace function internal.fixture_side_team_ids(p_fixture_id uuid, p_side text)
returns table(team_id uuid)
language sql
stable security definer
set search_path to ''
as $function$
  with f as (select * from public.fixtures where id = p_fixture_id),
  anchor as (
    select case when (p_side = 'home') = (coalesce(f.home_away, 'Home') <> 'Away') then f.owning_team_id else f.opponent_team_id end as team_id,
           case when (p_side = 'home') = (coalesce(f.home_away, 'Home') <> 'Away') then f.owning_scheduling_group_id else f.opponent_scheduling_group_id end as group_id
      from f
  )
  select a.team_id from anchor a where a.team_id is not null
  union
  select sgm.team_id from anchor a join public.scheduling_group_members sgm on sgm.group_id = a.group_id;
$function$;

-- How the caller stands to one side: STAFF (attendance authority), FAMILY (guardian of a member, or the
-- player themselves), or nothing.
create or replace function internal.fixture_side_relationship(p_fixture_id uuid, p_side text)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when exists (
      select 1 from internal.fixture_side_team_ids(p_fixture_id, p_side) s
        join public.teams t on t.id = s.team_id
       where internal.can('team.attendance.view', 'team', t.club_id, t.id, null)
          or internal.can('team.attendance.view', 'club', t.club_id, null, null)
          or internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null)
          or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null))
      then 'STAFF'
    when exists (
      select 1 from internal.fixture_side_team_ids(p_fixture_id, p_side) s
        join public.player_team_memberships ptm on ptm.team_id = s.team_id and ptm.status = 'active'
       -- The canonical family decision: a guardian of, or the player themselves, answering in the Match
       -- Centre -- the same capability that lets them answer attendance.
       where internal.can_player_as_family('matchcentre.attendance.respond', ptm.player_id))
      then 'FAMILY'
    else null
  end;
$function$;

-- THE OTHER ROW OF A MIRRORED PAIR answers for the other side's families, so a side's answers are read
-- from whichever row of the pair they were given on.
create or replace function internal.fixture_pair_ids(p_fixture_id uuid)
returns uuid[]
language sql
stable security definer
set search_path to ''
as $function$
  select array_remove(array[f.id, f.mirror_fixture_id], null) from public.fixtures f where f.id = p_fixture_id;
$function$;

-- One side's squad and what each player said (the latest answer across the pair).
create or replace function internal.fixture_side_answers(p_fixture_id uuid, p_side text)
returns table(player_id uuid, status text)
language sql
stable security definer
set search_path to ''
as $function$
  with teams as (select team_id from internal.fixture_side_team_ids(p_fixture_id, p_side)),
  squad as (
    select distinct ptm.player_id from public.player_team_memberships ptm
      join teams t on t.team_id = ptm.team_id
     where ptm.status = 'active'
    union
    select distinct c.player_id from public.fixture_player_call_up c
      join teams t on t.team_id = c.target_team_id
     where c.fixture_id = any (internal.fixture_pair_ids(p_fixture_id)) and c.status = 'approved'
  )
  select s.player_id,
         (select a.status from public.player_fixture_attendance a
           where a.fixture_id = any (internal.fixture_pair_ids(p_fixture_id)) and a.player_id = s.player_id
           order by a.updated_at desc nulls last limit 1)
    from squad s;
$function$;

-- =====================================================================================================
-- 4. ARRANGEMENTS: CHANGING ROOMS AND CATERING
-- =====================================================================================================

alter table public.fixtures add column if not exists home_changing_room_id uuid references public.venue_changing_rooms(id) on delete set null;
alter table public.fixtures add column if not exists away_changing_room_id uuid references public.venue_changing_rooms(id) on delete set null;
alter table public.fixtures add column if not exists catering_required boolean not null default false;
comment on column public.fixtures.home_changing_room_id is 'The venue changing room the HOME side uses for this match.';
comment on column public.fixtures.away_changing_room_id is 'The venue changing room the AWAY side uses for this match.';
comment on column public.fixtures.catering_required is
  'Whether the host is catering for this match; the headcount is derived from attendance, never typed.';

create or replace function public.set_fixture_arrangements(
  p_fixture_id uuid,
  p_home_changing_room_id uuid,
  p_away_changing_room_id uuid,
  p_changing_room_notes text,
  p_catering_required boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_changed_rooms boolean;
  v_notes text := nullif(btrim(coalesce(p_changing_room_notes, '')), '');
  v_label text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;
  if not (internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
          or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))) then
    raise exception 'You are not authorised to change this fixture''s arrangements.' using errcode = '42501';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    raise exception 'This fixture has been cancelled.' using errcode = '22023';
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Keep the changing-room notes under 500 characters.' using errcode = '22023';
  end if;
  -- A ROOM IS ONE OF THIS GROUND'S ROOMS. Choosing a room at another club's ground is not a decision
  -- anybody can act on.
  if (p_home_changing_room_id is not null or p_away_changing_room_id is not null) then
    if f.venue_id is null then
      raise exception 'Choose the ground before allocating changing rooms.' using errcode = '22023';
    end if;
    if exists (select 1 from public.venue_changing_rooms r
                where r.id in (p_home_changing_room_id, p_away_changing_room_id)
                  and (r.venue_id is distinct from f.venue_id or not r.active)) then
      raise exception 'That changing room is not at this ground.' using errcode = '22023';
    end if;
  end if;

  v_changed_rooms := f.home_changing_room_id is distinct from p_home_changing_room_id
                  or f.away_changing_room_id is distinct from p_away_changing_room_id;

  -- ONE MATCH, TWO ROWS: both clubs' rows describe the same arrangements.
  update public.fixtures
     set home_changing_room_id = p_home_changing_room_id,
         away_changing_room_id = p_away_changing_room_id,
         changing_room = v_notes,
         catering_required = coalesce(p_catering_required, false),
         updated_by = auth.uid(), updated_at = now()
   where id = any (internal.fixture_pair_ids(p_fixture_id));

  -- A ROOM ALLOCATION IS NEWS ONCE FAMILIES ARE BEING ASKED ABOUT THE MATCH, not while it is a plan.
  if v_changed_rooms and f.kickoff_date >= current_date and internal.fixture_attendance_is_open(f.id) then
    select coalesce(t.display_name, 'Your team') into v_label from public.teams t where t.id = f.owning_team_id;
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'fixture_arrangements_changed', 'Changing rooms allocated',
           v_label || ' on ' || to_char(f.kickoff_date, 'FMDay FMDD FMMonth')
             || ': the changing rooms for this match have been set. See Arena Details.',
           jsonb_build_object('fixture_id', fx.id)
      from unnest(internal.fixture_pair_ids(p_fixture_id)) fx(id)
      cross join lateral (
        select distinct e.user_id
          from internal.player_contact_eligibility(array(
            select ptm.player_id from public.player_team_memberships ptm
              join public.fixtures ff on ff.id = fx.id
             where ptm.status = 'active'
               and (ptm.team_id = ff.owning_team_id
                    or ptm.team_id in (select sgm.team_id from public.scheduling_group_members sgm where sgm.group_id = ff.owning_scheduling_group_id))
          )) e
         where e.user_id is not null and e.user_id is distinct from auth.uid()
      ) r;
  end if;
end;
$function$;
revoke all on function public.set_fixture_arrangements(uuid, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_fixture_arrangements(uuid, uuid, uuid, text, boolean) to authenticated;

-- =====================================================================================================
-- 5. THE MATCH CENTRE'S ATTENDANCE, AND THE CATERING NUMBER DERIVED FROM IT
--
-- Per side: NAMES for that side's own staff, NUMBERS for the other side's staff and for the side's own
-- families, NOTHING for anybody else. Catering is an operational number for staff of either side:
-- each Ovalball side's ATTENDING players, summed, with the parts shown so the total can be checked.
-- Unsure and awaiting are not counted; nothing is guessed about guests, because no guest number is
-- recorded anywhere.
-- =====================================================================================================

create or replace function public.get_match_centre_attendance(p_fixture_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
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

  v_catering := case when v_is_staff_any then jsonb_build_object(
      'required', f.catering_required,
      'total', v_total,
      'parts', v_parts,
      'sidesNotCounted', to_jsonb(v_missing),
      'basis', 'Players marked Attending on each Ovalball side. Unsure and awaiting are not counted.')
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
revoke all on function public.get_match_centre_attendance(uuid) from public, anon;
grant execute on function public.get_match_centre_attendance(uuid) to authenticated;

-- The viewer's standing on the match, for the hero ("You're Home") and the sections.
create or replace function public.get_match_centre_viewer(p_fixture_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_home text;
  v_away text;
  v_side text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id;
  if not found or not internal.fixture_visible_to_caller(p_fixture_id) then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;
  v_home := internal.fixture_side_relationship(p_fixture_id, 'home');
  v_away := internal.fixture_side_relationship(p_fixture_id, 'away');
  -- WHERE A PERSON STANDS ON BOTH SIDES -- a club running both teams -- the row's own side is theirs.
  v_side := case
    when v_home is not null and v_away is not null then case when coalesce(f.home_away, 'Home') <> 'Away' then 'home' else 'away' end
    when v_home is not null then 'home'
    when v_away is not null then 'away'
    else null end;
  return jsonb_build_object(
    'side', v_side,
    'home', v_home,
    'away', v_away,
    'canManage', internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
                 or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)),
    'kickedOff', internal.fixture_result_eligible(f.id),
    -- WHERE IT IS, FOR BOTH SIDES. The away side cannot read the home club's venue rows, so its families
    -- were told "To be confirmed" for a ground the home side knew. A club's ground is public (the Club
    -- Directory publishes it); this is the fixture's chosen venue, else the home side's default ground,
    -- for somebody already allowed to see the match.
    'ground', (
      select jsonb_build_object(
               'name', v.name,
               'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.address_line_2), ''),
                                                    nullif(btrim(v.town), ''), nullif(btrim(v.county), '')), ''), nullif(btrim(v.address), '')),
               'postcode', v.postcode,
               'latitude', v.latitude,
               'longitude', v.longitude,
               'source', s.source)
        from (
          select f.venue_id as id, 'fixture_venue'::text as source, 1 as rank where f.venue_id is not null
          union all
          select hv.id, 'home_ground', 2
            from public.venues hv
           where hv.is_default_home and hv.active
             and hv.club_id = (select t.club_id from public.teams t
                                where t.id = case when coalesce(f.home_away, 'Home') = 'Away' then f.opponent_team_id else f.owning_team_id end)
        ) s
        join public.venues v on v.id = s.id
       order by s.rank
       limit 1));
end;
$function$;
revoke all on function public.get_match_centre_viewer(uuid) from public, anon;
grant execute on function public.get_match_centre_viewer(uuid) to authenticated;
-- =====================================================================================================
-- 6. ANNOUNCEMENTS AND REMINDERS: THE AUDIENCES THE BRIEF NAMES, AND A RECORD OF WHO THEY REACHED
-- =====================================================================================================

-- Which side sent it, and who it reached, so the Changing Room can show an announcement to the people
-- it was for and to that side's staff -- never to the other side.
alter table public.fixture_communications add column if not exists sent_for_team_ids uuid[];

-- THE NEW AUDIENCES ARE REAL ACTIONS. The table only admitted the original three, so a reminder to the
-- Unsure or a message to Can't Attend would have been refused by the row itself. A reminder may now
-- carry an optional note (it still needs none); a message still needs words. Every existing row
-- satisfies both, so this only widens.
alter table public.fixture_communications drop constraint if exists fixture_communications_action_check;
alter table public.fixture_communications add constraint fixture_communications_action_check
  check (action in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE',
                    'MESSAGE_ATTENDEES', 'MESSAGE_TEAM', 'MESSAGE_CANNOT_ATTEND', 'MESSAGE_UNSURE', 'MESSAGE_AWAITING'));
alter table public.fixture_communications drop constraint if exists fixture_communications_body_shape;
alter table public.fixture_communications add constraint fixture_communications_body_shape
  check ((action in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE')
          and (body is null or length(btrim(body)) > 0))
      or (action not in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE')
          and body is not null and length(btrim(body)) > 0));

create table if not exists public.fixture_communication_recipients (
  communication_id uuid not null references public.fixture_communications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (communication_id, user_id)
);
comment on table public.fixture_communication_recipients is
  'Who a fixture announcement or reminder was sent to, recorded at send time (the audience is a moment, not a rule re-run later).';
alter table public.fixture_communication_recipients enable row level security;
revoke all on public.fixture_communication_recipients from anon, authenticated;
-- No client policy: the Changing Room reads announcements through get_fixture_announcements.

-- THE AUDIENCES. "Outstanding" (no answer) and "unsure" are reminders; the rest are announcements.
create or replace function internal.fixture_audience_players(p_fixture_id uuid, p_audience text)
returns table(player_id uuid)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  with team_ids as (
    select team_id from internal.fixture_communication_team_ids(p_fixture_id)
  ),
  participants as (
    -- Permanent members of the caller's involved teams.
    select distinct ptm.player_id
    from public.player_team_memberships ptm
    join team_ids ti on ti.team_id = ptm.team_id
    where ptm.status = 'active'
    union
    -- Approved call-ups INTO one of those teams for this fixture.
    select distinct c.player_id
    from public.fixture_player_call_up c
    join team_ids ti on ti.team_id = c.target_team_id
    where c.fixture_id = p_fixture_id
      and c.status = 'approved'
  ),
  responses as (
    select a.player_id, a.status
    from public.player_fixture_attendance a
    where a.fixture_id = any (internal.fixture_pair_ids(p_fixture_id))
  )
  select p.player_id
  from participants p
  left join responses r on r.player_id = p.player_id
  where case p_audience
    -- Outstanding means NO canonical response exists. Attending, cannot
    -- attend and unsure are all answers, and a parent who has given one must
    -- not be chased.
    when 'ATTENDANCE_REMINDER' then r.status is null
    when 'REMIND_UNSURE' then r.status = 'UNSURE'
    when 'REMIND_AWAITING_AND_UNSURE' then r.status is null or r.status = 'UNSURE'
    when 'MESSAGE_ATTENDEES' then r.status = 'ATTENDING'
    when 'MESSAGE_CANNOT_ATTEND' then r.status = 'CANNOT_ATTEND'
    when 'MESSAGE_UNSURE' then r.status = 'UNSURE'
    when 'MESSAGE_AWAITING' then r.status is null
    when 'MESSAGE_TEAM' then true
    else false
  end;
$function$;

create or replace function internal.fixture_communication_audience_label(p_action text)
returns text language sql immutable set search_path to '' as $function$
  select case p_action
    when 'MESSAGE_TEAM' then 'All'
    when 'MESSAGE_ATTENDEES' then 'Attending'
    when 'MESSAGE_CANNOT_ATTEND' then 'Can''t Attend'
    when 'MESSAGE_UNSURE' then 'Unsure'
    when 'MESSAGE_AWAITING' then 'Awaiting'
    when 'ATTENDANCE_REMINDER' then 'Awaiting'
    when 'REMIND_UNSURE' then 'Unsure'
    when 'REMIND_AWAITING_AND_UNSURE' then 'Awaiting and Unsure'
    else p_action end;
$function$;

create or replace function public.send_fixture_communication(p_fixture_id uuid, p_action text, p_body text default null)
returns table(outcome text, player_count integer, recipient_count integer)
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_actor uuid := auth.uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_players integer := 0;
  v_recipients integer := 0;
  v_recent integer;
  v_today integer;
  v_type text;
  v_title text;
  v_notify_body text;
  v_outcome text;
  v_team_label text;
  v_opponent text;
  v_reminder boolean := p_action in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE');
  v_id uuid;
  v_teams uuid[];
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  if p_action not in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE',
                      'MESSAGE_ATTENDEES', 'MESSAGE_TEAM', 'MESSAGE_CANNOT_ATTEND', 'MESSAGE_UNSURE', 'MESSAGE_AWAITING') then
    raise exception 'Unknown communication action.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    -- Same message for "no such fixture" and "not yours", so the id space
    -- cannot be probed for fixtures the caller cannot see.
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;

  -- AUTHORITY. Deliberately the same check the Match Centre's own
  -- canManageFixture flag uses -- a staff communication is a fixture
  -- management act, not a new kind of permission. A guardian or player never
  -- satisfies this, however legitimately they can see the fixture.
  if not (
    internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
    or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
  ) then
    raise exception 'You are not authorized to send communications for this fixture.' using errcode = '42501';
  end if;

  -- A REMINDER IS ABOUT ATTENDANCE, so it waits until attendance is open.
  if v_reminder and not internal.fixture_attendance_is_open(p_fixture_id) then
    raise exception 'Attendance is not open yet. Open it before sending a reminder.' using errcode = '22023';
  end if;
  if not v_reminder and v_body is null then
    raise exception 'Write a message before sending.';
  end if;
  if v_body is not null and length(v_body) > 2000 then
    raise exception 'That message is too long. Please keep it under 2000 characters.';
  end if;

  select array_agg(team_id) into v_teams from internal.fixture_communication_team_ids(p_fixture_id);

  -- ---- rate / duplicate protection ----
  select count(*) into v_recent
  from public.fixture_communications fc
  where fc.fixture_id = p_fixture_id and fc.action = p_action and fc.sent_by = v_actor
    and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and fc.created_at > now() - interval '10 minutes';
  if v_recent > 0 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, body, sent_for_team_ids)
    values (p_fixture_id, p_action, v_actor, 'RATE_LIMITED', v_body, v_teams);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  select count(*) into v_today
  from public.fixture_communications fc
  where fc.fixture_id = p_fixture_id and fc.action = p_action
    and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and fc.created_at > now() - interval '24 hours';
  if v_today >= 12 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, body, sent_for_team_ids)
    values (p_fixture_id, p_action, v_actor, 'RATE_LIMITED', v_body, v_teams);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  -- ---- audience ----
  select count(*) into v_players from internal.fixture_audience_players(p_fixture_id, p_action);
  select count(*) into v_recipients from internal.fixture_audience_recipients(p_fixture_id, p_action);

  if v_recipients = 0 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, player_count, recipient_count, body, sent_for_team_ids)
    values (p_fixture_id, p_action, v_actor, 'NO_ELIGIBLE_RECIPIENTS', v_players, 0, v_body, v_teams);
    return query select 'NO_ELIGIBLE_RECIPIENTS'::text, v_players, 0;
    return;
  end if;

  -- ---- content, resolved from canonical facts at send time ----
  select t.display_name into v_team_label from public.teams t where t.id = f.owning_team_id;
  v_opponent := coalesce(
    (select t2.display_name from public.teams t2 where t2.id = f.opponent_team_id),
    f.raw_opposition_text,
    'opposition to be confirmed'
  );

  if v_reminder then
    v_type := 'fixture_attendance_reminder';
    v_title := 'Attendance needed: ' || coalesce(v_team_label, 'your team') || ' v ' || v_opponent;
    v_notify_body := coalesce(v_body || ' ', '') ||
      to_char(f.kickoff_date, 'FMDay FMDD FMMon') ||
      coalesce(', meet ' || to_char(f.meet_time, 'HH24:MI'), '') ||
      coalesce(', kick-off ' || to_char(f.kickoff_time, 'HH24:MI'), '') ||
      coalesce('. ' || (select v.name from public.venues v where v.id = f.venue_id), '') ||
      case when p_action = 'REMIND_UNSURE' then '. You said you were unsure -- please update the team when you know.'
           else '. Please let the team know if your player can make it.' end;
  else
    v_type := 'fixture_staff_message';
    v_title := coalesce(v_team_label, 'Your team') || ' v ' || v_opponent;
    v_notify_body := v_body;
  end if;

  insert into public.fixture_communications (fixture_id, action, sent_by, outcome, player_count, recipient_count, body, sent_for_team_ids)
  values (p_fixture_id, p_action, v_actor, 'SENT', v_players, v_recipients, v_body, v_teams)
  returning id into v_id;

  insert into public.fixture_communication_recipients (communication_id, user_id)
  select v_id, r.user_id from internal.fixture_audience_recipients(p_fixture_id, p_action) r
  on conflict do nothing;

  -- ---- deliver ----
  insert into public.notifications (user_id, type, title, body, data)
  select r.user_id, v_type, v_title, v_notify_body,
         jsonb_build_object('fixture_id', p_fixture_id, 'action', p_action, 'communication_id', v_id)
  from internal.fixture_audience_recipients(p_fixture_id, p_action) r;

  get diagnostics v_today = row_count;

  v_outcome := case
    when v_today = 0 then 'FAILED'
    when v_today < v_recipients then 'PARTIALLY_DELIVERED'
    else 'SENT'
  end;

  update public.fixture_communications set outcome = v_outcome, delivered_count = v_today where id = v_id;

  return query select v_outcome, v_players, v_recipients;
end;
$function$;

-- Counts for the composer, per audience. Null for anybody without fixture-communication authority.
drop function if exists public.fixture_communication_counts(uuid);
create function public.fixture_communication_counts(p_fixture_id uuid)
returns table(outstanding_count integer, attending_count integer, team_count integer, unsure_count integer, cannot_attend_count integer)
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if not exists (
    select 1 from public.fixtures f
    where f.id = p_fixture_id
      and (
        internal.has_site_capability('site.fixtures.view')
        or internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
        or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
      )
  ) then
    return query select null::integer, null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  return query
  select
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'ATTENDANCE_REMINDER')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_ATTENDEES')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_TEAM')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_UNSURE')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_CANNOT_ATTEND'));
end;
$function$;
revoke all on function public.fixture_communication_counts(uuid) from public, anon;
grant execute on function public.fixture_communication_counts(uuid) to authenticated;

-- THE CHANGING ROOM'S ANNOUNCEMENTS: those sent to the caller, and -- for the sending side's staff --
-- everything that side sent, with who it went to. Never the other side's.
create or replace function public.get_fixture_announcements(p_fixture_id uuid)
returns table(
  communication_id uuid, kind text, audience text, body text, sent_by_name text, sent_at timestamptz,
  recipient_count integer, sent_to_me boolean, from_my_side boolean
)
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  perform internal.require_live_session();
  if not internal.fixture_visible_to_caller(p_fixture_id) then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;

  return query
  select fc.id,
         case when fc.action in ('ATTENDANCE_REMINDER', 'REMIND_UNSURE', 'REMIND_AWAITING_AND_UNSURE') then 'REMINDER' else 'ANNOUNCEMENT' end,
         internal.fixture_communication_audience_label(fc.action),
         fc.body,
         nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''),
         fc.created_at,
         case when mine.side then fc.recipient_count end,
         exists (select 1 from public.fixture_communication_recipients r where r.communication_id = fc.id and r.user_id = v_actor),
         mine.side
    from public.fixture_communications fc
    left join public.profiles pr on pr.id = fc.sent_by
    cross join lateral (
      select coalesce(exists (
        select 1 from unnest(coalesce(fc.sent_for_team_ids, '{}')) tid
          join public.teams t on t.id = tid
         where internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null)
            or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null)), false) as side
    ) mine
   where fc.fixture_id = any (internal.fixture_pair_ids(p_fixture_id))
     and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
     and (mine.side or exists (select 1 from public.fixture_communication_recipients r where r.communication_id = fc.id and r.user_id = v_actor))
   order by fc.created_at desc
   limit 50;
end;
$function$;
revoke all on function public.get_fixture_announcements(uuid) from public, anon;
grant execute on function public.get_fixture_announcements(uuid) to authenticated;

-- =====================================================================================================
-- 7. A CHANGED MEET TIME IS NEWS -- for this side's families, while the match is still to come
-- =====================================================================================================

create or replace function public.update_fixture_meet_time(p_fixture_id uuid, p_meet_time time without time zone)
returns time without time zone
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  -- Checked here as well as in the CHECK constraints so the caller gets a
  -- sentence they can act on rather than a constraint-violation string.
  if p_meet_time is not null then
    if f.kickoff_time is null then
      raise exception 'Set a kick-off time before adding a meet time.';
    end if;
    if p_meet_time > f.kickoff_time then
      raise exception 'The meet time must be at or before kick-off.';
    end if;
  end if;

  update public.fixtures
  set meet_time = p_meet_time, updated_by = auth.uid(), updated_at = now()
  where id = p_fixture_id;

  -- THE ONE TIME A FAMILY ACTS ON. Told once it changes, to this side's families -- a meet time is a
  -- side's own arrangement -- and only for a match still to come that families have been asked about.
  if f.meet_time is distinct from p_meet_time and p_meet_time is not null
     and f.kickoff_date >= current_date and f.cancelled_at is null
     and internal.fixture_attendance_is_open(f.id) then
    select coalesce(t.display_name, 'Your team') into v_label from public.teams t where t.id = f.owning_team_id;
    insert into public.notifications (user_id, type, title, body, data)
    select distinct e.user_id, 'fixture_meet_time_changed', 'Meet time changed',
           v_label || ' on ' || to_char(f.kickoff_date, 'FMDay FMDD FMMonth') || ': meet at '
             || to_char(p_meet_time, 'HH24:MI')
             || coalesce(', kick-off ' || to_char(f.kickoff_time, 'HH24:MI'), '') || '.',
           jsonb_build_object('fixture_id', f.id)
      from internal.player_contact_eligibility(array(
             select ptm.player_id from public.player_team_memberships ptm
              where ptm.status = 'active'
                and (ptm.team_id = f.owning_team_id
                     or ptm.team_id in (select sgm.team_id from public.scheduling_group_members sgm where sgm.group_id = f.owning_scheduling_group_id)))) e
     where e.user_id is not null;
  end if;

  return p_meet_time;
end;
$function$;
-- =====================================================================================================
-- 8. REWARDS & RECOGNITION -- the match community model (20270522), as the owner's brief now has it
--
--   * the four awards carry the names the brief gives them, for every age;
--   * CLUB DEFAULT -> TEAM OVERRIDE -> the match's effective set (a team row, where one exists, wins);
--   * everything opens at KICK-OFF, not when the cron marks the day Completed;
--   * the staff-chosen awards (Coaches', Opposition, Beast) are GIVEN by the entitled person in one act;
--   * the parents' award stays a poll -- ONE VOTE PER CHILD, whichever guardian casts it, never one per
--     account or device -- opening itself at kick-off and telling the families;
--   * a winner is told, and the player's current recognition is readable by people who can see them.
-- =====================================================================================================

update public.match_award_categories set name_youth = 'Parents'' Player of the Match', name_adult = 'Players'' Player of the Match'
 where category_key = 'FAMILY_OR_SELF_PLAYER';
update public.match_award_categories set name_youth = 'Coaches'' Player of the Match', name_adult = 'Coaches'' Player of the Match'
 where category_key = 'COACHES_PLAYER';
update public.match_award_categories set name_youth = 'Opposition Player of the Match', name_adult = 'Opposition Player of the Match'
 where category_key = 'OPPOSITION_PLAYER';
-- THE BEAST AWARD, BY NAME. It was offered to youth sides as "Work Rate"; the brief names it the Beast
-- Award at every age, for hard work, determination and perseverance.
update public.match_award_categories set name_youth = 'Beast Award', name_adult = 'Beast Award',
       description = 'Hard work, determination and perseverance.'
 where category_key = 'WORK_ETHIC';

-- ---- club defaults ---------------------------------------------------------------------------------
create table if not exists public.club_award_category_settings (
  club_id      uuid not null references public.clubs(id) on delete cascade,
  category_key text not null references public.match_award_categories(category_key),
  enabled      boolean not null default false,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  primary key (club_id, category_key)
);
comment on table public.club_award_category_settings is
  'A club''s default awards for its squads. A team''s own setting (team_award_category_settings) overrides it.';
alter table public.club_award_category_settings enable row level security;
revoke all on public.club_award_category_settings from anon, authenticated;
grant select on public.club_award_category_settings to authenticated;
drop policy if exists club_award_category_settings_session_ok on public.club_award_category_settings;
create policy club_award_category_settings_session_ok on public.club_award_category_settings
  as restrictive for all to authenticated using (internal.session_ok()) with check (internal.session_ok());
drop policy if exists club_award_category_settings_read on public.club_award_category_settings;
create policy club_award_category_settings_read on public.club_award_category_settings
  for select to authenticated using (
    internal.can('club.profile.view', 'club', club_id, null, null)
    or internal.can('club.settings.manage', 'club', club_id, null, null)
    or internal.has_site_capability('site.clubs.view'));

-- THE EFFECTIVE SETTING: the team's own row if it has one, else its club's default, else off.
create or replace function internal.match_award_enabled(p_team_id uuid, p_category_key text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select s.enabled from public.team_award_category_settings s where s.team_id = p_team_id and s.category_key = p_category_key),
    (select c.enabled from public.club_award_category_settings c
       join public.teams t on t.club_id = c.club_id
      where t.id = p_team_id and c.category_key = p_category_key),
    false);
$function$;

create or replace function public.set_club_award_category(p_club_id uuid, p_category_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if not (internal.can('club.settings.manage', 'club', p_club_id, null, null)
          or internal.can('club.profile.edit', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.clubs.profile.manage')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.match_award_categories c where c.category_key = p_category_key and c.active) then
    raise exception 'Unknown award.' using errcode = 'P0002';
  end if;
  insert into public.club_award_category_settings (club_id, category_key, enabled, updated_by, updated_at)
  values (p_club_id, p_category_key, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (club_id, category_key) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
end;
$function$;
revoke all on function public.set_club_award_category(uuid, text, boolean) from public, anon;
grant execute on function public.set_club_award_category(uuid, text, boolean) to authenticated;

-- A team going back to its club's default.
create or replace function public.clear_team_award_category(p_team_id uuid, p_category_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid;
begin
  perform internal.require_live_session();
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('team.news.manage', 'team', v_club, p_team_id, null)
          or internal.can('team.news.manage', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  delete from public.team_award_category_settings where team_id = p_team_id and category_key = p_category_key;
end;
$function$;
revoke all on function public.clear_team_award_category(uuid, text) from public, anon;
grant execute on function public.clear_team_award_category(uuid, text) to authenticated;

-- ---- the award row lives on the team's own fixture row -----------------------------------------------
-- A mirrored pair is one match; an award for a team is kept on the row that team owns, so whichever
-- club's row it is reached from, there is one award, not two.
create or replace function internal.match_row_for_team(p_fixture_id uuid, p_team_id uuid)
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select x.id from public.fixtures x where x.id = any (internal.fixture_pair_ids(p_fixture_id)) and x.owning_team_id = p_team_id limit 1),
    p_fixture_id);
$function$;

alter table public.match_awards alter column opened_by drop not null;
alter table public.match_awards add column if not exists awarded_by uuid references auth.users(id);
comment on column public.match_awards.opened_by is 'Who opened the award; null when it opened itself at kick-off.';
comment on column public.match_awards.awarded_by is 'Who chose the winner of a staff-chosen award (Coaches'', Opposition, Beast).';

-- ---- one vote per child --------------------------------------------------------------------------------
alter table public.match_award_votes add column if not exists voter_player_id uuid references public.players(id) on delete cascade;
comment on column public.match_award_votes.voter_player_id is
  'For the parents'' award, the CHILD whose vote this is. Two guardians of one child share one vote; a guardian with two children in the side has two.';
alter table public.match_award_votes drop constraint if exists match_award_votes_award_id_voter_user_id_key;
create unique index if not exists match_award_votes_one_per_user on public.match_award_votes (award_id, voter_user_id) where voter_player_id is null;
create unique index if not exists match_award_votes_one_per_child on public.match_award_votes (award_id, voter_player_id) where voter_player_id is not null;

-- The children (or, in adult rugby, the player themselves) whose vote this person may cast.
create or replace function internal.match_award_vote_entitlements(p_award_id uuid, p_user uuid)
returns table(player_id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  with a as (
    select aw.team_id, c.electorate from public.match_awards aw
      join public.match_award_categories c on c.category_key = aw.category_key
     where aw.id = p_award_id
  )
  select ptm.player_id
    from a
    join public.player_team_memberships ptm on ptm.team_id = a.team_id and ptm.state = 'ACTIVE'
   where a.electorate = 'FAMILY_OR_SELF'
     and p_user is not null
     and ((internal.match_side_is_adult(a.team_id) and exists (select 1 from public.players p where p.id = ptm.player_id and p.user_id = p_user))
       or (not internal.match_side_is_adult(a.team_id) and exists (
             select 1 from public.guardians g where g.player_id = ptm.player_id and g.guardian_user_id = p_user and g.status = 'active')));
$function$;

-- Existing parents' votes become their child's vote where the voter has exactly one child in the side.
update public.match_award_votes v
   set voter_player_id = e.player_id
  from (select v2.id, min(e2.player_id::text)::uuid as player_id, count(*) as n
          from public.match_award_votes v2
          cross join lateral internal.match_award_vote_entitlements(v2.award_id, v2.voter_user_id) e2
         where v2.voter_player_id is null
         group by v2.id) e
 where v.id = e.id and e.n = 1;

-- ---- who may give a staff-chosen award -----------------------------------------------------------------
create or replace function internal.match_award_can_give(p_fixture_id uuid, p_team_id uuid, p_category_key text, p_user uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_electorate text; v_other uuid; v_row uuid;
begin
  select c.electorate into v_electorate from public.match_award_categories c where c.category_key = p_category_key and c.active;
  if v_electorate is null or p_user is null then return false; end if;
  v_row := internal.match_row_for_team(p_fixture_id, p_team_id);
  if v_electorate = 'TEAM_COACHES' then
    return internal.is_active_team_coach(p_team_id, p_user) or internal.can_administer_match_community(v_row, p_team_id);
  end if;
  if v_electorate = 'OPPOSITION_COACHES' then
    v_other := internal.match_other_side(v_row, p_team_id);
    if v_other is null then return false; end if;
    return internal.is_active_team_coach(v_other, p_user)
        or exists (select 1 from public.fixtures x where x.id = any (internal.fixture_pair_ids(v_row))
                     and ((x.owning_team_id = v_other and internal.can_manage_fixture_side(x.owning_team_id, x.owning_scheduling_group_id))
                       or (x.opponent_team_id = v_other and internal.can_manage_fixture_side(x.opponent_team_id, x.opponent_scheduling_group_id))));
  end if;
  return false;
end;
$function$;

-- The award opening rule, everywhere: the match has kicked off, it was not cancelled, and the team runs
-- the award.
create or replace function internal.match_award_may_open(p_fixture_id uuid, p_team_id uuid, p_category_key text)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_electorate text;
begin
  if not internal.fixture_result_eligible(p_fixture_id) then
    return 'This award opens at kick-off.';
  end if;
  if not internal.match_award_enabled(p_team_id, p_category_key) then
    return 'This team does not run that award.';
  end if;
  select c.electorate into v_electorate from public.match_award_categories c where c.category_key = p_category_key and c.active;
  if v_electorate is null then
    return 'Unknown award.';
  end if;
  if v_electorate = 'OPPOSITION_COACHES' and internal.match_other_side(p_fixture_id, p_team_id) is null then
    return 'The opposition is not on Ovalball, so nobody is entitled to choose this award.';
  end if;
  return null;
end;
$function$;

create or replace function internal.close_match_award_tally(p_award_id uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_top int; v_leaders int; v_winner uuid; v_outcome text; v_status text;
begin
  select a.status into v_status from public.match_awards a where a.id = p_award_id for update;
  if v_status = 'CLOSED' then
    return (select a.outcome from public.match_awards a where a.id = p_award_id);
  end if;
  select max(cnt) into v_top from (
    select count(*) as cnt from public.match_award_votes v where v.award_id = p_award_id group by v.player_id
  ) tally;
  if v_top is null then
    v_outcome := 'NO_VOTES';
  else
    select count(*) into v_leaders from (
      select v.player_id from public.match_award_votes v where v.award_id = p_award_id
       group by v.player_id having count(*) = v_top) leaders;
    if v_leaders > 1 then
      -- A TIE IS AN ANSWER. Breaking it by a rule nobody agreed would invent a winner.
      v_outcome := 'TIE';
    else
      v_outcome := 'WINNER';
      select v.player_id into v_winner from public.match_award_votes v where v.award_id = p_award_id
       group by v.player_id having count(*) = v_top;
    end if;
  end if;
  update public.match_awards
     set status = 'CLOSED', outcome = v_outcome, winner_player_id = v_winner, closed_by = p_actor, closed_at = now()
   where id = p_award_id;
  if v_winner is not null then
    perform internal.notify_match_award_winner(p_award_id);
  end if;
  return v_outcome;
end;
$function$;

-- ---- notifications ----------------------------------------------------------------------------------
create or replace function internal.notify_match_award_winner(p_award_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare r record;
begin
  select a.fixture_id, a.team_id, a.winner_player_id, internal.match_award_display_name(a.category_key, a.team_id) as award_name,
         p.first_name, f.kickoff_date,
         internal.fixture_opponent_name(f.id, a.team_id) as opponent
    into r
    from public.match_awards a
    join public.players p on p.id = a.winner_player_id
    join public.fixtures f on f.id = a.fixture_id
   where a.id = p_award_id;
  if r.winner_player_id is null then return; end if;
  insert into public.notifications (user_id, type, title, body, data)
  select distinct e.user_id, 'match_award_received', r.award_name,
         case when e.relationship = 'self' then 'You are the ' || r.award_name else r.first_name || ' is the ' || r.award_name end
           || coalesce(' against ' || r.opponent, '') || '. Well played.',
         jsonb_build_object('fixture_id', r.fixture_id, 'award_id', p_award_id)
    from internal.player_contact_eligibility(array[r.winner_player_id]) e
   where e.user_id is not null;
end;
$function$;

-- ---- the browser-facing surface ---------------------------------------------------------------------

create or replace function public.open_match_award(p_fixture_id uuid, p_team_id uuid, p_category_key text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_id uuid; v_row uuid; v_refusal text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  v_row := internal.match_row_for_team(p_fixture_id, p_team_id);
  if not internal.can_administer_match_community(v_row, p_team_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  v_refusal := internal.match_award_may_open(v_row, p_team_id, p_category_key);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;

  insert into public.match_awards (fixture_id, team_id, category_key, opened_by)
  values (v_row, p_team_id, p_category_key, v_actor)
  on conflict (fixture_id, team_id, category_key) do nothing
  returning id into v_id;
  -- Opened by hand is still opened: the families who hold the vote are told, once.
  if v_id is not null and exists (select 1 from public.match_award_categories c
                                   where c.category_key = p_category_key and c.electorate = 'FAMILY_OR_SELF') then
    perform internal.notify_match_award_voting_open(v_id);
  end if;
  if v_id is null then
    select a.id into v_id from public.match_awards a
     where a.fixture_id = v_row and a.team_id = p_team_id and a.category_key = p_category_key;
  end if;
  return v_id;
end;
$function$;

-- A STAFF-CHOSEN AWARD IS ONE DECISION: the entitled person picks the player, and that is the result.
create or replace function public.give_match_award(p_fixture_id uuid, p_team_id uuid, p_category_key text, p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_row uuid; v_refusal text; v_id uuid; v_electorate text; v_previous uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select c.electorate into v_electorate from public.match_award_categories c where c.category_key = p_category_key and c.active;
  if v_electorate is null then
    raise exception 'Unknown award.' using errcode = 'P0002';
  end if;
  if v_electorate = 'FAMILY_OR_SELF' then
    raise exception 'That award is chosen by a vote.' using errcode = 'P0001';
  end if;
  v_row := internal.match_row_for_team(p_fixture_id, p_team_id);
  if not internal.match_award_can_give(v_row, p_team_id, p_category_key, v_actor) then
    raise exception 'You are not entitled to choose this award.' using errcode = '42501';
  end if;
  v_refusal := internal.match_award_may_open(v_row, p_team_id, p_category_key);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;
  if not exists (select 1 from internal.match_award_candidates(p_team_id) c where c.player_id = p_player_id) then
    raise exception 'That player did not play for this side.' using errcode = 'P0001';
  end if;

  select a.id, a.winner_player_id into v_id, v_previous from public.match_awards a
   where a.fixture_id = v_row and a.team_id = p_team_id and a.category_key = p_category_key for update;
  if v_id is null then
    insert into public.match_awards (fixture_id, team_id, category_key, status, outcome, winner_player_id, opened_by, awarded_by, closed_by, closed_at)
    values (v_row, p_team_id, p_category_key, 'CLOSED', 'WINNER', p_player_id, v_actor, v_actor, v_actor, now())
    returning id into v_id;
  else
    update public.match_awards
       set status = 'CLOSED', outcome = 'WINNER', winner_player_id = p_player_id,
           awarded_by = v_actor, closed_by = v_actor, closed_at = now()
     where id = v_id;
  end if;
  if v_previous is distinct from p_player_id then
    perform internal.notify_match_award_winner(v_id);
  end if;
  return v_id;
end;
$function$;
revoke all on function public.give_match_award(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.give_match_award(uuid, uuid, text, uuid) to authenticated;

drop function if exists public.cast_match_award_vote(uuid, uuid);
create or replace function public.cast_match_award_vote(p_award_id uuid, p_player_id uuid, p_for_player_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_team uuid; v_fixture uuid; v_status text; v_electorate text; v_for uuid; v_n int;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select a.team_id, a.fixture_id, a.status, c.electorate into v_team, v_fixture, v_status, v_electorate
    from public.match_awards a join public.match_award_categories c on c.category_key = a.category_key
   where a.id = p_award_id;
  if v_team is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Voting has closed.' using errcode = 'P0001';
  end if;
  -- A MATCH THAT STOPPED BEING A PLAYED MATCH STOPS TAKING VOTES.
  if not internal.fixture_result_eligible(v_fixture) then
    raise exception 'This match is not taking votes.' using errcode = 'P0001';
  end if;
  if not internal.match_award_can_vote(p_award_id, v_actor) then
    raise exception 'You are not entitled to choose this award.' using errcode = '42501';
  end if;
  if not exists (select 1 from internal.match_award_candidates(v_team) c where c.player_id = p_player_id) then
    raise exception 'That player did not play for this side.' using errcode = 'P0001';
  end if;

  if v_electorate = 'FAMILY_OR_SELF' then
    -- ONE VOTE PER CHILD. Which child's vote this is: the one named, or the only one this person holds.
    select count(*) into v_n from internal.match_award_vote_entitlements(p_award_id, v_actor);
    if p_for_player_id is not null then
      if not exists (select 1 from internal.match_award_vote_entitlements(p_award_id, v_actor) e where e.player_id = p_for_player_id) then
        raise exception 'You cannot vote for that player''s family.' using errcode = '42501';
      end if;
      v_for := p_for_player_id;
    elsif v_n = 1 then
      select e.player_id into v_for from internal.match_award_vote_entitlements(p_award_id, v_actor) e;
    else
      raise exception 'Choose which child you are voting for.' using errcode = 'P0001';
    end if;

    insert into public.match_award_votes (award_id, voter_user_id, player_id, voter_player_id)
    values (p_award_id, v_actor, p_player_id, v_for)
    on conflict (award_id, voter_player_id) where voter_player_id is not null
    do update set player_id = excluded.player_id, voter_user_id = excluded.voter_user_id, updated_at = now();
  else
    insert into public.match_award_votes (award_id, voter_user_id, player_id)
    values (p_award_id, v_actor, p_player_id)
    on conflict (award_id, voter_user_id) where voter_player_id is null
    do update set player_id = excluded.player_id, updated_at = now();
  end if;
end;
$function$;
revoke all on function public.cast_match_award_vote(uuid, uuid, uuid) from public, anon;
grant execute on function public.cast_match_award_vote(uuid, uuid, uuid) to authenticated;

drop function if exists public.withdraw_match_award_vote(uuid);
create or replace function public.withdraw_match_award_vote(p_award_id uuid, p_for_player_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_status text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select a.status into v_status from public.match_awards a where a.id = p_award_id;
  if v_status is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Voting has closed.' using errcode = 'P0001';
  end if;
  delete from public.match_award_votes v
   where v.award_id = p_award_id
     and ((v.voter_player_id is null and v.voter_user_id = v_actor)
       or (v.voter_player_id is not null
           and v.voter_player_id in (select e.player_id from internal.match_award_vote_entitlements(p_award_id, v_actor) e)
           and (p_for_player_id is null or v.voter_player_id = p_for_player_id)));
end;
$function$;
revoke all on function public.withdraw_match_award_vote(uuid, uuid) from public, anon;
grant execute on function public.withdraw_match_award_vote(uuid, uuid) to authenticated;

create or replace function public.close_match_award(p_award_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_fixture uuid; v_team uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select a.fixture_id, a.team_id into v_fixture, v_team from public.match_awards a where a.id = p_award_id;
  if v_fixture is null then
    raise exception 'Award not found.' using errcode = 'P0002';
  end if;
  if not internal.can_administer_match_community(v_fixture, v_team) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  return internal.close_match_award_tally(p_award_id, v_actor);
end;
$function$;

-- THE PARENTS' VOTE OPENS ITSELF AT KICK-OFF, and closes three days later. Each side's families are
-- told once; the result is told to the winner's family.
-- VOTING IS OPEN -- told to the people who hold the vote, whichever way it opened (the schedule after
-- kick-off, or the side's staff by hand). WHO MAY BE CONTACTED is `internal.player_contact_eligibility`'s
-- answer, never "has a login"; it is only NARROWED here, to a youth side's guardians or an adult side's
-- own players. Returns how many were told.
create or replace function internal.notify_match_award_voting_open(p_award_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare r record; v_n integer := 0;
begin
  select a.id, a.fixture_id, a.team_id, a.category_key, f.kickoff_date,
         internal.fixture_opponent_name(f.id, a.team_id) as opponent
    into r
    from public.match_awards a
    join public.fixtures f on f.id = a.fixture_id
   where a.id = p_award_id and a.status = 'OPEN';
  if r.id is null then return 0; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct u.user_id, 'match_award_voting_open', internal.match_award_display_name(r.category_key, r.team_id) || ' voting is open',
         'Choose who stood out' || coalesce(' against ' || r.opponent, '') || ' on ' || to_char(r.kickoff_date, 'FMDay FMDD FMMonth') || '. Voting closes in three days.',
         jsonb_build_object('fixture_id', r.fixture_id, 'award_id', r.id)
    from internal.player_contact_eligibility(array(
           select ptm.player_id from public.player_team_memberships ptm
            where ptm.team_id = r.team_id and ptm.state = 'ACTIVE')) u
   where u.outcome = 'ELIGIBLE' and u.user_id is not null
     and ((u.relationship = 'guardian' and not internal.match_side_is_adult(r.team_id))
       or (u.relationship = 'self' and internal.match_side_is_adult(r.team_id)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function internal.notify_match_award_voting_open(uuid) from public, anon, authenticated;

create or replace function internal.run_match_award_schedule()
returns integer
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare r record; v_id uuid; v_n integer := 0;
begin
  for r in
    select f.id as fixture_id, f.owning_team_id as team_id, f.kickoff_date
      from public.fixtures f
       where f.cancelled_at is null and f.status <> 'Cancelled'
       and f.owning_team_id is not null
       and f.kickoff_date between current_date - 3 and current_date
       and internal.fixture_result_eligible(f.id)
       and internal.match_award_enabled(f.owning_team_id, 'FAMILY_OR_SELF_PLAYER')
       and not exists (select 1 from public.match_awards a where a.fixture_id = f.id and a.team_id = f.owning_team_id
                         and a.category_key = 'FAMILY_OR_SELF_PLAYER')
  loop
    insert into public.match_awards (fixture_id, team_id, category_key, opened_by)
    values (r.fixture_id, r.team_id, 'FAMILY_OR_SELF_PLAYER', null)
    on conflict (fixture_id, team_id, category_key) do nothing
    returning id into v_id;
    continue when v_id is null;
    v_n := v_n + 1;
    perform internal.notify_match_award_voting_open(v_id);
  end loop;

  for r in
    select a.id from public.match_awards a
      join public.match_award_categories c on c.category_key = a.category_key
     where a.status = 'OPEN' and c.electorate = 'FAMILY_OR_SELF' and a.opened_at < now() - interval '3 days'
  loop
    perform internal.close_match_award_tally(r.id, null);
  end loop;
  return v_n;
end;
$function$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'run-match-award-schedule') then
      perform cron.unschedule('run-match-award-schedule');
    end if;
    perform cron.schedule('run-match-award-schedule', '*/10 * * * *', 'select internal.run_match_award_schedule()');
  end if;
end $$;

-- ---- the Match Centre's Rewards read -------------------------------------------------------------------
-- For each side the viewer may see: the awards the side runs, where each one stands, who won, and what
-- this viewer may do -- vote (per child), give, open or close. Totals stay staff-only, after closing.
create or replace function public.get_match_rewards(p_fixture_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_actor uuid;
  v_out jsonb := '[]';
  t record;
  c record;
  a record;
  v_kicked boolean;
  v_entitled jsonb;
begin
  v_actor := internal.actor();
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id;
  if not found or not internal.fixture_visible_to_caller(p_fixture_id) then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;
  v_kicked := internal.fixture_result_eligible(p_fixture_id);

  for t in
    select x.team_id, x.side from (
      select case when coalesce(f.home_away, 'Home') <> 'Away' then f.owning_team_id else f.opponent_team_id end as team_id, 'home' as side
      union all
      select case when coalesce(f.home_away, 'Home') <> 'Away' then f.opponent_team_id else f.owning_team_id end, 'away') x
     where x.team_id is not null
  loop
    for c in select * from public.match_award_categories mc where mc.active order by mc.sort_order loop
      continue when not internal.match_award_enabled(t.team_id, c.category_key);
      select aw.* into a from public.match_awards aw
       where aw.fixture_id = any (internal.fixture_pair_ids(p_fixture_id)) and aw.team_id = t.team_id and aw.category_key = c.category_key
       limit 1;

      -- Who may see this side's awards: anybody who can see the team, its families, and -- for the
      -- award the opposition chooses -- the opposition's entitled people.
      continue when not (
        exists (select 1 from public.teams tt where tt.id = t.team_id
                  and (internal.can('team.team.view', 'team', tt.club_id, tt.id, null) or internal.has_site_capability('site.clubs.view')))
        or internal.match_can_give_kudos(t.team_id, v_actor)
        or (c.electorate = 'OPPOSITION_COACHES' and internal.match_award_can_give(p_fixture_id, t.team_id, c.category_key, v_actor)));

      select coalesce(jsonb_agg(jsonb_build_object(
               'playerId', e.player_id,
               'firstName', p.first_name,
               'myVotePlayerId', (select v.player_id from public.match_award_votes v where v.award_id = a.id and v.voter_player_id = e.player_id))), '[]')
        into v_entitled
        from internal.match_award_vote_entitlements(a.id, v_actor) e
        join public.players p on p.id = e.player_id
       where a.id is not null and a.status = 'OPEN';

      v_out := v_out || jsonb_build_object(
        'side', t.side,
        'teamId', t.team_id,
        'categoryKey', c.category_key,
        'electorate', c.electorate,
        'name', internal.match_award_display_name(c.category_key, t.team_id),
        'description', c.description,
        'awardId', a.id,
        'state', case when f.cancelled_at is not null or f.status = 'Cancelled' then 'CANCELLED'
                      when a.id is null and not v_kicked then 'OPENS_AT_KICKOFF'
                      when a.id is null then 'NOT_STARTED'
                      when a.status = 'OPEN' then 'OPEN'
                      else 'DECIDED' end,
        'outcome', a.outcome,
        'winner', case when a.winner_player_id is not null then (
                    -- The winner's own side reads the full name; anybody else (the opposition choosing
                    -- their award) the first name and surname initial, as the public team page shows it.
                    select jsonb_build_object('playerId', w.id, 'firstName', w.first_name,
                                              'displayName', case
                                                when exists (select 1 from public.teams tt where tt.id = t.team_id
                                                               and (internal.can('team.team.view', 'team', tt.club_id, tt.id, null)
                                                                    or internal.has_site_capability('site.clubs.view')))
                                                  or internal.match_can_give_kudos(t.team_id, v_actor)
                                                then nullif(btrim(concat_ws(' ', w.first_name, w.surname)), '')
                                                else btrim(concat_ws(' ', w.first_name, nullif(left(coalesce(w.surname, ''), 1), '') || '.')) end)
                      from public.players w where w.id = a.winner_player_id) end,
        'decidedAt', a.closed_at,
        'votingClosesAt', case when a.status = 'OPEN' and c.electorate = 'FAMILY_OR_SELF' then a.opened_at + interval '3 days' end,
        'voteEntitlements', v_entitled,
        'canGive', c.electorate <> 'FAMILY_OR_SELF' and v_kicked and internal.match_award_can_give(p_fixture_id, t.team_id, c.category_key, v_actor),
        'canOpen', a.id is null and c.electorate = 'FAMILY_OR_SELF' and v_kicked
                   and internal.can_administer_match_community(internal.match_row_for_team(p_fixture_id, t.team_id), t.team_id),
        'canClose', a.status = 'OPEN' and internal.can_administer_match_community(a.fixture_id, t.team_id),
        'totalVotes', case when a.status = 'CLOSED' and c.electorate = 'FAMILY_OR_SELF'
                                and internal.can_administer_match_community(a.fixture_id, t.team_id)
                           then (select count(*)::int from public.match_award_votes v where v.award_id = a.id) end);
    end loop;
  end loop;

  return jsonb_build_object('fixtureId', f.id, 'kickedOff', v_kicked, 'awards', v_out);
end;
$function$;
revoke all on function public.get_match_rewards(uuid) from public, anon;
grant execute on function public.get_match_rewards(uuid) to authenticated;

-- The people an entitled person may choose between -- names only. Now also the opposition's managers,
-- who give the Opposition award.
create or replace function public.get_match_recognition_squad(p_fixture_id uuid, p_team_id uuid)
returns table(player_id uuid, display_name text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_actor uuid; v_other uuid; v_own boolean;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  v_other := internal.match_other_side(internal.match_row_for_team(p_fixture_id, p_team_id), p_team_id);
  v_own := internal.match_can_give_kudos(p_team_id, v_actor)
        or internal.can_administer_match_community(internal.match_row_for_team(p_fixture_id, p_team_id), p_team_id);

  if not (v_own or (v_other is not null and internal.match_award_can_give(p_fixture_id, p_team_id, 'OPPOSITION_PLAYER', v_actor))) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  -- THE OTHER SIDE CHOOSING sees as little of this side's squad as it needs to choose: first name and
  -- surname initial, as the public team page shows it. The side's own staff see full names.
  return query
  select p.id,
         case when v_own then nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')
              else btrim(concat_ws(' ', p.first_name, nullif(left(coalesce(p.surname, ''), 1), '') || '.')) end
    from internal.match_award_candidates(p_team_id) c
    join public.players p on p.id = c.player_id
   order by p.surname, p.first_name;
end;
$function$;

-- THE CURRENT RECOGNITION ON A PLAYER: awards won at their side's most recent played match, shown until
-- that side plays again. Only for players the caller may already see.
create or replace function public.get_player_recognition(p_player_ids uuid[])
returns table(player_id uuid, category_key text, award_name text, fixture_id uuid, awarded_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  if p_player_ids is null or cardinality(p_player_ids) = 0 then return; end if;
  if cardinality(p_player_ids) > 300 then
    raise exception 'Too many players requested at once.' using errcode = '22023';
  end if;

  return query
  select a.winner_player_id, a.category_key, internal.match_award_display_name(a.category_key, a.team_id), a.fixture_id, a.closed_at
    from public.match_awards a
    join public.fixtures f on f.id = a.fixture_id
    join public.teams t on t.id = a.team_id
   where a.winner_player_id = any (p_player_ids)
     and a.status = 'CLOSED' and a.outcome = 'WINNER'
     -- STILL CURRENT: the side has not kicked off another match since.
     and not exists (
       select 1 from public.fixtures nf
        where nf.id <> f.id and nf.mirror_fixture_id is distinct from f.id
          and (nf.owning_team_id = a.team_id or nf.opponent_team_id = a.team_id)
          and nf.cancelled_at is null and nf.status <> 'Cancelled'
          and (nf.kickoff_date + coalesce(nf.kickoff_time, time '23:59')) > (f.kickoff_date + coalesce(f.kickoff_time, time '00:00'))
          and internal.fixture_result_eligible(nf.id))
     -- ONLY FOR SOMEBODY WHO MAY SEE THIS PLAYER'S TEAM, OR IS THEIR FAMILY.
     and (internal.can('team.team.view', 'team', t.club_id, t.id, null)
          or internal.has_site_capability('site.clubs.view')
          or internal.match_can_give_kudos(a.team_id, auth.uid())
          or internal.can_player_as_family('player.profile.view', a.winner_player_id))
   order by a.closed_at desc;
end;
$function$;
revoke all on function public.get_player_recognition(uuid[]) from public, anon;
grant execute on function public.get_player_recognition(uuid[]) to authenticated;

-- get_match_community reads the pair, so a side's awards are one set whichever row they are read from.
create or replace function public.get_match_community(p_fixture_id uuid)
returns table(
  award_id uuid, team_id uuid, category_key text, display_name text, electorate text,
  status text, outcome text, winner_player_id uuid, winner_name text,
  can_vote boolean, my_vote_player_id uuid, can_manage boolean, total_votes int
)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  return query
  select a.id,
         a.team_id,
         a.category_key,
         internal.match_award_display_name(a.category_key, a.team_id),
         c.electorate,
         a.status,
         a.outcome,
         a.winner_player_id,
         nullif(btrim(concat_ws(' ', w.first_name, w.surname)), ''),
         (a.status = 'OPEN' and internal.match_award_can_vote(a.id, v_actor)),
         (select v.player_id from public.match_award_votes v
           where v.award_id = a.id and (v.voter_user_id = v_actor
                 or v.voter_player_id in (select e.player_id from internal.match_award_vote_entitlements(a.id, v_actor) e))
           order by v.updated_at desc limit 1),
         internal.can_administer_match_community(a.fixture_id, a.team_id),
         -- TOTALS ARE STAFF-ONLY, AND ONLY ONCE IT IS OVER.
         case when a.status = 'CLOSED' and internal.can_administer_match_community(a.fixture_id, a.team_id)
              then (select count(*)::int from public.match_award_votes v where v.award_id = a.id)
              else null end
    from public.match_awards a
    join public.match_award_categories c on c.category_key = a.category_key
    join public.teams t on t.id = a.team_id
    left join public.players w on w.id = a.winner_player_id
   where a.fixture_id = any (internal.fixture_pair_ids(p_fixture_id))
     and (internal.can('team.team.view', 'team', t.club_id, t.id, null) or internal.has_site_capability('site.clubs.view'))
   order by c.sort_order;
end;
$function$;

-- The match_award_can_vote rule for the parents' award is now "holds a child's vote".
create or replace function internal.match_award_can_vote(p_award_id uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_team uuid; v_fixture uuid; v_electorate text; v_other uuid;
begin
  select a.team_id, a.fixture_id, c.electorate
    into v_team, v_fixture, v_electorate
    from public.match_awards a
    join public.match_award_categories c on c.category_key = a.category_key
   where a.id = p_award_id;

  if v_team is null or p_user is null then
    return false;
  end if;

  if v_electorate = 'FAMILY_OR_SELF' then
    return exists (select 1 from internal.match_award_vote_entitlements(p_award_id, p_user));
  end if;

  if v_electorate = 'TEAM_COACHES' then
    return internal.is_active_team_coach(v_team, p_user);
  end if;

  if v_electorate = 'OPPOSITION_COACHES' then
    v_other := internal.match_other_side(v_fixture, v_team);
    if v_other is null then
      return false;
    end if;
    return internal.is_active_team_coach(v_other, p_user);
  end if;

  return false;
end;
$function$;

-- The admin read uses the effective (club -> team) setting and the team's own row.
create or replace function public.get_match_community_admin(p_fixture_id uuid)
returns table(
  team_id uuid, category_key text, display_name text, electorate text,
  enabled boolean, display_name_override text, award_id uuid, award_status text, available boolean
)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  return query
  select t.id,
         c.category_key,
         internal.match_award_display_name(c.category_key, t.id),
         c.electorate,
         internal.match_award_enabled(t.id, c.category_key),
         s.display_name_override,
         a.id,
         a.status,
         (c.electorate <> 'OPPOSITION_COACHES' or internal.match_other_side(p_fixture_id, t.id) is not null)
    from public.fixtures f
    join public.teams t on t.id in (f.owning_team_id, f.opponent_team_id)
   cross join public.match_award_categories c
    left join public.team_award_category_settings s on s.team_id = t.id and s.category_key = c.category_key
    left join public.match_awards a on a.fixture_id = any (internal.fixture_pair_ids(f.id)) and a.team_id = t.id and a.category_key = c.category_key
   where f.id = p_fixture_id
     and c.active
     and internal.can_administer_match_community(f.id, t.id)
   order by t.id, c.sort_order;
end;
$function$;

revoke all on function internal.match_award_vote_entitlements(uuid, uuid) from public, anon, authenticated;
revoke all on function internal.match_award_can_give(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function internal.close_match_award_tally(uuid, uuid) from public, anon, authenticated;
revoke all on function internal.notify_match_award_winner(uuid) from public, anon, authenticated;
revoke all on function internal.run_match_award_schedule() from public, anon, authenticated;
-- =====================================================================================================
-- 9. PUBLIC CLUB AND TEAM PAGES -- projections of the canonical records, never copies
--
-- Public by default: the overview, the cover photograph and the staff (adults, by name and role).
-- Optional, the club's default and a team's own override: the SQUAD and the MEDIA. Enforced here and
-- in storage, so a hidden squad or gallery cannot be read by calling the endpoint directly.
-- =====================================================================================================

create table if not exists public.club_public_sharing (
  club_id      uuid primary key references public.clubs(id) on delete cascade,
  share_squad  boolean not null default false,
  share_media  boolean not null default false,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now()
);
create table if not exists public.team_public_sharing (
  team_id      uuid primary key references public.teams(id) on delete cascade,
  share_squad  boolean,
  share_media  boolean,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now()
);
comment on table public.club_public_sharing is 'Whether a club''s public pages show squads and media by default.';
comment on table public.team_public_sharing is 'A team''s own choice; null inherits the club''s default.';
alter table public.club_public_sharing enable row level security;
alter table public.team_public_sharing enable row level security;
revoke all on public.club_public_sharing from anon, authenticated;
revoke all on public.team_public_sharing from anon, authenticated;
-- No client policy: read through the public profile functions, written through the setters.

create or replace function internal.team_shares_publicly(p_team_id uuid, p_what text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select case p_what when 'squad' then s.share_squad else s.share_media end from public.team_public_sharing s where s.team_id = p_team_id),
    (select case p_what when 'squad' then c.share_squad else c.share_media end
       from public.club_public_sharing c join public.teams t on t.club_id = c.club_id where t.id = p_team_id),
    false);
$function$;

create or replace function public.set_club_public_sharing(p_club_id uuid, p_share_squad boolean, p_share_media boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if not (internal.can('club.profile.edit', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.clubs.profile.manage')) then
    raise exception 'You are not authorised to change what this club shares.' using errcode = '42501';
  end if;
  insert into public.club_public_sharing (club_id, share_squad, share_media, updated_by, updated_at)
  values (p_club_id, coalesce(p_share_squad, false), coalesce(p_share_media, false), auth.uid(), now())
  on conflict (club_id) do update set share_squad = excluded.share_squad, share_media = excluded.share_media,
                                      updated_by = excluded.updated_by, updated_at = now();
end;
$function$;
revoke all on function public.set_club_public_sharing(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_club_public_sharing(uuid, boolean, boolean) to authenticated;

-- A null leaves that choice to the club's default.
create or replace function public.set_team_public_sharing(p_team_id uuid, p_share_squad boolean, p_share_media boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid;
begin
  perform internal.require_live_session();
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('team.team.manage', 'team', v_club, p_team_id, null)
          or internal.can('club.profile.edit', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to change what this team shares.' using errcode = '42501';
  end if;
  insert into public.team_public_sharing (team_id, share_squad, share_media, updated_by, updated_at)
  values (p_team_id, p_share_squad, p_share_media, auth.uid(), now())
  on conflict (team_id) do update set share_squad = excluded.share_squad, share_media = excluded.share_media,
                                      updated_by = excluded.updated_by, updated_at = now();
end;
$function$;
revoke all on function public.set_team_public_sharing(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_team_public_sharing(uuid, boolean, boolean) to authenticated;

-- A SHARED GALLERY IS READABLE BY ANY SIGNED-IN MEMBER; an unshared one stays the team's.
create or replace function internal.team_gallery_media_is_public(p_name text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.team_media m
     where m.storage_path = p_name and m.state = 'ACTIVE'
       and internal.team_shares_publicly(m.team_id, 'media'));
$function$;

drop policy if exists team_gallery_media_public_select on storage.objects;
create policy team_gallery_media_public_select on storage.objects for select to authenticated
  using (bucket_id = 'team-gallery-media' and internal.team_gallery_media_is_public(name));

create or replace function public.get_public_team_profile(p_team_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  t record;
  v_squad jsonb;
  v_media jsonb;
  v_staff jsonb;
begin
  select tm.id, tm.display_name, tm.description, tm.cover_image_path, tm.cover_stock_key, tm.category, tm.age_group,
         tm.rugby_code, tm.active, tm.archived_at, tm.folded_at, c.id as club_id, c.slug as club_slug, c.status as club_status,
         c.logo_storage_path, cd.id as directory_id, cd.name as club_name, cd.logo_storage_path as directory_logo
    into t
    from public.teams tm
    join public.clubs c on c.id = tm.club_id
    join public.club_directory cd on cd.id = c.directory_id
   where tm.id = p_team_id;
  if t.id is null or not t.active or t.archived_at is not null or t.club_status is distinct from 'active' then
    return null;
  end if;

  -- STAFF: adults in a team role, by name and role -- one row a person, their roles together ("Coach ·
  -- Team Safeguarding Lead"). Never a contact detail.
  with roles as (
    select distinct cm.user_id, ra.role_key
      from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
     where ra.team_id = p_team_id and ra.state = 'ACTIVE'
       and ra.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION', 'TEAM_SAFEGUARDING_LEAD', 'FIRST_AIDER')
  ), labelled as (
    select r.user_id,
           case r.role_key when 'COACH' then 'Coach' when 'TEAM_MANAGER' then 'Team Manager'
                           when 'TEAM_ADMINISTRATION' then 'Team Admin' when 'TEAM_SAFEGUARDING_LEAD' then 'Team Safeguarding Lead'
                           else 'First Aider' end as label,
           case r.role_key when 'COACH' then 1 when 'TEAM_MANAGER' then 2 when 'TEAM_ADMINISTRATION' then 3
                           when 'TEAM_SAFEGUARDING_LEAD' then 4 else 5 end as rank
      from roles r
  ), people as (
    select l.user_id, string_agg(l.label, ' · ' order by l.rank) as roles, min(l.rank) as rank
      from labelled l group by l.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''),
           'role', pe.roles)
         order by pe.rank, pr.first_name), '[]')
    into v_staff
    from people pe
    join public.profiles pr on pr.id = pe.user_id;

  -- SQUAD, only where shared: first name and surname initial. No photograph, age or anything else.
  if internal.team_shares_publicly(p_team_id, 'squad') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'playerId', p.id,
             'name', btrim(concat_ws(' ', p.first_name, nullif(left(coalesce(p.surname, ''), 1), '') || '.')))
           order by p.first_name, p.surname), '[]')
      into v_squad
      from public.player_team_memberships ptm
      join public.players p on p.id = ptm.player_id
     where ptm.team_id = p_team_id and ptm.status = 'active';
  end if;

  if internal.team_shares_publicly(p_team_id, 'media') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'path', m.storage_path, 'caption', m.caption)
                    order by m.created_at desc), '[]')
      into v_media
      from (select * from public.team_media where team_id = p_team_id and state = 'ACTIVE' order by created_at desc limit 60) m;
  end if;

  return jsonb_build_object(
    'teamId', t.id,
    'name', t.display_name,
    'description', t.description,
    'coverImagePath', t.cover_image_path,
    'coverStockKey', t.cover_stock_key,
    'category', t.category,
    'ageGroup', t.age_group,
    'rugbyCode', t.rugby_code,
    'club', jsonb_build_object('clubId', t.club_id, 'directoryId', t.directory_id, 'name', t.club_name, 'slug', t.club_slug,
                               'logoPath', coalesce(t.logo_storage_path, t.directory_logo)),
    'staff', v_staff,
    'squadShared', v_squad is not null,
    'squad', v_squad,
    'mediaShared', v_media is not null,
    'media', v_media,
    -- Whether the reader is inside the team already, so the page can offer the team's own view too.
    'viewerIsMember', coalesce(auth.uid() is not null and (
        internal.can('team.team.view', 'team', t.club_id, t.id, null)
        or exists (select 1 from public.player_team_memberships ptm
                    where ptm.team_id = t.id and ptm.status = 'active'
                      and internal.can_player_as_family('player.profile.view', ptm.player_id))), false));
end;
$function$;
revoke all on function public.get_public_team_profile(uuid) from public;
grant execute on function public.get_public_team_profile(uuid) to anon, authenticated;

-- The club's public sharing settings and its teams' overrides, for the club's own admin screen.
create or replace function public.get_club_public_sharing(p_club_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if not (internal.can('club.profile.edit', 'club', p_club_id, null, null)
          or internal.can('club.profile.view', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.clubs.view')) then
    raise exception 'You are not authorised to see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'shareSquad', coalesce((select s.share_squad from public.club_public_sharing s where s.club_id = p_club_id), false),
    'shareMedia', coalesce((select s.share_media from public.club_public_sharing s where s.club_id = p_club_id), false),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('teamId', t.id, 'name', t.display_name,
                                                          'shareSquad', ts.share_squad, 'shareMedia', ts.share_media) order by t.display_name)
                         from public.teams t left join public.team_public_sharing ts on ts.team_id = t.id
                        where t.club_id = p_club_id and t.active and t.archived_at is null), '[]'));
end;
$function$;
revoke all on function public.get_club_public_sharing(uuid) from public, anon;
grant execute on function public.get_club_public_sharing(uuid) to authenticated;

-- =====================================================================================================
-- 10. THE NOTIFICATIONS THIS ADDS
-- =====================================================================================================
insert into public.notification_types (type_key, topic_key, mandatory_override, event_key) values
  ('fixture_meet_time_changed', 'fixture_updates', null, null),
  ('fixture_arrangements_changed', 'fixture_updates', null, null),
  ('match_award_voting_open', 'fixture_updates', null, null),
  ('match_award_received', 'fixture_updates', null, null)
on conflict (type_key) do update set topic_key = excluded.topic_key;

-- The helpers are the server's own.
revoke all on function internal.fixture_attendance_open_days(uuid) from public, anon, authenticated;
revoke all on function internal.fixture_attendance_opens_on(uuid) from public, anon, authenticated;
revoke all on function internal.fixture_attendance_is_open(uuid) from public, anon, authenticated;
revoke all on function internal.fixture_side_outstanding_players(uuid) from public, anon, authenticated;
revoke all on function internal.send_fixture_attendance_invitations_for(uuid) from public, anon, authenticated;
revoke all on function internal.fixture_visible_to_caller(uuid) from public, anon, authenticated;
revoke all on function internal.fixture_side_team_ids(uuid, text) from public, anon, authenticated;
revoke all on function internal.fixture_side_relationship(uuid, text) from public, anon, authenticated;
revoke all on function internal.fixture_side_answers(uuid, text) from public, anon, authenticated;
revoke all on function internal.fixture_pair_ids(uuid) from public, anon, authenticated;
revoke all on function internal.match_row_for_team(uuid, uuid) from public, anon, authenticated;
revoke all on function internal.match_award_enabled(uuid, text) from public, anon, authenticated;
revoke all on function internal.match_award_may_open(uuid, uuid, text) from public, anon, authenticated;
revoke all on function internal.team_shares_publicly(uuid, text) from public, anon, authenticated;
-- The RLS and storage policies ask these as the reader.
grant execute on function internal.can_view_fixture_attendance_of(uuid, uuid) to authenticated, service_role;
grant execute on function internal.team_gallery_media_is_public(text) to authenticated, service_role;

-- =====================================================================================================
-- 11. "STILL NEEDS YOUR ANSWER" ASKS ONLY WHAT CAN BE ANSWERED
--
-- A family's lists asked about every unanswered match in the next fortnight. With attendance opening
-- six days out (or a club's own number, or earlier when a side opens it), that would chase a family for
-- matches the server would refuse an answer on. This exposes the server's own answer as a computed
-- field on a fixture row the reader may already see, so the lists ask the same question the write does.
-- It reveals nothing new: whether a fixture the caller can read has opened.
-- =====================================================================================================

create or replace function public.attendance_is_open(f public.fixtures)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select internal.fixture_attendance_is_open(f.id);
$function$;
revoke all on function public.attendance_is_open(public.fixtures) from public, anon;
grant execute on function public.attendance_is_open(public.fixtures) to authenticated;
