-- Season handover for B/C squads, club aliases, and identity collisions.
--
-- WHAT CHANGED, AND WHY THESE ASSERTIONS DID
--
-- These tests used to prove an ORDERING rule: confirming a B squad before its
-- primary was refused, because Confirm mutated the team immediately and the
-- primary really was still sitting in the destination. The refusal had to name
-- which team to confirm first, because the club could not proceed otherwise.
--
-- Under the staged commit model that constraint does not exist. Nothing has
-- moved when a decision is recorded, so there is nothing to be in the way. A
-- club may decide its squads in any order, and Apply works out the sequence.
--
-- Two rules survive, and are what this suite now proves:
--
--   * a B or C squad cannot sit at a level with no primary -- judged against
--     what the club has DECIDED, so a primary that is itself still at U16 but
--     heading for U17 counts, and a folded primary does not;
--   * two teams cannot be decided into one identity.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_roll uuid;
  v_a uuid; v_b uuid; v_c uuid;
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

select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Squads 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','U16','x1') returning id into v_a;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U16','boys','B','U16 B','x2') returning id into v_b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U16','boys','C','U16 C','x3') returning id into v_c;

-- A club-chosen alias sits OVER the canonical identity, in its own table.
insert into public.team_aliases (team_id, alias, set_by) values (v_b,'Wanderers',v_admin);

v_roll := public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_pa from public.age_grade_rollover_team_proposals where team_id=v_a;
select id into v_pb from public.age_grade_rollover_team_proposals where team_id=v_b;
select id into v_pc from public.age_grade_rollover_team_proposals where team_id=v_c;

-- ============ 1. Squads may be decided in any order ============

v_ok := true;
begin
  perform public.confirm_rollover_team_proposal(v_pb,'confirm',null,null,null,null);
exception when others then v_ok := false; v_err := sqlerrm;
end;

if v_ok then
  raise notice 'PASS 1: the B squad could be decided BEFORE its primary -- staged decisions have no ordering constraint';
else
  raise notice 'FAIL 1: deciding the B squad first was refused: %', v_err;
end if;

if (select age_group from public.teams where id=v_b) = 'U16' then
  raise notice 'PASS 2: recording that decision changed no live team -- the B squad is still U16';
else
  raise notice 'FAIL 2: deciding the B squad moved it to %', (select age_group from public.teams where id=v_b);
end if;

-- The rule that DOES survive: a squad letter needs a primary at that level.
declare v_lonely uuid; v_lp uuid; v_dir2 uuid; v_club2 uuid; v_prim uuid; v_pp uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Lonely RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','lonely-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'lonely-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U16','boys','U16','l1') returning id into v_prim;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values (v_club2,'union','youth','U16','boys','B','U16 B','l2') returning id into v_lonely;

  perform public.generate_rollover_proposal(v_club2,'union',v_to);
  select id into v_pp from public.age_grade_rollover_team_proposals where team_id=v_prim;
  select id into v_lp from public.age_grade_rollover_team_proposals where team_id=v_lonely;

  -- Fold the primary. Now nothing will be U17 for the B squad to sit under.
  perform public.confirm_rollover_team_proposal(v_pp,'fold',null,null,'Not enough players.',null);

  v_ok := false;
  begin
    perform public.confirm_rollover_team_proposal(v_lp,'confirm',null,null,null,null);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;

  if v_ok and v_err like '%no primary team heading for U17%' then
    raise notice 'PASS 3: a B squad with no primary at the destination is refused, and told exactly that';
  elsif v_ok then
    raise notice 'FAIL 3: refused, but with an unhelpful message: %', v_err;
  else
    raise notice 'FAIL 3: the B squad was allowed to sit at a level with no primary';
  end if;

  if v_err not like '%Mixed is only allowed%' then
    raise notice 'PASS 4: the squad-structure problem is NOT reported as a gender/age-band error';
  else
    raise notice 'FAIL 4: still blaming the gender combination for a squad-structure problem';
  end if;

  if (select decision from public.age_grade_rollover_team_proposals where id=v_lp) = 'pending' then
    raise notice 'PASS 5: the refused decision left nothing behind -- the proposal is still undecided';
  else
    raise notice 'FAIL 5: the refused decision was recorded anyway';
  end if;
end;

-- ============ 2. The whole squad set rolls forward, at Apply ============

perform public.confirm_rollover_team_proposal(v_pa,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_pc,'confirm',null,null,null,null);

select string_agg(display_name, ', ' order by coalesce(squad_designation,'')) into v_txt
from public.teams where club_id = v_club and active;
if v_txt = 'Under 16 Boys, Under 16 Boys B, Under 16 Boys C' then
  raise notice 'PASS 6: with every decision recorded, the club still runs exactly what it ran before -- %', v_txt;
else
  raise notice 'FAIL 6: deciding changed the live squad set to [%]', v_txt;
end if;

