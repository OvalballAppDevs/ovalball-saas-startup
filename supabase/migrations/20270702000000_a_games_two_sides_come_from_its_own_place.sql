-- SAME BUG, SAME ROUND: `create_bracket_game` read a place's side by (plan_id, round_number, position)
-- alone, which the Final and the Third-Place Play-off both answer to at the last round. It was masked
-- for as long as `fill_bracket_slot` wrote the same wrong value into both places (previous migration);
-- now that each place correctly holds its own side, this query could pick either row -- including the
-- Third-Place one, which is still empty at the exact moment the Final's second side is filled, because
-- `ensure_third_place_game` only runs after `fill_bracket_slot` returns. That produced the second half
-- of the same symptom: the Final's own game sometimes failed to materialise at all.

create or replace function internal.create_bracket_game(p_plan_id uuid, p_round integer, p_game_position integer)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_a uuid; v_b uuid; v_t uuid; v_grade text; v_id uuid; bp record;
begin
  select p.tournament_id, p.age_group into v_t, v_grade from public.tournament_plans p where p.id = p_plan_id;
  select participant_id into v_a from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 - 1 and not is_third_place;
  select participant_id into v_b from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 and not is_third_place;
  if v_a is null or v_b is null then return null; end if;

  select * into bp from public.tournament_bracket_pairings
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, status,
     round_number, bracket_position, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     coalesce(bp.game_date, (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
     bp.start_time, bp.pitch_id,
     'SCHEDULED', p_round, p_game_position, p_round * 1000 + p_game_position, auth.uid(), auth.uid())
  returning id into v_id;

  update public.tournament_bracket_pairings set game_id = v_id, updated_at = now()
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;
  return v_id;
end;
$function$;
