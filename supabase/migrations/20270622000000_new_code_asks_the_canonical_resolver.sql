-- =====================================================================================================
-- NEW CODE ASKS THE CANONICAL RESOLVER.
--
-- `internal.has_capability` is a Slice 2 COMPATIBILITY ADAPTER, not an authority. It translates a legacy
-- key through `capability_key_map` and then calls the real thing --
--
--     site  -> internal.has_site_capability(key)
--     club  -> internal.can(key, 'club', club, null, null)
--     team  -> internal.can(key, 'team', club, team, null)
--
-- -- and Slice 10 drops it. The retirement ratchet
-- (`scripts/verify-slice10-retirement.mjs`) counts every reference precisely so that new work cannot
-- quietly add to the estate that has to be migrated later, and it caught three functions written
-- during the training and tournament programmes doing exactly that.
--
-- SO THEY ARE MIGRATED RATHER THAN BLESSED. Each call is replaced by the canonical call the adapter
-- would itself have made, with the canonical key the map resolves to:
--
--     club.training.manage  ->  training.plan.manage
--     team.attendance.view  ->  team.attendance.view   (same key; the adapter was pure indirection)
--
-- NOTHING ABOUT WHO MAY DO WHAT CHANGES. The resolver is the same resolver, the scope is the scope the
-- map already evaluated at, and the three functions are otherwise untouched -- this removes a layer,
-- it does not move a boundary. `capability_override_ceilings`, `capability_precedence_truth_table` and
-- `team_scheduling_availability` are the suites that would notice if it did.
-- =====================================================================================================

do $$
declare
  v_def text;
  v_proc record;
  v_before int;
  v_after int;
begin
  for v_proc in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.proname in (
        'save_training_plan',
        'generate_training_plan_sessions',
        'notify_team_staff',
        'get_tournament_participant_centre')
  loop
    v_def := pg_get_functiondef(v_proc.oid);
    v_before := (length(v_def) - length(replace(v_def, 'has_capability(', ''))) / length('has_capability(');
    if v_before = 0 then continue; end if;

    -- The club-scoped training key, whose canonical name differs.
    v_def := replace(v_def,
      'internal.has_capability(''club.training.manage'', ''club'', p_club_id, null)',
      'internal.can(''training.plan.manage'', ''club'', p_club_id, null, null)');

    -- The attendance key, which the map resolves to itself: the adapter was pure indirection.
    v_def := replace(v_def,
      'internal.has_capability(''team.attendance.view'', ''team'', tp.club_id, tp.team_id)',
      'internal.can(''team.attendance.view'', ''team'', tp.club_id, tp.team_id, null)');
    v_def := replace(v_def,
      'internal.has_capability(''team.attendance.view'', ''club'', tp.club_id, null)',
      'internal.can(''team.attendance.view'', ''club'', tp.club_id, null, null)');

    v_after := (length(v_def) - length(replace(v_def, 'has_capability(', ''))) / length('has_capability(');
    -- `has_site_capability` legitimately contains the substring, so a residue is only a failure when a
    -- genuine adapter call survives. Checked by name rather than by count for that reason.
    if v_def ~ 'internal\.has_capability\(' then
      raise exception
        'internal.%.% still calls the compatibility adapter after rewriting -- its call does not match any known shape, so it must be migrated by hand rather than silently left.',
        v_proc.nspname, v_proc.proname;
    end if;
    if v_after >= v_before and v_before > 0 and v_def !~ 'internal\.can\(' then
      raise exception 'rewriting %.% changed nothing.', v_proc.nspname, v_proc.proname;
    end if;

    execute v_def;
    raise notice 'migrated %.% off internal.has_capability.', v_proc.nspname, v_proc.proname;
  end loop;
end $$;

-- ---- and it stays migrated ---------------------------------------------------------------------------
--
-- A guard rather than a comment: if a later edit reinstates the adapter in one of these, the
-- migration chain says so the next time it is applied from empty.

do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.proname in (
      'save_training_plan',
      'generate_training_plan_sessions',
      'notify_team_staff',
      'get_tournament_participant_centre')
    and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'internal\.has_capability\(';
  if v_n > 0 then
    raise exception '% of the migrated functions still reach the Slice 10 compatibility adapter.', v_n;
  end if;
end $$;
