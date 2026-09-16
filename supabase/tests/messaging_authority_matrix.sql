-- =====================================================================================================
-- MESSAGING AUTHORITY MATRIX  (Identity/Auth Slice 4F, Phase 2 AA.3 row 4f)
--
-- The domain matrix AA.3 names for 4f. DETERMINISTIC and SELF-SEEDING: every club, team, person,
-- conversation, message and report it needs, it creates -- including its own season. It never reads
-- a UAT seed identity, so it cannot skip into a green zero-assertion pass on a clean database.
--
-- Contract under test: design J.10 lines 511-523, and section T "Reports".
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
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mam-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Mam',p_label,'mam-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MAM '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mam-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'mam-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','mam-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
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

-- A Safeguarding Officer using the role Slice 2 ALREADY models. This creates no 4G machinery: no
-- nomination, no invitation, no confirmation flow -- just the assignment row the state machine and
-- the SO bundle already understand.
create or replace function pg_temp.safeguarding_officer(p_club uuid, p_user uuid, p_by uuid) returns void language plpgsql as $$
declare v_m uuid;
begin
  v_m := pg_temp.member(p_club, p_user, 'BASIC_USER');
  insert into public.role_assignments (club_id, user_id, membership_id, role_key, state, source, confirmation_state, granted_by)
  values (p_club, p_user, v_m, 'SAFEGUARDING_OFFICER', 'ACTIVE', 'LEGACY_BACKFILL', 'CONFIRMED', p_by);
end $$;

create or replace function pg_temp.staffs(p_user uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select internal.team_messaging_staff(p_user, p_team);
$$;
grant execute on function pg_temp.staffs(uuid,uuid) to public;

-- may_send_as reads auth.uid(), so a definer wrapper called AS the subject is the honest way to
-- ask it; internal is not on any browser role's EXECUTE list and must not become so.
create or replace function pg_temp.send_as(p_identity_type text, p_identity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select internal.may_send_as(p_identity_type, p_identity_id);
$$;
grant execute on function pg_temp.send_as(text,uuid) to public;

-- The read policy exactly as it stood BEFORE Slice 4F guarded its first term, evaluated over every
-- row rather than through RLS. MA-L uses it to show the guard changed no row's visibility: it is a
-- definer function, so it sees the whole table, and it reads auth.uid() so it answers AS the caller.
create or replace function pg_temp.unguarded_visible_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.fixture_messages m
  where internal.can_access_any_conversation(m.fixture_id, m.fixture_request_id, m.club_conversation_id)
     or (m.team_conversation_id is not null and internal.can_view_team_conversation(m.team_conversation_id))
     or (m.safeguarding_conversation_id is not null and internal.can_view_safeguarding_conversation(m.safeguarding_conversation_id))
     or (m.announcement_id is not null and internal.can_view_announcement_reply(m.announcement_id, m.sender_user_id))
     or (m.direct_conversation_id is not null and internal.can_view_direct_conversation(m.direct_conversation_id));
$$;
grant execute on function pg_temp.unguarded_visible_count() to public;

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
-- MA-A. The catalogue says what J.10 says. Structural, so it cannot pass by accident.
-- =====================================================================================================
do $$
declare r record; n int;
begin
  for r in select * from (values
    ('messaging.fixture_conversation.participate','{club,team}'), ('messaging.team_conversation.view','{team,child}'),
    ('messaging.team_conversation.send','{team,child}'), ('messaging.announcement.send_club','{club}'),
    ('messaging.announcement.send_team','{club,team}'), ('messaging.club_conversation.manage','{club}'),
    ('messaging.policy.manage','{club}'), ('messaging.block.manage','{club}'), ('messaging.direct.send','{self}'),
    ('messaging.report.submit','{self}'), ('messaging.moderation.club_review','{club}'),
    ('site.messages.moderate','{site}'), ('site.messages.policy.manage','{site}')
  ) as t(key, scopes) loop
    perform pg_temp.check(
      exists (select 1 from public.capabilities c where c.key = r.key and c.status='ACTIVE' and c.valid_scopes::text = r.scopes),
      format('MA-A %s is ACTIVE with scopes %s (J.10)', r.key, r.scopes));
  end loop;

  -- J.10 line 518: blocking is a Club Admin and a Safeguarding Officer, NOT a Fixtures Secretary.
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='messaging.block.manage') = 2
    and exists (select 1 from public.bundle_capabilities where capability_key='messaging.block.manage' and bundle_key='SO')
    and not exists (select 1 from public.bundle_capabilities where capability_key='messaging.block.manage' and bundle_key='FS'),
    'MA-A messaging.block.manage is CA and SO, and not FS -- blocking is moderation, not fixtures');
  -- J.10 line 520: the club report queue is the Safeguarding Officer's alone.
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='messaging.moderation.club_review') = 1
    and exists (select 1 from public.bundle_capabilities where capability_key='messaging.moderation.club_review' and bundle_key='SO'),
    'MA-A messaging.moderation.club_review reaches only the Safeguarding Officer (J.10 line 520)');

  -- AA.3 row 4f, the three named items, asserted as ABSENT rather than merely unreferenced.
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='internal' and p.proname in ('staffs_team','is_messaging_staff')),
    'MA-A staffs_team and is_messaging_staff are dropped, not merely uncalled (AA.3 row 4f)');
  select count(*) into n from pg_policies
  where schemaname='public' and tablename in ('team_conversations','club_message_blocks','fixture_messages','club_conversations')
    and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '\mis_site_admin\(';
  perform pg_temp.check(n = 0, 'MA-A no messaging conversation policy carries the Site Admin blanket read');
  perform pg_temp.check(
    not exists (select 1 from public.capability_key_map where legacy_key = 'team.community.manage'),
    'MA-A the team.community.manage adapter rows are retired');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname in ('public','internal')
                  and p.proname not in ('admin_role_for_site_profile','site_profile_for_admin_role')
                  and p.prosrc like '%message_moderator%'),
    'MA-A the message_moderator role literal decides no authority (J.10 line 521 RENAME)');

  -- 4F's own boundary against safeguarding still holds. This began as "none of 4G's surfaces exist",
  -- which was the right assertion while 4G was unstarted and the wrong one the moment it landed --
  -- a test that has to be deleted to let the next slice in was pinning the calendar, not the
  -- contract. What 4F actually owes is that MESSAGING reporting routes to the officer through a
  -- capability and never through the safeguarding thread store, and that is what is asserted now.
  perform pg_temp.check(
    exists (select 1 from pg_policies where policyname='club_safeguarding_officer_conversations_select'),
    'MA-A the safeguarding conversation policy exists and is safeguarding''s, not messaging''s');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname in ('report_message','club_message_reports')
                  and p.prosrc ~ 'club_safeguarding_officer_conversations'),
    'MA-A reporting a message never touches the safeguarding thread store -- the SO queue is a capability, not a join');
  perform pg_temp.check(
    (select count(*) from public.bundle_capabilities where capability_key='messaging.moderation.club_review') = 1,
    'MA-A and the club review queue is still exactly one bundle wide');
