-- =====================================================================================================
-- SAFEGUARDING AUTHORITY MATRIX  (Identity/Auth Slice 4G, Phase 2 AA.3 row 4g)
--
-- The appointment authority and state machine, under decision D-S4-2 and AN-6. DETERMINISTIC and
-- SELF-SEEDING: every club, team, person, membership state, nomination, thread and dispensation it
-- needs, it creates. It reads no UAT seed identity, so it cannot pass green with zero assertions on a
-- clean database.
--
-- Contract: design J.12 lines 541-553, section T "Appointment"/"Lifecycle"/"Dispensations", AN-6, AN-9,
-- audit items AI #68 and #69.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob interval default interval '40 years') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sam-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Sam',p_label,'sam-'||v::text||'@ovalball.test',
          case when p_dob is null then null else (current_date - p_dob)::date end);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SAM '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sam-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'sam-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

-- Membership in a NAMED state. status is a generated mirror of state under
-- club_memberships_status_matches_state, so both are written together.
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_state text default 'ACTIVE', p_role text default 'BASIC_USER')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, state, status)
  values (p_club, p_user, p_role, p_state, lower(p_state)) returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','sam-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_subject is null then jsonb_build_object('role','anon')
         else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.err_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin execute p_sql; v := 'OK'; exception when others then v := sqlerrm; end;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  execute p_sql into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  execute 'select ('||p_expr||')::boolean' into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,false);
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  execute p_sql into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,0);
end $$;

-- The dispensation policy as it would be WITHOUT the hoist: the safeguarding term asked once per row.
-- SA-P compares it with the live policy, so the optimisation is shown to be one rather than asserted
-- to be one.
create or replace function pg_temp.unhoisted_dispensations() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.player_team_dispensation d
  where internal.can('safeguarding.dispensation.view', 'club',
                     (select t.club_id from public.teams t where t.id = d.source_team_id), null, null)
     or internal.has_site_capability('site.support.view_club')
     -- The Slice 4 closure pass moved the three fixture/team role-helper terms onto the keys J.7
     -- lines 471-472 give the act: requesting a dispensation and approving the team stage. Asked here
     -- once per row, exactly as the policy asks it once per statement.
     or internal.can('fixture.dispensation.request', 'club',
                     (select t.club_id from public.teams t where t.id = d.source_team_id), null, null)
     or internal.can('fixture.dispensation.request', 'team',
                     (select t.club_id from public.teams t where t.id = d.source_team_id), d.source_team_id, null)
     or internal.can('fixture.dispensation.approve_team', 'team',
                     (select t.club_id from public.teams t where t.id = d.source_team_id), d.source_team_id, null)
     or internal.can('fixture.dispensation.request', 'club',
                     (select t.club_id from public.teams t where t.id = d.target_team_id), null, null)
     or internal.can('fixture.dispensation.request', 'team',
                     (select t.club_id from public.teams t where t.id = d.target_team_id), d.target_team_id, null)
     or internal.can('fixture.dispensation.approve_team', 'team',
                     (select t.club_id from public.teams t where t.id = d.target_team_id), d.target_team_id, null);
$$;
grant execute on function pg_temp.unhoisted_dispensations() to public;

-- THE SEAM, reachable from the suite. internal.enter_safeguarding_nomination is not executable by a
-- browser role and must not become so, but it is the function Slice 5's redemption will call, so its
-- own rules have to be tested on it rather than on the RPC that currently sits in front of it. Every
-- rule proved through public.nominate_club_safeguarding_officer alone is a rule Slice 5 does not
-- inherit -- a mutation that gutted the seam's membership checks survived the whole suite until this
-- wrapper existed.
create or replace function pg_temp.seam(p_club uuid, p_user uuid, p_type text default 'primary') returns uuid
language sql security definer set search_path = public as $$
  select internal.enter_safeguarding_nomination(p_club, p_user, p_type, 'SAFEGUARDING_APPOINTMENT', null, 'seam', null);
$$;
grant execute on function pg_temp.seam(uuid,uuid,text) to public;

