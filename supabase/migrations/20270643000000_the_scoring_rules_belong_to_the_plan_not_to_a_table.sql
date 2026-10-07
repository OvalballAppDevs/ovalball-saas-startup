-- =====================================================================================================
-- THE SCORING RULES BELONG TO THE PLAN, NOT TO A TABLE.
--
-- The previous migration inserted `scoringRules`, `losingBonusMargin` and `tieBreakers` into
-- `get_tournament_plan` by anchoring on `'sides', coalesce((`. That string appears TWICE: once at the
-- top level for the competition's sides, and once inside the per-table object for the sides in that
-- table. `replace()` replaces every occurrence, so the three keys landed in both places -- and every
-- table in the payload claimed its own scoring system.
--
-- They are a property of the PLAN. One competition has one set of scoring rules and one tie-break
-- order, and Table A and Table B are ordered by the same ones. A table carrying its own copy is an
-- invitation to make them differ.
--
-- Found by reading the payload back on the local review database after the migration ran, which is the
-- only thing that would have found it: the migration's own assertion checked that `scoringRules`
-- appeared in the function, and it did -- twice.
-- =====================================================================================================

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_plan';
  if v_def is null then raise exception 'get_tournament_plan is missing.'; end if;

  -- The nested copy, identified by the per-table keys that can only appear inside the table object.
  v_old :=
    '          ''id'', t.id, ''name'', t.name, ''sortOrder'', t.sort_order,' || chr(10) ||
    '          -- WHICH SCORING RULES CAN ACTUALLY BE APPLIED, and why not where they cannot. Planning draws' || chr(10) ||
    '    -- its controls from this rather than deciding on the device.' || chr(10) ||
    '    ''scoringRules'', case when v_plan.id is not null then internal.tournament_scoring_rules(v_plan.id) end,' || chr(10) ||
    '    ''losingBonusMargin'', v_plan.losing_bonus_margin,' || chr(10) ||
    '    ''tieBreakers'', to_jsonb(v_plan.tie_breakers),' || chr(10) ||
    '    ''sides'', coalesce((select jsonb_agg(s.participant_id order by s.position)';

  if position(v_old in v_def) = 0 then
    -- Already correct, or shaped differently: say so rather than silently doing nothing.
    if position('''sortOrder'', t.sort_order,' || chr(10) || '          ''sides''' in v_def) > 0 then
      return;
    end if;
    raise exception 'get_tournament_plan does not carry the misplaced keys in the shape this migration expects.';
  end if;

  v_new :=
    '          ''id'', t.id, ''name'', t.name, ''sortOrder'', t.sort_order,' || chr(10) ||
    '          ''sides'', coalesce((select jsonb_agg(s.participant_id order by s.position)';

  execute replace(v_def, v_old, v_new);
end $$;

-- ---- exactly one copy, at the top -------------------------------------------------------------------

do $$
declare v_src text; v_n integer;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_plan';

  v_n := (length(v_src) - length(replace(v_src, '''scoringRules''', ''))) / length('''scoringRules''');
  if v_n <> 1 then
    raise exception 'get_tournament_plan carries % copies of scoringRules; a competition has one scoring system.', v_n;
  end if;

  v_n := (length(v_src) - length(replace(v_src, '''tieBreakers''', ''))) / length('''tieBreakers''');
  if v_n <> 1 then
    raise exception 'get_tournament_plan carries % copies of tieBreakers; a competition has one tie-break order.', v_n;
  end if;

  v_n := (length(v_src) - length(replace(v_src, '''losingBonusMargin''', ''))) / length('''losingBonusMargin''');
  if v_n <> 1 then
    raise exception 'get_tournament_plan carries % copies of losingBonusMargin.', v_n;
  end if;
end $$;
