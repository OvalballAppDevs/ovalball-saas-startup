-- =====================================================================================================
-- COMPETITION AND TOURNAMENT AUTHORITY MATRIX  (Identity/Auth Slice 4D, Phase 2 AA.3 row 4d)
--
-- The domain matrix AA.3 names for 4d. It is DETERMINISTIC and SELF-SEEDING: every club, team and
-- person it needs, it creates. It never reads a UAT seed identity and therefore cannot silently skip
-- into a zero-assertion pass on a clean database -- the failure mode Slice 4C found and fixed.
--
-- The contract under test is design J.8 lines 482-491, plus the bulk-authority invariant at line 1289.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cam-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Cam',p_label,'cam-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CAM '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cam-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'cam-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.dir_of(p_club uuid) returns uuid language sql stable as $$
  select directory_id from public.clubs where id = p_club;
$$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','cam-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club,p_user,p_role,'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text) returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership,p_team,p_permission);
end $$;

-- A boolean expression evaluated AS a signed-in person, through the browser role.
create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  execute 'select ('||p_expr||')::boolean' into v;
  perform set_config('role','none', true);
  perform set_config('request.jwt.claims','', true);
  return coalesce(v,false);
end $$;

-- Runs SQL as a person (or anonymously when p_subject is null) and returns the SQLSTATE, or 'OK'.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role','anon')
                                                else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('role','none', true);
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role','anon')
                                                else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  execute p_sql into v;
  perform set_config('role','none', true);
  perform set_config('request.jwt.claims','', true);
  return coalesce(v,0);
end $$;

-- =====================================================================================================
-- CM-A. The catalogue says what J.8 says. Structural, so it cannot pass by accident.
-- =====================================================================================================
do $$
declare r record; n int;
begin
  for r in select * from (values
    ('competition.public.view','{public}'),
    ('competition.competition.create','{club}'),
    ('competition.edition.manage','{club}'),
    ('competition.creator.use','{club}'),
    ('competition.edition.issue','{club}'),
    ('competition.match.record_result','{club}'),
    ('competition.match.respond','{club,team}'),
    ('tournament.tournament.view','{club,team}'),
    ('tournament.tournament.manage','{club}'),
    ('site.competitions.manage','{site}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c
              where c.key = r.key and c.status = 'ACTIVE' and c.valid_scopes::text = r.scopes),
      format('CM-A %s is ACTIVE with scopes %s (J.8)', r.key, r.scopes));
  end loop;

  -- The bundles J.8 names, and no team bundle where J.8 says club-only.
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='competition.match.respond' and bundle_key='TM' and scope_type='team') = 1,
    'CM-A competition.match.respond reaches a Team Manager at team scope (J.8 line 488)');
  perform pg_temp.check(
    not exists (select 1 from public.bundle_capabilities where capability_key='competition.match.respond' and bundle_key='CO'),
    'CM-A and NOT a Coach -- answering commits the club to play the match');
  perform pg_temp.check(
    not exists (select 1 from public.bundle_capabilities where capability_key='tournament.tournament.manage' and scope_type='team'),
    'CM-A tournament.tournament.manage has no team bundle at all -- the occasion is club-level (J.8 line 490)');

  -- §AJ line 1289: the bulk-authority invariant. Competition Creator is club-only, like Planner
  -- and Import. A team role never acquires mass competition authority.
  select count(*) into n from public.bundle_capabilities
  where capability_key in ('competition.creator.use','competition.competition.create','competition.edition.issue','competition.edition.manage','competition.match.record_result')
    and scope_type = 'team';
  perform pg_temp.check(n = 0,
    'CM-A no team bundle grants Creator, competition creation, issue, edition management or result recording (design line 1289)');
end $$;

