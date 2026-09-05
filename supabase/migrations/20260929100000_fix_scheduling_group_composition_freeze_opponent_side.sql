-- Fix: Mini-Rugby Group composition freeze ignored fixtures where the group
-- is the OPPONENT side.
--
-- Found by the Season Handover / Mini-Rugby open-task completion pass while
-- repairing supabase/tests/scheduling_groups.sql test 22.
--
-- set_scheduling_group_members refuses to edit a group's composition once a
-- real fixture references it ("its composition is now historical and cannot
-- change"). That guard only counted fixtures whose owning_scheduling_group_id
-- was the group. Since the group-vs-group model added
-- opponent_scheduling_group_id, a group can equally be the OPPONENT side of a
-- booked fixture -- the ordinary case when another club requests a fixture
-- against your Mini-Rugby Group and you are away. In that shape the guard did
-- not fire, so the composition of a group that had already played could still
-- be rewritten, silently changing the historical record of which teams were
-- actually involved.
--
-- Fix: count fixtures on EITHER side. No schema change, no new object; the
-- rest of the function is byte-identical to its current live definition
-- (dumped via pg_get_functiondef immediately before editing).

CREATE OR REPLACE FUNCTION public.set_scheduling_group_members(p_group_id uuid, p_team_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_tag text;
  v_fixture_count integer;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  select count(*) into v_fixture_count from public.fixtures
   where (owning_scheduling_group_id = p_group_id or opponent_scheduling_group_id = p_group_id)
     and status <> 'Cancelled';
  if v_fixture_count > 0 then
    raise exception 'This Mini-Rugby Group already has a fixture booked against it -- its composition is now historical and cannot change. Create a new Mini-Rugby Group instead.';
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  delete from public.scheduling_group_members where group_id = p_group_id;
  insert into public.scheduling_group_members (group_id, team_id)
  select p_group_id, unnest(p_team_ids);

  update public.scheduling_groups set display_tag = v_tag, updated_by = auth.uid() where id = p_group_id;
end;
$function$

;
