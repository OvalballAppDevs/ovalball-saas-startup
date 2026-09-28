-- TEAM PROFILE MEDIA -- the canonical Team Gallery and the governed cover-photo write (Team Profile
-- Section 5), reusing exactly the authority the Profile screen already computes for cover editing
-- (`authority.teamManage` / `clubAuthority.profileEdit`, the same pair `canEditCover` already reads --
-- `packages/contracts/src/team/profile.ts`) rather than inventing `team.media.view`/`team.media.manage`.
-- That pair already expresses "may change this team's presentation" correctly; a new capability key
-- would only duplicate it.
--
-- SAFEGUARDING FINDING (Section 4 of the brief, read in full before writing this migration): Ovalball's
-- guardian consent model (`guardian_player_permissions`/`player_permission_types`,
-- 20260928200000) has NO permission_key for photography or media publication -- only attendance
-- approval, direct coach communication, team messaging and calendar/fixture/result visibility. It is
-- also PER-PLAYER, and a team gallery photo is not linked to specific players (no face tagging, no
-- person tagging -- an explicit product rule this migration does not weaken), so the existing framework
-- could not gate an individual group photo even if a media key were added to it: there is nothing to
-- attach the decision to. Ovalball has no canonical record capable of proving a specific child may be
-- published in a team gallery photo, and this migration does not invent one. What it does instead,
-- as the brief's own "gate rather than silently bypass" option: Team Gallery access is genuinely
-- authorisation-gated (team roster visibility to view, team/club management to upload or delete -- see
-- below), stored in a PRIVATE bucket resolved only through short-lived signed URLs (the same posture
-- Identity/Auth Slice 4a already moved personal avatars to, `packages/contracts/src/personal-avatar.ts`
-- -- the platform's own most recent, most safety-conscious precedent, deliberately chosen over the
-- older public-bucket convention `club-news-media`/team covers still use), with EXIF stripped at the
-- point of capture (the existing `apps/mobile/src/messages/pickers.ts` pipeline, reused unchanged), no
-- face recognition, no automatic tagging and no cross-team access via a guessed path. A true
-- per-child publication-consent primitive remains a separate, larger safeguarding project and is
-- reported as known debt rather than built or faked here.

-- ---------------------------------------------------------------------------------------------------
-- 1. the canonical Team Gallery record
-- ---------------------------------------------------------------------------------------------------
create table public.team_media (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  club_id uuid not null references public.clubs(id),
  storage_path text not null,
  caption text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'REMOVED')),
  removed_at timestamptz,
  removed_by uuid references auth.users(id)
);
create index team_media_team_state_idx on public.team_media (team_id, state, created_at desc);
create unique index team_media_storage_path_key on public.team_media (storage_path);

comment on table public.team_media is
  'Team Gallery: canonical metadata linking a photo to a team. storage_path is stable and resolved to a '
  'short-lived signed URL at read time, never stored as a URL. Section 5.';

alter table public.team_media enable row level security;

-- All writes are RPC-only (add_team_media / remove_team_media below); direct client table access is
-- refused outright rather than relied on client discipline to avoid, unlike the older `teams` table's
-- own admin RLS this deliberately does not repeat.
create policy team_media_select on public.team_media for select to authenticated
  using (state = 'ACTIVE' and internal.has_capability('team.roster.view', 'team', club_id, team_id));
create policy team_media_no_direct_write on public.team_media for insert to authenticated with check (false);
create policy team_media_no_direct_update on public.team_media for update to authenticated using (false);
create policy team_media_no_direct_delete on public.team_media for delete to authenticated using (false);

revoke all on public.team_media from anon, authenticated;
grant select on public.team_media to authenticated;
grant all on public.team_media to service_role;

create trigger audit_row_change after insert or update or delete on public.team_media
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------------------------------------
-- 2. the cover model, extended to distinguish an upload from an Ovalball library selection
-- ---------------------------------------------------------------------------------------------------
alter table public.teams add column if not exists cover_stock_key text;
alter table public.teams add constraint teams_cover_exclusive
  check (cover_image_path is null or cover_stock_key is null);

comment on column public.teams.cover_stock_key is
  'When set, the team cover is an Ovalball-owned library image (packages/contracts/src/team/cover-library.ts), '
  'resolved from the bundled catalogue, never from cover_image_path -- the two are mutually exclusive '
  '(teams_cover_exclusive). Section 5.';

-- ---------------------------------------------------------------------------------------------------
-- 3. the private Team Gallery bucket -- signed URLs only, never a public path
-- ---------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-gallery-media', 'team-gallery-media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Path shape "{team_id}/{uuid}.{ext}". team_id alone is enough to resolve club_id and re-check
-- authority; there is no second free-text segment for a caller to manipulate.
create or replace function internal.may_access_team_gallery_media(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_team_id uuid;
  v_club_id uuid;
begin
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
  if m is null then
    return false;
  end if;
  v_team_id := m[1]::uuid;
  select club_id into v_club_id from public.teams where id = v_team_id;
  if v_club_id is null then
    return false;
  end if;
  if p_write then
    return internal.has_capability('team.team.manage', 'team', v_club_id, v_team_id)
        or internal.has_capability('club.profile.edit', 'club', v_club_id, null);
  end if;
  return internal.has_capability('team.roster.view', 'team', v_club_id, v_team_id);
end;
$$;

revoke execute on function internal.may_access_team_gallery_media(text, boolean) from public, anon;
grant execute on function internal.may_access_team_gallery_media(text, boolean) to authenticated;

create policy team_gallery_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'team-gallery-media' and internal.may_access_team_gallery_media(name, true));
create policy team_gallery_media_select on storage.objects for select to authenticated
  using (bucket_id = 'team-gallery-media' and internal.may_access_team_gallery_media(name, false));
