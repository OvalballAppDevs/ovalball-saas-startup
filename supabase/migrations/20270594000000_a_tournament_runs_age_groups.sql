-- A TOURNAMENT RUNS AGE GROUPS.
--
-- The canonical tournament model already carries the occasion (`tournaments`), our own entered teams
-- (`tournament_team_entries`), the opposition (`tournament_participants`), the games and the pitch
-- reservations. Three things the approved mobile design needs are genuinely absent, and each is added
-- here rather than worked around in the client:
--
--   1. FORMAT. A tournament is run as a league, a knockout, or a group stage followed by a knockout.
--      Nothing in the schema recorded which, so the organiser's own choice had nowhere to live.
--
--   2. AGE GROUPS AS A REAL LAYER. This is the important one. A tournament is the parent; the age
--      groups it runs sit underneath it; the participating teams sit underneath those. A club fielding
--      U11 A, B and C is ONE tournament with three teams in one age group -- never three tournaments.
--      That relationship could not be expressed at all: `tournament_team_entries` is a flat
--      (tournament, team) pair, so the only way to know which age groups a tournament ran was to infer
--      it from whichever teams happened to be entered. That inference is wrong in the case that
--      matters -- an organiser who has selected U9, U10 and U11 but not yet added anyone to U10 has a
--      real, empty U10 age group, and deriving it from teams would silently lose it.
--
--      `tournament_age_groups` therefore records the organiser's DECISION. Which teams then belong to
--      which age group stays derived from the team's own age grade (`teams.age_group`), because that
--      is already canonical and duplicating it here would create a second truth about what a U9 team is.
--
--   3. A TRUTHFUL "ADDED" STATUS. `tournament_participants.status` allowed only
--      pending/accepted/declined/external_recorded. Those describe an INVITATION -- somebody was asked
--      and answered. An Ovalball club that an organiser adds to their own tournament has not been asked
--      anything: there is no request, no email, and nothing for them to accept. Recording that as
--      'accepted' would be a lie about an event that never happened, and 'pending' would be worse --
--      it would imply the club owes a response and invite a reminder that should never be sent. So
--      'added' joins the vocabulary, and the invitation states remain reserved for real invitations
--      raised through `invite_tournament_participant`.

-- =====================================================================================================
-- 1. FORMAT
-- =====================================================================================================

alter table public.tournaments
  add column if not exists format text not null default 'league';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_format_check') then
    alter table public.tournaments
      add constraint tournaments_format_check check (format in ('league', 'knockout', 'hybrid'));
  end if;
end $$;

comment on column public.tournaments.format is
  'How the tournament is run: league (all teams in a group format), knockout (single elimination), or hybrid (group stage then knockout). Scheduling is a later phase; this records the organiser''s decision.';

-- =====================================================================================================
-- 2. AGE GROUPS
-- =====================================================================================================

create table if not exists public.tournament_age_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- The same vocabulary `teams.age_group` uses (U7…U18). Deliberately text rather than a foreign key
  -- to a catalogue row: an age grade is a grade, not a team identity, and the canonical team-type
  -- catalogue is per rugby code while a tournament's age group is not.
  age_group text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tournament_id, age_group)
);

create index if not exists tournament_age_groups_tournament_id_idx on public.tournament_age_groups(tournament_id);

alter table public.tournament_age_groups enable row level security;

-- Visible to anyone who can already see the tournament itself -- the age groups are part of what the
-- tournament IS, so they must never be readable to someone the tournament is not.
drop policy if exists tournament_age_groups_select_scoped on public.tournament_age_groups;
create policy tournament_age_groups_select_scoped on public.tournament_age_groups
  for select to authenticated
  using (exists (select 1 from public.tournaments t where t.id = tournament_id));

-- No INSERT/UPDATE/DELETE policy: every write goes through the definer functions below, which check
-- the organiser's authority. A bare table write could not.

-- =====================================================================================================
-- 3. A TRUTHFUL PARTICIPANT STATUS
-- =====================================================================================================

