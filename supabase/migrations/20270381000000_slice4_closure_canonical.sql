-- =====================================================================================================
-- SLICE 4 FINAL CLOSURE -- the three residual items the closure audit named
--
-- The audit found exactly three things Phase 2 still assigns to Slice 4 that no sub-slice had done.
-- None was a live authority hole; all three were unfinished retirements. This closes them and nothing
-- else. It deliberately does NOT touch Slice 5 invitation/redemption, Slice 6 authentication, or
-- Slice 7's remaining site-admin retirement.
--
--   1. public.player_team_dispensation_select  -- 4G's, still deciding by two fixtures/team role helpers
--   2. eight tournament functions              -- 4D's, still deciding by the fixtures role helper
--   3. internal.can_manage_player              -- 4A's, a zero-caller helper Phase 2 lists as removed
--
-- Every mapping below is taken from a Phase 2 table, not invented here:
--   J.7  471-473  fixture.dispensation.request / .approve_team / .approve_club
--   J.8  489-490  tournament.tournament.view / .manage
--   J.9  498      calendar.event.manage (the team-scope key 4D already uses for a club's own entry)
--   J.12 548      safeguarding.dispensation.view
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. The dispensation read (AA.3 row 4g)
--
-- The policy carried FIVE branches, three of them canonical already and two not: internal.can_manage_team
-- on each of the source and target teams, and internal.can_manage_club_fixtures on the source club. Both
-- are role-string helpers, and the second is the last can_manage_club_fixtures POLICY anywhere in
-- Ovalball. Slice 4C assigned dispensations to 4G by name; 4G migrated the safeguarding appointment and
-- visibility surfaces and left this one.
--
-- Who may read a dispensation is who may act on one. J.7 lines 471-473 give that to
-- fixture.dispensation.request (CO, TM; CA, FS) and fixture.dispensation.approve_team (TM, TA). The
-- Safeguarding Officer's own branch and the site branch are untouched, so 4G's separation-of-duties
-- model is preserved exactly: reading is not approving, and the approver still may not be the requester.
-- -----------------------------------------------------------------------------------------------------

-- Hoisted, and shaped deliberately like internal.safeguarding_dispensation_team_ids() beside it: the
-- candidate teams come from the person's own ACTIVE memberships, never from a scan of every team.
-- A per-row internal.can(...) in a policy is an N+1 the planner cannot inline.
create or replace function internal.dispensation_team_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct t.id), '{}'::uuid[])
  from public.club_memberships cm
  join public.teams t on t.club_id = cm.club_id
  where cm.user_id = auth.uid() and cm.state = 'ACTIVE'
    and (internal.can('fixture.dispensation.request', 'club', cm.club_id, null, null)
         or internal.can('fixture.dispensation.request', 'team', cm.club_id, t.id, null)
         or internal.can('fixture.dispensation.approve_team', 'team', cm.club_id, t.id, null));
$$;

grant execute on function internal.dispensation_team_ids() to authenticated;

drop policy if exists player_team_dispensation_select on public.player_team_dispensation;
create policy player_team_dispensation_select on public.player_team_dispensation
  for select to authenticated using (
    -- J.12 line 548: the Safeguarding Officer's own view. 4G's, untouched.
    source_team_id in (select unnest(internal.safeguarding_dispensation_team_ids()))
    or (select internal.has_site_capability('site.support.view_club'))
    -- J.7 lines 471-472: the people who may request or approve it, on either side of the move.
    or source_team_id in (select unnest(internal.dispensation_team_ids()))
    or target_team_id in (select unnest(internal.dispensation_team_ids()))
  );

