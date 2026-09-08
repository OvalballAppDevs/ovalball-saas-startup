-- Creating a missing successor squad, carrying its staff, and keeping player
-- proposals honest after a team decision.
--
-- PRODUCT RULE: if the team a player normally belongs in does not exist, the
-- club can add it -- the same way the handover provisions the new U6 intake --
-- and the staff move across with the cohort. Offered, never automatic: a club
-- that has just folded a squad has said something.
--
-- Staff need carrying only for a NEWLY CREATED team. A progressing team keeps
-- its stable team_id, so its team_permissions rows follow it without anything
-- being done.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid;
  v_u15 uuid; v_u15b uuid; v_new uuid;
  v_coach_ms uuid;
  v_old_player uuid; v_b_player uuid;
  v_prop uuid; v_bprop uuid; v_teamprop uuid;
  v_n int; v_err text; v_ok boolean; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'st-admin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_coach,'st-coach@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'S','T','st-admin@ovalball-test.invalid'),
  (v_coach,'Coach','Carter','st-coach@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('ST RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','st-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'st-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach,'BASIC_USER','active') returning id into v_coach_ms;

insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('ST 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U15','boys','x','st15') returning id into v_u15;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U15','boys','B','x','st15b') returning id into v_u15b;

-- A coach attached to the U15 side.
insert into public.team_permissions (membership_id, team_id, permission) values (v_coach_ms, v_u15, 'coach');

-- An over-age player in U15: next season his age grade is U17, and this club
-- runs no U17 at all.
insert into public.players (first_name, surname, date_of_birth, active)
values ('Over','Age', date '2011-01-15', true) returning id into v_old_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_old_player, v_u15,'active');

-- An ordinary player in the B squad.
insert into public.players (first_name, surname, date_of_birth, active)
values ('Bee','Squad', date '2012-01-15', true) returning id into v_b_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_b_player, v_u15b,'active');

perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_player_proposals where player_id = v_old_player;
select id into v_bprop from public.age_grade_rollover_player_proposals where player_id = v_b_player;

-- ============ 1. A missing team is a gap, explained ============

if (select proposed_team_id from public.age_grade_rollover_player_proposals where id=v_prop) is null then
  raise notice 'PASS 1: the over-age player has no normal team, because this club runs no U17';
else
  raise notice 'FAIL 1: a team was found where none should exist';
end if;

select reason into v_txt from public.age_grade_rollover_player_proposals where id=v_prop;
if v_txt like '%does not currently run%' and v_txt like '%add that team%' then
  raise notice 'PASS 2: the gap names the missing team and says the club can add it -- not a dead end';
else
  raise notice 'FAIL 2: reason reads [%]', left(coalesce(v_txt,'(none)'),80);
end if;

-- ============ 2. Adding it, with the staff ============

v_new := public.provision_missing_placement_team(v_prop);

if (select age_group from public.teams where id=v_new) = 'U17'
   and (select active from public.teams where id=v_new)
   and (select club_id from public.teams where id=v_new) = v_club then
  raise notice 'PASS 3: the club now runs an active U17 at this club';
else
  raise notice 'FAIL 3: the created team is wrong';
end if;

if (select squad_designation from public.teams where id=v_new) is null then
  raise notice 'PASS 4: it was created as the primary, since the source player was in a primary squad';
else
  raise notice 'FAIL 4: an unexpected squad letter was assigned';
end if;

if exists (select 1 from public.team_permissions where team_id = v_new and membership_id = v_coach_ms and permission = 'coach') then
  raise notice 'PASS 5: the source squad''s coach came across to the new team -- staff travel with the cohort';
else
  raise notice 'FAIL 5: the new team was created with no staff';
end if;

if exists (select 1 from public.team_permissions where team_id = v_u15 and membership_id = v_coach_ms) then
  raise notice 'PASS 6: the coach is still attached to the original side too -- carrying staff over copies, it does not strip';
else
  raise notice 'FAIL 6: the coach was removed from the original team';
end if;

if exists (select 1 from public.team_season_identity where team_id = v_new and season_id = v_to) then
  raise notice 'PASS 7: the new team is registered in the Handover Register for the season it was created for';
else
  raise notice 'FAIL 7: the new team has no season identity';
end if;

-- ============ 3. Creating it resolves the player it was created for ======

if (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id = v_old_player) = v_new then
  raise notice 'PASS 8: the player who had nowhere to go now normally lands in the team just created';
