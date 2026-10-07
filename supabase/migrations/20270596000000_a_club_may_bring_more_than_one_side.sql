-- =====================================================================================================
-- A CLUB MAY BRING MORE THAN ONE SIDE TO AN AGE GROUP
-- =====================================================================================================
--
-- THE DEFECT. `tournament_participants` was unique on
-- (tournament_id, club_directory_id, canonical_team_type_id). That reads as "one club, one team per
-- age grade", which is not how a club enters a festival: a club running Under 9 A, B and C brings
-- three sides to the U9 competition.
--
-- The uniqueness looked right because a canonical team type looked like a team. It is not one. A
-- canonical type is (category, age grade, gender, fixed squad) and youth types deliberately carry NO
-- squad -- `canonical_team_types_structure_check` forces `fixed_squad_designation IS NULL` for every
-- youth grade, because a B squad is an arrangement inside a club rather than part of the canonical
-- identity. So a club's A and B sides at one grade SHARE one canonical type by design. Proven on real
-- data: Ovalball UAT RUFC's "Under 8 Mixed" and "Under 8 Mixed B" both carry
-- 783d25fa-c2d7-41b5-b340-9bacd0065e46, and inserting the second one failed with
-- `tournament_participants_tournament_id_club_directory_id_can_key`.
--
-- THE ASYMMETRY THAT MADE IT INVISIBLE. The host club's own sides are entered through
-- `tournament_team_entries`, which is unique on (tournament_id, team_id) and therefore already allowed
-- both of its U8 sides. Only OTHER clubs were capped at one side per grade. The organiser could do for
-- itself exactly what it could not do for anybody else.
--
-- THE FIX. Identify a participating SIDE, not a grade:
--
--   * an Ovalball club's side is its real `team_id` -- the canonical identity of that team;
--   * a club that is not on Ovalball has no team row, so its side is named by `squad_label`
--     ("A", "B", "Development"), typed by the organiser and stored as given.
--
-- DUPLICATE PROTECTION IS KEPT, AND STAYS IN THE DATABASE. The replacement is still a UNIQUE index, so
-- adding the same team twice is refused by Postgres rather than by a disabled button. `canonical_team_type_id`
-- remains NOT NULL and still records which grade the side is entered at.

alter table public.tournament_participants
  add column if not exists squad_label text;

comment on column public.tournament_participants.squad_label is
  'Which side of an EXTERNAL club this is ("A", "B", "Development") -- typed by the organiser because a '
  'club that is not on Ovalball has no team row to point at. Always NULL for an Ovalball club, whose '
  'side is identified by team_id. Never a display name for an Ovalball team: that is derived from the '
  'canonical identity.';

alter table public.tournament_participants
  add constraint tournament_participants_squad_label_shape
  check (squad_label is null or (btrim(squad_label) <> '' and length(squad_label) <= 40));

-- An Ovalball participant is identified by its team; an external one by its label. A row may not carry
-- both, because that would be two answers to "which side is this".
alter table public.tournament_participants
  add constraint tournament_participants_side_is_one_thing
  check (team_id is null or squad_label is null);

alter table public.tournament_participants
  drop constraint if exists tournament_participants_tournament_id_club_directory_id_can_key;

-- ONE SIDE, ONCE. `coalesce` makes the key the team for an Ovalball club and the label for an external
-- one; a club entered at a grade with neither still collapses to a single row, which is the old
-- behaviour and remains correct for "this club is coming, side unspecified".
create unique index if not exists tournament_participants_one_side_idx
  on public.tournament_participants (
    tournament_id,
    club_directory_id,
    canonical_team_type_id,
    coalesce(team_id::text, squad_label, '')
  );

-- =====================================================================================================
-- add_tournament_participant_team LEARNS THE SIDE
-- =====================================================================================================
--
-- Still status 'added' for an Ovalball club and 'external_recorded' for one that is not: adding a club
-- to your own tournament is not a request it has to answer, and nothing here writes an invitation, a
-- notification or a pending state.

