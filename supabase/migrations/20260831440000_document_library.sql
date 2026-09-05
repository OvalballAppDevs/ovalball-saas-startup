-- Club Document Library: upload once, store once, share by reference many
-- times. Two owner shapes mirror the same num_nonnulls(club_id,
-- directory_id) = 1 pattern already used for opponent resolution
-- (fixtures.opponent_{directory,team}_id) -- a document/folder belongs
-- EITHER to an activated club (self-service) OR directly to a canonical
-- club_directory row (Site-Admin-managed, works pre-activation, exactly
-- the fix already applied to crests -- never a fake activated `clubs` row
-- just to hold a document).

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id),
  directory_id uuid references public.club_directory(id),
  parent_folder_id uuid references public.document_folders(id),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (num_nonnulls(club_id, directory_id) = 1)
);

create index document_folders_club_id_idx on public.document_folders (club_id) where club_id is not null;
create index document_folders_directory_id_idx on public.document_folders (directory_id) where directory_id is not null;
create index document_folders_parent_idx on public.document_folders (parent_folder_id);

comment on table public.document_folders is
  'Database-driven organisation only -- never a physical Supabase Storage path. Moving a document/folder between folders updates folder_id/parent_folder_id, never touches the underlying Storage object, so every existing fixture-message reference into a document keeps working regardless of reorganisation.';

create table public.club_documents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id),
  directory_id uuid references public.club_directory(id),
  folder_id uuid references public.document_folders(id),
  title text not null,
  description text,
  category text not null default 'other'
    check (category in ('visitor_guide', 'fixture_information', 'ground_pitch_information', 'parking', 'match_day_information', 'image', 'other')),
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  checksum text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (num_nonnulls(club_id, directory_id) = 1)
);

create index club_documents_club_id_idx on public.club_documents (club_id) where club_id is not null;
create index club_documents_directory_id_idx on public.club_documents (directory_id) where directory_id is not null;
create index club_documents_folder_id_idx on public.club_documents (folder_id);
create index club_documents_checksum_idx on public.club_documents (club_id, checksum) where checksum is not null and archived_at is null;

comment on table public.club_documents is
  'Metadata only -- binaries live in the private club-documents Storage bucket, never Postgres. archived_at hides a document from the normal picker but never breaks an existing fixture_message_document_refs row (see that table''s own comment) -- reorganising or retiring a document must never corrupt historical fixture conversations.';

-- ============================================================
-- fixture_message_document_refs: the "share by reference, never
-- duplicate" mechanism. One row per message that shared a document (a
-- message can share at most one document, mirroring the attachments
-- table's own one-per-message shape) -- the SAME document_id may be
-- referenced by many messages across many fixtures with zero additional
-- Storage writes.
-- ============================================================

create table public.fixture_message_document_refs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.fixture_messages(id) on delete cascade,
  document_id uuid not null references public.club_documents(id),
  shared_by uuid not null references auth.users(id),
  shared_at timestamptz not null default now()
);

comment on table public.fixture_message_document_refs is
  'A share is a reference, never a copy -- one document_id may be pointed to by many rows here across many fixture conversations. Archiving or moving the underlying club_documents row never invalidates an existing reference; only a genuine delete of the document row would (see delete_club_document, which refuses to hard-delete a referenced document).';

alter table public.document_folders enable row level security;
alter table public.club_documents enable row level security;
alter table public.fixture_message_document_refs enable row level security;

-- ============================================================
-- Authorization helpers
-- ============================================================

