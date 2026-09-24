-- A PRICE PREVIEW ANSWERS ONLY WHO MAY SEE THE PRICE (CA-M1 price-oracle containment).
--
-- `preview_first_payment_illustrative` is SECURITY DEFINER and authenticated-callable. Before
-- containment it answered for any programme id. Now it answers exactly the callers who could read
-- the programme's own rows under `club_subscription_programmes_select_scoped`, and is silent for
-- everybody else -- indistinguishable from an unknown programme.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_dir uuid; v_dir2 uuid;
  v_club uuid; v_club2 uuid;
  v_team uuid; v_player uuid;
  v_programme uuid;
  v_count int;
  v_amount int;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,       'ppc-owner@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin,  'ppc-admin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_guardian,    'ppc-guardian@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_other_admin, 'ppc-other@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_outsider,    'ppc-outsider@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Price Preview Club', 'union', 'England', 'England', 'manual', 'verified', 'price-preview-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'price-preview-club', 'active') returning id into v_club;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Price Preview Other Club', 'union', 'England', 'England', 'manual', 'verified', 'price-preview-other-club') returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'price-preview-other-club', 'active') returning id into v_club2;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_other_admin, 'CLUB_ADMIN', 'active');

  -- a member family of the programme's club
  insert into public.teams (club_id, rugby_code, display_name, slug, category, age_group, gender, active)
  values (v_club, 'union', 'Under 12 Boys', 'u12-price-preview', 'youth', 'U12', 'boys', true)
  returning id into v_team;
  insert into public.players (first_name, surname, date_of_birth, created_by, playing_pathway)
  values ('Price', 'Child', current_date - interval '11 years', v_club_admin, 'MALE') returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, status) values (v_guardian, v_player, 'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');

  -- the programme, configured by the club through its own domain operation
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  perform public.configure_subscription_programme(v_club, true, 1, 'NONE', 'NEXT_COLLECTION_DAY');
  select id into v_programme from public.club_subscription_programmes where club_id = v_club;
  perform public.set_subscription_price(v_programme, 2500, current_date);

  -- 1. the club's own finance holder still gets the answer
  select count(*), min(monthly_amount_minor) into v_count, v_amount from public.preview_first_payment_illustrative(v_programme, current_date);
  if v_count = 1 and v_amount = 2500 then raise notice 'PASS 1: the club''s finance holder sees the price (%)', v_amount;
  else raise notice 'FAIL 1: the club''s finance holder got % rows', v_count; end if;

  -- 2. a guardian of a member of that club (may read the programme rows) gets the answer
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.preview_first_payment_illustrative(v_programme, current_date);
  if v_count = 1 then raise notice 'PASS 2: a member family of the club sees the price';
  else raise notice 'FAIL 2: a member family got % rows', v_count; end if;

  -- 3. a site commercial viewer gets the answer
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.preview_first_payment_illustrative(v_programme, current_date);
  if v_count = 1 then raise notice 'PASS 3: site commercial view sees the price';
  else raise notice 'FAIL 3: site commercial view got % rows', v_count; end if;

  -- 4. another club's admin, holding the programme id, gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.preview_first_payment_illustrative(v_programme, current_date);
  if v_count = 0 then raise notice 'PASS 4: another club''s admin gets no answer for this programme';
  else raise notice 'FAIL 4: another club''s admin got % rows -- the oracle is still open', v_count; end if;

  -- 5. an unrelated authenticated user gets nothing, and cannot tell the programme exists
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.preview_first_payment_illustrative(v_programme, current_date);
  if v_count = 0 then raise notice 'PASS 5: an unrelated user gets no answer';
  else raise notice 'FAIL 5: an unrelated user got % rows -- the oracle is still open', v_count; end if;
  select count(*) into v_count from public.preview_first_payment_illustrative(gen_random_uuid(), current_date);
  if v_count = 0 then raise notice 'PASS 5b: an unknown programme is equally silent';
  else raise notice 'FAIL 5b: unknown programme returned % rows', v_count; end if;

  -- 6. the answer the row policy gives agrees with the answer the function gives
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.club_subscription_programmes where id = v_programme;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then raise notice 'PASS 6: the row policy hides the programme from the same caller the function is silent for';
  else raise notice 'FAIL 6: row policy exposed the programme to another club''s admin (% rows)', v_count; end if;

  -- 7. grants unchanged: authenticated yes, anon no
  if has_function_privilege('authenticated', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE') then
    raise notice 'PASS 7: grants unchanged (authenticated yes, anon no)';
  else raise notice 'FAIL 7: grants changed'; end if;
end $$;

rollback;
