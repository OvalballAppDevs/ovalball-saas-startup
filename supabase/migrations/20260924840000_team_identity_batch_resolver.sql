-- Batch wrapper for get_team_identity_for_season(), so a page
-- rendering a list of fixtures (Calendar, Agenda, Pitch Allocation,
-- Season Handover history) can resolve every (team_id, season_id) pair
-- it needs in ONE round trip instead of one RPC call per row -- the
-- same batch-loader shape already established for
-- loadGroupMemberTeamIds() (lib/mini-rugby/effective-teams.server.ts).
create or replace function public.get_team_identities_for_season_batch(p_pairs jsonb)
returns table(team_id uuid, season_id uuid, category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql
stable
as $$
declare
  v_team_id uuid;
  v_season_id uuid;
  elem jsonb;
begin
  for elem in select * from jsonb_array_elements(p_pairs) loop
    v_team_id := (elem->>'team_id')::uuid;
    v_season_id := (elem->>'season_id')::uuid;
    return query
      select v_team_id, v_season_id, i.category, i.age_group, i.squad_designation, i.gender, i.display_name, i.is_projected
      from public.get_team_identity_for_season(v_team_id, v_season_id) i;
  end loop;
end;
$$;

comment on function public.get_team_identities_for_season_batch(jsonb) is
  'Batch form of get_team_identity_for_season(): p_pairs is a JSON array of {"team_id": uuid, "season_id": uuid} objects. Runs with the caller''s own privileges (no SECURITY DEFINER) exactly like the function it wraps, so results are still subject to that function''s own table-level RLS.';

grant execute on function public.get_team_identities_for_season_batch(jsonb) to authenticated;
