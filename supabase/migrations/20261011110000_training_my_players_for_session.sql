-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: resolves exactly which
-- player(s) the CALLER may submit an attendance response for on a given
-- training session (Section 23-24) -- their own actively-guardianed
-- children who are on the session's team, plus their own linked player
-- record if they are that player. Powers the attendance buttons on the
-- canonical card without the client ever guessing a player_id.
create or replace function public.get_my_players_for_training_session(p_training_session_id uuid)
returns table (player_id uuid, first_name text, surname text, relationship text, current_status text)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  return query
  select p.id, p.first_name, p.surname, 'guardian'::text,
    (select a.status from public.player_fixture_attendance a where a.training_session_id = p_training_session_id and a.player_id = p.id)
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  where ptm.status = 'active'
    and (
      (s.team_id is not null and ptm.team_id = s.team_id)
      or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
    )
  union
  select p.id, p.first_name, p.surname, 'self'::text,
    (select a.status from public.player_fixture_attendance a where a.training_session_id = p_training_session_id and a.player_id = p.id)
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id and p.user_id = auth.uid()
  where ptm.status = 'active'
    and (
      (s.team_id is not null and ptm.team_id = s.team_id)
      or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
    );
end;
$function$;

revoke all on function public.get_my_players_for_training_session(uuid) from public, anon;
grant execute on function public.get_my_players_for_training_session(uuid) to authenticated;
