-- =====================================================================================================
-- A BYE TAKES NO PITCH AND NO SLOT.
--
-- Generation created an opening-round pairing wherever EITHER place held a side -- so a side drawn
-- against a bye was given a scheduled pairing for a game that will never be played. It would have taken
-- a pitch slot from a real game, and shown in the running order as a fixture nobody turns up to.
--
-- An opening pairing needs BOTH its places filled by real sides. Found by working out what the number
-- of games in a single-elimination competition must be: every game eliminates exactly one side, so a
-- field of n plays exactly n - 1 of them, and the arithmetic did not come out.
-- =====================================================================================================

create or replace function public.generate_tournament_knockout_fixtures(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_rounds integer; v_size integer; v_round integer; v_pos integer; v_n integer := 0;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = 1 and not is_third_place;
  if v_size = 0 then
    raise exception 'Make the draw before generating the games.' using errcode = '22023';
  end if;
  v_rounds := internal.bracket_rounds(v_size);

  delete from public.tournament_games where plan_id = p_plan_id;
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;

  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      -- AN OPENING PAIRING NEEDS TWO REAL SIDES. One of them against a bye is not a game: that side is
      -- already through, and reserving a pitch for it would take a slot from a game that is played.
      -- Later rounds always pair two places, whoever ends up in them.
      if v_round > 1 or not exists (
        select 1 from public.tournament_bracket_slots s
        where s.plan_id = p_plan_id and s.round_number = v_round and not s.is_third_place
          and s.position in (v_pos * 2 - 1, v_pos * 2) and s.is_bye
      ) then
        insert into public.tournament_bracket_pairings (plan_id, round_number, game_position)
        values (p_plan_id, v_round, v_pos);
      end if;
    end loop;
  end loop;

  if (select third_place_playoff from public.tournament_plans where id = p_plan_id) and v_rounds >= 2 then
    insert into public.tournament_bracket_pairings (plan_id, round_number, game_position, is_third_place)
    values (p_plan_id, v_rounds, 2, true);
  end if;

  perform internal.schedule_bracket_pairings(p_plan_id);

  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      if internal.create_bracket_game(p_plan_id, v_round, v_pos) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  perform internal.ensure_third_place_game(p_plan_id);

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return v_n;
end;
$function$;

/**
 * HOW MANY GAMES THIS COMPETITION WILL PLAY, as a fact the planner can state before a ball is kicked.
 *
 * A single-elimination competition of n sides plays exactly n - 1 games, because every game eliminates
 * exactly one side and n - 1 sides must be eliminated to leave one standing. A third-place play-off
 * adds one more, and is the only thing that can.
 */
create or replace function internal.knockout_expected_games(p_plan_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select greatest(0, (select count(*) from public.tournament_bracket_slots s
                      where s.plan_id = p_plan_id and s.round_number = 1
                        and not s.is_third_place and s.participant_id is not null) - 1)
       + (select case when p.third_place_playoff
                       and internal.bracket_rounds(
                             (select count(*)::int from public.tournament_bracket_slots s2
                              where s2.plan_id = p_plan_id and s2.round_number = 1
                                and not s2.is_third_place)) >= 2
                 then 1 else 0 end
          from public.tournament_plans p where p.id = p_plan_id);
$function$;
