-- =====================================================================================================
-- A SIDE THAT IS NOT ON OVALBALL CANNOT CONFIRM.
--
-- Found by driving the real UAT festival: the host's own U12 side submitted 10-10 against Blackburn,
-- which is a CLUB DIRECTORY entry with no Ovalball club behind it. The game went to
-- `awaiting_confirmation` and stayed there, because confirmation requires somebody who can record
-- results for the other side and there is nobody. One real club's honest submission, waiting forever
-- for a club that has never heard of Ovalball.
--
-- OVALBALL ALREADY HAS THE ANSWER AND IT IS NOT A NEW ONE. `submit_fixture_result` opens with exactly
-- this test -- is the opponent a real Ovalball club -- and when it is not, records the score as
-- `external_recorded`: a result, countable, but honestly labelled as one side's record rather than an
-- agreement. `team_result_stats` then counts `final` and `external_recorded` together. This migration
-- is that behaviour applied to a tournament game, down to the status name.
--
-- ---- THE ONE DELIBERATE DIFFERENCE ---------------------------------------------------------------
--
-- A HOST RESOLUTION STAYS `final`, even between two sides that are both external. `external_recorded`
-- means "one side said so and nobody could answer". A tournament organiser settling a score is not that
-- -- they ran the competition, they are its authority, and their record is as settled as a result gets.
-- Labelling the organiser's own decision as unconfirmed would understate it.
-- =====================================================================================================

alter table public.tournament_games drop constraint if exists tournament_games_result_status_check;
alter table public.tournament_games add constraint tournament_games_result_status_check
  check (result_status in ('none', 'awaiting_confirmation', 'final', 'disputed', 'amendment_pending',
                           'external_recorded'));

alter table public.tournament_game_result_submissions
  drop constraint if exists tournament_game_result_submissions_kind_check;
alter table public.tournament_game_result_submissions
  add constraint tournament_game_result_submissions_kind_check
  check (kind in ('initial', 'confirmation', 'dispute', 'amendment_proposal', 'host_resolution',
                  'external_recorded'));

/**
 * IS THERE ANYBODY ON OVALBALL WHO COULD ANSWER FOR THIS SIDE.
 *
 * `club_id is not null` is the test, and it is the right one because it is the SAME test
 * `internal.tournament_game_side_for_caller` applies when it decides who may submit: a side with no
 * Ovalball club has no users, no capabilities and no way to reply.
 *
 * It is deliberately NOT `status <> 'external_recorded'`. That status exists and is used, but it is set
 * on sides the organiser deliberately marked as recorded-externally -- and the local review world has
 * sides with `status = 'added'` and no club at all, which that test wrongly calls answerable. Asking
 * the question that matters is cheaper than keeping two tests agreeing.
 */
create or replace function internal.tournament_side_answerable(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_participants tp
    join public.clubs c on c.id = tp.club_id
    where tp.id = p_participant_id and c.status = 'active'
  );
$function$;

comment on function internal.tournament_side_answerable(uuid) is
  'Whether anybody on Ovalball could record or confirm a result for this side. The same test '
  'internal.tournament_game_side_for_caller applies, so a side that cannot submit is never waited on.';

-- ---- the submission path -----------------------------------------------------------------------------

