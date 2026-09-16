-- =====================================================================================================
-- CLUB DOCUMENTS, PARTNERS, REFERRALS AND HANDOVER MATRIX  (Identity/Auth Slice 4I, AA.3 row 4i)
--
-- The last domain matrix of Slice 4. DETERMINISTIC and SELF-SEEDING: every club, team, person,
-- document, folder, rollover, partnership and referral it needs, it creates. It reads no UAT seed
-- identity, so it cannot pass green with zero assertions on a clean database.
--
-- Contract: design J.4 lines 407-411, J.5 lines 420-429, section U ("team.handover.apply: prepare
-- only") and Z-12 (the club-documents bucket needs a delete policy).
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
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cmm-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Cmm',p_label,'cmm-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CMM '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cmm-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'cmm-'||v_tag,'active') returning id into v_club;
  return v_club;
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

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  execute p_sql into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,0);
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

-- The per-row question the hoisted set replaced, kept so MI-P can compare them.
create or replace function pg_temp.unhoisted_docs() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_documents d
  where internal.has_site_capability('site.clubs.view')
     or internal.can('club.documents.view', 'club', d.club_id, null, null);
$$;
grant execute on function pg_temp.unhoisted_docs() to public;

-- =====================================================================================================
-- MI-A. The catalogue, section U and Z-12, structurally.
-- =====================================================================================================
do $$
declare r record;
begin
  for r in select * from (values
    ('club.documents.view','{club}'), ('club.documents.manage','{club}'),
    ('club.partners.manage','{club}'), ('club.referrals.view','{club}'), ('club.referrals.manage','{club}'),
    ('team.handover.prepare','{club}'), ('team.handover.apply','{club}'),
    ('team.lifecycle.manage','{club}'), ('team.graduation.place','{club,team}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c where c.key = r.key and c.status='ACTIVE' and c.valid_scopes::text = r.scopes),
      format('MI-A %s is ACTIVE with scopes %s', r.key, r.scopes));
  end loop;

  -- Section U, in the catalogue: preparing a handover is the Secretary's, applying it is not.
  perform pg_temp.check(
    exists (select 1 from public.bundle_capabilities where capability_key='team.handover.prepare' and bundle_key='FS')
    and exists (select 1 from public.bundle_capabilities where capability_key='team.handover.prepare' and bundle_key='CA'),
    'MI-A1 U: the Fixtures Secretary and the Club Admin both hold team.handover.prepare');
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='team.handover.apply') = 1
    and exists (select 1 from public.bundle_capabilities where capability_key='team.handover.apply' and bundle_key='CA'),
    'MI-A2 U: and applying it is the Club Admin''s alone (J.5 line 427)');
  perform pg_temp.check(
    (select aal from public.capabilities where key='team.handover.apply') = 'R'
    and (select grant_level from public.capabilities where key='team.handover.apply') = 'N',
    'MI-A3 and it is non-delegable and reason-bearing, so it cannot be handed out by override');

  -- Z-12: the bucket has a delete policy, and it asks the manage authority like the other writes.
  perform pg_temp.check(
    exists (select 1 from pg_policies where schemaname='storage' and policyname='club_documents_storage_delete'
              and cmd='DELETE' and qual ~ 'can_access_document_storage_path'),
    'MI-A4 Z-12: the club-documents bucket has a delete policy, gated like its other writes');
  perform pg_temp.check(
    (select count(*) from pg_policies where schemaname='storage'
       and (coalesce(qual,'')||' '||coalesce(with_check,'')) like '%club-documents%') = 4,
    'MI-A5 and exactly four: insert, select, update, delete');

  -- AA.3 row 4i's named legacy item, structurally: no role strings left in the document helpers.
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='internal' and p.proname in ('can_manage_document_library','can_view_document_library')
                  and (p.prosrc ~ '\mcm\.role\m' or p.prosrc ~ 'site_admin_role\(')),
    'MI-A6 neither document helper matches a membership or site-admin role string (AA.3 row 4i)');
end $$;

