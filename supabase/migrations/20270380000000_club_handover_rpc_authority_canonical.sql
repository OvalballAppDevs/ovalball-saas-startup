-- =====================================================================================================
-- SLICE 4I -- the handover, placement and partnership RPCs (AA.3 row 4i)
--
-- Slice 4C migrated the 13 policies and 15 bodies of internal.can_manage_club_fixtures that BELONG to
-- fixtures, and said in as many words that the rest belong to the slices that own the meaning of the
-- call site: "A helper is retired by the slice that owns the meaning of the call site, not by
-- whichever slice's grep happens to match it first." It named 4I as the owner of documents, partners
-- and handover.
--
-- These are those call sites. Eighteen functions across the season handover, graduation placement and
-- club partnerships still decided authority by asking a FIXTURES helper -- which resolves to
-- "CLUB_ADMIN or FIXTURE_SECRETARY by membership role string" -- with a bare internal.is_site_admin()
-- beside it. Three consequences, all real:
--
--   1. Section U was unenforceable through them. The same undivided question answered "may I look at
--      this handover?" and "may I decide it?".
--   2. Placing a graduating child into next season's side asked a fixtures authority. J.5 line 429
--      makes that team.graduation.place, which the Coach and the Team Manager hold and the fixtures
--      helper never gave them.
--   3. Inviting another club onto Ovalball asked a fixtures authority, when J.4 line 409 makes it
--      club.partners.manage -- the same boundary the partnership table itself uses. The people are
--      the same either way; the question being asked was not.
--
-- Each function's key is the one its own table's policy already asks, so the RPC and the row-level
-- rule now answer the same question rather than two different ones.
-- =====================================================================================================

do $$
declare
  -- function, capability key, site master
  v_map constant text[][] := array[
    -- Reading a handover plan. J.5 line 426: preparing it is the Club Admin's and the Fixtures
    -- Secretary's, and reading it is part of preparing it. Matches age_grade_rollovers_select.
    ['handover_apply_blockers',              'team.handover.prepare', 'site.support.view_club'],
    ['handover_audit',                       'team.handover.prepare', 'site.support.view_club'],
    ['handover_consequences',                'team.handover.prepare', 'site.support.view_club'],
    ['handover_team_labels',                 'team.handover.prepare', 'site.support.view_club'],
    ['rollover_placement_options',           'team.handover.prepare', 'site.support.view_club'],
    -- Preparing one.
    ['generate_rollover_proposal',           'team.handover.prepare', 'site.support.act_in_club'],
    ['generate_rollover_player_proposals',   'team.handover.prepare', 'site.support.act_in_club'],
    ['confirm_rollover_team_proposal',       'team.handover.prepare', 'site.support.act_in_club'],
    ['confirm_mixed_boundary_rollover',      'team.handover.prepare', 'site.support.act_in_club'],
    ['undo_rollover_team_decision',          'team.handover.prepare', 'site.support.act_in_club'],
    ['resolve_rollover_group_flag',          'team.handover.prepare', 'site.support.act_in_club'],
    -- Placing a graduating child. J.5 gives team.graduation.place the site master
    -- site.team_roles.manage, not the support key -- placing a child into a side is a team-roles act.
    -- public.place_graduating_player already asks this key.
    ['set_rollover_player_placement',        'team.graduation.place', 'site.team_roles.manage'],
    ['set_rollover_player_planned_placement','team.graduation.place', 'site.team_roles.manage'],
    ['clear_rollover_player_placement',      'team.graduation.place', 'site.team_roles.manage'],
    ['mark_graduating_player_left',          'team.graduation.place', 'site.team_roles.manage'],
    -- Partnerships. J.4 line 409. Matches club_partnerships_select_scoped and _insert_scoped.
    ['respond_to_club_partnership',          'club.partners.manage',  'site.clubs.profile.manage'],
    ['revoke_club_partnership',              'club.partners.manage',  'site.clubs.profile.manage'],
    -- Inviting a club that is not yet on Ovalball. J.4 line 409: this is club.partners.manage, the
    -- same boundary club_partnerships uses and the same two people the fixtures helper named, so it
    -- is a rename. It is NOT club.referrals.manage: the referral LEDGER is Club-Admin-only, and
    -- claim_club_referral keeps that separately.
    --
    -- This one writes no literal internal.is_site_admin(), but it HAS a site branch: the fixtures
    -- helper it called opens with internal.is_site_admin() itself. Leaving the site master off here
    -- would quietly take this away from Ovalball, so it gets the master J.4 line 409 gives the key --
    -- the same one its two sibling partnership RPCs get.
    ['create_partner_invitation',            'club.partners.manage',  'site.clubs.profile.manage']
  ];
  v_def text; v_new text; i int; v_touched int := 0; v_bad text[] := '{}'; v_had_site boolean;
