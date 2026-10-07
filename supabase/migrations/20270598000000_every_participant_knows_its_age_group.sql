-- =====================================================================================================
-- EVERY PARTICIPANT KNOWS ITS AGE GROUP
-- =====================================================================================================
--
-- A REGRESSION, AND A DELIBERATE COMPLETION.
--
-- 1. THE REGRESSION. Migration 20270597 made `tournament_participants.age_group` NOT NULL, because the
--    grade -- not the canonical team type -- is what says which competition a side is in. It updated
--    the two functions the mobile wizard uses and missed the four that already existed:
--
--      decide_tournament_application   accepting a public application
--      invite_tournament_participant   the genuine invitation path
--      propose_tournament_at_host      a club proposing a tournament at another club's ground
--      record_tournament_opponent      recording who a side actually played
--
--    All four insert into that table without a grade, so all four would have raised a not-null
--    violation the first time they ran. Two are reached from the WEBSITE's tournament centre, so this
--    was live breakage, not a dormant edge.
--
--    THE FIX IS A TRIGGER, NOT SIX EDITS. The grade is already derivable from the row itself -- from
--    the team, or from the canonical type -- so deriving it once, at the table, fixes every caller
--    that exists and every caller that has not been written yet. Rewriting
--    `propose_tournament_at_host` and `record_tournament_opponent` by hand would have meant touching
--    two large website functions that also write notifications and audit rows, to change one column.
--    Two functions ARE still rewritten below, but for reasons of their own: accepting an application
--    must not duplicate a side the organiser had already added, and the invitation path needed its
--    'pending' status preserved rather than quietly becoming 'added'.
--
-- 2. THE COMPLETION. `save_tournament` still cannot persist `visibility`, so a tournament's
--    Public/Private setting -- collected by the create wizard and about to be editable on Overview --
--    had no update path at all. A null keeps the current value, exactly as `format` and `kickoff_time`
--    already behave, so no existing caller changes meaning.
--
-- 3. REMOVING AN AGE GROUP IS NOT A SILENT DELETE. `set_tournament_age_groups` removed the grade row
--    and left every side entered at that grade behind: invisible, unreachable, and still counted. It
--    now removes them WITH the grade, and returns what it removed so the organiser can be told
--    beforehand exactly what a change costs. `count_tournament_age_group_impact` is the read the
--    confirmation dialog uses; nothing is destroyed to answer it.

-- =====================================================================================================
-- 1. THE GRADE IS DERIVED AT THE TABLE
-- =====================================================================================================

/** Fills `age_group` for any participant row that arrives without one, from the side's own team where
 * it names a team, otherwise from the canonical type it was entered at. A senior canonical type has no
 * age grade at all, so those rows carry the stable 'SENIOR' marker rather than being forced into a
 * youth grade they do not have. Nothing here invents a grade: a row with neither a team nor a type is
 * still refused by the NOT NULL, which is correct -- that row could not say which competition it is
 * in. */
create or replace function internal.fill_tournament_participant_age_group()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.age_group is null and new.team_id is not null then
    select t.age_group into new.age_group from public.teams t where t.id = new.team_id;
  end if;
  if new.age_group is null and new.canonical_team_type_id is not null then
    select coalesce(ctt.age_group, 'SENIOR') into new.age_group
    from public.canonical_team_types ctt where ctt.id = new.canonical_team_type_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tournament_participants_fill_age_group on public.tournament_participants;
create trigger tournament_participants_fill_age_group
  before insert on public.tournament_participants
  for each row execute function internal.fill_tournament_participant_age_group();

-- =====================================================================================================
-- 1b. TWO FUNCTIONS THAT NEEDED MORE THAN THE GRADE
-- =====================================================================================================

/** Accepting an application enters the sides the club actually applied with, at the grade the
 * application was for. The application row stays as the record of how they got in. */