-- -----------------------------------------------------------------------------------------------------
-- 2. The eight tournament functions (AA.3 row 4d)
--
-- Slice 4C named these as 4D's. 4D built the canonical model -- internal.can_manage_tournament for the
-- occasion and internal.can_manage_tournament_entry for a club's own entry -- and production-verified
-- the distinctions, but these eight were never routed through it.
--
-- The distinctions are preserved exactly:
--   * the HOST alone invites, reconciles and removes participants -- organiser authority never invents
--     another club's consent, so those three keep asking about host_club_id and nothing else;
--   * the INVITED club or team alone responds -- and keeps asking about the participant's own ids;
--   * a Team Manager controls their own entry and not the whole occasion, through calendar.event.manage
--     at TEAM scope, which is the mechanism internal.can_manage_tournament_entry already uses;
--   * tournament.tournament.manage has no team bundle at all (J.8 line 490), which the 4D matrix
--     asserts as CM-A and this pass does not weaken.
-- -----------------------------------------------------------------------------------------------------
do $$
declare
  -- function, old-gate replacement pairs are uniform, so the site master is the only per-function choice.
  -- Reads take site.fixtures.view (J.8 line 489's master for tournament.tournament.view); writes and the
  -- invited side's own decision take site.support.act_in_club (line 490's master), which is narrower.
  v_reads  constant text[] := array['tournament_visible_row', 'get_tournament_centre'];
  v_writes constant text[] := array['check_tournament_participant_target','invite_tournament_participant',
                                    'reconcile_tournament_participant','remove_tournament_participant',
                                    'respond_tournament_invitation'];
  r record; v_def text; v_new text; v_master text; v_touched int := 0; v_bad text[] := '{}';
begin
  for r in
    select n.nspname as sch, p.proname as fn, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
             ('internal','tournament_visible_row'), ('public','get_tournament_centre'),
             ('public','check_tournament_participant_target'), ('public','invite_tournament_participant'),
             ('public','reconcile_tournament_participant'), ('public','remove_tournament_participant'),
             ('public','respond_tournament_invitation'))
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def !~ '\minternal\.(can_manage_club_fixtures|can_manage_team|is_site_admin)\(' then
      continue;  -- already canonical; this migration is re-runnable
    end if;
    v_master := case when r.fn = any (v_reads) then 'site.fixtures.view' else 'site.support.act_in_club' end;

    v_new := v_def;
    -- A club-scoped tournament question, whoever the club is: the host's own occasion, or an invited
    -- club acting for itself. The ARGUMENT is never rewritten, so who is being asked about is unchanged.
    v_new := regexp_replace(v_new, 'internal\.can_manage_club_fixtures\(([^()]*(\([^()]*\))?[^()]*)\)',
               'internal.can(''tournament.tournament.manage'', ''club'', \1, null, null)', 'g');
    -- A team-scoped one: the invited team answering for itself. calendar.event.manage at TEAM is the
    -- key internal.can_manage_tournament_entry already uses for exactly this.
    v_new := regexp_replace(v_new, 'internal\.can_manage_team\(tp\.team_id\)',
               'internal.can(''calendar.event.manage'', ''team'', tp.club_id, tp.team_id, null)', 'g');
    v_new := regexp_replace(v_new, 'internal\.can_manage_team\(v_p\.team_id\)',
               'internal.can(''calendar.event.manage'', ''team'', v_p.club_id, v_p.team_id, null)', 'g');
    -- A tournament may be hosted by a single TEAM rather than a whole club -- a U12 side running its
    -- own festival. Same key, same team scope: the side that hosts it runs it.
    v_new := regexp_replace(v_new, 'internal\.can_manage_team\(v_t\.host_team_id\)',
               'internal.can(''calendar.event.manage'', ''team'', v_t.host_club_id, v_t.host_team_id, null)', 'g');
    v_new := replace(v_new, 'internal.is_site_admin()',
               'internal.has_site_capability(' || quote_literal(v_master) || ')');

    if v_new <> v_def then execute v_new; v_touched := v_touched + 1; end if;
  end loop;

  -- update_fixture_competition is a FIXTURE edit, not a tournament act: it sets which competition a
  -- club's own fixture belongs to. J.7's fixture.fixture.edit at club scope, with the fixtures site
  -- master, which is what 4C's internal.can_edit_fixture_details asks for the same question.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_fixture_competition';
  if v_def ~ '\minternal\.(can_manage_club_fixtures|is_site_admin)\(' then
    v_new := regexp_replace(v_def, 'internal\.can_manage_club_fixtures\(([^()]*)\)',
               'internal.can(''fixture.fixture.edit'', ''club'', \1, null, null)', 'g');
    v_new := replace(v_new, 'internal.is_site_admin()', 'internal.has_site_capability(''site.fixtures.support'')');
    execute v_new;
    v_touched := v_touched + 1;
  end if;

  raise notice 'Slice 4 closure: % tournament and competition gates canonicalised', v_touched;

  -- Assertions.
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (
           ('internal','tournament_visible_row'), ('public','get_tournament_centre'),
           ('public','check_tournament_participant_target'), ('public','invite_tournament_participant'),
           ('public','reconcile_tournament_participant'), ('public','remove_tournament_participant'),
           ('public','respond_tournament_invitation'), ('public','update_fixture_competition'))
     and p.prosrc ~ '\minternal\.(can_manage_club_fixtures|can_manage_team|is_site_admin|is_club_admin|is_full_site_admin)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'Slice 4 closure: a tournament gate still asks a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- The consent boundary, structurally. Inviting, reconciling and removing must name the HOST club and
  -- must not reach for the participant's own club; responding must name the participant's and not the
  -- host's. A single one of these getting it backwards is a club's consent being invented for it.
  for r in select unnest(array['invite_tournament_participant','reconcile_tournament_participant',
                               'remove_tournament_participant']) as fn
  loop
    if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.fn) !~ 'host_club_id' then
      raise exception 'Slice 4 closure: public.% no longer gates on the host club.', r.fn;
    end if;
  end loop;
  -- The GATE, not the whole body: respond_tournament_invitation also notifies the host's administrators
  -- once an answer is given, which is correct and names host_club_id for an entirely different reason.
  -- What must never happen is the host appearing in the authority decision.
  declare v_gate text;
  begin
    select substring(p.prosrc from 'if not \((.*?)then' ) into v_gate
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'respond_tournament_invitation';
    if v_gate is null then
      raise exception 'Slice 4 closure: could not find the authority gate in respond_tournament_invitation.';
    end if;
    if v_gate ~ 'host' then
      raise exception 'Slice 4 closure: responding to a tournament invitation now consults the HOST club.';
    end if;
    if v_gate !~ 'v_p\.club_id' or v_gate !~ 'v_p\.team_id' then
      raise exception 'Slice 4 closure: responding no longer asks about the invited club and team.';
    end if;
  end;

  -- J.8 line 490, unweakened: the occasion has no team bundle.
  if exists (select 1 from public.bundle_capabilities
              where capability_key = 'tournament.tournament.manage' and scope_type = 'team') then
    raise exception 'Slice 4 closure: tournament.tournament.manage gained a team bundle.';
  end if;
