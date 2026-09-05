-- Manual verification for Message Management (Phase 5): reporting a
-- message, moderator review/resolve actions, the auditable content-reveal
-- RPC, and the metadata-only admin_message_overview view. NOT a
-- migration -- never applied automatically by `db reset`. Run by hand
-- against local Supabase, AFTER permission_matrix.sql:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/message_management.sql
--
-- Self-contained: creates a Full Site Admin (00...0020), a Message
-- Moderator (00...0021), a Club Data Admin (00...0022, deliberately
-- restricted -- must NOT be able to open message content), and one
-- fixture_messages row on permission_matrix.sql's own Burnley/Rossendale
-- fixture-adjacent fixtures. IDs 0020-0022 are deliberately outside the
-- 0000-0018 range every other test file's shared fixture ids already use
-- (see supabase/tests/README.md) -- a real ID collision with
-- admin_user_management.sql/permission_management.sql's own 0014-0016
-- test users was caught and fixed here: those files' users unexpectedly
-- inherited this file's site_admins rows (via `on conflict do nothing`
-- silently skipping their own insert), giving a supposedly-scoped Team
-- Admin/View Only/revoked test user blanket is_site_admin() authority and
-- breaking 7 of that file's own scoping assertions. Most scenarios below
-- roll back.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.msg.mgmt.full@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.msg.moderator@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.msg.clubdata@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000020', 'Test', 'MsgMgmtFull', 'test.msg.mgmt.full@ovalball.local'),
    ('00000000-0000-0000-0000-000000000021', 'Test', 'MsgModerator', 'test.msg.moderator@ovalball.local'),
    ('00000000-0000-0000-0000-000000000022', 'Test', 'MsgClubData', 'test.msg.clubdata@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000020', 'active', 'full')
  on conflict (user_id) do update set status = 'active', admin_role = 'full';
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000021', 'active', 'message_moderator')
  on conflict (user_id) do update set status = 'active', admin_role = 'message_moderator';
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000022', 'active', 'club_data')
  on conflict (user_id) do update set status = 'active', admin_role = 'club_data';
end $$;

-- A real message on Burnley U12 A's own fixture (permission_matrix.sql
-- creates no fixtures, so this file creates its own minimal one), sent by
-- Burnley's admin (0002).
do $$
declare
  v_fixture_id uuid;
begin
  insert into public.fixtures (id, owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Home', 'Message Mgmt Test Opponent', '2026-11-01', 'Planned', 'site_admin_manual')
  on conflict (id) do nothing;

  insert into public.fixture_messages (id, fixture_id, sender_user_id, body)
  values ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'This is a private operational message about the fixture.')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running Message Management scenarios. ==='

-- ------------------------------------------------------------
-- 1. A real conversation participant (Rossendale admin, opponent side has
--    no team here, so use Burnley's own Coach 0006 who has team_permissions
--    on U12 A) can report the message.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
begin
  perform public.report_fixture_message('70000000-0000-0000-0000-000000000001', 'Contains inappropriate content.');
  raise notice 'PASS 1: a real conversation participant can report a message';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Someone with no relationship to this conversation (Parent 0007,
--    unrelated to Burnley U12 A) cannot report it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  perform public.report_fixture_message('70000000-0000-0000-0000-000000000001', 'Trying to report something unrelated to me.');
  raise notice 'FAIL 2: an unrelated user reported a message they cannot access';
exception when others then
  raise notice 'PASS 2: unrelated user blocked from reporting (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Report actually persists (committed) so later scenarios have a real
--    open report to work with.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
select public.report_fixture_message('70000000-0000-0000-0000-000000000001', 'Contains inappropriate content.');
commit;

do $$
declare
  v_status text;
begin
  select report_status into v_status from public.fixture_messages where id = '70000000-0000-0000-0000-000000000001';
  if v_status = 'open' then
    raise notice 'PASS 3: report_status is open after reporting';
  else
    raise notice 'FAIL 3: expected open, got %', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. admin_message_overview shows the conversation with an open report,
--    to EVERY Site Admin profile (metadata only) -- including the
--    restricted Club Data Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';
do $$
declare
  v_has_report boolean;
begin
  select has_open_report into v_has_report from public.admin_message_overview where fixture_id = '60000000-0000-0000-0000-000000000001';
  if v_has_report then
    raise notice 'PASS 4: Club Data Admin (restricted) can see conversation METADATA including the open-report flag';
  else
    raise notice 'FAIL 4: expected has_open_report = true, got % (or row missing)', v_has_report;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. A restricted Site Admin (Club Data Admin) CANNOT open message
--    content -- this is the core privacy requirement.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_get_message_thread_content(p_fixture_id => '60000000-0000-0000-0000-000000000001');
  raise notice 'FAIL 5: Club Data Admin opened message content (% rows)', v_count;
exception when others then
  raise notice 'PASS 5: Club Data Admin blocked from opening message content (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Message Moderator CAN open message content, and it's the real body.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';
do $$
declare
  v_body text;
begin
  select body into v_body from public.admin_get_message_thread_content(p_fixture_id => '60000000-0000-0000-0000-000000000001') limit 1;
  if v_body = 'This is a private operational message about the fixture.' then
    raise notice 'PASS 6: Message Moderator can open real message content';
  else
    raise notice 'FAIL 6: expected the real body, got %', v_body;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Opening content wrote an audit_log row (auditable reveal).
-- ------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.audit_log where table_name = 'fixture_messages_content_view' and record_id = '60000000-0000-0000-0000-000000000001';
  if v_count >= 1 then
    raise notice 'PASS 7: opening message content wrote an audit_log row';
  else
    raise notice 'FAIL 7: no audit_log row found for the content view';
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. Full Site Admin CAN open message content too.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_get_message_thread_content(p_fixture_id => '60000000-0000-0000-0000-000000000001');
  if v_count = 1 then
    raise notice 'PASS 8: Full Site Admin can open message content';
  else
    raise notice 'FAIL 8: expected 1 row, got %', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. A restricted Site Admin (Club Data Admin) cannot mark a report
--    reviewed or resolve it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';
do $$
begin
  perform public.mark_message_report_reviewed('70000000-0000-0000-0000-000000000001');
  raise notice 'FAIL 9: Club Data Admin marked a report reviewed';
exception when others then
  raise notice 'PASS 9: Club Data Admin blocked from marking a report reviewed (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Message Moderator can mark the report reviewed, then resolve it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';
do $$
declare
  v_status text;
begin
  perform public.mark_message_report_reviewed('70000000-0000-0000-0000-000000000001');
  select report_status into v_status from public.fixture_messages where id = '70000000-0000-0000-0000-000000000001';
  if v_status = 'reviewed' then
    raise notice 'PASS 10a: Message Moderator marked the report reviewed';
  else
    raise notice 'FAIL 10a: expected reviewed, got %', v_status;
  end if;

  perform public.resolve_message_report('70000000-0000-0000-0000-000000000001');
  select report_status into v_status from public.fixture_messages where id = '70000000-0000-0000-0000-000000000001';
  if v_status = 'resolved' then
    raise notice 'PASS 10b: Message Moderator resolved the report';
  else
    raise notice 'FAIL 10b: expected resolved, got %', v_status;
  end if;
end $$;
rollback;