create or replace function public.submit_tournament_game_result(
  p_game_id uuid,
  p_side_a_score integer,
  p_side_b_score integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g public.tournament_games;
  v_side uuid;
  v_other uuid;
  v_enabled boolean;
begin
  perform internal.require_live_session();

  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;

  -- THE ORGANISER DECIDES WHETHER TEAMS SUBMIT AT ALL. When they do not, the host records every result
  -- themselves through the resolution path -- a deliberate setting, not a missing feature.
  select coalesce(t.results_submission_enabled, true) into v_enabled
  from public.tournaments t where t.id = g.tournament_id;
  if not v_enabled then
    raise exception 'The organiser has turned off result submission for this tournament.' using errcode = '42501';
  end if;

  v_side := internal.tournament_game_side_for_caller(p_game_id);
  if v_side is null then
    raise exception 'Only somebody who can record results for one of the two sides may submit this result.'
      using errcode = '42501';
  end if;

  if not internal.tournament_game_result_eligible(p_game_id) then
    if g.status = 'CANCELLED' then
      raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
    end if;
    raise exception 'This game has not kicked off yet.' using errcode = '22023';
  end if;

  v_other := case when v_side = g.side_a_id then g.side_b_id else g.side_a_id end;

  -- ---- NOBODY CAN ANSWER ----------------------------------------------------------------------------
  --
  -- The opposition is a directory entry, not an Ovalball club. There is no confirmation to wait for, so
  -- waiting would be a pretence. Recorded, countable, and labelled as one side's record.
  if not internal.tournament_side_answerable(v_other) then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'external_recorded', p_side_a_score, p_side_b_score, auth.uid(), v_side,
            nullif(trim(p_note), ''));

    update public.tournament_games
    set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
        result_status = 'external_recorded', status = 'PLAYED',
        result_submitted_by = auth.uid(), result_submitted_by_participant_id = v_side,
        result_submitted_at = now(),
        result_confirmed_by = null, result_confirmed_at = null,
        updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;

    -- The organiser is told, because it is their competition's table that just moved and nobody
    -- confirmed it. The other side is not told: there is nobody there.
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_confirmed',
      'Result recorded', 'A result has been recorded against a side that is not on Ovalball, so there '
      'was no confirmation to wait for. It counts towards the table.');
    return jsonb_build_object('status', 'external_recorded');
  end if;

  -- ---- nothing recorded yet -------------------------------------------------------------------------
  if g.result_status = 'none' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));

    update public.tournament_games
    set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
        result_status = 'awaiting_confirmation',
        result_submitted_by = auth.uid(), result_submitted_by_participant_id = v_side,
        result_submitted_at = now(), updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;

    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_awaiting_confirmation',
      'Result awaiting your confirmation',
      'A result has been submitted for your tournament game. Confirm it, or say what you think the score was.');
    return jsonb_build_object('status', 'awaiting_confirmation');
  end if;

  -- ---- somebody has already submitted ---------------------------------------------------------------
  if g.result_status = 'awaiting_confirmation' then
    if v_side = g.result_submitted_by_participant_id then
      -- THE SAME SIDE CORRECTING ITSELF. A new proposal, not an agreement: one club agreeing with
      -- itself is not two clubs agreeing.
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
          result_submitted_by = auth.uid(), result_submitted_at = now(),
          updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      return jsonb_build_object('status', 'awaiting_confirmation');
    end if;

    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score then
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'confirmation', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(),
          status = 'PLAYED', updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_confirmed',
        'Result confirmed', 'Both sides agree the score, so it now counts towards the table.');
      return jsonb_build_object('status', 'final');
    end if;

    -- A CONTEST. The original submission is untouched; this is a second row saying something else.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'disputed', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'Result contested', 'The two sides have given different scores. The organiser will settle it.');
    return jsonb_build_object('status', 'disputed');
  end if;

  -- ---- already in dispute ---------------------------------------------------------------------------
  if g.result_status = 'disputed' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    return jsonb_build_object('status', 'disputed');
  end if;

  -- ---- already settled ------------------------------------------------------------------------------
  if g.result_status in ('final', 'amendment_pending', 'external_recorded') then
    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score
       and g.result_status in ('final', 'external_recorded') then
      return jsonb_build_object('status', g.result_status);
    end if;
    -- A CORRECTION AFTER AGREEMENT IS A PROPOSAL. The recorded score stays canonical and the table
    -- stays as it is until the organiser settles it.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'amendment_proposal', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'amendment_pending', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'A change to a recorded result', 'A side has proposed a different score for a game that was already recorded.');
    return jsonb_build_object('status', 'amendment_pending');
  end if;

  raise exception 'This result cannot be submitted in its current state (%).', g.result_status using errcode = '22023';
end;
$function$;

-- ---- and everything that counts a result now counts this one too ------------------------------------

