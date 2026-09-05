-- Support Ticketing System. A user-to-Ovalball support record, deliberately
-- NOT modeled as a message to another club -- fixture_messages/
-- fixture_conversation_* is club<->club conversation architecture and has
-- no natural place for "Ovalball Support" as a party. Support gets its own
-- canonical table and its own event/timeline model, with `notifications`
-- (already generic) as the sole cross-surface signal into the existing
-- bell/Messages experience.

-- ============================================================
-- 1. Fixed category vocabulary -- only categories for product areas that
--    genuinely exist in Ovalball today (no Billing/Subscription: there is
--    no billing system to ask about).
-- ============================================================

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  created_by_user_id uuid not null references auth.users(id),
  club_id uuid references public.clubs(id),
  category text not null check (category in (
    'account_login', 'club_management', 'teams', 'fixtures', 'results', 'messages',
    'partner_clubs', 'calendar', 'documents', 'permissions_users', 'bug',
    'feature_question', 'data_club_information', 'privacy_account_data', 'other'
  )),
  subject text not null,
  description text not null,
  status text not null default 'new' check (status in ('new', 'in_progress', 'closed')),
  related_fixture_id uuid references public.fixtures(id),
  related_fixture_request_id uuid references public.fixture_requests(id),
  related_team_id uuid references public.teams(id),
  source_route text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users(id)
);

comment on table public.support_tickets is
  'The canonical support record -- USER <-> Ovalball Support, never a club-to-club conversation. The original subject/description are immutable history (no UPDATE path touches them); everything that happens afterward is a support_ticket_events row.';

comment on column public.support_tickets.reference is
  'Human-quotable public reference (e.g. OB-260901-0042), generated server-side from support_ticket_reference_seq -- never row-count-based, so it stays unique under concurrent inserts. This is a display convenience, never the authorization boundary: every RPC and RLS policy here keys off id, not reference.';

create unique index support_tickets_reference_idx on public.support_tickets (reference);
create index support_tickets_created_by_idx on public.support_tickets (created_by_user_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, created_at desc);

create sequence public.support_ticket_reference_seq;

create trigger set_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update on public.support_tickets for each row execute function internal.audit_row_change();

-- ============================================================
-- 2. support_ticket_events -- the single source of truth for the whole
--    timeline: the original request, status changes, the requester's own
--    follow-ups, Ovalball Support's user-facing replies, AND internal
--    notes. `visibility` is enforced in RLS itself (see below), not left
--    to a UI component to filter correctly -- an internal note can never
--    leak because a page forgot a `.filter()`.
-- ============================================================

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'status_changed', 'requester_message', 'support_reply', 'internal_note')),
  actor_user_id uuid not null references auth.users(id),
  visibility text not null check (visibility in ('requester', 'internal')),
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.support_ticket_events is
  'One row per timeline entry. visibility=internal rows (internal_note) are readable only by a support_level=manage Site Admin -- never the requester, never a support_level=view (read-only) Site Admin. Every mutation here goes through a SECURITY DEFINER RPC below; there is no direct INSERT policy for authenticated.';

create index support_ticket_events_ticket_id_idx on public.support_ticket_events (ticket_id, created_at);

create table public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  uploaded_by_user_id uuid not null references auth.users(id),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

comment on table public.support_ticket_attachments is
  'Support-specific attachments (screenshots/PDFs) -- a private bucket with its own access rule, never the club Document Library (different privacy/retention semantics: these belong to one support ticket, not a club).';

create unique index support_ticket_attachments_storage_path_idx on public.support_ticket_attachments (storage_path);
create index support_ticket_attachments_ticket_id_idx on public.support_ticket_attachments (ticket_id);

-- ============================================================
-- 3. Support capability -- reuses site_admins.admin_role (the existing
--    fixed six-profile vocabulary), never a new bespoke permission-flag
--    system. 'full' and 'user_access' (support is fundamentally an
--    account/access assistance surface) get full manage access;
--    'read_only' gets read access to the requester-visible timeline only
--    (never internal notes); 'fixture_ops'/'club_data'/'message_moderator'
--    get none, matching the brief's own example that a Message Moderator
--    is not automatically a support agent.
-- ============================================================

