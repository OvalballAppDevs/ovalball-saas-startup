-- BUG: a semi-final's winner was also landing in the Third-Place Play-off slot at the same position.
--
-- `tournament_bracket_slots` names a place by (round_number, position) -- but round `v_rounds` holds
-- TWO different places at each position: the Final (is_third_place = false) and the Third-Place
-- Play-off (is_third_place = true), both numbered 1 and 2 by `internal.write_tournament_draw`.
--
-- `internal.fill_bracket_slot` forgot the third column. Its SELECT, UPDATE and partner-lookup all
-- matched on (plan_id, round_number, position) alone, so filling the Final's winner slot at
-- (round 3, position 2) also overwrote the Third-Place slot at (round 3, position 2) with the same
-- winner -- the side that was actually eliminated from that game never appeared anywhere. Proven on
-- live UAT data: Ovalball UAT RUFC beat Chorley RUFC 22-4 in a semi-final, and both the Final slot
-- and the Third-Place slot ended up naming Ovalball.
--
-- This function is only ever called by `internal.advance_tournament_bracket` to fill a WINNER's
-- destination, so it is scoped to the winner side of the bracket throughout.

create or replace function internal.fill_bracket_slot(p_plan_id uuid, p_round integer, p_position integer, p_participant uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_current uuid; v_game uuid; v_partner uuid; v_pair_pos integer;
begin
  select participant_id into v_current from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_position and not is_third_place;
  if v_current is not distinct from p_participant then return; end if;

  -- WHAT IS ALREADY BUILT ON THIS PLACE.
  v_game := internal.tournament_slot_game(p_plan_id, p_round, p_position);
  if v_game is not null and internal.tournament_game_has_activity(v_game) then
    raise exception
      'The % game this result feeds has already been played. Changing who goes through would delete it. Clear that game''s result first if it genuinely needs to change.',
      case when p_round = 1 then 'opening-round' else 'next-round' end
      using errcode = '22023', hint = 'TOURNAMENT_BRACKET_DOWNSTREAM_ACTIVITY';
  end if;

  update public.tournament_bracket_slots
  set participant_id = p_participant, updated_at = now()
  where plan_id = p_plan_id and round_number = p_round and position = p_position and not is_third_place;

  -- The game is rebuilt from the pair rather than edited, so it can never hold a side the draw does
  -- not have in that place.
  if v_game is not null then
    delete from public.tournament_games where id = v_game;
  end if;

  v_pair_pos := case when p_position % 2 = 1 then p_position + 1 else p_position - 1 end;
  select participant_id into v_partner from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = v_pair_pos and not is_third_place;

  if p_participant is not null and v_partner is not null then
    perform internal.create_bracket_game(p_plan_id, p_round, ((p_position + 1) / 2));
  end if;
end;
$function$;

-- THE THIRD-PLACE PLACES NEVER LEARNED WHO LOST. `ensure_third_place_game` always correctly computed
-- the two semi-final losers for the `tournament_games` row it creates, but never told the matching
-- `tournament_bracket_slots` rows -- the ones `get_tournament_bracket` actually reads to label the
-- play-off. Set once both losers are known, the same gate the game-creation below already uses, so a
-- side is never named before it has genuinely lost its semi-final.

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

  if v_a is null or v_b is null then return v_existing; end if;

  -- THE PLACES THEMSELVES, named now that both losers are real. Idempotent: safe to run again on a
  -- game that already has activity, because it sets the same two values it already holds.
  update public.tournament_bracket_slots set participant_id = v_a, updated_at = now()
  where plan_id = p_plan_id and round_number = v_rounds and position = 1 and is_third_place;
  update public.tournament_bracket_slots set participant_id = v_b, updated_at = now()
  where plan_id = p_plan_id and round_number = v_rounds and position = 2 and is_third_place;

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

-- DATA CORRECTION for the one tournament this was proven on. Only the wrongly-cross-contaminated
-- slot is touched: Ovalball UAT RUFC's own place in the Final (correct) is untouched, and the
-- Third-Place slot is reset to unresolved, which is the truth -- the other semi-final has not been
-- played yet, so nobody has genuinely lost their way into the play-off.
update public.tournament_bracket_slots s
set participant_id = null, updated_at = now()
from public.tournament_plans p
where s.plan_id = p.id
  and p.tournament_id = '96f85ae4-1818-4b4c-9acd-846109b8b2c9'
  and s.is_third_place
  and s.participant_id is not null
  and not exists (
    select 1 from public.tournament_games g
    where g.plan_id = s.plan_id and g.is_third_place
  );
