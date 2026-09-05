-- Manual verification for Rugby Code immutability
-- (20260901160000_rugby_code_immutability.sql): an ordinary UPDATE can
-- never change club_directory.rugby_code regardless of who runs it (Full
-- Site Admin included), only correct_club_rugby_code() can, it requires
-- Full Site Admin + a real reason, and every correction is logged.
-- Run after permission_matrix.sql and message_management.sql (0022,
-- club_data Site Admin).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('e1000000-0000-0000-0000-000000000001', 'Test RCI Club', 'union', 'United Kingdom', 'England', 'local_dev_seed', 'local_dev_seed', 'test_rci_club')
  on conflict (id) do update set rugby_code = 'union';
end $$;

-- ------------------------------------------------------------
-- 1. An ordinary UPDATE by a Full Site Admin is rejected outright, even
--    though club_directory_update_admin's RLS would otherwise allow it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.club_directory set rugby_code = 'league' where id = 'e1000000-0000-0000-0000-000000000001';
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 1: an ordinary UPDATE to rugby_code is rejected even for a Full Site Admin';
  else
    raise notice 'FAIL 1: an ordinary UPDATE to rugby_code succeeded';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. An ordinary UPDATE that does NOT touch rugby_code (only some other
--    column) still succeeds normally -- the trigger only blocks an
--    actual change to that one column.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_town text;
begin
  update public.club_directory set town = 'Test Town RCI' where id = 'e1000000-0000-0000-0000-000000000001';
  select town into v_town from public.club_directory where id = 'e1000000-0000-0000-0000-000000000001';
  if v_town = 'Test Town RCI' then
    raise notice 'PASS 2: an ordinary UPDATE that does not touch rugby_code still succeeds';
  else
    raise notice 'FAIL 2: unrelated-column update did not apply (town=%)', v_town;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. correct_club_rugby_code() succeeds for a Full Site Admin with a
--    real reason, and the column actually changes.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_code text;
begin
  perform public.correct_club_rugby_code('e1000000-0000-0000-0000-000000000001', 'league', 'Confirmed via governing body -- test.');
  select rugby_code into v_code from public.club_directory where id = 'e1000000-0000-0000-0000-000000000001';
  if v_code = 'league' then
    raise notice 'PASS 3: correct_club_rugby_code() succeeds for a Full Site Admin and applies the change';
  else
    raise notice 'FAIL 3: rugby_code is % (expected league)', v_code;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. The correction is logged with the real actor, from/to codes, and reason.
-- ------------------------------------------------------------
do $$
declare
  v_actor uuid;
  v_from text;
  v_to text;
  v_reason text;
begin
  select corrected_by, from_code, to_code, reason into v_actor, v_from, v_to, v_reason
  from public.club_directory_rugby_code_corrections
  where directory_id = 'e1000000-0000-0000-0000-000000000001'
  order by corrected_at desc limit 1;
  if v_actor = '00000000-0000-0000-0000-000000000001' and v_from = 'union' and v_to = 'league' and v_reason like 'Confirmed via governing body%' then
    raise notice 'PASS 4: correction audit row is correct (actor, from, to, reason)';
  else
    raise notice 'FAIL 4: unexpected audit row (actor=%, from=%, to=%, reason=%)', v_actor, v_from, v_to, v_reason;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. A reason is mandatory -- an empty reason is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.correct_club_rugby_code('e1000000-0000-0000-0000-000000000001', 'union', '');
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 5: an empty reason is rejected';
  else
    raise notice 'FAIL 5: an empty reason was accepted';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. A club_data Site Admin (can edit ordinary directory fields) is NOT
--    authorized to correct rugby_code -- Full Site Admin only.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.correct_club_rugby_code('e1000000-0000-0000-0000-000000000001', 'union', 'Trying as club_data admin.');
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 6: a club_data Site Admin cannot correct rugby_code (Full Site Admin only)';
  else
    raise notice 'FAIL 6: a club_data Site Admin was able to correct rugby_code';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Correcting to the SAME code the club already has is rejected
--    (nothing to correct).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.correct_club_rugby_code('e1000000-0000-0000-0000-000000000001', 'league', 'Already league.');
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 7: correcting to the same code the club already has is rejected';
  else
    raise notice 'FAIL 7: a no-op correction to the same code was accepted';
  end if;
end $$;
rollback;
