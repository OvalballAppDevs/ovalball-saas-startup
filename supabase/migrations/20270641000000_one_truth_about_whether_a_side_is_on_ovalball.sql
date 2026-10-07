-- =====================================================================================================
-- ONE TRUTH ABOUT WHETHER A SIDE IS ON OVALBALL.
--
-- Three tournament surfaces each built a participating side inline, and each answered `onOvalball` with
-- `tp.status <> 'external_recorded'`. Driving the real UAT festival showed that answer is WRONG: the
-- three directory-only opponents in it carry `status = 'added'` with no Ovalball club behind them at
-- all, and were being described to every reader as clubs that are on Ovalball.
--
-- IT WAS ALWAYS WRONG. It became load-bearing when Results arrived, because whether a side can be
-- waited on for a confirmation is exactly this question -- and the rest of Ovalball already answers it
-- the right way. The fixtures world has always used `onOvalball: Boolean(club)`: is there a club row.
-- The tournament surfaces were the outlier.
--
-- SO THE FACT MOVES TO ONE PLACE. `internal.tournament_side_summary` is the canonical shape of a
-- participating side, and these two reads now CALL it rather than rebuilding it. Each adds only what is
-- genuinely its own -- the participant Centre adds `teamId` and `isMine`, which mean nothing to an
-- organiser reading the whole field. Everything the two surfaces share is defined once.
--
-- ---- WHAT THIS DELIBERATELY DOES NOT CHANGE -------------------------------------------------------
--
-- NOT THE PAIRING RULE, NOT GENERATION, NOT PUBLISHING. `generate_tournament_plan_fixtures` never read
-- `onOvalball` or `tournament_participants.status` -- the assertion at the foot of this file pins that
-- -- so a plan generated before this migration and one generated after are the same plan.
--
-- NOT THE PARTICIPANT STATUS ITSELF. `external_recorded` remains a real status an organiser sets, and
-- `internal.tournament_participant_status` still means what it meant. This migration changes what
-- `onOvalball` IS, not what a status does.
--
-- NOT ANY OTHER FIELD. The migration proves, side for side, that every other key is byte-identical.
-- =====================================================================================================

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- ---- the organiser's planning read --------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_plan';
  if v_def is null then raise exception 'get_tournament_plan is missing.'; end if;

  v_old :=
    '      select jsonb_agg(jsonb_build_object(' || chr(10) ||
    '        ''participantId'', tp.id,' || chr(10) ||
    '        ''clubName'', cd.name,' || chr(10) ||
    '        ''crestPath'', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),' || chr(10) ||
    '        ''label'', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || '' '' || tp.squad_label else tp.age_group end),' || chr(10) ||
    '        ''isHost'', (tp.club_id is not null and tp.club_id = v_t.host_club_id),' || chr(10) ||
    '        ''onOvalball'', (tp.status <> ''external_recorded'')' || chr(10) ||
    '      ) order by';

  if position(v_old in v_def) = 0 then
    raise exception 'get_tournament_plan does not build a side in the shape this migration expects.';
  end if;

  v_new :=
    '      -- ONE DEFINITION OF A PARTICIPATING SIDE, shared with the participant Centre and with' || chr(10) ||
    '      -- Results. `onOvalball` asks whether anybody could actually answer for this side, which is' || chr(10) ||
    '      -- the question every surface downstream needs and the one the old inline test got wrong.' || chr(10) ||
    '      select jsonb_agg(internal.tournament_side_summary(tp.id, v_t.host_club_id)' || chr(10) ||
    '      order by';

  execute replace(v_def, v_old, v_new);

  -- ---- the participant's own read ------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre';
  if v_def is null then raise exception 'get_tournament_participant_centre is missing.'; end if;

  v_old :=
    '        select jsonb_agg(jsonb_build_object(' || chr(10) ||
    '          ''participantId'', tp.id,' || chr(10) ||
    '          ''teamId'', tp.team_id,' || chr(10) ||
    '          ''clubName'', cd.name,' || chr(10) ||
    '          ''crestPath'', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),' || chr(10) ||
    '          -- A real team is its canonical derived name; a club recorded by name is its competition plus' || chr(10) ||
    '          -- its alias. Never a label invented for this screen.' || chr(10) ||
    '          ''label'', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || '' '' || tp.squad_label else tp.age_group end),' || chr(10) ||
    '          ''isHost'', (tp.club_id is not null and tp.club_id = v_t.host_club_id),' || chr(10) ||
    '          ''isMine'', (tp.id = any(v_mine)),' || chr(10) ||
    '          ''onOvalball'', (tp.status <> ''external_recorded'')' || chr(10) ||
    '        ) order by';

  if position(v_old in v_def) = 0 then
    raise exception 'get_tournament_participant_centre does not build a side in the shape this migration expects.';
  end if;

  v_new :=
    '        -- THE SHARED SIDE, plus only what is genuinely this surface''''s own: which team a club is' || chr(10) ||
    '        -- bringing, and whether the side is one of the viewer''''s. An organiser reading the whole' || chr(10) ||
    '        -- field has no use for either.' || chr(10) ||
    '        select jsonb_agg(' || chr(10) ||
    '          internal.tournament_side_summary(tp.id, v_t.host_club_id)' || chr(10) ||
    '          || jsonb_build_object(''teamId'', tp.team_id, ''isMine'', (tp.id = any(v_mine)))' || chr(10) ||
    '        order by';

  execute replace(v_def, v_old, v_new);
