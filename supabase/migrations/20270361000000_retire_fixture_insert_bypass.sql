-- Slice 4C -- part 4: close the direct fixture-creation bypass (Phase 2 AA.3 row 4c;
-- J.6 line 457 "MERGE (removes the direct-insert bypass)").
--
-- CONTRACT STEP. This migration removes a privilege that the previously deployed application used,
-- so it must land only AFTER the application that calls public.create_fixture is live. The release
-- order is therefore:
--
--   A  20270358000000 + 20270359000000 + 20270360000000   the old application keeps working: it
--                                                         still direct-inserts and still holds
--                                                         INSERT, and create_fixture now exists
--   B  deploy the application                             createFixture calls the RPC; nothing
--                                                         direct-inserts any more
--   C  this migration                                     the privilege goes
--
-- Splitting the RPC's creation (A) from the revoke (C) is what removes the outage window. If both
-- lived in one migration, either the revoke would land before the new application (breaking every
-- club's fixture creation) or the RPC would land after it (the same, for the other reason).

-- 6. The bypass itself. With no INSERT privilege, every creation path is a SECURITY DEFINER
--    function that enforces its own contract.
revoke insert on public.fixtures from authenticated;

drop policy if exists fixtures_insert_scoped on public.fixtures;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'fixtures' and grantee = 'authenticated' and privilege_type = 'INSERT'
  ) then
    raise exception 'authenticated still holds INSERT on public.fixtures; the bypass is not closed.';
  end if;
end $$;
