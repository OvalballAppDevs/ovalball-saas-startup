-- =====================================================================================================
-- SLICE 4I (2/3) — ROLLOVER, GRADUATION, HANDOVER AND TEAM LIFECYCLE
--
-- Design J.5 lines 420-429 and the U boundary, under AA.3 row 4i. Eleven function bodies -- every
-- remaining is_club_admin caller the programme ledger assigns to this slice -- move onto the keys J.5
-- records, and the site branch beside each becomes that key's recorded master rather than a role.
--
-- THE U BOUNDARY IS THE ONE THAT CHANGES SOMETHING. Section U excludes team.handover.apply from the
-- Fixtures Secretary bundle, "prepare only", and J.5 line 427 makes apply a CA-only, non-delegable,
-- reason-bearing key while line 426 gives prepare to CA and FS. Nothing enforced that split: every one
-- of these RPCs asked internal.is_club_admin, so the Secretary was excluded from ALL of them -- and the
-- preparation half, which J.5 says is theirs, was excluded with it. Preparing is now the Secretary's,
-- and applying is still not.
-- =====================================================================================================

do $$
declare
  -- function, canonical key, site master
  v_map constant text[][] := array[
    -- J.5 line 422: fold, graduate and reactivate a team are team.lifecycle.manage, CA only.
    ['fold_team',                          'team.lifecycle.manage', 'site.clubs.lifecycle'],
    ['graduate_team',                      'team.lifecycle.manage', 'site.clubs.lifecycle'],
    ['reactivate_team',                    'team.lifecycle.manage', 'site.clubs.lifecycle'],
    -- J.5 line 426: preparing a handover is CA AND FS. Section U: only preparing.
    ['plan_missing_placement_team',        'team.handover.prepare', 'site.support.act_in_club'],
    ['unplan_handover_team',               'team.handover.prepare', 'site.support.act_in_club'],
    ['decide_rollover_team_proposal',      'team.handover.prepare', 'site.support.act_in_club'],
    -- J.5 line 427: applying it is CA alone.
    ['apply_season_handover',              'team.handover.apply',   'site.support.act_in_club'],
    -- J.5 line 421: creating or reactivating a team AT A CLUB is that club's team.team.manage. These
    -- four act on the OPPONENT's club, which is exactly why the club id must carry the authority.
    ['create_missing_target_team',         'team.team.manage',      'site.team_roles.manage'],
    ['create_missing_tournament_team',     'team.team.manage',      'site.team_roles.manage'],
    ['reactivate_missing_target_team',     'team.team.manage',      'site.team_roles.manage'],
    ['reactivate_missing_tournament_team', 'team.team.manage',      'site.team_roles.manage']
  ];
  r record; v_new text; i int; v_touched int := 0;
begin
  for i in 1 .. array_length(v_map, 1) loop
    for r in
      select p.oid, n.nspname, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','internal') and p.proname = v_map[i][1]
    loop
      v_new := r.def;
      -- The club id each one already computed stays exactly as it was; only the question changes.
      v_new := regexp_replace(v_new, 'internal\.is_club_admin\(([a-zA-Z0-9_\.]+)\)',
                 'internal.can(''' || v_map[i][2] || ''', ''club'', \1, null, null)', 'g');
      v_new := replace(v_new, 'internal.is_full_site_admin()',
                 'internal.has_site_capability(''' || v_map[i][3] || ''')');
      v_new := replace(v_new, 'internal.is_site_admin()',
                 'internal.has_site_capability(''' || v_map[i][3] || ''')');
      if v_new <> r.def then
        execute v_new;
        v_touched := v_touched + 1;
      end if;
    end loop;
  end loop;
  raise notice 'Slice 4I: % rollover, graduation, handover and lifecycle gates canonicalised', v_touched;
end $$;

do $$
declare v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('fold_team','graduate_team','reactivate_team','plan_missing_placement_team',
                      'unplan_handover_team','decide_rollover_team_proposal','apply_season_handover',
                      'create_missing_target_team','create_missing_tournament_team',
                      'reactivate_missing_target_team','reactivate_missing_tournament_team')
    and p.prosrc ~ '\m(is_club_admin|is_site_admin|is_full_site_admin)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4I gate still decides authority by a raw role helper: %', array_to_string(v_bad, ', ');
  end if;

  -- Section U, structurally: applying a handover asks the apply key and preparing asks the prepare
  -- key, and they are not the same key. A single function asking both would be the split undone.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_season_handover') !~ 'team\.handover\.apply' then
    raise exception 'U: applying a season handover does not ask team.handover.apply.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_season_handover') ~ 'team\.handover\.prepare' then
    raise exception 'U: applying a season handover also accepts the prepare key, which undoes the split.';
  end if;
  -- And the Fixtures Secretary must actually hold prepare and not hold apply, or the split says nothing.
  if not exists (select 1 from public.bundle_capabilities where capability_key = 'team.handover.prepare' and bundle_key = 'FS') then
    raise exception 'U: the Fixtures Secretary does not hold team.handover.prepare.';
  end if;
  if exists (select 1 from public.bundle_capabilities where capability_key = 'team.handover.apply' and bundle_key = 'FS') then
    raise exception 'U: the Fixtures Secretary holds team.handover.apply, which section U excludes.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. The two decisions inside a handover that are NOT preparation.
--
-- internal.decide_rollover_team_proposal serves five actions. Confirm, adjust and defer are ordinary
-- preparation and belong to the Fixtures Secretary as well as the Club Admin. Fold and graduate are
-- not: folding retires a side and graduating archives a cohort and moves every player in it to the
-- club's holding list. J.5 line 422 keeps both at team.lifecycle.manage, and public.fold_team and
-- public.graduate_team already ask exactly that.
--
-- The function carries those two decisions behind their OWN inner gates, precisely so the handover
-- route could not be used to reach them -- the source says so in as many words. Section 2 above maps
-- one key per function, so it flattened both of them onto the preparation key and handed the
-- Fixtures Secretary a cohort graduation. supabase/tests/union_u18_free_agent.sql caught it.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_src text; v_new text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal';
  if v_src is null then raise exception 'internal.decide_rollover_team_proposal is missing.'; end if;

  v_new := replace(v_src,
    'internal.can(''team.handover.prepare'', ''club'', v_team.club_id, null, null) or internal.has_site_capability(''site.support.act_in_club'')',
    'internal.can(''team.lifecycle.manage'', ''club'', v_team.club_id, null, null) or internal.has_site_capability(''site.clubs.lifecycle'')');

  if v_new <> v_src then
    execute format(
      'create or replace function internal.decide_rollover_team_proposal(p_proposal_id uuid, p_action text, p_age_group text, p_squad_designation text, p_fold_reason text, p_gender text, p_decided_by uuid) returns void language plpgsql security definer set search_path to %L as %s',
      'public', quote_literal(v_new));
    raise notice 'Slice 4I: the fold and graduate decisions inside a handover restored to team.lifecycle.manage';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal';
  if v_src ~ 'team\.handover\.prepare' then
    raise exception 'a fold or graduate decision inside a handover can still be reached with the preparation key.';
  end if;
  if (select count(*) from regexp_matches(v_src, 'team\.lifecycle\.manage', 'g')) <> 2 then
    raise exception 'expected exactly two team.lifecycle.manage gates (fold and graduate) in decide_rollover_team_proposal.';
  end if;
end $$;
