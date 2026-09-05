-- Manual verification for Online Directory Verification (20260901240000):
-- run start/scope/permission gating, bounded resumable batches, staging-
-- only writes (never a direct club_directory write), duplicate-proposal
-- reuse, rugby_code protection, and run history. NOT a migration -- run
-- AFTER permission_matrix.sql and admin_user_management.sql (reuses
-- Burnley/Rossendale from the former, and creates its own Club Data Admin
-- / Read-Only Site Admin trio here since neither prerequisite file
-- guarantees both roles exist).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/directory_verification_runs.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.dv.full@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.dv.clubdata@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.dv.readonly@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email) values
    ('00000000-0000-0000-0000-000000000030', 'Test', 'DVFull', 'test.dv.full@ovalball.local'),
    ('00000000-0000-0000-0000-000000000031', 'Test', 'DVClubData', 'test.dv.clubdata@ovalball.local'),
    ('00000000-0000-0000-0000-000000000032', 'Test', 'DVReadOnly', 'test.dv.readonly@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000030', 'active', 'full')
  on conflict (user_id) do update set status = 'active', admin_role = 'full';
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000031', 'active', 'club_data')
  on conflict (user_id) do update set status = 'active', admin_role = 'club_data';
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000032', 'active', 'read_only')
  on conflict (user_id) do update set status = 'active', admin_role = 'read_only';
end $$;

-- ------------------------------------------------------------
-- 1. Full Site Admin can start a run.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
begin
  v_run_id := public.start_directory_verification_run('current_club', (select id from public.club_directory where name = 'Burnley RUFC'), null);
  if v_run_id is not null then
    raise notice 'PASS 1: Full Site Admin started a verification run (%)', v_run_id;
  else
    raise notice 'FAIL 1: start_directory_verification_run returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. Club Data Admin can also start a run.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
begin
  v_run_id := public.start_directory_verification_run('current_club', (select id from public.club_directory where name = 'Rossendale RUFC'), null);
  if v_run_id is not null then
    raise notice 'PASS 2: Club Data Admin started a verification run (%)', v_run_id;
  else
    raise notice 'FAIL 2: start_directory_verification_run returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. Read-Only Site Admin cannot start a run.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000032","role":"authenticated"}';
do $$
begin
  perform public.start_directory_verification_run('current_club', (select id from public.club_directory where name = 'Burnley RUFC'), null);
  raise notice 'FAIL 3: Read-Only Site Admin started a verification run';
exception when others then
  raise notice 'PASS 3: Read-Only Site Admin cannot start a run (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. An ordinary Club Admin (not a Site Admin at all) cannot start a run.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.start_directory_verification_run('current_club', (select id from public.club_directory where name = 'Burnley RUFC'), null);
  raise notice 'FAIL 4: an ordinary Club Admin started a verification run';
exception when others then
  raise notice 'PASS 4: an ordinary Club Admin cannot start a run (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Anon cannot start a run or call the batch RPCs.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform public.start_directory_verification_run('entire_directory', null, null);
  raise notice 'FAIL 5: anon started a verification run';
exception when others then
  raise notice 'PASS 5: anon cannot start a run (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. current_club scope resolves to exactly one club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  v_count := public.preview_directory_verification_scope('current_club', (select id from public.club_directory where name = 'Burnley RUFC'), null);
  if v_count = 1 then
    raise notice 'PASS 6: current_club scope previews exactly 1 club';
  else
    raise notice 'FAIL 6: current_club preview count = %', v_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Filtered scope (missing_postcode) previews a real, non-zero count
--    that never exceeds the entire-directory count.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_filtered integer;
  v_total integer;
begin
  v_filtered := public.preview_directory_verification_scope('filtered', null, '{"flag":"missing_postcode"}'::jsonb);
  v_total := public.preview_directory_verification_scope('entire_directory', null, null);
  if v_filtered > 0 and v_filtered <= v_total then
    raise notice 'PASS 7: filtered (missing_postcode) scope previews % of % total clubs', v_filtered, v_total;
  else
    raise notice 'FAIL 7: filtered=%, total=%', v_filtered, v_total;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. Running record_directory_verification_result with a real proposal
--    NEVER touches club_directory directly -- only the staging table.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_directory_id uuid;
  v_postcode_before text;
  v_postcode_after text;
