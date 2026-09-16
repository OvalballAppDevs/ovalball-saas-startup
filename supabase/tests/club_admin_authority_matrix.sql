-- =====================================================================================================
-- CLUB ADMIN AUTHORITY MATRIX  (Identity/Auth Slice 4H, Phase 2 AA.3 row 4h)
--
-- The domain matrix AA.3 names for 4h, over the ten tables the programme ledger assigns to this slice
-- and the finance surface J.13 governs. DETERMINISTIC and SELF-SEEDING: every club, team, person,
-- membership, invitation, contact and finance row it needs, it creates. It reads no UAT seed identity,
-- so it cannot pass green with zero assertions on a clean database.
--
-- Contract: design J.3, J.4, J.5, J.13 and section S "Club Admin boundary".
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
  values (v,'Cam',p_label,'cam-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date);
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

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','cam-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
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

-- The per-row question the hoisted set replaced, kept so CH-P can compare them.
create or replace function pg_temp.unhoisted_members(p_club uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.club_memberships m
  where m.user_id = auth.uid()
     or internal.has_site_capability('site.users.view')
     or internal.can('people.member.view', 'club', m.club_id, null, null);
$$;
grant execute on function pg_temp.unhoisted_members(uuid) to public;

-- =====================================================================================================
-- CH-A. The catalogue and the boundary, structurally.
-- =====================================================================================================
do $$
declare r record;
begin
  for r in select * from (values
    ('people.member.view','{club}'), ('people.member.view_contact','{club}'),
    ('people.invitation.create','{club}'), ('people.invitation.revoke','{club}'),
    ('people.join_request.review','{club}'), ('people.membership.suspend','{club}'),
    ('people.membership.revoke','{club}'), ('people.role.assign_club','{club}'),
    ('club.profile.view','{club}'), ('club.profile.edit','{club}'), ('club.settings.manage','{club}'),
    ('club.reporting.export','{club}'),
    ('finance.subscription.view','{club}'), ('finance.subscription.configure','{club}'),
    ('finance.enrolment.manage','{club}'), ('finance.payment.act','{club}'),
    ('finance.subscription.export','{club}'), ('finance.gocardless.connect','{club}'),
    ('finance.platform_billing.view','{club}'), ('finance.platform_billing.manage','{club}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c where c.key = r.key and c.status='ACTIVE' and c.valid_scopes::text = r.scopes),
      format('CH-A %s is ACTIVE with scopes %s', r.key, r.scopes));
  end loop;

  -- Section S: an export of personal data needs R and an event. The capability carries the R.
  perform pg_temp.check(
    (select aal from public.capabilities where key='club.reporting.export') = 'R'
    and exists (select 1 from public.security_event_types where event_type='export.generated' and requires_reason),
    'CH-A1 club.reporting.export is AAL R and export.generated requires a reason (section S)');
  -- J.13: Site Admins never act on club payments, so the acting finance keys have no site master and
  -- no site bundle holds them.
  perform pg_temp.check(
    not exists (select 1 from public.bundle_capabilities
                where capability_key in ('finance.payment.act','finance.subscription.configure','finance.enrolment.manage',
                                         'finance.subscription.export','finance.gocardless.connect')
                  and bundle_key like 'SITE_%'),
    'CH-A2 no site bundle holds a key that acts on a club''s money (J.13)');
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='people.membership.suspend') = 1
    and exists (select 1 from public.bundle_capabilities where capability_key='people.membership.suspend' and bundle_key='CA'),
    'CH-A3 suspending a membership is the Club Admin''s alone (J.3 line 390)');
end $$;

-- =====================================================================================================
-- CH-B .. CH-P. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_far uuid; v_team uuid; v_ms uuid;
  v_ca uuid; v_fs uuid; v_vo uuid; v_mb uuid; v_co uuid; v_so uuid; v_str uuid; v_farca uuid; v_pg uuid; v_player uuid;
  v_sa uuid; v_sup uuid; v_ro uuid; v_ops uuid;
  v_inv uuid; v_join uuid; v_contact uuid; v_tcontact uuid; v_note uuid;
  v_tag text := substr(gen_random_uuid()::text,1,8); n int; v_ok boolean;
begin
  v_club := pg_temp.club('Home'); v_far := pg_temp.club('Far');
  v_team := pg_temp.team(v_club,'U12');

  v_ca  := pg_temp.person('CA');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_ca,'CLUB_ADMIN','active');
  v_fs  := pg_temp.person('FS');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_fs,'FIXTURE_SECRETARY','active');
  v_mb  := pg_temp.person('MB');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_mb,'BASIC_USER','active');
  v_vo  := pg_temp.person('VO');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_vo,'BASIC_USER','active') returning id into v_ms;
  insert into public.role_assignments (club_id,user_id,membership_id,role_key,state,source,granted_by)
  values (v_club,v_vo,v_ms,'VOLUNTEER','ACTIVE','CLUB_ADMIN_ASSIGNMENT',v_ca);
  v_co  := pg_temp.person('CO');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_co,'BASIC_USER','active') returning id into v_ms;
  insert into public.team_permissions (membership_id,team_id,permission) values (v_ms,v_team,'coach');
  v_so  := pg_temp.person('SO');  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_so,'BASIC_USER','active') returning id into v_ms;
  insert into public.role_assignments (club_id,user_id,membership_id,role_key,state,source,confirmation_state,confirmed_at,granted_by,attributes)
  values (v_club,v_so,v_ms,'SAFEGUARDING_OFFICER','ACTIVE','LEGACY_BACKFILL','CONFIRMED',now(),v_ca,jsonb_build_object('officer_type','primary'));
  v_str := pg_temp.person('STR');
  v_farca := pg_temp.person('FARCA'); insert into public.club_memberships (club_id,user_id,role,status) values (v_far,v_farca,'CLUB_ADMIN','active');
  -- A guardian with no membership at all, reaching the club only through their child's place. The one
  -- persona that proves internal.club_ids_with follows bundle_source rather than the membership table.
  v_pg := pg_temp.person('PG');
  insert into public.players (first_name,surname,active,created_by,playing_pathway,date_of_birth)
  values ('Cam','Child',true,v_ca,'MALE',(current_date - interval '11 years')::date) returning id into v_player;
  insert into public.player_team_memberships (player_id,team_id,status,state,source) values (v_player,v_team,'active','ACTIVE','CLUB_CREATED');
  insert into public.guardians (guardian_user_id,player_id,relationship_type,status,state) values (v_pg,v_player,'parent','active','ACTIVE');

  v_sa  := pg_temp.person('SA');  insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');
  v_sup := pg_temp.person('SUP'); insert into public.site_admins (user_id,status,admin_role) values (v_sup,'active','user_access');
  v_ro  := pg_temp.person('RO');  insert into public.site_admins (user_id,status,admin_role) values (v_ro,'active','read_only');
  v_ops := pg_temp.person('OPS'); insert into public.site_admins (user_id,status,admin_role) values (v_ops,'active','fixture_ops');

  insert into public.club_contacts (club_id, role, name, email, is_public)
  values (v_club,'general','Private Desk','desk-'||v_tag||'@ovalball.test',false) returning id into v_contact;
  insert into public.team_contacts (team_id, role, name, email, is_public)
  values (v_team,'team_manager','Team Desk','tdesk-'||v_tag||'@ovalball.test',false) returning id into v_tcontact;
  insert into public.club_opponent_notes (owning_club_id, directory_id, notes, created_by)
  values (v_club, (select directory_id from public.clubs where id = v_far), 'cam note '||v_tag, v_ca) returning id into v_note;
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
  values (v_club, v_str, 'CLUB_ADMIN', 'pending') returning id into v_join;

  -- ---------------------------------------------------------------------------------------------
  -- CH-B  the ten tables, persona by persona
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.count_as(v_ca,  format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7,
    'CH-B1 the Club Admin reads their club''s membership list');
  perform pg_temp.check(pg_temp.count_as(v_fs,  format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7,
    'CH-B2 so does the Fixtures Secretary (J.3 line 385 gives people.member.view to CA, FS and SO)');
  perform pg_temp.check(pg_temp.count_as(v_so,  format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7,
    'CH-B3 and the Safeguarding Officer');
  perform pg_temp.check(pg_temp.count_as(v_mb,  format('select count(*) from public.club_memberships where club_id = %L', v_club)) = 1,
    'CH-B4 an ordinary member sees only their own row');
  perform pg_temp.check(pg_temp.count_as(v_farca, format('select count(*) from public.club_memberships where club_id = %L', v_club)) = 0,
    'CH-B5 and another club''s admin sees none of it');
  -- WHICH SITE PROFILE, specifically. J.3 line 385 gives people.member.view the site master
  -- site.users.view, which SITE_SUPPORT holds and which is most of what user support does. Asserting
  -- "a Site Admin can" would have been satisfied by any site branch at all, including one wide enough
  -- to hand a club's roll to every profile -- a mutation that did exactly that survived until this.
  perform pg_temp.check(pg_temp.count_as(v_sup, format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7,
    'CH-B5b a user-support Site Admin reads the club roll -- site.users.view (J.3 line 385)');
  -- site.users.view is DELIBERATELY broad -- every site profile holds it, because seeing who a person
  -- is at a club is the first thing any support question needs. So a read-only Site Admin reading the
  -- roll is correct, and stating it is what stops somebody "tightening" it later by accident.
  perform pg_temp.check(
    pg_temp.count_as(v_ro,  format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7
    and pg_temp.count_as(v_ops, format('select count(*) from public.club_memberships where club_id = %L', v_club)) >= 7,
    'CH-B5c and so do the read-only and fixture-ops profiles -- site.users.view is held by all six');
  -- WHICH key, by name. Every site profile holds site.users.view AND site.clubs.view, so a policy
  -- asking the wrong one of the two is invisible to any behavioural test -- a mutation that swapped
  -- them survived the whole suite. J.3 line 385 records site.users.view for people.member.view, and
  -- the difference matters the moment the two bundles stop being identical.
  perform pg_temp.check(
    (select coalesce(qual,'') from pg_policies where tablename='club_memberships' and policyname='club_memberships_select_scoped')
      ~ 'site\.users\.view'
    and (select coalesce(qual,'') from pg_policies where tablename='club_memberships' and policyname='club_memberships_select_scoped')
      !~ 'site\.clubs\.view',
    'CH-B5d and the policy asks the master J.3 records for that key by name, not a same-sized neighbour');
  -- anon is stopped by the GRANT, before any policy is consulted, and the assertion says so: a test
  -- that counted zero rows here would pass just as happily if the grant were opened and the policy
  -- were doing the work.
  perform pg_temp.check(pg_temp.try_as(null, format('select count(*) from public.club_memberships where club_id = %L', v_club)) = '42501',
    'CH-B6 and anonymous is refused the table outright, not merely filtered by it');

  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_contacts where id = %L', v_contact)) = 1
                        and pg_temp.count_as(v_mb, format('select count(*) from public.club_contacts where id = %L', v_contact)) = 1,
    'CH-B7 a private club contact is visible to the club (club.profile.view)');
  perform pg_temp.check(pg_temp.count_as(v_farca, format('select count(*) from public.club_contacts where id = %L', v_contact)) = 0,
    'CH-B8 and to nobody outside it');
  -- A signed-out visitor sees none of it. Stated as the count rather than as a refusal, deliberately:
  -- club_memberships refuses anon outright (CH-B6) and this table answers with no rows, and pinning
  -- the exact mechanism here would make the assertion about the perimeter's shape rather than about
  -- what a visitor can see -- which is the thing that must stay true either way.
  perform pg_temp.check(pg_temp.count_as(null, format('select count(*) from public.club_contacts where id = %L', v_contact)) = 0,
    'CH-B8b and a signed-out visitor sees none of this club''s private contacts');
  -- The action and the state read are sequenced explicitly. PL/pgSQL does not promise to evaluate the
  -- two halves of an AND in the order they are written, so "did the write land" written as one
  -- expression can read the row BEFORE the write -- a trap this programme fell into twice in 4E.
  declare v_res text; v_name text;
  begin
    v_res := pg_temp.try_as(v_ca, format('update public.club_contacts set name = ''Changed Desk'' where id = %L', v_contact));
    select name into v_name from public.club_contacts where id = v_contact;
    perform pg_temp.check(v_res = 'OK' and v_name = 'Changed Desk',
      'CH-B9 the Club Admin may change it (club.profile.edit)');

    v_res := pg_temp.try_as(v_fs, format('update public.club_contacts set name = ''FS Desk'' where id = %L', v_contact));
    select name into v_name from public.club_contacts where id = v_contact;
    perform pg_temp.check(v_name <> 'FS Desk',
      'CH-B10 and the Fixtures Secretary may not -- the row policy refuses the write rather than erroring');
  end;

  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_opponent_notes where id = %L', v_note)) = 1,
    'CH-B11 the club''s private opponent notes are the club administration''s');
  perform pg_temp.check(pg_temp.count_as(v_fs, format('select count(*) from public.club_opponent_notes where id = %L', v_note)) = 0
                        and pg_temp.count_as(v_farca, format('select count(*) from public.club_opponent_notes where id = %L', v_note)) = 0,
    'CH-B12 and not the Fixtures Secretary''s, nor the club they are about');

  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.club_join_requests where id = %L', v_join)) = 1,
    'CH-B13 the Club Admin sees a join request (people.join_request.review)');
  perform pg_temp.check(pg_temp.count_as(v_str, format('select count(*) from public.club_join_requests where id = %L', v_join)) = 1,
    'CH-B14 and so does the person who made it');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.club_join_requests where id = %L', v_join)) = 0,
    'CH-B15 but not an unrelated member of the club');

  insert into public.invitations (club_id, invited_email, club_role, token, created_by, expires_at, status)
  values (v_club, 'inv-'||v_tag||'@ovalball.test', 'FIXTURE_SECRETARY', 'cam-tok-'||v_tag, v_ca, now() + interval '7 days', 'pending')
  returning id into v_inv;
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.invitations where id = %L', v_inv)) = 1,
    'CH-B16 the Club Admin reads the club''s outstanding invitations');
  perform pg_temp.check(pg_temp.count_as(v_fs, format('select count(*) from public.invitations where id = %L', v_inv)) = 0
                        and pg_temp.count_as(v_mb, format('select count(*) from public.invitations where id = %L', v_inv)) = 0,
    'CH-B17 and nobody who cannot issue one does (J.3 line 387: invitations are the Club Admin''s)');

  -- ---------------------------------------------------------------------------------------------
  -- CH-C  section S, the "may not" table
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('internal.can(''club.profile.edit'',''club'',%L,null,null)', v_far)),
    'CH-C1 S: a Club Admin may not act on another club');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, 'internal.has_site_capability(''site.users.impersonate'')')
                        and not pg_temp.bool_as(v_ca, 'internal.has_site_capability(''site.memberships.manage'')'),
    'CH-C2 S: and holds no site.* key');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('internal.can(''safeguarding.conversation.handle'',''club'',%L,null,null)', v_club))
                        and not pg_temp.bool_as(v_ca, format('internal.can(''safeguarding.dispensation.view'',''club'',%L,null,null)', v_club)),
    'CH-C3 S: a Club Admin does not read safeguarding threads or dispensation views unless also an ACTIVE officer');
  perform pg_temp.check(pg_temp.bool_as(v_so, format('internal.can(''safeguarding.dispensation.view'',''club'',%L,null,null)', v_club)),
    'CH-C4 while the officer does -- so CH-C3 is a boundary, not an empty club');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('internal.can(''club.lifecycle.deactivate'',''club'',%L,null,null)', v_club)),
    'CH-C5 S: deactivating a club is not a club capability at all (J.4: RETIRE club key -> site)');

  -- ---------------------------------------------------------------------------------------------
  -- CH-D  finance: nobody at Ovalball acts on a club's money (J.13)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''finance.payment.act'',''club'',%L,null,null)', v_club)),
    'CH-D1 the Club Admin may act on their club''s payments');
  perform pg_temp.check(
    not pg_temp.bool_as(v_sa,  format('internal.can(''finance.payment.act'',''club'',%L,null,null)', v_club))
    and not pg_temp.bool_as(v_sup, format('internal.can(''finance.payment.act'',''club'',%L,null,null)', v_club))
    and not pg_temp.bool_as(v_ro,  format('internal.can(''finance.payment.act'',''club'',%L,null,null)', v_club))
    and not pg_temp.bool_as(v_ops, format('internal.can(''finance.payment.act'',''club'',%L,null,null)', v_club)),
    'CH-D2 INTENDED CHANGE: no Site Admin profile does -- not Full, not support, not read-only, not fixture ops (J.13)');
  perform pg_temp.check(
    not pg_temp.bool_as(v_ro, format('internal.can(''finance.subscription.configure'',''club'',%L,null,null)', v_club))
    and not pg_temp.bool_as(v_ops, format('internal.can(''finance.enrolment.manage'',''club'',%L,null,null)', v_club))
    and not pg_temp.bool_as(v_sup, format('internal.can(''finance.gocardless.connect'',''club'',%L,null,null)', v_club)),
    'CH-D3 nor configure a price, exempt an obligation, or touch the club''s GoCardless connection');
  perform pg_temp.check(not pg_temp.bool_as(v_farca, format('internal.can(''finance.subscription.view'',''club'',%L,null,null)', v_club)),
    'CH-D4 and another club''s admin sees none of this club''s finances');
  -- The RPCs themselves, not just the capability.
  -- Called with the REAL signature. The first version of this assertion named arguments no
  -- set_subscription_price actually has, so it passed on "function does not exist" -- and would have
  -- gone on passing if the authority inside had been removed entirely. A mutation that happened to
  -- create that signature is what exposed it.
  perform pg_temp.check(pg_temp.try_as(v_ro, format('select public.configure_subscription_programme(%L,true,1,''CLUB_PAYS'',''IMMEDIATE'')', v_club)) = '42501',
    'CH-D5 a read-only Site Admin is refused by the finance RPC itself, not merely by the capability check');
  perform pg_temp.check(pg_temp.try_as(v_ops, format('select public.start_club_trial(%L)', v_club)) = '42501',
    'CH-D5b and a fixture-ops Site Admin cannot start this club''s trial with Ovalball');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.configure_subscription_programme(%L,true,1,''CLUB_PAYS'',''IMMEDIATE'')', v_club)) <> '42501',
    'CH-D5c while the Club Admin is not refused on authority -- so CH-D5 is a boundary, not a broken call');
  perform pg_temp.check(pg_temp.try_as(v_farca, format('select public.export_finance_rows(%L,''2026-01'')', v_club)) <> 'OK',
    'CH-D6 and another club''s admin cannot export this club''s finance rows');

  -- ---------------------------------------------------------------------------------------------
  -- CH-E  the S boundary's export: capability, reason, event
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.record_club_export(%L,''player_movements'','''')', v_club)) = '22023',
    'CH-E1 an export without a reason is refused (section S: "without R and event")');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.record_club_export(%L,''player_movements'',''because'')', v_club)) = '42501',
    'CH-E2 and somebody without club.reporting.export is refused -- it is the Club Admin''s (J.4 line 410)');
  perform pg_temp.check(pg_temp.try_as(v_farca, format('select public.record_club_export(%L,''player_movements'',''borrowed'')', v_club)) = '42501',
    'CH-E3 including another club''s admin naming this club''s id');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.record_club_export(%L,''player_movements'',''matrix: checking the roll'',12)', v_club)) = 'OK',
    'CH-E4 the Club Admin may, with a reason');
  perform pg_temp.check(
    exists (select 1 from public.security_events
            where event_type = 'export.generated' and club_id = v_club
              and reason = 'matrix: checking the roll' and (metadata->>'row_count') = '12'),
    'CH-E5 and it leaves an export.generated event carrying the reason and how much left');

  -- ---------------------------------------------------------------------------------------------
  -- CH-F  attacks: the ids in the payload are not authority
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_farca, format(
      'insert into public.invitations (club_id, invited_email, club_role, token, created_by, expires_at, status) '
      || 'values (%L,''attack@ovalball.test'',''FIXTURE_SECRETARY'',''cam-attack-'||v_tag||''',%L, now() + interval ''7 days'',''pending'')',
      v_club, v_farca)) <> 'OK',
    'CH-F1 another club''s admin cannot write an invitation into this club by naming its id');
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'insert into public.club_contacts (club_id, role, name, email, is_public) values (%L,''general'',''Attack'',''a@ovalball.test'',false)', v_club)) <> 'OK',
    'CH-F2 an ordinary member cannot add a club contact');
  perform pg_temp.check(pg_temp.try_as(v_co, format(
      'insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, canonical_team_type_id) '
      || 'values (%L,''Under 13 Boys'',''cam-attack-'||v_tag||''',''youth'',''U13'',''boys'',''union'',true,(select id from public.canonical_team_types limit 1))', v_club)) <> 'OK',
    'CH-F3 a Coach cannot create a team -- team.team.manage is the club''s, not a team role''s');
  perform pg_temp.check(pg_temp.try_as(v_mb, format(
      'update public.club_join_requests set status = ''approved'' where id = %L', v_join)) <> 'OK'
    or (select status from public.club_join_requests where id = v_join) = 'pending',
    'CH-F4 a member cannot approve a join request by updating the row');
  perform pg_temp.check(pg_temp.try_as(v_farca, format(
      'update public.club_opponent_notes set notes = ''rewritten'' where id = %L', v_note)) <> 'OK'
    or (select notes from public.club_opponent_notes where id = v_note) <> 'rewritten',
    'CH-F5 and the club a note is ABOUT cannot rewrite it');
  perform pg_temp.check(pg_temp.try_as(null, format('select count(*) from public.invitations where id = %L', v_inv)) = '42501'
                        and pg_temp.try_as(null, format('select count(*) from public.club_opponent_notes where id = %L', v_note)) = '42501',
    'CH-F6 anonymous is refused invitations and opponent notes at the grant');

  -- ---------------------------------------------------------------------------------------------
  -- CH-G  retirement
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not exists (select 1 from pg_policies where schemaname in ('public','storage')
                  and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\minternal\.is_club_admin\('),
    'CH-G1 no policy anywhere decides authority with is_club_admin');
  perform pg_temp.check(
    not exists (select 1 from public.capability_key_map where legacy_key in (
      'club.edit_profile','club.subscription.view_finance','club.subscription.configure',
      'club.subscription.manage_enrolment','club.subscription.manage_payment_actions','club.subscription.export',
      'club.gocardless.connect','club.platform_billing.view','club.platform_billing.manage',
      'club.capabilities.manage','permissions.club_manage')),
    'CH-G2 the eleven Slice 4H adapter rows are retired');
  -- 4H's point here was that it did not improve its own count by consuming another slice's rows.
  -- 4A's club.guardians.manage still stands, and stands for that. 4I has since retired its own
  -- club.season_rollover.manage on its own letter, which is the opposite of what this guards against.
  perform pg_temp.check(
    exists (select 1 from public.capability_key_map where legacy_key = 'club.guardians.manage'),
    'CH-G3 and the row belonging to 4a is NOT -- this slice did not improve its count with another''s');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname in ('public','internal')
                  and p.prosrc ~ '''(club\.(subscription|platform_billing|gocardless|edit_profile|capabilities)[a-z_.]*|permissions\.club_manage)'''),
    'CH-G4 and nothing in the database asks a retired key');
  -- Likewise: 4C's fixtures helper was named, not taken, and it is still named. 4I's handover RPCs
  -- were named here too and have since been taken by 4I itself.
  perform pg_temp.check(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='internal' and p.proname='can_manage_club_fixtures' and p.prosrc ~ '\mis_club_admin\('),
    'CH-G5 4C''s fixtures helper still holds its own -- named, not taken');

  -- ---------------------------------------------------------------------------------------------
  -- CH-P  the hoist is an optimisation, not a change of answer
  -- ---------------------------------------------------------------------------------------------
  v_ok := true;
  foreach v_ms in array array[v_ca, v_fs, v_vo, v_mb, v_co, v_so, v_pg, v_str, v_farca, v_sa, v_sup, v_ro, v_ops] loop
    if pg_temp.count_as(v_ms, 'select count(*) from public.club_memberships')
       is distinct from pg_temp.count_as(v_ms, format('select pg_temp.unhoisted_members(%L)', v_club)) then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'CH-P1 the hoisted policy and the per-row question select the same rows, for all thirteen personas');
  -- THE GUARDIAN IS THE POINT. They have no membership row anywhere, and reach the club only through
  -- their child's place in one of its teams. A hoisted set built from memberships alone would have
  -- dropped them, and every parent with them.
  -- safeguarding.contact.view, not club.profile.view: J.4 line 405 does not give a guardian the club
  -- profile, and J.12 line 542 does give them the safeguarding contact card. Asking the wrong key here
  -- would have made this assertion fail for the right reason and look like a broken hoist.
  perform pg_temp.check(
    pg_temp.count_as(v_pg, 'select coalesce(array_length(internal.club_ids_with(''safeguarding.contact.view''),1),0)') = 1
    and pg_temp.count_as(v_pg, format('select count(*) from public.club_memberships where user_id = %L', v_pg)) = 0,
    'CH-P2 a guardian with no membership still reaches their child''s club through the hoisted set');
  perform pg_temp.check(
    pg_temp.count_as(v_str, 'select coalesce(array_length(internal.club_ids_with(''club.profile.view''),1),0)') = 0
    and pg_temp.count_as(v_farca, 'select coalesce(array_length(internal.club_ids_with(''people.member.view''),1),0)') = 1,
    'CH-P3 a stranger''s set is empty, and another club''s admin''s names only their own club');
  -- anon must be able to CALL it, because a signed-out visitor reading a published club article
  -- evaluates clubs_select transitively through that article's own policy. What matters is that the
  -- answer tells them nothing, and that they still cannot read the ten tables directly.
  perform pg_temp.check(
    has_function_privilege('anon','internal.club_ids_with(text)','EXECUTE')
    and pg_temp.count_as(null, 'select coalesce(array_length(internal.club_ids_with(''club.profile.view''),1),0)') = 0
    and pg_temp.count_as(null, 'select coalesce(array_length(internal.club_ids_with(''people.member.view''),1),0)') = 0,
    'CH-P4 anon may call the hoist -- a public article reaches clubs_select through its own policy -- and always gets an empty set');
  -- The same grant, and the same reason: every one of these policies asks a site capability too, and
  -- internal.is_site_admin (what they used to ask) was already anon-executable.
  perform pg_temp.check(
    has_function_privilege('anon','internal.has_site_capability(text)','EXECUTE')
    and not pg_temp.bool_as(null, 'internal.has_site_capability(''site.clubs.view'')'),
    'CH-P4b anon may call has_site_capability -- 44 public-targeted policies need it -- and is told no');
  perform pg_temp.check(
    not (select bool_or(has_table_privilege('anon','public.'||x,'SELECT'))
         from unnest(array['clubs','teams','club_memberships','role_assignments','club_join_requests',
                           'invitations','invitation_teams','club_contacts','team_contacts','club_opponent_notes']) x),
    'CH-P5 while anon still holds no direct SELECT on any of the ten tables');
end $$;

rollback;
