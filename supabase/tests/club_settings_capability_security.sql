-- Club Settings Consolidation + Central Mutation Capabilities -- security
-- regression (Master Architecture Pass tranche). Proves, directly at the
-- RLS layer (bypassing the Next.js app entirely -- the strongest form of
-- proof), that folding Club/Teams/Lookup Administration into one Club
-- Settings hub did not create or rely on any cross-club authority leak,
-- and that the actor's capability at one club never extends to a
-- different club they also happen to administer.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_settings_capability_security.sql
--
-- Uses REAL playground accounts (Burnley RUFC, Rossendale RUFC, League
-- Test Club A), never synthetic ids -- every write-attempting block is
-- wrapped in its own begin/rollback so no playground data is permanently
-- changed by running this file, regardless of whether the write under
-- test is expected to succeed or be rejected.
--
-- IMPORTANT ACTOR CHOICE: test.burnley.admin@ovalball.local is ALSO a
-- full Site Admin (site_admins.admin_role='full') on this playground --
-- a genuine, correct reason for them to be able to write to ANY club, not
-- a leak. Using them as the "attacker" in a cross-club test would
-- silently test Site Admin authority instead of Club Admin authority and
-- produce false failures. This file therefore uses
-- test.rossendale.admin@ovalball.local (00000000-0000-0000-0000-000000000003)
-- as the sole Club-Admin-only attacker/legitimate actor throughout -- confirmed
-- to hold NO site_admins row and NO membership anywhere but Rossendale.

\set ON_ERROR_STOP off
\pset pager off

-- Rossendale RUFC (the clean Club-Admin-only actor's OWN club): club 10000000-0000-0000-0000-000000000002, Club Admin user 00000000-0000-0000-0000-000000000003 (test.rossendale.admin), Fixture Secretary user 93900000-0000-0000-0000-000000000001 (test.tournament.secretary), pitch 93000000-0000-0000-0000-000000000003, venue 60000000-0000-0000-0000-000000000003, club_memberships row 20000000-0000-0000-0000-000000000002 (the Rossendale admin's own row).
-- Burnley RUFC (the cross-club TARGET for every negative test): club 10000000-0000-0000-0000-000000000001, team 30000000-0000-0000-0000-000000000001 (U12), venue 60000000-0000-0000-0000-000000000001, pitch 60100000-0000-0000-0000-000000000001.
-- League Test Club A: club 95000000-0000-0000-0000-000000000022 -- used only as test 9's temporary second club, granted and revoked within a single rolled-back transaction.

-- ============================================================
-- 1. Rossendale Club Admin -> Rossendale Club Profile (clubs.bio) =
-- authorized (legitimate same-club write succeeds).
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.clubs set bio = 'RLS direct-write test -- Rossendale own profile' where id = '10000000-0000-0000-0000-000000000002';
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS 1: Rossendale Club Admin can edit Rossendale''s own Club Profile (1 row updated)';
  else
    raise notice 'FAIL 1: Rossendale Club Admin could not edit Rossendale''s own Club Profile (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 2. Rossendale Club Admin -> Burnley Club Profile via club_id
-- substitution = REJECTED. Section 5/33: manual club_id substitution.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.clubs set bio = 'TAMPER ATTEMPT' where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 2: Rossendale Club Admin CANNOT edit Burnley''s Club Profile via club_id substitution (0 rows)';
  else
    raise notice 'FAIL 2: Rossendale Club Admin mutated Burnley''s Club Profile -- cross-club leak (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 3. Rossendale Club Admin -> Burnley Team via team_id substitution =
-- REJECTED. Section 33: team_id substitution. Targets display_name (a
-- trigger-derived, constraint-free field) so a rejected write can never
-- collide with a real CHECK constraint and mask the RLS result.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.teams set display_name = 'TAMPER' where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 3: Rossendale Club Admin CANNOT edit Burnley''s Team via team_id substitution (0 rows)';
  else
    raise notice 'FAIL 3: Rossendale Club Admin mutated Burnley''s Team -- cross-club leak (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 4. Rossendale Club Admin -> Burnley Venue via venue_id substitution =
-- REJECTED. Section 33: venue_id substitution.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.venues set name = 'TAMPER' where id = '60000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 4: Rossendale Club Admin CANNOT edit Burnley''s Venue via venue_id substitution (0 rows)';
  else
    raise notice 'FAIL 4: Rossendale Club Admin mutated Burnley''s Venue -- cross-club leak (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 5. Rossendale Club Admin -> Burnley Pitch via pitch_id substitution =
-- REJECTED. Section 33: pitch_id substitution.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.club_pitches set display_name = 'TAMPER' where id = '60100000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 5: Rossendale Club Admin CANNOT edit Burnley''s Pitch via pitch_id substitution (0 rows)';
  else
    raise notice 'FAIL 5: Rossendale Club Admin mutated Burnley''s Pitch -- cross-club leak (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 6. Self-escalation: Rossendale Club Admin attempts to INSERT a
