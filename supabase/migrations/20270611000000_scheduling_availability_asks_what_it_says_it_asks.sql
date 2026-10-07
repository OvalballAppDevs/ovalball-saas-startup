-- =====================================================================================================
-- SCHEDULING AVAILABILITY ASKS THE QUESTION IT SAYS IT ASKS.
--
-- `public.team_scheduling_availability` was written (20270552) with an explicit justification:
--
--     "The caller must be authorised to raise a fixture request FROM p_viewer_team_id -- the exact
--      same can_manage_team/can_manage_club_fixtures check fixture_requests_insert_scoped already
--      uses."
--
-- That was true when it was written. It stopped being true at 20270559, when the Clubhouse programme
-- moved `fixture_requests_insert_scoped` onto the canonical `fixture.request.create` capability --
-- precisely so that raising a request stopped depending on the legacy fixture-management helpers. The
-- function did not move with it, so the two have been answering different questions ever since while
-- the comment still claimed they were the same one.
--
-- THIS IS NOT A NEW PRODUCT DECISION. It restores the stated intent: ask what the insert policy asks.
-- `internal.can('fixture.request.create', ...)` at the viewer's team, or club-wide, which is the same
-- pair of shapes the policy accepts.
--
-- IT IS ALSO WHY THE SHRINK LEDGER EXISTS. `authority_helper_retirement` records a ceiling of ZERO
-- function bodies for `can_manage_club_fixtures` -- the Slice 4 closure pass took its last caller, and
-- the helper is meant to decide nothing anywhere. This function put it back, and the ledger said so.
-- Raising the ceiling instead would have recorded a drift as a decision.
--
-- WHAT A CALLER SEES IS UNCHANGED in the ordinary case: a coach or team manager of the viewing team,
-- and a club's fixture authority, hold `fixture.request.create` by their role bundles already. What
-- changes is that somebody holding a legacy fixture-management helper WITHOUT the request capability
-- no longer reads another club's availability -- which is the boundary the Clubhouse programme drew.
-- =====================================================================================================

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
  where proname = 'team_scheduling_availability' and pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'team_scheduling_availability is missing.';
  end if;

  if position('can_manage_team' in v_def) > 0 then
    v_def := replace(
      v_def,
      '    internal.has_site_capability(''site.fixtures.support'')' || chr(10) ||
      '    or internal.can_manage_team(p_viewer_team_id)' || chr(10) ||
      '    or internal.can_manage_club_fixtures(v_viewer_club_id)',
      '    internal.has_site_capability(''site.fixtures.support'')' || chr(10) ||
      '    -- THE SAME QUESTION fixture_requests_insert_scoped asks: may this person raise a request' || chr(10) ||
      '    -- FROM this team. Club-wide or at the one team, which are the two shapes that policy takes.' || chr(10) ||
      '    or internal.can(''fixture.request.create'', ''team'', v_viewer_club_id, p_viewer_team_id, null)' || chr(10) ||
      '    or internal.can(''fixture.request.create'', ''club'', v_viewer_club_id, null, null)'
    );

    if position('can_manage_team' in v_def) > 0 then
      raise exception 'team_scheduling_availability is not the shape this migration expects.';
    end if;
    execute v_def;
  end if;
end $$;

-- The helper is meant to decide nothing. Asserted here so a future caller fails at the migration that
-- adds it rather than in a suite somebody has to go and read.
do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname in ('public', 'internal')
    and f.proname <> 'can_manage_club_fixtures'
    and f.prosrc ~ '\mcan_manage_club_fixtures\('
    and not exists (select 1 from pg_depend d where d.objid = f.oid and d.deptype = 'e');
  if v_n <> 0 then
    raise exception 'can_manage_club_fixtures is called by % function bodies; the closure pass left it deciding nothing.', v_n;
  end if;
end $$;