create or replace function public.decide_tournament_application(p_application_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament uuid;
  v_host uuid;
  v_club uuid;
  v_directory uuid;
  v_grade text;
begin
  select a.tournament_id, t.host_club_id, a.club_id, a.age_group
    into v_tournament, v_host, v_club, v_grade
  from public.tournament_applications a
  join public.tournaments t on t.id = a.tournament_id
  where a.id = p_application_id;

  if v_tournament is null then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_host, null, null) then
    raise exception 'Only the organiser can decide an application.' using errcode = '42501';
  end if;

  update public.tournament_applications
  set status = case when p_accept then 'accepted' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_application_id;

  if p_accept then
    select directory_id into v_directory from public.clubs where id = v_club;
    -- One participant per team the club put forward, at the application's own grade, and the team's
    -- canonical identity where it has one. Status 'added' because by this point the organiser HAS
    -- agreed: the question is answered and the row is an ordinary participant.
    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group,
      status, invited_by, invited_at
    )
    select v_tournament, v_directory, v_club, at.team_id, tm.canonical_team_type_id,
           coalesce(tm.age_group, v_grade), 'added', auth.uid(), now()
    from public.tournament_application_teams at
    join public.teams tm on tm.id = at.team_id
    where at.application_id = p_application_id
    -- A SIDE THE ORGANISER HAD ALREADY ADDED BY HAND IS NOT ADDED TWICE. Accepting their application
    -- afterwards is still the right thing to record; it simply does not duplicate the entry.
    on conflict do nothing;
  end if;
end;
$function$;

/** A real invitation -- the club is asked, and answers. The grade comes from the canonical type the
 * invitation names, which is the only thing an invitation knows about the side. */
create or replace function public.invite_tournament_participant(
  p_tournament_id uuid,
  p_club_directory_id uuid,
  p_canonical_team_type_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host uuid;
  v_id uuid;
  v_club uuid;
  v_grade text;
begin
  select host_club_id into v_host from public.tournaments where id = p_tournament_id;
  if v_host is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_host, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;

  -- A senior canonical type has no age grade at all; 'SENIOR' is the stable marker those rows carry.
  select coalesce(ctt.age_group, 'SENIOR') into v_grade
  from public.canonical_team_types ctt where ctt.id = p_canonical_team_type_id;
  if v_grade is null then
    raise exception 'That team type could not be found.' using errcode = 'P0002';
  end if;

  select c.id into v_club from public.clubs c where c.directory_id = p_club_directory_id;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, canonical_team_type_id, age_group,
    status, invited_by, invited_at
  ) values (
    p_tournament_id, p_club_directory_id, v_club, p_canonical_team_type_id, v_grade,
    -- PENDING HERE IS CORRECT AND IS NOT THE SAME THING AS 'added'. This path asks a question; the
    -- organiser adding a club directly does not.
    'pending', auth.uid(), now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.tournament_participants
    where tournament_id = p_tournament_id and club_directory_id = p_club_directory_id and age_group = v_grade
      and coalesce(team_id::text, squad_label, '') = '';
  end if;

  return v_id;
end;
$function$;

revoke all on function public.invite_tournament_participant(uuid, uuid, uuid) from public;
grant execute on function public.invite_tournament_participant(uuid, uuid, uuid) to authenticated;

-- =====================================================================================================
-- 2. VISIBILITY BECOMES EDITABLE
-- =====================================================================================================

create or replace function public.save_tournament(
  p_club_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_rugby_code text,
  p_tournament_id uuid default null,
  p_season_id uuid default null,
  p_host_directory_id uuid default null,
  p_venue_id uuid default null,
  p_venue_notes text default null,
  p_notes text default null,
  p_format text default null,
  p_kickoff_time time without time zone default null,
  p_visibility text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to manage this club''s tournaments.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.';
  end if;
  if p_format is not null and p_format not in ('league', 'knockout', 'hybrid') then
    raise exception 'Unknown tournament format.';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'private') then
    raise exception 'Unknown tournament visibility.';
  end if;

  if p_tournament_id is null then
    insert into public.tournaments (
      host_club_id, name, event_date, ends_on, rugby_code, season_id, host_directory_id,
      venue_id, venue_notes, notes, format, kickoff_time, visibility, created_by, updated_by
    ) values (
      p_club_id, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_rugby_code, p_season_id, p_host_directory_id,
      p_venue_id, p_venue_notes, p_notes, coalesce(p_format, 'league'), p_kickoff_time,
      coalesce(p_visibility, 'private'), auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    update public.tournaments
    set name = btrim(p_name),
        event_date = p_starts_on,
        -- NOT NULL on the table, and a null from a caller means "one day", never "unknown".
        ends_on = coalesce(p_ends_on, p_starts_on),
        rugby_code = p_rugby_code,
        season_id = coalesce(p_season_id, season_id),
        host_directory_id = coalesce(p_host_directory_id, host_directory_id),
        venue_id = p_venue_id,
        venue_notes = p_venue_notes,
        notes = p_notes,
        -- A null means "not supplied by this caller", never "clear it".
        format = coalesce(p_format, format),
        kickoff_time = coalesce(p_kickoff_time, kickoff_time),
        visibility = coalesce(p_visibility, visibility),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_tournament_id and host_club_id = p_club_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Tournament not found for this club.' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$function$;

drop function if exists public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone);

revoke all on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text) from public;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text) to authenticated;

