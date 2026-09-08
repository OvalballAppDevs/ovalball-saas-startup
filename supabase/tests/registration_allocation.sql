-- Registration reads the canonical allocation, and only that.
--
-- Every assertion here goes through public.preview_player_allocation or
-- public.player_team_allocation -- the two reads the registration screens
-- consume. If a second age resolver, girls-banding table or code mapping ever
-- appears in a React component, these tests keep passing while the product
-- starts lying; what they pin is that the answer the SCREEN gets is the answer
-- the canonical chain gives.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_udir uuid; v_uclub uuid;
  v_ldir uuid; v_lclub uuid;
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_parent_m uuid;
  v_season_u uuid; v_season_l uuid;
  v_u12b uuid; v_u12g uuid; v_u10 uuid;
  v_player uuid; v_ptm uuid;
  r record; v_n int; v_ok boolean;
  v_dob_u12 date; v_dob_u13 date; v_dob_mini date;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_parent,'reg-parent@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger,'reg-stranger@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_parent,'Rita','Registrar','reg-parent@ovalball-test.invalid'),
  (v_stranger,'Sam','Stranger','reg-stranger@ovalball-test.invalid');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Registration Union RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','reg-u-'||substr(gen_random_uuid()::text,1,8))
returning id into v_udir;
insert into public.clubs (directory_id, slug, status) values (v_udir,'reg-u-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_uclub;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Registration League ARLFC','T','T','league','United Kingdom','England',true,'unverified','site_admin_manual','reg-l-'||substr(gen_random_uuid()::text,1,8))
returning id into v_ldir;
insert into public.clubs (directory_id, slug, status) values (v_ldir,'reg-l-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_lclub;

-- The parent's relationship with the union club: an active club membership is
-- one of the three routes add_child_for_guardian accepts.
insert into public.club_memberships (user_id, club_id, role, status)
values (v_parent, v_uclub, 'BASIC_USER', 'active') returning id into v_parent_m;

-- Teams this club actually runs: U12 boys and U12 girls, but no U10.
insert into public.teams (club_id, rugby_code, category, age_group, gender)
values (v_uclub,'union','youth','U12','boys') returning id into v_u12b;
insert into public.teams (club_id, rugby_code, category, age_group, gender)
values (v_uclub,'union','youth','U12','girls') returning id into v_u12g;

-- DOBs are derived from the CANONICAL season, never from a hardcoded year, so
-- this suite does not rot when the register moves on.
select id into v_season_u from public.seasons
where rugby_code='union' and not is_regression_fixture and starts_on <= current_date and ends_on >= current_date limit 1;
if v_season_u is null then
  raise notice 'SKIP: no current canonical Union season is configured.';
  return;
end if;

-- An U12 player is one whose regulatory age resolves to U12. Rather than
-- assume the arithmetic, ask the canonical resolver for a date that lands
-- there -- which is the same discipline the product itself follows.
select dob into v_dob_u12 from (
  select (current_date - (n || ' years')::interval)::date as dob
  from generate_series(5, 19) n
) d where (select ra.regulatory_age_label from public.resolve_player_regulatory_age('union', v_season_u, d.dob) ra) = 'U12' limit 1;
select dob into v_dob_u13 from (
  select (current_date - (n || ' years')::interval)::date as dob
  from generate_series(5, 19) n
) d where (select ra.regulatory_age_label from public.resolve_player_regulatory_age('union', v_season_u, d.dob) ra) = 'U13' limit 1;
select dob into v_dob_mini from (
  select (current_date - (n || ' years')::interval)::date as dob
  from generate_series(5, 19) n
) d where (select ra.regulatory_age_label from public.resolve_player_regulatory_age('union', v_season_u, d.dob) ra) = 'U10' limit 1;

perform set_config('request.jwt.claims', json_build_object('sub', v_parent,'role','authenticated')::text, true);

-- =========================================================================
-- A. UNION BOYS AND GIRLS ARE DIFFERENT TEAMS
-- =========================================================================

if v_dob_u12 is not null then
  select * into r from public.preview_player_allocation(v_uclub, v_dob_u12, 'MALE');
  if r.display_label = 'Under 12 Boys' and r.allocation_status = 'NORMAL_PLACEMENT' then
    raise notice 'PASS 1 (A): a Union U12 boy is allocated Under 12 Boys';
  else raise notice 'FAIL 1 (A): got % / %', r.display_label, r.allocation_status; end if;

  if r.club_runs_team then
    raise notice 'PASS 2 (A): the club running that team is reported as a separate fact';
  else raise notice 'FAIL 2 (A): club_runs_team was false for a team the club runs'; end if;

  select * into r from public.preview_player_allocation(v_uclub, v_dob_u12, 'FEMALE');
  if r.display_label = 'Under 12 Girls' then
    raise notice 'PASS 3 (A): a Union U12 girl is allocated Under 12 Girls, never the boys team';
  else raise notice 'FAIL 3 (A): got %', r.display_label; end if;
end if;

-- =========================================================================
-- B. UNION GIRLS DUAL BANDS (RFU Regulation 15.6)
-- =========================================================================

if v_dob_u13 is not null then
  select * into r from public.preview_player_allocation(v_uclub, v_dob_u13, 'FEMALE');
  if r.display_label = 'Under 14 Girls' and r.regulatory_age_label = 'U13' then
    raise notice 'PASS 4 (B): a U13 girl bands up to Under 14 Girls -- no fictitious Under 13 Girls';
  else raise notice 'FAIL 4 (B): U13 girl got % (age %)', r.display_label, r.regulatory_age_label; end if;

  select * into r from public.preview_player_allocation(v_uclub, v_dob_u13, 'MALE');
  if r.display_label = 'Under 13 Boys' then
    raise notice 'PASS 5 (B): a U13 boy stays at Under 13 Boys -- banding is a girls rule, not an age rule';
  else raise notice 'FAIL 5 (B): U13 boy got %', r.display_label; end if;
end if;

-- =========================================================================
-- C. MINI RUGBY IS ONE TEAM FOR BOTH PATHWAYS
-- =========================================================================

if v_dob_mini is not null then
  select * into r from public.preview_player_allocation(v_uclub, v_dob_mini, 'MALE');
  select * into v_ok from (select r.canonical_team_type_id is not null) x;
  declare v_male_id uuid := r.canonical_team_type_id; v_male_label text := r.display_label;
  begin
    select * into r from public.preview_player_allocation(v_uclub, v_dob_mini, 'FEMALE');
    if v_male_id is not null and r.canonical_team_type_id = v_male_id and v_male_label like '%Mixed%' then
      raise notice 'PASS 6 (C): a mini boy and a mini girl reach the SAME Mixed identity (%)', v_male_label;
    else
      raise notice 'FAIL 6 (C): male % / female %', v_male_label, r.display_label;
    end if;
  end;

  -- The club does not run this team. That must not become a different answer.
  select * into r from public.preview_player_allocation(v_uclub, v_dob_mini, 'FEMALE');
  if r.canonical_team_type_id is not null and not r.club_runs_team then
    raise notice 'PASS 7 (C): a club that does not run the team still gets the RIGHT identity, not a substitute';
  else
    raise notice 'FAIL 7 (C): identity % / runs %', r.display_label, r.club_runs_team;
  end if;
end if;

-- =========================================================================
-- D. THE PLAYER RECORD IS THE AUTHORITY
-- =========================================================================

if v_dob_u12 is not null then
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Ada','Allocation', v_dob_u12, 'FEMALE', true) returning id into v_player;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
  values (v_parent, v_player, 'guardian', 'active');

  select * into r from public.player_team_allocation(v_player, v_uclub);
  if r.display_label = 'Under 12 Girls' then
    raise notice 'PASS 8 (D): the allocation for a saved player is read from THEIR record, not from anything sent in';
  else raise notice 'FAIL 8 (D): got %', r.display_label; end if;

  if r.membership_status is null then
    raise notice 'PASS 9 (D): a player with no place at the club reports no membership -- resolved is not joined';
  else raise notice 'FAIL 9 (D): membership status %', r.membership_status; end if;

  insert into public.player_team_memberships (player_id, team_id, status)
  values (v_player, v_u12g, 'pending') returning id into v_ptm;

  select * into r from public.player_team_allocation(v_player, v_uclub);
  if r.membership_status = 'pending' then
    raise notice 'PASS 10 (D): a pending request reads as pending, never as joined';
  else raise notice 'FAIL 10 (D): membership status %', r.membership_status; end if;
end if;

-- =========================================================================
-- E. A MISSING PATHWAY IS NOT GUESSED
-- =========================================================================

if v_dob_u12 is not null then
  select * into r from public.preview_player_allocation(v_uclub, v_dob_u12, null);
  if r.allocation_status = 'CLASSIFICATION_REQUIRED' and r.canonical_team_type_id is null then
    raise notice 'PASS 11 (E): with no gender recorded, Ovalball asks rather than choosing a pathway';
  else raise notice 'FAIL 11 (E): got % / %', r.allocation_status, r.display_label; end if;
end if;

-- A date of birth is not optional either.
begin
  perform public.preview_player_allocation(v_uclub, null, 'MALE');
  raise notice 'FAIL 12 (E): an allocation was attempted with no date of birth';
exception when others then
  raise notice 'PASS 12 (E): no date of birth means no allocation, never a guess';
end;

-- =========================================================================
-- F. THE PREVIEW IS NOT AN ORACLE
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger,'role','authenticated')::text, true);
begin
  perform public.preview_player_allocation(v_uclub, coalesce(v_dob_u12, current_date - interval '12 years'), 'FEMALE');
  raise notice 'FAIL 13 (F): somebody with no relationship to the club could ask about a child there';
