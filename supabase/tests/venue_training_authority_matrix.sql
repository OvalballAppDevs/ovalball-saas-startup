-- =====================================================================================================
-- VENUE AND TRAINING AUTHORITY MATRIX  (Identity/Auth Slice 4E, Phase 2 AA.3 row 4e)
--
-- The domain matrix AA.3 names for 4e. DETERMINISTIC and SELF-SEEDING: every club, team, venue,
-- pitch, event, plan and person it needs, it creates. It never reads a UAT seed identity, so it
-- cannot skip into a green zero-assertion pass on a clean database.
--
-- Contract under test: design J.9 lines 496-507, the U section's "venues RLS/RPC mismatch" closure,
-- the V volunteer boundary, and the M-2 closure for training and venue data.
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
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','vtm-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Vtm',p_label,'vtm-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('VTM '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','vtm-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'vtm-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','vtm-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
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

create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  execute 'select ('||p_expr||')::boolean' into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,false);
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role','anon')
                                                else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role','anon')
                                                else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  execute p_sql into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,0);
end $$;

-- =====================================================================================================
-- VT-A. The catalogue says what J.9 says. Structural, so it cannot pass by accident.
-- =====================================================================================================
do $$
declare r record; n int;
begin
  for r in select * from (values
    ('calendar.event.view','{club,team,child}'), ('calendar.event.manage','{club,team}'),
    ('venue.venue.view','{club}'), ('venue.venue.manage','{club}'), ('venue.pitch.manage','{club}'),
    ('venue.pitch_allocation.view','{club}'), ('venue.pitch_allocation.manage','{club}'),
    ('training.session.view','{club,team,child}'), ('training.plan.manage','{club,team}'),
    ('training.session.cancel','{club,team}'), ('training.communication.send','{club,team}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c where c.key = r.key and c.status='ACTIVE' and c.valid_scopes::text = r.scopes),
      format('VT-A %s is ACTIVE with scopes %s (J.9)', r.key, r.scopes));
  end loop;

  -- The U closure, stated as a bundle fact: one authority for one resource, held by CA and FS.
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='venue.venue.manage' and scope_type='club') = 2
    and exists (select 1 from public.bundle_capabilities where capability_key='venue.venue.manage' and bundle_key='FS'),
    'VT-A venue.venue.manage is CA and FS -- the U section''s venues RLS/RPC mismatch closed (J.9 line 500)');

  -- J.9 line 504: training.session.view does NOT reach an ordinary club Member, and is
  -- safeguarding-sensitive, because a training session says where named children will be.
  perform pg_temp.check(
    not exists (select 1 from public.bundle_capabilities where capability_key='training.session.view' and bundle_key='MB'),
    'VT-A training.session.view does not reach an ordinary club Member (J.9 line 504)');
  perform pg_temp.check(
    (select safeguarding_sensitive from public.capabilities where key='training.session.view'),
    'VT-A and it is marked safeguarding-sensitive');
  perform pg_temp.check(
    exists (select 1 from public.bundle_capabilities where capability_key='calendar.event.view' and bundle_key='MB'),
    'VT-A while calendar.event.view DOES reach a club Member -- a club event is not a child''s timetable');

  -- The V volunteer boundary: VO gets the views and no mutation key in this domain.
  select count(*) into n from public.bundle_capabilities
  where bundle_key='VO' and capability_key in ('venue.venue.manage','venue.pitch.manage','venue.pitch_allocation.manage',
                                               'training.plan.manage','training.session.cancel','training.communication.send','calendar.event.manage');
  perform pg_temp.check(n = 0, 'VT-A a Volunteer holds no mutation key in this domain (section V)');
  perform pg_temp.check(
    exists (select 1 from public.bundle_capabilities where bundle_key='VO' and capability_key='venue.venue.view')
    and exists (select 1 from public.bundle_capabilities where bundle_key='VO' and capability_key='venue.pitch_allocation.view'),
    'VT-A but does hold venue.venue.view and venue.pitch_allocation.view (section V)');

  -- The legacy adapter is gone, not merely unused.
  perform pg_temp.check(
    not exists (select 1 from public.capability_key_map where legacy_key in ('calendar.manage','calendar.view')),
    'VT-A the calendar.manage / calendar.view adapter rows are retired');
