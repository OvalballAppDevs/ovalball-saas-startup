-- Season handover for B/C squads, club aliases, and identity collisions.
--
-- The ordering assertions here exist because confirming a B squad before its
-- primary team used to fail with "That destination age group/gender
-- combination is not valid (Mixed is only allowed U6-U11...)" -- a message
-- about a field that was not the problem, produced because the apply path
-- mapped every check violation to the gender case.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid;
  v_a uuid; v_b uuid; v_c uuid; v_clash uuid;
  v_pa uuid; v_pb uuid; v_pc uuid;
  v_err text; v_ok boolean; v_n int; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'squads@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Sq','Ad','squads@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Squads RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','squads-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'squads-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('Squads 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','x1') returning id into v_a;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U16','boys','B','x','x2') returning id into v_b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U16','boys','C','x','x3') returning id into v_c;

-- A club-chosen alias sits OVER the canonical identity, in its own table.
insert into public.team_aliases (team_id, alias, set_by) values (v_b,'Wanderers',v_admin);

perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_pa from public.age_grade_rollover_team_proposals where team_id=v_a;
select id into v_pb from public.age_grade_rollover_team_proposals where team_id=v_b;
select id into v_pc from public.age_grade_rollover_team_proposals where team_id=v_c;

-- ============ 1. Ordering is stated, not discovered ============

v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_pb,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;

if v_ok and v_err like '%moves up with its primary team%' then
  raise notice 'PASS 1: confirming the B squad first is refused with an instruction that names the team to confirm first';
elsif v_ok then
  raise notice 'FAIL 1: refused, but with an unhelpful message: %', v_err;
else
  raise notice 'FAIL 1: the B squad moved up with no primary team at that level';
end if;

if v_err not like '%Mixed is only allowed%' then
  raise notice 'PASS 2: the squad-ordering problem is NO LONGER reported as a gender/age-band error';
else
  raise notice 'FAIL 2: still blaming the gender combination for a squad-structure problem';
end if;

if (select age_group from public.teams where id=v_b) = 'U16'
   and (select decision from public.age_grade_rollover_team_proposals where id=v_pb) = 'pending' then
  raise notice 'PASS 3: the refused confirm left nothing behind -- squad still U16, proposal still pending';
else
  raise notice 'FAIL 3: the refused confirm left partial state';
end if;

-- ============ 2. The whole squad set rolls forward ============

perform public.confirm_rollover_team_proposal(v_pa,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_pb,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_pc,'confirm',null,null,null,null);

select string_agg(display_name, ', ' order by coalesce(squad_designation,'')) into v_txt
from public.teams where club_id = v_club and active;
if v_txt = 'U17, U17 B, U17 C' then
  raise notice 'PASS 4: the full squad set rolled together -- %', v_txt;
else
  raise notice 'FAIL 4: squad set is now [%]', v_txt;
end if;

if (select count(*) from public.teams where club_id=v_club and squad_designation='B' and age_group='U17') = 1
   and (select count(*) from public.teams where club_id=v_club and squad_designation='C' and age_group='U17') = 1 then
  raise notice 'PASS 5: squad letters were preserved through the handover, not dropped or merged';
else
  raise notice 'FAIL 5: squad letters did not survive the handover';
end if;

-- Squads share the canonical identity; the letter is a slot within it.
if (select count(distinct canonical_team_type_id) from public.teams where club_id=v_club and active) = 1 then
  raise notice 'PASS 6: A, B and C share ONE canonical identity -- a squad letter is not a separate team type';
else
  raise notice 'FAIL 6: squads resolved to different canonical identities';
end if;

-- ============ 3. The alias follows the team, and stays an alias ============

select alias into v_txt from public.team_aliases where team_id = v_b;
if v_txt = 'Wanderers' then
  raise notice 'PASS 7: the club alias survived the handover unchanged, still attached to the same team';
else
  raise notice 'FAIL 7: alias is now [%]', v_txt;
end if;

if (select display_name from public.teams where id=v_b) = 'U17 B' then
  raise notice 'PASS 8: the alias did NOT overwrite the canonical name -- the team is still U17 B';
else
  raise notice 'FAIL 8: canonical display name was replaced by the alias';
end if;

if not exists (select 1 from public.canonical_team_types where label = 'Wanderers' or key = 'wanderers') then
  raise notice 'PASS 9: a club alias never became a canonical team type';
else
  raise notice 'FAIL 9: a club alias leaked into the canonical directory';
end if;

if not exists (select 1 from public.team_season_identity where team_id=v_b and display_name = 'Wanderers') then
  raise notice 'PASS 10: the Handover Register recorded the canonical identity, not the club alias';
else
  raise notice 'FAIL 10: the register recorded the alias as the season identity';
end if;

-- ============ 4. Collision with an identity the club already holds ============

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U14','boys','x','x4') returning id into v_clash;
-- Give the club a U15 already, so U14 -> U15 collides.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U15','boys','x','x5');

perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_pa from public.age_grade_rollover_team_proposals where team_id=v_clash;

v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_pa,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;

-- The occupant is itself waiting its turn in this handover, so the useful
-- advice is to confirm it first -- not to invent a B squad for a place that
-- is about to be vacated.
if v_ok and v_err like '%Confirm U15 first%' then
  raise notice 'PASS 11: a collision with a team still waiting its turn names that team, rather than advising a squad letter';
elsif v_ok then
  raise notice 'FAIL 11: refused with unhelpful advice: %', v_err;
else
  raise notice 'FAIL 11: two teams were allowed to occupy one identity';
end if;

if (select age_group from public.teams where id=v_clash) = 'U14'
   and (select decision from public.age_grade_rollover_team_proposals where id=v_pa) = 'pending' then
  raise notice 'PASS 12: the collision left nothing behind and the proposal can still be retried';
else
  raise notice 'FAIL 12: the collision left partial state';
end if;

-- The documented escape hatch actually works: move it into a free squad slot.
-- Now settle the occupant so it is no longer pending. It is staying at U15,
-- so the other branch applies: the place is genuinely taken and a different
-- squad letter IS the right advice.
declare v_sitter uuid;
begin
  select p.id into v_sitter
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where t.club_id = v_club and t.age_group = 'U15' and t.squad_designation is null and p.decision = 'pending';
  perform public.confirm_rollover_team_proposal(v_sitter,'defer',null,null,null,null);
end;

v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_pa,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%already has a team at U15%' then
  raise notice 'PASS 12b: when the occupant is staying put, the message says the place is taken and suggests a squad letter';
else
  raise notice 'FAIL 12b: wrong branch for a settled occupant: %', coalesce(v_err,'accepted');
end if;

perform public.confirm_rollover_team_proposal(v_pa,'adjust','U15','B',null,null);
if (select display_name from public.teams where id=v_clash) = 'U15 B' then
  raise notice 'PASS 13: the remedy that message suggests works -- the team rolled into the free B slot';
else
  raise notice 'FAIL 13: the suggested remedy did not work, team is %', (select display_name from public.teams where id=v_clash);
end if;

-- ============ 5. Check violations name the real field ============

select count(*) into v_n from public.teams where club_id = v_club and active;
v_ok := false;
begin
  -- Union girls have no U15 band, so this trips teams_gender_category_check.
  update public.teams set age_group='U15', gender='girls' where id=v_clash;
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 14: an actual gender/age-band violation is still caught';
else
  raise notice 'FAIL 14: union girls U15 was accepted';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