end $$;

-- -----------------------------------------------------------------------------------------------------
-- 3. internal.can_manage_player, retired (AA.3 row 4a)
--
-- Phase 2 lists this helper as legacy removed by 4a. Its call sites all went in 4a; the body stayed.
-- It has no callers, no policies and no dependent objects, and it is a hazard precisely because it is
-- a second way to answer "may this person act on this child" -- CLAUDE.md already has to warn people
-- off it. It is dropped rather than replaced: a compatibility shim would only move the hazard.
-- -----------------------------------------------------------------------------------------------------
do $$
declare v_callers text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname <> 'can_manage_player' and p.prosrc ~ '\mcan_manage_player\(';
  if cardinality(v_callers) > 0 then
    raise exception 'Slice 4 closure: internal.can_manage_player still has callers: %', array_to_string(v_callers, ', ');
  end if;
  if exists (select 1 from pg_policies where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '\mcan_manage_player\(') then
    raise exception 'Slice 4 closure: a policy still asks internal.can_manage_player.';
  end if;
end $$;

drop function if exists internal.can_manage_player(uuid);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'internal' and p.proname = 'can_manage_player') then
    raise exception 'Slice 4 closure: internal.can_manage_player is still defined.';
  end if;
  -- And nothing was quietly put in its place.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'internal' and p.proname ~ '^can_manage_player') then
    raise exception 'Slice 4 closure: a replacement can_manage_player* helper appeared.';
  end if;
end $$;