exception when others then
  raise notice 'PASS 13 (F): the allocation preview needs the same club relationship adding a child does';
end;

if v_player is not null then
  begin
    perform public.player_team_allocation(v_player, v_uclub);
    raise notice 'FAIL 14 (F): an unrelated person read a real player''s allocation';
  exception when others then
    raise notice 'PASS 14 (F): an unrelated person cannot read a real player''s allocation';
  end;
end if;

-- =========================================================================
-- G. CODE ISOLATION HOLDS THROUGH REGISTRATION
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_parent,'role','authenticated')::text, true);
insert into public.club_memberships (user_id, club_id, role, status)
values (v_parent, v_lclub, 'BASIC_USER', 'active');

select id into v_season_l from public.seasons
where rugby_code='league' and not is_regression_fixture and starts_on <= current_date and ends_on >= current_date limit 1;

if v_season_l is not null and v_dob_u13 is not null then
  select * into r from public.preview_player_allocation(v_lclub, v_dob_u13, 'FEMALE');
  if r.rugby_code = 'league'
     and (r.canonical_team_type_id is null or exists (
       select 1 from public.canonical_team_types_by_code v
       where v.id = r.canonical_team_type_id and v.rugby_code = 'league' and v.is_offered)) then
    raise notice 'PASS 15 (G): a League registration is only ever allocated a League identity';
  else
    raise notice 'FAIL 15 (G): League registration resolved a non-League identity (%)', r.display_label;
  end if;