end $$;

-- =====================================================================================================
-- VT-B..VT-J. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_ca uuid; v_fs uuid; v_tm uuid; v_tm2 uuid; v_co uuid; v_mb uuid; v_sa uuid; v_far uuid; v_str uuid;
  v_club uuid; v_far_club uuid; v_team uuid; v_team2 uuid; v_m uuid; v_season uuid;
  v_venue uuid; v_far_venue uuid; v_pitch uuid; v_evt_club uuid; v_evt_team uuid; v_evt_wide_teams uuid; v_plan uuid; v_sess uuid;
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
  v_far := pg_temp.person('FARCA'); perform pg_temp.member(v_far_club,v_far,'CLUB_ADMIN');
  v_str := pg_temp.person('STR');
  v_sa := pg_temp.person('SA'); insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');

  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('VTM Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'vtm-'||v_tag)
    returning id into v_season;
  end if;

  insert into public.venues (club_id, name, slug, active) values (v_club,'VTM Park '||v_tag,'vtm-park-'||v_tag,true) returning id into v_venue;
  insert into public.venues (club_id, name, slug, active) values (v_far_club,'VTM Far Park '||v_tag,'vtm-far-'||v_tag,true) returning id into v_far_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club,v_venue,'Pitch 1',true) returning id into v_pitch;
  insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, is_club_wide, created_by)
  values (v_club,'VTM Club Wide '||v_tag,current_date+20,current_date+20,v_venue,true,v_ca) returning id into v_evt_club;
  insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, is_club_wide, created_by)
  values (v_club,'VTM Team Only '||v_tag,current_date+21,current_date+21,v_venue,false,v_ca) returning id into v_evt_team;
  insert into public.club_event_teams (event_id, team_id) values (v_evt_team, v_team);
  insert into public.training_plans (club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id, created_by)
  values (v_club,v_team,v_season,'SEASON',v_venue,v_pitch,v_ca) returning id into v_plan;
  insert into public.training_sessions (club_id, team_id, training_plan_id, session_date, start_time, duration_minutes)
  values (v_club,v_team,v_plan,current_date+7,'18:00',60) returning id into v_sess;

  -- ---------------------------------------------------------------------------------------------
  -- VT-B  managing a club event (J.9 line 497)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B1 the Club Admin manages a club-wide event');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B2 so does the Fixtures Secretary');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B3 a Team Manager does NOT -- a club-wide event reaches every team, so it is never one team''s');
  -- The same invariant where it is actually OBSERVABLE. A club-wide event with no rows in
  -- club_event_teams cannot distinguish "club-wide events are nobody's team's" from "an event with
  -- no teams is nobody's team's" -- both refuse for the same trivial reason. Mutation testing found
  -- this: a mutant that let ANY one named team's manager take a club-wide event survived, because
  -- the only club-wide event in the matrix had no named teams to be one of.
  insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, is_club_wide, created_by)
  values (v_club,'VTM Club Wide With Teams '||v_tag,current_date+22,current_date+22,v_venue,true,v_ca) returning id into v_evt_wide_teams;
  insert into public.club_event_teams (event_id, team_id) values (v_evt_wide_teams, v_team);
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_club_event(%L)',v_evt_wide_teams)),
    'VT-B3b and still does NOT when the club-wide event names their team among others');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_club_event(%L)',v_evt_wide_teams)),
    'VT-B3c while the Club Admin does');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_manage_club_event(%L)',v_evt_team)),
    'VT-B4 but does manage an event scoped to their own team');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.can_manage_club_event(%L)',v_evt_team)),
    'VT-B5 and not one scoped to a different team');
  perform pg_temp.check(not pg_temp.bool_as(v_co, format('internal.can_manage_club_event(%L)',v_evt_team)),
    'VT-B6 a Coach manages no event -- calendar.event.manage is CA, FS and TM only');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B7 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B8 nor a Club Admin at another club');
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_manage_club_event(%L)',v_evt_club)),
    'VT-B9 site support does, through site.support.act_in_club rather than a bare is_site_admin()');

  -- VT-C  viewing a club event (J.9 line 496) -- a club Member IS included here
  perform pg_temp.check(pg_temp.bool_as(v_mb, format('internal.club_event_visible_row(%L,%L,true)',v_evt_club,v_club)),
    'VT-C1 an ordinary club Member sees a club event');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.club_event_visible_row(%L,%L,true)',v_evt_club,v_club)),
    'VT-C2 so does a Coach');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.club_event_visible_row(%L,%L,true)',v_evt_club,v_club)),
    'VT-C3 another club''s Club Admin does not');
  perform pg_temp.check(not pg_temp.bool_as(v_str, format('internal.club_event_visible_row(%L,%L,true)',v_evt_club,v_club)),
    'VT-C4 nor a stranger');

  -- ---------------------------------------------------------------------------------------------
  -- VT-D  managing training (J.9 line 505, the MERGE)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_training(%L,null)',v_club)),
    'VT-D1 the Club Admin manages training club-wide');
  perform pg_temp.check(not pg_temp.bool_as(v_fs, format('internal.can_manage_training(%L,null)',v_club)),
    'VT-D2 the Fixtures Secretary does NOT -- training is not a fixture (J.9 line 505 omits FS)');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_manage_training(%L,%L)',v_club,v_team)),
    'VT-D3 the Team Manager manages their own team''s training');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.can_manage_training(%L,%L)',v_club,v_team)),
    'VT-D4 and so does its Coach -- training is the Coach''s job in a way a fixture request is not');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.can_manage_training(%L,%L)',v_club,v_team)),
    'VT-D5 but not another team''s manager');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_manage_training(%L,%L)',v_club,v_team)),
    'VT-D6 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.can_manage_training(%L,null)',v_club)),
    'VT-D7 nor another club''s Club Admin');

  -- VT-E  viewing a training session (J.9 line 504) -- INTENDED CHANGE: a club Member no longer can
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E1 the Club Admin sees a training session');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E2 so does the Fixtures Secretary, who needs the ground booked');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E3 and that team''s Manager and Coach');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E4 INTENDED CHANGE: an ordinary club Member no longer does -- a training session says where '
    'named children will be, and the key is safeguarding-sensitive');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E5 nor another team''s manager');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.training_session_visible_row(%L,%L,null)',v_club,v_team)),
    'VT-E6 nor another club');

  -- ---------------------------------------------------------------------------------------------
  -- VT-F  managing a venue -- the U closure. ONE answer for the RPC and the RLS.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_venue(%L)',v_club)),
    'VT-F1 the Club Admin manages a venue');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_manage_venue(%L)',v_club)),
    'VT-F2 INTENDED CHANGE: so does the Fixtures Secretary -- the RPC used to refuse what the RLS allowed');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_venue(%L)',v_club)),
    'VT-F3 a Team Manager does not');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_manage_venue(%L)',v_club)),
    'VT-F4 nor an ordinary Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.can_manage_venue(%L)',v_club)),
    'VT-F5 nor another club''s Club Admin');
  declare v_state text; v_name text;
  begin
    v_state := pg_temp.try_as(v_fs, format('update public.venues set name = ''FS renamed'' where id = %L',v_venue));
    select name into v_name from public.venues where id = v_venue;
    perform pg_temp.check(v_state = 'OK' and v_name = 'FS renamed',
      format('VT-F6 and the RLS agrees with the gate: the Fixtures Secretary''s UPDATE lands (state=%s name=%s)', v_state, v_name));
  end;
  perform pg_temp.check(
    pg_temp.try_as(v_far, format('update public.venues set name = ''hijacked'' where id = %L',v_venue)) = 'OK'
      and (select name from public.venues where id = v_venue) = 'FS renamed',
    'VT-F7 while another club''s admin changes nothing');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_manage_pitch(%L)',v_club))
                        and pg_temp.bool_as(v_fs, format('internal.can_manage_pitch(%L)',v_club))
                        and not pg_temp.bool_as(v_tm, format('internal.can_manage_pitch(%L)',v_club)),
    'VT-F8 pitches follow the same rule, and no longer borrow 4C''s can_manage_club_fixtures');

  -- VT-G  viewing a venue -- the M-2 residue for signed-in readers
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.venues where id = %L',v_venue)) = 1,
    'VT-G1 a club Member reads their own club''s venue');
  perform pg_temp.check(pg_temp.count_as(v_tm, format('select count(*) from public.venues where id = %L',v_venue)) = 1,
    'VT-G2 so does a Team Manager');
  perform pg_temp.check(pg_temp.count_as(v_far, format('select count(*) from public.venues where id = %L',v_venue)) = 0,
    'VT-G3 INTENDED CHANGE: another club''s Club Admin reads none of it -- venues_select was `true`');
  perform pg_temp.check(pg_temp.count_as(v_str, format('select count(*) from public.venues where id = %L',v_venue)) = 0,
    'VT-G4 nor a signed-in stranger');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.venues where id = %L',v_far_venue)) = 0,
    'VT-G5 and the rule is symmetric -- our Club Admin reads none of THEIR venue');
  perform pg_temp.check(pg_temp.count_as(v_sa, format('select count(*) from public.venues where id = %L',v_venue)) = 1,
    'VT-G6 site support reads it through site.clubs.view');

  -- ---------------------------------------------------------------------------------------------
  -- VT-H  training plans and schedule rules are no longer world-readable to signed-in accounts
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.training_plans where id = %L',v_plan)) = 1,
    'VT-H1 the Club Admin reads the training plan');
  perform pg_temp.check(pg_temp.count_as(v_co, format('select count(*) from public.training_plans where id = %L',v_plan)) = 1,
    'VT-H2 so does the team''s Coach');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.training_plans where id = %L',v_plan)) = 0,
    'VT-H3 INTENDED CHANGE: an ordinary club Member does not');
  perform pg_temp.check(pg_temp.count_as(v_far, format('select count(*) from public.training_plans where id = %L',v_plan)) = 0,
    'VT-H4 nor another club');
  perform pg_temp.check(pg_temp.count_as(v_far, format('select count(*) from public.training_sessions where id = %L',v_sess)) = 0,
    'VT-H5 nor its sessions');

  -- ---------------------------------------------------------------------------------------------
  -- VT-I  M-2: the anonymous perimeter. Asserted in BOTH directions -- a check that only looks for
  --       absence is content when a public surface goes dark.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select count(*) from information_schema.column_privileges
     where table_schema='public' and grantee='anon' and privilege_type='SELECT'
       and table_name in ('training_plans','training_sessions','training_plan_schedule_rules','club_events','club_pitches','venues')) = 0,
    'VT-I1 anon holds no grant on training, events, pitches or venues -- the M-2 closure holds');
  perform pg_temp.check(pg_temp.try_as(null, 'select count(*) from public.training_plans') <> 'OK',
    'VT-I2 and an anonymous read of training plans is refused outright');
  perform pg_temp.check(pg_temp.try_as(null, 'select count(*) from public.venues') <> 'OK',
    'VT-I3 as is an anonymous read of the venues table');
  perform pg_temp.check(pg_temp.count_as(null, format('select count(*) from public.public_venues where id = %L',v_venue)) = 1,
    'VT-I4 while public.public_venues DOES serve the venue name anonymously -- a public fixture has to say where it is');
  perform pg_temp.check(
    (select count(*) from information_schema.columns where table_schema='public' and table_name='public_venues') = 3,
    'VT-I5 and that projection carries three columns, not the venue row');

  -- ---------------------------------------------------------------------------------------------
  -- VT-J  attacks: the write paths refuse, not merely the capability helpers
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format('select public.set_venue_active(%L, false)',v_venue)) = '42501',
    'VT-J1 set_venue_active refuses an ordinary Member with insufficient_privilege');
  perform pg_temp.check(
    pg_temp.try_as(v_far, format('select public.set_venue_active(%L, false)',v_venue)) = '42501',
    'VT-J2 and another club''s Club Admin');
  perform pg_temp.check((select active from public.venues where id = v_venue),
    'VT-J3 and the venue is still active');
  perform pg_temp.check(
    pg_temp.try_as(v_tm, format('select public.rename_club_pitch(%L, ''hijacked'')',v_pitch)) = '42501',
    'VT-J4 rename_club_pitch refuses a Team Manager');
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format('select public.cancel_training_session(%L, ''nope'')',v_sess)) <> 'OK',
    'VT-J5 cancel_training_session refuses an ordinary Member');
  perform pg_temp.check(
    pg_temp.try_as(v_far, format('insert into public.venues (club_id, name, slug) values (%L, ''sneaked'', ''sneaked-%s'')',v_club,v_tag)) <> 'OK',
    'VT-J6 a direct INSERT of a venue into another club is refused');
  -- Scope substitution: a Team Manager naming a team they do not manage.
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can_manage_training(%L,%L)',v_club,v_team2)),
    'VT-J7 scope substitution fails -- naming another team does not confer authority over it');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can(''training.plan.manage'',''team'',%L,%L,null)',v_far_club,v_team)),
    'VT-J8 nor does naming another club with your own team');

  -- VT-J9..J11  the WRITE policies exist and bite. A policy that is dropped and not recreated makes
  -- reads look fast and writes look permitted, and nothing else in this matrix would notice -- which
  -- is exactly what a half-applied migration did during development.
  perform pg_temp.check(
    -- PERMISSIVE only: Slice 6's RESTRICTIVE session gate is FOR ALL on every non-public table, and it
    -- grants nothing. What this assertion is about is the WRITE policies still being there.
    (select count(*) from pg_policies where schemaname='public' and tablename='training_plans'
      and cmd='ALL' and permissive='PERMISSIVE') = 1
    and (select count(*) from pg_policies where schemaname='public' and tablename='venues'
      and cmd in ('INSERT','UPDATE') and permissive='PERMISSIVE') = 2,
    'VT-J9 the training and venue write policies are installed, not merely intended');
  declare v_state text; v_mode text;
  begin
    v_state := pg_temp.try_as(v_mb, format('update public.training_plans set schedule_mode = ''CUSTOM'' where id = %L',v_plan));
    select schedule_mode into v_mode from public.training_plans where id = v_plan;
    perform pg_temp.check(v_mode = 'SEASON',
      format('VT-J10 an ordinary Member''s UPDATE of a training plan changes nothing (state=%s mode=%s)', v_state, v_mode));
    v_state := pg_temp.try_as(v_far, format('update public.training_plans set schedule_mode = ''CUSTOM'' where id = %L',v_plan));
    select schedule_mode into v_mode from public.training_plans where id = v_plan;
    perform pg_temp.check(v_mode = 'SEASON',
      format('VT-J11 nor does another club''s Club Admin''s (state=%s mode=%s)', v_state, v_mode));
  end;
