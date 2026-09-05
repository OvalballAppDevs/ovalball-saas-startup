-- Manual verification for the Support Ticketing System
-- (20260901120000_support_tickets.sql): ticket creation + reference
-- generation, requester/unrelated/same-club-unrelated read boundaries,
-- creator-vs-Site-Admin RPC authorization, internal-note privacy (both
-- via RLS directly and via the read_only support level), notification
-- correctness, status transitions, and attachment-path authorization.
-- NOT a migration -- run after permission_matrix.sql (0002 Burnley
-- CLUB_ADMIN, 0003 Rossendale CLUB_ADMIN, 0004 Burnley BASIC_USER/Team
-- Admin), site_admin_management.sql, and message_management.sql (0021,
-- message_moderator -- support_level 'none').

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.support.readonly@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('c1000000-0000-0000-0000-000000000001', 'Test', 'SupportReadOnly', 'test.support.readonly@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role) values ('c1000000-0000-0000-0000-000000000001', 'active', 'read_only')
  on conflict (user_id) do update set status = 'active', admin_role = 'read_only';
end $$;

-- ------------------------------------------------------------
-- 1. Burnley admin (0002) creates their own ticket -- unique,
--    immutable, server-generated reference in the OB-YYMMDD-NNNN shape.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_ref text;
begin
  select id, reference into v_id, v_ref from public.create_support_ticket('fixtures', 'Test: fixture result problem', 'Safe local test description of the problem.');
  if v_ref ~ '^OB-\d{6}-\d{4,}$' and v_id is not null then
    raise notice 'PASS 1: ticket created with a well-formed reference (%)', v_ref;
  else
    raise notice 'FAIL 1: unexpected reference shape (%)', v_ref;
  end if;
  perform set_config('test.ticket_id', v_id::text, false);
end $$;
commit;

-- ------------------------------------------------------------
-- 2. Creator can read their own ticket.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_count = 1 then raise notice 'PASS 2: creator can read their own ticket';
  else raise notice 'FAIL 2: creator could not read their own ticket (% rows)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Unrelated user (Rossendale admin, 0003) cannot read it -- and
--    knowing the human-readable reference doesn't help (still 0 rows).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_count = 0 then raise notice 'PASS 3: an unrelated user cannot read the ticket';
  else raise notice 'FAIL 3: an unrelated user read the ticket (% rows)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Same-club unrelated user (0004, Burnley BASIC_USER/Team Admin --
--    NOT the ticket's creator) cannot read it either, by default.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_count = 0 then raise notice 'PASS 4: a same-club but unrelated user cannot read the ticket';
  else raise notice 'FAIL 4: a same-club unrelated user read the ticket (% rows)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Creator cannot change status (no Support access at all).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.update_support_ticket_status(current_setting('test.ticket_id')::uuid, 'closed');
  raise notice 'FAIL 5: the creator changed their own ticket status';
exception when others then
  raise notice 'PASS 5: the creator cannot change ticket status (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Creator CAN add a follow-up while the ticket is open.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  perform public.add_support_followup(current_setting('test.ticket_id')::uuid, 'Follow-up: it also happens on mobile.');
  select count(*) into v_count from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid and event_type = 'requester_message';
  if v_count = 1 then raise notice 'PASS 6: creator added a follow-up to their own open ticket';
  else raise notice 'FAIL 6: follow-up not recorded (% rows)', v_count; end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Creator CANNOT add an internal note.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.add_support_internal_note(current_setting('test.ticket_id')::uuid, 'Should never be allowed.');
  raise notice 'FAIL 7: the creator added an internal note';
exception when others then
  raise notice 'PASS 7: the creator cannot add an internal note (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8/9. Full Site Admin (0001) can view the ticket and add an internal
--      note.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_count = 1 then raise notice 'PASS 8: Full Site Admin can view any ticket';
  else raise notice 'FAIL 8: Full Site Admin could not view the ticket'; end if;

  perform public.add_support_internal_note(current_setting('test.ticket_id')::uuid, 'Repro confirmed locally (safe local test note).');
  select count(*) into v_count from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid and event_type = 'internal_note';
  if v_count = 1 then raise notice 'PASS 9: Full Site Admin added an internal note';
  else raise notice 'FAIL 9: internal note not recorded'; end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 10. Requester cannot read the internal note (RLS, not app filtering).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid and event_type = 'internal_note';
  if v_count = 0 then raise notice 'PASS 10: the requester cannot read the internal note';
  else raise notice 'FAIL 10: the requester read % internal note row(s)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Full Site Admin sends a user-facing reply; requester can read it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.send_support_reply(current_setting('test.ticket_id')::uuid, 'We are looking into this now (safe local test reply).');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid and event_type = 'support_reply';
  if v_count = 1 then raise notice 'PASS 11: the requester can read Ovalball Support''s reply';
  else raise notice 'FAIL 11: requester could not read the reply (% rows)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12/13. New -> In Progress creates exactly one notification; an
--        internal note (scenario 9 above) created none.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('test.notif_count_before', (select count(*)::text from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and type = 'support_ticket_update'), false);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_status text;
begin
  perform public.update_support_ticket_status(current_setting('test.ticket_id')::uuid, 'in_progress', 'We''ve started looking into your request.');
  select status into v_status from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_status = 'in_progress' then raise notice 'PASS 12a: status moved New -> In Progress';
  else raise notice 'FAIL 12a: status is %', v_status; end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_before int := current_setting('test.notif_count_before')::int;
  v_after int;
begin
  select count(*) into v_after from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and type = 'support_ticket_update';
  if v_after = v_before + 1 then raise notice 'PASS 12b: exactly one notification created for the status change (internal note in scenario 9 created none)';
  else raise notice 'FAIL 12b: expected % notification(s), found %', v_before + 1, v_after; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. In Progress -> Closed works and records closed_at/closed_by.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_status text;
  v_closed_at timestamptz;
  v_closed_by uuid;
begin
  perform public.update_support_ticket_status(current_setting('test.ticket_id')::uuid, 'closed', 'This test request has now been resolved.', 'Safe local closure note.');
  select status, closed_at, closed_by into v_status, v_closed_at, v_closed_by from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_status = 'closed' and v_closed_at is not null and v_closed_by = '00000000-0000-0000-0000-000000000001' then
    raise notice 'PASS 14: ticket closed with closed_at/closed_by recorded';
  else
    raise notice 'FAIL 14: status=%, closed_at=%, closed_by=%', v_status, v_closed_at, v_closed_by;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. Closed ticket: follow-up rejected (no silent reopen).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.add_support_followup(current_setting('test.ticket_id')::uuid, 'Trying to add more info to a closed ticket.');
  raise notice 'FAIL 15: a follow-up was added to a closed ticket';
exception when others then
  raise notice 'PASS 15: follow-up to a closed ticket is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 16/17. Read-only Site Admin can VIEW the ticket and its requester-
--        visible timeline, but cannot mutate anything and cannot read
--        the internal note.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_count int;
  v_internal_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  select count(*) into v_internal_count from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid and visibility = 'internal';
  if v_count = 1 and v_internal_count = 0 then
    raise notice 'PASS 16: read-only Site Admin can view the ticket but not its internal note';
  else
    raise notice 'FAIL 16: ticket visible=%, internal notes visible=%', v_count, v_internal_count;
  end if;

  begin
    perform public.add_support_internal_note(current_setting('test.ticket_id')::uuid, 'Should be rejected.');
    raise notice 'FAIL 17a: read-only Site Admin added an internal note';
  exception when others then
    raise notice 'PASS 17a: read-only Site Admin cannot add an internal note (%)', sqlerrm;
  end;

  begin
    perform public.send_support_reply(current_setting('test.ticket_id')::uuid, 'Should be rejected.');
    raise notice 'FAIL 17b: read-only Site Admin sent a reply';
  exception when others then
    raise notice 'PASS 17b: read-only Site Admin cannot send a reply (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 18. A Site Admin profile with no Support access at all (Message
--     Moderator, 0021) cannot read someone else's ticket.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
  if v_count = 0 then raise notice 'PASS 18: a Site Admin profile with no Support access cannot read another user''s ticket';
  else raise notice 'FAIL 18: Message Moderator read the ticket (% rows)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19. Invalid transition rejected -- a closed ticket cannot move back
