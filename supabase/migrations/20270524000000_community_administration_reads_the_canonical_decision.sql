-- =====================================================================================================
-- BATCH A CERTIFICATION FIX -- community administration reads the canonical capability decision.
--
-- WHAT BATCH A FOUND. `authority_helper_retirement` is Slice 4's shrink ledger: every legacy authority
-- helper has a reference ceiling recorded when the last domain moved off it, and a NEW reference fails
-- there before review. Step 11's `internal.can_administer_match_community` delegated to
-- `internal.can_manage_fixture_side`, taking that helper from six function-body references to seven:
--
--   FAIL HR1 can_manage_fixture_side: 2 policies (ceiling 2), 7 function bodies (ceiling 6)
--            -- a legacy reference was added
--
-- The per-step targeted acceptance did not run that suite, and the canonical gate does. This is exactly
-- the class of defect the batch checkpoint exists to catch.
--
-- WHY THE CEILING IS NOT RAISED. The ledger is shrink-only on purpose: `can_manage_fixture_side` is a
-- convenience wrapper over `internal.can('fixture.fixture.edit', ...)`, and Slice 4 is moving callers to
-- the canonical decision domain by domain. Raising the ceiling to admit a new caller would invert the
-- retirement. So the caller moves instead.
--
-- BEHAVIOUR IS DELIBERATELY UNCHANGED. The same capability, at the same two scopes, plus the same site
-- support capability the wrapper also honoured. What changes is that the community domain now asks the
-- capability engine directly, as Step 11's own report said its authority was ("the same authority Match
-- Centre already calls can_manage_fixture") -- it simply said it through the legacy helper.
--
-- Scheduling groups are deliberately not consulted: an award belongs to ONE side of one fixture, and a
-- group is a fixture-operations arrangement for scheduling, not a second team whose staff inherit
-- another side's recognition.
-- =====================================================================================================
create or replace function internal.can_administer_match_community(p_fixture_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
      from public.fixtures f
      join public.teams t on t.id = p_team_id
     where f.id = p_fixture_id
       and p_team_id in (f.owning_team_id, f.opponent_team_id)
       and (internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null)
            or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null))
  )
  or internal.has_site_capability('site.fixtures.support');
$$;

do $guard$
declare v_n int; v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'can_administer_match_community';

  -- The point of the change: the legacy helper is no longer named here.
  if v_def ~ 'can_manage_fixture_side' then
    raise exception 'Batch A: community administration still reads the retiring legacy helper';
  end if;
  -- And it does read the canonical decision rather than inventing its own test.
  if v_def !~ 'fixture\.fixture\.edit' then
    raise exception 'Batch A: community administration no longer reads the canonical fixture capability';
  end if;

  -- The shrink ledger's own count, asserted here so the fix cannot silently regress: six function
  -- bodies may reference the helper, and no more.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.prosrc ~ 'can_manage_fixture_side'
     and p.proname <> 'can_manage_fixture_side';
  if v_n > 6 then
    raise exception 'Batch A: % function bodies reference can_manage_fixture_side, ceiling is 6', v_n;
  end if;

  raise notice 'PASS Batch A: community administration reads the canonical capability decision, and the legacy helper is back at its ceiling';
end;
$guard$;