perform public.apply_season_handover(v_roll);

select string_agg(display_name, ', ' order by coalesce(squad_designation,'')) into v_txt
from public.teams where club_id = v_club and active;
if v_txt = 'Under 17 Boys, Under 17 Boys B, Under 17 Boys C' then
  raise notice 'PASS 7: applying the handover rolled the full squad set together -- %', v_txt;
else
  raise notice 'FAIL 7: squad set is now [%]', v_txt;
end if;

if (select count(*) from public.teams where club_id=v_club and squad_designation='B' and age_group='U17') = 1
   and (select count(*) from public.teams where club_id=v_club and squad_designation='C' and age_group='U17') = 1 then
  raise notice 'PASS 8: squad letters were preserved through the handover, not dropped or merged';
else
  raise notice 'FAIL 8: squad letters did not survive the handover';
end if;

if (select count(distinct canonical_team_type_id) from public.teams where club_id=v_club and active) = 1 then
  raise notice 'PASS 9: A, B and C share ONE canonical identity -- a squad letter is not a separate team type';
else
  raise notice 'FAIL 9: squads resolved to different canonical identities';
end if;

-- ============ 3. The alias follows the team, and stays an alias ============

select alias into v_txt from public.team_aliases where team_id = v_b;
if v_txt = 'Wanderers' then
  raise notice 'PASS 10: the club alias survived the handover unchanged, still attached to the same team';
else
  raise notice 'FAIL 10: alias is now [%]', v_txt;
end if;

if (select display_name from public.teams where id=v_b) = 'Under 17 Boys B' then
  raise notice 'PASS 11: the alias did NOT overwrite the canonical name -- the team is still U17 B';
else
  raise notice 'FAIL 11: canonical display name was replaced by the alias';
end if;

if not exists (select 1 from public.canonical_team_types where label = 'Wanderers' or key = 'wanderers') then
  raise notice 'PASS 12: a club alias never became a canonical team type';
else
  raise notice 'FAIL 12: a club alias leaked into the canonical directory';
end if;

if not exists (select 1 from public.team_season_identity where team_id=v_b and display_name = 'Wanderers') then
  raise notice 'PASS 13: the Handover Register recorded the canonical identity, not the club alias';
else
  raise notice 'FAIL 13: the register recorded the alias as the season identity';
end if;

-- ============ 4. Two teams cannot be decided into one identity ============
--
-- The occupant matters only once ITS OWN destination is settled. A team that
-- is still undecided is not in anybody's way -- it simply has to be decided
-- before the handover can run.

