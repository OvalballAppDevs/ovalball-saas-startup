-- =====================================================================================================
-- A PROPOSED CHANGE DOES NOT ERASE AN AGREED RESULT.
--
-- `tournament_table_standings` counted `final` and `external_recorded`. A side proposing a change to an
-- already-agreed score moves the game to `amendment_pending` -- and the result then vanished from the
-- table entirely, until the organiser got round to ruling on it.
--
-- THAT IS A WAY FOR ONE CLUB TO UNILATERALLY REMOVE A RESULT. Not by overwriting it -- the lifecycle
-- correctly refuses that -- but by proposing anything at all. The agreed 24-17 stays on the game, both
-- clubs still stand behind it, and yet the table would have shown two sides on nought.
--
-- Found by a permanent test asserting the behaviour this file's own predecessor claimed in its comments
-- ("the standings keep using the confirmed one until somebody settles it"). The comment was right and
-- the code did something else.
--
-- ---- ONE AUTHORITY FOR WHAT COUNTS ---------------------------------------------------------------
--
-- The rule was written out in four places -- the standings, the head-to-head, Recent Results and the
-- confirmed count -- which is how three of them come to disagree. It is now one function, and it says
-- what it means: A RESULT COUNTS WHEN THE SCORE ON THE GAME IS ONE SOMEBODY HAS SETTLED.
--
--   final                both sides agreed it, or the organiser ruled.
--   external_recorded    one side recorded it and the opposition is not on Ovalball to answer.
--   amendment_pending    it WAS agreed, and the agreed score is still the score on the game. A
--                        proposal to change it is outstanding work, not an erasure.
--
-- and it does not count when nobody has settled it:
--
--   none                 nothing recorded.
--   awaiting_confirmation  one side's claim, unanswered.
--   disputed             two claims that disagree -- there is no score to count.
-- =====================================================================================================

create or replace function internal.tournament_result_counts(p_status text)
returns boolean
language sql
immutable
as $function$
  select p_status in ('final', 'external_recorded', 'amendment_pending');
$function$;

comment on function internal.tournament_result_counts(text) is
  'Whether a tournament game''s result counts towards a table. The ONE definition, so the standings, '
  'the head-to-head, Recent Results and the confirmed count cannot disagree. amendment_pending counts '
  'because the agreed score is still the score on the game: proposing a change is outstanding work, '
  'not a way for one club to remove a result.';

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
  sides as (
    select g.side_a_id as participant_id, g.side_a_score as scored, g.side_b_score as conceded
    from public.tournament_games g
    where g.table_id = p_table_id and internal.tournament_result_counts(g.result_status)
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
    union all
    select g.side_b_id, g.side_b_score, g.side_a_score
    from public.tournament_games g
    where g.table_id = p_table_id and internal.tournament_result_counts(g.result_status)
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
  )
  select
    m.participant_id,
    count(s.participant_id)::int,
    count(*) filter (where s.scored > s.conceded)::int,
    count(*) filter (where s.scored = s.conceded)::int,
    count(*) filter (where s.scored < s.conceded)::int,
    coalesce(sum(s.scored), 0)::int,
    coalesce(sum(s.conceded), 0)::int,
    coalesce(sum(s.scored) - sum(s.conceded), 0)::int,
    (
      count(*) filter (where s.scored > s.conceded) * (select points_win from plan)
      + count(*) filter (where s.scored = s.conceded) * (select points_draw from plan)
      + count(*) filter (where s.scored < s.conceded) * (select points_loss from plan)
      + count(*) filter (
          where s.scored < s.conceded
            and (s.conceded - s.scored) <= (select losing_bonus_margin from plan)
        ) * (select points_losing_bonus from plan)
    )::int
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
  where g.table_id = p_table_id and internal.tournament_result_counts(g.result_status)
    and g.status <> 'CANCELLED'
    and g.side_a_score is not null and g.side_b_score is not null
    and ((g.side_a_id = p_a and g.side_b_id = p_b) or (g.side_a_id = p_b and g.side_b_id = p_a));
$function$;

-- ---- and the two reads ask the same authority ---------------------------------------------------

do $$
declare v_name text; v_def text;
begin
  foreach v_name in array array['get_tournament_tables', 'get_tournament_results_overview'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_def is null then raise exception '% is missing.', v_name; end if;
    -- THE LONGER ALIAS FIRST. `tg.` contains `g.`, so replacing the short one first leaves a stray
    -- "t" in front of the new call and the function no longer compiles -- which is exactly what
    -- happened, and what the assertion below now catches.
    v_def := replace(v_def, 'tg.result_status in (''final'', ''external_recorded'')',
                            'internal.tournament_result_counts(tg.result_status)');
    v_def := replace(v_def, 'g.result_status in (''final'', ''external_recorded'')',
                            'internal.tournament_result_counts(g.result_status)');
    execute v_def;
  end loop;
end $$;

do $$
declare v_name text; v_src text;
begin
  foreach v_name in array array['get_tournament_tables', 'get_tournament_results_overview'] loop
    select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_src not like '%tournament_result_counts%' then
      raise exception '% does not ask the one authority for what counts towards a table.', v_name;
    end if;
    if v_src like '%''final'', ''external_recorded''%' then
      raise exception '% still carries its own copy of the counting rule.', v_name;
    end if;
    -- AND IT STILL COMPILES. A textual rewrite that produces valid-looking SQL which does not parse
    -- fails at CALL time, not at migration time, so the parse is forced here.
    if v_src like '%tinternal.%' then
      raise exception '% was rewritten into an invalid reference.', v_name;
    end if;
  end loop;

  foreach v_name in array array['tournament_table_standings', 'tournament_head_to_head'] loop
    select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = v_name;
    if v_src not like '%tournament_result_counts%' then
      raise exception 'internal.% does not ask the one authority for what counts towards a table.', v_name;
    end if;
  end loop;
end $$;
