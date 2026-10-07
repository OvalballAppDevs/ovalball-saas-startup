-- =====================================================================================================
-- A CLAIM IS ATTRIBUTED TO A CLUB.
--
-- The result history named whoever submitted a score by their TEAM'S display name -- "Under 12 Boys".
-- Both sides of a U12 game are called Under 12 Boys, so a contest between two clubs read as two
-- identical claims by the same side. Seen on the Simulator, on a real confirmation screen: the
-- submission said "Under 12 Boys 24 - 17" and gave the reader no way to tell which club had said it.
--
-- ATTRIBUTION IS THE WHOLE POINT OF THE TRAIL. An organiser settling a disagreement is deciding between
-- two clubs, so the trail names the CLUB and carries the team as context -- the same way every other
-- Ovalball surface identifies a side.
-- =====================================================================================================

do $$
declare v_name text; v_def text; v_old text; v_new text; v_changed boolean;
begin
  foreach v_name in array array['get_tournament_results_overview', 'get_tournament_game_result'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_def is null then raise exception '% is missing.', v_name; end if;

    v_old := 'coalesce(tm.display_name, cd.name)';
    v_new := 'cd.name';
    v_changed := position(v_old in v_def) > 0;
    if v_changed then
      v_def := replace(v_def, v_old, v_new);
    end if;

    -- The team travels WITH the club rather than instead of it, so "Preston Grasshoppers RFC" and
    -- "Preston Grasshoppers RFC, Under 12 Girls" are both sayable where a club brought two sides.
    if position('''bySideTeam''' in v_def) = 0 then
      v_def := replace(v_def,
        '''bySideName'', (select cd.name',
        '''bySideTeam'', (select tm.display_name' || chr(10) ||
        '                       from public.tournament_participants tp' || chr(10) ||
        '                       left join public.teams tm on tm.id = tp.team_id' || chr(10) ||
        '                       where tp.id = ' ||
        case when v_name = 'get_tournament_game_result' then 's.submitted_by_participant_id' else 'tg.result_submitted_by_participant_id' end ||
        '),' || chr(10) ||
        '    ''bySideName'', (select cd.name');
    end if;

    execute v_def;
  end loop;
end $$;

do $$
declare v_name text; v_src text;
begin
  foreach v_name in array array['get_tournament_results_overview', 'get_tournament_game_result'] loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_src like '%coalesce(tm.display_name, cd.name)%' then
      raise exception '% still attributes a claim to a team name rather than to a club.', v_name;
    end if;
  end loop;
end $$;
