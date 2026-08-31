-- Club logo uploads go to Supabase Storage, never Postgres -- this bucket
-- plus its RLS-equivalent storage policies. Objects are keyed
-- "{club_id}/{filename}" so ownership is checkable directly from the path
-- (first path segment) without a separate lookup table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

-- public=true above: crests are meant to be publicly visible on
-- /club/{slug}; write access is still restricted by the policies below
-- regardless (this migration's applying role doesn't own storage.buckets,
-- so that can't carry a SQL comment the way every other table here does).

-- Public read (matches the public club page requirement); write restricted
-- to that club's own CLUB_ADMIN or Site Admin, keyed off the object path's
-- first segment ({club_id}/...) so ownership never depends on filename
-- content, and 2MB/mime-type limits are enforced by the bucket config
-- above, not trusted from client-supplied metadata.
create policy club_logos_select_public on storage.objects for select
  using (bucket_id = 'club-logos');

create policy club_logos_insert_club_admin on storage.objects for insert
  with check (
    bucket_id = 'club-logos'
    and (internal.is_site_admin() or internal.is_club_admin((storage.foldername(name))[1]::uuid))
  );

create policy club_logos_update_club_admin on storage.objects for update
  using (
    bucket_id = 'club-logos'
    and (internal.is_site_admin() or internal.is_club_admin((storage.foldername(name))[1]::uuid))
  );

create policy club_logos_delete_club_admin on storage.objects for delete
  using (
    bucket_id = 'club-logos'
    and (internal.is_site_admin() or internal.is_club_admin((storage.foldername(name))[1]::uuid))
  );