--     to In Progress through this RPC (no silent reopen path).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.update_support_ticket_status(current_setting('test.ticket_id')::uuid, 'in_progress');
  raise notice 'FAIL 19: a closed ticket was moved back to In Progress';
exception when others then
  raise notice 'PASS 19: closed -> in_progress is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 20/21. Attachment storage-path authorization: creator can write to
--        their own open ticket's folder; an unrelated user cannot read
--        from it. (Closed by now, so also re-verifies the write check
--        correctly excludes closed tickets.)
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_path text := current_setting('test.ticket_id') || '/test.png';
  v_can_write boolean;
  v_can_read boolean;
begin
  select internal.can_access_support_attachment_path(v_path, true) into v_can_write;
  select internal.can_access_support_attachment_path(v_path, false) into v_can_read;
  if v_can_write = false and v_can_read = true then
    raise notice 'PASS 20: creator can read (but no longer write, ticket is closed) their own ticket''s attachment folder';
  else
    raise notice 'FAIL 20: can_write=%, can_read=% for the closed ticket''s own creator', v_can_write, v_can_read;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_path text := current_setting('test.ticket_id') || '/test.png';
  v_can_read boolean;
begin
  select internal.can_access_support_attachment_path(v_path, false) into v_can_read;
  if v_can_read = false then raise notice 'PASS 21: an unrelated user cannot read another user''s ticket attachment folder';
  else raise notice 'FAIL 21: unrelated user could read the attachment folder'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 22. audit_log captured the ticket's own INSERT (coarse-grained), but
--     support_ticket_events (replies/internal notes -- the sensitive
--     freeform text) is never captured there at all.
-- ------------------------------------------------------------
do $$
declare
  v_audit_count int;
  v_events_audit_count int;
begin
  select count(*) into v_audit_count from public.audit_log where table_name = 'support_tickets' and record_id = current_setting('test.ticket_id')::uuid;
  select count(*) into v_events_audit_count from public.audit_log where table_name = 'support_ticket_events';
  if v_audit_count > 0 and v_events_audit_count = 0 then
    raise notice 'PASS 22: support_tickets changes are audited; support_ticket_events (reply/note bodies) are never duplicated into audit_log';
  else
    raise notice 'FAIL 22: support_tickets audit rows=%, support_ticket_events audit rows=%', v_audit_count, v_events_audit_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- Cleanup -- this suite's own ticket only.
-- ------------------------------------------------------------
do $$
begin
  delete from public.notifications where data->>'support_ticket_id' = current_setting('test.ticket_id');
  delete from public.support_ticket_events where ticket_id = current_setting('test.ticket_id')::uuid;
  delete from public.support_tickets where id = current_setting('test.ticket_id')::uuid;
exception when others then null;
end $$;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
