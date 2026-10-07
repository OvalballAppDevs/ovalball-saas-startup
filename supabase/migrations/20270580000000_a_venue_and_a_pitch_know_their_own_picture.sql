-- VENUE AND PITCH PROFILE MEDIA -- Training Planning brief, Sections 17-18.
--
-- Confirmed absent before writing this (forensics pass): neither public.venues nor
-- public.club_pitches has ever had an image column. This adds the EXACT pattern
-- packages/contracts/src/team-cover.ts already established for a team's cover photo --
-- an uploaded path XOR a curated Ovalball-library stock key, resolved through one
-- deterministic chain -- rather than inventing a second media architecture for two
-- more entities. The three-tier "own upload -> stock library -> honest fallback" shape
-- is repeated verbatim in packages/contracts/src/venue-cover.ts and pitch-cover.ts
-- (companion files to this migration).
--
-- Bucket: club-news-media, the same public bucket team covers and article heroes
-- already use ("cover imagery is published with the club, not sensitive"). Team
-- covers' own storage policy (may_manage_club_news_media) treats the path's second
-- segment as either 'club' or a team_id, checked via may_edit_club_content -- the
-- wrong authority for a venue or pitch (venue.venue.manage / venue.pitch.manage are
-- the correct gates, per internal.can_manage_venue / internal.can_manage_pitch,
-- already defined in 20270364000000). So venue/pitch media get their own two storage
-- policy functions rather than overloading the team one, following team-gallery-
-- media's may_access_team_gallery_media as the shape to copy: parse the path,
-- resolve the owning club, check the resource-specific authority.
--
-- Path shape: "{club_id}/venue-{venue_id}/{uuid}.{ext}" and
-- "{club_id}/pitch-{pitch_id}/{uuid}.{ext}" -- the literal "venue-"/"pitch-" prefix
-- exists purely to keep this bucket's path space unambiguous now that three
-- different id types (team_id, venue_id, pitch_id) can all appear as a path's
-- second segment; without it a venue_id could not be told apart from a team_id by
-- inspection alone.

-- ---------------------------------------------------------------------------------
-- 1. the cover columns, exactly team covers' own shape
-- ---------------------------------------------------------------------------------
alter table public.venues add column if not exists cover_image_path text;
alter table public.venues add column if not exists cover_stock_key text;
alter table public.venues drop constraint if exists venues_cover_exclusive;
alter table public.venues add constraint venues_cover_exclusive
  check (cover_image_path is null or cover_stock_key is null);

comment on column public.venues.cover_image_path is
  'An uploaded venue photo, club-news-media bucket, path "{club_id}/venue-{id}/{uuid}.{ext}". Mutually exclusive with cover_stock_key. Written only through set_venue_cover.';
comment on column public.venues.cover_stock_key is
  'An Ovalball Image Library selection (packages/contracts/src/venue-cover-library.ts). Mutually exclusive with cover_image_path. Written only through set_venue_cover.';

alter table public.club_pitches add column if not exists cover_image_path text;
alter table public.club_pitches add column if not exists cover_stock_key text;
alter table public.club_pitches drop constraint if exists club_pitches_cover_exclusive;
alter table public.club_pitches add constraint club_pitches_cover_exclusive
  check (cover_image_path is null or cover_stock_key is null);

comment on column public.club_pitches.cover_image_path is
  'An uploaded pitch photo, club-news-media bucket, path "{club_id}/pitch-{id}/{uuid}.{ext}". Mutually exclusive with cover_stock_key. Written only through set_pitch_cover.';
comment on column public.club_pitches.cover_stock_key is
  'An Ovalball Image Library selection (packages/contracts/src/pitch-cover-library.ts). Mutually exclusive with cover_image_path. Written only through set_pitch_cover.';