create function internal.site_admin_support_level(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case internal.site_admin_role(p_user_id)
    when 'full' then 'manage'
    when 'user_access' then 'manage'
    when 'read_only' then 'view'
    else 'none'
  end;
$$;

comment on function internal.site_admin_support_level(uuid) is
  'manage = full support agent (view, reply, change status, internal notes). view = read-only visibility of the requester-visible timeline only, never internal notes. none = no support access at all (the default for every other Site Admin profile, and for non-Site-Admins).';

grant execute on function internal.site_admin_support_level(uuid) to authenticated;

create function internal.can_manage_support()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and internal.site_admin_support_level(auth.uid()) = 'manage';
$$;

grant execute on function internal.can_manage_support() to authenticated;

-- ============================================================
-- 4. RLS -- support_tickets/support_ticket_events/support_ticket_attachments
--    have NO insert/update policy for `authenticated` at all (mirroring
--    fixture_message_contact_cards' own "RPC-only" pattern): every write
--    happens through a SECURITY DEFINER function below, so client code can
--    never forge an event's visibility, actor, or a ticket's status.
-- ============================================================

alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_ticket_attachments enable row level security;

create policy support_tickets_select on public.support_tickets for select
  using (created_by_user_id = auth.uid() or internal.site_admin_support_level(auth.uid()) in ('manage', 'view'));

create policy support_ticket_events_select on public.support_ticket_events for select
  using (
    (visibility = 'requester' and (
      exists (select 1 from public.support_tickets t where t.id = ticket_id and t.created_by_user_id = auth.uid())
      or internal.site_admin_support_level(auth.uid()) in ('manage', 'view')
    ))
    or
    (visibility = 'internal' and internal.site_admin_support_level(auth.uid()) = 'manage')
  );

create policy support_ticket_attachments_select on public.support_ticket_attachments for select
  using (
    exists (select 1 from public.support_tickets t where t.id = ticket_id and t.created_by_user_id = auth.uid())
    or internal.site_admin_support_level(auth.uid()) in ('manage', 'view')
  );

-- Attachments are inserted directly by the requester (own open ticket
-- only) -- the one write this phase allows outside an RPC, matching how
-- fixture_message_attachments' own row is inserted directly once the
-- Storage object itself is already access-controlled below.
create policy support_ticket_attachments_insert on public.support_ticket_attachments for insert
  with check (
    uploaded_by_user_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.created_by_user_id = auth.uid() and t.status <> 'closed')
  );

-- ============================================================
-- 5. create_support_ticket -- the only path to a new ticket. Resolves the
--    caller's own club from club_memberships (nullable -- a team-only
--    user or someone with no club at all can still raise a ticket).
-- ============================================================

create function public.create_support_ticket(
  p_category text,
  p_subject text,
  p_description text,
  p_related_fixture_id uuid default null,
  p_related_fixture_request_id uuid default null,
  p_related_team_id uuid default null,
  p_source_route text default null
)
returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_id uuid;
  v_reference text;
begin
  if not internal.is_account_active(auth.uid()) then
    raise exception 'Account is not active.';
  end if;
  if length(trim(p_subject)) = 0 or length(trim(p_description)) = 0 then
    raise exception 'Subject and description are required.';
  end if;

  select cm.club_id into v_club_id
  from public.club_memberships cm
  where cm.user_id = auth.uid() and cm.status = 'active'
  order by case cm.role when 'CLUB_ADMIN' then 0 when 'FIXTURE_SECRETARY' then 1 else 2 end
  limit 1;

  v_reference := 'OB-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.support_ticket_reference_seq')::text, 4, '0');

  insert into public.support_tickets (
    reference, created_by_user_id, club_id, category, subject, description,
    related_fixture_id, related_fixture_request_id, related_team_id, source_route
  )
  values (
    v_reference, auth.uid(), v_club_id, p_category, trim(p_subject), trim(p_description),
    p_related_fixture_id, p_related_fixture_request_id, p_related_team_id, p_source_route
  )
  returning support_tickets.id into v_id;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility)
  values (v_id, 'created', auth.uid(), 'requester');

  return query select v_id, v_reference;
