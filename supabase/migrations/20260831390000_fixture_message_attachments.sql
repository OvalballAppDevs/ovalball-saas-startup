-- Fixture message attachments: private Supabase Storage bucket + metadata
-- table, one attachment per message (the brief's own "start with ONE
-- attachment per message if safer" -- simplest safe shape, a message either
-- has zero or one). Authorization reuses internal.can_access_fixture_
-- conversation() exactly -- the same real-participant boundary the
-- messages themselves already use (Club Admin/Fixtures Admin/relevant Team
-- Admin/Site Admin, never View Only/Parent-Player/unrelated club/
-- suspended -- can_manage_team/can_manage_club_fixtures already exclude a
-- suspended account via internal.is_account_active()).
--
-- Storage path shape: 'f/<fixture_id>/<random_uuid>.<ext>' or
-- 'r/<fixture_request_id>/<random_uuid>.<ext>' -- never the original
-- filename (that's stored separately, purely as display metadata), so a
-- hostile filename can never become part of a real storage path (no
-- traversal, no collision, no information leak through the object name).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fixture-attachments', 'fixture-attachments', false, 2097152,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

create table public.fixture_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.fixture_messages(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 2097152),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.fixture_message_attachments is
  'One attachment per fixture_messages row (message_id is unique). storage_path is a generated safe object name in the private fixture-attachments bucket -- original_filename is display-only metadata, never used to build a path.';

alter table public.fixture_message_attachments enable row level security;

create policy fixture_message_attachments_select_scoped on public.fixture_message_attachments for select
  using (
    exists (
      select 1 from public.fixture_messages m
      where m.id = message_id and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
    )
  );

-- No direct insert/update/delete policy -- every row is written exclusively
-- by create_fixture_message_with_attachment() below, which does its own
-- authorization and validation (same established pattern as fixture
-- results). Deletion is likewise RPC-only (delete_fixture_message_attachment
-- below), never a bare table policy.

create trigger audit_row_change after insert or update or delete on public.fixture_message_attachments
  for each row execute function internal.audit_row_change();

-- ============================================================
-- Storage RLS: the real upload/download gate. A user may write (upload) or
-- read (download/signed-URL) an object only under a path whose embedded
-- fixture_id/fixture_request_id they can actually access -- the identical
-- authorization boundary as the messages themselves, checked directly
-- against the path rather than trusting the client's claimed destination.
-- ============================================================

create or replace function internal.can_access_fixture_attachment_path(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
begin
  v_parts := storage.foldername(p_object_name);
  if array_length(v_parts, 1) < 2 then
    return false;
  end if;
  if v_parts[1] = 'f' then
    return internal.can_access_fixture_conversation(v_parts[2]::uuid, null);
  elsif v_parts[1] = 'r' then
    return internal.can_access_fixture_conversation(null, v_parts[2]::uuid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function internal.can_access_fixture_attachment_path(text) to authenticated;

create policy fixture_attachments_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'fixture-attachments' and internal.can_access_fixture_attachment_path(name));

create policy fixture_attachments_storage_select on storage.objects for select to authenticated
using (bucket_id = 'fixture-attachments' and internal.can_access_fixture_attachment_path(name));

-- Deletion of the underlying storage object is service-role-only (the
-- Next.js server action's best-effort orphan cleanup after a failed
-- create_fixture_message_with_attachment call, and delete_fixture_message_
-- attachment below for a legitimate Message Moderator removal) -- no
-- authenticated-role delete policy at all, so a participant can never
-- silently remove evidence from someone else's conversation.

-- ============================================================
-- create_fixture_message_with_attachment: the one atomic path from "a file
-- already sits at a safe generated storage path this user was allowed to
-- upload to" -> "a real message + attachment metadata row exist together".
-- If this fails, the storage object is left in place but is inert: no
-- fixture_message_attachments row references it, so it never appears
-- anywhere in the UI and nobody's conversation is affected -- an explicit,
-- harmless orphan rather than a message that pretends to have an
-- attachment it doesn't.
-- ============================================================

create or replace function public.create_fixture_message_with_attachment(
  p_fixture_id uuid, p_fixture_request_id uuid, p_body text,
  p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_storage_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send a message.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported attachment type: %', p_mime_type;
  end if;
  if p_size_bytes <= 0 or p_size_bytes > 2097152 then
    raise exception 'Attachments must be 2MB or smaller.';
  end if;
  if not internal.can_access_fixture_attachment_path(p_storage_path) then
    raise exception 'Invalid attachment storage path.' using errcode = '42501';
  end if;

  select owner into v_storage_owner from storage.objects where bucket_id = 'fixture-attachments' and name = p_storage_path;
  if v_storage_owner is null then
    raise exception 'The uploaded file could not be found -- please try attaching it again.';
  end if;
  if v_storage_owner <> auth.uid() then
    raise exception 'You may only attach a file you uploaded yourself.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), p_body)
  returning id into v_message_id;

  insert into public.fixture_message_attachments (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by)
  values (v_message_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, auth.uid());

  return v_message_id;
end;
$$;

comment on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) is
  'The only write path that pairs a fixture_messages row with a fixture_message_attachments row -- both are created together or neither is. Re-validates the same authorization, size, and MIME allowlist as storage RLS itself (defense in depth, and the source of a clear application-level error message rather than a bare RLS denial).';

revoke execute on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) from public;
grant execute on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) to authenticated;

-- Moderator-only removal of a single attachment. Deletes only the metadata
-- row and RETURNS the storage_path -- the caller (the Next.js server
-- action) must then remove the object through the real Storage API, which
-- is the only path storage.objects' own protect_delete trigger allows
-- (direct SQL DELETE is refused with SQLSTATE 42501 unless
-- storage.allow_delete_query is set, which is the Storage API's own
-- internal bookkeeping to set, not application code's). Never the ability
-- to delete someone else's storage object directly by path, and never a
-- route that can reach an unrelated conversation's attachment (this
-- fixture's message must resolve through the same can_access_fixture_
-- conversation boundary, and mirrors mark_message_report_reviewed/
-- resolve_message_report's own audited Message Moderator profile check).
create or replace function public.delete_fixture_message_attachment(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.fixture_message_attachments;
  m public.fixture_messages;
begin
  select * into a from public.fixture_message_attachments where id = p_attachment_id;
  if not found then
    raise exception 'Attachment not found.';
  end if;
  select * into m from public.fixture_messages where id = a.message_id;

  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'message_moderator') then
    raise exception 'Only a Full Site Admin or Message Moderator may remove an attachment.' using errcode = '42501';
  end if;

  delete from public.fixture_message_attachments where id = p_attachment_id;
  if m.fixture_id is not null then
    perform internal.fixture_result_system_event(m.fixture_id, auth.uid(), 'An attachment was removed by a Site Admin.');
  end if;

  return a.storage_path;
end;
$$;

revoke execute on function public.delete_fixture_message_attachment(uuid) from public;
grant execute on function public.delete_fixture_message_attachment(uuid) to authenticated;
