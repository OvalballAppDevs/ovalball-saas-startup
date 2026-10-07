-- The Final already names each of its two places the moment ITS OWN semi-final decides it -- one
-- side can read "Winner SF1" while the other already shows a real club. The Third-Place slots waited
-- for BOTH semi-finals before naming either, which told a family less than the draw actually knew:
-- Chorley's place was knowable the moment their semi-final finished, not only once the other one had.
-- Split the "both losers known" gate so each slot is only gated on its own source semi-final; the
-- actual third-place GAME still needs both sides, exactly as the Final's own game does.

create or replace function internal.ensure_third_place_game(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_on boolean; v_size integer; v_rounds integer; v_semi integer;
  v_a uuid; v_b uuid; v_t uuid; v_grade text; v_existing uuid; v_id uuid; bp record;
begin
  select p.third_place_playoff, p.tournament_id, p.age_group into v_on, v_t, v_grade
  from public.tournament_plans p where p.id = p_plan_id;
  select count(*) into v_size from public.tournament_bracket_slots where plan_id = p_plan_id and round_number = 1;
  v_rounds := internal.bracket_rounds(v_size);
  if v_rounds < 2 then return null; end if;
  v_semi := v_rounds - 1;

  select id into v_existing from public.tournament_games where plan_id = p_plan_id and is_third_place limit 1;

  if not coalesce(v_on, false) then
    if v_existing is not null and not internal.tournament_game_has_activity(v_existing) then
      delete from public.tournament_games where id = v_existing;
    end if;
    delete from public.tournament_bracket_pairings
    where plan_id = p_plan_id and is_third_place and game_id is null;
    return null;
  end if;

  if not exists (select 1 from public.tournament_bracket_pairings where plan_id = p_plan_id and is_third_place) then
    insert into public.tournament_bracket_pairings (plan_id, round_number, game_position, is_third_place)
    values (p_plan_id, v_rounds, 2, true);
    perform internal.schedule_bracket_pairings(p_plan_id);
  end if;

  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_a from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 1
    and not g.is_third_place and g.winner_participant_id is not null;
  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_b from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 2
    and not g.is_third_place and g.winner_participant_id is not null;

  -- EACH PLACE IS NAMED THE MOMENT ITS OWN SEMI-FINAL DECIDES IT -- independently, the same as the
  -- Final's places either side of it.
  if v_a is not null then
    update public.tournament_bracket_slots set participant_id = v_a, updated_at = now()
    where plan_id = p_plan_id and round_number = v_rounds and position = 1 and is_third_place;
  end if;
  if v_b is not null then
    update public.tournament_bracket_slots set participant_id = v_b, updated_at = now()
    where plan_id = p_plan_id and round_number = v_rounds and position = 2 and is_third_place;
  end if;

  -- THE GAME ITSELF still needs both losers, exactly as the Final needs both semi-final winners.
  if v_a is null or v_b is null then return v_existing; end if;

  if v_existing is not null then
    if internal.tournament_game_has_activity(v_existing) then return v_existing; end if;
    delete from public.tournament_games where id = v_existing;
  end if;

  select * into bp from public.tournament_bracket_pairings where plan_id = p_plan_id and is_third_place;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, status,
     round_number, bracket_position, is_third_place, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     coalesce(bp.game_date, (select max(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
     bp.start_time, bp.pitch_id,
     'SCHEDULED', v_rounds, 2, true, v_rounds * 1000 + 2, auth.uid(), auth.uid())
  returning id into v_id;

  update public.tournament_bracket_pairings set game_id = v_id, updated_at = now()
  where plan_id = p_plan_id and is_third_place;
  return v_id;
end;
$function$;

-- Backfill: the one semi-final that has already decided its loser, for the tournament this was
-- proven on, gets its third-place place named now rather than waiting for the second semi-final.
select internal.ensure_third_place_game(pl.id)
from public.tournament_plans pl
where pl.tournament_id = '96f85ae4-1818-4b4c-9acd-846109b8b2c9' and pl.age_group = 'U12';