end if;

-- =========================================================================
-- H2. A PLAYER'S GENDER IS RECORDED ONCE
-- =========================================================================
--
-- Completing a missing value and changing a recorded one are different acts.
-- The first is why the control exists; the second is not a parent's to make.

declare v_blank uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Robin','Unrecorded', coalesce(v_dob_u12, current_date - interval '12 years'), null, true)
  returning id into v_blank;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
  values (v_parent, v_blank, 'guardian', 'active');

  perform public.set_player_playing_pathway(v_blank, 'FEMALE');
  if (select playing_pathway from public.players where id = v_blank) = 'FEMALE' then
    raise notice 'PASS 17 (H2): a guardian can supply a gender that was never recorded';
  else
    raise notice 'FAIL 17 (H2): the value was not recorded';
  end if;

  -- Sending the same value again is not a change, and must not error: a double
  -- submit or a stale form is not a mistake worth blocking.
  begin
    perform public.set_player_playing_pathway(v_blank, 'FEMALE');
    raise notice 'PASS 18 (H2): re-sending the same value is accepted quietly';
  exception when others then
    raise notice 'FAIL 18 (H2): re-sending the same value errored: %', sqlerrm;
  end;

  begin
    perform public.set_player_playing_pathway(v_blank, 'MALE');
    raise notice 'FAIL 19 (H2): a guardian changed a gender that was already recorded';
  exception when others then
    raise notice 'PASS 19 (H2): once recorded, a guardian cannot change it';
  end;

  if (select playing_pathway from public.players where id = v_blank) = 'FEMALE' then
    raise notice 'PASS 20 (H2): the refused change left the recorded value untouched';
  else
    raise notice 'FAIL 20 (H2): the value is now %', (select playing_pathway from public.players where id = v_blank);
  end if;
end;

-- =========================================================================
-- H. NO RAW KEYS REACH THE SCREEN
-- =========================================================================

if v_dob_u12 is not null then
  select count(*) into v_n
  from public.preview_player_allocation(v_uclub, v_dob_u12, 'FEMALE') p
  where p.display_label ~ '_' or p.compact_label ~ '_';
  if v_n = 0 then
    raise notice 'PASS 16 (H): the labels handed to registration are names, never canonical keys';
  else raise notice 'FAIL 16 (H): a canonical key reached the presentation layer'; end if;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