alter table public.tournament_participants drop constraint if exists tournament_participants_status_check;
alter table public.tournament_participants
  add constraint tournament_participants_status_check
  check (status in ('added', 'pending', 'accepted', 'declined', 'external_recorded'));

comment on column public.tournament_participants.status is
  'added = an Ovalball club the organiser put into their own tournament; nothing was asked and nothing is owed. pending/accepted/declined = a real invitation raised by invite_tournament_participant. external_recorded = a club that is not on Ovalball, recorded from the Club Directory.';

-- =====================================================================================================
-- 4. OPERATIONS
-- =====================================================================================================

/** The organiser's age-group decision, set as a whole. Passing the complete list makes the operation
 * idempotent and lets the mobile draft send exactly what the person selected, rather than the client
 * having to work out a diff and risk drifting from what is on screen. Removing an age group removes
 * only the grouping; the entered teams themselves are left alone, because a team that was taking part
 * is a fact about the tournament and deleting it silently would destroy real work. */
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

  delete from public.tournament_age_groups
  where tournament_id = p_tournament_id
    and age_group <> all (coalesce(p_age_groups, '{}'::text[]));

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select p_tournament_id, ag, auth.uid()
  from unnest(coalesce(p_age_groups, '{}'::text[])) as ag
  on conflict (tournament_id, age_group) do nothing;
end;
$function$;

revoke all on function public.set_tournament_age_groups(uuid, text[]) from public;
grant execute on function public.set_tournament_age_groups(uuid, text[]) to authenticated;

/** Adds an Ovalball club's team to a tournament as a DIRECT participant -- status 'added'. No
 * invitation row, no notification, nothing for the other club to answer. `invite_tournament_participant`
 * remains the separate, deliberate path for a real request. */
create or replace function public.add_tournament_participant_team(
  p_tournament_id uuid,
  p_club_directory_id uuid,
  p_team_id uuid default null,
  p_canonical_team_type_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_id uuid;
  v_participant_club uuid;
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

  -- A directory row may or may not be a club that is actually on Ovalball. That difference is what
  -- decides the status, and it is read from the directory rather than trusted from the caller.
  select c.id into v_participant_club
  from public.club_directory d
  left join public.clubs c on c.directory_id = d.id
  where d.id = p_club_directory_id;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, status, invited_by, invited_at
  )
  values (
    p_tournament_id, p_club_directory_id, v_participant_club, p_team_id, p_canonical_team_type_id,
    case when v_participant_club is null then 'external_recorded' else 'added' end,
    auth.uid(), now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid) from public;
grant execute on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid) to authenticated;

-- =====================================================================================================
-- 5. save_tournament LEARNS THE TWO NEW FACTS
-- =====================================================================================================

drop function if exists public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text);

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
  p_kickoff_time time without time zone default null
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

  if p_tournament_id is null then
    insert into public.tournaments (
      host_club_id, name, event_date, ends_on, rugby_code, season_id, host_directory_id,
      venue_id, venue_notes, notes, format, kickoff_time, created_by, updated_by
    ) values (
      p_club_id, btrim(p_name), p_starts_on, p_ends_on, p_rugby_code, p_season_id, p_host_directory_id,
      p_venue_id, p_venue_notes, p_notes, coalesce(p_format, 'league'), p_kickoff_time, auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    update public.tournaments
    set name = btrim(p_name),
        event_date = p_starts_on,
        ends_on = p_ends_on,
        rugby_code = p_rugby_code,
        season_id = coalesce(p_season_id, season_id),
        host_directory_id = coalesce(p_host_directory_id, host_directory_id),
        venue_id = p_venue_id,
        venue_notes = p_venue_notes,
        notes = p_notes,
        -- A null means "not supplied by this caller", never "clear it".
        format = coalesce(p_format, format),
        kickoff_time = coalesce(p_kickoff_time, kickoff_time),
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

revoke all on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone) from public;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone) to authenticated;
