-- =====================================================================================================
-- EVERY CALLER ASKS THE CANONICAL PROJECTION.
--
-- Twenty-eight database functions read `public.team_permissions` and one writes through its INSTEAD OF
-- trigger. `internal.team_role_assignments` (the previous migration) now carries that semantic
-- canonically and was proven row-for-row identical to the view before anything here ran. This moves
-- the callers onto it.
--
-- EVERY REWRITE IS ONE OF FIVE ENUMERATED SHAPES, applied literally rather than by pattern, so a shape
-- this migration has not seen is left alone and reported instead of being quietly mangled:
--
--   1. the relation            `public.team_permissions`  ->  `internal.team_role_assignments`
--   2. the staff predicate     `tp.permission in ('team_admin', 'coach', 'manager')`
--                              ->  `tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')`
--                              Equivalent by construction: the projection contains those three roles
--                              and no others. Kept explicit rather than deleted, because the predicate
--                              states what the caller means -- "this person is on the team's staff" --
--                              and a reader should not have to know the view's filter to see it.
--   3. the human label         the three-arm case expression  ->  `internal.team_role_label(role_key)`
--   4. the three-arm case with an `else` ->  `coalesce(internal.team_role_label(...), <else>)`
--   5. the client wire value   `'permission', tp.permission`
--                              ->  `'permission', internal.team_role_wire_value(tp.role_key)`
--
-- NOTHING ELSE IS TOUCHED. Every caller keeps its own joins -- to `club_memberships` for an active
-- membership, to `teams` for the club relationship -- exactly as it had them, because the view never
-- guaranteed either and the callers were already doing that work themselves. No cross-club guard, no
-- active-membership test and no safeguarding boundary moves.
--
-- AUTHORITY VERSUS READ MODEL. Fifteen of these ask "is this person on this team's staff" and act on
-- it; four describe a role to a person. Both legitimately read the projection -- staff membership is a
-- RELATIONSHIP, and the capability engine itself resolves team scope straight from
-- `role_assignments` (see `internal.capability_decision` rule 5). What must never happen is a role
-- LABEL deciding a capability, and `scripts/verify-slice10-retirement.mjs` now asserts that the two
-- label helpers never appear in a conditional.
-- =====================================================================================================

-- ---- the one WRITER goes through the canonical grant -------------------------------------------------
--
-- `internal.apply_planned_team` copies a source team's staff onto its successor during season handover,
-- and did it by INSERTING INTO THE COMPATIBILITY VIEW -- so a season handover ran through the Slice 2
-- INSTEAD OF trigger, which re-derives role keys from the legacy string and writes
-- `source = 'LEGACY_BACKFILL'` onto brand new assignments. New roles created in 2026 were being
-- recorded as a backfill of the old estate.
--
-- `internal.grant_role` is the canonical write, it already accepts `SEASON_HANDOVER` as a source, and
-- it carries every guard the direct insert skipped: the role must exist, the member must be active,
-- the account must be active, and a minor may not hold a staff role.

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'apply_planned_team';
  if v_def is null then raise exception 'internal.apply_planned_team is missing.'; end if;
  if v_def !~ 'insert into public\.team_permissions' then
    return; -- already canonical
  end if;

  v_def := replace(v_def,
    'insert into public.team_permissions (membership_id, team_id, permission, assigned_group_id, created_by)' || chr(10) ||
    '    select tp.membership_id, v_id, tp.permission, tp.assigned_group_id, p_actor' || chr(10) ||
    '    from public.team_permissions tp' || chr(10) ||
    '    where tp.team_id = pt.source_team_id;' || chr(10) ||
    '    get diagnostics v_staff = row_count;',
    'v_staff := 0;' || chr(10) ||
    '    for v_carry in' || chr(10) ||
    '      select tp.membership_id, tp.role_key, tp.assigned_group_id' || chr(10) ||
    '      from internal.team_role_assignments tp' || chr(10) ||
    '      where tp.team_id = pt.source_team_id' || chr(10) ||
    '    loop' || chr(10) ||
    '      -- THE CANONICAL GRANT, with the handover''s own source so the assignment records why it' || chr(10) ||
    '      -- exists. The role carried across is the role held, not a string round-tripped through the' || chr(10) ||
    '      -- Slice 2 vocabulary.' || chr(10) ||
    '      perform internal.grant_role(' || chr(10) ||
    '        v_carry.membership_id, v_carry.role_key, v_id, ''SEASON_HANDOVER'',' || chr(10) ||
    '        ''Carried across by the season handover from the previous age group'',' || chr(10) ||
    '        case when v_carry.assigned_group_id is not null' || chr(10) ||
    '             then jsonb_build_object(''assigned_group_id'', v_carry.assigned_group_id)' || chr(10) ||
    '             else ''{}''::jsonb end);' || chr(10) ||
    '      v_staff := v_staff + 1;' || chr(10) ||
    '    end loop;');

  if v_def ~ 'insert into public\.team_permissions' then
    raise exception 'apply_planned_team still writes through the compatibility view -- the handover copy was not rewritten.';
  end if;

  -- The loop variable the rewrite introduces.
  v_def := replace(v_def, chr(10) || 'declare', chr(10) || 'declare' || chr(10) || '  v_carry record;');
  execute v_def;
