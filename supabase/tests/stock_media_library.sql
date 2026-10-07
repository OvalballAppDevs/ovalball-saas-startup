-- =====================================================================================================
-- ONE STOCK MEDIA LIBRARY (20270732000000_one_stock_media_library)
--
--   L  the server's list: every pickable library key, each standing for the kinds of object the library offers
--      it for -- and the ONE check every cover writer now asks
--   D  domains are isolated: a pitch picture is a pitch's cover, never a changing room's or an event's; an
--      event key the library does not hold is refused (it used to be stored and drawn as Christmas)
--   U  a changing room's own photo can be uploaded to its governed path -- by the people who manage the club's
--      grounds, and nobody else
--   P  private media stays private: an event's uploaded cover is readable only by people who can see the event
--
-- Self-contained and transactional: everything it creates is rolled back.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_admin uuid := gen_random_uuid();     -- Club Admin
  v_member uuid := gen_random_uuid();    -- an ordinary member, invited to the event
  v_stranger uuid := gen_random_uuid();  -- Club Admin somewhere else
  v_dir uuid; v_dir_x uuid; v_club uuid; v_club_x uuid;
  v_venue uuid; v_pitch uuid; v_room uuid; v_room_x uuid; v_venue_x uuid;
  v_event uuid;
  v_n int;
  v_path text;
begin
  foreach v_person in array array[v_admin, v_member, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'sml-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Library', 'Person', 'sml-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SML RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sml-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SML Other RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sml-x-' || v_tag) returning id into v_dir_x;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'sml-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_x, 'sml-x-' || v_tag, 'active') returning id into v_club_x;
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN', 'active'), (v_club, v_member, 'BASIC_USER', 'active'), (v_club_x, v_stranger, 'CLUB_ADMIN', 'active');
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club, 'SML Ground', 'sml-v-' || v_tag, true, true) returning id into v_venue;
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club_x, 'SML Other Ground', 'sml-vx-' || v_tag, true, true) returning id into v_venue_x;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club, v_venue, 'Pitch 1', true) returning id into v_pitch;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club, v_venue, 'Home Room', 'full_size', true) returning id into v_room;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club_x, v_venue_x, 'Their Room', 'full_size', true) returning id into v_room_x;

  -- ===============================================================================================
  -- L. THE SERVER'S LIST
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from internal.stock_media;
  -- 69 from 20270732, the 10 approved pictures the Arena pass added in 20270738, and the 2 Arena Home
  -- destination pictures (a changing room and a festival) added to the same block; key-by-key parity with the
  -- library is pinned in supabase/tests/js/stock_media_library.test.mts.
  perform pg_temp.check(v_n = 81, format('L1 the server holds every pickable library picture (%s)', v_n));
  perform pg_temp.check((select domains from internal.stock_media where key = 'pitch-match-02') @> array['VENUE', 'PITCH'],
    'L2 one picture may stand for more than one kind of object -- and is listed once');
  perform pg_temp.check(not exists (select 1 from internal.stock_media where key = 'tournament-default-01'),
    'L3 the tournament default is never a choice, so it is not on the list a writer accepts');
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'stock_key = any\(array\[';
  perform pg_temp.check(v_n = 0, format('L4 no cover writer keeps a list of its own any more (%s inline lists left)', v_n));
  perform pg_temp.check(not has_table_privilege('authenticated', 'internal.stock_media', 'select'),
    'L5 the list is the server''s, not a table the API serves');

  -- ===============================================================================================
  -- D. DOMAINS ARE ISOLATED
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('select public.set_pitch_cover(%L, null, %L)', v_pitch, 'pitch-4g-01')) = 'OK',
    'D1 a pitch picture is a pitch''s cover');
  perform pg_temp.check(pg_temp.try(format('select public.set_pitch_cover(%L, null, %L)', v_pitch, 'training-coaching-01')) = 'OK',
    'D2 including the training pictures the library files under the pitch''s domain');
  perform pg_temp.check(pg_temp.try(format('select public.set_venue_changing_room_cover(%L, null, %L)', v_room, 'pitch-4g-01')) = '22023',
    'D3 but never a changing room''s');
  perform pg_temp.check(pg_temp.try(format('select public.set_venue_changing_room_cover(%L, null, %L)', v_room, 'changing-tiled-01')) = 'OK',
    'D4 a changing room takes a changing-room picture');
  perform pg_temp.check(pg_temp.try(format('select public.set_venue_cover(%L, null, %L)', v_venue, 'changing-tiled-01')) = '22023',
    'D5 a ground never takes a changing room');
  v_event := (public.save_event(null, v_club, jsonb_build_object('name', 'SML Social', 'event_type', 'SOCIAL', 'starts_on', current_date + 30,
    'is_club_wide', true, 'invite_members', true, 'location_kind', 'VENUE', 'venue_id', v_venue, 'cover_stock_key', 'event-awards-01')) ->> 'eventId')::uuid;
  perform pg_temp.check(v_event is not null, 'D6 an event takes an event picture');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_event, '{"cover_stock_key": "event-made-up-01"}')) = '22023',
    'D7 an event key the library does not hold is refused, not stored and drawn as Christmas');
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_event, '{"cover_stock_key": "pitch-4g-01"}')) = '22023',
    'D8 nor is another kind of object''s picture');

  -- ===============================================================================================
  -- U. A CHANGING ROOM'S OWN PHOTO CAN BE UPLOADED
  -- ===============================================================================================
  v_path := v_club::text || '/changing-room-' || v_room::text || '/' || gen_random_uuid()::text || '.jpg';
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'club-news-media', v_path, v_admin)) = 'OK',
    'U1 the club''s admin uploads to the changing room''s governed path');
  perform pg_temp.check(pg_temp.try(format('select public.set_venue_changing_room_cover(%L, %L, null)', v_room, v_path)) = 'OK',
    'U2 and it becomes the room''s own photo');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'club-news-media',
    v_club::text || '/changing-room-' || v_room::text || '/' || gen_random_uuid()::text || '.jpg', v_stranger)) <> 'OK',
    'U3 another club''s admin cannot upload to it');
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(pg_temp.try(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'club-news-media',
    v_club::text || '/changing-room-' || v_room_x::text || '/' || gen_random_uuid()::text || '.jpg', v_admin)) <> 'OK',
    'U4 nor can anybody file a photo under their own club for another club''s room');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(pg_temp.try(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'club-news-media',
    v_club::text || '/changing-room-' || v_room::text || '/' || gen_random_uuid()::text || '.jpg', v_member)) <> 'OK',
    'U5 an ordinary member cannot upload one');

  -- ===============================================================================================
  -- P. PRIVATE MEDIA STAYS PRIVATE
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.send_event_invitations(v_event, null);
  v_path := v_event::text || '/' || extract(epoch from now())::bigint::text || '.jpg';
  perform pg_temp.check(pg_temp.try(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'event-covers', v_path, v_admin)) = 'OK',
    'P1 an organiser uploads the event''s own cover to its private bucket');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(exists (select 1 from storage.objects where bucket_id = 'event-covers' and name = v_path),
    'P2 an invited member can read it');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(not exists (select 1 from storage.objects where bucket_id = 'event-covers' and name = v_path),
    'P3 somebody who cannot see the event cannot fetch its picture');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select count(*) from storage.objects where bucket_id = %L and name = %L', 'event-covers', v_path)) <> 'OK'
                        or not exists (select 1 from storage.objects where bucket_id = 'event-covers' and name = v_path),
    'P4 nor can a signed-out visitor');
end $$;

rollback;
