-- PUBLIC CLUB PROFILE -- COVER PHOTO (visual-lock Part B, Section B2).
--
-- AUDITED FIRST: no canonical cover-photo/hero-image field existed anywhere on `clubs` or
-- `club_directory` before this migration (`ProfileHero` in the mobile club profile screen says so in
-- its own comment -- "no per-club photo exists" -- and every other presentation field on `clubs`
-- (bio, website, facebook_url, address_display, logo_storage_path) was checked directly against this
-- schema). This is therefore the one genuinely new presentation field Part B's own instruction expects,
-- never a duplicate of an existing one.
--
-- NOT THE CREST. `logo_storage_path` remains the one identity image, automatic everywhere a club is
-- named. `cover_storage_path` is a separate, optional, editable hero image for the public profile only
-- -- never a substitute for the crest, never required.
--
-- SAME AUTHORITY AS EVERY OTHER PROFILE FIELD, NO NEW CAPABILITY. `clubs.cover_storage_path` is one
-- more nullable column on a row `clubs_update_admin` (club.profile.edit, or the site override) already
-- lets its holder update in full -- no new RLS policy needed on the table itself. The bucket's own
-- write policies below ask the identical `club.profile.edit` question `require_club_profile_editor`
-- already asks for bio/website, kept textually parallel to it deliberately.
alter table public.clubs add column if not exists cover_storage_path text;

comment on column public.clubs.cover_storage_path is
  'Public Clubhouse profile hero image -- optional, editable, presentation-only. Never the crest (logo_storage_path), never required, never club identity.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-covers', 'club-covers', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy club_covers_select_public on storage.objects for select
  using (bucket_id = 'club-covers');

create policy club_covers_insert_club_admin on storage.objects for insert
  with check (
    bucket_id = 'club-covers'
    and (internal.has_site_capability('site.clubs.profile.manage') or internal.can('club.profile.edit', 'club', (storage.foldername(name))[1]::uuid, null, null))
  );

create policy club_covers_update_club_admin on storage.objects for update
  using (
    bucket_id = 'club-covers'
    and (internal.has_site_capability('site.clubs.profile.manage') or internal.can('club.profile.edit', 'club', (storage.foldername(name))[1]::uuid, null, null))
  );

create policy club_covers_delete_club_admin on storage.objects for delete
  using (
    bucket_id = 'club-covers'
    and (internal.has_site_capability('site.clubs.profile.manage') or internal.can('club.profile.edit', 'club', (storage.foldername(name))[1]::uuid, null, null))
  );
