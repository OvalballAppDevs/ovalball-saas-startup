-- Message Reporting + Soft-Delete/Tombstone -- Overnight Master Pass
-- Phase G (Sections 83-89). report_fixture_message() already existed at
-- the DB layer with zero UI wiring anywhere in the app (found this pass)
-- -- that gap is closed in the client code alongside this migration.
-- Deletion is added here for the first time: tombstone, never a hard
-- DELETE, so a reported-then-deleted message's real content survives for
-- authorized moderation (Section 86).

alter table public.fixture_messages add column deleted_at timestamptz;
alter table public.fixture_messages add column deleted_by uuid references auth.users(id);
alter table public.fixture_messages add column deleted_by_role text check (deleted_by_role in ('sender', 'moderator'));

/**
 * The sender tombstones their own message -- Section 87: "cannot globally
 * delete someone else's message merely because they received it."
 */
create or replace function public.soft_delete_own_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid;
begin
  select sender_user_id into v_sender from public.fixture_messages where id = p_message_id;
  if v_sender is null then
    raise exception 'Message not found.';
  end if;
  if v_sender <> auth.uid() then
    raise exception 'You can only delete your own messages.' using errcode = '42501';
  end if;

  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'sender'
  where id = p_message_id and deleted_at is null;
end;
$$;

/**
 * Moderator tombstone -- matches mark_message_report_reviewed()'s/
 * resolve_message_report()'s EXACT existing authorization exactly (Full
 * Site Admin, or the specific 'message_moderator' admin_role) -- this is
 * the established authority for touching reported-message content, not
 * site.fixture_support.manage (a narrower, different capability that only
 * governs posting into a fixture conversation as Ovalball support, and
 * which a Full Site Admin can hold false while still being fully able to
 * moderate reports through admin_role alone -- confirmed live this pass).
 * Club/team-scoped moderation capabilities are NOT built in this pass --
 * disclosed as a remaining gap, not silently assumed.
 */
create or replace function public.moderator_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'message_moderator') then
    raise exception 'Only a Full Site Admin or Message Moderator may delete a reported message.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fixture_messages where id = p_message_id) then
    raise exception 'Message not found.';
  end if;

  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'moderator'
  where id = p_message_id and deleted_at is null;
end;
$$;
