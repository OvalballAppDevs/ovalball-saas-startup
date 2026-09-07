-- A player's own picture.
--
-- Pippa can have her own photo. Jaxon can have his. Neither borrows the
-- adult's -- which is what the app did until now, because a Player had no
-- avatar field at all and the identity block fell back to
-- profiles.avatar_storage_path, the SIGNED-IN adult's image. Live UAT showed
-- that as a parent's initials sitting beside a child's name; with a real
-- uploaded photo it would have been an adult's face captioned as a child.
--
-- WHY A NEW BUCKET, AND NOT `avatars`
--
-- The existing `avatars` bucket is PUBLIC (storage.buckets.public = true).
-- That is a defensible choice for an adult's own profile picture, which they
-- chose to publish about themselves. It is not defensible for a child's:
-- a public bucket serves any object to anyone holding or guessing the URL,
-- with no authorization on read at all.
--
-- So youth photos get their own PRIVATE bucket, read through short-lived
-- signed URLs -- the same pattern club-documents and fixture-attachments
-- already use. Every read is authorized at the moment the URL is minted.
--
-- A photo is never required. The product must work completely without one:
-- initials are a first-class rendering, not a degraded state. Nothing here
-- pushes a club or a parent toward publishing a child's face.

alter table public.players add column avatar_storage_path text;

comment on column public.players.avatar_storage_path is
  'Object path in the PRIVATE player-avatars bucket. Read via short-lived signed URLs, never a public URL. Always optional -- youth participation must never require a photograph, and initials are a first-class fallback.';

-- ---------------------------------------------------------------------------
-- Who may see or change a player's picture
-- ---------------------------------------------------------------------------

-- Deliberately narrow, and deliberately NOT "anyone who can see the player".
-- A photograph is more sensitive than a name on a team sheet, so this is a
-- tighter circle than general player visibility:
--
--   * an active guardian of that player;
--   * the player themselves, where they hold their own linked account;
--   * a Club Admin holding club.guardians.manage at a club the player is
--     attached to -- the same canonical, safeguarding-sensitive capability
--     that governs guardian relationships, never a broader team role.
--
-- Team staff are absent on purpose: a coach needs a squad list, not a
-- children's photo library.
create or replace function internal.can_access_player_avatar(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    exists (
      select 1 from public.guardians g
      where g.player_id = p_player_id and g.guardian_user_id = auth.uid() and g.status = 'active'
    )
    or exists (
      select 1 from public.players p
      where p.id = p_player_id and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.player_id = p_player_id
        and ptm.status in ('pending', 'active')
        and internal.has_capability('club.guardians.manage', 'club', t.club_id, null)
    );
$$;

revoke all on function internal.can_access_player_avatar(uuid) from public;
grant execute on function internal.can_access_player_avatar(uuid) to authenticated;

-- The object path's first segment is the player id: 'player-avatars/<uuid>/<file>'.
-- Deriving authority from the path means a caller cannot upload into another
-- child's folder, and cannot read one either.
create or replace function internal.player_avatar_path_player_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-avatars', 'player-avatars', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy player_avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'player-avatars'
    and internal.can_access_player_avatar(internal.player_avatar_path_player_id(name))
  );

create policy player_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'player-avatars'
    and internal.can_access_player_avatar(internal.player_avatar_path_player_id(name))
  );

create policy player_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'player-avatars'
    and internal.can_access_player_avatar(internal.player_avatar_path_player_id(name))
  );

create policy player_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'player-avatars'
    and internal.can_access_player_avatar(internal.player_avatar_path_player_id(name))
  );

-- ---------------------------------------------------------------------------
-- Setting and clearing it
-- ---------------------------------------------------------------------------

-- players itself is not directly writable by a guardian, so the path is set
-- through a function that re-checks the same authority as the bucket. Keeping
-- both in one place means a future change cannot let someone write a path
-- pointing at an object they could not have uploaded.
create or replace function public.set_player_avatar(p_player_id uuid, p_storage_path text)
returns text
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_path text := nullif(trim(coalesce(p_storage_path, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_player_avatar(p_player_id) then
    raise exception 'You are not authorized to change this player''s picture.' using errcode = '42501';
  end if;
  -- The stored path must belong to THIS player's folder. Without this a
  -- guardian of one child could point their record at another child's image.
  if v_path is not null and internal.player_avatar_path_player_id(v_path) is distinct from p_player_id then
    raise exception 'That picture does not belong to this player.' using errcode = '42501';
  end if;

  update public.players set avatar_storage_path = v_path, updated_by = auth.uid(), updated_at = now()
  where id = p_player_id;

  return coalesce(v_path, '');
end;
$$;

revoke all on function public.set_player_avatar(uuid, text) from public;
grant execute on function public.set_player_avatar(uuid, text) to authenticated;
