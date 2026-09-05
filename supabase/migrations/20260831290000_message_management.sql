-- Message Management (Phase 5): an operational moderation/support tool,
-- deliberately NOT a casual surveillance inbox. Adds reporting fields to
-- the existing public.fixture_messages table (no second messaging system,
-- no duplicate conversation model), an auditable content-reveal RPC gated
-- to Full Site Admin / Message Moderator specifically, and a
-- metadata-only admin overview (never selects `body`) safe for every
-- Site Admin profile to browse.

-- ============================================================
-- 1. Reporting fields on the existing table. Deliberately message-level
--    (report a specific message), not a separate table -- a "reported
--    thread" in the admin console is simply any conversation containing
--    at least one message with report_status = 'open'.
-- ============================================================

alter table public.fixture_messages
  add column reported_at timestamptz,
  add column reported_by uuid references auth.users(id),
  add column report_reason text,
  add column report_status text check (report_status in ('open', 'reviewed', 'resolved')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id);

comment on column public.fixture_messages.report_status is
  'null = never reported. open/reviewed/resolved once reported_at is set -- reviewed/resolved are moderator actions (mark_message_report_reviewed / resolve_message_report), never a plain UPDATE.';

create index fixture_messages_report_status_idx on public.fixture_messages (report_status) where report_status = 'open';

-- ============================================================
-- 2. report_fixture_message -- any real participant in the conversation
--    (the existing can_access_fixture_conversation boundary, unchanged)
--    may report a message within it. Not Site-Admin-only: reporting is
--    how a report reaches Message Management in the first place.
-- ============================================================