-- =====================================================================================================
-- CM-B..CM-G. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_ca uuid; v_fs uuid; v_tm uuid; v_tm2 uuid; v_co uuid; v_mb uuid; v_sa uuid; v_far_ca uuid; v_str uuid;
  v_club uuid; v_far_club uuid; v_team uuid; v_team2 uuid; v_m uuid; v_season uuid;
  v_comp uuid; v_ed uuid; v_stage uuid; v_match uuid;
  v_tourn uuid; v_solo uuid; v_entry uuid; v_entry2 uuid; v_solo_entry uuid; v_part uuid; v_part2 uuid; v_dir3 uuid; v_dir4 uuid; v_ctt uuid;
  v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  v_club := pg_temp.club('Home'); v_far_club := pg_temp.club('Far');
  v_team := pg_temp.team(v_club,'U12'); v_team2 := pg_temp.team(v_club,'U13');
  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_club,v_ca,'CLUB_ADMIN');
  v_fs := pg_temp.person('FS'); perform pg_temp.member(v_club,v_fs,'FIXTURE_SECRETARY');
  v_mb := pg_temp.person('MB'); perform pg_temp.member(v_club,v_mb,'BASIC_USER');
  v_tm := pg_temp.person('TM'); v_m := pg_temp.member(v_club,v_tm,'BASIC_USER'); perform pg_temp.team_role(v_m,v_team,'manager');
  v_tm2:= pg_temp.person('TM2');v_m := pg_temp.member(v_club,v_tm2,'BASIC_USER');perform pg_temp.team_role(v_m,v_team2,'manager');
  v_co := pg_temp.person('CO'); v_m := pg_temp.member(v_club,v_co,'BASIC_USER'); perform pg_temp.team_role(v_m,v_team,'coach');
  v_far_ca := pg_temp.person('FARCA'); perform pg_temp.member(v_far_club,v_far_ca,'CLUB_ADMIN');
  v_str := pg_temp.person('STR');
  v_sa := pg_temp.person('SA'); insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');

  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('CAM Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'cam-'||v_tag) returning id into v_season;
  end if;

  insert into public.competitions (name, slug, normalized_key, organiser_club_id, rugby_code, created_by)
  values ('CAM Cup '||v_tag,'cam-cup-'||v_tag,'cam-cup-'||v_tag,v_club,'union',v_ca) returning id into v_comp;
  insert into public.competition_editions (competition_id, season_id, rugby_code, created_by)
  values (v_comp,v_season,'union',v_ca) returning id into v_ed;
  insert into public.competition_stages (edition_id,name,kind,sort_order) values (v_ed,'League','league',1) returning id into v_stage;
  insert into public.competition_matches (edition_id, stage_id, status, round_number, created_by, is_public)
  values (v_ed,v_stage,'scheduled',1,v_ca,true) returning id into v_match;

  -- ---------------------------------------------------------------------------------------------
  -- CM-B  organising a competition: competition.edition.manage at the organiser club (J.8 484)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B1 the organiser club''s Club Admin organises the competition');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B2 so does its Fixtures Secretary');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B3 a Team Manager does not -- organising is club authority, never team');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B4 nor a Coach');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B5 nor an ordinary club Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B6 nor a Club Admin at another club -- organising binds to the ORGANISER club');
  perform pg_temp.check(not pg_temp.bool_as(v_str, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B7 nor a stranger');
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_organise_competition(%L)',v_comp)),
    'CM-B8 a Full Site Admin does, through site.competitions.manage');
  perform pg_temp.check(pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.competitions.manage'')')
                        and not pg_temp.bool_as(v_ca, 'internal.has_site_capability(''site.competitions.manage'')'),
    'CM-B9 and that is an explicit site capability, which no club role holds');

  -- CM-C  the edition inherits the competition's organiser, and nothing else
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_organise_edition(%L)',v_ed)),
    'CM-C1 the organiser organises the edition');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_organise_edition(%L)',v_ed)),
    'CM-C2 another club''s Club Admin does not');
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select internal.require_edition_organiser(%L)',v_ed)) = '42501',
    'CM-C3 require_edition_organiser refuses them with insufficient_privilege, not silently');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select internal.require_edition_organiser(%L)',v_ed)) = 'OK',
    'CM-C4 and admits the organiser');

  -- ---------------------------------------------------------------------------------------------
  -- CM-D  answering a competition match: competition.match.respond (J.8 488)
  --       INTENDED CHANGE 1 -- a Coach answered before this slice and does not now.
  --       INTENDED CHANGE 3 -- site support answers through the explicit site capability.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D1 the Club Admin answers for the club');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D2 so does the Fixtures Secretary');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D3 and the Team Manager of THAT team');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D4 but not the manager of a different team of the same club');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D5 INTENDED CHANGE: a Coach may not answer -- answering commits the club to play it');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D6 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D7 nor another club''s Club Admin');
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_answer_competition_match(%L,%L)',v_club,v_team)),
    'CM-D8 INTENDED CHANGE: site support answers through site.support.act_in_club (J.8 line 488)');

  -- ---------------------------------------------------------------------------------------------
  -- CM-E  the tournament OCCASION: tournament.tournament.manage, club scope only (J.8 490)
  --       INTENDED CHANGE 2 -- a solo-entered Team Manager took the whole occasion before.
  -- ---------------------------------------------------------------------------------------------
  insert into public.tournaments (name, host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, created_by, season_id)
  values ('CAM Festival '||v_tag, v_club, pg_temp.dir_of(v_club),'union',current_date+30,current_date+30,'confirmed',v_ca,v_season)
  returning id into v_tourn;
  insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by) values (v_tourn,v_club,v_team,v_ca) returning id into v_entry;
  insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by) values (v_tourn,v_club,v_team2,v_ca) returning id into v_entry2;

  insert into public.tournaments (name, host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, created_by, season_id)
  values ('CAM Solo '||v_tag, v_club, pg_temp.dir_of(v_club),'union',current_date+31,current_date+31,'confirmed',v_ca,v_season)
  returning id into v_solo;
  insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by) values (v_solo,v_club,v_team,v_ca) returning id into v_solo_entry;

  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E1 the host club''s Club Admin manages the occasion');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E2 so does the Fixtures Secretary');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E3 a Team Manager does not, when another team is also entered');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_tournament(%L)',v_solo)),
    'CM-E4 INTENDED CHANGE: nor when their team is the ONLY one entered -- the legacy rule '
    'contradicted its own stated intent in exactly that case');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_manage_tournament(%L)',v_solo)),
    'CM-E5 nor a Coach');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E6 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E7 nor a Club Admin at a club with no entry in it');
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_manage_tournament(%L)',v_tourn)),
    'CM-E8 site support does, through site.support.act_in_club, not through being Site Admin');

  -- ---------------------------------------------------------------------------------------------
  -- CM-F  the tournament ENTRY: the deliberate split is PRESERVED
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_manage_tournament_entry(%L)',v_entry)),
    'CM-F1 the Team Manager still schedules THEIR OWN team''s day -- the entry/occasion split holds');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_tournament_entry(%L)',v_entry2)),
    'CM-F2 and still cannot touch another team''s day');
  perform pg_temp.check(pg_temp.bool_as(v_tm2, format('internal.can_manage_tournament_entry(%L)',v_entry2)),
    'CM-F3 while that team''s own manager can');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_tournament_entry(%L)',v_entry)),
    'CM-F4 the Club Admin manages any entry of their club');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_manage_tournament_entry(%L)',v_entry)),
    'CM-F5 a Coach does not manage an entry');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_manage_tournament_entry(%L)',v_entry)),
    'CM-F6 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far_ca, format('internal.can_manage_tournament_entry(%L)',v_entry)),
    'CM-F7 nor another club''s Club Admin');

  -- ---------------------------------------------------------------------------------------------
  -- CM-G  the row policies, on an edition that is NOT publicly visible, so the organiser branch
  --       is the only way in. With an active edition every persona sees everything and the
  --       comparison would prove nothing.
  -- ---------------------------------------------------------------------------------------------
  update public.competition_editions set active = false where id = v_ed;
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.competition_matches where edition_id = %L',v_ed)) = 1,
    'CM-G1 the organiser reads the matches of a non-public edition');
  perform pg_temp.check(pg_temp.count_as(v_far_ca, format('select count(*) from public.competition_matches where edition_id = %L',v_ed)) = 0,
    'CM-G2 another club''s Club Admin reads none of them');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.competition_matches where edition_id = %L',v_ed)) = 0,
    'CM-G3 nor does an ordinary Member of the organising club');
  -- An anonymous visitor reads the PUBLIC competition surface and nothing else. This has to be
  -- asserted in both directions, because each direction has its own failure mode: if anon could
  -- read a non-public edition the perimeter would be broken, and if anon could read NOTHING the
  -- public competitions page would be broken -- and the second failure is the quiet one, because a
  -- perimeter test that only checks for absence is perfectly happy when a public surface goes dark.
  perform pg_temp.check(
    pg_temp.count_as(null, format('select count(*) from public.competition_matches where edition_id = %L',v_ed)) = 0,
    'CM-G4 an anonymous visitor reads none of a NON-public edition''s matches');
  update public.competition_editions set active = true where id = v_ed;
  perform pg_temp.check(
    pg_temp.count_as(null, format('select count(*) from public.competition_matches where edition_id = %L',v_ed)) = 1,
    'CM-G4b and DOES read them once the edition is public -- J.8 line 482, competition.public.view');
  update public.competition_editions set active = false where id = v_ed;
  -- anon's read is column-level, which is why a table-level privilege test says "false" here and
  -- must not be mistaken for "anon never reads this table".
  perform pg_temp.check(
    (select count(*) from information_schema.column_privileges
     where table_schema='public' and table_name='competition_matches' and grantee='anon' and privilege_type='SELECT') > 0
    and has_function_privilege('anon','internal.organised_edition_ids()','EXECUTE'),
    'CM-G4c anon holds column-level SELECT and EXECUTE on the hoisted helper, which is what makes that possible');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.competition_stages where edition_id = %L',v_ed)) = 1
                        and pg_temp.count_as(v_far_ca, format('select count(*) from public.competition_stages where edition_id = %L',v_ed)) = 0,
    'CM-G5 the same split holds for stages');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('%L = any (internal.organised_edition_ids())',v_ed))
                        and not pg_temp.bool_as(v_far_ca, format('%L = any (internal.organised_edition_ids())',v_ed)),
    'CM-G6 the hoisted set is caller-bounded -- it returns only what the caller organises');
  update public.competition_editions set active = true where id = v_ed;

  -- ---------------------------------------------------------------------------------------------
  -- CM-H  attacks: the RPCs refuse, not merely the capability helpers
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select public.issue_competition_matches(%L)',v_ed)) = '42501',
    'CM-H1 issue_competition_matches refuses a non-organiser');
  perform pg_temp.check(pg_temp.try_as(v_co, format('select public.issue_competition_matches(%L)',v_ed)) = '42501',
    'CM-H2 and a Coach of the organising club');
  perform pg_temp.check(pg_temp.try_as(null, format('select public.issue_competition_matches(%L)',v_ed)) <> 'OK',
    'CM-H3 and an anonymous caller');
  -- The competition tables are closed at the PRIVILEGE layer, not merely by policy: no browser
  -- role holds INSERT or UPDATE on them at all, so every write is a SECURITY DEFINER RPC that
  -- enforces its own contract. This is the same shape Slice 4C left public.fixtures in, and it is
  -- worth asserting explicitly, because a policy-only defence can be undone by a later GRANT.
  perform pg_temp.check(
    pg_temp.try_as(v_far_ca, format('insert into public.competition_matches (edition_id, stage_id, status, created_by) values (%L,%L,''scheduled'',auth.uid())',v_ed,v_stage)) <> 'OK',
    'CM-H4 a direct INSERT of a competition match is refused');
  perform pg_temp.check(
    pg_temp.try_as(v_far_ca, format('update public.competition_matches set status = ''cancelled'' where id = %L',v_match)) <> 'OK'
      and (select status from public.competition_matches where id = v_match) = 'scheduled',
    'CM-H5 and a direct UPDATE is refused and changes nothing');
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.competition_matches','INSERT')
      and not has_table_privilege('authenticated','public.competition_matches','UPDATE')
      and not has_table_privilege('authenticated','public.competition_matches','DELETE')
      and not has_table_privilege('anon','public.competition_matches','SELECT'),
    'CM-H5b no browser role holds any write on competition_matches, and anon holds no read');
  perform pg_temp.check(
    pg_temp.try_as(v_tm, format('select public.save_tournament(%L::uuid, %L::jsonb)', v_solo, '{}'::text)) <> 'OK',
    'CM-H6 save_tournament refuses a Team Manager for the occasion');

  -- ---------------------------------------------------------------------------------------------
  -- CM-J  the eight functions Slice 4C left to 4D (Slice 4 closure, AA.3 row 4d)
  --
  -- 4C migrated the fixtures half of internal.can_manage_club_fixtures and wrote down that a helper is
  -- retired by the slice that owns the MEANING of the call site, naming 4D for tournaments. 4D built
  -- the canonical model and verified it, but these eight never went through it: they still asked the
  -- fixtures role helper, so the occasion and a club's own consent were the same undivided question.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where (n.nspname, p.proname) in (
                   ('internal','tournament_visible_row'), ('public','get_tournament_centre'),
                   ('public','check_tournament_participant_target'), ('public','invite_tournament_participant'),
                   ('public','reconcile_tournament_participant'), ('public','remove_tournament_participant'),
                   ('public','respond_tournament_invitation'), ('public','update_fixture_competition'))
                   and p.prosrc ~ '\minternal\.(can_manage_club_fixtures|can_manage_team|is_site_admin|is_club_admin|is_full_site_admin)\('),
    'CM-J1 none of the eight asks a legacy authority helper any more');
  perform pg_temp.check(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','internal') and p.proname <> 'can_manage_club_fixtures'
        and p.prosrc ~ '\mcan_manage_club_fixtures\(') = 0,
    'CM-J2 and can_manage_club_fixtures now decides nothing anywhere -- zero policies, zero bodies');

  -- The consent boundary, which is the whole point. A tournament host invites; the invited club
  -- answers. Neither may do the other's half.
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, status, invited_by)
  select v_tourn, pg_temp.dir_of(v_far_club), v_far_club, null, ct.id, 'pending', v_ca
    from public.canonical_team_types ct where ct.is_active order by ct.sort_order limit 1
  returning id into v_part;
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.respond_tournament_invitation(%L, true)', v_part)) <> 'OK',
    'CM-J3 the HOST club cannot answer an invitation on the invited club''s behalf -- organiser authority never invents consent');
  -- Asked while it is still PENDING and still owned by a real club, so a gate that quietly switched
  -- from the host's club to the participant's own would let this through.
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select public.remove_tournament_participant(%L)', v_part)) <> 'OK',
    'CM-J3b an invited club cannot remove its own pending participation -- declining is its answer, deletion is not');
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select public.respond_tournament_invitation(%L, true)', v_part)) = 'OK',
    'CM-J4 while the INVITED club answers for itself');
  perform pg_temp.check(
    (select status from public.tournament_participants where id = v_part) = 'accepted'
    and (select responded_by from public.tournament_participants where id = v_part) = v_far_ca,
    'CM-J5 and the answer is recorded against the club that actually gave it');

  -- A SECOND participant, left PENDING on purpose. The removal path refuses an accepted participant
  -- outright -- the host may not unilaterally eject a club that has already said yes -- so asking the
  -- removal questions of v_part would have them all refused for a state reason and prove nothing
  -- about authority.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CAM Third '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cam-third-'||v_tag)
  returning id into v_dir3;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, status, invited_by)
  select v_tourn, v_dir3, null, null, ct.id, 'pending', v_ca
    from public.canonical_team_types ct where ct.is_active order by ct.sort_order limit 1
  returning id into v_part2;

  -- A directory that is NOT already a participant. Inviting one twice is refused on the unique
  -- constraint, which would answer this question for a reason that has nothing to do with authority.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CAM Fourth '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cam-fourth-'||v_tag)
  returning id into v_dir4;
  select ct.id into v_ctt from public.canonical_team_types ct where ct.is_active order by ct.sort_order limit 1;
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select public.invite_tournament_participant(%L, %L, %L)', v_tourn, v_dir4, v_ctt)) <> 'OK',
    'CM-J6 an invited club cannot invite further participants to somebody else''s occasion');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.invite_tournament_participant(%L, %L, %L)', v_tourn, v_dir4, v_ctt)) <> 'OK'
                        and pg_temp.try_as(v_co, format('select public.invite_tournament_participant(%L, %L, %L)', v_tourn, v_dir4, v_ctt)) <> 'OK',
    'CM-J6b nor may an ordinary member or a Coach of the host club');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.invite_tournament_participant(%L, %L, %L)', v_tourn, v_dir4, v_ctt)) = 'OK',
    'CM-J6c while the host club''s administrator may -- so those refusals are the boundary, not a missing team type');
  perform pg_temp.check(pg_temp.try_as(v_far_ca, format('select public.remove_tournament_participant(%L)', v_part2)) <> 'OK',
    'CM-J7 nor remove another club''s PENDING participation -- so the refusal is authority, not the already-accepted rule');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.remove_tournament_participant(%L)', v_part2)) <> 'OK'
                        and pg_temp.try_as(v_co, format('select public.remove_tournament_participant(%L)', v_part2)) <> 'OK',
    'CM-J8 nor may an ordinary member or a Coach of the host club');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_part2)) = 'OK',
    'CM-J9 while the host club''s administrator may -- so the refusals above are the boundary, not a broken participant');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_part)) <> 'OK',
    'CM-J9b and even the host cannot remove a club that has ACCEPTED -- consent, once given, is not the organiser''s to withdraw');

  -- J.8 line 490 again, and the 4D distinction the closure pass had to preserve: the occasion is
  -- club-level, and a Team Manager's authority reaches their own entry and stops there.
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_manage_tournament_entry(%L)', v_entry))
                        and not pg_temp.bool_as(v_tm, format('internal.can_manage_tournament(%L)', v_tourn)),
    'CM-J10 a Team Manager still controls their own entry and not the whole occasion');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_tournament_entry(%L)', v_entry2)),
    'CM-J11 and not another side''s entry');
  perform pg_temp.check(
    not exists (select 1 from public.bundle_capabilities
                 where capability_key = 'tournament.tournament.manage' and scope_type = 'team'),
    'CM-J12 tournament.tournament.manage still has no team bundle at all (J.8 line 490)');
  -- update_fixture_competition is a FIXTURE edit, not a tournament act: it sets which competition a
  -- club's own fixture belongs to. Naming the key is what stops it drifting onto a view key, which
  -- would let anyone who can SEE a fixture decide what competition it counts towards.
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'update_fixture_competition') ~ 'fixture\.fixture\.edit',
    'CM-J13 update_fixture_competition asks fixture.fixture.edit by name (J.7)');
