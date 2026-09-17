-- =====================================================================================================
-- AGE ELIGIBILITY (D-S5-1) -- unknown age does not establish adulthood
--
-- Deterministic and self-seeding. Every identity, club, team and membership it needs, it creates.
--
-- The defect: internal.person_is_minor answers "is this person KNOWN to be under 18", and every
-- minor-prohibited gate reads it as `minor_prohibited and person_is_minor(...)`. An account Ovalball
-- has never been told the age of therefore answered exactly as a forty-year-old did, and could be
-- given a Club Admin, Coach or Safeguarding Officer role over children.
--
-- The decision (IDENTITY_AUTH_DECISION_RECORD.md, D-S5-1) gates the WRITE boundary, not the resolver,
-- so nobody loses authority they already hold. This suite pins both halves: what is now refused, and
-- what must on no account start being refused.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','age-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Age',p_label,'age-'||v::text||'@ovalball.test',p_dob);
  return v;
end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  return v;
end $$;

-- Runs p_sql as a signed-in person and puts the role back, so the surrounding assertions keep
-- running as the suite's own role rather than as `authenticated`.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

-- =====================================================================================================
-- AE-A. The predicate, at the exact boundary.
-- =====================================================================================================
do $$
declare r record; v uuid;
begin
  for r in select * from (values
      ('no date of birth at all',       null::date,                                              false),
      ('eighteen exactly today',        (current_date - interval '18 years')::date,              true ),
      ('eighteen tomorrow',             (current_date - interval '18 years' + interval '1 day')::date, false),
      ('eighteen yesterday',            (current_date - interval '18 years' - interval '1 day')::date, true ),
      ('a twelve-year-old',             (current_date - interval '12 years')::date,              false),
      ('a date in the future',          (current_date + interval '5 years')::date,               false),
      ('a forty-year-old',              (current_date - interval '40 years')::date,              true )
    ) as t(label, dob, expected)
  loop
    v := pg_temp.person('B', r.dob);
    perform pg_temp.check(internal.person_is_established_adult(v) = r.expected,
      format('AE-A %s -> established adult = %s', rpad(r.label, 24), r.expected));
  end loop;

  -- D-S4-4's predicate is NOT redefined, and the two disagree in exactly one place: unknown age.
  v := pg_temp.person('U', null);
  perform pg_temp.check(internal.person_is_minor(v) = false and internal.person_is_established_adult(v) = false,
    'AE-A8 unknown age is neither a known minor nor an established adult -- the whole point of the decision');
  perform pg_temp.check(internal.person_recorded_date_of_birth(v) is null,
    'AE-A9 and the canonical recorded date of birth is null');
end $$;

