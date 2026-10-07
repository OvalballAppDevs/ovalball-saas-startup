-- =====================================================================================================
-- A SIDE CAN REACH ITS OWN RESULTS.
--
-- `get_tournament_results_overview` has always returned a participating club its OWN games -- that was
-- the point of resolving entitlement on the server rather than in a client. But the only screen that
-- called it was the organiser's, so a visiting coach had no way to reach the game they needed to record
-- a score for. The read was right and the route was missing.
--
-- THE TAB IS THE SAME TAB, not a second one built for clubs. That is the whole reason the entitlement
-- lives in the read: one component, one payload shape, and the server decides whether it holds every
-- game in the competition or only this club's three.
--
-- BUT IT IS NOT SHOWN TO EVERYBODY, because most people in a participant's Tournament Centre are
-- parents and players. They have the Agenda, which is what a published programme looks like to
-- somebody going to it; a Results tab that could only ever say "nothing for you" is a worse screen
-- than no tab. So the read now states, per competition, whether this viewer can record a result for a
-- side in it -- using the same `fixture.result.record` test the submit path itself enforces, so a tab
-- can never appear for somebody the write would refuse.
-- =====================================================================================================

do $$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre';
  if v_def is null then raise exception 'get_tournament_participant_centre is missing.'; end if;
  if position('canRecordResults' in v_def) > 0 then return; end if;

  v_old := '      ''ageGroup'', grade,';
  if position(v_old in v_def) = 0 then
    raise exception 'the participant centre does not name its competition where this migration expects.';
  end if;

  execute replace(v_def, v_old,
    v_old || chr(10) ||
    '      -- CAN THIS VIEWER RECORD A RESULT for one of this competition''''s sides. The same' || chr(10) ||
    '      -- capability the submit path enforces, so a Results tab can never appear for somebody the' || chr(10) ||
    '      -- write would refuse -- and a parent is never shown an action list that is empty by design.' || chr(10) ||
    '      ''canRecordResults'', exists (' || chr(10) ||
    '        select 1 from public.tournament_participants rp' || chr(10) ||
    '        where rp.tournament_id = p_tournament_id and rp.age_group = grade' || chr(10) ||
    '          and rp.club_id is not null' || chr(10) ||
    '          and (internal.can(''fixture.result.record'', ''club'', rp.club_id, null, null)' || chr(10) ||
    '               or (rp.team_id is not null' || chr(10) ||
    '                   and internal.can(''fixture.result.record'', ''team'', rp.club_id, rp.team_id, null)))' || chr(10) ||
    '      ),');
end $$;

do $$
begin
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre') not like '%canRecordResults%' then
    raise exception 'the participant centre does not say whether the viewer can record a result.';
  end if;
end $$;
