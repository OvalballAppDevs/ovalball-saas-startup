-- Manual verification for the closed canonical team catalogue built in
-- 20260904200000_canonical_team_catalogue.sql. NOT a migration -- run
-- AFTER permission_matrix.sql (reuses its seeded users/clubs).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/canonical_team_catalogue.sql

\set ON_ERROR_STOP off
\pset pager off

-- ------------------------------------------------------------
-- 1. A valid catalogue combination resolves the right canonical type,
--    for one example from each shape the catalogue has to handle.
-- ------------------------------------------------------------
do $$
declare
  v_u12 uuid; v_girls_u12 uuid; v_mens_1st uuid; v_junior_colts uuid; v_senior_colts uuid;
begin
  v_u12 := internal.resolve_canonical_team_type('youth', 'U12', 'boys', null);
  v_girls_u12 := internal.resolve_canonical_team_type('youth', 'U12', 'girls', null);
  v_mens_1st := internal.resolve_canonical_team_type('senior', null, 'mens', null);
  v_junior_colts := internal.resolve_canonical_team_type('colts', 'JuniorColts', null, null);
  v_senior_colts := internal.resolve_canonical_team_type('colts', 'SeniorColts', null, null);

  if v_u12 is not null and v_girls_u12 is not null and v_u12 <> v_girls_u12
     and v_mens_1st is not null and v_junior_colts is not null and v_senior_colts is not null
     and v_junior_colts <> v_senior_colts then
    raise notice 'PASS 1: every catalogue shape (age-grade, girls, senior default-to-1st, both colts) resolves to a distinct real canonical type';
  else
    raise notice 'FAIL 1: expected distinct non-null types, got U12=%, GirlsU12=%, Mens1st=%, JuniorColts=%, SeniorColts=%', v_u12, v_girls_u12, v_mens_1st, v_junior_colts, v_senior_colts;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. An out-of-catalogue combination (senior "4th" -- the closed list
--    stops at 3rd) resolves to NULL, never guessed at, never crashes.
-- ------------------------------------------------------------
do $$
declare
  v_type uuid;