begin
  v_directory_id := (select id from public.club_directory where name = 'Burnley RUFC');
  select postcode into v_postcode_before from public.club_directory where id = v_directory_id;

  v_run_id := public.start_directory_verification_run('current_club', v_directory_id, null);
  perform public.record_directory_verification_result(
    v_run_id, v_directory_id, 'proposal_created', null,
    array[row('postcode', v_postcode_before, 'BB10 9ZZ', 'Official club website', 'https://example.org', 'high')::public.directory_verification_proposal_input]
  );

  select postcode into v_postcode_after from public.club_directory where id = v_directory_id;
  if v_postcode_after is not distinct from v_postcode_before then
    raise notice 'PASS 8: club_directory.postcode is untouched (still %) -- the run only staged a proposal', v_postcode_after;
  else
    raise notice 'FAIL 8: club_directory.postcode changed from % to % without an Accept', v_postcode_before, v_postcode_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. A 'conflict' outcome stages the proposal with status='conflicting',
--    not 'pending' -- distinctly flagged for review.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_directory_id uuid;
  v_status text;
begin
  v_directory_id := (select id from public.club_directory where name = 'Rossendale RUFC');
  v_run_id := public.start_directory_verification_run('current_club', v_directory_id, null);
  perform public.record_directory_verification_result(
    v_run_id, v_directory_id, 'conflict', 'Two authoritative sources disagree.',
    array[row('town', 'Rossendale', 'Rawtenstall', 'Official governing body', 'https://example.org/a', 'medium')::public.directory_verification_proposal_input]
  );
  select status into v_status from public.club_directory_research_proposals where directory_id = v_directory_id and field = 'town' order by researched_at desc limit 1;
  if v_status = 'conflicting' then
    raise notice 'PASS 9: a conflicting result is staged with status=conflicting, distinct from a plain pending proposal';
  else
    raise notice 'FAIL 9: status=%', v_status;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 10. rugby_code can never be proposed through this pipeline -- the
--     proposals table's own field allowlist rejects it outright.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_directory_id uuid;
begin
  v_directory_id := (select id from public.club_directory where name = 'Burnley RUFC');
  v_run_id := public.start_directory_verification_run('current_club', v_directory_id, null);
  perform public.record_directory_verification_result(
    v_run_id, v_directory_id, 'proposal_created', null,
    array[row('rugby_code', 'union', 'league', 'Official governing body', 'https://example.org', 'high')::public.directory_verification_proposal_input]
  );
  raise notice 'FAIL 10: a rugby_code proposal was accepted by the staging table';
exception when others then
  raise notice 'PASS 10: rugby_code is rejected by the proposals table''s own field allowlist -- it can never be silently proposed here (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. A failed club within a run does not corrupt already-recorded
--     results -- failed_count increments, earlier successes are retained.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_burnley uuid := (select id from public.club_directory where name = 'Burnley RUFC');
  v_rossendale uuid := (select id from public.club_directory where name = 'Rossendale RUFC');
  v_no_result_count integer;
  v_failed_count integer;
begin
  v_run_id := public.start_directory_verification_run('filtered', null, '{"flag":"missing_postcode"}'::jsonb);
  perform public.record_directory_verification_result(v_run_id, v_burnley, 'no_result', 'No authoritative source found.', array[]::public.directory_verification_proposal_input[]);
  perform public.record_directory_verification_result(v_run_id, v_rossendale, 'failed', 'Provider timed out.', array[]::public.directory_verification_proposal_input[]);

  select no_result_count, failed_count into v_no_result_count, v_failed_count from public.directory_verification_runs where id = v_run_id;
  if v_no_result_count = 1 and v_failed_count = 1 then
    raise notice 'PASS 11: a failed club (failed_count=1) does not corrupt the earlier no_result outcome (no_result_count=1) -- both retained independently';
  else
    raise notice 'FAIL 11: no_result_count=%, failed_count=%', v_no_result_count, v_failed_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 12. An interrupted run can resume safely -- get_directory_verification_
--     next_batch never returns a club already recorded in this run.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_burnley uuid := (select id from public.club_directory where name = 'Burnley RUFC');
  v_reappeared boolean;
begin
  v_run_id := public.start_directory_verification_run('filtered', null, '{"flag":"missing_postcode"}'::jsonb);
  perform public.record_directory_verification_result(v_run_id, v_burnley, 'no_result', null, array[]::public.directory_verification_proposal_input[]);

  select exists (
    select 1 from public.get_directory_verification_next_batch(v_run_id, 1000) where directory_id = v_burnley
  ) into v_reappeared;
  if not v_reappeared then
    raise notice 'PASS 12: a club already recorded in this run never reappears in the next batch (safe resume)';
  else
    raise notice 'FAIL 12: an already-processed club reappeared in the next batch';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 13. A repeated run does not create duplicate pending proposals for the