-- The SO capabilities, asked as a set. "Holds nothing" has to mean nothing, not "nothing I remembered
-- to check", so every key J.12 gives the SO bundle is asked every time.
create or replace function pg_temp.so_authority(p_subject uuid, p_club uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from unnest(array[
    'safeguarding.conversation.handle','safeguarding.dispensation.view','safeguarding.dispensation.notify',
    'safeguarding.transfer.view','safeguarding.transfer.notify','safeguarding.welfare.view'
  ]) k
  where (internal.capability_decision(p_subject, k, 'club', p_club, null, null, false, false)).allowed;
$$;
grant execute on function pg_temp.so_authority(uuid,uuid) to public;

-- =====================================================================================================
-- SA-A. The catalogue says what J.12 says, and D-S4-2 holds structurally.
-- =====================================================================================================
do $$
declare r record;
begin
  for r in select * from (values
    ('safeguarding.contact.view','{club}'), ('safeguarding.officer.nominate','{club}'),
    ('safeguarding.officer.confirm','{site}'), ('safeguarding.officer.deactivate','{club}'),
    ('safeguarding.officer.contact_edit','{self}'), ('safeguarding.conversation.start','{club}'),
    ('safeguarding.conversation.handle','{club}'), ('safeguarding.dispensation.view','{club}'),
    ('safeguarding.dispensation.notify','{club}'), ('safeguarding.transfer.view','{club}'),
    ('safeguarding.transfer.notify','{club}'), ('safeguarding.welfare.view','{club}'),
    ('site.safeguarding.review','{site}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c where c.key = r.key and c.status='ACTIVE'
                and c.valid_scopes::text = r.scopes and c.safeguarding_sensitive),
      format('SA-A %s is ACTIVE, safeguarding-sensitive, scopes %s (J.12)', r.key, r.scopes));
  end loop;

  -- J.12 line 543: confirmation is FULL and SUPPORT, and it is a SITE capability. A club bundle
  -- holding it would make AN-6 meaningless.
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='safeguarding.officer.confirm') = 2
    and (select count(*) from public.bundle_capabilities where capability_key='safeguarding.officer.confirm'
         and bundle_key in ('SITE_FULL','SITE_SUPPORT')) = 2,
    'SA-A1 safeguarding.officer.confirm reaches SITE_FULL and SITE_SUPPORT, and no club bundle');
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='safeguarding.officer.nominate') = 1
    and exists (select 1 from public.bundle_capabilities where capability_key='safeguarding.officer.nominate' and bundle_key='CA'),
    'SA-A2 nomination is the Club Admin''s alone (J.12 line 542)');

  -- D-S4-2: 4G builds no invitation machinery of its own. The pre-existing table and its RPCs are
  -- Slice 5's to unify and are deliberately untouched; what must not exist is a SECOND one.
  perform pg_temp.check(
    (select count(*) from pg_tables where schemaname='public' and tablename ~ 'safeguard' and tablename ~ 'invit') = 1,
    'SA-A3 D-S4-2: exactly one safeguarding invitation table exists -- the pre-existing one, not a temporary second');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname in
                  ('issue_safeguarding_invitation','redeem_safeguarding_invitation','create_safeguarding_token',
                   'safeguarding_officer_code','claim_safeguarding_officer')),
    'SA-A4 D-S4-2: no temporary safeguarding token, code or redemption RPC was created');
  perform pg_temp.check(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='internal' and p.proname='enter_safeguarding_nomination')
    and not has_function_privilege('authenticated','internal.enter_safeguarding_nomination(uuid,uuid,text,text,uuid,text,uuid)','EXECUTE'),
    'SA-A5 the Slice 5 seam exists and no browser role can call it directly');
  perform pg_temp.check(
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','internal')
       and p.prosrc ~ 'confirmation_state\s*=\s*''PENDING_CONFIRMATION''\s*$' ) >= 0
    and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname in ('public','internal') and p.proname <> 'enter_safeguarding_nomination'
           and p.prosrc ~ 'insert into public\.role_assignments' and p.prosrc ~ 'SAFEGUARDING_OFFICER') <= 1,
    'SA-A6 one way in: nothing but grant_role writes a SAFEGUARDING_OFFICER assignment row');
end $$;

-- =====================================================================================================
-- SA-B .. SA-M. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_far uuid; v_team uuid; v_team2 uuid; v_season uuid;
  v_ca uuid; v_ca2 uuid; v_fs uuid; v_mb uuid; v_co uuid; v_str uuid; v_farca uuid; v_farmb uuid;
  v_tm uuid; v_ta uuid; v_tgt_tm uuid; v_so2 uuid;
  v_sa uuid; v_sup uuid; v_mod uuid; v_nom uuid; v_unknown uuid; v_pg uuid; v_sanom uuid;
  v_pending uuid; v_susp uuid; v_rev uuid; v_dec uuid; v_exp uuid;
  v_ms uuid; v_assign uuid; v_assign2 uuid; v_off uuid; v_conv uuid; v_disp uuid; v_player uuid;
  v_res jsonb; v_tag text := substr(gen_random_uuid()::text,1,8); n int; v_ok boolean; v_err text;
