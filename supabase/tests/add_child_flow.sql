-- Adding a child: the first one must behave like the second.
--
-- REPORTED LIVE: "Child 1 does not get added correctly. Child 2 proceeds
-- through the adding flow."
--
-- That is real, and it is not an index-0 bug, a form-state bug or an RLS bug.
-- add_child_for_guardian carries a deliberate invite-only guard: the caller
-- must ALREADY hold one of three relationships with the club --
--
--   1. an accepted guardian invitation from it, or
--   2. an existing guardian relationship to a player at it, or
--   3. an active club membership
--
-- Route 2 is why the second child works: adding the first one creates exactly
-- the relationship the guard is looking for. A brand-new parent arriving with
-- none of the three is refused on their first child and passes on every one
-- after.
--
-- The guard itself is a safeguarding control and is NOT relaxed here -- its
-- own comment records that without it "an unrelated signed-in person [can]
-- invent a child at a club they have nothing to do with and declare
-- themselves its guardian". What was broken is that its clear, actionable
-- message was not on the app's safe-error allowlist, so the parent saw
-- "We couldn't add this child right now. Please sign out and back in" --
-- advice that cannot work, for a refusal that was deliberate.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Adding a child: first, second and third ==='

begin;

do $$
declare
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_club uuid; v_dir uuid; v_team uuid;
  v_r record; v_count int; v_msg text;
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id
  where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise exception 'FAIL setup: the local UAT club is missing; run supabase/seeds/local_uat_parent_player.sql';
  end if;
  select id into v_team from public.teams where club_id = v_club and age_group = 'U12' and squad_designation is null;

  for v_r in select unnest(array[v_parent, v_stranger]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','acf-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'ACF','Tester','acf-'||v_r.id::text||'@ovalball.test');
  end loop;

  -- =================================================================
  -- A. The guard refuses someone with no relationship to the club
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.add_child_for_guardian('Nobody','Child','2015-01-01', v_club, 'union');
    raise exception 'FAIL 1 (A): an unrelated account added a child to a club it has nothing to do with';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'You need an invitation from this club%' then
      raise notice 'PASS 1 (A): an unrelated account is refused, with the specific reason -- not a generic failure';
    else
      raise exception 'FAIL 1 (A): refused with an unexpected message: %', v_msg;
    end if;
  end;
  reset role;

  -- =================================================================
  -- B. With a legitimate route in, the FIRST child succeeds
  -- =================================================================
  -- Route 1: the canonical way a new parent arrives -- an accepted guardian
  -- invitation from the club. This is the case the live report was missing.
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, status, accepted_by, accepted_at)
  values (v_club, v_team, 'acf-'||v_parent::text||'@ovalball.test', v_parent, 'accepted', v_parent, now());

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text,'role','authenticated')::text, true);

  select * into v_r from public.add_child_for_guardian('Firstborn','Acfamily','2015-02-02', v_club, 'union');
  if v_r.player_id is not null then
    raise notice 'PASS 2 (B): the FIRST child is created (result=%)', v_r.result;
  else
    raise exception 'FAIL 2 (B): the first child produced no player';
  end if;

  select * into v_r from public.add_child_for_guardian('Secondborn','Acfamily','2016-03-03', v_club, 'union');
  if v_r.player_id is not null then
    raise notice 'PASS 3 (B): the SECOND child is created (result=%)', v_r.result;
  else
    raise exception 'FAIL 3 (B): the second child produced no player';
  end if;

  select * into v_r from public.add_child_for_guardian('Thirdborn','Acfamily','2017-04-04', v_club, 'union');
  if v_r.player_id is not null then
    raise notice 'PASS 4 (B): the THIRD child is created (result=%) -- no index-0 special case', v_r.result;
  else
    raise exception 'FAIL 4 (B): the third child produced no player';
  end if;

  -- =================================================================
  -- C. Three distinct children, three distinct identities
  -- =================================================================
  select count(distinct g.player_id) into v_count
  from public.guardians g where g.guardian_user_id = v_parent and g.status = 'active';
  if v_count = 3 then
    raise notice 'PASS 5 (C): three separate guardian relationships to three separate players';
  else
    raise exception 'FAIL 5 (C): expected 3 distinct linked players, found %', v_count;
  end if;

  select count(*) into v_count
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = v_parent
  where p.first_name in ('Firstborn','Secondborn','Thirdborn');
  if v_count = 3 then
    raise notice 'PASS 6 (C): each child kept its own name -- none overwrote another';
  else
    raise exception 'FAIL 6 (C): % of 3 children kept their own identity', v_count;
  end if;
  reset role;

  -- =================================================================
  -- D. A duplicate does not silently mint a second player, and does not
  --    silently hand a new adult access to an existing child
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text,'role','authenticated')::text, true);
  select * into v_r from public.add_child_for_guardian('Firstborn','Acfamily','2015-02-02', v_club, 'union');
  reset role;

  select count(*) into v_count from public.players
  where first_name = 'Firstborn' and surname = 'Acfamily' and date_of_birth = '2015-02-02';
  if v_count = 1 then
    raise notice 'PASS 7 (D): re-adding the same child does NOT create a second player row (result=%)', v_r.result;
  else
    raise exception 'FAIL 7 (D): % player rows exist for one child', v_count;
  end if;

  raise notice 'Add-a-child flow complete.';
end $$;

rollback;
