-- =====================================================================================================
-- A PARTICIPANT READS THE SAME SHAPE THE ORGANISER BUILT.
--
-- The organiser arranges a round robin as TABLE -> ROUND -> GAMES. The participant Agenda showed the
-- games and nothing else: a flat list of kick-offs with no sign of which table a side is in, who else
-- is in it, or which round a game belongs to. For a round robin that is the missing half of the
-- programme -- "we play Wigan at ten" matters less to a parent than "we are in Table A with Wigan,
-- Blackburn and Clitheroe, and this is Round 2 of 3".
--
-- SO THE PROJECTION CARRIES WHAT THE PLAN ALREADY KNOWS. Two columns that already exist on
-- `tournament_games` -- `table_id` and `round_number` -- plus the table's name, and the DAYS THE
-- COMPETITION ACTUALLY PLAYS from its published plan.
--
-- THE DAYS MATTER BECAUSE TWO SURFACES DISAGREED. The Calendar narrows a published competition to its
-- own days and says "Day 2 of 2" for the Sunday of a Friday-to-Sunday festival that skips the
-- Saturday; the Agenda counted the TOURNAMENT'S days and called the same date "Day 3". Both were
-- defensible in isolation and together they were simply wrong, because they are two readings of one
-- fact. The plan's days are the fact.
--
-- NOTHING NEW BECOMES VISIBLE. The same games, under the same publication rule -- a draft still reaches
-- nobody. This adds structure to what was already being shown, and the privacy reduction above it
-- (`unsure`/`cannotAttend`/`awaiting` only for the viewer's own side) is untouched.
-- =====================================================================================================

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre';
  if v_def is null then raise exception 'the participant centre read is missing.'; end if;

  if position('''tableName''' in v_def) = 0 then
    -- THE GAME GAINS ITS PLACE IN THE COMPETITION. Anchored on the pitch line, which appears exactly
    -- once, so the rewrite cannot land in the wrong projection.
    v_def := replace(v_def,
      '''pitchName'', cp.display_name,' || chr(10) || '          ''status'', g.status,',
      '''pitchName'', cp.display_name,' || chr(10) ||
      '          ''status'', g.status,' || chr(10) ||
      '          -- WHERE THIS GAME SITS IN THE COMPETITION. Null for a game somebody added by hand,' || chr(10) ||
      '          -- which belongs to no table and no round and must not be given one.' || chr(10) ||
      '          ''tableName'', pt.name,' || chr(10) ||
      '          ''round'', g.round_number,');
    if position('''tableName''' in v_def) = 0 then
      raise exception 'the participant games projection is not the shape this migration expects.';
    end if;

    v_def := replace(v_def,
      'left join public.club_pitches cp on cp.id = g.pitch_id',
      'left join public.club_pitches cp on cp.id = g.pitch_id' || chr(10) ||
      '        left join public.tournament_plan_tables pt on pt.id = g.table_id');

    -- THE ORDER IS THE COMPETITION'S OWN: a day, then its tables, then the rounds inside them.
    v_def := replace(v_def,
      ') order by g.game_date, g.start_time nulls last, g.sort_order)',
      ') order by g.game_date, pt.sort_order nulls first, g.round_number nulls first, g.start_time nulls last, g.sort_order)');
  end if;

  if position('''competitionDays''' in v_def) = 0 then
    -- THE DAYS THIS COMPETITION PLAYS, from its published plan. Absent until something is published,
    -- and the client then falls back to the tournament's own span exactly as it did before.
    v_def := replace(v_def,
      '      ''games'', coalesce((',
      '      ''competitionDays'', coalesce((' || chr(10) ||
      '        select jsonb_agg(d.day_date order by d.day_date)' || chr(10) ||
      '        from public.tournament_plan_days d' || chr(10) ||
      '        join public.tournament_plans pl on pl.id = d.plan_id' || chr(10) ||
      '        where pl.tournament_id = p_tournament_id and pl.age_group = grade' || chr(10) ||
      '          and pl.publication_state = ''PUBLISHED''), ''[]''::jsonb),' || chr(10) ||
      '      ''games'', coalesce((');
    if position('''competitionDays''' in v_def) = 0 then
      raise exception 'the participant context projection is not the shape this migration expects.';
    end if;
  end if;

  execute v_def;
end $$;

-- ---- and a draft still reaches nobody ---------------------------------------------------------------

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre')
     not like '%publication_state = ''PUBLISHED''%' then
    raise exception 'a draft plan would reach the participant Agenda.';
  end if;
end $$;
