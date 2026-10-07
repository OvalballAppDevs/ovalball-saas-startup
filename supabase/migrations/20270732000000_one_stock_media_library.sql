-- =====================================================================================================
-- ONE STOCK MEDIA LIBRARY, ON THE SERVER TOO
--
-- The Ovalball library pictures a person may choose for a team, a ground, a pitch, a changing room, a
-- tournament or an event were checked by EIGHT functions holding ELEVEN inline copies of six key lists --
-- and the event's was only a pattern, so any `event-*` string was stored and the phone drew the Christmas
-- picture for a key it had never heard of. The phone's six catalogues are now one categorised library
-- (`packages/contracts/src/media/stock-library.ts`); this is the server's half of the same list:
--
--   1. internal.stock_media -- every pickable library key, the kinds of object it may stand for, and the
--      category it is browsed under. A structural test holds it to the library and to the phone's bundle.
--   2. internal.stock_media_allowed(key, domain) -- the one check, replacing every inline list. The keys and
--      domains are exactly the old lists (verified before this migration was written): nothing that was
--      accepted is refused, nothing that was refused is accepted -- except an event key that is not an
--      Ovalball event picture, which is now refused as the team, ground and tournament keys always were.
--   3. CHANGING-ROOM PHOTOS COULD NOT BE UPLOADED. Their governed path `{club}/changing-room-{room}/{uuid}.ext`
--      in `club-news-media` had no storage policy at all, so every upload was refused before
--      `set_venue_changing_room_cover` could see it. The policy mirrors the ground's and the pitch's.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. THE LIST
-- -----------------------------------------------------------------------------------------------------
create table if not exists internal.stock_media (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  domains text[] not null check (cardinality(domains) > 0 and domains <@ array['VENUE', 'PITCH', 'CHANGING_ROOM', 'TEAM', 'EVENT', 'TOURNAMENT']::text[]),
  category text not null
);
comment on table internal.stock_media is
  'The Ovalball Stock Media Library''s pickable keys and the kinds of object each may stand for. Mirrors packages/contracts/src/media/stock-library.ts.';
revoke all on table internal.stock_media from public, anon, authenticated;