begin
  for i in 1 .. array_length(v_map, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_map[i][1];
    if v_def is null then
      raise exception 'Slice 4I: public.% is missing, so this migration''s list is stale.', v_map[i][1];
    end if;

    -- Already canonical: this migration is re-runnable, and the mutation harness re-runs it. A body
    -- with no legacy helper but the WRONG key is not "already done" -- it is something else, so it is
    -- repointed rather than skipped.
    if v_def !~ '\minternal\.can_manage_club_fixtures\(' and v_def !~ '\minternal\.is_site_admin\(' then
      if position(v_map[i][2] in v_def) > 0 then
        continue;
      end if;
      v_new := regexp_replace(v_def, 'internal\.can\(''[a-z_.]+''', 'internal.can(' || quote_literal(v_map[i][2]), 'g');
      if v_new <> v_def then
        execute v_new;
        v_touched := v_touched + 1;
      end if;
      continue;
    end if;

    -- Every one of these functions calls the legacy helpers ONLY in its authority gate; that was
    -- counted before this was written. A uniform replacement is therefore safe, and the assertions
    -- below refuse to let it pass if a later edit makes it untrue.
    v_new := regexp_replace(v_def, 'internal\.can_manage_club_fixtures\(([^()]*(\([^()]*\))?[^()]*)\)',
                            'internal.can(' || quote_literal(v_map[i][2]) || ', ''club'', \1, null, null)', 'g');
    -- A body with no literal internal.is_site_admin() may still HAVE a site branch, because
    -- internal.can_manage_club_fixtures opens with one. So the map decides whether a site master
    -- belongs, and where the literal is absent the branch is added rather than silently dropped --
    -- dropping it would narrow Ovalball's own access without anyone deciding to.
    v_had_site := v_def ~ '\minternal\.is_site_admin\(';
    if v_map[i][3] <> '' then
      if v_had_site then
        v_new := replace(v_new, 'internal.is_site_admin()',
                                'internal.has_site_capability(' || quote_literal(v_map[i][3]) || ')');
      else
        -- No literal to swap, so the branch is added by wrapping the canonical call it now makes.
        v_new := regexp_replace(v_new,
          'internal\.can\((''[a-z_.]+'', ''club'', [^;]*?, null, null)\)',
          '(internal.has_site_capability(' || quote_literal(v_map[i][3]) || ') or internal.can(\1))',
          '');
      end if;
    elsif v_had_site then
      raise exception 'Slice 4I: public.% has a site branch the map does not account for.', v_map[i][1];
    end if;

    if v_new <> v_def then
      execute v_new;
      v_touched := v_touched + 1;
    end if;
  end loop;

  raise notice 'Slice 4I: % handover, placement and partnership gates canonicalised', v_touched;

  -- Assertions. Not one of the eighteen may still decide by a fixtures role string or a bare
  -- site-admin test, and each must actually name the key its own table's policy asks.
  for i in 1 .. array_length(v_map, 1) loop
    select p.prosrc into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_map[i][1];
    if v_def ~ '\m(can_manage_club_fixtures|is_site_admin|is_full_site_admin|is_club_admin)\(' then
      v_bad := v_bad || (v_map[i][1] || ' still asks a legacy helper');
    end if;
    if position(v_map[i][2] in v_def) = 0 then
      v_bad := v_bad || (v_map[i][1] || ' does not ask ' || v_map[i][2]);
    end if;
    if v_map[i][3] <> '' and position(v_map[i][3] in v_def) = 0 then
      v_bad := v_bad || (v_map[i][1] || ' does not name its site master ' || v_map[i][3]);
    end if;
    if v_map[i][3] = '' and v_def ~ 'has_site_capability\(' then
      v_bad := v_bad || (v_map[i][1] || ' gained a site branch it never had');
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'Slice 4I: %', array_to_string(v_bad, '; ');
  end if;

  -- Section U survives this migration: reading and preparing a handover is the Secretary's, and
  -- applying it is still not, in the one function that applies it.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_season_handover') ~ 'team\.handover\.prepare' then
    raise exception 'U: applying a season handover now accepts the preparation key.';
  end if;
  -- And the two decisions inside a handover that are not preparation keep their own gate, even though
  -- the wrapper in front of them has just moved onto the preparation key.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal') !~ 'team\.lifecycle\.manage' then
    raise exception 'folding and graduating through a handover lost their lifecycle gate.';
  end if;
end $$;
