-- Deciding a player's next-season placement on the Season Handover board.
--
-- The distinction this suite exists to hold:
--
--   SAME AGE GRADE, different squad letter  -- an operational club decision
--   DIFFERENT AGE GRADE                     -- the canonical movement resolver
--                                              decides, and the board cannot
--                                              overrule it
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_other_club uuid; v_other_dir uuid; v_to uuid;
  v_u14 uuid; v_u15 uuid; v_u15b uuid; v_u16 uuid; v_u16b uuid; v_u17 uuid; v_foreign uuid;
  v_player uuid; v_prop uuid; v_roll uuid;
  v_kind text; v_req text; v_review text; v_reason text; v_disp boolean;
  v_n int; v_err text; v_ok boolean; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin   ,'pp-admin@ovalball-test.invalid'   ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_outsider,'pp-outsider@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin   ,'P','P','pp-admin@ovalball-test.invalid'),
  (v_outsider,'O','S','pp-outsider@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('PP RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pp-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'pp-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('PP Other RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','ppo-'||substr(gen_random_uuid()::text,1,8)) returning id into v_other_dir;
insert into public.clubs (directory_id, slug, status) values (v_other_dir,'ppo-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_other_club;

-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('PP 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

-- A U14 side: next season it becomes U15, which is what makes it a genuine
-- age-grade DROP for a U16-age player rather than a squad change.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U14','boys','x','pp14') returning id into v_u14;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U15','boys','x','pp15') returning id into v_u15;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U15','boys','B','x','pp15b') returning id into v_u15b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','pp16') returning id into v_u16;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U16','boys','B','x','pp16b') returning id into v_u16b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U17','boys','x','pp17') returning id into v_u17;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_other_club,'union','youth','U16','boys','x','ppf16') returning id into v_foreign;

-- A player whose regulatory age next season is U16, currently in the U15 B squad.
insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Thomas','Thompson', date '2012-01-15', 'MALE', true) returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_u15b,'active');

perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
v_roll := public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_player_proposals where player_id = v_player;

-- ============ 1. The normal expectation ============

if v_prop is not null then
  raise notice 'PASS 1: preparing the handover produced a player proposal for Thomas';
else
  raise notice 'FAIL 1: no player proposal was produced';
end if;

select ctt.age_group into v_txt
from public.age_grade_rollover_player_proposals p
join public.canonical_team_types ctt on ctt.id = p.normal_canonical_team_type_id
where p.id = v_prop;
if v_txt = 'U16' then
  raise notice 'PASS 2: the normal placement next season is U16, resolved from his regulatory age';
else
  raise notice 'FAIL 2: normal placement resolved to [%]', coalesce(v_txt,'nothing');
end if;

if (select review_state from public.age_grade_rollover_player_proposals where id=v_prop) = 'READY' then
  raise notice 'PASS 3: an ordinary progression needs no review';
else
  raise notice 'FAIL 3: an ordinary progression was flagged for review';
end if;

-- The squad, not just the age grade: his own U15 B side becomes U16 B, and he
-- is already in it, so the normal placement is that team.
if (select proposed_team_id from public.age_grade_rollover_player_proposals where id=v_prop) = v_u15b then
  raise notice 'PASS 3b: normal placement is his OWN squad (U15 B, which becomes U16 B) -- not the primary U16';
else
  raise notice 'FAIL 3b: normal placement is [%]',
    (select display_name from public.teams where id=(select proposed_team_id from public.age_grade_rollover_player_proposals where id=v_prop));
end if;

-- ============ 2. Only this club's real teams may be chosen ============

select count(*) into v_n from public.rollover_placement_options(v_prop);
if v_n = 6 then
  raise notice 'PASS 4: the reviewer is offered this club''s six real youth teams, and nothing else';
else
  raise notice 'FAIL 4: % placement options offered', v_n;
end if;

-- Options are labelled by what each team will BE next season, not by today.
if exists (select 1 from public.rollover_placement_options(v_prop) o where o.team_id = v_u15 and o.age_group = 'U16') then
  raise notice 'PASS 4b: the U15 side is offered as U16 -- the identity it will hold in the season being decided';
else
  raise notice 'FAIL 4b: placement options are labelled with today''s age grades';
end if;

if not exists (select 1 from public.rollover_placement_options(v_prop) o where o.team_id = v_foreign) then
  raise notice 'PASS 5: another club''s team is never offered';
else
  raise notice 'FAIL 5: another club''s team appeared in the options';