-- Any active member of the owning club (or Site Admin, or -- for a
-- canonical unactivated directory-owned row -- Site Admin only, since no
-- club members exist yet) may VIEW the library. Mirrors the brief's
-- explicit "VIEW is broader than MANAGE" split.
create or replace function internal.can_view_document_library(p_club_id uuid, p_directory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    internal.is_site_admin()
    or (p_club_id is not null and exists (
      select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
    ));
$$;

grant execute on function internal.can_view_document_library(uuid, uuid) to authenticated;

-- Mutation (create/rename/move/upload/archive/delete) -- Club Admin or
-- Fixtures/Fixture Secretary role for an activated club, or Site Admin
-- (full/club_data profile) for either shape -- never a bare "is a member".
create or replace function internal.can_manage_document_library(p_club_id uuid, p_directory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    internal.is_full_site_admin()
    or coalesce(internal.site_admin_role(auth.uid()), '') = 'club_data'
    or (p_club_id is not null and exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
        and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    ));
$$;

grant execute on function internal.can_manage_document_library(uuid, uuid) to authenticated;

-- ============================================================
-- document_folders RLS
-- ============================================================

create policy document_folders_select on public.document_folders for select
  using (internal.can_view_document_library(club_id, directory_id));

create policy document_folders_insert on public.document_folders for insert
  with check (internal.can_manage_document_library(club_id, directory_id));

create policy document_folders_update on public.document_folders for update
  using (internal.can_manage_document_library(club_id, directory_id));

create policy document_folders_delete on public.document_folders for delete
  using (internal.can_manage_document_library(club_id, directory_id));

create trigger audit_row_change after insert or update or delete on public.document_folders
  for each row execute function internal.audit_row_change();
create trigger set_updated_at before update on public.document_folders for each row execute function public.set_updated_at();

-- ============================================================
-- club_documents RLS -- SELECT is the union of "I can view the owning
-- library" OR "this exact document was shared into a fixture conversation
-- I can access" (never the whole library through a share).
-- ============================================================

create policy club_documents_select_owner on public.club_documents for select
  using (internal.can_view_document_library(club_id, directory_id));

create policy club_documents_select_shared on public.club_documents for select
  using (
    exists (
      select 1 from public.fixture_message_document_refs r
      join public.fixture_messages m on m.id = r.message_id
      where r.document_id = club_documents.id
        and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
    )
  );

create policy club_documents_insert on public.club_documents for insert
  with check (internal.can_manage_document_library(club_id, directory_id));

create policy club_documents_update on public.club_documents for update
  using (internal.can_manage_document_library(club_id, directory_id));

create policy club_documents_delete on public.club_documents for delete
  using (internal.can_manage_document_library(club_id, directory_id));

create trigger audit_row_change after insert or update or delete on public.club_documents
  for each row execute function internal.audit_row_change();
create trigger set_updated_at before update on public.club_documents for each row execute function public.set_updated_at();

-- ============================================================
-- fixture_message_document_refs RLS -- readable by anyone who can read the
-- underlying message (mirrors fixture_message_attachments exactly).
-- Writes are RPC-only (share_fixture_document below).
-- ============================================================

create policy fixture_message_document_refs_select on public.fixture_message_document_refs for select
  using (
    exists (
      select 1 from public.fixture_messages m
      where m.id = message_id and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
    )
  );

-- ============================================================
-- Cross-club/cycle safety trigger for document_folders.parent_folder_id
-- and club_documents.folder_id -- a folder or document's owner (club_id/
-- directory_id) must match its parent folder's owner exactly, and a
-- folder may never become its own ancestor.
-- ============================================================

-- Two separate functions, deliberately never sharing a body -- a single
-- PL/pgSQL function referencing both NEW.parent_folder_id (a
-- document_folders-only column) and NEW.folder_id (a club_documents-only
-- column) fails at runtime the moment either is evaluated for the OTHER
-- table's row type, regardless of a tg_table_name guard: Postgres does not
-- guarantee left-to-right short-circuit evaluation of AND, so a disabled
-- branch's field reference can still be resolved against NEW and error.
create or replace function internal.enforce_document_folder_parent_ownership()
returns trigger
language plpgsql
as $$
declare
  v_parent public.document_folders;
  v_ancestor_id uuid;
  v_depth integer := 0;
begin
  if new.parent_folder_id is null then
    return new;
  end if;
  select * into v_parent from public.document_folders where id = new.parent_folder_id;
  if not found then
    raise exception 'Parent folder not found.';
  end if;
  if v_parent.club_id is distinct from new.club_id or v_parent.directory_id is distinct from new.directory_id then
    raise exception 'A folder cannot be moved into another club''s library.' using errcode = '42501';
  end if;
  v_ancestor_id := new.parent_folder_id;
  while v_ancestor_id is not null and v_depth < 50 loop
    if v_ancestor_id = new.id then
      raise exception 'A folder cannot be moved into itself or one of its own subfolders.';
    end if;
    select parent_folder_id into v_ancestor_id from public.document_folders where id = v_ancestor_id;
    v_depth := v_depth + 1;
  end loop;
  return new;
end;
$$;

create trigger enforce_document_folder_parent_ownership
  before insert or update on public.document_folders
  for each row execute function internal.enforce_document_folder_parent_ownership();