end $$;

-- =====================================================================================================
-- VT-K. Retirement, structurally.
-- =====================================================================================================
do $$
declare
  v_4e constant text[] := array[
    'internal.can_manage_club_event','internal.club_event_visible_row','internal.can_manage_training',
    'internal.can_manage_club_training','internal.training_session_visible_row','internal.can_manage_venue',
    'internal.can_manage_pitch','internal.can_view_venue',
    'public.create_venue','public.update_venue','public.set_venue_active','public.set_default_venue',
    'public.set_venue_address','public.create_club_pitch','public.rename_club_pitch','public.reorder_club_pitches',
    'public.set_club_pitch_active','public.set_club_pitch_venue','public.save_club_event','public.cancel_club_event',
    'public.cancel_training_session','public.save_training_plan','public.deactivate_training_plan',
    'public.reactivate_training_plan','public.generate_training_plan_sessions','public.get_training_management_overview',
    'public.get_training_plan_deletion_impact','public.get_training_session_card','public.override_training_session',
    'public.preview_training_plan_occurrences'
  ];
  v_legacy constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures)\(';
  v_legacy_keys constant text := '''(calendar\.manage|calendar\.view|club\.venues\.manage|club\.pitches\.manage|club\.training\.manage|team\.training\.manage|fixture\.view)''';
  v_bad text[];
begin
  select coalesce(array_agg(n.nspname||'.'||f.proname order by 1),'{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace
  where (n.nspname||'.'||f.proname) = any (v_4e) and f.prosrc ~ v_legacy;
  perform pg_temp.check(cardinality(v_bad)=0,
    format('VT-K1 no 4E function calls a legacy authority helper%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  perform pg_temp.check(
    (select count(*) filter (where n.nspname||'.'||f.proname = any (v_4e))
     from pg_proc f join pg_namespace n on n.oid=f.pronamespace) = cardinality(v_4e),
    'VT-K2 every 4E function in the ledger exists -- the list is not stale');

  -- The deprecated capability keys this slice retires must be named NOWHERE, by anyone. This is
  -- the assertion that would have caught public.save_club_event, which the first run of the
  -- migration found still holding calendar.manage after the gates had been migrated.
  select coalesce(array_agg(x order by x),'{}') into v_bad from (
    select n.nspname||'.'||f.proname as x
    from pg_proc f join pg_namespace n on n.oid=f.pronamespace
    where n.nspname in ('public','internal') and f.proname not in ('capability_decision','has_capability')
      and f.prosrc ~ v_legacy_keys
    union all
    select 'policy '||tablename||'.'||policyname
    from pg_policies where (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ v_legacy_keys
  ) q;
  perform pg_temp.check(cardinality(v_bad)=0,
    format('VT-K3 no function or policy anywhere names a key this slice retired%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  -- The Slice 4D remnant this slice had to close in order to retire the adapter.
  -- The Slice 4D remnant this slice had to close in order to retire the adapter: the three RPCs
  -- whose AUTHORITY GATE held calendar.manage, plus the bare is_site_admin() beside it.
  --
  -- get_tournament_centre is deliberately NOT in this list. Its remaining can_manage_team /
  -- can_manage_club_fixtures calls filter which pending invitations to DISPLAY; they are not an
  -- authority gate, they never held the calendar key, and they did not block this slice. Asserting
  -- them here would be 4E claiming work it did not do and has no contract for.
  select coalesce(array_agg(n.nspname||'.'||f.proname order by 1),'{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace
  where n.nspname='public'
    and f.proname in ('save_tournament','add_tournament_team_entry','update_tournament_venue')
    and f.prosrc ~ '\mis_site_admin\(';
  perform pg_temp.check(cardinality(v_bad)=0,
    format('VT-K4 the three tournament gates 4E closed carry no bare is_site_admin()%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  -- Earlier slices must still hold. 4E touches fixtures nowhere.
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.fixtures','INSERT')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='create_fixture'),
    'VT-K5 Slice 4C still holds: no direct fixture INSERT, and create_fixture is the contract');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='internal' and p.proname='is_club_fixture_administrator'),
    'VT-K6 and Slice 4D still holds: the raw-role fixture-administrator helper is still gone');
end $$;

rollback;
