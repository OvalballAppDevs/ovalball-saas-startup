-- Client-facing preview of internal.resolve_player_movement_eligibility()
-- so the Team Admin UI can show "Additional approval required" (and
-- why) the moment a player is picked, before the request is even
-- submitted -- Section 5/14: Ovalball calculates this from real DOB
-- and team identity, never a manual checkbox asking the coach to
-- self-report a fact the system already knows.
create or replace function public.preview_player_movement_eligibility(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid)
returns table(requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_club uuid;
  v_rugby_code text;
  v_dob date;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_fixture_callups', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_fixture_callups', 'club', v_target_club)) then
    raise exception 'Not authorized to preview eligibility for this team.' using errcode = '42501';
  end if;

  select rugby_code into v_rugby_code from public.teams where id = p_source_team_id;
  select date_of_birth into v_dob from public.players where id = p_player_id;
  return query select * from internal.resolve_player_movement_eligibility(v_rugby_code, current_date, v_dob, p_source_team_id, p_target_team_id);
end;
$$;
