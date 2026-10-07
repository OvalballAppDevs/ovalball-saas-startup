-- A TOURNAMENT IS PUBLIC OR INVITE ONLY -- and the grant that was missing.
--
-- PART 0 IS A DEFECT FIX. `20270594000000` created `tournament_age_groups` with row-level security and
-- a SELECT policy, but never granted SELECT on the table to `authenticated`. A policy decides WHICH
-- rows a role may read; the grant decides whether the role may read the table at all. Without it
-- PostgREST refused the whole embedded read, and Tournaments Home showed "You do not have access to
-- that" for a Club Admin who was in fact entitled to every row it asked for. RLS was working
-- correctly throughout -- the table was simply unreadable.
--
-- PART 1 ADDS VISIBILITY. A tournament is either open to the network or it is the organiser's own
-- invitation list, and nothing in the schema could say which. It is NOT inferred from `status`, which
-- means something else entirely (confirmed/cancelled).
--
-- PART 2 ADDS APPLICATIONS, AND KEEPS THEM SEPARATE FROM BEING ADDED. These are two different events
-- and collapsing them would destroy the distinction that matters:
--
--   the organiser ADDS a club          -> tournament_participants.status = 'added'
--                                         nothing was asked, nothing is owed, no reminder is sensible
--   a club APPLIES to a public one     -> tournament_applications.status = 'pending'
--                                         a real request, which the organiser accepts or rejects
--
-- An accepted application becomes an ordinary participant. The application row survives as the record
-- of how that team got in, which is why this is a table and not another value on the participant.

-- =====================================================================================================
-- 0. THE MISSING GRANT
-- =====================================================================================================

grant select on public.tournament_age_groups to authenticated;

-- =====================================================================================================
-- 1. VISIBILITY
-- =====================================================================================================

alter table public.tournaments
  add column if not exists visibility text not null default 'private';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_visibility_check') then
    alter table public.tournaments
      add constraint tournaments_visibility_check check (visibility in ('public', 'private'));
  end if;
end $$;

comment on column public.tournaments.visibility is
  'public = discoverable by any signed-in club, which may apply to enter. private = invite only; the organiser decides who takes part and it must never surface in public discovery. Defaults to private: a tournament is never made discoverable by omission.';

-- =====================================================================================================
-- 2. APPLICATIONS
-- =====================================================================================================

create table if not exists public.tournament_applications (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- The applying club, as a real Ovalball club: only a club with an account can apply, because
  -- applying requires somebody signed in to do it.
  club_id uuid not null references public.clubs(id),
  age_group text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  applied_by uuid references auth.users(id),
  applied_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One live application per club per age group. A club that was rejected may apply again only once
  -- the old row is resolved, which is what the organiser would expect.
  unique (tournament_id, club_id, age_group)
);

create index if not exists tournament_applications_tournament_id_idx on public.tournament_applications(tournament_id);
create index if not exists tournament_applications_club_id_idx on public.tournament_applications(club_id);

/** Which teams the applying club is putting forward. A club with U11 A, B and C applies once for U11
 * and names the sides it intends to bring -- the same shape the organiser uses when adding a club
 * directly, so accepting an application produces exactly the participants it promised. */
create table if not exists public.tournament_application_teams (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.tournament_applications(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  created_at timestamptz not null default now(),
  unique (application_id, team_id)
);

create index if not exists tournament_application_teams_application_id_idx on public.tournament_application_teams(application_id);

alter table public.tournament_applications enable row level security;
alter table public.tournament_application_teams enable row level security;

grant select on public.tournament_applications to authenticated;
grant select on public.tournament_application_teams to authenticated;

-- The organiser sees every application to their own tournament; the applying club sees its own. Nobody
-- else sees either, so one club's interest in a tournament is not public information.
drop policy if exists tournament_applications_select_scoped on public.tournament_applications;
create policy tournament_applications_select_scoped on public.tournament_applications
  for select to authenticated
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id
        and internal.can('tournament.tournament.manage', 'club', t.host_club_id, null, null)
    )
    or internal.can('tournament.tournament.view', 'club', club_id, null, null)
  );

drop policy if exists tournament_application_teams_select_scoped on public.tournament_application_teams;
create policy tournament_application_teams_select_scoped on public.tournament_application_teams
  for select to authenticated
  using (exists (select 1 from public.tournament_applications a where a.id = application_id));

-- No write policies: every mutation goes through the definer functions below, each of which checks a
-- different authority -- the applicant's to apply, the organiser's to decide.

-- =====================================================================================================
-- 3. PUBLIC DISCOVERY -- WIDENED DELIBERATELY, AND ONLY FOR PUBLIC TOURNAMENTS
-- =====================================================================================================