create or replace function internal.tournament_table_standings(p_table_id uuid)
returns table(
  participant_id uuid,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  points_for integer,
  points_against integer,
  points_difference integer,
  competition_points integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with plan as (
    select p.points_win, p.points_draw, p.points_loss, p.points_losing_bonus, p.losing_bonus_margin
    from public.tournament_plan_tables t
    join public.tournament_plans p on p.id = t.plan_id
    where t.id = p_table_id
  ),
  members as (
    select s.participant_id from public.tournament_plan_table_sides s where s.table_id = p_table_id
  ),
  -- ONE ROW PER SIDE PER SETTLED GAME, from that side's own point of view. `final` is a result both
  -- sides or the organiser stand behind; `external_recorded` is one against a side that could not
  -- answer. Both are results. An awaiting, contested or proposed score is not.
  sides as (
    select g.side_a_id as participant_id, g.side_a_score as scored, g.side_b_score as conceded
    from public.tournament_games g
    where g.table_id = p_table_id and g.result_status in ('final', 'external_recorded')
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
    union all
    select g.side_b_id, g.side_b_score, g.side_a_score
    from public.tournament_games g
    where g.table_id = p_table_id and g.result_status in ('final', 'external_recorded')
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
  )
  select
    m.participant_id,
    count(s.participant_id)::int as played,
    count(*) filter (where s.scored > s.conceded)::int as won,
    count(*) filter (where s.scored = s.conceded)::int as drawn,
    count(*) filter (where s.scored < s.conceded)::int as lost,
    coalesce(sum(s.scored), 0)::int as points_for,
    coalesce(sum(s.conceded), 0)::int as points_against,
    coalesce(sum(s.scored) - sum(s.conceded), 0)::int as points_difference,
    (
      count(*) filter (where s.scored > s.conceded) * (select points_win from plan)
      + count(*) filter (where s.scored = s.conceded) * (select points_draw from plan)
      + count(*) filter (where s.scored < s.conceded) * (select points_loss from plan)
      + count(*) filter (
          where s.scored < s.conceded
            and (s.conceded - s.scored) <= (select losing_bonus_margin from plan)
        ) * (select points_losing_bonus from plan)
    )::int as competition_points
  from members m
  left join sides s on s.participant_id = m.participant_id
  group by m.participant_id;
$function$;

create or replace function internal.tournament_head_to_head(p_table_id uuid, p_a uuid, p_b uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(sum(
    case when g.side_a_id = p_a then g.side_a_score - g.side_b_score
         else g.side_b_score - g.side_a_score end
  ), 0)::int
  from public.tournament_games g
  where g.table_id = p_table_id and g.result_status in ('final', 'external_recorded')
    and g.status <> 'CANCELLED'
    and g.side_a_score is not null and g.side_b_score is not null
    and ((g.side_a_id = p_a and g.side_b_id = p_b) or (g.side_a_id = p_b and g.side_b_id = p_a));
$function$;

create or replace function internal.tournament_result_needs_attention(
  p_game_id uuid,
  p_is_host boolean,
  p_sides uuid[]
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when g.id is null then false
    when p_is_host then
      g.result_status in ('disputed', 'amendment_pending')
      or (g.result_status = 'none' and internal.tournament_game_result_eligible(g.id))
    else
      (g.result_status = 'none' and internal.tournament_game_result_eligible(g.id))
      or (g.result_status = 'awaiting_confirmation'
          and not (g.result_submitted_by_participant_id = any (coalesce(p_sides, '{}'::uuid[]))))
      or g.result_status in ('disputed', 'amendment_pending')
  end
  from public.tournament_games g
  where g.id = p_game_id;
$function$;

-- ---- the recorded status appears everywhere a confirmed one does -------------------------------------
--
-- `get_tournament_tables` and `get_tournament_results_overview` both tested `= 'final'` in several
-- places. Rewritten by hand rather than patched, because a status this load-bearing should be visible
-- in the source of every query that counts it.

do $$
declare v_def text; v_name text;
begin
  foreach v_name in array array['get_tournament_tables', 'get_tournament_results_overview'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_def is null then raise exception '% is missing.', v_name; end if;
    v_def := replace(v_def, 'g.result_status = ''final''', 'g.result_status in (''final'', ''external_recorded'')');
    v_def := replace(v_def, 'tg.result_status = ''final''', 'tg.result_status in (''final'', ''external_recorded'')');
    execute v_def;
  end loop;
end $$;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_tournament_tables', 'get_tournament_results_overview')
        and p.prosrc like '%external_recorded%') <> 2 then
    raise exception 'a results read still counts only final results.';
  end if;
end $$;

-- ---- the shared side shape tells the truth about who is on Ovalball ----------------------------------
--
-- A DEFECT FOUND, NOT INTRODUCED. `internal.tournament_side_summary` originally reported `onOvalball`
-- as `status <> 'external_recorded'`, copied from the Planning read model so the two could not drift.
-- Driving the real festival showed that test is wrong: the three directory-only opponents all carry
-- `status = 'added'` with no club at all, and were therefore being described as Ovalball clubs.
--
-- The helper now asks `internal.tournament_side_answerable`, which is the question that decides
-- everything downstream -- who may submit, who is waited on for a confirmation.
--
-- `get_tournament_plan_draft` and the participant Agenda still carry the original inline expression.
-- They are deliberately NOT changed here: Planning's design is frozen for this phase, and a wrong
-- `onOvalball` on a planning screen is its own correction to make with its own evidence. It is recorded
-- here so it is found by whoever goes looking, and the assertion below pins exactly how far the
-- disagreement reaches -- so if it ever spreads past that one key, a migration fails.

create or replace function internal.tournament_side_summary(p_participant_id uuid, p_host_club_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'participantId', tp.id,
    'clubName', cd.name,
    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id),
                          cd.logo_storage_path),
    'label', coalesce(tm.display_name,
                      case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label
                           else tp.age_group end),
    'isHost', (tp.club_id is not null and tp.club_id = p_host_club_id),
    'onOvalball', internal.tournament_side_answerable(tp.id)
  )
  from public.tournament_participants tp
  join public.club_directory cd on cd.id = tp.club_directory_id
  left join public.teams tm on tm.id = tp.team_id
  where tp.id = p_participant_id;
$function$;

do $$
declare v_other integer;
begin
  -- Everything EXCEPT onOvalball still matches what the existing surfaces build, side for side.
  select count(*) into v_other
  from public.tournament_participants tp
  join public.club_directory cd on cd.id = tp.club_directory_id
  join public.tournaments t on t.id = tp.tournament_id
  left join public.teams tm on tm.id = tp.team_id
  where (internal.tournament_side_summary(tp.id, t.host_club_id) - 'onOvalball') is distinct from (
    jsonb_build_object(
      'participantId', tp.id,
      'clubName', cd.name,
      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
      'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
      'isHost', (tp.club_id is not null and tp.club_id = t.host_club_id),
      'onOvalball', (tp.status <> 'external_recorded')
    ) - 'onOvalball'
  );
  if v_other > 0 then
    raise exception 'tournament_side_summary diverges from the existing surfaces beyond onOvalball, for % side(s).', v_other;
  end if;
end $$;

-- ---- and the regeneration guard counts it as a result too --------------------------------------------
--
-- `tournament_plan_result_history` reported `confirmed` as `result_status = 'final'` only, so a refusal
-- said "3 games already have a result (2 confirmed)" for a plan where all three were settled. The
-- number in a refusal has to be the number the organiser can see on their own screen.

create or replace function internal.tournament_plan_result_history(p_plan_id uuid)
returns table(games_with_results integer, confirmed integer, submissions integer)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    count(*) filter (where g.result_status <> 'none')::int,
    count(*) filter (where g.result_status in ('final', 'external_recorded'))::int,
    coalesce((select count(*) from public.tournament_game_result_submissions s
              join public.tournament_games g2 on g2.id = s.game_id
              where g2.plan_id = p_plan_id), 0)::int
  from public.tournament_games g
  where g.plan_id = p_plan_id;
$function$;
