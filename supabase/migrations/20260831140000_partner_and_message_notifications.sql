-- Two notification gaps left by the prior session's migrations, both
-- following the exact pattern already established there
-- (internal.notify_site_admins_of_new_request /
-- internal.notify_fixture_request_recipients):
--
-- 1. club_partnerships had a notification on RESPONDING (see
--    respond_to_club_partnership in
--    20260831093000_partner_clubs_and_fixture_messages.sql) but none on the
--    initial request itself -- the receiving club never learned a request
--    existed except by remembering to check /partner-clubs.
-- 2. fixture_messages had no notification at all -- a new message was
--    silent unless the recipient happened to reopen the thread.

-- ============================================================
-- 1. PARTNER REQUEST RECEIVED
-- ============================================================

create function internal.notify_club_of_partnership_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requesting_club_name text;
begin
  select cd.name into v_requesting_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = new.requesting_club_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'partner_request_received', 'New partner club request',
    format('%s would like to share calendar availability with you.', coalesce(v_requesting_club_name, 'A club')),
    jsonb_build_object('partnership_id', new.id, 'requesting_club_id', new.requesting_club_id)
  from public.club_memberships cm
  where cm.club_id = new.partner_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

  return new;
end;
$$;

create trigger club_partnerships_notify_partner_club
  after insert on public.club_partnerships
  for each row execute function internal.notify_club_of_partnership_request();

-- ============================================================
-- 2. NEW FIXTURE MESSAGE
-- ============================================================

-- Recipients mirror internal.can_access_fixture_conversation's own OR
-- logic exactly (team official of either side, or club-level official of
-- either club) so "who gets notified" never drifts from "who is allowed to
-- read the thread" -- minus the sender themselves.
create function internal.notify_fixture_message_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_sender_name text;
begin
  select coalesce(p.first_name || ' ' || p.surname, 'Someone') into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  if new.fixture_id is not null then
    select * into v_fixture from public.fixtures where id = new.fixture_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New fixture message',
      format('%s sent a message about your fixture.', v_sender_name),
      jsonb_build_object('fixture_id', new.fixture_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and tp.permission in ('team_admin', 'coach', 'manager')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      join public.teams t on t.club_id = cm.club_id
      where t.id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    ) recipients
    where recipient <> new.sender_user_id;

  elsif new.fixture_request_id is not null then
    select * into v_req from public.fixture_requests where id = new.fixture_request_id;
    select * into v_group from public.fixture_request_groups where id = v_req.group_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New fixture message',
      format('%s sent a message about your fixture request.', v_sender_name),
      jsonb_build_object('fixture_request_id', new.fixture_request_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_req.requesting_team_id, v_req.target_team_id)
        and tp.permission in ('team_admin', 'coach', 'manager')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      where cm.club_id in (v_group.requesting_club_id, v_group.opponent_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    ) recipients
    where recipient <> new.sender_user_id;
  end if;

  return new;
end;
$$;

create trigger fixture_messages_notify_recipients
  after insert on public.fixture_messages
  for each row execute function internal.notify_fixture_message_recipients();
