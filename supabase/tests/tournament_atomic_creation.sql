-- A tournament is created once, or not at all.
--
-- THE RULE
--
-- Creating a tournament means writing the tournament, the competitions it runs, the host's own sides
-- and every other club's sides. Before `create_tournament_with_teams` that was four or more separate
-- RPCs, and every one of them is its own transaction -- so a failure at the third left a REAL
-- tournament in the database carrying some of its teams, with nothing to tell the organiser which
-- ones were missing. A half-created tournament is worse than no tournament.
--
-- WHAT IS ASSERTED
--
--   A. a payload that fails part-way leaves nothing behind at all;
--   B. a valid payload writes every part, once;
--   C. an organiser-added club is `added` and an off-platform one `external_recorded` -- never pending,
--      accepted or declined, because nobody was asked anything;
--   D. an external side carries its GRADE and no canonical type, so no pathway is invented for a club
--      that never stated one;
--   E. a club may bring more than one side to one competition, and the same side only once;
--   F. nothing is scheduled: no games, no pitch reservations. Planning is a separate decision.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_hdir uuid; v_hclub uuid; v_venue uuid;
  v_gdir uuid; v_gclub uuid;
  v_ctt uuid; v_ctt12 uuid;
  v_our_a uuid; v_our_b uuid; v_g1 uuid; v_g2 uuid;
  v_t uuid; v_n int; v_before int; v_ok boolean;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'atomic@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Atomic','Test','atomic@ovalball-test.invalid');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