-- =====================================================================================================
-- MI-B .. MI-P. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_far uuid; v_team uuid; v_ms uuid;
  v_ca uuid; v_fs uuid; v_vo uuid; v_mb uuid; v_co uuid; v_tm uuid; v_str uuid; v_farca uuid;
  v_sa uuid; v_sup uuid; v_ro uuid; v_data uuid;
  v_folder uuid; v_doc uuid; v_rollover uuid; v_partnership uuid; v_referral uuid;
  v_team18 uuid; v_prop12 uuid; v_prop18 uuid; v_unclaimed uuid; v_unclaimed2 uuid; v_season uuid;
  v_tag text := substr(gen_random_uuid()::text,1,8); n int; v_ok boolean;
begin
  v_club := pg_temp.club('Home'); v_far := pg_temp.club('Far');
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','cmm-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 18 Boys','cmm-u18-'||v_tag,'youth','U18','boys','union',true) returning id into v_team18;

  v_ca  := pg_temp.person('CA');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_ca,'CLUB_ADMIN','active');
  v_fs  := pg_temp.person('FS');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_fs,'FIXTURE_SECRETARY','active');
  v_mb  := pg_temp.person('MB');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_mb,'BASIC_USER','active');
  v_vo  := pg_temp.person('VO');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_vo,'BASIC_USER','active') returning id into v_ms;
  insert into public.role_assignments (club_id,user_id,membership_id,role_key,state,source,granted_by) values (v_club,v_vo,v_ms,'VOLUNTEER','ACTIVE','CLUB_ADMIN_ASSIGNMENT',v_ca);
  v_co  := pg_temp.person('CO');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_co,'BASIC_USER','active') returning id into v_ms;
  insert into public.team_permissions (membership_id,team_id,permission) values (v_ms,v_team,'coach');
  v_tm  := pg_temp.person('TM');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_tm,'BASIC_USER','active') returning id into v_ms;
  insert into public.team_permissions (membership_id,team_id,permission) values (v_ms,v_team,'manager');
  v_str := pg_temp.person('STR');
  v_farca := pg_temp.person('FARCA'); insert into public.club_memberships (club_id,user_id,role,status) values (v_far,v_farca,'CLUB_ADMIN','active');
  v_sa   := pg_temp.person('SA');   insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');
  v_sup  := pg_temp.person('SUP');  insert into public.site_admins (user_id,status,admin_role) values (v_sup,'active','user_access');
  v_ro   := pg_temp.person('RO');   insert into public.site_admins (user_id,status,admin_role) values (v_ro,'active','read_only');
  v_data := pg_temp.person('DATA'); insert into public.site_admins (user_id,status,admin_role) values (v_data,'active','club_data');

  -- The season this handover rolls INTO. Taken from the canonical register if one is already there,
  -- and otherwise added to it -- a season in Ovalball only ever comes from public.seasons, never from
  -- a date computed in a test. Creating one is what makes this suite self-seeding: on an empty
  -- database there are no seasons at all, and a matrix that quietly skipped its handover assertions
  -- there would be reporting a pass it had not earned.
  select s.id into v_season from public.seasons s
   where s.rugby_code = 'union' and not s.is_regression_fixture and s.starts_on > current_date
   order by s.starts_on limit 1;
  if v_season is null then
    -- season_year_end and season_ref are GENERATED from season_year_start; the register derives its
    -- own labels, which is exactly the point of it being the one source.
    insert into public.seasons (name, rugby_code, season_year_start,
                                pre_season_starts_on, starts_on, ends_on, active, is_regression_fixture)
    select 'Matrix Season ' || y || '/' || ((y + 1) % 100), 'union', y,
           make_date(y, 7, 1), make_date(y, 9, 1), make_date(y + 1, 6, 30), false, false
      from (select extract(year from current_date)::int + 5 as y) g
    on conflict (rugby_code, season_year_start) do nothing
    returning id into v_season;
    if v_season is null then
      select s.id into v_season from public.seasons s
       where s.rugby_code = 'union' and s.season_year_start = extract(year from current_date)::int + 5;
    end if;
  end if;
  perform pg_temp.check(v_season is not null,
    'MI-C0 a canonical union season exists to roll into -- taken from the register, or added to it');

  -- Two directory entries that are NOT yet Ovalball clubs, so a referral to either is a real referral.
  -- Two, not one: a club may have only ONE pending referral out to a given directory, so reusing the
  -- same target would refuse the second caller on the unique index rather than on their authority.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CMM Unclaimed RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cmm-unclaimed-'||v_tag)
  returning id into v_unclaimed;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CMM Unclaimed Two RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cmm-unclaimed2-'||v_tag)
  returning id into v_unclaimed2;

  insert into public.document_folders (club_id, name, created_by) values (v_club, 'Policies '||v_tag, v_ca) returning id into v_folder;
  insert into public.club_documents (club_id, folder_id, title, storage_path, mime_type, size_bytes, original_filename, category, uploaded_by)
  values (v_club, v_folder, 'Doc '||v_tag, v_club||'/doc-'||v_tag||'.pdf', 'application/pdf', 100, 'doc.pdf', 'other', v_ca) returning id into v_doc;

  -- ---------------------------------------------------------------------------------------------
  -- MI-B  the document library
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_documents where id = %L', v_doc)) = 1
                        and pg_temp.count_as(v_mb, format('select count(*) from public.club_documents where id = %L', v_doc)) = 1
                        and pg_temp.count_as(v_tm, format('select count(*) from public.club_documents where id = %L', v_doc)) = 1,
    'MI-B1 the club''s own people read its document library (J.4 line 407 gives the view to every club bundle)');
  perform pg_temp.check(pg_temp.count_as(v_farca, format('select count(*) from public.club_documents where id = %L', v_doc)) = 0,
    'MI-B2 and another club reads none of it');
  perform pg_temp.check(pg_temp.count_as(v_str, format('select count(*) from public.club_documents where id = %L', v_doc)) = 0,
    'MI-B3 nor does somebody with no membership anywhere');
  perform pg_temp.check(pg_temp.try_as(null, format('select count(*) from public.club_documents where id = %L', v_doc)) = '42501',
    'MI-B4 and a signed-out visitor is refused the table at the grant');

  declare v_res text;
  begin
    -- Sequenced deliberately: PL/pgSQL does not promise that the left operand of AND is
    -- evaluated before the right, so writing and then reading in one expression can read first.
    v_res := pg_temp.try_as(v_ca, format('update public.club_documents set title = ''By CA'' where id = %L', v_doc));
    perform pg_temp.check(v_res = 'OK' and (select title from public.club_documents where id = v_doc) = 'By CA',
      'MI-B5 the Club Admin may change a document (club.documents.manage)');
    v_res := pg_temp.try_as(v_fs, format('update public.club_documents set title = ''By FS'' where id = %L', v_doc));
    perform pg_temp.check((select title from public.club_documents where id = v_doc) = 'By FS',
      'MI-B6 and so may the Fixtures Secretary -- J.4 line 408 gives them the library too');
    v_res := pg_temp.try_as(v_mb, format('update public.club_documents set title = ''By MB'' where id = %L', v_doc));
    perform pg_temp.check((select title from public.club_documents where id = v_doc) <> 'By MB',
      'MI-B7 while an ordinary member may not');
    v_res := pg_temp.try_as(v_farca, format('update public.club_documents set title = ''By FARCA'' where id = %L', v_doc));
    perform pg_temp.check((select title from public.club_documents where id = v_doc) <> 'By FARCA',
      'MI-B8 and neither may another club''s Club Admin, naming this document''s id');
  end;

  -- The site side, by profile. J.4 records site.clubs.profile.manage for manage and site.clubs.view
  -- for the view, and the role-string helper this replaced named exactly the same two profiles.
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_manage_document_library(%L, null)', v_club))
                        and pg_temp.bool_as(v_data, format('internal.can_manage_document_library(%L, null)', v_club)),
    'MI-B9 INTENDED CHANGE: a Full and a club-data Site Admin manage the library. The role string named the club-data profile ALONE; J.4 line 408 gives the key the master site.clubs.profile.manage, which the Full Site Admin also holds');
  perform pg_temp.check(not pg_temp.bool_as(v_ro, format('internal.can_manage_document_library(%L, null)', v_club))
                        and not pg_temp.bool_as(v_sup, format('internal.can_manage_document_library(%L, null)', v_club)),
    'MI-B10 and a read-only or user-support Site Admin does not');
  perform pg_temp.check(pg_temp.bool_as(v_ro, format('internal.can_view_document_library(%L, null)', v_club)),
    'MI-B11 while every site profile can still SEE it (site.clubs.view)');

  -- Z-12 again, behaviourally. The bucket policies ask can_access_document_storage_path, which is
  -- now the only reachable caller of the document helpers -- so a wrong key here is a member who
  -- can overwrite or delete a club's safeguarding policy in object storage.
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_access_document_storage_path(%L, true)', v_club||'/doc-'||v_tag||'.pdf'))
                        and pg_temp.bool_as(v_fs, format('internal.can_access_document_storage_path(%L, true)', v_club||'/doc-'||v_tag||'.pdf')),
    'MI-B12 the Club Admin and the Fixtures Secretary may WRITE the club''s object storage');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_access_document_storage_path(%L, true)', v_club||'/doc-'||v_tag||'.pdf'))
                        and not pg_temp.bool_as(v_tm, format('internal.can_access_document_storage_path(%L, true)', v_club||'/doc-'||v_tag||'.pdf')),
    'MI-B13 an ordinary member and a Team Manager may not, though both may read the library');
  perform pg_temp.check(pg_temp.bool_as(v_mb, format('internal.can_access_document_storage_path(%L, false)', v_club||'/doc-'||v_tag||'.pdf')),
    'MI-B14 -- reading it is a different question, and they pass that one');
  perform pg_temp.check(not pg_temp.bool_as(v_farca, format('internal.can_access_document_storage_path(%L, true)', v_club||'/doc-'||v_tag||'.pdf'))
                        and not pg_temp.bool_as(v_farca, format('internal.can_access_document_storage_path(%L, false)', v_club||'/doc-'||v_tag||'.pdf')),
    'MI-B15 and another club reaches neither, by path');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.delete_club_document(%L)', v_doc)) <> 'OK'
                        and (select count(*) from public.club_documents where id = v_doc) = 1,
    'MI-B16 and delete_club_document, which asks the same helper, refuses an ordinary member');

  -- ---------------------------------------------------------------------------------------------
  -- MI-C  section U: prepare is the Secretary's, apply is not
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''team.handover.prepare'',''club'',%L,null,null)', v_club))
                        and pg_temp.bool_as(v_fs, format('internal.can(''team.handover.prepare'',''club'',%L,null,null)', v_club)),
    'MI-C1 U: the Club Admin and the Fixtures Secretary may both PREPARE a season handover');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_fs, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club)),
    'MI-C2 U: and only the Club Admin may APPLY it -- which nothing enforced before, because every handover RPC asked one role');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can(''team.handover.prepare'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_co, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club)),
    'MI-C3 and neither an ordinary member nor a Coach reaches either half');
  perform pg_temp.check(not pg_temp.bool_as(v_farca, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club)),
    'MI-C4 nor another club''s admin, naming this club');
  -- Team lifecycle is a separate authority again. Folding a side is not preparing a handover, and a
  -- Secretary who could fold one could retire a club's team without its administrator.
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''team.lifecycle.manage'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_fs, format('internal.can(''team.lifecycle.manage'',''club'',%L,null,null)', v_club)),
    'MI-C6 folding, graduating and reactivating a team is team.lifecycle.manage -- the Club Admin''s, not the Secretary''s');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.fold_team(%L, ''attempted fold'')', v_team)) <> 'OK'
                        and pg_temp.try_as(v_fs, format('select public.graduate_team(%L)', v_team18)) <> 'OK',
    'MI-C7 and fold_team and graduate_team both refuse the Secretary directly');
  perform pg_temp.check((select active from public.teams where id = v_team) and (select active from public.teams where id = v_team18),
    'MI-C8 leaving both sides active, which is the outcome that would matter to the children in them');

  -- One real handover for this club, generated the way the product generates one. Everything from
  -- here on names a proposal that actually exists, so no refusal can pass by naming nothing.
  perform pg_temp.as_(v_ca);
  perform set_config('role','authenticated', true);
  select public.generate_rollover_proposal(v_club, 'union', v_season) into v_rollover;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  select id into v_prop12 from public.age_grade_rollover_team_proposals where rollover_id = v_rollover and team_id = v_team;
  select id into v_prop18 from public.age_grade_rollover_team_proposals where rollover_id = v_rollover and team_id = v_team18;
  perform pg_temp.check(v_rollover is not null and v_prop12 is not null and v_prop18 is not null,
    'MI-C5a a real handover with a proposal for each side exists');

  -- The two decisions inside a handover that are NOT preparation. They sit behind their own gates
  -- inside internal.decide_rollover_team_proposal precisely so the preparation route cannot become a
  -- second door to retiring a side or archiving a cohort.
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.confirm_rollover_team_proposal(%L, ''graduate'')', v_prop18)) <> 'OK',
    'MI-C9 the Fixtures Secretary cannot GRADUATE a cohort through the handover route');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.confirm_rollover_team_proposal(%L, ''fold'', null, null, ''attempted'')', v_prop12)) <> 'OK',
    'MI-C10 nor FOLD a side through it -- J.5 line 422 keeps both at team.lifecycle.manage');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.confirm_rollover_team_proposal(%L, ''graduate'')', v_prop18)) = 'OK',
    'MI-C11 while the Club Admin can, so the refusal is the boundary and not a broken proposal');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.confirm_rollover_team_proposal(%L, ''confirm'')', v_prop12)) = 'OK',
    'MI-C12 and the Secretary keeps ordinary preparation -- confirming a progression is theirs (J.5 line 426)');

  -- Then section U on the same handover: preparing it was the Secretary's, applying it is not.
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.apply_season_handover(%L)', v_rollover)) <> 'OK',
    'MI-C5 the RPC refuses the Secretary on a REAL handover in their own club, not merely the capability check');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.apply_season_handover(%L)', v_rollover)) = 'OK',
    'MI-C5b while the Club Admin applies the same one -- so the refusal is the boundary, not a broken handover');

  -- The RPCs in front of all of this, which Slice 4C deliberately left to the slice that owns the
  -- meaning of the call site. Eighteen of them asked a FIXTURES helper -- so reading a handover and
  -- deciding one were the same undivided question, and a referral was reachable by the Secretary.
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select count(*) from public.handover_apply_blockers(%L)', v_rollover)) = 'OK'
                        and pg_temp.try_as(v_ca, format('select count(*) from public.handover_apply_blockers(%L)', v_rollover)) = 'OK',
    'MI-C13 the Club Admin and the Fixtures Secretary may REVIEW a handover (team.handover.prepare)');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select count(*) from public.handover_apply_blockers(%L)', v_rollover)) <> 'OK'
                        and pg_temp.try_as(v_farca, format('select count(*) from public.handover_apply_blockers(%L)', v_rollover)) <> 'OK',
    'MI-C14 and an ordinary member and another club may not, naming this handover''s id');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.generate_rollover_proposal(%L, ''union'', %L)', v_club, v_season)) <> 'OK',
    'MI-C15 nor may a member propose one');
  -- Placement asks team.graduation.place, which at CLUB scope is the same two people the fixtures
  -- helper named -- so repointing it widens nobody. The Coach and Team Manager hold it at TEAM scope,
  -- which is where place_graduating_player asks it (J.5).
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''team.graduation.place'',''club'',%L,null,null)', v_club))
                        and pg_temp.bool_as(v_fs, format('internal.can(''team.graduation.place'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_co, format('internal.can(''team.graduation.place'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_tm, format('internal.can(''team.graduation.place'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_mb, format('internal.can(''team.graduation.place'',''club'',%L,null,null)', v_club)),
    'MI-C16 at club scope placement is the Club Admin''s and the Secretary''s -- exactly who the fixtures helper named');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.can(''team.graduation.place'',''team'',%L,%L,null)', v_club, v_team))
                        and pg_temp.bool_as(v_tm, format('internal.can(''team.graduation.place'',''team'',%L,%L,null)', v_club, v_team))
                        and not pg_temp.bool_as(v_mb, format('internal.can(''team.graduation.place'',''team'',%L,%L,null)', v_club, v_team)),
    'MI-C17 while at team scope the Coach and Team Manager hold it and an ordinary member does not');

  -- ---------------------------------------------------------------------------------------------
  -- MI-D  rollover, graduation and season transition reads
  -- ---------------------------------------------------------------------------------------------
  select id into v_rollover from public.age_grade_rollovers where club_id = v_club limit 1;
  if v_rollover is not null then
    perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.age_grade_rollovers where id = %L', v_rollover)) = 1
                          and pg_temp.count_as(v_fs, format('select count(*) from public.age_grade_rollovers where id = %L', v_rollover)) = 1,
      'MI-D1 the Club Admin and the Fixtures Secretary read the club''s rollover plan');
    perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.age_grade_rollovers where id = %L', v_rollover)) = 0
                          and pg_temp.count_as(v_farca, format('select count(*) from public.age_grade_rollovers where id = %L', v_rollover)) = 0,
      'MI-D2 and an ordinary member and another club read none of it');
    perform pg_temp.check(pg_temp.count_as(v_sup, format('select count(*) from public.age_grade_rollovers where id = %L', v_rollover)) = 1,
      'MI-D3 while site support can, through site.support.view_club');
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- MI-E  partnerships and referrals
  -- ---------------------------------------------------------------------------------------------
  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  values (v_club, v_far, 'pending', v_ca) returning id into v_partnership;
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_partnerships where id = %L', v_partnership)) = 1
                        and pg_temp.count_as(v_fs, format('select count(*) from public.club_partnerships where id = %L', v_partnership)) = 1,
    'MI-E1 the Club Admin and the Fixtures Secretary see their club''s partnership request (J.4 line 409)');
  perform pg_temp.check(pg_temp.count_as(v_farca, format('select count(*) from public.club_partnerships where id = %L', v_partnership)) = 1,
    'MI-E2 and so does the club it was sent TO -- a partnership is a relationship, and both ends see it');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.club_partnerships where id = %L', v_partnership)) = 0,
    'MI-E3 while an ordinary member of either club does not');

  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  select v_club, c.directory_id, 'A Contact', 'ref-'||v_tag||'@ovalball.test', v_ca
    from public.clubs c where c.id = v_far returning id into v_referral;
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_ovalball_invitations where id = %L', v_referral)) = 1,
    'MI-E4 the Club Admin sees the club''s referrals');
  perform pg_temp.check(pg_temp.count_as(v_fs, format('select count(*) from public.club_ovalball_invitations where id = %L', v_referral)) = 1,
    'MI-E5 and so does the Fixtures Secretary -- inviting a club ONTO Ovalball is club.partners.manage, the same boundary the partnership table uses');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.club_ovalball_invitations where id = %L', v_referral)) = 0
                        and pg_temp.count_as(v_farca, format('select count(*) from public.club_ovalball_invitations where id = %L', v_referral)) = 0,
    'MI-E5b while an ordinary member and another club see none of it');
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by) '
      || 'values (%L, %L, ''X'', ''x-'||v_tag||'@ovalball.test'', %L)', v_club, v_unclaimed2, v_mb)) <> 'OK',
    'MI-E6 and an ordinary member cannot create one');
  -- The REFERRAL LEDGER is a different surface with a different answer: J.4 lines 410-411 keep
  -- club.referrals.* Club-Admin-only, with site.commercial.* as its master. Sending the invitation and
  -- claiming the attribution it creates are not the same act, and the Secretary holds only the first.
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''club.referrals.manage'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_fs, format('internal.can(''club.referrals.manage'',''club'',%L,null,null)', v_club)),
    'MI-E6b while the referral LEDGER stays the administrator''s -- club.referrals.manage excludes the Secretary');

  perform pg_temp.check(pg_temp.try_as(v_ca, format(
      'select public.create_partner_invitation(%L, %L, ''A Contact'', ''ca-'||v_tag||'@ovalball.test'')',
      v_club, v_unclaimed)) = 'OK',
    'MI-E7a the Club Admin may send a referral to a club that is not yet on Ovalball');
  perform pg_temp.check(pg_temp.try_as(v_fs, format(
      'select public.create_partner_invitation(%L, %L, ''A Contact'', ''fs-'||v_tag||'@ovalball.test'')',
      v_club, v_unclaimed2)) = 'OK',
    'MI-E7 and so may the Fixtures Secretary, to a directory of their own -- a second referral to the SAME directory would be refused on the unique index, not on authority');
  perform pg_temp.check(pg_temp.try_as(v_farca, format(
      'select public.create_partner_invitation(%L, %L, ''A Contact'', ''far-'||v_tag||'@ovalball.test'')',
      v_club, v_unclaimed)) <> 'OK',
    'MI-E7b while another club cannot send one in this club''s name');
  perform pg_temp.check(pg_temp.try_as(v_farca, format('select public.revoke_club_partnership(%L)', v_partnership)) = 'OK',
    'MI-E8 and either end of a partnership may revoke it -- here the club it was sent to');

  -- ---------------------------------------------------------------------------------------------
  -- MI-F  attacks
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'insert into public.club_documents (club_id, folder_id, title, storage_path, mime_type, size_bytes, original_filename, category, uploaded_by) '
      || 'values (%L,%L,''Attack'',''club/attack-'||v_tag||'.pdf'',''application/pdf'',1,''a.pdf'',''other'',%L)', v_club, v_folder, v_mb)) <> 'OK',
    'MI-F1 an ordinary member cannot add a document to the club library');
  perform pg_temp.check(pg_temp.try_as(v_farca, format(
      'insert into public.document_folders (club_id, name, created_by) values (%L,''Attack'',%L)', v_club, v_farca)) <> 'OK',
    'MI-F2 nor can another club create a folder in this one by naming its id');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('delete from public.club_documents where id = %L', v_doc)) <> 'OK'
                        or (select count(*) from public.club_documents where id = v_doc) = 1,
    'MI-F3 and a member cannot delete one');
  perform pg_temp.check(pg_temp.try_as(v_farca, format(
      'insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by) values (%L,%L,''pending'',%L)', v_club, v_far, v_farca)) <> 'OK',
    'MI-F4 and cannot open a partnership in this club''s name');

  -- ---------------------------------------------------------------------------------------------
  -- MI-S  what Ovalball itself gained, named rather than assumed
  --
  -- The eleven gates 4I took were internal.is_club_admin(club) with NO site branch at all, so
  -- Ovalball could not act in a club's handover or team lifecycle even to support it. J.4 and J.5
  -- give every one of these keys a named site master, so the canonical form restores that -- as an
  -- explicit capability held by a named bundle, never as a bypass. These assertions pin exactly which
  -- profile gained what, so the widening cannot quietly spread.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.clubs.lifecycle'')')
                        and pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.support.act_in_club'')')
                        and pg_temp.bool_as(v_sa, 'internal.has_site_capability(''site.team_roles.manage'')'),
    'MI-S1 INTENDED CHANGE: a Full Site Admin holds the three site masters J.5 gives team lifecycle, handover and team management');
  perform pg_temp.check(not pg_temp.bool_as(v_ro, 'internal.has_site_capability(''site.clubs.lifecycle'')')
                        and not pg_temp.bool_as(v_sup, 'internal.has_site_capability(''site.clubs.lifecycle'')')
                        and not pg_temp.bool_as(v_data, 'internal.has_site_capability(''site.clubs.lifecycle'')'),
    'MI-S2 and no other site profile does -- a read-only, support or club-data admin cannot fold a club''s team');
  perform pg_temp.check(not pg_temp.bool_as(v_ro, 'internal.has_site_capability(''site.support.act_in_club'')')
                        and not pg_temp.bool_as(v_sup, 'internal.has_site_capability(''site.support.act_in_club'')')
                        and pg_temp.bool_as(v_sup, 'internal.has_site_capability(''site.support.view_club'')'),
    'MI-S3 site support may LOOK at a club''s handover and not act in it -- the read and write masters are different keys');
  perform pg_temp.check(not pg_temp.bool_as(v_ro, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_data, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_sa, format('internal.can(''team.handover.apply'',''club'',%L,null,null)', v_club)),
    'MI-S4 and no site profile holds the CLUB-scoped key itself -- Ovalball acts through its own master, never by being treated as a member');

  -- ---------------------------------------------------------------------------------------------
  -- MI-G  retirement: 4I's own, and the remainder classified
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not exists (select 1 from pg_policies where schemaname in ('public','storage')
                  and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\m(can_manage_document_library|can_view_document_library)\('),
    'MI-G1 no policy asks a document-library helper any more');
  perform pg_temp.check(
    not exists (select 1 from pg_policies where schemaname in ('public','storage')
                  and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\mis_club_admin\('),
    'MI-G2 and no policy anywhere asks is_club_admin (4H''s result, still standing)');
  perform pg_temp.check(
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','internal') and p.proname<>'is_club_admin' and p.prosrc ~ '\mis_club_admin\(') = 3,
    'MI-G3 exactly three is_club_admin bodies remain: 4c''s fixtures helper, 4b''s team helper, and 4c''s restoration RPC');
  perform pg_temp.check(
    not exists (select 1 from public.capability_key_map
                where legacy_key in ('club.season_rollover.manage','club.team_lifecycle.manage','partner.manage')),
    'MI-G4 the three Slice 4I adapter rows are retired');
  perform pg_temp.check(
    exists (select 1 from public.capability_key_map where legacy_key='club.teams.manage')
    and exists (select 1 from public.capability_key_map where legacy_key='club.guardians.manage')
    and exists (select 1 from public.capability_key_map where legacy_key='fixture.edit'),
    'MI-G5 and 4b''s, 4a''s and 4c''s are NOT -- this slice did not reach zero with theirs');
  perform pg_temp.check(
    (select count(*) from pg_policies where (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\mcan_manage_club_fixtures\(') = 1,
    'MI-G6 one can_manage_club_fixtures policy remains -- player_team_dispensation_select, which is 4c''s');
  -- The eighteen RPCs Slice 4C left to the slice that owns the meaning of the call site.
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname = 'public' and p.proname in (
                  'handover_apply_blockers','handover_audit','handover_consequences','handover_team_labels',
                  'rollover_placement_options','generate_rollover_proposal','generate_rollover_player_proposals',
                  'confirm_rollover_team_proposal','confirm_mixed_boundary_rollover','undo_rollover_team_decision',
                  'resolve_rollover_group_flag','set_rollover_player_placement','set_rollover_player_planned_placement',
                  'clear_rollover_player_placement','mark_graduating_player_left','respond_to_club_partnership',
                  'revoke_club_partnership','create_partner_invitation')
                  and p.prosrc ~ '\m(can_manage_club_fixtures|is_site_admin|is_full_site_admin|is_club_admin)\('),
    'MI-G7 and none of the eighteen handover, placement and partnership RPCs asks a legacy helper');
  perform pg_temp.check(
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','internal') and p.proname <> 'can_manage_club_fixtures'
       and p.prosrc ~ '\mcan_manage_club_fixtures\(') = 9,
    'MI-G8 nine can_manage_club_fixtures bodies remain: 4a''s dead can_manage_player and eight of 4d''s tournament functions');

  -- ---------------------------------------------------------------------------------------------
  -- MI-P  the hoist is an optimisation, not a change of answer
  -- ---------------------------------------------------------------------------------------------
  v_ok := true;
  foreach v_ms in array array[v_ca, v_fs, v_vo, v_mb, v_co, v_tm, v_str, v_farca, v_sa, v_sup, v_ro, v_data] loop
    if pg_temp.count_as(v_ms, 'select count(*) from public.club_documents')
       is distinct from pg_temp.count_as(v_ms, 'select pg_temp.unhoisted_docs()') then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'MI-P1 the hoisted document policy and the per-row question select the same rows, for all twelve personas');
  perform pg_temp.check(
    (select count(*) from pg_policies where tablename in ('club_documents','document_folders')
       and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~* 'in \( select unnest\(internal\.club_ids_with') = 8,
    'MI-P2 and all eight document policies use the subquery form the planner folds');
end $$;

rollback;