-- ---------------------------------------------------------------------------------
-- 2. storage policies -- club-news-media already exists and is public; only two new
--    policy-predicate functions are needed, not a new bucket.
-- ---------------------------------------------------------------------------------
create or replace function internal.may_manage_venue_media(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_club_id uuid;
  v_venue_id uuid;
  v_owner uuid;
begin
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/venue-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
  if m is null then
    return false;
  end if;
  v_club_id := m[1]::uuid;
  v_venue_id := m[2]::uuid;
  select club_id into v_owner from public.venues where id = v_venue_id;
  if v_owner is null or v_owner <> v_club_id then
    return false;
  end if;
  return internal.can_manage_venue(v_club_id);
end;
$$;

revoke execute on function internal.may_manage_venue_media(text) from public, anon;
grant execute on function internal.may_manage_venue_media(text) to authenticated;

create policy club_news_media_venue_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-news-media' and internal.may_manage_venue_media(name));
create policy club_news_media_venue_select on storage.objects for select to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_venue_media(name));
create policy club_news_media_venue_update on storage.objects for update to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_venue_media(name))
  with check (bucket_id = 'club-news-media' and internal.may_manage_venue_media(name));
create policy club_news_media_venue_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_venue_media(name));

create or replace function internal.may_manage_pitch_media(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_club_id uuid;
  v_pitch_id uuid;
  v_owner uuid;
begin
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/pitch-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
  if m is null then
    return false;
  end if;
  v_club_id := m[1]::uuid;
  v_pitch_id := m[2]::uuid;
  select club_id into v_owner from public.club_pitches where id = v_pitch_id;
  if v_owner is null or v_owner <> v_club_id then
    return false;
  end if;
  return internal.can_manage_pitch(v_club_id);
end;
$$;

revoke execute on function internal.may_manage_pitch_media(text) from public, anon;
grant execute on function internal.may_manage_pitch_media(text) to authenticated;

create policy club_news_media_pitch_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-news-media' and internal.may_manage_pitch_media(name));
create policy club_news_media_pitch_select on storage.objects for select to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_pitch_media(name));
create policy club_news_media_pitch_update on storage.objects for update to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_pitch_media(name))
  with check (bucket_id = 'club-news-media' and internal.may_manage_pitch_media(name));
create policy club_news_media_pitch_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_pitch_media(name));

-- ---------------------------------------------------------------------------------
-- 3. set_venue_cover / set_pitch_cover -- the one governed write for each, mirroring
--    set_team_cover (20270572000000) field for field.
-- ---------------------------------------------------------------------------------
create or replace function public.set_venue_cover(p_venue_id uuid, p_storage_path text, p_stock_key text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.venues where venues.id = p_venue_id;
  if v_club_id is null then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  if not internal.can_manage_venue(v_club_id) then
    raise exception 'Not authorized to change this venue''s cover photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/venue-' || p_venue_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this venue.' using errcode = '22023';
  end if;

  if p_stock_key is not null and not (p_stock_key = any(array[
    'pitch-match-02', 'clubhouse-evening-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.venues set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_venue_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('venues', p_venue_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$$;

revoke execute on function public.set_venue_cover(uuid, text, text) from public, anon;
grant execute on function public.set_venue_cover(uuid, text, text) to authenticated, service_role;

create or replace function public.set_pitch_cover(p_pitch_id uuid, p_storage_path text, p_stock_key text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where club_pitches.id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.' using errcode = 'P0002';
  end if;

  if not internal.can_manage_pitch(v_club_id) then
    raise exception 'Not authorized to change this pitch''s cover photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/pitch-' || p_pitch_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this pitch.' using errcode = '22023';
  end if;

  if p_stock_key is not null and not (p_stock_key = any(array[
    'pitch-match-02', 'pitch-training-02', 'pitch-wet-weather-02', 'pitch-shared-training-02', 'pitch-floodlit-02', 'training-hero-02', 'training-evening-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.club_pitches set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_pitch_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('club_pitches', p_pitch_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$$;

revoke execute on function public.set_pitch_cover(uuid, text, text) from public, anon;
grant execute on function public.set_pitch_cover(uuid, text, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.set_venue_cover(uuid, text, text)', 'EXECUTE') then
    raise exception 'set_venue_cover must not be executable by anon';
  end if;
  if has_function_privilege('anon', 'public.set_pitch_cover(uuid, text, text)', 'EXECUTE') then
    raise exception 'set_pitch_cover must not be executable by anon';
  end if;
end $$;
