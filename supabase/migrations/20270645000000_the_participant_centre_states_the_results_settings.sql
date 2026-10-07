-- =====================================================================================================
-- THE PARTICIPANT CENTRE STATES THE RESULTS SETTINGS.
--
-- A club whose Results tab offers no Submit control deserves to know why. The two settings are the
-- tournament's own facts, so they travel with it rather than being inferred from a control that is not
-- there -- which is how "I can't submit" becomes "the app is broken" instead of "the organiser records
-- the scores".
-- =====================================================================================================

do $$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre';
  if v_def is null then raise exception 'get_tournament_participant_centre is missing.'; end if;
  if position('resultsSubmissionEnabled' in v_def) > 0 then return; end if;

  v_old := '    ''visibility'', v_t.visibility,';
  if position(v_old in v_def) = 0 then
    raise exception 'the participant centre does not carry visibility where this migration expects.';
  end if;

  execute replace(v_def, v_old,
    v_old || chr(10) ||
    '    -- HOW RESULTS ARE RUN, which is NOT the tournament''''s own visibility: a club may list a' || chr(10) ||
    '    -- festival publicly and still keep its scores inside it.' || chr(10) ||
    '    ''resultsSubmissionEnabled'', v_t.results_submission_enabled,' || chr(10) ||
    '    ''resultsVisibility'', v_t.results_visibility,');
end $$;

do $$
begin
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_tournament_participant_centre') not like '%resultsSubmissionEnabled%' then
    raise exception 'the participant centre does not state how results are run.';
  end if;
end $$;