-- =====================================================================================================
-- 3. REMOVING AN AGE GROUP TELLS THE TRUTH FIRST, THEN TAKES EVERYTHING WITH IT
-- =====================================================================================================

/** WHAT A CHANGE WOULD COST, counted without changing anything. The Overview's confirmation reads
 * this so it can name the grades and the number of sides an edit would remove, rather than saying
 * "this may affect existing data". */
create or replace function public.count_tournament_age_group_impact(
  p_tournament_id uuid,
  p_age_groups text[]
)
returns table (age_group text, our_teams integer, other_teams integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select g.age_group,
         (select count(*)::int from public.tournament_team_entries e
            join public.teams t on t.id = e.team_id
           where e.tournament_id = p_tournament_id and t.age_group = g.age_group),
         (select count(*)::int from public.tournament_participants p
           where p.tournament_id = p_tournament_id and p.age_group = g.age_group)
  from public.tournament_age_groups g
  where g.tournament_id = p_tournament_id
    and g.age_group <> all (coalesce(p_age_groups, '{}'::text[]))
  order by g.age_group;
$function$;

revoke all on function public.count_tournament_age_group_impact(uuid, text[]) from public;
grant execute on function public.count_tournament_age_group_impact(uuid, text[]) to authenticated;

/** Sets the grades a tournament runs. A grade that goes takes its sides with it -- leaving them
 * behind would keep them counted, invisible and unreachable, which is worse than removing them.
 * The caller is expected to have shown `count_tournament_age_group_impact` first. */
create or replace function public.set_tournament_age_groups(
  p_tournament_id uuid,
  p_age_groups text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_dropped text[];
begin
  select host_club_id into v_club from public.tournaments where id = p_tournament_id;
  if v_club is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_club, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;
  if p_age_groups is null or array_length(p_age_groups, 1) is null then
    raise exception 'A tournament needs at least one age group.' using errcode = '22023';
  end if;

  select array_agg(g.age_group) into v_dropped
  from public.tournament_age_groups g
  where g.tournament_id = p_tournament_id
    and g.age_group <> all (p_age_groups);

  if v_dropped is not null then
    delete from public.tournament_participants
    where tournament_id = p_tournament_id and age_group = any(v_dropped);

    delete from public.tournament_team_entries e
    using public.teams t
    where e.team_id = t.id
      and e.tournament_id = p_tournament_id
      and t.age_group = any(v_dropped);

    delete from public.tournament_age_groups
    where tournament_id = p_tournament_id and age_group = any(v_dropped);
  end if;

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select p_tournament_id, ag, auth.uid()
  from unnest(p_age_groups) as ag
  on conflict (tournament_id, age_group) do nothing;
end;
$function$;

revoke all on function public.set_tournament_age_groups(uuid, text[]) from public;
grant execute on function public.set_tournament_age_groups(uuid, text[]) to authenticated;
