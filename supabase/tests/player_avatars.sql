-- A child's photograph is more sensitive than their name on a team sheet.
--
-- The adult `avatars` bucket is PUBLIC -- fine for a grown-up publishing a
-- picture of themselves, wrong for a child, because a public bucket serves
-- any object to anyone holding or guessing the URL with no authorization on
-- read at all. Youth photos therefore live in a private bucket reached
-- through short-lived signed URLs, and this suite is what stops that
-- decision being quietly undone.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Player avatars: privacy and authority ==='

begin;

do $$
declare
  v_guardian uuid := gen_random_uuid();
  v_other_guardian uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_club uuid; v_team uuid;
  v_child uuid; v_other_child uuid;
  v_r record; v_n int; v_public boolean; v_path text;
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise exception 'FAIL setup: local UAT club missing';
  end if;
  select id into v_team from public.teams where club_id = v_club and age_group = 'U12' and squad_designation is null limit 1;

  for v_r in select unnest(array[v_guardian, v_other_guardian, v_stranger, v_coach]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','pav-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'PAV','Tester','pav-'||v_r.id::text||'@ovalball.test');
  end loop;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Pippa','Pavfamily','2016-01-01', 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Jaxon','Pavfamily','2013-01-01', 'MALE') returning id into v_other_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_team, 'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_other_child, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_child, 'guardian', 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_other_guardian, v_other_child, 'guardian', 'active');
  -- A coach with real team authority, to prove team staff are NOT included.
  -- team_permissions hangs off a club_memberships row, not a bare user id.
  insert into public.club_memberships (user_id, club_id, role, status) values (v_coach, v_club, 'BASIC_USER', 'active');
  insert into public.team_permissions (membership_id, team_id, permission)
  select cm.id, v_team, 'coach' from public.club_memberships cm
  where cm.user_id = v_coach and cm.club_id = v_club;

  -- =================================================================
  -- A. The bucket itself
  -- =================================================================
  select b.public into v_public from storage.buckets b where b.id = 'player-avatars';
  if v_public is false then
    raise notice 'PASS 1 (A): the player-avatars bucket is PRIVATE -- reads are authorized, not open';
  else
    raise exception 'FAIL 1 (A): player avatars are in a public bucket (public=%)', v_public;
  end if;

  -- The adult bucket is public; that difference is the whole point.
  select b.public into v_public from storage.buckets b where b.id = 'avatars';
  if v_public is true then
    raise notice 'PASS 2 (A): the adult avatars bucket is still public -- a child''s is deliberately not';
  else
    raise notice 'NOTE (A): the adult avatars bucket is no longer public; nothing here depends on that';
  end if;

  -- =================================================================
  -- B. Who may set a picture
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text,'role','authenticated')::text, true);
  v_path := v_child::text || '/avatar.png';
  perform public.set_player_avatar(v_child, v_path);
  raise notice 'PASS 3 (B): a guardian can set their OWN child''s picture';

  -- The decisive one: a guardian must not point their child's record at
  -- another child's image.
  begin
    perform public.set_player_avatar(v_child, v_other_child::text || '/avatar.png');
    raise exception 'FAIL 4 (B): a guardian attached another child''s image to their own child';
  exception when insufficient_privilege then
    raise notice 'PASS 4 (B): a path from another child''s folder is refused';
  end;

  -- ...nor change another child's record at all.
  begin
    perform public.set_player_avatar(v_other_child, v_other_child::text || '/avatar.png');
    raise exception 'FAIL 5 (B): a guardian set a picture for a child they do not hold';
  exception when insufficient_privilege then
    raise notice 'PASS 5 (B): a guardian cannot set a picture for an unrelated child';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.set_player_avatar(v_child, v_child::text || '/avatar.png');
    raise exception 'FAIL 6 (B): an unrelated account set a child''s picture';
  exception when insufficient_privilege then
    raise notice 'PASS 6 (B): an unrelated account cannot set a child''s picture';
  end;
  reset role;

  -- =================================================================
  -- C. Who may see one
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text,'role','authenticated')::text, true);
  if internal.can_access_player_avatar(v_child) then
    raise notice 'PASS 7 (C): a guardian may view their own child''s picture';
  else
    raise exception 'FAIL 7 (C): a guardian cannot view their own child''s picture';
  end if;
  if not internal.can_access_player_avatar(v_other_child) then
    raise notice 'PASS 8 (C): a guardian may NOT view another family''s child''s picture';
  else
    raise exception 'FAIL 8 (C): a guardian can view an unrelated child''s picture';
  end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  if not internal.can_access_player_avatar(v_child) then
    raise notice 'PASS 9 (C): team staff do NOT get a children''s photo library from a coaching role';
  else
    raise exception 'FAIL 9 (C): a coach can read a child''s photograph';
  end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  if not internal.can_access_player_avatar(v_child) then
    raise notice 'PASS 10 (C): an unrelated account cannot read a child''s photograph';
  else
    raise exception 'FAIL 10 (C): an unrelated account can read a child''s photograph';
  end if;
  reset role;

  -- =================================================================
  -- D. A picture is never required
  -- =================================================================
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'players'
    and column_name = 'avatar_storage_path' and is_nullable = 'YES';
  if v_n = 1 then
    raise notice 'PASS 11 (D): avatar_storage_path is optional -- youth participation never requires a photo';
  else
    raise exception 'FAIL 11 (D): a player avatar is not optional';
  end if;

  -- Clearing it is always available to the guardian.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text,'role','authenticated')::text, true);
  perform public.set_player_avatar(v_child, null);
  reset role;
  select avatar_storage_path into v_path from public.players where id = v_child;
  if v_path is null then
    raise notice 'PASS 12 (D): a guardian can remove their child''s picture at any time';
  else
    raise exception 'FAIL 12 (D): the picture could not be removed';
  end if;

  raise notice 'Player avatar privacy complete.';
end $$;

rollback;
