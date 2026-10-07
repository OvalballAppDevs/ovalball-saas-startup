-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE G: knockout progression notifications -- confirmed entirely
-- absent by the audit, and confirmed again by direct inspection of internal.fill_bracket_slot /
-- internal.create_bracket_game / internal.ensure_third_place_game, none of which notified anybody.
--
-- THE ONE HOOK POINT: internal.fill_bracket_slot, called by internal.advance_tournament_bracket
-- whenever a result resolves -- never the result-submission RPCs directly, and never
-- create_bracket_game/ensure_third_place_game individually, which only build the game record once
-- both sides of a pair are already known. fill_bracket_slot already has the idempotency guard this
-- needs for free: it returns immediately if the slot's participant is not actually changing, so a
-- notification placed after that guard fires exactly once per genuine advancement, never on a repeat
-- call with the same winner.
--
-- TWO FACTS, NEVER MORE THAN ONE NOTIFICATION EACH, PER SIDE, PER ROUND:
--   "You're through to the {round}" -- to the side whose slot was just filled, with the opponent's
--   name folded in if the pair is already complete at that moment.
--   "Your {round} opponent is known" -- a follow-up, ONLY to the side that was already waiting when
--   the pair completes later (the side that just arrived already got the opponent's name in its own
--   advance message above, so it does not receive this too).
-- A bracket's internal dependency rows can update several times getting here; this is the one and
-- only place a human-facing fact becomes true, which is the only place a notification is sent from.

insert into public.notification_types (type_key, topic_key, event_key) values
  ('tournament_side_advanced', 'tournaments', 'knockout_progression'),
  ('tournament_opponent_known', 'tournaments', 'knockout_progression');

create or replace function internal.notify_tournament_side(
  p_participant_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_club_id uuid;
  v_team_id uuid;
begin
  select club_id, team_id into v_club_id, v_team_id
  from public.tournament_participants where id = p_participant_id;
  if v_club_id is null then return; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct cm.user_id, p_type, p_title, p_body, p_data
  from public.club_memberships cm
  where cm.club_id = v_club_id and cm.status = 'active'
    and (coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'club',
                                               v_club_id, null, null, false, false)).allowed, false)
         or (v_team_id is not null
             and coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'team',
                                                        v_club_id, v_team_id, null, false, false)).allowed, false)))
    and internal.is_account_active(cm.user_id);
end;
$function$;

revoke all on function internal.notify_tournament_side(uuid, text, text, text, jsonb) from public;

create or replace function internal.fill_bracket_slot(p_plan_id uuid, p_round integer, p_position integer, p_participant uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_current uuid; v_game uuid; v_partner uuid; v_pair_pos integer;
  v_tournament_id uuid; v_round_label text; v_opponent jsonb; v_mine jsonb;
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

  -- NOTIFICATIONS PLATFORM PROGRAMME, PHASE G: only on a genuine, non-clearing advancement -- p_round
  -- 1 is the opening draw being set, not an advancement, so it is deliberately excluded.
  if p_participant is not null and p_round > 1 then
    select tournament_id into v_tournament_id from public.tournament_plans where id = p_plan_id;
    v_round_label := internal.tournament_game_round_label(p_plan_id, p_round, false);
    v_mine := internal.tournament_side_summary(p_participant, null);
    if v_partner is not null then
      v_opponent := internal.tournament_side_summary(v_partner, null);
    end if;

    perform internal.notify_tournament_side(
      p_participant,
      'tournament_side_advanced',
      format('You''re through to the %s', coalesce(v_round_label, 'next round')),
      -- clubName, never label: `label` is the canonical TEAM presentation (CLAUDE.md's Team Directory
      -- rule -- derived from category/age grade/pathway, never free text), so every U12 boys' side in
      -- the tournament reads the identical "Under 12 Boys" there. A notification sentence needs the
      -- thing that actually distinguishes one side from another, which is the club's own name.
      case when v_opponent is not null
        then format('Your %s opponent is %s.', coalesce(v_round_label, 'next round'), v_opponent->>'clubName')
        else 'The schedule will update once your opponent is known.'
      end,
      jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
    );
  end if;

  if p_participant is not null and v_partner is not null then
    perform internal.create_bracket_game(p_plan_id, p_round, ((p_position + 1) / 2));

    -- The side that was ALREADY waiting (v_partner) could not have known its opponent in its own
    -- advance message, because the opponent was not known yet when that message was sent. This is
    -- the one moment it becomes knowable, so it is told now, once -- never on a later no-op call,
    -- because the whole block above is already gated on the slot genuinely changing.
    if p_round > 1 then
      perform internal.notify_tournament_side(
        v_partner,
        'tournament_opponent_known',
        format('Your %s opponent is known', coalesce(v_round_label, 'next round')),
        format('You will play %s.', coalesce(v_mine->>'clubName', 'your opponent')),
        jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
      );
    end if;
  end if;
end;
$function$;