-- =====================================================================================================
-- AE-B .. AE-F. The write boundary.
-- =====================================================================================================
do $$
declare
  v_dir uuid; v_club uuid; v_team uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
  v_ca uuid; v_unknown uuid; v_adult uuid; v_minor uuid; v_sa uuid;
  v_ms_unknown uuid; v_ms_adult uuid; v_ms_minor uuid; v_ca_ms uuid;
  v_role text; v_state text; v_assignment uuid; v_n int; v_ok boolean;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Age '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','age-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'age-'||v_tag,'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','age-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team;

  v_ca      := pg_temp.person('CA',      (current_date - interval '40 years')::date);
  v_adult   := pg_temp.person('ADULT',   (current_date - interval '30 years')::date);
  v_unknown := pg_temp.person('UNKNOWN', null);
  v_minor   := pg_temp.person('MINOR',   (current_date - interval '14 years')::date);
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_ca,'CLUB_ADMIN','active') returning id into v_ca_ms;
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_adult,'BASIC_USER','active') returning id into v_ms_adult;
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_unknown,'BASIC_USER','active') returning id into v_ms_unknown;
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_minor,'BASIC_USER','active') returning id into v_ms_minor;
  v_sa := pg_temp.person('SA', (current_date - interval '45 years')::date);
  insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');

  -- ---------------------------------------------------------------------------------------------
  -- AE-B  every minor-prohibited role, derived from the canonical catalogue rather than a list
  -- ---------------------------------------------------------------------------------------------
  -- SAFEGUARDING_OFFICER is appointed through nomination (AE-F) and TEAM_ADMINISTRATION rests on a
  -- base Coach or Team Manager assignment, so both are exercised through their own path.
  v_ok := true;
  for v_role in select role_key from public.role_definitions
                 where minor_prohibited and role_key not in ('SAFEGUARDING_OFFICER','TEAM_ADMINISTRATION') order by 1
  loop
    if pg_temp.try(format('select internal.grant_role(%L,%L,%L,''CLUB_ADMIN_ASSIGNMENT'',''matrix'')',
         v_ms_unknown, v_role, case when v_role in ('COACH','TEAM_MANAGER') then v_team::text else null end)) <> '23514' then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'AE-B1 an identity with no recorded date of birth is refused EVERY minor-prohibited role the catalogue names');
  perform pg_temp.check(
    (select count(*) from public.role_definitions where minor_prohibited) = 7,
    'AE-B2 and the catalogue still marks seven roles minor-prohibited, so AE-B1 is not asserting about an empty set');

  v_ok := true;
  for v_role in select role_key from public.role_definitions
                 where minor_prohibited and role_key not in ('SAFEGUARDING_OFFICER','TEAM_ADMINISTRATION') order by 1
  loop
    if pg_temp.try(format('select internal.grant_role(%L,%L,%L,''CLUB_ADMIN_ASSIGNMENT'',''matrix'')',
         v_ms_adult, v_role, case when v_role in ('COACH','TEAM_MANAGER') then v_team::text else null end)) <> 'OK' then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'AE-B3 while an identity whose recorded date of birth establishes adulthood is granted every one of them -- so AE-B1 is the age rule, not a broken fixture');

  perform pg_temp.check(
    pg_temp.try(format('select internal.grant_role(%L,''BASIC_USER'',null,''CLUB_ADMIN_ASSIGNMENT'',''matrix'')', v_ms_unknown)) <> '23514',
    'AE-B4 and a role the catalogue does NOT mark minor-prohibited is unaffected -- unknown age is not a general disability');

  -- ---------------------------------------------------------------------------------------------
  -- AE-C  grandfathering: continuation of authority already held is NOT a new crossing
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    pg_temp.try(format('select internal.grant_role(%L,''TEAM_MANAGER'',%L,''SEASON_HANDOVER'',''carried forward'')', v_ms_unknown, v_team)) = 'OK',
    'AE-C1 SEASON_HANDOVER carries an existing unknown-age member onto next season''s team -- refusing would revoke authority a club already relies on');
  perform pg_temp.check(
    pg_temp.try(format('select internal.grant_role(%L,''VOLUNTEER'',null,''LEGACY_BACKFILL'',''reconstructed'')', v_ms_unknown)) = 'OK',
    'AE-C2 and LEGACY_BACKFILL reconstructs what already existed');
  perform pg_temp.check(
    pg_temp.try(format('select internal.grant_role(%L,''COACH'',%L,''INVITATION'',''new crossing'')', v_ms_unknown, v_team)) = '23514',
    'AE-C3 while the same person through INVITATION is refused -- the distinction is acquisition versus continuation, not the role');

  -- ---------------------------------------------------------------------------------------------
  -- AE-D  the resolver is NOT gated: existing authority survives
  -- ---------------------------------------------------------------------------------------------
  select id into v_assignment from public.role_assignments
   where membership_id = v_ms_unknown and role_key = 'TEAM_MANAGER' and state = 'ACTIVE' limit 1;
  perform pg_temp.check(v_assignment is not null,
    'AE-D1 the unknown-age member really does hold an ACTIVE Team Manager assignment (granted by handover above)');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_unknown, 'role','authenticated')::text, true);
  perform pg_temp.check(
    internal.can('team.roster.manage', 'team', v_club, v_team, null),
    'AE-D2 and it still RESOLVES -- D-S5-1 gates the write boundary, never the resolver, so no existing holder is stripped');
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='capability_decision') !~ 'person_is_established_adult',
    'AE-D3 structurally: the capability resolver does not mention the eligibility predicate at all');

  -- Restoring a suspended assignment is continuation too. Both halves run as the Club Admin, because
  -- transitioning a role is an authorised act and needs a session behind it.
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select public.transition_role_assignment(%L,''SUSPENDED'',''matrix: pause'')', v_assignment)) = 'OK',
    'AE-D4a the Club Admin can pause the unknown-age holder''s role');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select public.transition_role_assignment(%L,''ACTIVE'',''matrix: restore'')', v_assignment)) = 'OK',
    'AE-D4 and a suspended role can still be restored for an unknown-age holder -- otherwise a pause would become a permanent revocation');
  perform set_config('request.jwt.claims','',true);

  -- ---------------------------------------------------------------------------------------------
  -- AE-E  capability overrides, the other way to acquire minor-prohibited authority
  -- ---------------------------------------------------------------------------------------------
  -- A Club Admin cannot override a minor-prohibited key at all -- the delegation ceiling refuses
  -- every one of them (design line 1304), so the eligibility gate is defence in depth there and the
  -- operative test is the actor who CAN: a Full Site Admin.
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select public.set_capability_override(%L,''team.roster.manage'',''club'',%L,null,''grant'',''matrix'')', v_unknown, v_club)) = '42501',
    'AE-E0 a Club Admin cannot override a minor-prohibited key whatever the age -- the delegation ceiling forbids it');
  perform pg_temp.check(
    pg_temp.try_as(v_sa, format('select public.set_capability_override(%L,''team.roster.manage'',''club'',%L,null,''grant'',''matrix'')', v_unknown, v_club)) = '23514',
    'AE-E1 a minor-prohibited capability cannot be GRANTED by override to an unknown-age identity');
  perform pg_temp.check(
    pg_temp.try_as(v_sa, format('select public.set_capability_override(%L,''team.roster.manage'',''club'',%L,null,''deny'',''matrix'')', v_unknown, v_club)) = 'OK',
    'AE-E2 while DENYING one is always allowed -- the gate withholds authority, it never blocks withholding it');
  perform pg_temp.check(
    (select count(*) from public.capabilities where minor_prohibited) > 200,
    'AE-E3 and the catalogue marks over two hundred capabilities minor-prohibited, so AE-E1 covers a real surface');
  perform set_config('request.jwt.claims','',true);

  -- ---------------------------------------------------------------------------------------------
  -- AE-F  the Safeguarding Officer path: the age gate and AN-6 are INDEPENDENT (D-S5-1 Q1)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''matrix'')', v_club, v_unknown)) = '23514',
    'AE-F1 an unknown-age identity cannot even be NOMINATED as Safeguarding Officer');
  perform set_config('request.jwt.claims','',true);

  -- ---------------------------------------------------------------------------------------------
  -- AE-G  the population Slice 5 must surface rather than revoke
  -- ---------------------------------------------------------------------------------------------
  select count(*) into v_n from public.role_assignments ra
   join public.role_definitions rd on rd.role_key = ra.role_key
   where ra.state = 'ACTIVE' and rd.minor_prohibited
     and not internal.person_is_established_adult(ra.user_id);
  perform pg_temp.check(v_n >= 1,
    'AE-G1 the NEEDS_ATTENTION population is computable: holders of minor-prohibited roles whose age is not established');
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
      where ra.state = 'ACTIVE' and rd.minor_prohibited and ra.user_id = v_unknown) >= 1,
    'AE-G2 and they keep their roles -- identified for review, never revoked by Slice 5 (D-S5-1)');
end $$;

-- =====================================================================================================
-- AE-H. Structural: the decision's own prohibitions.
-- =====================================================================================================
do $$
begin
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='person_is_minor') ~ 'interval ''18 years''',
    'AE-H1 internal.person_is_minor is NOT redefined -- D-S4-4 reads it for account-picture visibility');
  perform pg_temp.check(
    not exists (select 1 from information_schema.tables where table_schema='public'
                 and table_name ~ 'age_(verification|eligibility)|eligibility_state'),
    'AE-H2 and no eligibility-state table was created -- the decision says a predicate, not a table');
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='person_is_established_adult') ~ 'person_is_minor',
    'AE-H3 the predicate reuses the existing age arithmetic rather than restating the boundary');
  perform pg_temp.check(
    not has_function_privilege('anon','internal.person_is_established_adult(uuid)','EXECUTE'),
    'AE-H4 and a signed-out visitor cannot ask whether somebody is an adult');
end $$;

rollback;
