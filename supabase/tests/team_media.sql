-- TEAM PROFILE MEDIA -- the canonical Team Gallery (team_media, add_team_media, remove_team_media,
-- read_team_media), the governed cover write (set_team_cover) and the private Team Gallery bucket's
-- own authority function (internal.may_access_team_gallery_media), proving Section 5's own RED-risk
-- authority list.
--
--   TM1/TM2   an authorised viewer (team.roster.view) reads Team A's media; a stranger is refused
--   TM3       Team A's media never appears when reading Team B, and vice versa
--   TM4/TM5   a team manager (team.team.manage) can add a photo; a roster-view-only viewer cannot
--   TM6       add_team_media refuses a storage path that does not belong to this team
--   TM7       a Club Admin (club.profile.edit) can manage Team Gallery media with no personal team role
--   TM8       remove_team_media requires the same authority as adding; an unauthorised caller is refused
--   TM9       removing Team A's media never touches Team B's
--   TM10      read_team_media never returns a removed (soft-deleted) photo
--   TM11/TM12 set_team_cover: an uploaded path must belong to this team; a stock key must be on the
--             server's own allow-list; an unrecognised key is refused
--   TM13      set_team_cover refuses a storage path AND a stock key given together
--   TM14      a person delegated on Team A cannot add/remove Team B's media
--   TM15/16   the gallery bucket's own authority function: write needs manage, view needs roster view,
--             and a malformed path is refused outright regardless of who is asking
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default '1985-01-01') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tm-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tm', p_label, 'tm-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TM ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tm-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tm-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_label text default 'Team', p_gender text default 'girls') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'tm-' || v_tag, 'youth', 'U14', p_gender, 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status, state) values (p_club, p_user, 'BASIC_USER', 'active', 'ACTIVE') returning id into v;
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'OK';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlerrm;
end $$;

create or replace function pg_temp.as_subject(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
select pg_temp.club('Media') as club_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team A', 'girls') as team_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team B', 'boys') as team_b \gset

select pg_temp.person('Club Admin') as admin_id \gset
select pg_temp.member(:'club_a'::uuid, :'admin_id'::uuid) as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TM setup'::text, '{}'::jsonb);

-- Team A's own delegated Team Administration holder (never given a club-level role) -- TEAM_MANAGER
-- alone does NOT carry team.team.manage (confirmed live: only the CA and TA bundles do), so "a team's
-- own delegated manager" for cover/gallery purposes is specifically TEAM_ADMINISTRATION, matching
-- exactly what `canEditCover`/`set_team_description` already gate on.
select pg_temp.person('Team Admin A') as manager_id \gset
select pg_temp.member(:'club_a'::uuid, :'manager_id'::uuid) as manager_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'manager_membership', :'team_a')) as seed_mgr0 \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_ADMINISTRATION'', %L::uuid, ''seed'')', :'manager_membership', :'team_a')) as seed_mgr \gset
select pg_temp.check(:'seed_mgr0' = 'OK' and :'seed_mgr' = 'OK', 'setup: Team A delegated Team Administration holder');

-- A roster-view-only participant: TEAM_MANAGER holds team.roster.view (confirmed live) but NOT
-- team.team.manage (only CA/TA hold that) -- the correct "may view, may not manage cover/gallery"
-- persona. FIRST_AIDER was tried first and does NOT hold team.roster.view at all (its VO bundle's own
-- team-scoped capability is team.team.view only), so it cannot stand in for "authorised viewer" here.
select pg_temp.person('Roster Viewer') as viewer_id \gset
select pg_temp.member(:'club_a'::uuid, :'viewer_id'::uuid) as viewer_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_MANAGER'', %L::uuid, ''seed'')', :'viewer_membership', :'team_a')) as seed_view \gset
select pg_temp.check(:'seed_view' = 'OK', 'setup: Team A Team Manager (roster-view, not gallery-manage)');

select pg_temp.person('Stranger') as stranger_id \gset

