-- =====================================================================================================
-- A WINNER GOES THROUGH, AND NOTHING ELSE DOES.
--
-- Progression is the whole sporting consequence of a knockout, and it is SERVER AUTHORITATIVE. A phone
-- works out where to draw a line on a bracket; it never works out who is in the semi-final.
--
-- ---- WHAT ADVANCES A SIDE ------------------------------------------------------------------------
--
-- Exactly one thing: a CANONICAL SETTLED RESULT with a decisive score, or -- where the competition
-- allows it -- a winner the organiser recorded. The same lifecycle as every other Ovalball result:
--
--   submitted only          nothing advances. One club's opinion is not a result.
--   contested               nothing advances, unless a previously settled result still stands.
--   confirmed / recorded    the winner goes through.
--   organiser resolved      the winner goes through, from the organiser's score.
--
-- A LEVEL GAME HAS NO WINNER. Not the side listed first, not the lower participant id, not the home
-- side -- there is no home side. The bracket stops, the game says a winner is required, and somebody
-- with the authority decides. Choosing a winner by ordering would be a coin toss the app pretends is a
-- rule, and it is the single easiest way to put the wrong club in a final.
--
-- ---- AND HISTORY IS NEVER SILENTLY REWRITTEN -----------------------------------------------------
--
-- An organiser correcting a quarter-final the morning after has corrected a quarter-final. If nothing
-- downstream has happened yet, the semi-final is rewired and nobody is any the wiser. But if the
-- semi-final has already been played -- submitted, confirmed, contested, anything at all -- rewiring it
-- would delete a game two clubs turned up for. That is REFUSED, by name, and the organiser is told
-- what stands in the way.
-- =====================================================================================================

/**
 * WHO WON, FROM A SETTLED SCORE. Null where the result is not settled, or where it is level.
 *
 * `internal.tournament_result_counts` is the one authority for "settled", shared with the Round Robin
 * table -- so a result that moves a table and a result that advances a bracket are the same result by
 * construction rather than by two definitions that agree today.
 */