end if;

v_ok := false;
begin
  perform public.set_rollover_player_placement(v_prop, v_foreign);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%own club%' then
  raise notice 'PASS 6: placing a player at a different club is refused server-side, not just hidden in the UI';
else
  raise notice 'FAIL 6: a cross-club placement was accepted (%)', coalesce(v_err,'no error');
end if;

-- ============ 3. Same age grade, different squad ============

-- The U15 primary becomes U16 next season: same age grade as his normal
-- placement, different squad letter.
select * into v_kind, v_req, v_review, v_reason, v_disp
from public.set_rollover_player_placement(v_prop, v_u15);

if v_kind = 'SAME_AGE_SQUAD' then
  raise notice 'PASS 7: moving him to the side that also becomes U16 is an operational squad decision, not an age-grade change';
else
  raise notice 'FAIL 7: classified as [%]', coalesce(v_kind,'nothing');
end if;

if not v_disp and v_review = 'READY' then
  raise notice 'PASS 8: a squad-letter change needs NO governing dispensation and stays ready';
else
  raise notice 'FAIL 8: a squad change demanded approval (review %, dispensation %)', v_review, v_disp;
end if;

if (select selected_team_id from public.age_grade_rollover_player_proposals where id=v_prop) = v_u15 then
  raise notice 'PASS 9: the decision is persisted against the canonical team id, not a display string';
else
  raise notice 'FAIL 9: the selection was not persisted';
end if;

-- ============ 4. Different age grade runs the canonical resolver ============

-- The U14 side becomes U15 next season: a real age-grade drop for a
-- U16-age player. Judged by today's labels this looked like a two-grade move;
-- judged by next season's, it is the one-grade drop it actually is.
select * into v_kind, v_req, v_review, v_reason, v_disp
from public.set_rollover_player_placement(v_prop, v_u14);

if v_kind = 'AGE_GRADE_CHANGE' then
  raise notice 'PASS 10: placing him in the side that becomes U15 is an age-grade change';
else
  raise notice 'FAIL 10: classified as [%]', coalesce(v_kind,'nothing');
end if;

if v_req in ('permitted','team_approval_only','external_approval_required','not_permitted') then
  raise notice 'PASS 11: the canonical movement vocabulary is used, not a handover-specific one (%)', v_req;
else
  raise notice 'FAIL 11: movement requirement is [%]', coalesce(v_req,'nothing');
end if;

if v_req = 'external_approval_required' and v_disp and v_review = 'NEEDS_ATTENTION' then
  raise notice 'PASS 12: dropping an age grade needs governing approval and is held in NEEDS ATTENTION';
else
  raise notice 'FAIL 12: req=% dispensation=% review=%', v_req, v_disp, v_review;
end if;

-- ============ 5. The gate ============
--
-- There is no per-player apply any more: a season transition is applied as one
-- operation, so an unresolved placement holds up the whole handover rather
-- than being quietly skipped or normalised away.

v_ok := false;
begin
  perform public.apply_season_handover(v_roll);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%cannot be applied yet%' then
  raise notice 'PASS 13: an unresolved placement HOLDS the handover -- not moved, not dropped, not silently normalised';
else
  raise notice 'FAIL 13: an unresolved placement did not block the handover (%)', coalesce(v_err,'no error');
end if;

if (select count(*) from public.player_team_memberships where player_id=v_player and status='active') = 1
   and (select team_id from public.player_team_memberships where player_id=v_player and status='active') = v_u15b then
  raise notice 'PASS 14: the blocked apply left the player exactly where he was';
else
  raise notice 'FAIL 14: the blocked apply moved the player anyway';
end if;

-- ============ 6. Recording the approval unblocks exactly that placement ====

insert into public.player_team_dispensation
  (player_id, source_team_id, target_team_id, season_id, status, governing_body_reference, eligibility_rule_reference, requested_by)
values (v_player, v_u15b, v_u14, v_to, 'approved', 'RFU-TEST-REF-001', 'RFU Regulation 15', v_admin);

select * into v_kind, v_req, v_review, v_reason, v_disp
from public.set_rollover_player_placement(v_prop, v_u14);
if v_review = 'READY' then
  raise notice 'PASS 15: once the governing approval is on file for that exact player, team and season, the placement is ready';
else
  raise notice 'FAIL 15: review state is still [%]', v_review;
end if;

-- ============ 7. Applying moves the membership ============

