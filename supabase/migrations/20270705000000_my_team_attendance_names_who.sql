-- TOURNAMENT ATTENDANCE, MY TEAM: WHO, not just how many.
--
-- `get_tournament_participant_centre`'s `attendance` field is deliberately counts-only for every
-- side, including the viewer's own -- that is the right shape for a payload that also reaches other
-- clubs' eyes. But a team's own staff looking at their OWN side needs the roster: who is attending,
-- who is unsure, who has not answered. That is a genuinely different read with a genuinely different
-- authority, so it is its own function rather than a widened field on the shared one.
--
-- THE AUTHORITY IS STAFF-LEVEL, the same shape `canRecordResults` already uses in the shared centre
-- read, and the same shape `get_training_register` uses for a training roster: club- or team-scoped
-- `tournament.tournament.view`. A guardian is NOT granted this merely by being family to one player on
-- the team -- they already have their own narrower view (`centre.myPlayers` / `context.attendance`),
-- and widening this endpoint to "anyone with a child on the roster" would hand them every other
-- player's name on their child's side, which nothing today does for a fixture, training session or
-- club event either.
create or replace function public.get_tournament_participant_roster(p_tournament_id uuid, p_participant_id uuid)
returns table(player_id uuid, first_name text, surname text, status text, responded_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tp public.tournament_participants;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to read this. Sign in again.' using errcode = '42501';
  end if;

  select * into tp from public.tournament_participants
  where id = p_participant_id and tournament_id = p_tournament_id;
  if tp.id is null then
    raise exception 'That side could not be found in this tournament.' using errcode = 'P0002';
  end if;

  if not (
    (tp.club_id is not null and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
    or (tp.team_id is not null and tp.club_id is not null
        and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
  ) then
    raise exception 'You are not authorized to see this side''s attendance by name.' using errcode = '42501';
  end if;

  -- A SIDE WITH NO OVALBALL TEAM BEHIND IT HAS NO ROSTER. Not an error -- the same honest emptiness
  -- the aggregate count already reports as "no squad on Ovalball".
  if tp.team_id is null then
    return;
  end if;

  return query
  select p.id, p.first_name, p.surname, a.status, a.updated_at
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  left join public.player_fixture_attendance a on a.tournament_id = p_tournament_id and a.player_id = p.id
  where ptm.team_id = tp.team_id and ptm.status = 'active'
  order by p.surname, p.first_name;
end;
$function$;

revoke all on function public.get_tournament_participant_roster(uuid, uuid) from public;
grant execute on function public.get_tournament_participant_roster(uuid, uuid) to authenticated;