else
  raise notice 'FAIL 8: the player''s proposal was not refreshed after the team appeared';
end if;

-- ============ 4. Adding a team is Club Admin authority ============

declare v_outsider uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_outsider,'st-out@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_outsider,'O','U','st-out@ovalball-test.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub',v_outsider,'role','authenticated')::text, true);
  v_ok := false;
  begin
    perform public.provision_missing_placement_team(v_bprop);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if v_ok then
    raise notice 'PASS 9: creating a team is refused for someone without club authority';
  else
    raise notice 'FAIL 9: an outsider created a team';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
end;

-- ============ 5. Folding a squad creates visible player work ============

-- Re-read by PLAYER, not by the proposal id captured earlier: refreshing
-- deletes and regenerates undecided proposals, so their ids churn. player_id
-- is the stable handle, and any UI addressing a player must use it too.
select id into v_bprop from public.age_grade_rollover_player_proposals where player_id = v_b_player;
if (select review_state from public.age_grade_rollover_player_proposals where id=v_bprop) = 'READY' then
  raise notice 'PASS 10: before the fold, the B-squad player is simply progressing with his team';
else
  raise notice 'FAIL 10: the B-squad player reads [%]',
    (select review_state from public.age_grade_rollover_player_proposals where player_id = v_b_player);
end if;

if (select count(*) from public.age_grade_rollover_player_proposals where player_id = v_b_player) = 1 then
  raise notice 'PASS 10b: refreshing left exactly one proposal per player -- regeneration does not stack duplicates';
else
  raise notice 'FAIL 10b: % proposals exist for one player',
    (select count(*) from public.age_grade_rollover_player_proposals where player_id = v_b_player);
end if;

select id into v_teamprop from public.age_grade_rollover_team_proposals where team_id = v_u15b;
perform public.confirm_rollover_team_proposal(v_teamprop,'fold','Not enough players.',null,'Not enough players.',null);

select review_state, reason into v_txt, v_err
from public.age_grade_rollover_player_proposals where player_id = v_b_player;
if v_txt = 'NEEDS_ATTENTION' then
  raise notice 'PASS 11: folding the squad immediately turned its players into placement work';
else
  raise notice 'FAIL 11: the folded squad''s player still reads [%]', v_txt;
end if;

if v_err like '%not continuing next season%' then
  raise notice 'PASS 12: the player''s reason names the fold, rather than leaving a stale destination';
else
  raise notice 'FAIL 12: reason reads [%]', left(coalesce(v_err,'(none)'),80);
end if;

if exists (select 1 from public.age_grade_rollover_player_proposals where player_id = v_b_player) then
  raise notice 'PASS 13: the player stayed on the board -- folding made the work visible, not invisible';
else
  raise notice 'FAIL 13: the folded squad''s player vanished from the handover';
end if;

-- ============ 6. A decided placement is never recalculated away ============

declare v_decided uuid; v_before uuid;
begin
  select id into v_decided from public.age_grade_rollover_player_proposals where player_id = v_old_player;
  perform public.set_rollover_player_placement(v_decided, v_new);
  select selected_team_id into v_before from public.age_grade_rollover_player_proposals where id = v_decided;

  -- Any further team decision fires the refresh.
  select id into v_teamprop from public.age_grade_rollover_team_proposals where team_id = v_u15;
  perform public.confirm_rollover_team_proposal(v_teamprop,'defer',null,null,null,null);

  if (select selected_team_id from public.age_grade_rollover_player_proposals where id = v_decided) = v_before then
    raise notice 'PASS 14: a reviewer''s chosen placement survived a later team decision untouched';
  else
    raise notice 'FAIL 14: the refresh discarded a human decision';
  end if;
end;

-- ============ 7. One directory, still ============

if (select count(*) from public.teams where club_id = v_club and active and age_group = 'U17') = 1 then
  raise notice 'PASS 15: exactly one U17 exists -- adding a successor team did not create a duplicate identity';
else
  raise notice 'FAIL 15: % U17 teams exist', (select count(*) from public.teams where club_id=v_club and active and age_group='U17');
end if;

if exists (select 1 from public.audit_log where record_id = v_new and after->>'event' = 'SUCCESSOR_TEAM_CREATED_AT_HANDOVER') then
  raise notice 'PASS 16: creating the team is audited against the handover that caused it';
else
  raise notice 'FAIL 16: the team creation was not audited';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