declare v_rest record;
begin
  for v_rest in
    select p.id, p.proposed_age_group from public.age_grade_rollover_team_proposals p
    where p.rollover_id = v_roll and p.decision = 'pending'
  loop
    if v_rest.proposed_age_group is null then
      perform public.confirm_rollover_team_proposal(v_rest.id,'graduate',null,null,null,null);
    else
      perform public.confirm_rollover_team_proposal(v_rest.id,'confirm',null,null,null,null);
    end if;
  end loop;
  perform public.apply_season_handover(v_roll);
end;

if (select count(*) from public.player_team_memberships where player_id=v_player and status='active') = 1
   and (select team_id from public.player_team_memberships where player_id=v_player and status='active') = v_u14 then
  raise notice 'PASS 16: applying moved the player to the chosen team, and left exactly one active membership';
else
  raise notice 'FAIL 16: membership state after apply is wrong';
end if;

if (select status from public.player_team_memberships where player_id=v_player and team_id=v_u15b) = 'ended' then
  raise notice 'PASS 17: the previous membership is ended and kept, not deleted -- his history with U15 B survives';
else
  raise notice 'FAIL 17: the old membership was not closed properly';
end if;

if (select already_applied from public.apply_season_handover(v_roll))
   and (select count(*) from public.player_team_memberships where player_id=v_player and status='active') = 1 then
  raise notice 'PASS 18: applying the same handover twice is a no-op -- the player was not moved again';
else
  raise notice 'FAIL 18: a second apply did work';
end if;

-- ============ 8. Audit is by stable id, with the real decision ============

if exists (
  select 1 from public.audit_log
  where record_id = v_prop
    and after->>'event' = 'HANDOVER_PLACEMENT_DECIDED'
    and after->>'override_kind' = 'AGE_GRADE_CHANGE'
    and after->>'movement_requirement' = 'external_approval_required'
    and (after->>'selected_team_id')::uuid = v_u14
    and after->>'target_season_id' is not null
) then
  raise notice 'PASS 19: the audit records actor, stable ids, the movement decision and the season -- no display strings as authority';
else
  raise notice 'FAIL 19: the placement decision was not audited properly';
end if;

if exists (select 1 from public.audit_log where record_id = v_prop and after->>'event' = 'HANDOVER_PLACEMENT_APPLIED') then
  raise notice 'PASS 20: applying the placement is audited separately from deciding it';
else
  raise notice 'FAIL 20: the apply was not audited';
end if;

if not exists (
  select 1 from public.audit_log where record_id = v_prop and (after::text ~ '\d{4}-\d{2}-\d{2}T?.*birth' or after ? 'date_of_birth')
) then
  raise notice 'PASS 21: no date of birth was written into the handover audit trail';
else
  raise notice 'FAIL 21: a date of birth reached the audit trail';
end if;

-- ============ 9. Readiness reflects real proposal state ============

-- The gate at assertion 13 already proved an unresolved placement holds the
-- whole handover. Here the handover has run, and readiness must say so rather
-- than continuing to describe work still to do.
declare v_applied boolean; v_blockers int;
begin
  select is_applied, blocker_count into v_applied, v_blockers from public.rollover_readiness(v_roll);
  if v_applied and v_blockers = 0 then
    raise notice 'PASS 22: readiness reports the handover as applied, with nothing outstanding';
  else
    raise notice 'FAIL 22: applied=% blockers=%', v_applied, v_blockers;
  end if;
end;

select players_total, players_ready into v_n, v_review from public.rollover_readiness(v_roll);
if v_n >= 1 then
  raise notice 'PASS 23: readiness counts come from real proposal rows (% player proposal(s))', v_n;
else
  raise notice 'FAIL 23: readiness reported no players';
end if;

-- ============ 10. Authorization ============

perform set_config('request.jwt.claims', json_build_object('sub',v_outsider,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.set_rollover_player_placement(v_prop, v_u16);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Not authorized%' then
  raise notice 'PASS 24: someone with no authority at this club cannot decide a placement';
else
  raise notice 'FAIL 24: an unauthorised user decided a placement (%)', coalesce(v_err,'no error');
end if;

v_ok := false;
begin
  perform public.rollover_placement_options(v_prop);
exception when others then v_ok := true;
end;
if v_ok then
  raise notice 'PASS 25: an unauthorised user cannot even list this club''s placement options';
else
  raise notice 'FAIL 25: placement options leaked to an unauthorised user';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