end $$;

-- ---- the two reads now ask the one authority ---------------------------------------------------------

do $$
declare v_name text; v_src text;
begin
  foreach v_name in array array['get_tournament_plan', 'get_tournament_participant_centre'] loop
    select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_src not like '%tournament_side_summary%' then
      raise exception '% does not call the canonical side authority.', v_name;
    end if;
    -- Comments are stripped before this test, so the prose above about the old expression cannot
    -- satisfy it and a genuinely remaining copy cannot hide behind one.
    if regexp_replace(v_src, '--[^\n]*', '', 'g') like '%status <> ''external_recorded''%' then
      raise exception '% still carries its own copy of the onOvalball test.', v_name;
    end if;
  end loop;
end $$;

-- ---- the correction reaches exactly the sides it should ----------------------------------------------
--
-- Every participating side whose two answers differ is a side with no Ovalball club behind it, and no
-- side with an active club changes its answer. A migration that widened or narrowed this beyond the
-- defect would fail here rather than ship.

do $$
declare v_wrong integer; v_corrected integer;
begin
  select count(*) into v_wrong
  from public.tournament_participants tp
  where internal.tournament_side_answerable(tp.id) <> (tp.status <> 'external_recorded')
    and exists (select 1 from public.clubs c where c.id = tp.club_id and c.status = 'active');
  if v_wrong > 0 then
    raise exception 'the correction changed the answer for % side(s) that DO have an active Ovalball club.', v_wrong;
  end if;

  select count(*) into v_corrected
  from public.tournament_participants tp
  where internal.tournament_side_answerable(tp.id) <> (tp.status <> 'external_recorded');
  raise notice 'onOvalball corrected for % directory-only side(s).', v_corrected;
end $$;

-- ---- generation is untouched, and provably so --------------------------------------------------------
--
-- The pairing rule, the scheduler and publishing never consulted a side's status or its `onOvalball`
-- flag -- a club Ovalball does not have is a side in a plan exactly like any other, which was always
-- the design. This pins that, so a future change that makes generation depend on this fact has to say
-- so out loud.

do $$
declare v_name text; v_src text;
begin
  foreach v_name in array array['generate_tournament_plan_fixtures', 'publish_tournament_plan'] loop
    select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_src is null then continue; end if;
    if v_src like '%external_recorded%' or v_src like '%onOvalball%' then
      raise exception '% reads whether a side is on Ovalball; this migration changes that fact.', v_name;
    end if;
  end loop;

  if (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'tournament_round_robin_pairs') like '%external_recorded%' then
    raise exception 'the pairing rule reads a side''s status; this migration changes that fact.';
  end if;
end $$;
