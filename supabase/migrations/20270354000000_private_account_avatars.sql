-- Identity/Auth Slice 4a: account pictures are private (Phase 2 Z-12).
--
-- The `avatars` bucket held every account's picture publicly, including children with their own login. It
-- becomes private and the application serves pictures through short-lived signed URLs. Applied after the
-- application that signs picture URLs is live (a signed URL also works while the bucket is still public).
--
-- Owner decision D-S4-4 (scratchpad/slice4/PLAN.md §8): any signed-in person may see an adult's account
-- picture; a minor's account picture is visible only to the minor, their ACTIVE guardians and staff who hold
-- player.profile.view for that player. Never public or anonymous.

create or replace function internal.can_view_account_avatar(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select internal.effective_person() is not null and p_owner is not null and (
    p_owner = internal.effective_person()
    or not internal.person_is_minor(p_owner)
    or exists (
      select 1 from public.players pl
      where pl.user_id = p_owner
        and (internal.can_player_as_family('player.profile.view', pl.id)
             or internal.can_player_at_club_or_team('player.profile.view', pl.id))
    )
  );
$$;

create or replace function internal.account_avatar_owner(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    raise exception 'Slice 4a precondition: the avatars bucket does not exist.';
  end if;
end $$;

update storage.buckets set public = false where id = 'avatars';

drop policy if exists avatars_select_public on storage.objects;
drop policy if exists avatars_select_scoped on storage.objects;
create policy avatars_select_scoped on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and internal.can_view_account_avatar(internal.account_avatar_owner(name)));

revoke all on function internal.can_view_account_avatar(uuid) from public, anon;
revoke all on function internal.account_avatar_owner(text) from public, anon;
grant execute on function internal.can_view_account_avatar(uuid) to authenticated;
grant execute on function internal.account_avatar_owner(text) to authenticated;