create or replace function public.report_fixture_message(p_message_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.fixture_messages;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to report a message.' using errcode = '42501';
  end if;
  select * into v_msg from public.fixture_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found.';
  end if;
  if not internal.can_access_fixture_conversation(v_msg.fixture_id, v_msg.fixture_request_id) then
    raise exception 'You do not have access to this conversation.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to report a message.';
  end if;

  update public.fixture_messages
  set reported_at = now(), reported_by = auth.uid(), report_reason = trim(p_reason), report_status = 'open'
  where id = p_message_id;
end;
$$;

revoke execute on function public.report_fixture_message(uuid, text) from public;
grant execute on function public.report_fixture_message(uuid, text) to authenticated;

-- ============================================================
-- 3. Moderator actions. Full Site Admin / Message Moderator only.
-- ============================================================

create or replace function public.mark_message_report_reviewed(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'message_moderator') then
    raise exception 'Only a Full Site Admin or Message Moderator may review a reported message.' using errcode = '42501';
  end if;
  update public.fixture_messages
  set report_status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_message_id and report_status = 'open';
end;
$$;

create or replace function public.resolve_message_report(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'message_moderator') then
    raise exception 'Only a Full Site Admin or Message Moderator may resolve a reported message.' using errcode = '42501';
  end if;
  update public.fixture_messages
  set report_status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_message_id and report_status in ('open', 'reviewed');
end;
$$;

revoke execute on function public.mark_message_report_reviewed(uuid) from public;
revoke execute on function public.resolve_message_report(uuid) from public;
grant execute on function public.mark_message_report_reviewed(uuid) to authenticated;
grant execute on function public.resolve_message_report(uuid) to authenticated;

-- ============================================================
-- 4. Content reveal. fixture_messages' own base-table RLS
--    (fixture_messages_select_scoped -> can_access_fixture_conversation)
--    stays unchanged and deliberately broad for is_site_admin() -- that is
--    the SAME boundary the already-shipped Fixture Management "send an
--    operational message" feature (Phase 4) relies on for every Site Admin
--    profile with fixture authority, since can_access_fixture_conversation
--    composes can_manage_team/can_manage_club_fixtures, which themselves
--    already grant is_site_admin() unconditionally -- narrowing the base
--    table further would silently break that already-verified feature for
--    every non-Full/non-Message-Moderator profile.
--
--    admin_get_message_thread_content is instead the SANCTIONED path the
--    Message Management console itself uses to reveal content: it does
--    its own Full/Message-Moderator check before returning body text, and
--    writes its own audit_log row for the reveal action (the brief's
--    "opening message content... should itself be auditable"). This is an
--    application-layer restriction layered on top of the existing broad
--    RLS, not a replacement for it -- a technically-capable restricted
--    Site Admin could still read message bodies via a direct table query,
--    the same way they always could for Phase 4's own feature. Closing
--    that fully would mean narrowing can_manage_team/can_manage_club_fixtures
--    itself, which gates fixture/club writes far beyond messaging and is
--    out of scope for this pass -- documented here rather than silently
--    left unstated.
-- ============================================================

create or replace function public.admin_get_message_thread_content(p_fixture_id uuid default null, p_fixture_request_id uuid default null)
returns table(
  id uuid,
  sender_user_id uuid,
  sender_name text,
  body text,
  created_at timestamptz,
  report_status text,
  report_reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'message_moderator') then
    raise exception 'Only a Full Site Admin or Message Moderator may open message content.' using errcode = '42501';
  end if;
  if p_fixture_id is null and p_fixture_request_id is null then
    raise exception 'A fixture or fixture request must be specified.';
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('fixture_messages_content_view', coalesce(p_fixture_id, p_fixture_request_id), 'update', auth.uid(),
    jsonb_build_object('fixture_id', p_fixture_id, 'fixture_request_id', p_fixture_request_id, 'viewed_at', now()));

  return query
  select fm.id, fm.sender_user_id, coalesce(p.first_name || ' ' || p.surname, 'Unknown'), fm.body, fm.created_at, fm.report_status, fm.report_reason
  from public.fixture_messages fm
  left join public.profiles p on p.id = fm.sender_user_id
  where (p_fixture_id is not null and fm.fixture_id = p_fixture_id)
     or (p_fixture_request_id is not null and fm.fixture_request_id = p_fixture_request_id)
  order by fm.created_at;
end;
$$;

revoke execute on function public.admin_get_message_thread_content(uuid, uuid) from public;
grant execute on function public.admin_get_message_thread_content(uuid, uuid) to authenticated;

-- ============================================================
-- 5. admin_message_overview -- metadata only, NEVER selects `body`, safe
--    for every Site Admin profile (matches "show metadata first"). One
--    row per conversation (fixture_id or fixture_request_id).
-- ============================================================

create view public.admin_message_overview
  with (security_invoker = true) as
select
  coalesce(fm.fixture_id::text, 'req:' || fm.fixture_request_id::text) as conversation_key,
  case when fm.fixture_id is not null then 'fixture' else 'request' end as kind,
  fm.fixture_id,
  fm.fixture_request_id,
  count(*) as message_count,
  max(fm.created_at) as last_activity_at,
  min(fm.created_at) as first_message_at,
  count(*) filter (where fm.report_status = 'open') as open_report_count,
  count(*) filter (where fm.report_status = 'reviewed') as reviewed_report_count,
  bool_or(fm.report_status = 'open') as has_open_report,
  fx_owning_cd.name as fixture_owning_club_name,
  fx_opp_cd.name as fixture_opponent_club_name,
  fx_t.display_name as fixture_owning_team_name,
  req_cd.name as request_requesting_club_name,
  req_opp_cd.name as request_opponent_club_name
from public.fixture_messages fm
left join public.fixtures fx on fx.id = fm.fixture_id
left join public.teams fx_t on fx_t.id = fx.owning_team_id
left join public.clubs fx_c on fx_c.id = fx_t.club_id
left join public.club_directory fx_owning_cd on fx_owning_cd.id = fx_c.directory_id
left join public.club_directory fx_opp_cd on fx_opp_cd.id = fx.opponent_directory_id
left join public.fixture_requests freq on freq.id = fm.fixture_request_id
left join public.fixture_request_groups frg on frg.id = freq.group_id
left join public.clubs req_c on req_c.id = frg.requesting_club_id
left join public.club_directory req_cd on req_cd.id = req_c.directory_id
left join public.clubs req_opp_c on req_opp_c.id = frg.opponent_club_id
left join public.club_directory req_opp_cd on req_opp_cd.id = req_opp_c.directory_id
group by
  fm.fixture_id, fm.fixture_request_id, fx_owning_cd.name, fx_opp_cd.name, fx_t.display_name,
  req_cd.name, req_opp_cd.name;

grant select on public.admin_message_overview to authenticated;

comment on view public.admin_message_overview is
  'Metadata-only listing for Message Management -- deliberately never selects fixture_messages.body. security_invoker so it is exactly as permissive as fixture_messages'' own RLS (is_site_admin() via can_access_fixture_conversation), safe for every Site Admin profile since it carries no message content.';
