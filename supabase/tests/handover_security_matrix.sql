-- Who can run a season handover, and on whose club.
--
-- The handover mutates a club's whole team structure and its players'
-- memberships, so every entry point needs the same answer to "is this person
-- allowed, and allowed HERE". This suite runs each entry point as a real
-- authenticated user rather than reading the permission checks.
--
-- Roles used: CLUB_ADMIN and FIXTURE_SECRETARY at club A, a BASIC_USER at club
-- A, and a CLUB_ADMIN at an unrelated club B.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin_a uuid := gen_random_uuid();
  v_fixsec_a uuid := gen_random_uuid();
  v_basic_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_to uuid; v_team uuid; v_prop uuid; v_player uuid; v_q uuid;
  v_err text; v_ok boolean; v_n int;

  procedure_as text;
begin

-- ---------- people ----------
insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin_a ,'hs-admin-a@ovalball-test.invalid' ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_fixsec_a,'hs-fixsec-a@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_basic_a ,'hs-basic-a@ovalball-test.invalid' ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_admin_b ,'hs-admin-b@ovalball-test.invalid' ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin_a ,'A','Admin' ,'hs-admin-a@ovalball-test.invalid'),
  (v_fixsec_a,'F','Sec'   ,'hs-fixsec-a@ovalball-test.invalid'),
  (v_basic_a ,'B','Basic' ,'hs-basic-a@ovalball-test.invalid'),
  (v_admin_b ,'B','Admin' ,'hs-admin-b@ovalball-test.invalid');

-- ---------- clubs ----------
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('HS A RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','hs-a-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir_a;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('HS B RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','hs-b-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir_b;
insert into public.clubs (directory_id, slug, status) values (v_dir_a,'hs-a-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club_a;
insert into public.clubs (directory_id, slug, status) values (v_dir_b,'hs-b-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club_b;

insert into public.club_memberships (club_id, user_id, role, status) values
  (v_club_a, v_admin_a , 'CLUB_ADMIN'        , 'active'),
  (v_club_a, v_fixsec_a, 'FIXTURE_SECRETARY' , 'active'),
  (v_club_a, v_basic_a , 'BASIC_USER'        , 'active'),
  (v_club_b, v_admin_b , 'CLUB_ADMIN'        , 'active');

-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('HS 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club_a,'union','youth','U16','boys','x','hs1') returning id into v_team;
insert into public.players (first_name, surname, date_of_birth, active)
values ('HS','Player',(current_date - interval '15 years')::date,true) returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');

-- ============ 1. A stranger's Club Admin cannot touch this club ============

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.generate_rollover_proposal(v_club_a,'union',v_to);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Not authorized%' then
  raise notice 'PASS 1: another club''s Club Admin cannot PREPARE a handover for this club';
else
  raise notice 'FAIL 1: club B''s admin prepared club A''s handover (%)', coalesce(v_err,'no error');
end if;

-- ============ 2. A member with no authority cannot prepare ============

perform set_config('request.jwt.claims', json_build_object('sub', v_basic_a,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.generate_rollover_proposal(v_club_a,'union',v_to);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Not authorized%' then
  raise notice 'PASS 2: an ordinary club member cannot PREPARE a handover';
else
  raise notice 'FAIL 2: a BASIC_USER prepared a handover (%)', coalesce(v_err,'no error');
end if;

-- ============ 3. The club's own admin can ============

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a,'role','authenticated')::text, true);
perform public.generate_rollover_proposal(v_club_a,'union',v_to);
select id into v_prop from public.age_grade_rollover_team_proposals where team_id = v_team;
if v_prop is not null then
  raise notice 'PASS 3: the club''s own Club Admin can prepare its handover';
else
  raise notice 'FAIL 3: the club''s own admin could not prepare';
end if;

-- ============ 4. Applying is gated the same way ============

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 4: another club''s admin cannot APPLY this club''s proposal';
else
  raise notice 'FAIL 4: club B''s admin applied club A''s proposal';
end if;

if (select age_group from public.teams where id=v_team) = 'U16'
   and (select decision from public.age_grade_rollover_team_proposals where id=v_prop) = 'pending' then
  raise notice 'PASS 5: the refused cross-club apply changed nothing';
else
  raise notice 'FAIL 5: a refused cross-club apply still mutated state';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_basic_a,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 6: an ordinary club member cannot APPLY a proposal';
else
  raise notice 'FAIL 6: a BASIC_USER applied a proposal';
end if;

-- ============ 5. Graduating a cohort needs Club Admin, not merely fixtures ==

perform set_config('request.jwt.claims', json_build_object('sub', v_fixsec_a,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.graduate_team(v_team);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Club Admin%' then
  raise notice 'PASS 7: graduating a cohort is held to Club Admin -- a Fixture Secretary cannot archive a team and empty it';
elsif v_ok then
  raise notice 'PASS 7: graduating a cohort is refused for a Fixture Secretary (%)', left(v_err,50);
else
  raise notice 'FAIL 7: a Fixture Secretary graduated a cohort';
end if;

-- ============ 6. Reading another club's handover ============

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b,'role','authenticated')::text, true);
perform set_config('role','authenticated', true);
select count(*) into v_n from public.age_grade_rollovers where club_id = v_club_a;
perform set_config('role','postgres', true);
if v_n = 0 then
  raise notice 'PASS 8: another club''s admin cannot even SEE this club''s handover';
else
  raise notice 'FAIL 8: club B''s admin can read % of club A''s handover rows', v_n;
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_basic_a,'role','authenticated')::text, true);
perform set_config('role','authenticated', true);
select count(*) into v_n from public.age_grade_rollover_team_proposals;
perform set_config('role','postgres', true);
if v_n = 0 then
  raise notice 'PASS 9: an ordinary club member cannot read the handover proposals for their own club';
else
  raise notice 'FAIL 9: a BASIC_USER can read % handover proposals', v_n;
end if;

-- ============ 7. Player placement is a capability, not a role guess ========

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a,'role','authenticated')::text, true);
perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);

insert into public.player_graduation_queue (player_id, source_team_id, club_id)
values (v_player, v_team, v_club_a) returning id into v_q;

perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.place_graduating_player(v_q, v_team);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 10: another club''s admin cannot place this club''s graduating player';
else
  raise notice 'FAIL 10: a stranger placed a graduating player';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_basic_a,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.mark_graduating_player_left(v_q);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Not authorized%' then
  raise notice 'PASS 11: an ordinary member cannot record a player as having left -- that now ends a real membership';
else
  raise notice 'FAIL 11: a BASIC_USER ended a player''s membership (%)', coalesce(v_err,'no error');
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