end;
$$;

comment on function public.create_support_ticket(text, text, text, uuid, uuid, uuid, text) is
  'The only INSERT path to support_tickets. category is re-validated by the table check constraint regardless of what the client sends. club_id is resolved server-side from the caller''s own real membership, never accepted as a parameter.';

revoke execute on function public.create_support_ticket(text, text, text, uuid, uuid, uuid, text) from public;
grant execute on function public.create_support_ticket(text, text, text, uuid, uuid, uuid, text) to authenticated;

-- ============================================================
-- 6. add_support_followup -- the requester adding information to their
--    own still-open ticket. Deliberately blocked once closed (see the
--    brief's own "do not silently append to a closed ticket" rule) --
--    the client instead offers "Create Follow-up Request".
-- ============================================================

create function public.add_support_followup(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.support_tickets
  where id = p_ticket_id and created_by_user_id = auth.uid();

  if v_status is null then
    raise exception 'Support ticket not found.';
  end if;
  if v_status = 'closed' then
    raise exception 'This request is closed. Create a follow-up request instead.';
  end if;
  if length(trim(p_body)) = 0 then
    raise exception 'Message is required.';
  end if;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
  values (p_ticket_id, 'requester_message', auth.uid(), 'requester', trim(p_body));

  update public.support_tickets set updated_at = now() where id = p_ticket_id;
end;
$$;

revoke execute on function public.add_support_followup(uuid, text) from public;
grant execute on function public.add_support_followup(uuid, text) to authenticated;

-- ============================================================
-- 7. add_support_internal_note -- manage-level Site Admin only. Never
--    creates a notification, never visible to the requester (RLS on
--    support_ticket_events enforces this even if this function's own
--    check were somehow bypassed).
-- ============================================================

create function public.add_support_internal_note(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.can_manage_support() then
    raise exception 'Not authorized to add internal support notes.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket_id) then
    raise exception 'Support ticket not found.';
  end if;
  if length(trim(p_body)) = 0 then
    raise exception 'Note is required.';
  end if;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
  values (p_ticket_id, 'internal_note', auth.uid(), 'internal', trim(p_body));
end;
$$;

revoke execute on function public.add_support_internal_note(uuid, text) from public;
grant execute on function public.add_support_internal_note(uuid, text) to authenticated;

-- ============================================================
-- 8. send_support_reply -- manage-level Site Admin only. User-facing by
--    design; creates exactly one notification for the requester.
-- ============================================================

create function public.send_support_reply(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_reference text;
begin
  if not internal.can_manage_support() then
    raise exception 'Not authorized to reply to support tickets.' using errcode = '42501';
  end if;
  if length(trim(p_body)) = 0 then
    raise exception 'Reply is required.';
  end if;

  select created_by_user_id, reference into v_requester, v_reference
  from public.support_tickets where id = p_ticket_id;
  if v_requester is null then
    raise exception 'Support ticket not found.';
  end if;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
  values (p_ticket_id, 'support_reply', auth.uid(), 'requester', trim(p_body));

  update public.support_tickets set updated_at = now() where id = p_ticket_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_requester, 'support_ticket_update', 'Support request update',
    format('%s: %s', v_reference, left(trim(p_body), 140)),
    jsonb_build_object('support_ticket_id', p_ticket_id, 'reference', v_reference)
  );
end;
$$;

revoke execute on function public.send_support_reply(uuid, text) from public;
grant execute on function public.send_support_reply(uuid, text) to authenticated;

-- ============================================================
-- 9. update_support_ticket_status -- the only path that changes status,
--    with a fixed, controlled transition table (never an arbitrary
--    client-submitted string). Optionally carries a user-facing message
--    (the "Mark as In Progress" / "Close Ticket" reply, in the SAME
--    transaction as the status change so the timeline reads as one
--    event, not two) and a SEPARATE internal closing note -- two
--    different parameters so the two textareas from the brief can never
--    be confused into the wrong visibility.
-- ============================================================

create function public.update_support_ticket_status(
  p_ticket_id uuid,
  p_new_status text,
  p_user_message text default null,
  p_internal_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_requester uuid;
  v_reference text;
  v_notif_title text;
  v_notif_body text;
begin
  if not internal.can_manage_support() then
    raise exception 'Not authorized to change support ticket status.' using errcode = '42501';
  end if;
  if p_new_status not in ('new', 'in_progress', 'closed') then
    raise exception 'Invalid status.';
  end if;

  select status, created_by_user_id, reference into v_old_status, v_requester, v_reference
  from public.support_tickets where id = p_ticket_id for update;
  if v_requester is null then
    raise exception 'Support ticket not found.';
  end if;

  if not (
    (v_old_status = 'new' and p_new_status in ('in_progress', 'closed'))
    or (v_old_status = 'in_progress' and p_new_status = 'closed')
  ) then
    raise exception 'Cannot move a % ticket to %.', v_old_status, p_new_status;
  end if;

  update public.support_tickets
  set status = p_new_status,
      closed_at = case when p_new_status = 'closed' then now() else closed_at end,
      closed_by = case when p_new_status = 'closed' then auth.uid() else closed_by end
  where id = p_ticket_id;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, metadata)
  values (p_ticket_id, 'status_changed', auth.uid(), 'requester', jsonb_build_object('from', v_old_status, 'to', p_new_status));

  if p_user_message is not null and length(trim(p_user_message)) > 0 then
    insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
    values (p_ticket_id, 'support_reply', auth.uid(), 'requester', trim(p_user_message));
  end if;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
    values (p_ticket_id, 'internal_note', auth.uid(), 'internal', trim(p_internal_note));
  end if;

  v_notif_title := case p_new_status
    when 'in_progress' then 'Your support request is now in progress'
    when 'closed' then 'Your support request has been closed'
    else 'Support request update'
  end;
  v_notif_body := coalesce(nullif(trim(p_user_message), ''), format('%s is now %s.', v_reference, replace(p_new_status, '_', ' ')));

  insert into public.notifications (user_id, type, title, body, data)
  values (v_requester, 'support_ticket_update', v_notif_title, v_notif_body, jsonb_build_object('support_ticket_id', p_ticket_id, 'reference', v_reference));
end;
$$;

comment on function public.update_support_ticket_status(uuid, text, text, text) is
  'Fixed transition table only: new->in_progress, new->closed, in_progress->closed. Never in_progress->new or closed->anything -- a closed ticket stays closed here; the client offers "Create Follow-up Request" instead of a silent reopen. Exactly one notification per call, regardless of whether p_user_message/p_internal_note were supplied, so a status change never doubles up with a separate reply notification.';

revoke execute on function public.update_support_ticket_status(uuid, text, text, text) from public;
grant execute on function public.update_support_ticket_status(uuid, text, text, text) to authenticated;

-- ============================================================
-- 10. Storage: support-attachments, private, small image/PDF set only --
--     never executables, never the club-documents bucket (different
--     privacy/retention semantics). Path shape "{ticket_id}/{uuid}.{ext}".
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

create function internal.can_access_support_attachment_path(p_object_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
begin
  v_ticket_id := (storage.foldername(p_object_name))[1]::uuid;
  if p_write then
    return exists (
      select 1 from public.support_tickets
      where id = v_ticket_id and created_by_user_id = auth.uid() and status <> 'closed'
    );
  end if;
  return exists (
    select 1 from public.support_tickets t
    where t.id = v_ticket_id
      and (t.created_by_user_id = auth.uid() or internal.site_admin_support_level(auth.uid()) in ('manage', 'view'))
  );
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function internal.can_access_support_attachment_path(text, boolean) to authenticated;

create policy support_attachments_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'support-attachments' and internal.can_access_support_attachment_path(name, true));

create policy support_attachments_storage_select on storage.objects for select to authenticated
using (bucket_id = 'support-attachments' and internal.can_access_support_attachment_path(name, false));
