-- =====================================================================================================
-- SLICE 4I (1/3) — THE DOCUMENT LIBRARY, AND Z-12
--
-- Phase 2 AA.3 row 4i, design J.4 lines 407-408, and Z-12.
--
-- AA.3 row 4i names "can_manage_document_library ROLE CHECKS", and the emphasis is the whole point.
-- The helper does not ask a capability at all: it matches membership role STRINGS --
--
--     cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
--
-- -- and site-admin role strings beside them, coalesce(internal.site_admin_role(auth.uid()),'') =
-- 'club_data'. It is the last raw-role authority of its kind in the club domain, and six row policies
-- on club_documents and document_folders rest on it.
--
-- BEHAVIOUR IS PRESERVED EXACTLY, and that is checkable rather than hopeful. J.4 line 408 gives
-- club.documents.manage to CA and FS -- the same two role strings -- with the site master
-- site.clubs.profile.manage, which sits in SITE_DATA and SITE_FULL: the same two site profiles the
-- role-string branch named. J.4 line 407 gives club.documents.view to every club bundle, which is
-- what "any active member" meant, with site.clubs.view for the site side.
-- =====================================================================================================

create or replace function internal.can_manage_document_library(p_club_id uuid, p_directory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    internal.has_site_capability('site.clubs.profile.manage')
    or (p_club_id is not null and internal.can('club.documents.manage', 'club', p_club_id, null, null));
$$;

comment on function internal.can_manage_document_library(uuid, uuid) is
  'Slice 4I: club.documents.manage at the club, or the site master site.clubs.profile.manage (J.4 '
  'line 408). Replaces a helper that matched the membership role strings CLUB_ADMIN and '
  'FIXTURE_SECRETARY directly, and the site-admin role string club_data beside them.';

create or replace function internal.can_view_document_library(p_club_id uuid, p_directory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    internal.has_site_capability('site.clubs.view')
    or (p_club_id is not null and internal.can('club.documents.view', 'club', p_club_id, null, null));
$$;

comment on function internal.can_view_document_library(uuid, uuid) is
  'Slice 4I: club.documents.view at the club, or the site master site.clubs.view (J.4 line 407). '
  'Replaces "any active membership row", which is what the club bundles say in one place instead of two.';

-- Z-12 ------------------------------------------------------------------------------------------------
-- "club-documents: add a delete policy (club.documents.manage)."
--
-- The bucket has insert, select and update policies and NO delete. So public.delete_club_document
-- removes the row and the file stays in storage for ever: nobody can remove it, because no policy
-- permits a delete, and nothing lists it because the row is gone. A club that uploads the wrong
-- document -- a child's medical form into the visitor guide folder -- can make it invisible and
-- cannot make it go away.
--
-- The same authority as the other three write policies, asked the same way.
drop policy if exists club_documents_storage_delete on storage.objects;
create policy club_documents_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'club-documents'
    and internal.can_access_document_storage_path(name, true)
  );

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'can_manage_document_library') ~ '\mcm\.role\m' then
    raise exception 'the document library still matches membership role strings.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'club_documents_storage_delete') then
    raise exception 'Z-12: the club-documents bucket still has no delete policy.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%club-documents%') <> 4 then
    raise exception 'the club-documents bucket should have exactly four policies after Z-12.';
  end if;
end $$;