create or replace function public.add_tournament_participant_team(
  p_tournament_id uuid,
  p_club_directory_id uuid,
  p_team_id uuid default null,
  p_canonical_team_type_id uuid default null,
  p_squad_label text default null
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
  v_label text;
  v_team_club uuid;
  v_team_type uuid;
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

  v_label := nullif(btrim(coalesce(p_squad_label, '')), '');

  if p_team_id is not null then
    -- A NAMED TEAM MUST BELONG TO THE CLUB IT IS BEING ADDED UNDER, and its grade must be the grade it
    -- is being entered at. Otherwise a caller could file another club's team under a third club, or
    -- enter an U14 side in the U9 competition.
    select c.directory_id, t.canonical_team_type_id into v_team_club, v_team_type
    from public.teams t join public.clubs c on c.id = t.club_id
    where t.id = p_team_id;
    if v_team_club is null then
      raise exception 'That team could not be found.' using errcode = 'P0002';
    end if;
    if v_team_club <> p_club_directory_id then
      raise exception 'That team does not belong to that club.' using errcode = '22023';
    end if;
    if p_canonical_team_type_id is not null and v_team_type is distinct from p_canonical_team_type_id then
      raise exception 'That team is not in that age group.' using errcode = '22023';
    end if;
    -- The team's own canonical identity wins over anything the caller passed.
    p_canonical_team_type_id := coalesce(v_team_type, p_canonical_team_type_id);
    v_label := null;
  end if;

  if p_canonical_team_type_id is null then
    raise exception 'An age group is required to add a team.' using errcode = '22023';
  end if;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label,
    status, invited_by, invited_at
  )
  values (
    p_tournament_id, p_club_directory_id, v_participant_club, p_team_id, p_canonical_team_type_id, v_label,
    case when v_participant_club is null then 'external_recorded' else 'added' end,
    auth.uid(), now()
  )
  on conflict do nothing
  returning id into v_id;

  -- ALREADY THERE IS NOT AN ERROR. Adding a side twice is a person tapping twice, so the existing row
  -- is returned and the caller is idempotent -- while the unique index still makes a SECOND row
  -- impossible.
  if v_id is null then
    select id into v_id
    from public.tournament_participants
    where tournament_id = p_tournament_id
      and club_directory_id = p_club_directory_id
      and canonical_team_type_id = p_canonical_team_type_id
      and coalesce(team_id::text, squad_label, '') = coalesce(p_team_id::text, v_label, '');
  end if;

  return v_id;
end;
$function$;

revoke all on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text) to authenticated;

-- The four-argument form is replaced, not kept beside it: two overloads would let a caller reach the
-- old behaviour without the team/club/grade checks above.
drop function if exists public.add_tournament_participant_team(uuid, uuid, uuid, uuid);

-- =====================================================================================================
-- REMOVING A SIDE
-- =====================================================================================================
--
-- The organiser can take a side out of its own tournament. This removes the PARTICIPANT ROW only --
-- no team, club or directory record is touched, and the side can be added again afterwards.

create or replace function public.remove_tournament_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
begin
  select t.host_club_id into v_club
  from public.tournament_participants p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_participant_id;
  if v_club is null then
    raise exception 'That team is not in this tournament.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_club, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;

  delete from public.tournament_participants where id = p_participant_id;
end;
$function$;

revoke all on function public.remove_tournament_participant(uuid) from public;
grant execute on function public.remove_tournament_participant(uuid) to authenticated;

-- =====================================================================================================
-- THE HOST'S OWN SIDES
-- =====================================================================================================
--
-- `tournament_team_entries` already holds these and is already unique on (tournament_id, team_id), so
-- the host could always enter both of its U8 sides. What was missing was a way to put one in and take
-- it out from the app, so these two exist for symmetry with the participant pair above.

create or replace function public.add_tournament_team_entry(p_tournament_id uuid, p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_team_club uuid;
  v_id uuid;
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

  select club_id into v_team_club from public.teams where id = p_team_id;
  if v_team_club is null then
    raise exception 'That team could not be found.' using errcode = 'P0002';
  end if;
  -- THIS ENTRY POINT IS FOR THE HOST'S OWN SIDES ONLY. Another club's team is a participant, and goes
  -- through `add_tournament_participant_team` so that it is recorded against that club's directory row.
  if v_team_club <> v_club then
    raise exception 'That team belongs to another club. Add it as a participating club instead.' using errcode = '22023';
  end if;

  insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by)
  values (p_tournament_id, p_team_id, v_team_club, auth.uid())
  on conflict (tournament_id, team_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.tournament_team_entries
    where tournament_id = p_tournament_id and team_id = p_team_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.add_tournament_team_entry(uuid, uuid) from public;
grant execute on function public.add_tournament_team_entry(uuid, uuid) to authenticated;

create or replace function public.remove_tournament_team_entry(p_tournament_id uuid, p_team_id uuid)
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

  -- REMOVES THE ENTRY, NEVER THE TEAM. The club's side carries on existing; it is simply not in this
  -- tournament, and can be entered again.
  delete from public.tournament_team_entries
  where tournament_id = p_tournament_id and team_id = p_team_id;
end;
$function$;

revoke all on function public.remove_tournament_team_entry(uuid, uuid) from public;
grant execute on function public.remove_tournament_team_entry(uuid, uuid) to authenticated;
