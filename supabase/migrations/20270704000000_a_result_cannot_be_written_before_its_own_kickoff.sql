-- PLATFORM-WIDE INVARIANT: a result cannot be written before the game it belongs to has kicked off.
--
-- AUDIT. Every canonical result-writing function was read before this migration was written:
--
--   submit_fixture_result            -- already gated, via internal.fixture_result_eligible
--   submit_tournament_game_result    -- already gated, via internal.tournament_game_result_eligible
--   claim_external_fixture_result    -- safe by construction: only ever acts on a fixture already at
--                                        result_status = 'external_recorded', which itself could only
--                                        be reached through the gated path above
--
--   resolve_tournament_game_result   -- GAP. No eligibility check, and no precondition that any
--                                        result had ever been submitted. An organiser could resolve a
--                                        game that has not kicked off.
--   resolve_fixture_result_dispute   -- GAP. Same shape: a Site Admin / Fixture Ops Admin could
--                                        resolve a fixture with no prior submission and no kickoff.
--   record_competition_match_result  -- GAP, and entirely unguarded. Both already-registered tests
--                                        that exercise it (competition_creator_conformance.sql,
--                                        competition_matches.sql) were doing so against a match
--                                        scheduled weeks in the future, or with no kickoff at all --
--                                        the test suite had encoded the gap as correct behaviour.
--
-- ONE AUTHORITY PER SURFACE, not a second interpretation. `fixture_result_eligible` and
-- `tournament_game_result_eligible` already existed and are untouched here; this adds the Competition
-- Match equivalent (there was no established convention of its own to preserve, so it follows the
-- tournament convention: no kickoff time recorded means no result, never a next-day fallback), and
-- gates the two resolution paths on the entry-point authority for their own surface -- the same rule
-- a fresh submission would be held to.

create or replace function internal.competition_match_result_eligible(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.competition_matches m
    where m.id = p_match_id
      and m.status <> 'cancelled'
      and m.match_date is not null
      and m.kickoff_time is not null
      and (m.match_date + m.kickoff_time) <= (now() at time zone 'Europe/London')
  );
$function$;

create or replace function public.record_competition_match_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_winner_participant_id uuid DEFAULT NULL::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
  v_kind text;
  v_winner uuid;
begin
  select * into m from public.competition_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if m.home_participant_id is null or m.away_participant_id is null then
    raise exception 'Both teams must be known before a result is recorded.' using errcode = '23514';
  end if;
  if m.status = 'cancelled' then
    raise exception 'This match was cancelled.' using errcode = '23514';
  end if;
  if not internal.competition_match_result_eligible(p_match_id) then
    if m.kickoff_time is null or m.match_date is null then
      raise exception 'A kick-off time must be scheduled before a result can be recorded.' using errcode = '23514';
    end if;
    raise exception 'This match has not kicked off yet.' using errcode = '23514';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'Enter both scores.';
  end if;
  select kind into v_kind from public.competition_stages where id = m.stage_id;

  v_winner := case
    when p_home_score > p_away_score then m.home_participant_id
    when p_away_score > p_home_score then m.away_participant_id
    else p_winner_participant_id end;
  if v_kind = 'knockout' and v_winner is null then
    raise exception 'A knockout match needs a winner. Choose who went through.' using errcode = '23514';
  end if;
  if v_winner is not null and v_winner not in (m.home_participant_id, m.away_participant_id) then
    raise exception 'The winner must be one of the two teams.' using errcode = '23514';
  end if;

  update public.competition_matches
  set home_score = p_home_score, away_score = p_away_score, winner_participant_id = v_winner,
      result_source = 'organiser', status = 'completed', updated_by = auth.uid(), updated_at = now()
  where id = m.id;

  perform internal.advance_competition_knockout(m.id);
  perform internal.sync_competition_match_fixtures(m.id);
end;
$function$;

create or replace function public.resolve_tournament_game_result(p_game_id uuid, p_side_a_score integer, p_side_b_score integer, p_reason text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.tournament_games;
begin
  perform internal.require_live_session();
  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;

  if not internal.can_resolve_tournament_result(p_game_id) then
    raise exception 'Only the tournament organiser can settle a result.' using errcode = '42501';
  end if;
  if g.status = 'CANCELLED' then
    raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
  end if;
  -- BEING THE HOST DOES NOT MOVE THE KICK-OFF. The same question a fresh submission answers: has
  -- THIS game's own scheduled kick-off been reached. A bracket dependency resolving early (both
  -- semi-finalists known well before a three o'clock kick-off) does not change when the Final's
  -- result may be written.
  if not internal.tournament_game_result_eligible(p_game_id) then
    if g.start_time is null then
      raise exception 'A kick-off time must be scheduled before a result can be recorded.' using errcode = '22023';
    end if;
    raise exception 'This game has not kicked off yet.' using errcode = '22023';
  end if;

  -- ATTRIBUTABLE, AND ADDITIVE. The resolution is a row of its own; nothing already said is altered.
  insert into public.tournament_game_result_submissions
    (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
  values (p_game_id, 'host_resolution', p_side_a_score, p_side_b_score, auth.uid(), null, nullif(trim(p_reason), ''));

  update public.tournament_games
  set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
      result_status = 'final', status = 'PLAYED',
      result_confirmed_by = auth.uid(), result_confirmed_at = now(),
      result_resolved_by = auth.uid(), result_resolved_at = now(),
      result_resolution_reason = nullif(trim(p_reason), ''),
      updated_by = auth.uid(), updated_at = now()
  where id = p_game_id;

  perform internal.notify_tournament_result(p_game_id, null, 'tournament_result_resolved',
    'The organiser settled a result', 'The organiser has set the final score for a tournament game.');
  return jsonb_build_object('status', 'final');
end;
$function$;

create or replace function public.resolve_fixture_result_dispute(p_fixture_id uuid, p_home_score integer, p_away_score integer, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.fixtures;
begin
  if not (internal.has_site_capability('site.fixtures.support')) then
    raise exception 'Only a Full Site Admin or Fixture Operations Admin may resolve a disputed result.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to resolve a disputed result.';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be zero or a positive whole number.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  -- THE SAME QUESTION A FRESH SUBMISSION ANSWERS. Site Admin authority settles a dispute; it does
  -- not grant the power to write a result for a fixture that has not kicked off.
  if not internal.fixture_result_eligible(p_fixture_id) then
    if exists (select 1 from public.fixtures where id = p_fixture_id and status = 'Cancelled') then
      raise exception 'This fixture is cancelled -- a cancelled fixture cannot receive a result.';
    end if;
    raise exception 'This fixture has not kicked off yet -- a result cannot be submitted before then.';
  end if;

  insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, note)
  values (p_fixture_id, 'site_admin_resolution', p_home_score, p_away_score, auth.uid(), p_reason);

  update public.fixtures
  set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
      result_site_admin_resolved_by = auth.uid(), result_site_admin_resolved_at = now(), result_site_admin_resolution_reason = p_reason,
      result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
      result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null,
      result_deadline_at = null
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
        result_site_admin_resolved_by = auth.uid(), result_site_admin_resolved_at = now(), result_site_admin_resolution_reason = p_reason,
        result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
        result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null,
        result_deadline_at = null
    where id = f.mirror_fixture_id;
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result resolved by Site Admin: %s - %s. Reason: %s', p_home_score, p_away_score, p_reason));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result resolved by Site Admin', format('A Site Admin has resolved this fixture''s result as %s - %s.', p_home_score, p_away_score));
end;
$function$;
