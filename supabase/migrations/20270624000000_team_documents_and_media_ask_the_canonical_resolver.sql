-- =====================================================================================================
-- TEAM DOCUMENTS AND MEDIA ASK THE CANONICAL RESOLVER.
--
-- Eleven functions shipped by the team documents, team media and team description work reach
-- `internal.has_capability` -- the Slice 2 compatibility adapter that Slice 10 drops. The retirement
-- ratchet counted the rise (62 -> 73) and it is right to: these are new dependencies on something
-- scheduled to go, and the arithmetic closes exactly on them.
--
-- THE ADAPTER IS INLINED, NOT ASSUMED AWAY. It does three things, and all three are preserved:
--
--   1. It maps a legacy key through `capability_key_map`. Of the keys these eleven use, only
--      `site.team_catalogue.manage` is in the map, and it maps to itself -- so every key below is the
--      canonical key already, and the mapping was pure indirection.
--   2. It refuses a TEAM-scoped question whose team does not belong to the named club. That guard is
--      carried over EXPLICITLY as an `exists` over `public.teams`, rather than left to
--      `internal.capability_decision` on the assumption it does the same thing. An assumption is not
--      a guard, and this is an authority boundary.
--   3. It refuses a club-scoped question with no club, which the explicit `is not null` preserves.
--
-- Each replacement is a literal, enumerated call shape -- not a pattern over call sites -- so a shape
-- this migration has not seen is left alone and reported rather than silently rewritten.
--
-- NOBODY GAINS OR LOSES ACCESS. `capability_attack_matrix`, `capability_scope_isolation`,
-- `capability_precedence_truth_table`, `permission_matrix`, `cross_club_isolation_matrix`,
-- `team_documents`, `team_media` and `team_description_authority` are the suites that would say so.
-- =====================================================================================================

do $$
declare
  v_proc record;
  v_def text;
  v_shape text;
  v_shapes text[] := array[
    -- club scope
    '''club.profile.edit'', ''club'', v_club_id, null',
    '''club.profile.edit'', ''club'', v_doc.club_id, null',
    '''club.profile.edit'', ''club'', v_owner_id, null',
    -- team scope
    '''team.roster.view'', ''team'', v_club_id, p_team_id',
    '''team.roster.view'', ''team'', v_club_id, v_team_id',
    '''team.roster.view'', ''team'', v_owner_id, v_team_id',
    '''team.team.manage'', ''team'', v_club_id, p_team_id',
    '''team.team.manage'', ''team'', v_club_id, v_team_id',
    '''team.team.manage'', ''team'', v_doc.club_id, v_doc.team_id',
    '''team.team.manage'', ''team'', v_owner_id, v_team_id',
    '''team.team.view'', ''team'', v_club, p_team_id'
  ];
  v_key text;
  v_scope text;
  v_club text;
  v_team text;
  v_parts text[];
  v_rewritten int := 0;
begin
  -- EVERY KEY THESE USE MUST BE CANONICAL ALREADY, or the literal rewrite below would silently change
  -- which capability is asked for. Checked against the map rather than believed.
  if exists (
    select 1 from public.capability_key_map m
    where m.legacy_key in ('club.profile.edit', 'team.roster.view', 'team.team.manage', 'team.team.view')
      and m.capability_key <> m.legacy_key
  ) then
    raise exception
      'one of these legacy keys now maps to a different canonical key -- the inlining below would ask the wrong question and must be rewritten by hand.';
  end if;

  for v_proc in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.proname in (
        'can_access_document_storage_path', 'may_access_team_gallery_media', 'add_team_document',
        'add_team_media', 'delete_club_document', 'read_team_documents', 'read_team_media',
        'remove_team_media', 'set_team_cover', 'set_team_description', 'team_people_counts')
  loop
    v_def := pg_get_functiondef(v_proc.oid);
    if v_def !~ 'internal\.has_capability\(' then continue; end if;

    -- The site-scoped call is the adapter's own site branch, word for word.
    v_def := replace(v_def,
      'internal.has_capability(''site.team_catalogue.manage'', ''site'')',
      'internal.has_site_capability(''site.team_catalogue.manage'')');

    foreach v_shape in array v_shapes loop
      v_parts := string_to_array(v_shape, ', ');
      v_key := v_parts[1];
      v_scope := trim(both '''' from v_parts[2]);
      v_club := v_parts[3];
      v_team := v_parts[4];
      if v_scope = 'club' then
        v_def := replace(v_def,
          'internal.has_capability(' || v_shape || ')',
          '(' || v_club || ' is not null and internal.can(' || v_key || ', ''club'', ' || v_club || ', null, null))');
      else
        -- THE ADAPTER'S OWN TEAM/CLUB GUARD, carried over rather than assumed.
        v_def := replace(v_def,
          'internal.has_capability(' || v_shape || ')',
          '(exists (select 1 from public.teams t_guard where t_guard.id = ' || v_team ||
          ' and t_guard.club_id = ' || v_club || ')' ||
          ' and internal.can(' || v_key || ', ''team'', ' || v_club || ', ' || v_team || ', null))');
      end if;
    end loop;

    if v_def ~ 'internal\.has_capability\(' then
      raise exception
        '%.% still calls the compatibility adapter in a shape this migration does not know. It must be migrated by hand rather than left behind a partial rewrite.',
        v_proc.nspname, v_proc.proname;
    end if;

    execute v_def;
    v_rewritten := v_rewritten + 1;
  end loop;

  raise notice 'migrated % function(s) off internal.has_capability.', v_rewritten;
end $$;

-- ---- and the dependency does not come back ----------------------------------------------------------

do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.proname in (
      'can_access_document_storage_path', 'may_access_team_gallery_media', 'add_team_document',
      'add_team_media', 'delete_club_document', 'read_team_documents', 'read_team_media',
      'remove_team_media', 'set_team_cover', 'set_team_description', 'team_people_counts',
      'save_training_plan', 'get_tournament_participant_centre')
    and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'internal\.has_capability\(';
  if v_n > 0 then
    raise exception '% migrated function(s) still reach the Slice 10 compatibility adapter.', v_n;
  end if;
end $$;
