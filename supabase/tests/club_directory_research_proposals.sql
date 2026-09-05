-- Manual verification for the Club Directory research staging layer
-- (20260901170000_club_directory_research_proposals.sql): Site-Admin-only
-- RLS, accept applies exactly the proposed field to club_directory and
-- nothing else, reject changes nothing, a non-pending proposal can't be
-- accepted twice, and rugby_code can never appear as a proposal field
-- (its own privileged workflow is the only path for that).
-- Run after permission_matrix.sql and rugby_code_immutability.sql (same
-- e1000000... test club).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, rugby_code, country, nation, town, source, verification_status, normalized_key)
  values ('e1000000-0000-0000-0000-000000000001', 'Test RCI Club', 'union', 'United Kingdom', 'England', 'Old Town', 'local_dev_seed', 'local_dev_seed', 'test_rci_club')
  on conflict (id) do update set town = 'Old Town';
end $$;

-- ------------------------------------------------------------
-- 1. A Site Admin can insert a research proposal.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  insert into public.club_directory_research_proposals
    (directory_id, field, current_value, proposed_value, source, source_url, confidence, researched_by)
  values
    ('e1000000-0000-0000-0000-000000000001', 'town', 'Old Town', 'New Verified Town', 'Test Governing Body', 'https://example.com/test', 'high', '00000000-0000-0000-0000-000000000001')
  returning id into v_id;
  if v_id is not null then
    raise notice 'PASS 1: Site Admin can insert a research proposal';
  else
    raise notice 'FAIL 1: proposal insert did not return an id';
  end if;
  perform set_config('test.proposal_id', v_id::text, false);
end $$;
commit;

-- ------------------------------------------------------------
-- 2. An ordinary authenticated user (not a Site Admin) cannot read or
--    insert research proposals.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
  v_rejected boolean := false;
begin
  select count(*) into v_count from public.club_directory_research_proposals;
  begin
    insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by)
    values ('e1000000-0000-0000-0000-000000000001', 'town', 'Sneaky Town', 'Nobody', 'low', '00000000-0000-0000-0000-000000000002');
  exception when others then
    v_rejected := true;
  end;
  if v_count = 0 and v_rejected then
    raise notice 'PASS 2: an ordinary user can neither read nor insert research proposals';
  else
    raise notice 'FAIL 2: read_count=% insert_rejected=%', v_count, v_rejected;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Accepting a proposal applies exactly the proposed field to
--    club_directory and marks the proposal accepted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_town text;
  v_status text;
begin
  perform public.accept_directory_research_proposal(current_setting('test.proposal_id')::uuid);
  select town into v_town from public.club_directory where id = 'e1000000-0000-0000-0000-000000000001';
  select status into v_status from public.club_directory_research_proposals where id = current_setting('test.proposal_id')::uuid;
  if v_town = 'New Verified Town' and v_status = 'accepted' then
    raise notice 'PASS 3: accepting a proposal applies the proposed value and marks it accepted';
  else
    raise notice 'FAIL 3: town=% status=% (expected New Verified Town, accepted)', v_town, v_status;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. Accepting the SAME proposal again (no longer pending) is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.accept_directory_research_proposal(current_setting('test.proposal_id')::uuid);
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 4: accepting an already-accepted proposal is rejected';
  else
    raise notice 'FAIL 4: an already-accepted proposal was accepted again';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Rejecting a pending proposal changes nothing on club_directory.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_id uuid;
  v_town_before text;
  v_town_after text;
  v_status text;
begin
  select town into v_town_before from public.club_directory where id = 'e1000000-0000-0000-0000-000000000001';
  insert into public.club_directory_research_proposals
    (directory_id, field, current_value, proposed_value, source, confidence, researched_by)
  values
    ('e1000000-0000-0000-0000-000000000001', 'town', v_town_before, 'Wrong Town', 'Low-quality source', 'low', '00000000-0000-0000-0000-000000000001')
  returning id into v_new_id;
  perform public.reject_directory_research_proposal(v_new_id, 'Not authoritative enough.');
  select town into v_town_after from public.club_directory where id = 'e1000000-0000-0000-0000-000000000001';
  select status into v_status from public.club_directory_research_proposals where id = v_new_id;
  if v_town_after = v_town_before and v_status = 'rejected' then
    raise notice 'PASS 5: rejecting a proposal changes nothing on club_directory';
  else
    raise notice 'FAIL 5: town_before=% town_after=% status=%', v_town_before, v_town_after, v_status;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. field='rugby_code' is rejected by the CHECK constraint -- rugby_code
--    can never be proposed through this staging layer, only through its
--    own privileged correction workflow.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by)
    values ('e1000000-0000-0000-0000-000000000001', 'rugby_code', 'league', 'Test', 'high', '00000000-0000-0000-0000-000000000001');
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 6: field=rugby_code is rejected by the staging table''s own CHECK constraint';
  else
    raise notice 'FAIL 6: a rugby_code proposal was accepted into the staging table';
  end if;
end $$;
rollback;