end $$;

-- =====================================================================================================
-- CM-I. Retirement, structurally. 4D's own functions name no legacy authority helper.
-- =====================================================================================================
do $$
declare
  v_4d constant text[] := array[
    'internal.can_organise_competition','internal.can_organise_edition','internal.can_answer_competition_match',
    'internal.can_manage_tournament','internal.can_manage_tournament_entry','internal.organised_edition_ids',
    'public.issue_competition_matches'
  ];
  v_legacy constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|can_bulk_plan_fixtures|is_club_fixture_administrator|can_manage_player|may_complete_player_profile)\(';
  v_legacy_policy constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|is_club_fixture_administrator|can_manage_player|may_complete_player_profile)\(';
  v_bad text[];
begin
  select coalesce(array_agg(n.nspname||'.'||f.proname order by 1),'{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname||'.'||f.proname) = any (v_4d) and f.prosrc ~ v_legacy;
  perform pg_temp.check(cardinality(v_bad) = 0,
    format('CM-I1 no 4D function calls a legacy authority helper%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  perform pg_temp.check(
    (select count(*) filter (where n.nspname||'.'||f.proname = any (v_4d))
     from pg_proc f join pg_namespace n on n.oid=f.pronamespace) = cardinality(v_4d),
    'CM-I2 every 4D function in the ledger exists -- the list is not stale');

  -- The policy regex deliberately omits can_bulk_plan_fixtures and can_create_team_fixture.
  -- Those are Slice 4C's CANONICAL gates, not legacy helpers, and competition_match_verifications
  -- asks them because "may this club plan fixtures" and "may this team have a fixture created for
  -- it" are fixture questions that 4C owns the meaning of. Rewriting them here would reach into
  -- another slice's domain. 4D must be free of the helpers 4D is responsible for, which is what
  -- CM-I1 asserts of its own function bodies.
  select coalesce(array_agg(tablename||'.'||policyname order by 1),'{}') into v_bad
  from pg_policies
  where schemaname='public'
    and tablename in ('competition_group_members','competition_groups','competition_match_fixtures',
                      'competition_match_verifications','competition_matches','competition_participants',
                      'competition_rounds','competition_stages','tournaments','tournament_team_entries')
    and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ v_legacy_policy;
  perform pg_temp.check(cardinality(v_bad) = 0,
    format('CM-I3 no 4D table policy calls a legacy authority helper%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  perform pg_temp.check(
    not exists (select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace
                where n.nspname='internal' and f.proname='is_club_fixture_administrator'),
    'CM-I4 the raw-role helper internal.is_club_fixture_administrator is gone, not merely uncalled');

  perform pg_temp.check(
    not exists (select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace
                where n.nspname in ('public','internal')
                  and f.proname in ('can_manage_tournament','can_manage_tournament_entry','can_organise_competition')
                  and f.prosrc like '%''calendar.manage''%'),
    'CM-I5 the deprecated calendar.manage key decides no tournament authority (AA.3 row 4d)');

end $$;

rollback;