declare
  v_dirx uuid; v_clubx uuid; v_rollx uuid;
  v_u14 uuid; v_u15 uuid; v_p14 uuid; v_p15 uuid; v_blockers int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Clash RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','clash-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dirx;
  insert into public.clubs (directory_id, slug, status) values (v_dirx,'clash-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_clubx;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_clubx,'union','youth','U14','boys','U14','c1') returning id into v_u14;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_clubx,'union','youth','U15','boys','U15','c2') returning id into v_u15;

  v_rollx := public.generate_rollover_proposal(v_clubx,'union',v_to);
  select id into v_p14 from public.age_grade_rollover_team_proposals where team_id=v_u14;
  select id into v_p15 from public.age_grade_rollover_team_proposals where team_id=v_u15;

  -- The U15 is still undecided. It occupies U15 TODAY, but nothing says it
  -- will next season, so it is not a collision.
  v_ok := true;
  begin
    perform public.confirm_rollover_team_proposal(v_p14,'confirm',null,null,null,null);
  exception when others then v_ok := false; v_err := sqlerrm;
  end;

  if v_ok then
    raise notice 'PASS 14: an undecided occupant is not treated as a collision -- the U14 could be decided into U15';
  else
    raise notice 'FAIL 14: an undecided occupant blocked the decision: %', v_err;
  end if;

  -- But the handover cannot RUN while it is undecided.
  select count(*) into v_blockers from public.handover_apply_blockers(v_rollx);
  if v_blockers > 0 then
    raise notice 'PASS 15: the undecided team is reported as a blocker, so the handover cannot run half-decided';
  else
    raise notice 'FAIL 15: an undecided team did not block Apply';
  end if;

  -- Now settle the occupant so it STAYS at U15. That is a genuine clash.
  perform public.undo_rollover_team_decision(v_p14);
  perform public.confirm_rollover_team_proposal(v_p15,'adjust','U15',null,null,null);

  v_ok := false;
  begin
    perform public.confirm_rollover_team_proposal(v_p14,'confirm',null,null,null,null);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;

  if v_ok and v_err like '%already going to be Under 15 Boys next season%' then
    raise notice 'PASS 16: a settled occupant IS a collision, named concretely rather than as a gender error';
  elsif v_ok then
    raise notice 'FAIL 16: refused with unhelpful advice: %', v_err;
  else
    raise notice 'FAIL 16: two teams were allowed to be decided into one identity';
  end if;

  if (select decision from public.age_grade_rollover_team_proposals where id = v_p14) = 'pending' then
    raise notice 'PASS 17: the collision left nothing behind and the decision can still be retried';
  else
    raise notice 'FAIL 17: the collision left partial state';
  end if;

  -- The documented remedy works: a free squad slot at that level.
  perform public.confirm_rollover_team_proposal(v_p14,'adjust','U15','B',null,null);
  perform public.apply_season_handover(v_rollx);
  if (select display_name from public.teams where id=v_u14) = 'Under 15 Boys B' then
    raise notice 'PASS 18: the remedy that message suggests works -- the team rolled into the free B slot';
  else
    raise notice 'FAIL 18: the suggested remedy did not work, team is %', (select display_name from public.teams where id=v_u14);
  end if;
end;

-- ============ 5. Squads are decided independently ============
--
-- PRODUCT RULE: the club may progress the primary and FOLD the B squad, or
-- progress primary + B and fold C. Deciding the primary must therefore NOT
-- cascade a decision onto its squads.

declare
  v_dir3 uuid; v_club3 uuid; v_roll3 uuid; v_a3 uuid; v_bsq uuid; v_csq uuid;
  v_ap uuid; v_bp uuid; v_cp uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Fold RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fold-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir3;
  insert into public.clubs (directory_id, slug, status) values (v_dir3,'fold-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club3;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club3,'union','youth','U13','boys','U13','f1') returning id into v_a3;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values (v_club3,'union','youth','U13','boys','B','U13 B','f2') returning id into v_bsq;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values (v_club3,'union','youth','U13','boys','C','U13 C','f3') returning id into v_csq;

  v_roll3 := public.generate_rollover_proposal(v_club3,'union',v_to);
  select id into v_ap from public.age_grade_rollover_team_proposals where team_id = v_a3;
  select id into v_bp from public.age_grade_rollover_team_proposals where team_id = v_bsq;
  select id into v_cp from public.age_grade_rollover_team_proposals where team_id = v_csq;

  perform public.confirm_rollover_team_proposal(v_ap,'confirm',null,null,null,null);

  if (select decision from public.age_grade_rollover_team_proposals where id = v_bp) = 'pending'
     and (select decision from public.age_grade_rollover_team_proposals where id = v_cp) = 'pending' then
    raise notice 'PASS 19: deciding the primary did NOT cascade a decision onto its B and C squads';
  else
    raise notice 'FAIL 19: the squads were auto-decided by the primary';
  end if;

  perform public.confirm_rollover_team_proposal(v_bp,'confirm',null,null,null,null);
  perform public.confirm_rollover_team_proposal(v_cp,'fold',null,null,'Not enough players.',null);

  -- Still nothing has happened.
  if (select active from public.teams where id = v_csq)
     and (select display_name from public.teams where id = v_a3) = 'Under 13 Boys' then
    raise notice 'PASS 20: a recorded FOLD leaves the team live and untouched until the handover is applied';
  else
    raise notice 'FAIL 20: folding took effect before Apply';
  end if;

  perform public.apply_season_handover(v_roll3);

  if (select display_name from public.teams where id = v_a3) = 'Under 14 Boys'
     and (select display_name from public.teams where id = v_bsq) = 'Under 14 Boys B' then
    raise notice 'PASS 21: primary and B progressed together to U14 and U14 B';
  else
    raise notice 'FAIL 21: [%] / [%]',
      (select display_name from public.teams where id=v_a3), (select display_name from public.teams where id=v_bsq);
  end if;

  if not (select active from public.teams where id = v_csq)
     and (select age_group from public.teams where id = v_csq) = 'U13' then
    raise notice 'PASS 22: the C squad was folded -- inactive, and left at the age it actually was';
  else
    raise notice 'FAIL 22: the folded C squad was progressed or left active';
  end if;

  if exists (select 1 from public.teams where id = v_csq) then
    raise notice 'PASS 23: the folded squad keeps its stable team_id and history -- it is not deleted or merged';
  else
    raise notice 'FAIL 23: the folded squad was destroyed';
  end if;

  if (select decision from public.age_grade_rollover_team_proposals where id = v_cp) = 'folded'
     and (select decision from public.age_grade_rollover_team_proposals where id = v_bp) = 'confirmed' then
    raise notice 'PASS 24: the board records different decisions for squads at the same level';
  else
    raise notice 'FAIL 24: squad decisions were not recorded independently';
  end if;
end;

-- ============ 6. A real check violation still names the real field ============

v_ok := false;
begin
  -- Union girls have no U15 band, so this trips teams_gender_category_check.
  update public.teams set age_group='U15', gender='girls' where id=v_c;
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 25: an actual gender/age-band violation is still caught';
else
  raise notice 'FAIL 25: union girls U15 was accepted';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