-- club_memberships row granting themselves CLUB_ADMIN at Burnley =
-- REJECTED. club_memberships_insert_admin is is_site_admin() ONLY --
-- no club role, anywhere, can grant club membership directly today.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  begin
    insert into public.club_memberships (club_id, user_id, role, status) values
      ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise notice 'PASS 6: Rossendale Club Admin cannot self-grant CLUB_ADMIN at Burnley (0 rows)';
    else
      raise notice 'FAIL 6: Rossendale Club Admin self-granted CLUB_ADMIN at Burnley -- privilege escalation (% rows)', v_count;
    end if;
  exception when others then
    raise notice 'PASS 6: Rossendale Club Admin blocked from self-granting CLUB_ADMIN at Burnley (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- 7. Rossendale Club Admin attempts to UPDATE an existing Burnley
-- club_memberships row (suspend the Burnley admin's own authority) =
-- REJECTED.
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.club_memberships set authority_suspended = true where club_id = '10000000-0000-0000-0000-000000000001' and role = 'CLUB_ADMIN';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 7: Rossendale Club Admin cannot modify Burnley''s club_memberships rows (0 rows)';
  else
    raise notice 'FAIL 7: Rossendale Club Admin modified a Burnley club_memberships row (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 8a. Rossendale Fixture Secretary -> Rossendale Pitch = authorized
-- (club_pitches write allows can_manage_club_fixtures, which includes
-- Fixture Secretary, not just Club Admin).
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"93900000-0000-0000-0000-000000000001","role":"authenticated"}';
  update public.club_pitches set description = 'RLS direct-write test' where id = '93000000-0000-0000-0000-000000000003';
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS 8a: Rossendale Fixture Secretary can edit Rossendale''s own Pitch (1 row)';
  else
    raise notice 'FAIL 8a: Rossendale Fixture Secretary could not edit Rossendale''s own Pitch (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 8b. Rossendale Fixture Secretary -> Rossendale Venue = REJECTED
-- (venues write is Club-Admin-only, deliberately stricter than Pitches --
-- see the Club Settings Permission Matrix for why this asymmetry exists).
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"93900000-0000-0000-0000-000000000001","role":"authenticated"}';
  update public.venues set name = 'TAMPER' where id = '60000000-0000-0000-0000-000000000003';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 8b: Rossendale Fixture Secretary CANNOT edit Rossendale''s own Venue (0 rows -- Club-Admin-only capability)';
  else
    raise notice 'FAIL 8b: Rossendale Fixture Secretary edited a Venue -- capability boundary broken (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 8c. Rossendale Fixture Secretary -> Rossendale Club Profile =
-- REJECTED (clubs write is Club-Admin-only).
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"93900000-0000-0000-0000-000000000001","role":"authenticated"}';
  update public.clubs set bio = 'TAMPER' where id = '10000000-0000-0000-0000-000000000002';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS 8c: Rossendale Fixture Secretary CANNOT edit Rossendale''s own Club Profile (0 rows -- Club-Admin-only capability)';
  else
    raise notice 'FAIL 8c: Rossendale Fixture Secretary edited the Club Profile -- capability boundary broken (% rows)', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- 9. Multi-club account: temporarily (within this one rolled-back
-- transaction only) grant the clean Rossendale Club Admin CLUB_ADMIN at
-- Burnley too, and confirm they can now legitimately write to BOTH
-- clubs they genuinely administer. This is CORRECT and EXPECTED -- RLS
-- enforces "any club this account really administers," which is the
-- system invariant (Section 12: managed capability vs system invariant).
-- It is the APPLICATION layer (activeManageableClubId, scoped to
-- whichever club is the ACTIVE context) that further narrows this
-- session-wide authority down to exactly one club per page load -- see
-- docs/architecture/capability-model.md.
-- ============================================================
begin;
insert into public.club_memberships (club_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  update public.clubs set bio = 'RLS direct-write test -- now multi-club' where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS 9: once genuinely granted CLUB_ADMIN at a second club (Burnley), the account can write to BOTH clubs it administers (1 row) -- RLS ceiling is correct; app-level active-context scoping is what narrows this further per page';
  else
    raise notice 'FAIL 9: a genuinely multi-club account could not edit a club it was just granted CLUB_ADMIN at (% rows)', v_count;
  end if;
end $$;
rollback; -- undoes both the temporary Burnley membership grant and the club edit

-- ============================================================
-- 10. Team roster (team_permissions): Rossendale Club Admin attempts to
-- INSERT a team_permissions row granting themselves team_admin on a
-- Burnley team = REJECTED (no club_memberships row at Burnley at all for
-- this actor, so the insert policy's club-admin subquery is null/false).
-- ============================================================
begin;
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  begin
    insert into public.team_permissions (membership_id, team_id, permission) values
      ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'team_admin');
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise notice 'PASS 10: Rossendale Club Admin cannot grant themselves a Burnley team_permissions row (0 rows)';
    else
      raise notice 'FAIL 10: Rossendale Club Admin granted themselves Burnley team roster authority (% rows)', v_count;
    end if;
  exception when others then
    raise notice 'PASS 10: Rossendale Club Admin blocked from granting a Burnley team_permissions row (%)', sqlerrm;
  end;
end $$;
rollback;
