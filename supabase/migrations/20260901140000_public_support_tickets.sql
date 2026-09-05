-- Public (anonymous, logged-out) Support entry point.
--
-- A logged-out visitor can now submit a support ticket without an Ovalball
-- account. This is NOT a second support system -- it's the same
-- support_tickets/support_ticket_events tables, the same Site Admin
-- Support Register, the same append-only timeline. The only new surface is
-- how the ticket is CREATED: submit_public_support_ticket() is a
-- SECURITY DEFINER RPC grantable to `anon`, so it can insert a row with no
-- authenticated user at all.
--
-- created_by_user_id becomes nullable specifically for this case. The CHECK
-- constraint below keeps the two shapes mutually exclusive and complete: an
-- 'authenticated' ticket always has a real user and never has contact
-- fields (the requester's identity comes from their profile, same as
-- before); a 'public' ticket always has contact_name/contact_email and
-- never a user id -- there is no account to attribute it to, and RLS on
-- support_tickets_select already reads `created_by_user_id = auth.uid()`,
-- which is simply never true for a NULL value, so a public ticket is
-- correctly invisible to every ordinary authenticated user by construction,
-- not by an extra rule. Only a Site Admin (the policy's second clause) can
-- ever see one -- there is deliberately no lookup-by-reference read path
-- for the anonymous submitter themselves.

alter table public.support_tickets
  alter column created_by_user_id drop not null,
  add column origin text not null default 'authenticated',
  add column contact_name text,
  add column contact_email text;

alter table public.support_tickets
  add constraint support_tickets_origin_check check (origin = any (array['authenticated', 'public'])),
  add constraint support_tickets_origin_shape_check check (
    (origin = 'authenticated' and created_by_user_id is not null and contact_name is null and contact_email is null)
    or
    (origin = 'public' and created_by_user_id is null and contact_name is not null and contact_email is not null)
  );

comment on column public.support_tickets.origin is 'Where this ticket was raised from -- authenticated (existing Support Centre) or public (anonymous, logged-out homepage form). Same register, same timeline, same RPCs either way.';
comment on column public.support_tickets.contact_name is 'Public-origin tickets only -- the name the anonymous submitter typed in. Never populated for an authenticated ticket, which uses the requester''s real profile instead.';
comment on column public.support_tickets.contact_email is 'Public-origin tickets only -- required for any follow-up, since there is no account to notify in-app.';

-- A 'created' timeline event genuinely has no actor for an anonymous
-- submission -- there is no signed-in person to attribute it to. NULL is
-- the honest representation, not a fake system/admin attribution.
alter table public.support_ticket_events alter column actor_user_id drop not null;

-- update_support_ticket_status and send_support_reply both previously used
-- "was created_by_user_id null?" as their row-not-found check -- correct
-- when the column was NOT NULL, now genuinely wrong (a real public ticket
-- has a null created_by_user_id and would incorrectly raise "ticket not
-- found"). Both are re-defined below with a proper `select ... for update`
-- existence check, and both now skip the in-app notification insert for a
-- public-origin ticket (there is no account to notify -- see the support
-- actions.ts layer for the corresponding contact_email dispatch instead).

create or replace function public.update_support_ticket_status(
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
  v_origin text;
  v_notif_title text;
  v_notif_body text;
begin
  if not internal.can_manage_support() then
    raise exception 'Not authorized to change support ticket status.' using errcode = '42501';
  end if;
  if p_new_status not in ('new', 'in_progress', 'closed') then
    raise exception 'Invalid status.';
  end if;

  select status, created_by_user_id, reference, origin into v_old_status, v_requester, v_reference, v_origin
  from public.support_tickets where id = p_ticket_id for update;
  if not found then
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

  if v_requester is not null then
    v_notif_title := case p_new_status
      when 'in_progress' then 'Your support request is now in progress'
      when 'closed' then 'Your support request has been closed'
      else 'Support request update'
    end;
    v_notif_body := coalesce(nullif(trim(p_user_message), ''), format('%s is now %s.', v_reference, replace(p_new_status, '_', ' ')));

    insert into public.notifications (user_id, type, title, body, data)
    values (v_requester, 'support_ticket_update', v_notif_title, v_notif_body, jsonb_build_object('support_ticket_id', p_ticket_id, 'reference', v_reference));
  end if;
end;
$$;

create or replace function public.send_support_reply(p_ticket_id uuid, p_body text)
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
  if not found then
    raise exception 'Support ticket not found.';
  end if;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
  values (p_ticket_id, 'support_reply', auth.uid(), 'requester', trim(p_body));

  update public.support_tickets set updated_at = now() where id = p_ticket_id;

  if v_requester is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_requester, 'support_ticket_update', 'Support request update',
      format('%s: %s', v_reference, left(trim(p_body), 140)),
      jsonb_build_object('support_ticket_id', p_ticket_id, 'reference', v_reference)
    );
  end if;
end;
$$;

-- Public ticket submission. Deliberately returns only the reference (never
-- the ticket id, never anything queryable) -- there is no lookup-by-
-- reference read path for an anonymous submitter, matching the brief's
-- "never expose anonymous tickets through guessable ticket-reference URLs."
--
-- Rate limiting: capped at 3 public tickets per email address per rolling
-- hour, checked inside this same function so it can't be bypassed by
-- calling the table directly (RLS grants INSERT to `anon` only through
-- this RPC path -- see the policy below, there is no direct insert policy
-- for support_tickets at all for the anon role). This is a real,
-- enforced limit, not a UI-only throttle -- but it is the only layer this
-- local environment has: no CAPTCHA/Turnstile provider is configured here
-- (see supabase/config.toml's commented-out [auth.captcha] block), so none
-- is claimed as active. A honeypot field is enforced at the Next.js server
-- action layer, one step before this RPC is ever called.
create or replace function public.submit_public_support_ticket(
  p_name text,
  p_email text,
  p_category text,
  p_subject text,
  p_description text,
  p_club_context text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text;
  v_recent_count integer;
  v_ticket_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name is required.';
  end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Subject is required.';
  end if;
  if length(trim(p_subject)) > 200 then
    raise exception 'Subject is too long.';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Description is required.';
  end if;
  if length(p_description) > 5000 then
    raise exception 'Description is too long.';
  end if;
  if p_category not in (
    'account_login', 'club_management', 'teams', 'fixtures', 'results', 'messages', 'partner_clubs',
    'calendar', 'documents', 'permissions_users', 'bug', 'feature_question', 'data_club_information',
    'privacy_account_data', 'other'
  ) then
    raise exception 'Invalid category.';
  end if;

  select count(*) into v_recent_count
  from public.support_tickets
  where origin = 'public'
    and lower(contact_email) = lower(trim(p_email))
    and created_at > now() - interval '1 hour';
  if v_recent_count >= 3 then
    raise exception 'Too many requests from this email address recently. Please try again later, or sign in if you have an Ovalball account.';
  end if;

  -- Same reference format and sequence as create_support_ticket() (the
  -- authenticated path) -- one canonical reference scheme regardless of
  -- origin, not a second numbering system.
  v_reference := 'OB-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.support_ticket_reference_seq')::text, 4, '0');

  insert into public.support_tickets (
    reference, origin, contact_name, contact_email, category, subject, description
  ) values (
    v_reference, 'public', trim(p_name), lower(trim(p_email)), p_category, trim(p_subject),
    trim(p_description) || case when coalesce(trim(p_club_context), '') <> '' then E'\n\nClub context: ' || trim(p_club_context) else '' end
  )
  returning id into v_ticket_id;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility)
  values (v_ticket_id, 'created', null, 'requester');

  return v_reference;
end;
$$;

revoke all on function public.submit_public_support_ticket(text, text, text, text, text, text) from public;
grant execute on function public.submit_public_support_ticket(text, text, text, text, text, text) to anon, authenticated;