/** A public tournament is readable by any signed-in person, which is what "discoverable" means. A
 * private one is completely unaffected: it keeps exactly the visibility rule it had before, so this
 * cannot expose an invite-only tournament to anybody. */
create or replace function internal.tournament_visible_row(p_tournament_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    -- PUBLIC DISCOVERY. Deliberately first and deliberately narrow: the tournament must itself be
    -- marked public, and the reader must be signed in.
    exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id and t.visibility = 'public' and auth.uid() is not null
    )

    or internal.has_site_capability('site.fixtures.view')

    -- The host, including a still-unclaimed proposal: the club being proposed to must see it in
    -- order to claim it.
    or exists (
      select 1 from public.tournaments t
      join public.clubs c on c.directory_id = t.host_directory_id
      where t.id = p_tournament_id and internal.can('tournament.tournament.manage', 'club', c.id, null, null)
    )

    -- The host club by its own id. The branch above only ever matched through the directory, so a
    -- tournament created with `host_club_id` and no directory row was invisible to the club that owns
    -- it -- found while tracing why Tournaments Home was empty.
    or exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id
        and t.host_club_id is not null
        and internal.can('tournament.tournament.manage', 'club', t.host_club_id, null, null)
    )

    -- An invited club's own management.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and ((tp.team_id is not null and internal.can('calendar.event.manage', 'team', tp.club_id, tp.team_id, null))
             or (tp.club_id is not null and internal.can('tournament.tournament.manage', 'club', tp.club_id, null, null)))
    )

    -- Anybody with an active role at a club that entered a team. Where the club is going on Saturday
    -- is ordinary club operational information.
    or exists (
      select 1
      from public.tournament_team_entries e
      join public.club_memberships cm on cm.club_id = e.club_id
      where e.tournament_id = p_tournament_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- The people it is actually for: a player in an entered team, or the adult responsible for one.
    -- Guardians routinely hold no club_memberships row, so without this a parent loses their own
    -- child's tournament.
    or exists (
      select 1
      from public.tournament_team_entries e
      join public.player_team_memberships ptm on ptm.team_id = e.team_id
      where e.tournament_id = p_tournament_id
        and ptm.status = 'active'
        and (internal.is_own_linked_player(ptm.player_id)
             or internal.is_active_player_guardian(ptm.player_id))
    );
$function$;

-- =====================================================================================================
-- 4. OPERATIONS
-- =====================================================================================================

/** A club applies to a PUBLIC tournament. Refuses on a private one -- an invite-only tournament is the
 * organiser's list and an application to it would be meaningless. */
create or replace function public.apply_to_tournament(
  p_tournament_id uuid,
  p_club_id uuid,
  p_age_group text,
  p_team_ids uuid[] default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visibility text;
  v_id uuid;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to enter this club into a tournament.' using errcode = '42501';
  end if;

  select visibility into v_visibility from public.tournaments where id = p_tournament_id;
  if v_visibility is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if v_visibility <> 'public' then
    raise exception 'This tournament is invite only.' using errcode = '42501';
  end if;

  insert into public.tournament_applications (tournament_id, club_id, age_group, applied_by, note)
  values (p_tournament_id, p_club_id, p_age_group, auth.uid(), p_note)
  on conflict (tournament_id, club_id, age_group)
    do update set status = 'pending', applied_by = auth.uid(), applied_at = now(), decided_by = null, decided_at = null, note = excluded.note, updated_at = now()
  returning id into v_id;

  delete from public.tournament_application_teams where application_id = v_id;
  insert into public.tournament_application_teams (application_id, team_id)
  select v_id, tid from unnest(coalesce(p_team_ids, '{}'::uuid[])) as tid
  on conflict do nothing;

  return v_id;
end;
$function$;

revoke all on function public.apply_to_tournament(uuid, uuid, text, uuid[], text) from public;
grant execute on function public.apply_to_tournament(uuid, uuid, text, uuid[], text) to authenticated;

/** The organiser accepts or rejects. Accepting turns the application into real participants -- one per
 * team the club named -- so the promise made in the application is exactly what lands. */
create or replace function public.decide_tournament_application(
  p_application_id uuid,
  p_accept boolean
)
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
begin
  select a.tournament_id, t.host_club_id, a.club_id into v_tournament, v_host, v_club
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
    -- One participant per team the club put forward; status 'added' because by this point the
    -- organiser HAS agreed -- the request is answered and the row is an ordinary participant.
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, status, invited_by, invited_at)
    select v_tournament, v_directory, v_club, at.team_id, 'added', auth.uid(), now()
    from public.tournament_application_teams at
    where at.application_id = p_application_id;
  end if;
end;
$function$;

revoke all on function public.decide_tournament_application(uuid, boolean) from public;
grant execute on function public.decide_tournament_application(uuid, boolean) to authenticated;