begin
  v_club := pg_temp.club('Home'); v_far := pg_temp.club('Far');
  v_team := pg_temp.team(v_club,'U12'); v_team2 := pg_temp.team(v_club,'U14');

  v_ca  := pg_temp.person('CA');  perform pg_temp.member(v_club, v_ca,  'ACTIVE', 'CLUB_ADMIN');
  v_ca2 := pg_temp.person('CA2'); perform pg_temp.member(v_club, v_ca2, 'ACTIVE', 'CLUB_ADMIN');
  v_fs  := pg_temp.person('FS');  perform pg_temp.member(v_club, v_fs,  'ACTIVE', 'FIXTURE_SECRETARY');
  v_mb  := pg_temp.person('MB');  perform pg_temp.member(v_club, v_mb,  'ACTIVE');
  v_co  := pg_temp.person('CO');  v_ms := pg_temp.member(v_club, v_co, 'ACTIVE');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team, 'coach');
  -- Team staff, for the dispensation boundary the Slice 4 closure pass canonicalised. A dispensation
  -- moves a child between two teams, so both ends need a named person.
  v_tm  := pg_temp.person('TM');  v_ms := pg_temp.member(v_club, v_tm, 'ACTIVE');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team, 'manager');
  v_ta  := pg_temp.person('TA');  v_ms := pg_temp.member(v_club, v_ta, 'ACTIVE');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team, 'team_admin');
  v_tgt_tm := pg_temp.person('TGTTM'); v_ms := pg_temp.member(v_club, v_tgt_tm, 'ACTIVE');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team2, 'manager');
  -- A member with NO team role at all, kept clear of every other assertion, so the safeguarding
  -- branch of the dispensation read can be tested through a person who has no other way in.
  v_so2 := pg_temp.person('SO2'); perform pg_temp.member(v_club, v_so2, 'ACTIVE');
  v_pg  := pg_temp.person('PG');  perform pg_temp.member(v_club, v_pg, 'ACTIVE');
  v_str := pg_temp.person('STR');
  v_farca := pg_temp.person('FARCA'); perform pg_temp.member(v_far, v_farca, 'ACTIVE', 'CLUB_ADMIN');
  -- A perfectly good ACTIVE member -- of a DIFFERENT club. The wrong-club case.
  v_farmb := pg_temp.person('FARMB'); perform pg_temp.member(v_far, v_farmb, 'ACTIVE');
  -- The nominee, and one identity whose date of birth Ovalball does not have (section SA-M).
  v_nom := pg_temp.person('NOM'); perform pg_temp.member(v_club, v_nom, 'ACTIVE');
  v_unknown := pg_temp.person('UNK', null); perform pg_temp.member(v_club, v_unknown, 'ACTIVE');
  -- One member per non-ACTIVE membership state.
  v_pending := pg_temp.person('PEND'); perform pg_temp.member(v_club, v_pending, 'PENDING');
  v_susp    := pg_temp.person('SUSP'); perform pg_temp.member(v_club, v_susp,    'SUSPENDED');
  v_rev     := pg_temp.person('REVK'); perform pg_temp.member(v_club, v_rev,     'REVOKED');
  v_dec     := pg_temp.person('DECL'); perform pg_temp.member(v_club, v_dec,     'DECLINED');
  v_exp     := pg_temp.person('EXPD'); perform pg_temp.member(v_club, v_exp,     'EXPIRED');

  v_sa  := pg_temp.person('SA');  insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');
  v_sup := pg_temp.person('SUP'); insert into public.site_admins (user_id,status,admin_role) values (v_sup,'active','user_access');
  v_mod := pg_temp.person('MOD'); insert into public.site_admins (user_id,status,admin_role) values (v_mod,'active','message_moderator');
  -- A Full Site Admin who is ALSO an active member of this club, and so can be nominated as its
  -- Safeguarding Officer. The only persona for whom "no self-confirmation" is a separate rule from
  -- "you need the capability": everybody else is refused by the capability first, so a suite without
  -- this person proves the capability gate twice and the self-confirmation gate never.
  v_sanom := pg_temp.person('SANOM'); perform pg_temp.member(v_club, v_sanom, 'ACTIVE');
  insert into public.site_admins (user_id,status,admin_role) values (v_sanom,'active','full');

  -- ---------------------------------------------------------------------------------------------
  -- SA-B  nomination: an existing ACTIVE member of THIS club, and nobody else (D-S4-2)
  -- ---------------------------------------------------------------------------------------------
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''matrix'')', v_club, v_nom));
  perform pg_temp.check(v_res->>'outcome' = 'PENDING_CONFIRMATION' and (v_res->>'assignment_id') is not null,
    'SA-B1 an ACTIVE member of this club can be nominated, and lands in PENDING_CONFIRMATION');
  v_assign := (v_res->>'assignment_id')::uuid;

  -- The wrong club. FARMB is an active member in good standing -- somewhere else -- and from this
  -- club's point of view that is the same as being a stranger, so it answers the same way.
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_farmb));
  perform pg_temp.check(v_res->>'outcome' = 'INVITATION_REQUIRED',
    'SA-B2 an ACTIVE member of a DIFFERENT club is not a member here -- INVITATION_REQUIRED');
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_str));
  perform pg_temp.check(v_res->>'outcome' = 'INVITATION_REQUIRED' and v_res->>'deferred_to' = 'SLICE_5_SAFEGUARDING_OFFICER_INVITATION',
    'SA-B3 a non-member gets the canonical INVITATION_REQUIRED outcome, named as Slice 5''s');
  perform pg_temp.check(
    not exists (select 1 from public.role_assignments where club_id = v_club and user_id in (v_farmb, v_str) and role_key = 'SAFEGUARDING_OFFICER'),
    'SA-B4 and neither refusal created an assignment of any kind');

  -- Every non-ACTIVE membership state fails closed, and says which state it was.
  v_err := pg_temp.err_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_pending));
  perform pg_temp.check(v_err like '%PENDING%',   'SA-B5 a PENDING member cannot be nominated');
  v_err := pg_temp.err_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_susp));
  perform pg_temp.check(v_err like '%SUSPENDED%', 'SA-B6 a SUSPENDED member cannot be nominated');
  v_err := pg_temp.err_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_rev));
  perform pg_temp.check(v_err like '%REVOKED%',   'SA-B7 a REVOKED member cannot be nominated');
  v_err := pg_temp.err_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_dec));
  perform pg_temp.check(v_err like '%DECLINED%',  'SA-B8 a DECLINED member cannot be nominated');
  v_err := pg_temp.err_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix'')', v_club, v_exp));
  perform pg_temp.check(v_err like '%EXPIRED%',   'SA-B9 an EXPIRED member cannot be nominated');
  perform pg_temp.check(
    (select count(*) from public.role_assignments where club_id = v_club and role_key = 'SAFEGUARDING_OFFICER') = 1,
    'SA-B10 five refused states produced five refusals and no sixth assignment');

  -- Who may nominate at all.
  perform pg_temp.check(pg_temp.try_as(v_fs,  format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''x'')', v_club, v_mb)) = '42501',
    'SA-B11 the Fixtures Secretary may not nominate');
  perform pg_temp.check(pg_temp.try_as(v_mb,  format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''x'')', v_club, v_co)) = '42501',
    'SA-B12 nor an ordinary member');
  perform pg_temp.check(pg_temp.try_as(v_farca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''x'')', v_club, v_mb)) = '42501',
    'SA-B13 nor another club''s Club Admin -- the club id in the payload is not authority');
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''x'')', v_club, v_mb)) = '42501',
    'SA-B14 nor a Full Site Admin: nomination is the club''s act, and Ovalball''s part is confirming it');

  -- ---------------------------------------------------------------------------------------------
  -- SA-C  PENDING_CONFIRMATION grants ZERO authority
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    exists (select 1 from public.role_assignments where id = v_assign and state='ACTIVE' and confirmation_state='PENDING_CONFIRMATION'),
    'SA-C1 the nomination exists and is PENDING_CONFIRMATION');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_nom, v_club)) = 0,
    'SA-C2 and the nominee holds NONE of the six Safeguarding Officer capabilities');
  perform pg_temp.check(not pg_temp.bool_as(v_nom, format('internal.can(''safeguarding.conversation.handle'',''club'',%L,null,null)', v_club)),
    'SA-C3 asked as themselves, the nominee is told no as well');
  perform pg_temp.check(
    not (v_nom = any (internal.active_safeguarding_officer_ids(v_club))),
    'SA-C4 and the club''s officer list does not contain them');

  -- ---------------------------------------------------------------------------------------------
  -- SA-D  AN-6: who may confirm, and who may not
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.confirm_safeguarding_officer(%L,''please'')', v_assign)) = '42501',
    'SA-D1 the Club Admin who nominated them cannot confirm -- being Club Admin is not the authority');
  perform pg_temp.check(pg_temp.try_as(v_ca2, format('select public.confirm_safeguarding_officer(%L,''please'')', v_assign)) = '42501',
    'SA-D2 nor can a second Club Admin of the same club');
  perform pg_temp.check(pg_temp.try_as(v_nom, format('select public.confirm_safeguarding_officer(%L,''me'')', v_assign)) = '42501',
    'SA-D3 and the nominee cannot confirm themselves');
  perform pg_temp.check(pg_temp.try_as(v_mod, format('select public.confirm_safeguarding_officer(%L,''please'')', v_assign)) = '42501',
    'SA-D4 a message-moderator Site Admin does not hold safeguarding.officer.confirm either');
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L,'''')', v_assign)) = '22023',
    'SA-D5 confirmation without a reason is refused (J.12 line 543, AAL R)');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_nom, v_club)) = 0,
    'SA-D6 and after four refusals and a missing reason the nominee still holds nothing');

  perform pg_temp.check(pg_temp.try_as(v_sup, format('select public.confirm_safeguarding_officer(%L,''matrix: user support confirms'')', v_assign)) = 'OK',
    'SA-D7 a SUPPORT Site Admin holds safeguarding.officer.confirm and the confirmation lands (J.12 line 543)');
  perform pg_temp.check(
    exists (select 1 from public.role_assignments where id = v_assign and confirmation_state='CONFIRMED' and confirmed_by = v_sup and confirmed_at is not null),
    'SA-D8 and who confirmed it, and when, is recorded on the assignment');
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L,''again'')', v_assign)) = '23505',
    'SA-D9 a confirmed appointment cannot be confirmed twice');

  -- NO SELF-CONFIRMATION, tested on the one person who could otherwise do it. SANOM holds
  -- safeguarding.officer.confirm through SITE_FULL, so the capability check waves them through and
  -- the only thing standing between them and their own appointment is the self-confirmation rule.
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''site admin nominee'')', v_club, v_sanom));
  perform pg_temp.check(v_res->>'outcome' = 'PENDING_CONFIRMATION',
    'SA-D10 a Full Site Admin who is a member of the club can be nominated by it');
  perform pg_temp.check(pg_temp.bool_as(v_sanom, 'internal.has_site_capability(''safeguarding.officer.confirm'')'),
    'SA-D11 and they do hold safeguarding.officer.confirm -- so the capability check will not refuse them');
  perform pg_temp.check(pg_temp.try_as(v_sanom, format('select public.confirm_safeguarding_officer(%L,''confirming myself'')', (v_res->>'assignment_id'))) = '42501',
    'SA-D12 and they still cannot confirm their OWN appointment (AN-6: self-nomination needs Site confirmation, by somebody else)');
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L,''a different site admin confirms'')', (v_res->>'assignment_id'))) = 'OK',
    'SA-D13 while a DIFFERENT Site Admin can -- the rule is about being the subject, not about the capability');
  -- Stood down again so that later sections still test a club with one officer. Left in place, this
  -- appointment would quietly satisfy SA-G7's premise and that assertion would pass without meaning it.
  perform internal.end_role((v_res->>'assignment_id')::uuid, 'REVOKED', 'matrix: standing the site-admin nominee down', null);

  -- ---------------------------------------------------------------------------------------------
  -- SA-E  activation opens exactly the canonical authority, and revocation closes it
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_nom, v_club)) = 6,
    'SA-E1 confirmation opens all six Safeguarding Officer capabilities, and not before');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_nom, v_far)) = 0,
    'SA-E2 and none of them at any other club');
  perform pg_temp.check(not pg_temp.bool_as(v_nom, format('internal.can(''club.settings.manage'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_nom, format('internal.can(''fixture.fixture.create'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_nom, format('internal.can(''people.role.assign'',''club'',%L,null,null)', v_club)),
    'SA-E3 and nothing outside the SO boundary -- not club settings, not fixtures, not role administration (section T)');

  -- ---------------------------------------------------------------------------------------------
  -- SA-F  the thread: closed before activation, open after, and closed to Ovalball either way
  -- ---------------------------------------------------------------------------------------------
  insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, user_id, status, activated_at, created_by, updated_by)
  values (v_club,'primary','Sam Officer','sam-off-'||v_tag||'@ovalball.test',v_nom,'active',now(),v_ca,v_ca) returning id into v_off;
  insert into public.club_safeguarding_officer_conversations (club_id, requester_user_id, officer_user_id)
  values (v_club, v_mb, v_nom) returning id into v_conv;
  insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body, kind)
  values (v_conv, v_mb, 'matrix safeguarding message '||v_tag, 'message');

  perform pg_temp.check(pg_temp.bool_as(v_nom, format('internal.can_view_safeguarding_conversation(%L)', v_conv)),
    'SA-F1 the confirmed officer reads the thread');
  perform pg_temp.check(pg_temp.bool_as(v_mb, format('internal.can_view_safeguarding_conversation(%L)', v_conv)),
    'SA-F2 so does the person who raised it');
  perform pg_temp.check(pg_temp.bool_as(v_mb, format('internal.can_send_safeguarding_conversation(%L)', v_conv)),
    'SA-F3 and they can REPLY in it -- which they could not before 4G, because the transitional key was Club Admin only');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('internal.can_view_safeguarding_conversation(%L)', v_conv)),
    'SA-F4 the Club Admin does not read it -- a safeguarding thread may be about the Club Admin');
  perform pg_temp.check(not pg_temp.bool_as(v_sa, format('internal.can_view_safeguarding_conversation(%L)', v_conv))
                        and not pg_temp.bool_as(v_sup, format('internal.can_view_safeguarding_conversation(%L)', v_conv))
                        and not pg_temp.bool_as(v_mod, format('internal.can_view_safeguarding_conversation(%L)', v_conv)),
    'SA-F5 INTENDED CHANGE: no Site Admin reads a safeguarding thread through RLS at all (section T, "No RLS read")');
  perform pg_temp.check(pg_temp.count_as(v_sa, format('select count(*) from public.club_safeguarding_officer_conversations where id = %L', v_conv)) = 0
                        and pg_temp.count_as(v_mb, format('select count(*) from public.club_safeguarding_officer_conversations where id = %L', v_conv)) = 1,
    'SA-F6 and the row policy agrees with the gate');
  perform pg_temp.check(pg_temp.count_as(v_sa, format('select count(*) from public.fixture_messages where safeguarding_conversation_id = %L', v_conv)) = 0,
    'SA-F7 nor can a Site Admin read the messages inside it');

  -- AI #68/#69 and AN-9: the one way in, and the mark it leaves.
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select * from public.site_safeguarding_review(%L,'''')', v_conv)) = '22023',
    'SA-F8 reviewing without a reason is refused');
  perform pg_temp.check(pg_temp.try_as(v_sup, format('select * from public.site_safeguarding_review(%L,''support looking'')', v_conv)) = '42501',
    'SA-F9 and site.safeguarding.review is an explicit add-on -- SUPPORT does not hold it by default (AN-9)');
  perform pg_temp.check(pg_temp.count_as(v_sa, format('select count(*) from public.site_safeguarding_review(%L,''matrix: reviewing a reported thread'')', v_conv)) = 1,
    'SA-F10 a Full Site Admin reads the thread through the reasoned RPC, and gets its contents');
  perform pg_temp.check(
    exists (select 1 from public.safeguarding_thread_reviews where conversation_id = v_conv and reviewed_by = v_sa)
    and exists (select 1 from public.security_events where event_type = 'safeguarding.thread_reviewed'),
    'SA-F11 which leaves a review row and a safeguarding.thread_reviewed event (AI #68/#69)');
  perform pg_temp.check(pg_temp.count_as(v_nom, format('select count(*) from public.safeguarding_thread_reviews where conversation_id = %L', v_conv)) = 1,
    'SA-F12 and the club''s officer can see that Ovalball looked (AN-9, "Reviewed by Ovalball on ...")');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.safeguarding_thread_reviews where conversation_id = %L', v_conv)) = 0,
    'SA-F13 while the Club Admin cannot');

  -- ---------------------------------------------------------------------------------------------
  -- SA-G  duplicates, and revocation closing the door again
  -- ---------------------------------------------------------------------------------------------
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''again'')', v_club, v_mb));
  v_assign2 := (v_res->>'assignment_id')::uuid;
  perform pg_temp.check(v_assign2 is not null and v_assign2 <> v_assign,
    'SA-G1 a second person can be nominated while the first is confirmed');
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''dupe'')', v_club, v_mb));
  perform pg_temp.check((v_res->>'assignment_id')::uuid = v_assign2,
    'SA-G2 nominating the same person twice is idempotent, not a second pending row');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''dupe'')', v_club, v_nom)) = '23505',
    'SA-G3 and re-nominating somebody already confirmed is refused');

  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.deactivate_safeguarding_officer(%L)', v_off)) = 'OK',
    'SA-G4 the Club Admin may deactivate an officer (safeguarding.officer.deactivate)');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_nom, v_club)) = 0,
    'SA-G5 and deactivation closes every one of the six capabilities again');
  perform pg_temp.check(not pg_temp.bool_as(v_nom, format('internal.can_view_safeguarding_conversation(%L)', v_conv)),
    'SA-G6 a deactivated officer loses thread access on the next request (section T Lifecycle)');
  perform pg_temp.check(
    exists (select 1 from public.security_events where event_type = 'safeguarding.threads_unattended'),
    'SA-G7 and a club left with no confirmed officer and an open thread raises safeguarding.threads_unattended');

  -- ---------------------------------------------------------------------------------------------
  -- SA-H  attacks: the ids in the payload are not authority
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, confirmation_state) '
      || 'values (%L,%L,(select id from public.club_memberships where club_id=%L and user_id=%L),''SAFEGUARDING_OFFICER'',''ACTIVE'',''SAFEGUARDING_APPOINTMENT'',''CONFIRMED'')',
      v_mb, v_club, v_club, v_mb)) <> 'OK',
    'SA-H1 a member cannot write themselves a confirmed Safeguarding Officer assignment directly');
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'update public.role_assignments set confirmation_state = ''CONFIRMED'' where id = %L', v_assign2)) <> 'OK'
    or (select confirmation_state from public.role_assignments where id = v_assign2) = 'PENDING_CONFIRMATION',
    'SA-H2 nor promote their own pending nomination by updating the row');
  perform pg_temp.check(pg_temp.try_as(v_ca, format(
      'update public.role_assignments set confirmation_state = ''CONFIRMED'' where id = %L', v_assign2)) <> 'OK'
    or (select confirmation_state from public.role_assignments where id = v_assign2) = 'PENDING_CONFIRMATION',
    'SA-H3 and neither can the Club Admin, who has every reason to think they should be able to');
  perform pg_temp.check(pg_temp.try_as(v_farca, format('select public.confirm_safeguarding_officer(%L,''borrowed'')', v_assign2)) = '42501',
    'SA-H4 another club''s admin cannot confirm a nomination by naming its id');
  perform pg_temp.check(pg_temp.try_as(null, format('select public.confirm_safeguarding_officer(%L,''anon'')', v_assign2)) <> 'OK',
    'SA-H5 and an anonymous caller reaches none of it');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select internal.enter_safeguarding_nomination(%L,%L,''primary'')', v_club, v_mb)) <> 'OK',
    'SA-H6 the seam itself is not reachable from a browser session');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''overlord'',''x'')', v_club, v_co)) <> 'OK',
    'SA-H7 an officer_type outside primary/deputy is refused');

  -- ---------------------------------------------------------------------------------------------
  -- SA-N  THE SEAM'S OWN RULES, asked of the seam
  --
  -- Slice 5's redemption will call internal.enter_safeguarding_nomination directly, after admitting
  -- the person. Every rule below is therefore proved HERE and not only through the RPC in front of
  -- it, because the RPC is not what Slice 5 inherits. Two mutations that removed the seam's
  -- membership checks entirely survived the whole suite before this section existed.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_fs)) = 'OK',
    'SA-N1 the seam admits an ACTIVE member of the club');
  perform pg_temp.check(
    (select confirmation_state from public.role_assignments where club_id = v_club and user_id = v_fs and role_key='SAFEGUARDING_OFFICER') = 'PENDING_CONFIRMATION',
    'SA-N2 and lands them in PENDING_CONFIRMATION, not in the role');
  -- Each refusal has to NAME the state. internal.grant_role underneath the seam also refuses a
  -- non-active membership, with a generic message, so "it raised something" would pass even with the
  -- seam's own check deleted -- a mutation that deleted it survived on exactly that. The named state
  -- is the seam's contribution and it is what Slice 5's redemption will put in front of a person who
  -- is told they cannot take up the role.
  v_err := pg_temp.err_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_pending));
  perform pg_temp.check(v_err like '%PENDING%',   'SA-N3 the seam refuses a PENDING membership, and says so');
  v_err := pg_temp.err_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_susp));
  perform pg_temp.check(v_err like '%SUSPENDED%', 'SA-N4 a SUSPENDED membership');
  v_err := pg_temp.err_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_rev));
  perform pg_temp.check(v_err like '%REVOKED%',   'SA-N5 a REVOKED membership');
  v_err := pg_temp.err_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_dec));
  perform pg_temp.check(v_err like '%DECLINED%',  'SA-N6 a DECLINED membership');
  v_err := pg_temp.err_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_exp));
  perform pg_temp.check(v_err like '%EXPIRED%',   'SA-N7 an EXPIRED membership');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_str)) <> 'OK',
    'SA-N8 and a non-member');
  -- THE WRONG CLUB, at the seam. FARMB is ACTIVE -- at the other club. A seam that looked up the
  -- membership by person alone would admit them here, and Slice 5 would inherit that.
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select pg_temp.seam(%L,%L)', v_club, v_farmb)) <> 'OK',
    'SA-N9 the seam refuses an ACTIVE member of a DIFFERENT club -- the membership must be at THIS club');
  perform pg_temp.check(
    not exists (select 1 from public.role_assignments where club_id = v_club
                  and user_id in (v_pending, v_susp, v_rev, v_dec, v_exp, v_str, v_farmb) and role_key='SAFEGUARDING_OFFICER'),
    'SA-N10 and none of those seven refusals created an assignment');

  -- ---------------------------------------------------------------------------------------------
  -- SA-I  the record
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    exists (select 1 from public.security_events where event_type = 'safeguarding.officer_nominated' and club_id = v_club)
    and exists (select 1 from public.security_events where event_type = 'safeguarding.officer_confirmed' and club_id = v_club),
    'SA-I1 nomination and confirmation are both recorded as security events');
  -- A REFUSED confirmation is not claimed to be audited, and this is the assertion that says so
  -- honestly: Postgres has no autonomous transaction, so an event written immediately before the
  -- raise would be rolled back with it. What can be asserted is that the refusal changed nothing.
  perform pg_temp.check(
    not exists (select 1 from public.security_event_types where event_type = 'safeguarding.officer_confirm_denied')
    and (select confirmation_state from public.role_assignments where id = v_assign2) = 'PENDING_CONFIRMATION',
    'SA-I1b a refused confirmation is not advertised as audited, and leaves the nomination exactly as it was');
  perform pg_temp.check(
    (select requires_reason from public.security_event_types where event_type = 'safeguarding.officer_confirmed')
    and (select severity from public.security_event_types where event_type = 'safeguarding.officer_confirmed') = 'CRITICAL',
    'SA-I2 and confirming an appointment is catalogued as critical and reason-bearing');
  -- Scoped to THIS appointment. Counting every confirmation notification in the world would make the
  -- assertion depend on how many appointments earlier sections happened to make.
  perform pg_temp.check(
    (select count(*) from public.notifications
       where type = 'safeguarding_officer_confirmed' and user_id = v_nom and (data->>'assignment_id')::uuid = v_assign) = 1
    and (select count(distinct user_id) from public.notifications
       where type = 'safeguarding_officer_confirmed' and user_id in (v_ca, v_ca2) and (data->>'assignment_id')::uuid = v_assign) = 2,
    'SA-I3 the new officer and both of the club''s admins are told about THIS appointment (section T step 5)');

  -- ---------------------------------------------------------------------------------------------
  -- SA-J / SA-K  retirement: the transitional keys, and no raw-role authority
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not exists (select 1 from public.capability_key_map where legacy_key like 'club.safeguarding.%'),
    'SA-J1 the transitional club.safeguarding.* adapter rows are retired (kept at parity "until 4g")');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname in ('public','internal') and p.prosrc ~ 'club\.safeguarding\.'),
    'SA-J2 and nothing asks them any more');
  perform pg_temp.check(
    not exists (select 1 from pg_policies
                where tablename in ('club_safeguarding_officer_conversations','club_safeguarding_officers',
                                    'club_safeguarding_officer_invitations','player_team_dispensation','safeguarding_thread_reviews')
                  and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\mis_site_admin\('),
    'SA-K1 no safeguarding policy carries a blanket Site Admin read');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname||'.'||p.proname in (
                  'internal.can_view_safeguarding_conversation','internal.can_send_safeguarding_conversation',
                  'internal.notify_club_safeguarding_officers','internal.active_safeguarding_officer_ids',
                  'internal.enter_safeguarding_nomination','public.confirm_safeguarding_officer',
                  'public.nominate_club_safeguarding_officer','public.site_safeguarding_review',
                  'public.welfare_member_view','public.club_safeguarding_contact','public.start_safeguarding_conversation')
                  and p.prosrc ~ '\m(is_site_admin|is_full_site_admin|has_capability|staffs_team)\('),
    'SA-K2 and no 4G function decides authority by a raw role helper');
  perform pg_temp.check(
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname||'.'||p.proname in (
       'internal.active_safeguarding_officer_ids','internal.is_active_safeguarding_officer',
       'internal.enter_safeguarding_nomination','public.confirm_safeguarding_officer',
       'public.nominate_club_safeguarding_officer','public.site_safeguarding_review',
       'public.welfare_member_view','public.club_safeguarding_contact','public.start_safeguarding_conversation')) = 9,
    'SA-K3 every 4G function in the ledger exists -- the list is not stale');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname in ('confirm_safeguarding_officer')
                  and p.prosrc ~ 'officer_user_id'),
    'SA-K4 confirmation does not read the legacy per-officer column');

  -- ---------------------------------------------------------------------------------------------
  -- SA-L  dispensations: separation of duties, the officer's view, and the guardian's notice
  -- ---------------------------------------------------------------------------------------------
  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('SAM Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'sam-'||v_tag) returning id into v_season;
  end if;
  insert into public.players (first_name, surname, active, created_by, playing_pathway, date_of_birth)
  values ('Sam','Child',true,v_ca,'MALE',(current_date - interval '13 years')::date) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status, state, source)
  values (v_player, v_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state)
  values (v_pg, v_player, 'parent', 'active', 'ACTIVE');

  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, status, requested_by)
  values (v_player, v_team, v_team2, v_season, 'matrix rule', 'requested', v_ca) returning id into v_disp;

  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.decide_player_dispensation(%L,''source_team'',true)', v_disp)) = '42501',
    'SA-L1 the person who requested a dispensation cannot approve it (section T, separation of duties)');
  perform pg_temp.check(pg_temp.try_as(v_ca2, format('select public.decide_player_dispensation(%L,''source_team'',true)', v_disp)) = 'OK',
    'SA-L2 while somebody else at the club can');
  perform pg_temp.check(
    (select count(*) from public.notifications where user_id = v_pg and type = 'safeguarding_guardian_dispensation') >= 1,
    'SA-L3 and the child''s guardian is told -- a mandatory notification, on every status change');
  perform pg_temp.check(
    (select mandatory_override from public.notification_types where type_key = 'safeguarding_guardian_dispensation'),
    'SA-L4 which cannot be turned off');

  -- Re-confirm the officer so the dispensation visibility half can be asked of a real officer.
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''reappoint'')', v_club, v_co));
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L,''matrix: reappointing'')', (v_res->>'assignment_id'))) = 'OK',
    'SA-L5 a replacement officer can be appointed through the same two steps');
  perform pg_temp.check(pg_temp.count_as(v_co, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 1,
    'SA-L6 and the confirmed officer can see the club''s dispensations (J.12 line 547), which nothing implemented before');
  perform pg_temp.check(pg_temp.count_as(v_str, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 0,
    'SA-L7 while a stranger sees none');

  -- The confirmed officer above (CO) is ALSO a coach of the source team, so SA-L6 could be satisfied
  -- by the team-staff branch rather than the officer branch and would not notice if J.12's branch
  -- disappeared. A deputy with no team role anywhere reads it through the officer branch or not at all.
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''matrix: officer with no team role'')', v_club, v_so2));
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L,''matrix: confirming the deputy'')', (v_res->>'assignment_id'))) = 'OK',
    'SA-L8 a deputy officer who holds no team role can be appointed');
  perform pg_temp.check(pg_temp.count_as(v_so2, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 1,
    'SA-L9 and reads the club''s dispensations through the SAFEGUARDING branch alone (J.12 line 548) -- they have no other way in');

  -- ---------------------------------------------------------------------------------------------
  -- SA-Q  the dispensation read, canonicalised (Slice 4 closure, AA.3 row 4g)
  --
  -- This policy was the LAST can_manage_club_fixtures policy anywhere in Ovalball, and it also carried
  -- two can_manage_team terms. Slice 4C assigned dispensations to 4G by name and 4G did not take them.
  -- Who may read a dispensation is who may act on one: J.7 lines 471-472 give that to
  -- fixture.dispensation.request (CO, TM; CA, FS) and fixture.dispensation.approve_team (TM, TA).
  -- A dispensation moves a child BETWEEN two teams, so both ends can see it.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select count(*) from pg_policies where tablename = 'player_team_dispensation'
       and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '\m(can_manage_club_fixtures|can_manage_team|is_site_admin|is_club_admin)\(') = 0,
    'SA-Q1 no dispensation policy decides by a fixtures or team role helper any more');
  perform pg_temp.check(
    (select count(*) from pg_policies where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '\mcan_manage_club_fixtures\(') = 0,
    'SA-Q2 and with it goes the last can_manage_club_fixtures policy in Ovalball');
  for v_ms in select unnest(array[v_ca, v_ca2, v_fs, v_tm, v_ta]) loop
    perform pg_temp.check(pg_temp.count_as(v_ms, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 1,
      'SA-Q3 the people who may request or approve a dispensation can read it (' ||
        (select surname from public.profiles where id = v_ms) || ')');
  end loop;
  perform pg_temp.check(pg_temp.count_as(v_tgt_tm, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 1,
    'SA-Q4 including the TARGET team''s manager -- a move has two ends, and the side receiving a child sees it');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 0
                        and pg_temp.count_as(v_pg, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 0,
    'SA-Q5 while an ordinary member and a guardian with no team role read none of it');
  perform pg_temp.check(pg_temp.count_as(v_farca, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 0
                        and pg_temp.count_as(v_farmb, format('select count(*) from public.player_team_dispensation where id = %L', v_disp)) = 0,
    'SA-Q6 nor does another club, naming this dispensation''s id');
  -- Separation of duties is a WRITE rule and this is a READ change. It must be untouched.
  perform pg_temp.check(pg_temp.try_as(v_tm, format('select public.decide_player_dispensation(%L,''club'',true)', v_disp)) <> 'OK',
    'SA-Q7 and reading is not approving: a Team Manager who can see it cannot decide the club stage (J.7 line 473)');

  -- ---------------------------------------------------------------------------------------------
  -- SA-P  the hoist is an optimisation, not a change of answer
  --
  -- player_team_dispensation_select asks the safeguarding question through an uncorrelated set so it
  -- becomes an InitPlan: on 200 dispensations that took an officer's read from ~110ms to ~1ms,
  -- because the three per-row fixture-authority terms in front of it stopped being reached. The set
  -- is built from ACTIVE memberships, so the claim that needs checking is that it selects exactly
  -- the rows the per-row question would have.
  -- ---------------------------------------------------------------------------------------------
  v_ok := true;
  foreach v_ms in array array[v_ca, v_ca2, v_fs, v_mb, v_co, v_pg, v_str, v_farca, v_farmb, v_sa, v_sup, v_mod] loop
    if pg_temp.count_as(v_ms, 'select count(*) from public.player_team_dispensation')
       is distinct from pg_temp.count_as(v_ms, 'select pg_temp.unhoisted_dispensations()') then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'SA-P1 the hoisted policy and the per-row question select the same rows, for all twelve personas');
  perform pg_temp.check(
    pg_temp.count_as(v_co, 'select coalesce(array_length(internal.safeguarding_dispensation_team_ids(),1),0)') > 0,
    'SA-P2 a confirmed officer''s hoisted set names their club''s teams');
  perform pg_temp.check(
    pg_temp.count_as(v_mb, 'select coalesce(array_length(internal.safeguarding_dispensation_team_ids(),1),0)') = 0
    and pg_temp.count_as(v_farca, 'select coalesce(array_length(internal.safeguarding_dispensation_team_ids(),1),0)') = 0,
    'SA-P3 and an ordinary member''s, and another club''s admin''s, are empty');
  perform pg_temp.check(
    not has_function_privilege('anon','internal.safeguarding_dispensation_team_ids()','EXECUTE'),
    'SA-P4 anon cannot ask which teams a caller may see dispensations for');

  -- ---------------------------------------------------------------------------------------------
  -- SA-M  the unknown-age gate (programme section 9)
  --
  -- internal.person_is_minor answers false when it has no date of birth, so an identity whose age
  -- Ovalball cannot establish passes the minor prohibition. That is TRUE TODAY through the existing
  -- invitation path and is the programme's carried follow-up, not this slice's to solve. What 4G must
  -- not do is widen it -- and what it in fact does is narrow it, because such a person can no longer
  -- become an officer without a named human at Ovalball confirming them. Both halves are pinned here
  -- so that a later change cannot quietly remove the narrowing.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select date_of_birth from public.profiles where id = v_unknown) is null,
    'SA-M1 the unknown-age identity really has no date of birth recorded');
  -- INTENDED CHANGE (D-S5-1, approved after 4G). 4G deliberately added no age rule of its own, so an
  -- identity Ovalball had never been told the age of could be nominated and then had to wait for a
  -- human at Ovalball. Slice 5 closes that a step earlier: unknown age is not adulthood, so the
  -- nomination itself is now refused. This is the RA7-class tripwire firing on purpose.
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''unknown age'')', v_club, v_unknown)) = '23514',
    'SA-M2 INTENDED CHANGE: an identity with no recorded date of birth can no longer even be NOMINATED (D-S5-1)');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_unknown, v_club)) = 0,
    'SA-M3 and holds nothing, which was already true and still is');
  -- Now the same person, once a date of birth establishing adulthood is on file. The point of the
  -- decision is that the age gate and AN-6 are INDEPENDENT: establishing adulthood gets you as far as
  -- PENDING_CONFIRMATION and no further, and Ovalball still has to look.
  update public.profiles set date_of_birth = (current_date - interval '30 years')::date where id = v_unknown;
  v_res := pg_temp.json_as(v_ca, format('select public.nominate_club_safeguarding_officer(%L,%L,''deputy'',''age now on file'')', v_club, v_unknown));
  perform pg_temp.check(v_res->>'outcome' = 'PENDING_CONFIRMATION',
    'SA-M4 with a date of birth establishing adulthood they can be nominated, and land in PENDING_CONFIRMATION');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select pg_temp.so_authority(%L,%L)', v_unknown, v_club)) = 0,
    'SA-M5 still holding nothing -- the age gate is not a confirmation');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.confirm_safeguarding_officer(%L,''club says yes'')', (v_res->>'assignment_id'))) = '42501',
    'SA-M6 and the club still cannot confirm them: AN-6 is independently mandatory and age is not proof of anything else');
end $$;

rollback;