create policy team_gallery_media_update on storage.objects for update to authenticated
  using (bucket_id = 'team-gallery-media' and internal.may_access_team_gallery_media(name, true))
  with check (bucket_id = 'team-gallery-media' and internal.may_access_team_gallery_media(name, true));
create policy team_gallery_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'team-gallery-media' and internal.may_access_team_gallery_media(name, true));

-- ---------------------------------------------------------------------------------------------------
-- 4. set_team_cover -- the one governed write for a team's cover, upload or Ovalball library
-- ---------------------------------------------------------------------------------------------------
create or replace function public.set_team_cover(p_team_id uuid, p_storage_path text, p_stock_key text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not (
    internal.has_capability('team.team.manage', 'team', v_club_id, p_team_id)
    or internal.has_capability('club.profile.edit', 'club', v_club_id, null)
    or internal.has_capability('site.team_catalogue.manage', 'site')
  ) then
    raise exception 'Not authorized to change this team''s cover photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  -- club-news-media's own established path shape (20270340000000, "may_manage_club_news_media"):
  -- {club_id}/{club|team_id}/{uuid}.{ext}. A team cover always carries this team's own id as the
  -- second segment, matching the bucket's existing RLS exactly rather than a shape invented here.
  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/' || p_team_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this team.' using errcode = '22023';
  end if;

  -- The server-side allow-list for a stock selection, matching the client catalogue
  -- (packages/contracts/src/team/cover-library.ts) key for key -- an unrecognised key is refused
  -- outright rather than stored, so a stock reference can never become an arbitrary path.
  if p_stock_key is not null and not (p_stock_key = any(array[
    'rugby-team-scrum-01', 'rugby-team-huddle-womens-01', 'rugby-team-huddle-youth-01',
    'rugby-team-minis-01', 'rugby-team-general-01', 'rugby-team-community-01',
    'training-session-01', 'training-session-02',
    'matchday-hero-01', 'matchday-scene-01', 'matchday-maul-01', 'matchday-ruck-01',
    'matchday-lineout-01', 'matchday-action-01', 'matchday-floodlit-01',
    'pitch-empty-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.teams set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_team_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$$;

grant execute on function public.set_team_cover(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. add_team_media / remove_team_media / read_team_media -- the Team Gallery's own governed writes
-- ---------------------------------------------------------------------------------------------------
create or replace function public.add_team_media(p_team_id uuid, p_storage_path text, p_caption text default null)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
  v_id uuid;
  v_caption text := nullif(trim(coalesce(p_caption, '')), '');
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not (
    internal.has_capability('team.team.manage', 'team', v_club_id, p_team_id)
    or internal.has_capability('club.profile.edit', 'club', v_club_id, null)
  ) then
    raise exception 'Not authorized to add photos to this team''s gallery.' using errcode = '42501';
  end if;

  if p_storage_path !~ ('^' || p_team_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this team.' using errcode = '22023';
  end if;

  insert into public.team_media (team_id, club_id, storage_path, caption, uploaded_by)
  values (p_team_id, v_club_id, p_storage_path, v_caption, auth.uid())
  returning id into v_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('team_media', v_id, 'insert', auth.uid(), jsonb_build_object('team_id', p_team_id, 'storage_path', p_storage_path));

  return v_id;
end;
$$;

grant execute on function public.add_team_media(uuid, text, text) to authenticated;

create or replace function public.remove_team_media(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_team_id uuid;
  v_club_id uuid;
begin
  select team_id, club_id into v_team_id, v_club_id from public.team_media where id = p_media_id and state = 'ACTIVE';
  if v_team_id is null then
    raise exception 'Photo not found.' using errcode = 'P0002';
  end if;

  if not (
    internal.has_capability('team.team.manage', 'team', v_club_id, v_team_id)
    or internal.has_capability('club.profile.edit', 'club', v_club_id, null)
  ) then
    raise exception 'Not authorized to remove this photo.' using errcode = '42501';
  end if;

  update public.team_media set state = 'REMOVED', removed_at = now(), removed_by = auth.uid() where id = p_media_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('team_media', p_media_id, 'update', auth.uid(), jsonb_build_object('state', 'REMOVED'));
end;
$$;

grant execute on function public.remove_team_media(uuid) to authenticated;

-- Refuses outright (42501) rather than returning empty -- the SAME distinction team_staff already
-- draws (Section 4), so a denied gallery is never rendered indistinguishably from a genuinely empty one.
create or replace function public.read_team_media(p_team_id uuid, p_limit integer default 60)
returns table(id uuid, storage_path text, caption text, uploaded_by uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not internal.has_capability('team.roster.view', 'team', v_club_id, p_team_id) then
    raise exception 'Not authorized to view this team''s photos.' using errcode = '42501';
  end if;

  return query
  select tm.id, tm.storage_path, tm.caption, tm.uploaded_by, tm.created_at
  from public.team_media tm
  where tm.team_id = p_team_id and tm.state = 'ACTIVE'
  order by tm.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
end;
$$;

grant execute on function public.read_team_media(uuid, integer) to authenticated;