end $$;


do $$
declare
  v_proc record;
  v_def text;
  v_before text;
  v_moved int := 0;
begin
  for v_proc in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.proname <> 'legacy_team_permission_write'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '\yteam_permissions\y'
    order by n.nspname, p.proname
  loop
    -- The INSTEAD OF trigger function IS the compatibility surface and stays until the view is dropped.
    v_def := pg_get_functiondef(v_proc.oid);
    v_before := v_def;

    -- 3/4. The human label, before the bare column is rewritten under it.
    v_def := replace(v_def,
      'case tp.permission' || chr(10) ||
      '      when ''team_admin'' then ''Team Admin''' || chr(10) ||
      '      when ''coach'' then ''Coach''' || chr(10) ||
      '      when ''manager'' then ''Manager''' || chr(10) ||
      '      else ''Parent or player access''' || chr(10) ||
      '    end',
      'coalesce(internal.team_role_label(tp.role_key), ''Parent or player access'')');
    v_def := replace(v_def,
      'case tp.permission when ''team_admin'' then ''Team Admin'' when ''coach'' then ''Coach'' when ''manager'' then ''Manager'' end',
      'internal.team_role_label(tp.role_key)');

    -- 5. The client wire value.
    v_def := replace(v_def, '''permission'', tp.permission', '''permission'', internal.team_role_wire_value(tp.role_key)');

    -- 2. The staff predicate.
    v_def := replace(v_def,
      'tp.permission in (''team_admin'', ''coach'', ''manager'')',
      'tp.role_key in (''TEAM_ADMINISTRATION'', ''TEAM_MANAGER'', ''COACH'')');

    -- 1. The relation itself, last, so the shapes above matched their original text.
    v_def := replace(v_def, 'public.team_permissions', 'internal.team_role_assignments');

    if v_def = v_before then continue; end if;

    if v_def ~ '\yteam_permissions\y' or v_def ~ '\.permission\y' then
      raise exception
        '%.% still reaches the compatibility view, or reads its legacy string, in a shape this migration does not know. Migrate it by hand rather than leaving a partial rewrite.',
        v_proc.nspname, v_proc.proname;
    end if;

    execute v_def;
    v_moved := v_moved + 1;
  end loop;

  raise notice 'moved % function(s) onto internal.team_role_assignments.', v_moved;
end $$;

-- ---- and nothing production reads or writes the compatibility view any more --------------------------

do $$
declare v_list text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into v_list
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.proname <> 'legacy_team_permission_write'
    and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '\yteam_permissions\y';
  if v_list is not null then
    raise exception 'these function(s) still reach public.team_permissions: %', v_list;
  end if;
end $$;
