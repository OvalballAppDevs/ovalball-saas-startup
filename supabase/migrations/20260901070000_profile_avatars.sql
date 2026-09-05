-- Personal profile photo -- distinct from club crests (club identity) and
-- from the existing phone_number/address fields (private contact data).
-- An avatar is not sensitive the way address/DOB/phone are: it is shown
-- to other authorized participants in a fixture conversation the same way
-- a name is, so (like club-logos) this is a PUBLIC storage bucket -- the
-- object path itself is a random uuid, never guessable from a user id
-- alone, and only the owner can write to their own path.

alter table public.profiles add column avatar_storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert_self on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_self on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_self on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_select_public on storage.objects for select
  using (bucket_id = 'avatars');