insert into internal.stock_media (key, domains, category) values
  ('pitch-match-02', array['VENUE', 'PITCH']::text[], 'Pitches'),
  ('clubhouse-evening-01', array['VENUE']::text[], 'Grounds'),
  ('venue-brick-clubhouse-01', array['VENUE']::text[], 'Grounds'),
  ('venue-small-stand-01', array['VENUE']::text[], 'Grounds'),
  ('venue-rural-pavilion-01', array['VENUE']::text[], 'Grounds'),
  ('venue-dusk-01', array['VENUE']::text[], 'Grounds'),
  ('venue-white-pavilion-01', array['VENUE']::text[], 'Grounds'),
  ('venue-village-ground-01', array['VENUE']::text[], 'Grounds'),
  ('pitch-training-02', array['PITCH']::text[], 'Pitches'),
  ('pitch-wet-weather-02', array['PITCH']::text[], 'Pitches'),
  ('pitch-shared-training-02', array['PITCH']::text[], 'Pitches'),
  ('pitch-4g-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-muddy-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-sunny-maintained-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-training-cones-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-hilly-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-clean-post-01', array['PITCH']::text[], 'Pitches'),
  ('pitch-empty-01', array['TEAM']::text[], 'Pitches'),
  ('changing-modern-home-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-modern-away-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-traditional-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-basic-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-officials-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-junior-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-older-clubhouse-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-tiled-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-bench-hooks-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('changing-compact-01', array['CHANGING_ROOM']::text[], 'Changing Rooms'),
  ('rugby-team-scrum-01', array['TEAM']::text[], 'Teams'),
  ('rugby-team-huddle-womens-01', array['TEAM']::text[], 'Teams'),
  ('rugby-team-huddle-youth-01', array['TEAM']::text[], 'Teams'),
  ('rugby-team-minis-01', array['TEAM']::text[], 'Teams'),
  ('rugby-team-general-01', array['TEAM']::text[], 'Teams'),
  ('rugby-team-community-01', array['TEAM']::text[], 'Teams'),
  ('training-session-01', array['TEAM']::text[], 'Training'),
  ('training-session-02', array['TEAM']::text[], 'Training'),
  ('training-hero-02', array['PITCH']::text[], 'Training'),
  ('training-evening-01', array['PITCH']::text[], 'Training'),
  ('pitch-floodlit-02', array['PITCH']::text[], 'Training'),
  ('training-coaching-01', array['PITCH']::text[], 'Training'),
  ('training-player-ball-01', array['PITCH']::text[], 'Training'),
  ('training-huddle-01', array['PITCH']::text[], 'Training'),
  ('matchday-hero-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-scene-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-maul-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-ruck-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-lineout-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-action-01', array['TEAM']::text[], 'Match Day'),
  ('matchday-floodlit-01', array['TEAM']::text[], 'Match Day'),
  ('event-christmas-01', array['EVENT']::text[], 'Christmas'),
  ('event-summer-bbq-01', array['EVENT']::text[], 'Social'),
  ('event-awards-01', array['EVENT']::text[], 'Awards'),
  ('event-charity-run-01', array['EVENT']::text[], 'Fundraising'),
  ('event-family-day-01', array['EVENT']::text[], 'Community'),
  ('event-course-01', array['EVENT']::text[], 'Courses'),
  ('event-tour-01', array['EVENT']::text[], 'Tours'),
  ('event-volunteer-01', array['EVENT']::text[], 'Volunteering'),
  ('event-bonfire-01', array['EVENT']::text[], 'Festivals'),
  ('event-meeting-01', array['EVENT']::text[], 'Meetings'),
  ('tournament-minis-festival-01', array['TOURNAMENT']::text[], 'Festivals'),
  ('tournament-minis-tag-01', array['TOURNAMENT']::text[], 'Festivals'),
  ('tournament-age-grade-festival-01', array['TOURNAMENT']::text[], 'Festivals'),
  ('tournament-festival-pitches-01', array['TOURNAMENT']::text[], 'Festivals'),
  ('tournament-match-action-01', array['TOURNAMENT']::text[], 'Rugby Action'),
  ('tournament-touchline-crowd-01', array['TOURNAMENT']::text[], 'Rugby Action'),
  ('tournament-club-festival-day-01', array['TOURNAMENT']::text[], 'Festivals'),
  ('tournament-trophy-table-01', array['TOURNAMENT']::text[], 'Trophies'),
  ('tournament-posts-morning-01', array['TOURNAMENT']::text[], 'General'),
  ('tournament-setup-morning-01', array['TOURNAMENT']::text[], 'Festivals')
on conflict (key) do update set domains = excluded.domains, category = excluded.category;

-- -----------------------------------------------------------------------------------------------------
-- 2. THE ONE CHECK
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.stock_media_allowed(p_key text, p_domain text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (select 1 from internal.stock_media m where m.key = p_key and p_domain = any(m.domains));
$function$;
revoke all on function internal.stock_media_allowed(text, text) from public, anon, authenticated;
comment on function internal.stock_media_allowed(text, text) is
  'True when this library key may be stored as the cover of this kind of object. The one stock-key check.';

-- set_team_cover: TEAM
CREATE OR REPLACE FUNCTION public.set_team_cover(p_team_id uuid, p_storage_path text, p_stock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not (
    (exists (select 1 from public.teams t_guard where t_guard.id = p_team_id and t_guard.club_id = v_club_id) and internal.can('team.team.manage', 'team', v_club_id, p_team_id, null))
    or (v_club_id is not null and internal.can('club.profile.edit', 'club', v_club_id, null, null))
    or internal.has_site_capability('site.team_catalogue.manage')
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
  -- (`packages/contracts/src/media/stock-library.ts`) key for key -- an unrecognised key is refused
  -- outright rather than stored, so a stock reference can never become an arbitrary path.
  if p_stock_key is not null and not internal.stock_media_allowed(p_stock_key, 'TEAM') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.teams set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_team_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$function$;

-- set_venue_cover: VENUE
CREATE OR REPLACE FUNCTION public.set_venue_cover(p_venue_id uuid, p_storage_path text, p_stock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if p_stock_key is not null and not internal.stock_media_allowed(p_stock_key, 'VENUE') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.venues set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_venue_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('venues', p_venue_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$function$;

-- set_pitch_cover: PITCH
CREATE OR REPLACE FUNCTION public.set_pitch_cover(p_pitch_id uuid, p_storage_path text, p_stock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if p_stock_key is not null and not internal.stock_media_allowed(p_stock_key, 'PITCH') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.club_pitches set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_pitch_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('club_pitches', p_pitch_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$function$;

-- create_venue_changing_room: CHANGING_ROOM
CREATE OR REPLACE FUNCTION public.create_venue_changing_room(p_club_id uuid, p_venue_id uuid, p_display_name text, p_room_type text DEFAULT 'full_size'::text, p_cover_stock_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_next_sort integer;
begin
  if not internal.can_manage_venue(p_club_id) then
    raise exception 'Not authorized to manage this club''s venues.' using errcode = '42501';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'A changing room name is required.';
  end if;
  if p_room_type not in ('full_size', 'smaller', 'match_officials') then
    raise exception 'Invalid changing room type.';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = p_club_id and v.active) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;
  if p_cover_stock_key is not null and not internal.stock_media_allowed(p_cover_stock_key, 'CHANGING_ROOM') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.venue_changing_rooms where club_id = p_club_id;

  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, cover_stock_key, sort_order, created_by, updated_by)
  values (p_club_id, p_venue_id, trim(p_display_name), p_room_type, p_cover_stock_key, v_next_sort, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- set_venue_changing_room_cover: CHANGING_ROOM
CREATE OR REPLACE FUNCTION public.set_venue_changing_room_cover(p_changing_room_id uuid, p_storage_path text, p_stock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.venue_changing_rooms where id = p_changing_room_id;
  if v_club_id is null then
    raise exception 'Changing room not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_venue(v_club_id) then
    raise exception 'Not authorized to change this changing room''s cover photo.' using errcode = '42501';
  end if;
  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;
  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/changing-room-' || p_changing_room_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this changing room.' using errcode = '22023';
  end if;
  if p_stock_key is not null and not internal.stock_media_allowed(p_stock_key, 'CHANGING_ROOM') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.venue_changing_rooms set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_changing_room_id;
end;
$function$;

-- set_tournament_cover: TOURNAMENT
CREATE OR REPLACE FUNCTION public.set_tournament_cover(p_tournament_id uuid, p_storage_path text, p_stock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;

  select host_club_id into v_club_id from public.tournaments where tournaments.id = p_tournament_id;
  if v_club_id is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;

  if not internal.can('tournament.tournament.manage', 'club', v_club_id, null, null) then
    raise exception 'You do not have permission to change this tournament''s photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/tournament-' || p_tournament_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this tournament.' using errcode = '22023';
  end if;

  -- THE OVALBALL IMAGE LIBRARY, server side. Kept in step with
  -- `packages/contracts/src/media/stock-library.ts`, which is keyed on these exact strings. Stable keys,
  -- never array positions, so reordering the picker cannot re-point existing rows at a different photo.
  if p_stock_key is not null and not internal.stock_media_allowed(p_stock_key, 'TOURNAMENT') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.tournaments
  set cover_image_path = p_storage_path,
      cover_stock_key = p_stock_key,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournaments', p_tournament_id, 'update', auth.uid(),
          jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$function$;

-- create_tournament_with_teams: TOURNAMENT
CREATE OR REPLACE FUNCTION public.create_tournament_with_teams(p_club_id uuid, p_name text, p_starts_on date, p_ends_on date, p_kickoff_time time without time zone, p_format text, p_visibility text, p_venue_id uuid, p_notes text, p_age_groups text[], p_our_team_ids uuid[], p_participants jsonb DEFAULT '[]'::jsonb, p_swiss_rounds integer DEFAULT NULL::integer, p_cover_stock_key text DEFAULT NULL::text, p_ends_at time without time zone DEFAULT NULL::time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_directory uuid; v_code text; v_season uuid; v_grade text; v_team record; v_p jsonb;
  v_dir uuid; v_name text; v_team_id uuid; v_grade_p text; v_label text; v_type uuid;
  v_participant_club uuid; v_filled int; v_format text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to manage this club''s tournaments.' using errcode = '42501';
  end if;

  select c.directory_id, d.rugby_code into v_directory, v_code
  from public.clubs c join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;
  if v_directory is null then
    raise exception 'That club could not be found.' using errcode = 'P0002';
  end if;

  v_format := coalesce(p_format, 'round_robin');

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.' using errcode = '22023';
  end if;
  if v_format not in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid') then
    raise exception 'Unknown tournament format.' using errcode = '22023';
  end if;
  if coalesce(p_visibility, 'private') not in ('public', 'private') then
    raise exception 'Unknown tournament visibility.' using errcode = '22023';
  end if;
  if p_venue_id is null then
    raise exception 'A tournament needs a venue.' using errcode = '22023';
  end if;
  if p_age_groups is null or array_length(p_age_groups, 1) is null then
    raise exception 'A tournament needs at least one age group.' using errcode = '22023';
  end if;

  foreach v_grade in array p_age_groups loop
    select count(*) into v_filled from public.teams t
    where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[])) and t.age_group = v_grade;
    if v_filled = 0 then
      select count(*) into v_filled from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) e
      where e->>'age_group' = v_grade;
    end if;
    if v_filled = 0 then
      raise exception '% has no teams. Add at least one team to every age group.', v_grade using errcode = '22023';
    end if;
  end loop;

  -- A COVER CHOSEN IN THE WIZARD IS VALIDATED HERE TOO. `set_tournament_cover` is not on this path, so
  -- without this a create could plant a key with no asset behind it -- which renders as the default
  -- while the row insists somebody chose something.
  if p_cover_stock_key is not null and not internal.stock_media_allowed(p_cover_stock_key, 'TOURNAMENT') then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  -- THE SEASON COMES FROM THE CANONICAL REGISTER. This function was written without it, so every
  -- tournament the mobile create wizard made was filed under no season at all -- invisible to any
  -- season-scoped view, and not something the organiser could see was missing. A gap in the register
  -- stays a null rather than becoming a month boundary invented here.
  select s.id into v_season from public.seasons s
  where s.rugby_code = v_code and p_starts_on between s.starts_on and s.ends_on
  order by s.starts_on desc limit 1;

  insert into public.tournaments (
    host_club_id, host_directory_id, name, event_date, ends_on, kickoff_time, ends_at, rugby_code, season_id,
    venue_id, notes, format, visibility, swiss_rounds, cover_stock_key, status, created_by, updated_by
  ) values (
    p_club_id, v_directory, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_kickoff_time, p_ends_at, v_code, v_season,
    p_venue_id, nullif(btrim(coalesce(p_notes, '')), ''), v_format, coalesce(p_visibility, 'private'),
    case when v_format = 'swiss' then coalesce(p_swiss_rounds, 4) else null end,
    p_cover_stock_key,
    'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_id;

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select v_id, ag, auth.uid() from unnest(p_age_groups) as ag
  on conflict (tournament_id, age_group) do nothing;

  for v_team in select t.id, t.club_id, t.age_group from public.teams t where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[]))
  loop
    if v_team.club_id <> p_club_id then
      raise exception 'A team that is not this club''s cannot be entered as one of its own.' using errcode = '22023';
    end if;
    if v_team.age_group is not null and not (v_team.age_group = any(p_age_groups)) then
      raise exception 'A team was entered at an age group this tournament does not run.' using errcode = '22023';
    end if;
    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status, invited_by, invited_at
    )
    select v_id, hc.directory_id, v_team.club_id, v_team.id, ht.canonical_team_type_id,
           coalesce(ht.age_group, 'SENIOR'), 'added', auth.uid(), now()
    from public.teams ht join public.clubs hc on hc.id = ht.club_id
    where ht.id = v_team.id
    on conflict do nothing;
  end loop;

  for v_p in select * from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    v_dir := nullif(v_p->>'directory_id', '')::uuid;
    v_name := nullif(btrim(coalesce(v_p->>'club_name', '')), '');
    v_team_id := nullif(v_p->>'team_id', '')::uuid;
    v_grade_p := nullif(btrim(coalesce(v_p->>'age_group', '')), '');
    v_label := nullif(btrim(coalesce(v_p->>'squad_label', '')), '');

    if v_grade_p is null or not (v_grade_p = any(p_age_groups)) then
      raise exception 'A team was added at an age group this tournament does not run.' using errcode = '22023';
    end if;

    if v_dir is null then
      if v_name is null then
        raise exception 'An external club needs a name.' using errcode = '22023';
      end if;
      select id into v_dir from public.club_directory
      where lower(btrim(name)) = lower(v_name) and rugby_code = v_code and active limit 1;
      if v_dir is null then
        insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key, created_by)
        values (v_name, v_code, 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry',
                'tme-' || substr(md5(lower(v_name) || v_code), 1, 16), auth.uid())
        returning id into v_dir;
      end if;
    end if;

    if v_dir = v_directory then
      raise exception 'The host club is entered through its own teams, not as a participating club.' using errcode = '22023';
    end if;

    select c.id into v_participant_club from public.clubs c where c.directory_id = v_dir;

    v_type := null;
    if v_team_id is not null then
      select t.canonical_team_type_id, t.age_group into v_type, v_grade_p
      from public.teams t join public.clubs c on c.id = t.club_id
      where t.id = v_team_id and c.directory_id = v_dir;
      if not found then
        raise exception 'A team was added under a club it does not belong to.' using errcode = '22023';
      end if;
      v_label := null;
    end if;

    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group,
      status, invited_by, invited_at
    ) values (
      v_id, v_dir, v_participant_club, v_team_id, v_type, v_label, v_grade_p,
      internal.tournament_participant_status(v_dir),
      auth.uid(), now()
    )
    on conflict do nothing;
  end loop;

  return v_id;
end;
$function$;

-- save_event: EVENT
CREATE OR REPLACE FUNCTION public.save_event(p_event_id uuid, p_club_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  e public.club_events;
  n public.club_events;
  v_id uuid := p_event_id;
  v_club uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_team_ids uuid[];
  v_user_ids uuid[];
  v_club_level boolean;
  v_bad uuid;
  v_changed text[] := '{}';
  v_notified integer := 0;
  v_ext jsonb;
begin
  perform internal.require_live_session();

  if v_id is not null then
    select * into e from public.club_events where id = v_id for update;
    if e.id is null or not internal.can_manage_club_event(v_id) then
      raise exception 'You do not have permission to manage this event.' using errcode = '42501';
    end if;
    v_club := e.club_id;
  else
    v_club := p_club_id;
  end if;
  if v_club is null or not exists (select 1 from public.clubs c where c.id = v_club) then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  v_club_level := internal.has_site_capability('site.support.act_in_club') or internal.can('calendar.event.manage', 'club', v_club, null, null);

  v_team_ids := case when v_patch ? 'team_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'team_ids') x)
                     else array(select cet.team_id from public.club_event_teams cet where cet.event_id = v_id) end;
  v_user_ids := case when v_patch ? 'individual_user_ids' then array(select (x)::uuid from jsonb_array_elements_text(v_patch -> 'individual_user_ids') x)
                     else array(select i.user_id from public.club_event_invitees i where i.event_id = v_id) end;

  -- The row as it will be: the old row (or defaults) with the patch laid over it.
  if e.id is not null then
    n := e;
  else
    n.club_id := v_club; n.name := ''; n.starts_on := current_date; n.ends_on := current_date; n.is_club_wide := false;
    n.status := 'DRAFT'; n.event_type := 'SOCIAL'; n.location_kind := 'VENUE'; n.visibility := 'INVITED';
    n.invite_players := true; n.invite_staff := true; n.invite_members := false; n.rsvp_required := true; n.max_guests := 0;
    n.catering_required := false; n.waiting_list_enabled := false; n.payment_mode := 'FREE';
  end if;
  n.name := case when v_patch ? 'name' then btrim(coalesce(v_patch ->> 'name', '')) else n.name end;
  n.event_type := coalesce(v_patch ->> 'event_type', n.event_type);
  n.description := case when v_patch ? 'description' then nullif(btrim(coalesce(v_patch ->> 'description', '')), '') else n.description end;
  n.starts_on := coalesce((v_patch ->> 'starts_on')::date, n.starts_on);
  n.ends_on := coalesce((v_patch ->> 'ends_on')::date, case when v_patch ? 'starts_on' and e.id is null then n.starts_on else n.ends_on end);
  if v_patch ? 'starts_on' and not v_patch ? 'ends_on' and n.ends_on < n.starts_on then n.ends_on := n.starts_on; end if;
  n.start_time := case when v_patch ? 'start_time' then nullif(v_patch ->> 'start_time', '')::time else n.start_time end;
  n.end_time := case when v_patch ? 'end_time' then nullif(v_patch ->> 'end_time', '')::time else n.end_time end;
  n.meet_time := case when v_patch ? 'meet_time' then nullif(v_patch ->> 'meet_time', '')::time else n.meet_time end;
  n.host_team_id := case when v_patch ? 'host_team_id' then nullif(v_patch ->> 'host_team_id', '')::uuid else n.host_team_id end;
  n.is_club_wide := coalesce((v_patch ->> 'is_club_wide')::boolean, n.is_club_wide);
  n.invite_players := coalesce((v_patch ->> 'invite_players')::boolean, n.invite_players);
  n.invite_staff := coalesce((v_patch ->> 'invite_staff')::boolean, n.invite_staff);
  n.invite_members := coalesce((v_patch ->> 'invite_members')::boolean, n.invite_members);
  n.visibility := coalesce(v_patch ->> 'visibility', n.visibility);
  n.rsvp_required := coalesce((v_patch ->> 'rsvp_required')::boolean, n.rsvp_required);
  n.rsvp_deadline := case when v_patch ? 'rsvp_deadline' then nullif(v_patch ->> 'rsvp_deadline', '')::timestamptz else n.rsvp_deadline end;
  n.max_guests := coalesce((v_patch ->> 'max_guests')::int, n.max_guests);
  n.catering_required := coalesce((v_patch ->> 'catering_required')::boolean, n.catering_required);
  n.catering_notes := case when v_patch ? 'catering_notes' then nullif(btrim(coalesce(v_patch ->> 'catering_notes', '')), '') else n.catering_notes end;
  n.catering_deadline := case when v_patch ? 'catering_deadline' then nullif(v_patch ->> 'catering_deadline', '')::timestamptz else n.catering_deadline end;
  n.capacity := case when v_patch ? 'capacity' then nullif(v_patch ->> 'capacity', '')::int else n.capacity end;
  n.waiting_list_enabled := coalesce((v_patch ->> 'waiting_list_enabled')::boolean, n.waiting_list_enabled) and n.capacity is not null;
  n.payment_mode := coalesce(v_patch ->> 'payment_mode', n.payment_mode);
  n.price_note := case when v_patch ? 'price_note' then nullif(btrim(coalesce(v_patch ->> 'price_note', '')), '') else n.price_note end;
  n.cover_stock_key := case when v_patch ? 'cover_stock_key' then nullif(v_patch ->> 'cover_stock_key', '') else n.cover_stock_key end;
  n.cover_image_path := case when v_patch ? 'cover_image_path' then nullif(v_patch ->> 'cover_image_path', '') else n.cover_image_path end;
  if v_patch ? 'cover_image_path' and n.cover_image_path is not null then n.cover_stock_key := null; end if;
  if v_patch ? 'cover_stock_key' and n.cover_stock_key is not null then n.cover_image_path := null; end if;
  n.location_detail := case when v_patch ? 'location_detail' then nullif(btrim(coalesce(v_patch ->> 'location_detail', '')), '') else n.location_detail end;
  if v_patch ? 'location_kind' then
    n.location_kind := v_patch ->> 'location_kind';
    n.venue_id := null; n.external_location_name := null; n.online_url := null;
    n.external_address_line_1 := null; n.external_address_line_2 := null; n.external_town := null; n.external_county := null;
    n.external_postcode := null; n.external_country := null; n.external_latitude := null; n.external_longitude := null;
    if n.location_kind = 'VENUE' then n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
    elsif n.location_kind = 'EXTERNAL' then
      v_ext := coalesce(v_patch -> 'external', '{}'::jsonb);
      n.external_location_name := nullif(btrim(coalesce(v_ext ->> 'name', '')), '');
      n.external_address_line_1 := nullif(btrim(coalesce(v_ext ->> 'address_line_1', '')), '');
      n.external_address_line_2 := nullif(btrim(coalesce(v_ext ->> 'address_line_2', '')), '');
      n.external_town := nullif(btrim(coalesce(v_ext ->> 'town', '')), '');
      n.external_county := nullif(btrim(coalesce(v_ext ->> 'county', '')), '');
      n.external_postcode := nullif(upper(btrim(coalesce(v_ext ->> 'postcode', ''))), '');
      n.external_country := nullif(btrim(coalesce(v_ext ->> 'country', '')), '');
      n.external_latitude := nullif(v_ext ->> 'latitude', '')::numeric;
      n.external_longitude := nullif(v_ext ->> 'longitude', '')::numeric;
      n.external_address_provider_ref := nullif(v_ext ->> 'provider_ref', '');
    elsif n.location_kind = 'ONLINE' then n.online_url := nullif(btrim(coalesce(v_patch ->> 'online_url', '')), '');
    else raise exception 'A place is a club venue, an external address or online.' using errcode = '22023';
    end if;
  elsif v_patch ? 'venue_id' and n.location_kind = 'VENUE' then
    n.venue_id := nullif(v_patch ->> 'venue_id', '')::uuid;
  end if;

  -- AUTHORITY OVER THE AUDIENCE. Below club level, only an event confined to sides you manage.
  if not v_club_level then
    if n.is_club_wide then raise exception 'Only club administration can make an event club-wide.' using errcode = '42501'; end if;
    if coalesce(array_length(v_team_ids, 1), 0) = 0 then
      raise exception 'Choose the sides this event is for.' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(v_team_ids) t(id) where not internal.can('calendar.event.manage', 'team', v_club, t.id, null)) then
      raise exception 'You do not have permission to include one of those teams.' using errcode = '42501';
    end if;
    if n.visibility = 'CLUB' then raise exception 'Only club administration can show an event to the whole club.' using errcode = '42501'; end if;
  end if;

  -- SHAPE.
  if length(n.name) = 0 or length(n.name) > 100 then raise exception 'An event needs a name of up to 100 characters.' using errcode = '22023'; end if;
  if n.ends_on < n.starts_on then raise exception 'An event cannot end before it starts.' using errcode = '22023'; end if;
  if n.ends_on = n.starts_on and n.start_time is not null and n.end_time is not null and n.end_time < n.start_time then
    raise exception 'An event cannot finish before it begins.' using errcode = '22023';
  end if;
  if n.meet_time is not null and n.start_time is not null and n.meet_time > n.start_time then
    raise exception 'The arrival time is before the start.' using errcode = '22023';
  end if;
  if n.location_kind = 'VENUE' and (n.venue_id is null or not exists (select 1 from public.venues v where v.id = n.venue_id and v.club_id = v_club and v.active)) then
    raise exception 'Choose one of the club''s own venues.' using errcode = '42501';
  end if;
  if n.location_kind = 'EXTERNAL' and n.external_location_name is null then
    raise exception 'Name the external place.' using errcode = '22023';
  end if;
  if n.location_kind = 'ONLINE' and (n.online_url is null or n.online_url !~* '^https://') then
    raise exception 'An online event needs a meeting link starting https://.' using errcode = '22023';
  end if;
  if n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) > 0 then
    raise exception 'A club-wide event covers every team and does not list them individually.' using errcode = '22023';
  end if;
  if not n.is_club_wide and coalesce(array_length(v_team_ids, 1), 0) = 0 and coalesce(array_length(v_user_ids, 1), 0) = 0 and v_patch ? 'team_ids' then
    raise exception 'Invite the whole club, some teams or some people.' using errcode = '22023';
  end if;
  select t.id into v_bad from unnest(v_team_ids) t(id)
   where not exists (select 1 from public.teams tm where tm.id = t.id and tm.club_id = v_club) limit 1;
  if v_bad is not null then raise exception 'One of those teams does not belong to this club.' using errcode = '42501'; end if;
  if n.host_team_id is not null and not exists (select 1 from public.teams tm where tm.id = n.host_team_id and tm.club_id = v_club) then
    raise exception 'The host team must belong to this club.' using errcode = '42501';
  end if;
  if n.host_team_id is not null and not v_club_level and not internal.can('calendar.event.manage', 'team', v_club, n.host_team_id, null) then
    raise exception 'You can only host an event for a team you manage.' using errcode = '42501';
  end if;
  -- A NAMED PERSON must already belong to the club (a member, or the family of one of its players).
  select u.id into v_bad from unnest(v_user_ids) u(id)
   where not exists (select 1 from public.club_memberships cm where cm.user_id = u.id and cm.club_id = v_club and cm.status = 'active')
     and not exists (select 1 from public.guardians g join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
                       join public.teams t on t.id = ptm.team_id where g.guardian_user_id = u.id and g.status = 'active' and t.club_id = v_club)
   limit 1;
  if v_bad is not null then raise exception 'You can invite people from your own club only.' using errcode = '42501'; end if;
  if n.cover_stock_key is not null and not internal.stock_media_allowed(n.cover_stock_key, 'EVENT') then
    raise exception 'That is not an Ovalball event picture.' using errcode = '22023';
  end if;
  if n.cover_image_path is not null and split_part(n.cover_image_path, '/', 1) <> coalesce(v_id::text, '') then
    raise exception 'Upload the picture to this event first.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.club_events (club_id, name, event_type, description, starts_on, ends_on, start_time, end_time, meet_time,
        host_team_id, is_club_wide, invite_players, invite_staff, invite_members, visibility, rsvp_required, rsvp_deadline,
        max_guests, catering_required, catering_notes, catering_deadline, capacity, waiting_list_enabled, payment_mode, price_note,
        cover_stock_key, location_kind, location_detail, venue_id, external_location_name, external_address_line_1,
        external_address_line_2, external_town, external_county, external_postcode, external_country, external_latitude,
        external_longitude, external_address_provider_ref, online_url, status, created_by, updated_by, season_id)
    values (v_club, n.name, n.event_type, n.description, n.starts_on, n.ends_on, n.start_time, n.end_time, n.meet_time,
        n.host_team_id, n.is_club_wide, n.invite_players, n.invite_staff, n.invite_members, n.visibility, n.rsvp_required, n.rsvp_deadline,
        n.max_guests, n.catering_required, n.catering_notes, n.catering_deadline, n.capacity, n.waiting_list_enabled, n.payment_mode, n.price_note,
        n.cover_stock_key, n.location_kind, n.location_detail, n.venue_id, n.external_location_name, n.external_address_line_1,
        n.external_address_line_2, n.external_town, n.external_county, n.external_postcode, n.external_country, n.external_latitude,
        n.external_longitude, n.external_address_provider_ref, n.online_url, 'DRAFT', auth.uid(), auth.uid(),
        (select s.id from public.seasons s join public.clubs c on c.id = v_club join public.club_directory d on d.id = c.directory_id
          where s.rugby_code = d.rugby_code and n.starts_on between s.starts_on and s.ends_on order by s.starts_on desc limit 1))
    returning id into v_id;
  else
    if e.status = 'CANCELLED' then raise exception 'A cancelled event cannot be changed.' using errcode = '22023'; end if;
    if n.starts_on is distinct from e.starts_on or n.ends_on is distinct from e.ends_on then v_changed := array_append(v_changed, 'date'); end if;
    if n.start_time is distinct from e.start_time or n.end_time is distinct from e.end_time or n.meet_time is distinct from e.meet_time then v_changed := array_append(v_changed, 'time'); end if;
    if n.location_kind is distinct from e.location_kind or n.venue_id is distinct from e.venue_id
       or n.external_location_name is distinct from e.external_location_name or n.external_postcode is distinct from e.external_postcode
       or n.online_url is distinct from e.online_url then v_changed := array_append(v_changed, 'place'); end if;
    update public.club_events set
      name = n.name, event_type = n.event_type, description = n.description, starts_on = n.starts_on, ends_on = n.ends_on,
      start_time = n.start_time, end_time = n.end_time, meet_time = n.meet_time, host_team_id = n.host_team_id,
      is_club_wide = n.is_club_wide, invite_players = n.invite_players, invite_staff = n.invite_staff, invite_members = n.invite_members,
      visibility = n.visibility, rsvp_required = n.rsvp_required, rsvp_deadline = n.rsvp_deadline, max_guests = n.max_guests,
      catering_required = n.catering_required, catering_notes = n.catering_notes, catering_deadline = n.catering_deadline,
      capacity = n.capacity, waiting_list_enabled = n.waiting_list_enabled, payment_mode = n.payment_mode, price_note = n.price_note,
      cover_stock_key = n.cover_stock_key, cover_image_path = n.cover_image_path, location_kind = n.location_kind,
      location_detail = n.location_detail, venue_id = n.venue_id, external_location_name = n.external_location_name,
      external_address_line_1 = n.external_address_line_1, external_address_line_2 = n.external_address_line_2,
      external_town = n.external_town, external_county = n.external_county, external_postcode = n.external_postcode,
      external_country = n.external_country, external_latitude = n.external_latitude, external_longitude = n.external_longitude,
      external_address_provider_ref = n.external_address_provider_ref, online_url = n.online_url,
      -- A postponed event given a new date is back on.
      status = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then 'SCHEDULED' else e.status end,
      status_note = case when e.status = 'POSTPONED' and 'date' = any(v_changed) then null else e.status_note end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id;
    -- Guests beyond the new rule are trimmed rather than left over the limit; food follows.
    update public.club_event_responses set guest_count = least(guest_count, n.max_guests),
           catering_count = case when n.catering_required then least(catering_count, least(guest_count, n.max_guests) + 1) else 0 end,
           dietary = case when n.catering_required then dietary else '{}'::jsonb end, updated_at = now()
     where event_id = v_id and (guest_count > n.max_guests or (not n.catering_required and catering_count > 0));
  end if;

  delete from public.club_event_teams where event_id = v_id and not (team_id = any(v_team_ids));
  insert into public.club_event_teams (event_id, team_id) select v_id, t from unnest(v_team_ids) t on conflict do nothing;
  delete from public.club_event_invitees where event_id = v_id and not (user_id = any(v_user_ids));
  insert into public.club_event_invitees (event_id, user_id, added_by) select v_id, u, auth.uid() from unnest(v_user_ids) u on conflict do nothing;

  -- ONE NOTICE FOR ONE SAVE, only once people have been invited, only for what changes their plans.
  if e.id is not null and e.invitations_sent_at is not null and e.status in ('SCHEDULED', 'POSTPONED') and cardinality(v_changed) > 0 then
    select * into n from public.club_events where id = v_id;
    v_notified := internal.club_event_notify(v_id, array(select r.user_id from internal.club_event_recipients(v_id) r),
      'event_updated', n.name || ' updated',
      'The event is now ' || internal.club_event_date_label(n) || ' at ' || coalesce(internal.club_event_place_label(n), 'a place to be confirmed') || '.',
      jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  if e.id is not null and n.capacity is distinct from e.capacity then
    perform internal.club_event_promote_waiting(v_id);
  end if;

  return jsonb_build_object('eventId', v_id, 'notified', v_notified, 'changed', to_jsonb(v_changed));
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 3. A CHANGING ROOM'S OWN PHOTO CAN BE UPLOADED
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.may_manage_changing_room_media(p_name text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  m text[];
  v_club_id uuid;
  v_room_id uuid;
  v_owner uuid;
begin
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/changing-room-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
  if m is null then
    return false;
  end if;
  v_club_id := m[1]::uuid;
  v_room_id := m[2]::uuid;
  select club_id into v_owner from public.venue_changing_rooms where id = v_room_id;
  if v_owner is null or v_owner <> v_club_id then
    return false;
  end if;
  return internal.can_manage_venue(v_club_id);
end;
$function$;
revoke execute on function internal.may_manage_changing_room_media(text) from public, anon;
grant execute on function internal.may_manage_changing_room_media(text) to authenticated;

drop policy if exists club_news_media_changing_room_insert on storage.objects;
drop policy if exists club_news_media_changing_room_select on storage.objects;
drop policy if exists club_news_media_changing_room_update on storage.objects;
drop policy if exists club_news_media_changing_room_delete on storage.objects;
create policy club_news_media_changing_room_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-news-media' and internal.may_manage_changing_room_media(name));
create policy club_news_media_changing_room_select on storage.objects for select to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_changing_room_media(name));
create policy club_news_media_changing_room_update on storage.objects for update to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_changing_room_media(name))
  with check (bucket_id = 'club-news-media' and internal.may_manage_changing_room_media(name));
create policy club_news_media_changing_room_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_changing_room_media(name));