begin
  v_type := internal.resolve_canonical_team_type('senior', null, 'mens', '4th');
  if v_type is null then
    raise notice 'PASS 2: an out-of-catalogue senior ordinal (4th) resolves to no canonical type, not a guessed one';
  else
    raise notice 'FAIL 2: senior "4th" unexpectedly resolved to a real canonical type %', v_type;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Girls below U12 (not in the closed catalogue's Girls band) also
--    resolves to NULL -- confirms the closure is real, not just senior.
-- ------------------------------------------------------------
do $$
declare
  v_type uuid;
begin
  v_type := internal.resolve_canonical_team_type('youth', 'U9', 'girls', null);
  if v_type is null then
    raise notice 'PASS 3: Girls U9 (below the closed catalogue''s U12-U16 Girls band) resolves to no canonical type';
  else
    raise notice 'FAIL 3: Girls U9 unexpectedly resolved to a real canonical type %', v_type;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. "A" is never a real squad letter -- the display formatter always
--    treats it as the primary squad, matching lib/teams/compact-label.ts.
-- ------------------------------------------------------------
do $$
declare
  v_name text;
begin
  v_name := internal.compute_team_display_name('youth', 'U9', 'boys', 'A');
  if v_name = 'U9' then
    raise notice 'PASS 4: squad_designation "A" displays as the plain primary name ("U9"), never "U9 A"';
  else
    raise notice 'FAIL 4: expected "U9", got "%"', v_name;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. Real active-duplicate prevention: a second active team at the same
--    club/canonical type/gender/squad is rejected by the database itself,
--    not just hidden in the Add Team UI.
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('95000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U10', 'boys', null, 'placeholder', 'placeholder')
  on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('95000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U10', 'boys', null, 'placeholder', 'placeholder');
  raise notice 'FAIL 5: a duplicate active U10 for the same club unexpectedly succeeded';
exception when unique_violation then
  raise notice 'PASS 5: a duplicate active U10 for the same club is rejected by the database (teams_active_canonical_identity_idx), not merely hidden in the UI';
end $$;

-- ------------------------------------------------------------
-- 6. That same duplicate becomes possible again once the FIRST one is
--    inactive -- deactivation genuinely frees the identity for
--    reactivation-routing, it doesn't leave a phantom permanent block.
-- ------------------------------------------------------------
do $$
begin
  update public.teams set active = false where id = '95000000-0000-0000-0000-000000000001';
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('95000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U10', 'boys', null, 'placeholder', 'placeholder');
  raise notice 'PASS 6: once the original U10 is inactive, the identity is no longer blocked by the active-uniqueness index';
exception when unique_violation then
  raise notice 'FAIL 6: an inactive team unexpectedly still blocked a new active one at the same identity';
end $$;

-- ------------------------------------------------------------
-- 7. RLS closure: the ONE direct client insert path (the shape
--    app/(app)/teams/actions.ts's createTeam always produces, via the
--    locked catalogue) succeeds for a real Club Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U6', 'mixed', null, 'pending', 'pending');
  raise notice 'PASS 7: a real Club Admin inserting a valid closed-catalogue combination succeeds (canonical_team_type_id auto-resolved before the RLS check)';
exception when others then
  raise notice 'FAIL 7: a valid closed-catalogue insert was unexpectedly rejected: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. RLS closure, the actual point of this migration: the SAME Club
--    Admin cannot insert a team outside the closed catalogue (U17 is not
--    in it) even by writing directly to the table, bypassing the Add
--    Team picker entirely -- this is the "no write path may create a
--    team outside the catalogue" requirement, proven against the real
--    authenticated boundary, not just the UI.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U17', 'boys', null, 'pending', 'pending');
  raise notice 'FAIL 8: a real Club Admin inserting U17 (outside the closed catalogue) unexpectedly succeeded';
exception when insufficient_privilege then
  raise notice 'PASS 8: a real Club Admin cannot insert a team outside the closed catalogue (U17) -- rejected by RLS, not just hidden in the UI';
when others then
  raise notice 'FAIL 8: expected an RLS rejection, got a different error: %', sqlerrm;
end $$;
rollback;

-- ============================================================
-- 9-19: the closed catalogue as a TRUE DATABASE INVARIANT
-- (20260904300000_team_catalogue_hard_invariant.sql) -- proven through a
-- path RLS does not even touch. Every statement below runs as the bare
-- `postgres` role this whole script already connects as (no `set local
-- role authenticated`, unlike tests 7/8 above) -- postgres bypasses RLS
-- entirely by default, so any rejection here can only come from the
-- CHECK constraints/trigger themselves, never from the teams_insert_admin
-- policy. This is the "more than the browser/RLS path" proof: the same
-- superuser role every SQL test file in this suite writes through, and
-- the same role a SECURITY DEFINER RPC effectively runs as.
-- ============================================================

-- ------------------------------------------------------------
-- 9. U17 -- rejected purely by the hard invariant, RLS never in play.
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U17', 'boys', null, 'pending', 'pending');
  raise notice 'FAIL 9: U17 (active, as postgres -- RLS bypassed) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 9: U17 is rejected even as postgres (RLS bypassed) -- the closed catalogue is a real data-integrity invariant, not an RLS-only restriction';
end $$;

-- ------------------------------------------------------------
-- 10. Girls U8/U9/U11 -- the closed Girls band starts at U12; below it,
--     Girls is not an ordinary operational identity (distinct from
--     ordinary mixed-gender U6-U11 age-grade teams, which remain valid).
-- ------------------------------------------------------------
do $$
declare
  v_age text;
  v_all_rejected boolean := true;
begin
  foreach v_age in array array['U8', 'U9', 'U11'] loop
    begin
      insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
      values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', v_age, 'girls', null, 'pending', 'pending');
      v_all_rejected := false;
      raise notice 'Girls % (active, as postgres) unexpectedly succeeded', v_age;
    exception when check_violation then
      null;
    end;
  end loop;
  if v_all_rejected then
    raise notice 'PASS 10: Girls U8, U9, and U11 are all rejected as active operational teams -- the closed Girls band starts at U12, and this holds even as postgres';
  else
    raise notice 'FAIL 10: at least one of Girls U8/U9/U11 unexpectedly succeeded (see notices above)';
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. Men's 4th -- the closed senior catalogue stops at 3rd.
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mens', '4th', 'pending', 'pending');
  raise notice 'FAIL 11: Men''s 4th (active, as postgres) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 11: Men''s 4th is rejected as postgres -- the senior catalogue closure holds independent of RLS';
end $$;

-- ------------------------------------------------------------
-- 12. U12 D -- youth squad designation is closed to null/B/C; no "D".
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'boys', 'D', 'pending', 'pending');
  raise notice 'FAIL 12: U12 D (active, as postgres) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 12: U12 D is rejected as postgres -- youth squad designation is closed to the primary, B, or C';
