-- The automatic season handover: running it twice, and what it exposes.
--
-- process_due_season_transitions is scheduled, so it runs repeatedly against
-- the same club. Every notification it sends is addressed to real people, and
-- a duplicate "Season handover complete" is not a cosmetic bug -- it is the
-- product telling a club something happened twice.
--
-- The privacy half checks the rule that the regulatory resolver may read a
-- player's date of birth server-side, but consumers receive the DECISION, not
-- the sensitive input.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_team uuid; v_manual uuid;
  v_player uuid;
  n1 int; n2 int; t1 int; t2 int; v_status text; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'auto@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'A','U','auto@ovalball-test.invalid');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Auto RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','auto-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'auto-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');

-- A season whose pre-season boundary has already passed, so the automatic
-- handover is due right now rather than merely upcoming.
-- Reuse the platform's next Union season when one exists, and force its
-- pre-season boundary into the past so the automatic handover is due now.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Auto 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true, current_date - 1) returning id into v_to;
else
  update public.seasons set pre_season_starts_on = current_date - 1 where id = v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','auto1') returning id into v_team;
-- A team with no automatic successor, so the run ends in needs_attention --
-- the branch that sends the second kind of notification.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U18','boys','x','auto2') returning id into v_manual;

insert into public.players (first_name, surname, date_of_birth, active)
values ('Auto','Player',(current_date - interval '15 years 3 months')::date,true) returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active');

-- ============ 1. First run ============

perform internal.process_due_season_transitions();

select count(*) into n1 from public.notifications where user_id = v_admin;
select status into v_status from public.season_transitions where club_id = v_club and to_season_id = v_to;
raise notice 'after run 1: % notification(s), transition status = %', n1, v_status;

if n1 > 0 then
  raise notice 'PASS 1: the automatic handover ran and notified the club';
else
  raise notice 'FAIL 1: the automatic handover sent nothing';
end if;

if (select age_group from public.teams where id = v_team) = 'U17' then
  raise notice 'PASS 2: the team with an automatic successor was progressed';
else
  raise notice 'FAIL 2: the automatic team was not progressed';
end if;

if (select age_group from public.teams where id = v_manual) = 'U18' then
  raise notice 'PASS 3: the team needing a decision was left untouched, as designed';
else
  raise notice 'FAIL 3: a team needing a manual decision was auto-progressed';
end if;

-- ============ 2. Run it again, and again ============

perform internal.process_due_season_transitions();
perform internal.process_due_season_transitions();

select count(*) into n2 from public.notifications where user_id = v_admin;

if n2 = n1 then
  raise notice 'PASS 4: two further scheduled runs sent NO additional notifications (% = %)', n1, n2;
else
  raise notice 'FAIL 4: notifications went from % to % on repeat runs', n1, n2;
end if;

if (select age_group from public.teams where id = v_team) = 'U17' then
  raise notice 'PASS 5: repeat runs did not progress the team a second time -- still U17, not U18';
else
  raise notice 'FAIL 5: a repeat run advanced the team again, to %', (select age_group from public.teams where id=v_team);
end if;

if (select count(*) from public.season_transitions where club_id = v_club and to_season_id = v_to) = 1 then
  raise notice 'PASS 6: repeat runs kept ONE transition record for this club and season';
else
  raise notice 'FAIL 6: % transition records exist', (select count(*) from public.season_transitions where club_id=v_club and to_season_id=v_to);
end if;

if (select count(*) from public.age_grade_rollovers where club_id = v_club and to_season_id = v_to) = 1 then
  raise notice 'PASS 7: repeat runs kept ONE handover -- the automatic path cannot open parallel rollovers either';
else
  raise notice 'FAIL 7: the automatic path opened % handovers', (select count(*) from public.age_grade_rollovers where club_id=v_club and to_season_id=v_to);
end if;

-- No two notifications of the same kind for the same transition.
select count(*) into t1 from (
  select type, (data->>'season_transition_id') tid, count(*) c
  from public.notifications where user_id = v_admin
  group by 1,2 having count(*) > 1
) d;
if t1 = 0 then
  raise notice 'PASS 8: no notification kind was sent twice for the same handover';
else
  raise notice 'FAIL 8: % notification kind(s) were duplicated', t1;
end if;

-- ============ 3. Privacy: the decision travels, the date of birth does not ==

if exists (select 1 from public.age_grade_rollover_player_proposals where regulatory_age_label is not null) then
  raise notice 'PASS 9: player proposals carry the resolved age GRADE, which is what a club needs to act';
else
  raise notice 'FAIL 9: player proposals carry no resolved age grade';
end if;

select string_agg(column_name, ', ') into v_txt
from information_schema.columns
where table_name = 'age_grade_rollover_player_proposals'
  and (column_name ~* 'date_of_birth|dob|birth');
if v_txt is null then
  raise notice 'PASS 10: no date of birth is copied onto the handover proposal -- consumers get the decision, not the input';
else
  raise notice 'FAIL 10: the proposal carries [%]', v_txt;
end if;

select string_agg(column_name, ', ') into v_txt
from information_schema.columns
where table_name = 'team_season_identity'
  and (column_name ~* 'date_of_birth|dob|birth');
if v_txt is null then
  raise notice 'PASS 11: the Handover Register records team identity only -- no player dates of birth land in it';
else
  raise notice 'FAIL 11: the register carries [%]', v_txt;
end if;

-- The notification bodies must not carry anything about an individual child.
if not exists (
  select 1 from public.notifications
  where user_id = v_admin and (body ~* '\d{4}-\d{2}-\d{2}' or body ilike '%date of birth%')
) then
  raise notice 'PASS 12: handover notifications name no dates of birth';
else
  raise notice 'FAIL 12: a handover notification contains a date of birth';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