create or replace function internal.tournament_score_winner(p_game_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when g.status = 'CANCELLED' then null
    when not internal.tournament_result_counts(g.result_status) then null
    when g.side_a_score is null or g.side_b_score is null then null
    when g.side_a_score > g.side_b_score then g.side_a_id
    when g.side_b_score > g.side_a_score then g.side_b_id
    -- LEVEL. Deliberately null: there is no winner to be had from this score.
    else null
  end
  from public.tournament_games g where g.id = p_game_id;
$function$;

/** Has anything meaningful happened to this game -- anything that makes deleting it destructive. */
create or replace function internal.tournament_game_has_activity(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from public.tournament_games g
                 where g.id = p_game_id and (g.result_status <> 'none' or g.winner_participant_id is not null))
      or exists (select 1 from public.tournament_game_result_submissions s where s.game_id = p_game_id);
$function$;

/**
 * THE GAME THAT A BRACKET SLOT FEEDS INTO, if one exists yet.
 *
 * Slots 2k-1 and 2k of a round are game k of that round, so the owning game is found by arithmetic
 * rather than by a stored link that could point at a game somebody deleted.
 */
create or replace function internal.tournament_slot_game(p_plan_id uuid, p_round integer, p_position integer)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select g.id from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = p_round
    and g.bracket_position = ((p_position + 1) / 2)
    and not g.is_third_place
  limit 1;
$function$;

/**
 * PUT A SIDE IN A PLACE, and keep the game that place feeds coherent with it.
 *
 * Refuses rather than destroys: if the game below has been played, the organiser is told what is in
 * the way instead of having it deleted underneath them.
 */
create or replace function internal.fill_bracket_slot(
  p_plan_id uuid,
  p_round integer,
  p_position integer,
  p_participant uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_current uuid; v_game uuid; v_partner uuid; v_pair_pos integer;
begin
  select participant_id into v_current from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_position;
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
  where plan_id = p_plan_id and round_number = p_round and position = p_position;

  -- The game is rebuilt from the pair rather than edited, so it can never hold a side the draw does
  -- not have in that place.
  if v_game is not null then
    delete from public.tournament_games where id = v_game;
  end if;

  v_pair_pos := case when p_position % 2 = 1 then p_position + 1 else p_position - 1 end;
  select participant_id into v_partner from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = v_pair_pos;

  if p_participant is not null and v_partner is not null then
    perform internal.create_bracket_game(p_plan_id, p_round, ((p_position + 1) / 2));
  end if;
end;
$function$;

/** One game between the two sides now occupying a pair of places. */
create or replace function internal.create_bracket_game(p_plan_id uuid, p_round integer, p_game_position integer)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_a uuid; v_b uuid; v_t uuid; v_grade text; v_id uuid;
begin
  select p.tournament_id, p.age_group into v_t, v_grade from public.tournament_plans p where p.id = p_plan_id;
  select participant_id into v_a from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 - 1;
  select participant_id into v_b from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2;
  if v_a is null or v_b is null then return null; end if;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, status,
     round_number, bracket_position, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     -- A DATE IS REQUIRED BY THE TABLE, and the scheduler replaces it with a real one immediately. The
     -- competition's first day is the honest placeholder: it is a day the tournament actually runs.
     (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id),
     'SCHEDULED', p_round, p_game_position, p_round * 1000 + p_game_position, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---- generating the competition ----------------------------------------------------------------------

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
  where plan_id = p_plan_id and round_number = 1;
  if v_size = 0 then
    raise exception 'Make the draw before generating the games.' using errcode = '22023';
  end if;
  v_rounds := internal.bracket_rounds(v_size);

  -- Only the games are cleared. The DRAW is the organiser's arrangement and survives a regeneration.
  delete from public.tournament_games where plan_id = p_plan_id;

  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      if internal.create_bracket_game(p_plan_id, v_round, v_pos) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  perform internal.ensure_third_place_game(p_plan_id);
  perform internal.schedule_tournament_plan_games(p_plan_id);

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return v_n;
end;
$function$;

/**
 * THE THIRD-PLACE PLAY-OFF, where the competition has one.
 *
 * Its sides are the two semi-final LOSERS, which is the one pairing the slot arithmetic cannot
 * express -- so it is named rather than derived, and it advances nobody.
 */
create or replace function internal.ensure_third_place_game(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_on boolean; v_size integer; v_rounds integer; v_semi integer;
  v_a uuid; v_b uuid; v_t uuid; v_grade text; v_existing uuid; v_id uuid;
begin
  select p.third_place_playoff, p.tournament_id, p.age_group into v_on, v_t, v_grade
  from public.tournament_plans p where p.id = p_plan_id;
  select count(*) into v_size from public.tournament_bracket_slots where plan_id = p_plan_id and round_number = 1;
  v_rounds := internal.bracket_rounds(v_size);
  if v_rounds < 2 then return null; end if;
  v_semi := v_rounds - 1;

  select id into v_existing from public.tournament_games
  where plan_id = p_plan_id and is_third_place limit 1;

  if not coalesce(v_on, false) then
    -- TURNING IT OFF REMOVES IT, unless it has been played -- in which case it is a game that happened
    -- and the setting does not get to erase it.
    if v_existing is not null and not internal.tournament_game_has_activity(v_existing) then
      delete from public.tournament_games where id = v_existing;
    end if;
    return null;
  end if;

  -- THE LOSERS, and only once both are known.
  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_a from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 1
    and not g.is_third_place and g.winner_participant_id is not null;
  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_b from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 2
    and not g.is_third_place and g.winner_participant_id is not null;

  if v_a is null or v_b is null then return v_existing; end if;

  if v_existing is not null then
    if internal.tournament_game_has_activity(v_existing) then return v_existing; end if;
    delete from public.tournament_games where id = v_existing;
  end if;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, status,
     round_number, bracket_position, is_third_place, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     (select max(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id),
     'SCHEDULED', v_rounds, 2, true, v_rounds * 1000 + 2, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---- advancing ---------------------------------------------------------------------------------------

create or replace function internal.advance_tournament_bracket(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare g record; v_winner uuid; v_rounds integer; v_size integer;
begin
  select tg.id, tg.plan_id, tg.round_number, tg.bracket_position, tg.is_third_place,
         tg.winner_participant_id, tg.side_a_id, tg.side_b_id
  into g from public.tournament_games tg where tg.id = p_game_id;
  if g.id is null or g.plan_id is null or g.bracket_position is null then return; end if;

  -- THE THIRD-PLACE GAME ADVANCES NOBODY. It is the end of its own line.
  if g.is_third_place then return; end if;

  v_winner := g.winner_participant_id;

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = g.plan_id and round_number = 1;
  v_rounds := internal.bracket_rounds(v_size);

  -- THE FINAL'S WINNER WINS THE COMPETITION. There is no place above it to fill.
  if g.round_number < v_rounds then
    perform internal.fill_bracket_slot(g.plan_id, g.round_number + 1, g.bracket_position, v_winner);
  end if;

  -- And a semi-final result may have completed the third-place pairing.
  if g.round_number = v_rounds - 1 then
    perform internal.ensure_third_place_game(g.plan_id);
  end if;
end;
$function$;

/**
 * WHENEVER A KNOCKOUT GAME'S RESULT MOVES, THE BRACKET FOLLOWS.
 *
 * A trigger rather than a step in each write path, because there are five ways a result can change --
 * submitted, confirmed, contested, resolved, corrected -- and a bracket that advanced from four of
 * them would be wrong in a way nobody notices until a club turns up to the wrong semi-final.
 */
create or replace function internal.tournament_game_progression()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_winner uuid;
begin
  if new.bracket_position is null then return new; end if;

  v_winner := internal.tournament_score_winner(new.id);

  /*
    AN ORGANISER'S DECLARED WINNER IS NOT OVERWRITTEN BY A LEVEL SCORE. Where the competition settles
    ties by the organiser recording who went through, the score stays level for ever and the decision
    is the only thing that resolves it.
  */
  if v_winner is null and new.winner_decided_by is not null then
    v_winner := new.winner_participant_id;
  end if;

  if v_winner is distinct from new.winner_participant_id then
    update public.tournament_games set winner_participant_id = v_winner where id = new.id;
    new.winner_participant_id := v_winner;
  end if;

  perform internal.advance_tournament_bracket(new.id);
  return new;
end;
$function$;

drop trigger if exists tournament_game_progression on public.tournament_games;
create trigger tournament_game_progression
after insert or update of result_status, side_a_score, side_b_score, status, winner_participant_id
on public.tournament_games
for each row execute function internal.tournament_game_progression();

-- ---- a level game the organiser decides --------------------------------------------------------------

create or replace function public.declare_tournament_game_winner(
  p_game_id uuid,
  p_participant_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.tournament_games; v_method text;
begin
  perform internal.require_live_session();
  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_resolve_tournament_result(p_game_id) then
    raise exception 'Only the tournament organiser can decide who went through.' using errcode = '42501';
  end if;
  if p_participant_id is distinct from g.side_a_id and p_participant_id is distinct from g.side_b_id then
    raise exception 'The winner must be one of the two sides.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say how the winner was decided -- it is recorded against the tournament.'
      using errcode = '22023';
  end if;

  select tie_resolution into v_method from public.tournament_plans where id = g.plan_id;
  if coalesce(v_method, 'none') = 'none' then
    raise exception 'This competition does not settle level games, so a winner cannot be recorded.'
      using errcode = '22023';
  end if;

  -- ONLY A LEVEL GAME NEEDS DECIDING. A decisive score already says who won, and overriding it would
  -- be changing the result rather than resolving a tie -- which is what correcting the score is for.
  if internal.tournament_score_winner(p_game_id) is not null then
    raise exception 'This game already has a winner from its score.' using errcode = '22023';
  end if;

  update public.tournament_games
  set winner_participant_id = p_participant_id,
      winner_decided_by = auth.uid(), winner_decided_at = now(),
      winner_decision_reason = trim(p_reason),
      updated_by = auth.uid(), updated_at = now()
  where id = p_game_id;
end;
$function$;

revoke all on function public.generate_tournament_knockout_fixtures(uuid) from public, anon;
revoke all on function public.declare_tournament_game_winner(uuid, uuid, text) from public, anon;
grant execute on function public.generate_tournament_knockout_fixtures(uuid) to authenticated, service_role;
grant execute on function public.declare_tournament_game_winner(uuid, uuid, text) to authenticated, service_role;