create or replace function internal.enforce_document_folder_ownership()
returns trigger
language plpgsql
as $$
declare
  v_parent public.document_folders;
begin
  if new.folder_id is null then
    return new;
  end if;
  select * into v_parent from public.document_folders where id = new.folder_id;
  if not found then
    raise exception 'Folder not found.';
  end if;
  if v_parent.club_id is distinct from new.club_id or v_parent.directory_id is distinct from new.directory_id then
    raise exception 'A document cannot be moved into another club''s folder.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_document_folder_ownership
  before insert or update on public.club_documents
  for each row execute function internal.enforce_document_folder_ownership();

-- ============================================================
-- Storage: private bucket, 10MB, PDF/JPEG/PNG/WEBP only. Path shape
-- "{club_id-or-directory_id}/{uuid}.{ext}" -- never the original filename,
-- same convention as club-logos/fixture-attachments.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-documents', 'club-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

create or replace function internal.can_access_document_storage_path(p_object_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  v_owner_id := (storage.foldername(p_object_name))[1]::uuid;
  if p_write then
    return internal.can_manage_document_library(
      (select id from public.clubs where id = v_owner_id),
      (select id from public.club_directory where id = v_owner_id)
    );
  end if;
  return internal.can_view_document_library(
    (select id from public.clubs where id = v_owner_id),
    (select id from public.club_directory where id = v_owner_id)
  )
  or exists (
    select 1 from public.club_documents d
    join public.fixture_message_document_refs r on r.document_id = d.id
    join public.fixture_messages m on m.id = r.message_id
    where d.storage_path = p_object_name and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
  );
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function internal.can_access_document_storage_path(text, boolean) to authenticated;

create policy club_documents_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'club-documents' and internal.can_access_document_storage_path(name, true));

create policy club_documents_storage_select on storage.objects for select to authenticated
using (bucket_id = 'club-documents' and internal.can_access_document_storage_path(name, false));

create policy club_documents_storage_update on storage.objects for update to authenticated
using (bucket_id = 'club-documents' and internal.can_access_document_storage_path(name, true));

-- ============================================================
-- share_fixture_document: the ONLY write path from "a document I can
-- legitimately view" to "referenced in a fixture conversation I can
-- access" -- inserts a real fixture_messages row (visible in the
-- timeline like any message) plus exactly one
-- fixture_message_document_refs row. Never touches Storage.
-- ============================================================

create or replace function public.share_fixture_document(
  p_fixture_id uuid, p_fixture_request_id uuid, p_document_id uuid, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.club_documents;
  v_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  select * into v_doc from public.club_documents where id = p_document_id and archived_at is null;
  if not found then
    raise exception 'Document not found.';
  end if;
  if not internal.can_view_document_library(v_doc.club_id, v_doc.directory_id) then
    raise exception 'You are not authorized to share this document.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), coalesce(nullif(trim(p_note), ''), format('Shared document: %s', v_doc.title)))
  returning id into v_message_id;

  insert into public.fixture_message_document_refs (message_id, document_id, shared_by)
  values (v_message_id, p_document_id, auth.uid());

  return v_message_id;
end;
$$;

revoke execute on function public.share_fixture_document(uuid, uuid, uuid, text) from public;
grant execute on function public.share_fixture_document(uuid, uuid, uuid, text) to authenticated;

-- ============================================================
-- delete_club_document: hard delete blocked whenever the document has ANY
-- fixture_message_document_refs -- archive is the only path for a
-- referenced document (never silently corrupt historical fixture
-- conversations by deleting what they point to).
-- ============================================================

create or replace function public.delete_club_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.club_documents;
  v_ref_count integer;
begin
  select * into v_doc from public.club_documents where id = p_document_id;
  if not found then
    raise exception 'Document not found.';
  end if;
  if not internal.can_manage_document_library(v_doc.club_id, v_doc.directory_id) then
    raise exception 'You are not authorized to delete this document.' using errcode = '42501';
  end if;

  select count(*) into v_ref_count from public.fixture_message_document_refs where document_id = p_document_id;
  if v_ref_count > 0 then
    raise exception 'This document has been shared in % fixture conversation(s) and cannot be permanently deleted -- archive it instead.', v_ref_count;
  end if;

  delete from public.club_documents where id = p_document_id;
end;
$$;

revoke execute on function public.delete_club_document(uuid) from public;
grant execute on function public.delete_club_document(uuid) to authenticated;