-- A valid, real path for a Team A photo -- {team_id}/{uuid}.jpg.
select :'team_a'::text || '/' || gen_random_uuid()::text || '.jpg' as valid_path_a \gset
select :'team_b'::text || '/' || gen_random_uuid()::text || '.jpg' as valid_path_b \gset

-- =========================================================================
-- TM4/TM5: only a genuine manager may add a photo
-- =========================================================================
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_media(%L::uuid, %L::text, ''First training session'')', :'team_a', :'valid_path_a')) as g1 \gset
select pg_temp.check(:'g1' = 'OK', 'TM4 Team A''s own manager can add a photo (' || :'g1' || ')');

select pg_temp.try_as(:'viewer_id'::uuid, format('select public.add_team_media(%L::uuid, %L::text, ''unauthorised'')', :'team_a', :'valid_path_a')) as g2 \gset
select pg_temp.check(:'g2' != 'OK', 'TM5 a roster-view-only participant cannot add a photo (' || :'g2' || ')');

-- =========================================================================
-- TM1/TM2: read authority
-- =========================================================================
select pg_temp.try_as(:'viewer_id'::uuid, format('select * from public.read_team_media(%L::uuid)', :'team_a')) as r1 \gset
select pg_temp.check(:'r1' = 'OK', 'TM1 an authorised roster viewer reads Team A''s media (' || :'r1' || ')');

select pg_temp.try_as(:'stranger_id'::uuid, format('select * from public.read_team_media(%L::uuid)', :'team_a')) as r2 \gset
select pg_temp.check(:'r2' != 'OK', 'TM2 an unrelated stranger is refused outright (' || :'r2' || ')');

-- =========================================================================
-- TM3: Team A's media never appears on Team B's own read
-- =========================================================================
select pg_temp.as_subject(:'admin_id'::uuid, format('select count(*)::text from public.read_team_media(%L::uuid)', :'team_b')) as team_b_count \gset
select pg_temp.check(:'team_b_count'::integer = 0, 'TM3 Team A''s photo does not leak into Team B''s own read (' || :'team_b_count' || ')');

-- =========================================================================
-- TM6: a storage path belonging to another team is refused
-- =========================================================================
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_media(%L::uuid, %L::text, ''cross-team path'')', :'team_a', :'valid_path_b')) as g3 \gset
select pg_temp.check(:'g3' != 'OK', 'TM6 a storage path stamped for Team B is refused when adding to Team A (' || :'g3' || ')');

-- =========================================================================
-- TM7: a Club Admin (club-level authority, no personal team role) can add media directly
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.add_team_media(%L::uuid, %L::text, ''Club Admin upload'')', :'team_b', :'valid_path_b')) as g4 \gset
select pg_temp.check(:'g4' = 'OK', 'TM7 a Club Admin can add Team B media with no personal team role (' || :'g4' || ')');

-- =========================================================================
-- TM8/TM9: removal authority and isolation
-- =========================================================================
select id as media_a_id from public.team_media where team_id = :'team_a'::uuid and storage_path = :'valid_path_a' \gset
select id as media_b_id from public.team_media where team_id = :'team_b'::uuid and storage_path = :'valid_path_b' \gset