end $$;

-- ------------------------------------------------------------
-- 13. A custom/free-text team identity -- an age_group that is not one
--     of the catalogue's real values never resolves, so it can never be
--     active, regardless of how it got written.
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'Under 12 Legends', 'boys', null, 'pending', 'pending');
  raise notice 'FAIL 13: a free-text age_group (active, as postgres) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 13: a free-text/custom team identity is rejected as postgres -- there is no way to write an invented identity as active';
end $$;

-- ------------------------------------------------------------
-- 14. Valid creation still works for one example of every catalogue
--     shape, as the SAME bare postgres role -- the invariant closes off
--     invalid identities without narrowing what is genuinely valid. A
--     dedicated throwaway club, never Burnley/Rossendale, so none of
--     these collide with the real teams every other test file in this
--     suite has already created at those two clubs by the time this
--     file runs.
-- ------------------------------------------------------------
do $$
declare
  v_ok boolean := true;
  v_club_id uuid := '95000000-0000-0000-0000-000000000c00';
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('95000000-0000-0000-0000-000000000d00', 'Catalogue Validity Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'catalogue-validity-test-rufc-95000000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values (v_club_id, '95000000-0000-0000-0000-000000000d00', 'catalogue-validity-test-rufc-95000000', 'active')
  on conflict (id) do nothing;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U6', 'mixed', null, 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'U6 unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U12', 'boys', null, 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'U12 unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U12', 'boys', 'B', 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'U12 B unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U12', 'boys', 'C', 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'U12 C unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U12', 'girls', null, 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Girls U12 unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'youth', 'U12', 'girls', 'B', 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Girls U12 B unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'colts', 'JuniorColts', null, null, 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Junior Colts unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'colts', 'SeniorColts', null, null, 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Senior Colts unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'senior', null, 'mens', '3rd', 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Men''s 3rd unexpectedly rejected: %', sqlerrm; end;

  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    values (v_club_id, 'union', 'senior', null, 'womens', '3rd', 'pending', 'pending');
  exception when others then v_ok := false; raise notice 'Women''s 3rd unexpectedly rejected: %', sqlerrm; end;

  if v_ok then
    raise notice 'PASS 14: every genuinely valid catalogue identity (U6, U12, U12 B, U12 C, Girls U12, Girls U12 B, Junior Colts, Senior Colts, Men''s 3rd, Women''s 3rd) still inserts successfully as active';
  else
    raise notice 'FAIL 14: at least one genuinely valid identity was unexpectedly rejected (see notices above)';
  end if;
end $$;

-- ------------------------------------------------------------
-- 15. A legacy/historical row (inactive, out of catalogue) can be
--     preserved for data integrity, but can never be reactivated for new
--     operational work -- no informal "NULL canonical_team_type_id on an
--     active row" loophole exists.
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_canonical uuid;
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active)
  values ('95000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mens', '4th', 'Legacy Men''s 4th', 'legacy-mens-4th', false)
  returning id, canonical_team_type_id into v_id, v_canonical;

  if v_canonical is not null then
    raise notice 'FAIL 15: a legacy out-of-catalogue row unexpectedly resolved a real canonical_team_type_id (%)', v_canonical;
    return;
  end if;

  begin
    update public.teams set active = true where id = v_id;
    raise notice 'FAIL 15: reactivating a legacy, out-of-catalogue row (Men''s 4th) unexpectedly succeeded';
  exception when check_violation then
    raise notice 'PASS 15: a legacy row (canonical_team_type_id NULL, preserved inactive for history) can never be reactivated for new operational work -- it stays permanently ineligible, never a loophole';
  end;
end $$;