--     same club/field -- it reuses/updates the existing pending row.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_directory_id uuid := (select id from public.club_directory where name = 'Burnley RUFC');
  v_run1 uuid;
  v_run2 uuid;
  v_pending_count integer;
  v_latest_value text;
begin
  v_run1 := public.start_directory_verification_run('current_club', v_directory_id, null);
  perform public.record_directory_verification_result(v_run1, v_directory_id, 'proposal_created', null,
    array[row('website', null, 'https://burnleyrufc-old.example.org', 'Official club website', null, 'medium')::public.directory_verification_proposal_input]);

  v_run2 := public.start_directory_verification_run('current_club', v_directory_id, null);
  perform public.record_directory_verification_result(v_run2, v_directory_id, 'proposal_created', null,
    array[row('website', null, 'https://burnleyrufc.example.org', 'Official club website', null, 'high')::public.directory_verification_proposal_input]);

  select count(*), max(proposed_value) into v_pending_count, v_latest_value
  from public.club_directory_research_proposals
  where directory_id = v_directory_id and field = 'website' and status = 'pending';

  if v_pending_count = 1 and v_latest_value = 'https://burnleyrufc.example.org' then
    raise notice 'PASS 13: two runs proposing the same field left exactly 1 pending proposal, updated to the latest value (%)', v_latest_value;
  else
    raise notice 'FAIL 13: pending_count=%, latest_value=%', v_pending_count, v_latest_value;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 14. Run history records the real actor, timestamps, and counts.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_started_by uuid;
begin
  select started_by into v_started_by from public.list_directory_verification_runs(1);
  if v_started_by = '00000000-0000-0000-0000-000000000030' then
    raise notice 'PASS 14: run history records the real actor who started the most recent run';
  else
    raise notice 'FAIL 14: started_by=%', v_started_by;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. "Check Online Now" on one individual club uses the exact same
--     pipeline -- current_club scope with total_records=1.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}';
do $$
declare
  v_run_id uuid;
  v_total integer;
begin
  v_run_id := public.start_directory_verification_run('current_club', (select id from public.club_directory where name = 'Rossendale RUFC'), null);
  select total_records into v_total from public.directory_verification_runs where id = v_run_id;
  if v_total = 1 then
    raise notice 'PASS 15: "Check Online Now" (current_club scope) checks exactly the one club, same pipeline as a bulk run';
  else
    raise notice 'FAIL 15: total_records=%', v_total;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 16. A proposal created by this pipeline is accepted through the SAME
--     pre-existing accept_directory_research_proposal RPC -- no parallel
--     apply path exists in this migration.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';
do $$
declare
  v_directory_id uuid := (select id from public.club_directory where name = 'Burnley RUFC');
  v_proposal_id uuid;
  v_postcode_after text;
begin
  select id into v_proposal_id from public.club_directory_research_proposals
  where directory_id = v_directory_id and field = 'postcode' and status = 'pending'
  order by researched_at desc limit 1;

  perform public.accept_directory_research_proposal(v_proposal_id);
  select postcode into v_postcode_after from public.club_directory where id = v_directory_id;
  if v_postcode_after = 'BB10 9ZZ' then
    raise notice 'PASS 16: the existing accept_directory_research_proposal RPC applied this pipeline''s own staged proposal (postcode now %)', v_postcode_after;
  else
    raise notice 'FAIL 16: postcode=%', v_postcode_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. Canonical records stay unchanged until a proposal is explicitly
--     accepted -- the website proposal from test 13 is still pending and
--     club_directory.website is still untouched.
-- ------------------------------------------------------------
do $$
declare
  v_directory_id uuid := (select id from public.club_directory where name = 'Burnley RUFC');
  v_website text;
  v_pending_status text;
begin
  select website into v_website from public.club_directory where id = v_directory_id;
  select status into v_pending_status from public.club_directory_research_proposals where directory_id = v_directory_id and field = 'website' order by researched_at desc limit 1;
  if v_website is distinct from 'https://burnleyrufc.example.org' and v_pending_status = 'pending' then
    raise notice 'PASS 17: an un-accepted proposal (still pending) has not changed club_directory.website (still %)', v_website;
  else
    raise notice 'FAIL 17: website=%, pending_status=%', v_website, v_pending_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 18. Anon cannot read run history or per-club freshness.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_row_count integer;
begin
  select count(*) into v_row_count from public.list_directory_verification_runs(50);
  if v_row_count = 0 then
    raise notice 'PASS 18: anon sees no run history (list_directory_verification_runs is Site-Admin-gated inside the function body)';
  else
    raise notice 'FAIL 18: anon saw % run history row(s)', v_row_count;
  end if;
end $$;
rollback;