select pg_temp.try_as(:'viewer_id'::uuid, format('select public.remove_team_media(%L::uuid)', :'media_a_id')) as rm1 \gset
select pg_temp.check(:'rm1' != 'OK', 'TM8 a roster-view-only participant cannot remove a photo (' || :'rm1' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.remove_team_media(%L::uuid)', :'media_a_id')) as rm2 \gset
select pg_temp.check(:'rm2' = 'OK', 'setup: Team A''s manager removes Team A''s own photo');

select pg_temp.as_subject(:'admin_id'::uuid, format('select count(*)::text from public.read_team_media(%L::uuid)', :'team_b')) as team_b_count_after \gset
select pg_temp.check(:'team_b_count_after'::integer = 1, 'TM9 removing Team A''s photo leaves Team B''s own photo untouched (' || :'team_b_count_after' || ')');

-- =========================================================================
-- TM10: a removed photo never resurfaces in read_team_media
-- =========================================================================
select pg_temp.as_subject(:'admin_id'::uuid, format('select count(*)::text from public.read_team_media(%L::uuid) where id = %L::uuid', :'team_a', :'media_a_id')) as removed_count \gset
select pg_temp.check(:'removed_count'::integer = 0, 'TM10 a removed photo never resurfaces in read_team_media');

-- =========================================================================
-- TM14: cross-team refusal for a Team A delegate against Team B
-- =========================================================================
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_media(%L::uuid, %L::text, ''cross-team attempt'')', :'team_b', :'team_b'::text || '/' || gen_random_uuid()::text || '.jpg')) as g5 \gset
select pg_temp.check(:'g5' != 'OK', 'TM14 Team A''s own manager cannot add media to Team B (' || :'g5' || ')');

-- =========================================================================
-- TM11/TM12/TM13: set_team_cover
-- =========================================================================
select :'club_a'::text || '/' || :'team_a'::text || '/' || gen_random_uuid()::text || '.jpg' as cover_path_a \gset
select pg_temp.try_as(:'manager_id'::uuid, format('select public.set_team_cover(%L::uuid, %L::text, null)', :'team_a', :'cover_path_a')) as c1 \gset
select pg_temp.check(:'c1' = 'OK', 'TM11a a genuine, correctly-shaped upload path is accepted (' || :'c1' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.set_team_cover(%L::uuid, %L::text, null)', :'team_a', :'valid_path_a')) as c2 \gset
select pg_temp.check(:'c2' != 'OK', 'TM11b a Team Gallery-shaped path (wrong bucket shape) is refused as a cover (' || :'c2' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.set_team_cover(%L::uuid, null, ''rugby-team-scrum-01'')', :'team_a')) as c3 \gset
select pg_temp.check(:'c3' = 'OK', 'TM11c a recognised Ovalball library key is accepted (' || :'c3' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.set_team_cover(%L::uuid, null, ''not-a-real-key'')', :'team_a')) as c4 \gset
select pg_temp.check(:'c4' != 'OK', 'TM12 an unrecognised stock key is refused outright (' || :'c4' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.set_team_cover(%L::uuid, %L::text, ''rugby-team-scrum-01'')', :'team_a', :'cover_path_a')) as c5 \gset
select pg_temp.check(:'c5' != 'OK', 'TM13 a storage path AND a stock key together are refused (' || :'c5' || ')');

-- =========================================================================
-- TM15/TM16: the Team Gallery bucket's own authority function
-- =========================================================================
select pg_temp.as_subject(:'manager_id'::uuid, format('select internal.may_access_team_gallery_media(%L::text, true)::text', :'valid_path_a')) as write_by_manager \gset
select pg_temp.check(:'write_by_manager' = 'true', 'TM15a Team A''s manager may write to a correctly-shaped Team A path');

select pg_temp.as_subject(:'viewer_id'::uuid, format('select internal.may_access_team_gallery_media(%L::text, true)::text', :'valid_path_a')) as write_by_viewer \gset
select pg_temp.check(:'write_by_viewer' = 'false', 'TM15b a roster-view-only participant may not write');

select pg_temp.as_subject(:'viewer_id'::uuid, format('select internal.may_access_team_gallery_media(%L::text, false)::text', :'valid_path_a')) as view_by_viewer \gset
select pg_temp.check(:'view_by_viewer' = 'true', 'TM15c a roster-view-only participant may still view');

select pg_temp.as_subject(:'stranger_id'::uuid, format('select internal.may_access_team_gallery_media(%L::text, false)::text', :'valid_path_a')) as view_by_stranger \gset
select pg_temp.check(:'view_by_stranger' = 'false', 'TM15d a stranger may not view');

select pg_temp.as_subject(:'manager_id'::uuid, 'select internal.may_access_team_gallery_media(''../not-a-real-path'', true)::text') as malformed \gset
select pg_temp.check(:'malformed' = 'false', 'TM16 a malformed path is refused outright, regardless of who is asking');

rollback;
