-- =====================================================================================================================
-- A REPORT STAYS WITH THE REPORT
--
-- `report_message` recorded each report in `message_reports` (the record of record, readable only by the reporter,
-- the club's Safeguarding Officer queue and Ovalball moderation) -- and ALSO stamped the reporter's id and reason on
-- the message row itself. Everybody in a conversation can read that row, including the person who was reported, so
-- `select reported_by, report_reason from fixture_messages` told them who reported them and what was said.
--
-- After this:
--   * the message row keeps only the "this has been reported" flag (`reported_at`, `report_status`), which existing
--     surfaces read and which names nobody;
--   * who reported and why live only in `message_reports`;
--   * Ovalball moderation's content view reads the reason from there (the newest report on each message);
--   * existing stamps are first carried into `message_reports` where they somehow are not already (migration
--     20270368000000 did this once; it is repeated so no report can be lost), then cleared from the message row.
-- =====================================================================================================================

insert into public.message_reports (message_id, club_id, reported_by, reason, status, reviewed_by, reviewed_at, created_at)
select m.id,
       internal.message_report_club(m.id),
       m.reported_by,
       coalesce(nullif(trim(m.report_reason), ''), '(no reason recorded)'),
       case when m.report_status in ('open','reviewed','resolved') then m.report_status else 'open' end,
       m.reviewed_by, m.reviewed_at,
       coalesce(m.reported_at, m.created_at)
from public.fixture_messages m
where m.reported_at is not null
  and m.reported_by is not null
  and not exists (select 1 from public.message_reports r where r.message_id = m.id and r.reported_by = m.reported_by);

update public.fixture_messages
   set reported_by = null,
       report_reason = null
 where reported_by is not null or report_reason is not null;

create or replace function public.report_message(p_message_id uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_msg public.fixture_messages;
  v_club uuid;
  v_report uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to report a message.' using errcode = '42501';
  end if;
  if not internal.can('messaging.report.submit', 'self', null, null, null) then
    raise exception 'You are not authorised to report a message.' using errcode = '42501';
  end if;

  select * into v_msg from public.fixture_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found.';
  end if;

  -- You may only report a message you can actually see. This is the same access test the rest of
  -- Messenger uses, so reporting can never become a way to confirm a message exists.
  if not internal.can_access_message(v_msg) then
    raise exception 'You do not have access to this conversation.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to report a message.';
  end if;
  if v_msg.sender_user_id = auth.uid() then
    raise exception 'You cannot report your own message.' using errcode = '42501';
  end if;

  v_club := internal.message_report_club(p_message_id);

  -- ONE ROW PER REPORT (section T). A second reporter gets their own row; the first person's reason
  -- and identity are never overwritten. Reporting twice yourself is idempotent rather than an error,
  -- because a person pressing the button again is not doing anything wrong.
  insert into public.message_reports (message_id, club_id, reported_by, reason)
  values (p_message_id, v_club, auth.uid(), trim(p_reason))
  on conflict (message_id, reported_by) where status = 'open'
  do update set reason = excluded.reason
  returning id into v_report;

  -- THE FLAG, NOT THE REPORTER. The message row is readable by everybody in the conversation -- the
  -- reported person included -- so it says only that the message has been reported. Who reported it
  -- and why stay in message_reports.
  update public.fixture_messages
  set reported_at = coalesce(reported_at, now()),
      report_status = case when report_status in ('reviewed','resolved') then report_status else 'open' end
  where id = p_message_id;

  return v_report;
end;
$function$;

create or replace function public.admin_get_message_thread_content(p_fixture_id uuid default null::uuid, p_fixture_request_id uuid default null::uuid)
 returns table(id uuid, sender_user_id uuid, sender_name text, body text, created_at timestamp with time zone, report_status text, report_reason text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may open message content.' using errcode = '42501';
  end if;
  if p_fixture_id is null and p_fixture_request_id is null then
    raise exception 'A fixture or fixture request must be specified.';
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('fixture_messages_content_view', coalesce(p_fixture_id, p_fixture_request_id), 'update', auth.uid(),
    jsonb_build_object('fixture_id', p_fixture_id, 'fixture_request_id', p_fixture_request_id, 'viewed_at', now()));

  -- The reason now comes from the report itself (the newest one on each message), not a copy on the message row.
  return query
  select fm.id, fm.sender_user_id, coalesce(p.first_name || ' ' || p.surname, 'Unknown'), fm.body, fm.created_at, fm.report_status,
         (select r.reason from public.message_reports r where r.message_id = fm.id order by r.created_at desc limit 1)
  from public.fixture_messages fm
  left join public.profiles p on p.id = fm.sender_user_id
  where (p_fixture_id is not null and fm.fixture_id = p_fixture_id)
     or (p_fixture_request_id is not null and fm.fixture_request_id = p_fixture_request_id)
  order by fm.created_at;
end;
$function$;