end $$;

-- =====================================================================================================
-- MA-B..MA-H. The behavioural matrix, on a world this test builds itself.
-- =====================================================================================================
do $$
declare
  v_ca uuid; v_fs uuid; v_tm uuid; v_tm2 uuid; v_co uuid; v_mb uuid; v_so uuid; v_sa uuid; v_far uuid; v_str uuid;
  v_club uuid; v_far_club uuid; v_team uuid; v_team2 uuid; v_m uuid; v_season uuid;
  v_fixture uuid; v_conv uuid; v_msg uuid; v_tmsg uuid; v_report uuid; v_report2 uuid;
  v_smod uuid; v_ann uuid; v_dc uuid; v_dmsg uuid; v_ok boolean; v_ok2 boolean;
  v_tag text := substr(gen_random_uuid()::text,1,8); n int;
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
  v_so := pg_temp.person('SO'); perform pg_temp.safeguarding_officer(v_club, v_so, v_ca);
  v_sa := pg_temp.person('SA'); insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');
  -- A message-moderator Site Admin: SITE_MOD holds site.messages.moderate and NOT
  -- site.support.act_in_club, which is what makes MA-K able to tell the two site masters apart.
  v_smod := pg_temp.person('SMOD'); insert into public.site_admins (user_id,status,admin_role) values (v_smod,'active','message_moderator');

  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('MAM Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'mam-'||v_tag) returning id into v_season;
  end if;

  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_team,'Home','MAM External RFC',current_date+20,'Booked','club_created',v_season) returning id, conversation_id into v_fixture, v_conv;
  insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind)
  values (v_fixture, v_conv, v_co, 'MAM fixture message '||v_tag, 'message') returning id into v_msg;
  insert into public.team_conversations (team_id, active, enabled_by) values (v_team, true, v_ca);
  insert into public.fixture_messages (team_conversation_id, sender_user_id, body, kind)
  values (v_team, v_co, 'MAM team message '||v_tag, 'message') returning id into v_tmsg;

  -- ---------------------------------------------------------------------------------------------
  -- MA-B  fixture conversations (J.10 line 511): the Site Admin blanket read is gone
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B1 the Club Admin reaches their club''s fixture conversation');
  perform pg_temp.check(pg_temp.bool_as(v_fs, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B2 so does the Fixtures Secretary');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B3 and that team''s Manager');
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B4 and its Coach -- J.10 names CA, FS, CO and TM of either side');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B5 but not another team''s Manager');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B6 nor an ordinary club Member');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B7 nor another club');
  perform pg_temp.check(not pg_temp.bool_as(v_so, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B8 nor the Safeguarding Officer -- a report queue is not a licence to read every conversation');

  -- AN EXPLICIT PARTICIPANT still reaches the thread. This branch is not a capability question at
  -- all: a referee or a neutral-ground contact holds nothing at either club, and is in the
  -- conversation because somebody added them. 4F's first draft of the gate dropped it while
  -- rewriting the capability branches around it, and no persona noticed because the table is empty
  -- in development -- so the check is here now, by name.
  perform pg_temp.check(not pg_temp.bool_as(v_str, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B9 a stranger reaches nothing before being added');
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by)
  values (v_fixture, v_str, v_ca);
  perform pg_temp.check(pg_temp.bool_as(v_str, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B10 and reaches it once added -- an explicit participant row is its own route in');
  perform pg_temp.check(pg_temp.count_as(v_str, format('select count(*) from public.fixture_messages where fixture_id = %L',v_fixture)) > 0,
    'MA-B11 and the row policy agrees, so the added person can actually read the thread');
  delete from public.fixture_conversation_participants where fixture_id = v_fixture and user_id = v_str;
  perform pg_temp.check(not pg_temp.bool_as(v_str, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B12 and loses it again when the participant row is removed');
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('internal.can_access_fixture_conversation(%L,null)',v_fixture)),
    'MA-B9 site moderation reaches it through site.messages.moderate, not through being Site Admin');
  perform pg_temp.check(pg_temp.bool_as(v_sa,'internal.has_site_capability(''site.messages.moderate'')')
                        and not pg_temp.bool_as(v_ca,'internal.has_site_capability(''site.messages.moderate'')'),
    'MA-B10 and that capability is a site one, which no club role holds');

  -- MA-C  team conversations (J.10 512-513, KEEP LOGIC)
  perform pg_temp.check(pg_temp.bool_as(v_co, format('internal.can_view_team_conversation(%L)',v_team)),
    'MA-C1 the team''s Coach reads the team conversation');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can_view_team_conversation(%L)',v_team)),
    'MA-C2 so does the Club Admin, club-wide');
  perform pg_temp.check(not pg_temp.bool_as(v_tm2, format('internal.can_view_team_conversation(%L)',v_team)),
    'MA-C3 another team''s Manager does not');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('internal.can_view_team_conversation(%L)',v_team)),
    'MA-C4 nor another club');
  perform pg_temp.check(pg_temp.count_as(v_co, format('select count(*) from public.team_conversations where team_id = %L',v_team)) = 1,
    'MA-C5 and the row policy agrees with the gate');
  perform pg_temp.check(pg_temp.count_as(v_far, format('select count(*) from public.team_conversations where team_id = %L',v_team)) = 0,
    'MA-C6 while another club reads no row');

  -- MA-D  blocking (J.10 518) -- INTENDED CHANGES: FS loses it, SO gains it
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''messaging.block.manage'',''club'',%L,null,null)',v_club)),
    'MA-D1 the Club Admin may block someone from the club''s conversations');
  perform pg_temp.check(pg_temp.bool_as(v_so, format('internal.can(''messaging.block.manage'',''club'',%L,null,null)',v_club)),
    'MA-D2 INTENDED CHANGE: so may the Safeguarding Officer, who could not before');
  perform pg_temp.check(not pg_temp.bool_as(v_fs, format('internal.can(''messaging.block.manage'',''club'',%L,null,null)',v_club)),
    'MA-D3 INTENDED CHANGE: the Fixtures Secretary may not -- blocking is moderation, not fixtures');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.block_user_from_club_messages(%L,%L,''test'')',v_club,v_mb)) = '42501',
    'MA-D4 and the RPC refuses them, not merely the capability check');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.block_user_from_club_messages(%L,%L,''test'')',v_club,v_str)) = '42501',
    'MA-D5 an ordinary Member is refused too');

  -- MA-E  the club message policy (J.10 517/522)
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('internal.can(''messaging.policy.manage'',''club'',%L,null,null)',v_club)),
    'MA-E1 the Club Admin manages the club message policy');
  perform pg_temp.check(not pg_temp.bool_as(v_fs, format('internal.can(''messaging.policy.manage'',''club'',%L,null,null)',v_club)),
    'MA-E2 the Fixtures Secretary does not');
  perform pg_temp.check(pg_temp.bool_as(v_sa,'internal.has_site_capability(''site.messages.policy.manage'')'),
    'MA-E3 INTENDED CHANGE: site policy authority is now an explicit named capability');

  -- ---------------------------------------------------------------------------------------------
  -- MA-F  section T "Reports": ONE ROW PER REPORT
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.try_as(v_co, format('select public.report_message(%L,''my own message'')',v_msg)) = '42501',
    'MA-F1 you cannot report your own message');
  perform pg_temp.check(pg_temp.try_as(v_far, format('select public.report_message(%L,''not mine to see'')',v_msg)) = '42501',
    'MA-F2 nor one in a conversation you cannot reach -- reporting never confirms a message exists');
  perform pg_temp.check(pg_temp.try_as(v_tm, format('select public.report_message(%L,'''')',v_msg)) <> 'OK',
    'MA-F3 a reason is required');
  perform pg_temp.check(pg_temp.try_as(v_tm, format('select public.report_message(%L,''first reporter'')',v_msg)) = 'OK',
    'MA-F4 the Team Manager reports the message');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.report_message(%L,''second reporter'')',v_msg)) = 'OK',
    'MA-F5 and a SECOND person reports the same message');
  select count(*) into n from public.message_reports where message_id = v_msg;
  perform pg_temp.check(n = 2,
    format('MA-F6 both reports exist as their own rows -- no overwrite (section T); found %s', n));
  perform pg_temp.check(
    (select count(distinct reason) from public.message_reports where message_id = v_msg) = 2,
    'MA-F7 and the first reporter''s reason was not replaced by the second''s');
  perform pg_temp.check(
    (select club_id from public.message_reports where message_id = v_msg limit 1) = v_club,
    'MA-F8 each report carries the club whose Safeguarding Officer queue it joins');
  perform pg_temp.check(pg_temp.try_as(v_tm, format('select public.report_message(%L,''same person again'')',v_msg)) = 'OK'
                        and (select count(*) from public.message_reports where message_id = v_msg) = 2,
    'MA-F9 one person reporting twice updates their own row rather than inflating the queue');

  -- MA-G  the club queue (J.10 520) is the Safeguarding Officer's
  perform pg_temp.check(pg_temp.try_as(v_so, format('select * from public.club_message_reports(%L)',v_club)) = 'OK',
    'MA-G1 the Safeguarding Officer reads the club report queue');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select * from public.club_message_reports(%L)',v_club)) = '42501',
    'MA-G2 a Club Admin does NOT -- section T routes reports to the SO, and a report may be about a CA');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select * from public.club_message_reports(%L)',v_club)) = '42501',
    'MA-G3 nor the Fixtures Secretary');
  perform pg_temp.check(pg_temp.try_as(v_far, format('select * from public.club_message_reports(%L)',v_club)) = '42501',
    'MA-G4 nor another club');
  perform pg_temp.check(pg_temp.try_as(v_sa, format('select * from public.club_message_reports(%L)',v_club)) = 'OK',
    'MA-G5 Ovalball moderation reads it too -- section T routes to BOTH');
  perform pg_temp.check(pg_temp.count_as(v_so, format('select count(*) from public.message_reports where club_id = %L',v_club)) = 2,
    'MA-G6 and the row policy agrees: the SO sees both reports');
  perform pg_temp.check(pg_temp.count_as(v_ca, format('select count(*) from public.message_reports where club_id = %L',v_club)) = 1,
    'MA-G7 while the Club Admin sees only the one they filed themselves');
  perform pg_temp.check(pg_temp.count_as(v_mb, format('select count(*) from public.message_reports where club_id = %L',v_club)) = 0,
    'MA-G8 and an uninvolved member sees none');
  perform pg_temp.check(pg_temp.try_as(null, 'select count(*) from public.message_reports') <> 'OK',
    'MA-G9 an anonymous caller is refused outright -- anon holds no grant on message_reports');
  perform pg_temp.check(
    not has_table_privilege('anon','public.message_reports','SELECT')
    and not has_table_privilege('authenticated','public.message_reports','INSERT')
    and not has_table_privilege('authenticated','public.message_reports','UPDATE'),
    'MA-G10 and no browser role may write a report row at all -- every report is an RPC');

  -- MA-H  attacks: direct writes and scope substitution
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format('insert into public.message_reports (message_id, club_id, reported_by, reason) values (%L,%L,auth.uid(),''direct'')',v_msg,v_club)) <> 'OK',
    'MA-H1 a direct INSERT into message_reports is refused -- every report goes through the RPC');
  perform pg_temp.check(
    pg_temp.try_as(v_so, format('update public.message_reports set status = ''resolved'' where club_id = %L',v_club)) <> 'OK',
    'MA-H2 and even the Safeguarding Officer cannot UPDATE a report row directly');
  perform pg_temp.check(not pg_temp.bool_as(v_so, format('internal.can(''messaging.moderation.club_review'',''club'',%L,null,null)',v_far_club)),
    'MA-H3 scope substitution fails -- the SO''s queue is their own club''s, not any club''s');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('internal.can(''messaging.team_conversation.view'',''team'',%L,%L,null)',v_club,v_team2)),
    'MA-H4 nor does naming another team of the same club');

  -- ---------------------------------------------------------------------------------------------
  -- MA-J  the third-party predicate: who may direct-message whom (AA.3 row 4f, staffs_team)
  --
  -- internal.team_messaging_staff asks about a NAMED PERSON rather than the caller, which is why it
  -- resolves through capability_decision rather than can(). It replaced a helper that matched
  -- membership role strings directly, and it decides whether two people on opposing fixture staff
  -- may open a direct conversation -- so a widening here widens who can message whom.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_tm,v_team)),
    'MA-J1 the Team Manager staffs their own team');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_co,v_team)),
    'MA-J2 so does its Coach');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_ca,v_team)),
    'MA-J3 and the Club Admin, club-wide');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_fs,v_team)),
    'MA-J4 and the Fixtures Secretary');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_mb,v_team)),
    'MA-J5 an ordinary club Member does NOT -- a membership row is not messaging staff');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_so,v_team)),
    'MA-J6 nor does the Safeguarding Officer');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_tm2,v_team)),
    'MA-J7 nor another team''s Manager -- the predicate binds to the team');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_far,v_team)),
    'MA-J8 nor anyone at another club');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,%L)',v_str,v_team)),
    'MA-J9 nor a stranger');
  perform pg_temp.check(not pg_temp.bool_as(v_ca, format('pg_temp.staffs(null,%L)',v_team))
                        and not pg_temp.bool_as(v_ca, format('pg_temp.staffs(%L,null)',v_tm)),
    'MA-J10 and a null subject or team is false rather than an error');
  -- The answer must not depend on WHO IS ASKING: it is a question about someone else's standing
  -- authority. An ordinary member asking gets the same answer a Club Admin gets.
  perform pg_temp.check(pg_temp.bool_as(v_mb, format('pg_temp.staffs(%L,%L)',v_tm,v_team))
                        and not pg_temp.bool_as(v_mb, format('pg_temp.staffs(%L,%L)',v_mb,v_team)),
    'MA-J11 the answer is about the SUBJECT, not the caller -- session state of the caller does not colour it');
  -- The perimeter behind that wrapper: nothing but a SECURITY DEFINER function may ask this, so no
  -- browser role holds EXECUTE on it. A grant here would let any signed-in account enumerate who
  -- staffs which team.
  perform pg_temp.check(
    not has_function_privilege('authenticated','internal.team_messaging_staff(uuid,uuid)','EXECUTE')
    and not has_function_privilege('anon','internal.team_messaging_staff(uuid,uuid)','EXECUTE'),
    'MA-J12 and no browser role may call the predicate directly');

  -- ---------------------------------------------------------------------------------------------
  -- MA-K  sender identity: who may speak AS a team, a club, or Ovalball (J.10 514-515)
  --
  -- internal.may_send_as is the one authority behind the enforce_sender_identity trigger, so this
  -- decides whose name appears on a message rather than merely who can read one. 4F moved its club
  -- branch off 4C's fixture-planning gate and its two site branches off the is_full_site_admin role
  -- string onto site.support.act_in_club, the site master J.10 records for both announcement keys.
  -- The platform branch deliberately still asks the role string -- J.10 defines no key for speaking
  -- as Ovalball -- and MA-K7/K8 pin that so the distinction cannot quietly erode either way.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.send_as(%L,%L)','club',v_club)),
    'MA-K1 the Club Admin may speak as their own club');
  perform pg_temp.check(pg_temp.bool_as(v_ca, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K2 and as a team within it');
  perform pg_temp.check(pg_temp.bool_as(v_tm, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K3 the Team Manager may speak as the team they run');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('pg_temp.send_as(%L,%L)','team',v_team2)),
    'MA-K4 but not as the team next door');
  perform pg_temp.check(not pg_temp.bool_as(v_tm, format('pg_temp.send_as(%L,%L)','club',v_club)),
    'MA-K5 and not in the club''s name -- running a team is not speaking for the club');
  perform pg_temp.check(not pg_temp.bool_as(v_mb, format('pg_temp.send_as(%L,%L)','club',v_club))
                        and not pg_temp.bool_as(v_mb, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K6 an ordinary club Member speaks only for themselves');
  perform pg_temp.check(not pg_temp.bool_as(v_far, format('pg_temp.send_as(%L,%L)','club',v_club))
                        and not pg_temp.bool_as(v_far, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K7 and another club''s Admin cannot borrow this club''s name');

  -- The two site masters are not the same authority, and MA-K8/K9 are the pair that proves it.
  perform pg_temp.check(pg_temp.bool_as(v_sa, format('pg_temp.send_as(%L,%L)','club',v_far_club))
                        and pg_temp.bool_as(v_sa, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K8 a Full Site Admin may act in any club''s name -- site.support.act_in_club (J.10 514-515)');
  perform pg_temp.check(not pg_temp.bool_as(v_smod, format('pg_temp.send_as(%L,%L)','club',v_club))
                        and not pg_temp.bool_as(v_smod, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K9 a message-moderator Site Admin may not -- reading reported content is not speaking for a club');

  -- THE CAPABILITY, NOT THE ROLE STRING. Site authority resolves at rule SITE_CAPABILITY from the
  -- site profile's bundle -- a site-scoped capability_overrides row does NOT beat it, which is the
  -- resolver's own design and not something this suite should pretend otherwise. So the honest
  -- lever is the bundle itself: take site.support.act_in_club out of SITE_FULL and the same person,
  -- still carrying admin_role 'full', loses the club's name; put it back and it returns. Under the
  -- retired is_full_site_admin() check neither half of this could have been written at all.
  delete from public.bundle_capabilities
   where bundle_key = 'SITE_FULL' and capability_key = 'site.support.act_in_club';
  v_ok := not pg_temp.bool_as(v_sa, format('pg_temp.send_as(%L,%L)','club',v_far_club))
          and exists (select 1 from public.site_admins where user_id = v_sa and admin_role = 'full' and status = 'active');
  insert into public.bundle_capabilities (bundle_key, capability_key, scope_type)
  values ('SITE_FULL', 'site.support.act_in_club', 'site');
  perform pg_temp.check(v_ok and pg_temp.bool_as(v_sa, format('pg_temp.send_as(%L,%L)','club',v_far_club)),
    'MA-K10 removing site.support.act_in_club from SITE_FULL removes the authority and restoring it returns it -- the capability decides, not the role');

  -- Ovalball's own name: still the narrowest test in the function.
  perform pg_temp.check(pg_temp.bool_as(v_sa, 'pg_temp.send_as(''platform'',null)'),
    'MA-K11 a Full Site Admin speaks as Ovalball');
  perform pg_temp.check(not pg_temp.bool_as(v_smod, 'pg_temp.send_as(''platform'',null)')
                        and not pg_temp.bool_as(v_ca, 'pg_temp.send_as(''platform'',null)'),
    'MA-K12 and nobody else does -- not a moderator Site Admin, not a Club Admin');
  perform pg_temp.check(not pg_temp.bool_as(v_sa, format('pg_temp.send_as(%L,%L)','platform',v_club))
                        and not pg_temp.bool_as(v_ca, format('pg_temp.send_as(%L,%L)','person',v_club))
                        and not pg_temp.bool_as(v_ca, format('pg_temp.send_as(%L,null)','nonsense')),
    'MA-K13 a scoped platform identity, a scoped person identity and an unknown type are all refused');

  -- THE TEAM BINDING, ISOLATED. Every persona above who may speak as a team also holds
  -- team.attendance.view, so can_address_team_audience answers for them and the
  -- messaging.announcement.send_team clause beside it is never the deciding one -- a mutation that
  -- stopped that clause binding to the NAMED team survived the whole suite. This persona holds the
  -- announcement capability at team scope and nothing else, so the clause is load-bearing for them.
  v_ann := pg_temp.person('ANN'); perform pg_temp.member(v_club, v_ann, 'BASIC_USER');
  -- Granted at SITE level, and that is not an incidental choice: messaging.announcement.send_team is
  -- safeguarding_sensitive, so rule 5 ignores any CLUB- or TEAM-level delegation of it outright. A
  -- club delegate genuinely cannot hand this key out; only a site-level grant lands.
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, granted_level, granted_by, reason)
  values (v_ann, 'messaging.announcement.send_team', 'team', v_club, v_team, 'grant', 'SITE', v_sa, 'MA-K16');
  perform pg_temp.check(pg_temp.bool_as(v_ann, format('pg_temp.send_as(%L,%L)','team',v_team)),
    'MA-K16 a team-scoped announcement grant alone lets that person speak as that team');
  perform pg_temp.check(not pg_temp.bool_as(v_ann, format('pg_temp.send_as(%L,%L)','team',v_team2))
                        and not pg_temp.bool_as(v_ann, format('pg_temp.send_as(%L,%L)','club',v_club)),
    'MA-K17 and only that team -- not its neighbour, and not the club');

  -- AND IT IS ENFORCED, not merely available: the trigger is the thing a write actually meets.
  -- The writer here is the COACH, deliberately. An ordinary Member is already turned away by the
  -- row policy, so using one would have proved RLS and called it the trigger -- which is what the
  -- first version of this assertion did, and a neutered-trigger mutant walked straight through it.
  -- The Coach passes the policy, so the only thing left to refuse the club's name is the trigger.
  v_ok := pg_temp.try_as(v_co, format(
      'insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind, sender_identity_type, sender_identity_id) '
      || 'values (%L,%L,%L,''MAM as-person '||v_tag||''',''message'',''person'',null)', v_fixture, v_conv, v_co)) = 'OK';
  v_ok2 := pg_temp.try_as(v_co, format(
      'insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind, sender_identity_type, sender_identity_id) '
      || 'values (%L,%L,%L,''MAM impersonation '||v_tag||''',''message'',''club'',%L)', v_fixture, v_conv, v_co, v_club)) <> 'OK';
  perform pg_temp.check(v_ok and v_ok2,
    'MA-K14 the Coach may post as themselves but not in the club''s name -- enforce_sender_identity, not the row policy, is what refuses it');
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format(
      'insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind, sender_identity_type, sender_identity_id) '
      || 'values (%L,%L,%L,''MAM impersonation '||v_tag||''',''message'',''club'',%L)', v_fixture, v_conv, v_mb, v_club)) <> 'OK',
    'MA-K18 and an ordinary Member gets no further -- the row policy stops them before the trigger does');

  -- THE HELPERS MA-K9 AND MA-K10 ACTUALLY CAUGHT. may_send_as delegates both organisational branches
  -- to the audience helpers, so canonicalising may_send_as alone would have moved the blanket Site
  -- Admin bypass one function away instead of closing it. Pinned structurally as well as
  -- behaviourally, because the behavioural half only fails if a persona happens to exercise it.
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'internal'
                  and p.proname in ('can_address_club_audience','can_address_team_audience')
                  and p.prosrc ~ '\mis_site_admin\(')
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'internal'
           and p.proname in ('can_address_club_audience','can_address_team_audience')
           and p.prosrc ~ 'site\.support\.act_in_club') = 2,
    'MA-K15 neither audience helper carries a blanket Site Admin bypass; both ask the J.10 site master');

  -- ---------------------------------------------------------------------------------------------
  -- MA-L  a question about nothing (J.10 line 511, the rest of the blanket read)
  --
  -- fixture_messages_select_scoped evaluates can_access_any_conversation as its first term. On a
  -- team, safeguarding, announcement or direct row all three of its arguments are null -- and until
  -- 4F its site branch answered that question YES for a site moderator, handing them every thread
  -- in Ovalball through the back of the same policy J.10 removed the blanket read from the front
  -- of. Asking about no conversation now answers no, and MA-L2 is the one that would have caught it.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not pg_temp.bool_as(v_smod, 'internal.can_access_fixture_conversation(null,null)')
    and not pg_temp.bool_as(v_sa, 'internal.can_access_fixture_conversation(null,null)')
    and not pg_temp.bool_as(v_ca, 'internal.can_access_fixture_conversation(null,null)')
    and not pg_temp.bool_as(v_str, 'internal.can_access_fixture_conversation(null,null)'),
    'MA-L1 asked about no fixture and no request, the gate answers no -- for the moderator too');
  -- A private conversation between two people the moderator has nothing to do with. Its own gate,
  -- internal.can_view_direct_conversation, names no site capability at all -- J.10 line 519 gives
  -- messaging.direct.send no site master. So the ONLY way a moderator ever reached this row was the
  -- unguarded first term answering a question about no fixture.
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_ca, v_co), greatest(v_ca, v_co), v_ca) returning id into v_dc;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind)
  values (v_dc, v_ca, 'MAM private '||v_tag, 'message') returning id into v_dmsg;
  perform pg_temp.check(
    pg_temp.count_as(v_smod, format('select count(*) from public.fixture_messages where direct_conversation_id = %L',v_dc)) = 0,
    'MA-L2 a message-moderator Site Admin reads none of a private conversation between two other people');
  perform pg_temp.check(
    pg_temp.count_as(v_sa, format('select count(*) from public.fixture_messages where direct_conversation_id = %L',v_dc)) = 0,
    'MA-L2b and neither does a Full Site Admin -- nothing in J.10 gives direct messages a site master');
  perform pg_temp.check(
    pg_temp.count_as(v_ca, format('select count(*) from public.fixture_messages where direct_conversation_id = %L',v_dc)) = 1,
    'MA-L2c while the two people in it still read it');
  perform pg_temp.check(
    pg_temp.count_as(v_smod, format('select count(*) from public.fixture_messages where fixture_id = %L',v_fixture)) > 0
    and pg_temp.count_as(v_smod, format('select count(*) from public.fixture_messages where team_conversation_id = %L',v_team)) > 0,
    'MA-L3 while still reading fixture and team threads -- J.10 lines 511-512 give BOTH site.messages.moderate as their site master; what it is not is a key to every other kind of thread');

  -- THE GUARD IS ONLY A GUARD. Adding a column test in front of that first term must not change who
  -- sees what; it only stops a question being asked whose answer was already no. Compared row for
  -- row, for a persona of every kind in this world.
  v_ok := true;
  foreach v_m in array array[v_ca, v_co, v_mb, v_tm, v_so, v_sa, v_smod, v_far, v_str] loop
    if pg_temp.count_as(v_m, 'select count(*) from public.fixture_messages')
       is distinct from pg_temp.count_as(v_m, 'select pg_temp.unguarded_visible_count()') then
      v_ok := false;
    end if;
  end loop;
  perform pg_temp.check(v_ok,
    'MA-L4 the guarded policy and the unguarded one make every row equally visible, for all nine personas');
