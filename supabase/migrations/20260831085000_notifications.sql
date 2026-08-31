-- In-app notification foundation. Created ahead of
-- 20260831090000_role_vocabulary_and_claim_approval.sql, which is the first
-- thing that writes to it (claim/join/directory-request decisions).
--
-- No client-facing INSERT policy, by design -- same pattern as audit_log.
-- Every row is written by a SECURITY DEFINER function (already-authorised
-- by that function's own checks) or a trigger reacting to an authenticated
-- user's own action (e.g. submitting a claim notifies Site Admins), never
-- directly by an arbitrary authenticated client. This is also the
-- enforcement point for "never let entering an email address grant
-- anything" style requirements elsewhere: a notification is informational,
-- and nothing reads notifications.data to authorize a later action.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  -- Structured reference (e.g. {"fixture_request_id": "..."}) for the UI to
  -- build a deep link -- never a substitute for a server-side permission
  -- check when that link is followed.
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notification feed, one row per user per event. No email is sent from this table today -- see lib/email/ for the separate, not-yet-connected email-event abstraction.';

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);
create index notifications_user_id_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_self on public.notifications for select
  using (user_id = (select auth.uid()));

-- A user may only ever mark their own notifications read (read_at), never
-- change type/title/body/data/user_id -- enforced by the trigger below,
-- since a plain USING/WITH CHECK pair can't restrict which columns change.
create policy notifications_update_self on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function internal.enforce_notification_read_only_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type <> old.type or new.title <> old.title or new.body <> old.body
     or new.data is distinct from old.data or new.user_id <> old.user_id
     or new.created_at <> old.created_at then
    raise exception 'Only read_at may be changed on a notification.';
  end if;
  return new;
end;
$$;

create trigger notifications_enforce_read_only_update
  before update on public.notifications
  for each row execute function internal.enforce_notification_read_only_update();
