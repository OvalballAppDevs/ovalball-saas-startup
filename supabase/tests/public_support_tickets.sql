-- Manual verification for public/anonymous Support tickets
-- (20260901140000_public_support_tickets.sql): anon submission via
-- submit_public_support_ticket, rate limiting, RLS invisibility to
-- everyone but a Site Admin, and that update_support_ticket_status/
-- send_support_reply still work correctly for a public-origin ticket
-- (both previously used "created_by_user_id is null" as their row-not-
-- found check, which a real public ticket's null value would trip).
-- Run after permission_matrix.sql (0001 full Site Admin) and
-- support_tickets.sql.

\set ON_ERROR_STOP off
\pset pager off

-- ------------------------------------------------------------
-- 1. Anonymous submission succeeds and returns a well-formed reference.
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_ref text;
begin
  select public.submit_public_support_ticket('Test Visitor', 'test.visitor.pst@example.com', 'bug', 'Test: public ticket', 'A safe local test description.', 'Test Club Context') into v_ref;
  if v_ref ~ '^OB-\d{6}-\d{4,}$' then
    raise notice 'PASS 1: public ticket created with a well-formed reference (%)', v_ref;
  else
    raise notice 'FAIL 1: unexpected reference shape (%)', v_ref;
  end if;
  perform set_config('test.public_ref', v_ref, false);
end $$;
commit;

-- ------------------------------------------------------------
-- 2. The submitted row has the expected shape: origin=public,
--    created_by_user_id null, contact fields populated.
-- ------------------------------------------------------------
do $$
declare
  v_origin text;
  v_creator uuid;
  v_contact_name text;
begin
  select origin, created_by_user_id, contact_name into v_origin, v_creator, v_contact_name
  from public.support_tickets where reference = current_setting('test.public_ref');
  if v_origin = 'public' and v_creator is null and v_contact_name = 'Test Visitor' then
    raise notice 'PASS 2: row shape correct (origin=public, created_by_user_id=null, contact_name set)';
  else
    raise notice 'FAIL 2: unexpected row shape (origin=%, creator=%, contact_name=%)', v_origin, v_creator, v_contact_name;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. An anonymous caller cannot read ANY support_tickets row (not even
--    the one they just created) -- there is no lookup-by-reference path.
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets;
  if v_count = 0 then
    raise notice 'PASS 3: anon cannot read any support_tickets row';
  else
    raise notice 'FAIL 3: anon read % rows (expected 0)', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. An ordinary authenticated user (not the creator, not a Site Admin)
--    cannot read the public ticket either.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where reference = current_setting('test.public_ref');
  if v_count = 0 then
    raise notice 'PASS 4: an unrelated authenticated user cannot read the public ticket';
  else
    raise notice 'FAIL 4: unrelated authenticated user read the public ticket';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. A Site Admin CAN read the public ticket.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where reference = current_setting('test.public_ref');
  if v_count = 1 then
    raise notice 'PASS 5: Site Admin can read the public ticket';
  else
    raise notice 'FAIL 5: Site Admin read % rows (expected 1)', v_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Rate limit: a 4th submission from the same email within the hour
--    is rejected (limit is 3).
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_rejected boolean := false;
begin
  perform public.submit_public_support_ticket('Test Visitor', 'test.visitor.pst@example.com', 'bug', 'Test 2', 'desc', null);
  perform public.submit_public_support_ticket('Test Visitor', 'test.visitor.pst@example.com', 'bug', 'Test 3', 'desc', null);
  begin
    perform public.submit_public_support_ticket('Test Visitor', 'test.visitor.pst@example.com', 'bug', 'Test 4', 'desc', null);
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 6: 4th submission from the same email within the hour is rejected';
  else
    raise notice 'FAIL 6: rate limit did not reject the 4th submission';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. update_support_ticket_status still works on a public ticket
--    (the old "created_by_user_id is null means not found" bug would
--    incorrectly raise "Support ticket not found" here).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_status text;
  v_notif_count int;
begin
  select id into v_id from public.support_tickets where reference = current_setting('test.public_ref');
  perform public.update_support_ticket_status(v_id, 'in_progress', 'We are looking into it.', null);
  select status into v_status from public.support_tickets where id = v_id;
  -- No in-app notification exists for a public ticket -- there is no
  -- account to notify (the real reply channel is email, sent by the
  -- Next.js action layer, not this RPC). Confirm none was created.
  select count(*) into v_notif_count from public.notifications where data->>'support_ticket_id' = v_id::text;
  if v_status = 'in_progress' and v_notif_count = 0 then
    raise notice 'PASS 7: status update succeeds on a public ticket, and correctly creates no in-app notification';
  else
    raise notice 'FAIL 7: status=% notif_count=% (expected in_progress, 0)', v_status, v_notif_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. update_support_ticket_category (the new category inline-edit)
--    also works on a public ticket, manage-level Site Admin only.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_category text;
begin
  select id into v_id from public.support_tickets where reference = current_setting('test.public_ref');
  perform public.update_support_ticket_category(v_id, 'data_club_information');
  select category into v_category from public.support_tickets where id = v_id;
  if v_category = 'data_club_information' then
    raise notice 'PASS 8: category update succeeds on a public ticket';
  else
    raise notice 'FAIL 8: category=% (expected data_club_information)', v_category;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. A read_only Site Admin cannot change category (manage-only).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_rejected boolean := false;
begin
  select id into v_id from public.support_tickets where reference = current_setting('test.public_ref');
  begin
    perform public.update_support_ticket_category(v_id, 'bug');
  exception when others then
    v_rejected := true;
  end;
  if v_rejected then
    raise notice 'PASS 9: read-only Site Admin cannot change category';
  else
    raise notice 'FAIL 9: read-only Site Admin was able to change category';
  end if;
end $$;
rollback;