end $$;

-- =====================================================================================================
-- MA-I. Retirement, structurally, and the earlier slices still standing.
-- =====================================================================================================
do $$
declare
  v_4f constant text[] := array[
    'internal.can_access_fixture_conversation','internal.can_view_team_conversation','internal.can_send_team_conversation',
    'internal.can_access_conversation','internal.can_access_any_conversation','internal.may_send_as',
    'internal.may_direct_message','internal.team_messaging_staff','internal.message_report_club',
    'public.report_message','public.club_message_reports','public.block_user_from_club_messages',
    'public.lift_club_message_block','public.update_club_message_policy','public.update_global_message_policy',
    'public.start_or_get_club_conversation','public.respond_to_club_conversation',
    'public.moderator_delete_message','public.admin_get_message_thread_content'
  ];
  v_legacy constant text := '\m(is_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|staffs_team|is_messaging_staff)\(';
  v_bad text[];
begin
  select coalesce(array_agg(n.nspname||'.'||f.proname order by 1),'{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace
  where (n.nspname||'.'||f.proname) = any (v_4f) and f.prosrc ~ v_legacy;
  perform pg_temp.check(cardinality(v_bad)=0,
    format('MA-I1 no 4F function calls a legacy authority helper%s',
           case when cardinality(v_bad)=0 then '' else ': '||array_to_string(v_bad,', ') end));

  perform pg_temp.check(
    (select count(*) filter (where n.nspname||'.'||f.proname = any (v_4f))
     from pg_proc f join pg_namespace n on n.oid=f.pronamespace) = cardinality(v_4f),
    'MA-I2 every 4F function in the ledger exists -- the list is not stale');

  -- Earlier slices must still hold.
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.fixtures','INSERT')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_fixture'),
    'MA-I3 Slice 4C still holds: no direct fixture INSERT, and create_fixture is the contract');
  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='internal' and p.proname='is_club_fixture_administrator'),
    'MA-I4 Slice 4D still holds: the raw-role fixture-administrator helper is still gone');
  perform pg_temp.check(
    exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='public_venues')
    and not exists (select 1 from public.capability_key_map where legacy_key in ('calendar.manage','calendar.view')),
    'MA-I5 Slice 4E still holds: the public venue projection stands and the calendar adapters stay retired');

  -- MA-I6  RELEASE ORDER, kept true after release. Migrations land before the push that deploys the
  -- app, so the previous build reports through report_fixture_message against this schema. It is
  -- kept for that window and delegates, so an old caller writes one row per report like everybody
  -- else. If someone later restores its own body, the overwrite defect section T removed becomes
  -- reachable again through a name that still exists -- so the delegation is asserted, not trusted.
  perform pg_temp.check(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='report_fixture_message' and p.prosrc ~ '\mreport_message\(')
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='report_fixture_message' and p.prosrc ~ 'update public\.fixture_messages'),
    'MA-I6 report_fixture_message is kept for the release window and delegates to report_message rather than stamping the row');
end $$;

rollback;