select id into v_ctt from public.canonical_team_types where category='youth' and age_group='U9' and gender='mixed' limit 1;
select id into v_ctt12 from public.canonical_team_types where category='youth' and age_group='U12' and gender='boys' limit 1;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Atomic Host RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','ahost-'||substr(gen_random_uuid()::text,1,8))
returning id into v_hdir;
insert into public.clubs (directory_id, slug, status) values (v_hdir,'ahost-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_hclub;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Atomic Guest RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','aguest-'||substr(gen_random_uuid()::text,1,8))
returning id into v_gdir;
insert into public.clubs (directory_id, slug, status) values (v_gdir,'aguest-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_gclub;

insert into public.club_memberships (user_id, club_id, role, status) values (v_admin, v_hclub, 'CLUB_ADMIN', 'active');

insert into public.venues (club_id, name, slug, active) values (v_hclub, 'Atomic Ground', 'aground-'||substr(gen_random_uuid()::text,1,8), true) returning id into v_venue;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, canonical_team_type_id, active)
values (v_hclub,'union','youth','U9','mixed','Under 9 Mixed','ah9a-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_our_a;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, canonical_team_type_id, active)
values (v_hclub,'union','youth','U9','mixed','B','Under 9 Mixed B','ah9b-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_our_b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, canonical_team_type_id, active)
values (v_gclub,'union','youth','U9','mixed','Under 9 Mixed','ag9a-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_g1;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, canonical_team_type_id, active)
values (v_gclub,'union','youth','U9','mixed','B','Under 9 Mixed B','ag9b-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_g2;

select count(*) into v_before from public.tournaments;

-- ============ A. A failure part-way leaves NOTHING ============
v_ok := false;
begin
  perform public.create_tournament_with_teams(
    v_hclub,'Atomic Festival',current_date,null,'09:00','round_robin','private',v_venue,null,
    array['U9'], array[v_our_a,v_our_b],
    jsonb_build_array(jsonb_build_object('directory_id',v_gdir,'team_id',v_g1,'age_group','U14')));
exception when others then
  v_ok := true;
end;
select count(*) into v_n from public.tournaments;
if v_ok and v_n = v_before then
  raise notice 'PASS 1 (A): a payload that failed part-way left ZERO tournaments behind';
else
  raise notice 'FAIL 1 (A): expected % tournaments, found % (raised=%)', v_before, v_n, v_ok;
end if;

-- An empty competition is refused before anything is written.
v_ok := false;
begin
  perform public.create_tournament_with_teams(
    v_hclub,'Atomic Festival',current_date,null,'09:00','round_robin','private',v_venue,null,
    array['U9','U12'], array[v_our_a], '[]'::jsonb);
exception when others then v_ok := true;
end;
select count(*) into v_n from public.tournaments;
if v_ok and v_n = v_before then
  raise notice 'PASS 2 (A): an age group with no teams is refused, and nothing is written';
else
  raise notice 'FAIL 2 (A): an empty competition was created';
end if;

-- ============ B. A valid payload writes every part ============
v_t := public.create_tournament_with_teams(
  v_hclub,'Atomic Festival',current_date,current_date + 2,'09:30','hybrid','public',v_venue,'Food onsite',
  array['U9'], array[v_our_a,v_our_b],
  jsonb_build_array(
    jsonb_build_object('directory_id',v_gdir,'team_id',v_g1,'age_group','U9'),
    jsonb_build_object('directory_id',v_gdir,'team_id',v_g2,'age_group','U9'),
    jsonb_build_object('directory_id',null,'club_name','Atomic External RUFC','age_group','U9','squad_label','A')));

select count(*) into v_n from public.tournaments where id = v_t;
if v_n = 1 then raise notice 'PASS 3 (B): exactly one tournament exists';
else raise notice 'FAIL 3 (B): % tournaments', v_n; end if;

select count(*) into v_n from public.tournament_age_groups where tournament_id = v_t;
if v_n = 1 then raise notice 'PASS 4 (B): its competitions were written';
else raise notice 'FAIL 4 (B): % age group rows', v_n; end if;

select count(*) into v_n from public.tournament_team_entries where tournament_id = v_t;
if v_n = 2 then raise notice 'PASS 5 (B): both of the host''s own sides were entered';
else raise notice 'FAIL 5 (B): % entries', v_n; end if;

-- OTHER CLUBS' sides specifically. Since 20270605000000 the host's own sides live in this table too,
-- so the host is excluded here to keep testing the thing this assertion is about.
select count(*) into v_n from public.tournament_participants p
join public.tournaments t on t.id = p.tournament_id
where p.tournament_id = v_t and p.club_id is distinct from t.host_club_id;
if v_n = 3 then raise notice 'PASS 6 (B): every other side was recorded';
else raise notice 'FAIL 6 (B): % participants', v_n; end if;

select count(*) into v_n from public.tournaments
where id = v_t and visibility='public' and format='hybrid' and ends_on = current_date + 2 and kickoff_time = '09:30';
if v_n = 1 then raise notice 'PASS 7 (B): visibility, format, end date and kick-off all persisted';
else raise notice 'FAIL 7 (B): the tournament''s own details did not persist'; end if;

-- A one-day tournament: ends_on is NOT NULL, and null from the client means "one day".
declare v_one uuid;
begin
  v_one := public.create_tournament_with_teams(
    v_hclub,'Atomic One Day',current_date,null,'09:00','round_robin','private',v_venue,null,
    array['U9'], array[v_our_a], '[]'::jsonb);
  select count(*) into v_n from public.tournaments where id = v_one and ends_on = current_date;
  if v_n = 1 then raise notice 'PASS 8 (B): a one-day tournament ends the day it starts';
  else raise notice 'FAIL 8 (B): a one-day tournament did not get an end date'; end if;
end;

-- ============ C. Added is not invited ============
select count(*) into v_n from public.tournament_participants
where tournament_id = v_t and status in ('pending','accepted','declined');
if v_n = 0 then raise notice 'PASS 9 (C): nothing created is waiting for another club to answer';
else raise notice 'FAIL 9 (C): % participant(s) carry an invitation status', v_n; end if;

select count(*) into v_n from public.tournament_participants p
join public.tournaments t on t.id = p.tournament_id
where p.tournament_id = v_t and p.status = 'added' and p.club_id is distinct from t.host_club_id;
if v_n = 2 then raise notice 'PASS 10 (C): both Ovalball sides are simply added';
else raise notice 'FAIL 10 (C): % added', v_n; end if;

select count(*) into v_n from public.tournament_participants where tournament_id = v_t and status = 'external_recorded';
if v_n = 1 then raise notice 'PASS 11 (C): the off-platform side is recorded, not invited';
else raise notice 'FAIL 11 (C): % external', v_n; end if;

-- ============ D. An external side has a grade and no pathway ============
select count(*) into v_n from public.tournament_participants
where tournament_id = v_t and status='external_recorded' and age_group = 'U9' and canonical_team_type_id is null and squad_label = 'A';
if v_n = 1 then raise notice 'PASS 12 (D): the external side carries its grade and invents no pathway';
else raise notice 'FAIL 12 (D): the external side was not recorded by grade alone'; end if;

-- The club it belongs to got a directory row, and NOT an Ovalball account.
select count(*) into v_n from public.club_directory d
join public.tournament_participants p on p.club_directory_id = d.id
where p.tournament_id = v_t and p.status='external_recorded' and d.source = 'tournament_manual_entry'
  and not exists (select 1 from public.clubs c where c.directory_id = d.id);
if v_n = 1 then raise notice 'PASS 13 (D): an off-platform club gets a directory row, never a fabricated account';
else raise notice 'FAIL 13 (D): the external club was not recorded as manually entered'; end if;

-- ============ E. Two sides of one club, and no duplicates ============
select count(*) into v_n from public.tournament_participants where tournament_id = v_t and club_directory_id = v_gdir;
if v_n = 2 then raise notice 'PASS 14 (E): one club brought two sides to one competition';
else raise notice 'FAIL 14 (E): % sides from the guest club', v_n; end if;

v_ok := false;
begin
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status)
  values (v_t, v_gdir, v_gclub, v_g1, v_ctt, 'U9', 'added');
exception when unique_violation then v_ok := true;
end;
if v_ok then raise notice 'PASS 15 (E): the same side twice is still refused by the database';
else raise notice 'FAIL 15 (E): a duplicate side was accepted'; end if;

-- ============ F. Nothing is scheduled ============
-- A game belongs to its tournament directly now; it no longer hangs off a host entry.
select count(*) into v_n from public.tournament_games g where g.tournament_id = v_t;
if v_n = 0 then raise notice 'PASS 16 (F): creating a tournament schedules no games';
else raise notice 'FAIL 16 (F): % games were created', v_n; end if;

select count(*) into v_n from public.tournament_pitches where tournament_id = v_t;
if v_n = 0 then raise notice 'PASS 17 (F): and reserves no pitches -- planning is a later decision';
else raise notice 'FAIL 17 (F): % pitch reservations were created', v_n; end if;


-- -------------------------------------------------------------------------------------------------
-- G. A TOURNAMENT IS HOSTED BY A REAL CLUB AND SITS IN A REAL SEASON.
--
-- Both facts are RESOLVED, not demanded: `host_directory_id` is NOT NULL and almost always the
-- creating club's own identity, and the season is the canonical register's answer for the dates.
-- Both resolutions were lost in a rewrite -- the host one turned every `save_tournament` create into
-- a raw not-null constraint error, and the season one silently filed tournaments under no season,
-- which nothing surfaced because a null season looks exactly like a tournament that has not started.
--
-- So these assert the RESOLUTION, not just the column: a caller naming neither still gets both.
-- -------------------------------------------------------------------------------------------------

declare v_resolved uuid; v_dir uuid; v_season uuid; v_code text; v_atomic uuid;
begin
  select c.directory_id, d.rugby_code into v_dir, v_code
  from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_hclub;

  -- save_tournament, naming neither a host directory nor a season.
  v_resolved := public.save_tournament(
    v_hclub, 'Resolution Festival', current_date, null, v_code,
    null, null, null, v_venue, null, null, 'round_robin', '09:00', 'private'
  );

  select count(*) into v_n from public.tournaments where id = v_resolved and host_directory_id = v_dir;
  if v_n = 1 then raise notice 'PASS 18 (G): a tournament with no host named is hosted by the club that created it';
  else raise notice 'FAIL 18 (G): the host directory was not resolved from the club'; end if;

  select s.id into v_season from public.seasons s
  where s.rugby_code = v_code and current_date between s.starts_on and s.ends_on
  order by s.starts_on desc limit 1;

  if v_season is null then
    raise notice 'PASS 19 (G): no season covers today in the register, so none is invented (skipped)';
  else
    select count(*) into v_n from public.tournaments where id = v_resolved and season_id = v_season;
    if v_n = 1 then raise notice 'PASS 19 (G): the season is the canonical register''s answer, not a date boundary';
    else raise notice 'FAIL 19 (G): save_tournament filed the tournament under no season'; end if;
  end if;

  -- create_tournament_with_teams: the same two facts, through the one transactional call.
  begin
    v_atomic := public.create_tournament_with_teams(
      v_hclub, 'Resolution Atomic', current_date, null, '09:00', 'round_robin', 'private', v_venue, null,
      array['U9'], array[v_our_a], '[]'::jsonb
    );
    select count(*) into v_n from public.tournaments where id = v_atomic and host_directory_id = v_dir;
    if v_n = 1 then raise notice 'PASS 20 (G): the atomic creator resolves the host club''s own identity';
    else raise notice 'FAIL 20 (G): the atomic creator did not resolve the host directory'; end if;

    if v_season is null then
      raise notice 'PASS 21 (G): no season covers today in the register, so none is invented (skipped)';
    else
      select count(*) into v_n from public.tournaments where id = v_atomic and season_id = v_season;
      if v_n = 1 then raise notice 'PASS 21 (G): the atomic creator files the tournament in the register''s season';
      else raise notice 'FAIL 21 (G): the atomic creator filed the tournament under no season'; end if;
    end if;
  end;
end;

end $$;

rollback;
