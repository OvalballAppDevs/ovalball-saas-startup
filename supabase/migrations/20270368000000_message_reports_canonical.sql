-- Slice 4F -- part 2: reporting a message (Phase 2 section T "Reports", design J.10 lines 519-520).
--
-- WHAT WAS WRONG
--
-- Section T is one sentence long and the implementation did not satisfy it:
--
--   "messaging.report.submit routes to the club SO queue (messaging.moderation.club_review) AND
--    Ovalball moderation (site.messages.moderate). Each report is its own row (no overwrite)."
--
-- Reporting a message stamped four columns ON THE MESSAGE ROW -- reported_at, reported_by,
-- report_reason, report_status. So a message could only ever hold ONE report. A second person
-- reporting the same message silently overwrote the first person's reason, reporter and timestamp,
-- and the first report simply ceased to exist. For a safeguarding-adjacent surface that is the
-- wrong direction of failure: the case that most needs a second reporter is the one where the first
-- report was not acted on.
--
-- There was also no club queue at all. A report went to Ovalball via a support ticket; the club's
-- own Safeguarding Officer had nothing to look at.
--
-- WHAT THIS MIGRATION DOES
--
--   1. public.message_reports -- one row per report, never overwritten.
--   2. Backfills every existing stamped report into a row, so no report already made is lost.
--   3. public.report_message -- the canonical entry point, messaging.report.submit.
--   4. public.club_message_reports -- the club queue, messaging.moderation.club_review (SO).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- It builds no Safeguarding Officer nomination, confirmation or invitation. Locked decision D-S4-2
-- keeps that for 4G. It does not need them: Slice 2 already models the role -- role_assignments
-- carries confirmation_state and the constraint (role_key = 'SAFEGUARDING_OFFICER') = (confirmation_state
-- is not null) -- and Slice 3 already seeded the SO bundle with messaging.moderation.club_review.
-- This slice routes to whoever holds the capability and asks no question about how they got it.

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.fixture_messages(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  reported_by uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.message_reports is
  'Slice 4F (section T): one row per report of a message, never overwritten. The club_id is the club '
  'whose Safeguarding Officer queue the report joins; it is null when a message belongs to no club '
  'conversation, in which case only Ovalball moderation sees it.';

create index if not exists message_reports_message_idx on public.message_reports (message_id);
create index if not exists message_reports_club_open_idx on public.message_reports (club_id, status, created_at desc);
create unique index if not exists message_reports_one_open_per_reporter_idx
  on public.message_reports (message_id, reported_by) where status = 'open';

comment on index public.message_reports_one_open_per_reporter_idx is
  'One OPEN report per person per message: a second reporter always gets their own row, but one '
  'person cannot inflate the queue by reporting the same message repeatedly.';

alter table public.message_reports enable row level security;

-- The club whose queue a report belongs to, resolved from the message. A fixture conversation
-- belongs to the owning team's club; a team conversation to that team's club; a club conversation to
-- the club that raised it. A direct message belongs to no club, and goes to Ovalball alone.
create or replace function internal.message_report_club(p_message_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.club_id from public.fixture_messages m
       join public.fixtures f on f.id = m.fixture_id
       join public.teams t on t.id = f.owning_team_id
      where m.id = p_message_id),
    (select t.club_id from public.fixture_messages m
       join public.teams t on t.id = m.team_conversation_id
      where m.id = p_message_id),
    (select cc.requesting_club_id from public.fixture_messages m
       join public.club_conversations cc on cc.id = m.club_conversation_id
      where m.id = p_message_id)
  );
$$;

-- Backfill, before the new entry point exists, so nothing reported so far is lost.
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

-- Row access -------------------------------------------------------------------------------------
-- A report is visible to the person who made it, to the club's Safeguarding Officer queue, and to
-- Ovalball moderation. Nobody else -- not the club's admins, not the reported person.
drop policy if exists message_reports_select_scoped on public.message_reports;
create policy message_reports_select_scoped on public.message_reports
for select using (
  reported_by = (select auth.uid())
  or internal.has_site_capability('site.messages.moderate')
  or (club_id is not null and internal.can('messaging.moderation.club_review', 'club', club_id, null, null))
);

comment on policy message_reports_select_scoped on public.message_reports is
  'Slice 4F: the reporter, the club Safeguarding Officer queue (messaging.moderation.club_review) '
  'and Ovalball moderation. A Club Admin is deliberately NOT included: section T routes reports to '
  'the SO, and a report may be about a Club Admin.';

-- No browser role writes this table directly; every change is a SECURITY DEFINER RPC below.
revoke all on public.message_reports from anon, authenticated;
grant select on public.message_reports to authenticated;

-- Reporting ----------------------------------------------------------------------------------------
create or replace function public.report_message(p_message_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  -- The stamp on the message stays, as a denormalised "this has been reported" flag that existing
  -- surfaces already read. It is no longer the record of record -- message_reports is.
  update public.fixture_messages
  set reported_at = coalesce(reported_at, now()),
      reported_by = coalesce(reported_by, auth.uid()),
      report_reason = coalesce(nullif(trim(report_reason), ''), trim(p_reason)),
      report_status = case when report_status in ('reviewed','resolved') then report_status else 'open' end
  where id = p_message_id;

  return v_report;
end;
$$;

comment on function public.report_message(uuid, text) is
  'Slice 4F (section T): messaging.report.submit. One row per report, routed to the club '
  'Safeguarding Officer queue and to Ovalball moderation. Replaces the overwrite-in-place stamp.';

revoke all on function public.report_message(uuid, text) from public, anon;
grant execute on function public.report_message(uuid, text) to authenticated;

-- The club queue -------------------------------------------------------------------------------------
create or replace function public.club_message_reports(p_club_id uuid)
returns table (
  id uuid, message_id uuid, reason text, status text, created_at timestamptz,
  reporter_name text, message_body text, message_sent_at timestamptz, message_deleted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (internal.can('messaging.moderation.club_review', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.messages.moderate')) then
    raise exception 'You are not authorised to review this club''s message reports.' using errcode = '42501';
  end if;
  return query
    select r.id, r.message_id, r.reason, r.status, r.created_at,
           trim(coalesce(p.first_name,'') || ' ' || coalesce(p.surname,'')) as reporter_name,
           m.body, m.created_at, m.deleted_at
    from public.message_reports r
    join public.fixture_messages m on m.id = r.message_id
    left join public.profiles p on p.id = r.reported_by
    where r.club_id = p_club_id
    order by r.created_at desc;
end;
$$;

comment on function public.club_message_reports(uuid) is
  'Slice 4F (J.10 line 520): the club Safeguarding Officer''s report queue. The message body is '
  'returned even after a soft delete, because the evidence has to outlive the message.';

revoke all on function public.club_message_reports(uuid) from public, anon;
grant execute on function public.club_message_reports(uuid) to authenticated;

do $$
begin
  if (select count(*) from public.fixture_messages where reported_at is not null)
     > (select count(*) from public.message_reports) then
    raise exception 'the backfill lost reports: % stamped messages, % report rows',
      (select count(*) from public.fixture_messages where reported_at is not null),
      (select count(*) from public.message_reports);
  end if;
end $$;
