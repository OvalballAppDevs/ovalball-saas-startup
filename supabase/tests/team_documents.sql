-- TEAM DOCUMENTS -- Team Profile Section 7, proving the canonical Club Document Library's new
-- team-scoped surface (club_documents.team_id, add_team_document, read_team_documents, the extended
-- delete_club_document, the extended can_access_document_storage_path) AND, critically, that documents
-- survive Season Handover by following the SAME re-pointing internal.apply_planned_team already uses
-- to carry staff forward.
--
--   TD1/TD2   an authorised team-scoped viewer (team.roster.view, no club.documents.view) reads Team
--             A's documents; a stranger with neither is refused outright
--   TD3       Team A's documents never appear when reading Team B
--   TD4/TD5   only a genuine team.team.manage/club.profile.edit/club.documents.manage holder may add a
--             document; a roster-view-only viewer cannot
--   TD6       add_team_document refuses a storage path stamped for another team
--   TD7       a Club Admin (club.documents.manage) can add a Team B document with no personal team role
--   TD8       delete_club_document authority: a roster-view-only viewer cannot delete; the team manager can
--   TD9       a person delegated on Team A cannot add or delete Team B's documents
--   TD10/11   the storage path authority function: write needs manage, view needs roster.view (or the
--             existing broader club.documents.view), and a malformed/cross-club path is refused
--   TD12      SEASON HANDOVER: a genuinely new team id created by internal.apply_planned_team inherits
--             the predecessor's documents (re-pointed, not duplicated) -- the central acceptance test
--   TD13      the reactivation path (an existing inactive team resurrected) needs no re-pointing at all,
--             because it is literally the same id its documents were already attached to
--   TD14      a team NOT part of the rollover (a sibling team) is completely unaffected
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default '1985-01-01') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'td-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Td', p_label, 'td-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TD ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'td-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'td-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_label text default 'Team', p_age text default 'U12', p_gender text default 'boys') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'td-' || v_tag, 'youth', p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status, state) values (p_club, p_user, 'BASIC_USER', 'active', 'ACTIVE') returning id into v;
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'OK';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlerrm;
end $$;

create or replace function pg_temp.as_subject(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
select pg_temp.club('Documents') as club_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team A', 'U12', 'boys') as team_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team B', 'U14', 'girls') as team_b \gset

select pg_temp.person('Club Admin') as admin_id \gset
select pg_temp.member(:'club_a'::uuid, :'admin_id'::uuid) as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TD setup'::text, '{}'::jsonb);

-- Team A's own delegated Team Administration holder (club.documents.* never granted directly).
select pg_temp.person('Team Admin A') as manager_id \gset
select pg_temp.member(:'club_a'::uuid, :'manager_id'::uuid) as manager_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'manager_membership', :'team_a')) as seed_mgr0 \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_ADMINISTRATION'', %L::uuid, ''seed'')', :'manager_membership', :'team_a')) as seed_mgr \gset
select pg_temp.check(:'seed_mgr0' = 'OK' and :'seed_mgr' = 'OK', 'setup: Team A delegated Team Administration holder');

-- A roster-view-only participant (Team Manager holds team.roster.view, confirmed live in Section 4/5).
select pg_temp.person('Roster Viewer') as viewer_id \gset
select pg_temp.member(:'club_a'::uuid, :'viewer_id'::uuid) as viewer_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_MANAGER'', %L::uuid, ''seed'')', :'viewer_membership', :'team_a')) as seed_view \gset
select pg_temp.check(:'seed_view' = 'OK', 'setup: Team A Team Manager (roster-view, not document-manage)');

select pg_temp.person('Stranger') as stranger_id \gset

select :'club_a'::text || '/' || :'team_a'::text || '/' || gen_random_uuid()::text || '.pdf' as valid_path_a \gset
select :'club_a'::text || '/' || :'team_b'::text || '/' || gen_random_uuid()::text || '.pdf' as valid_path_b \gset

-- =========================================================================
-- TD4/TD5: only a genuine manager may add a document
-- =========================================================================
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_document(%L::uuid, %L::text, ''Training Plan'', ''training.pdf'', ''application/pdf'', 120000)', :'team_a', :'valid_path_a')) as g1 \gset
select pg_temp.check(:'g1' = 'OK', 'TD4 Team A''s own delegated manager can add a document (' || :'g1' || ')');

select pg_temp.try_as(:'viewer_id'::uuid, format('select public.add_team_document(%L::uuid, %L::text, ''unauthorised'', ''x.pdf'', ''application/pdf'', 1000)', :'team_a', :'valid_path_a')) as g2 \gset
select pg_temp.check(:'g2' != 'OK', 'TD5 a roster-view-only viewer cannot add a document (' || :'g2' || ')');

-- =========================================================================
-- TD1/TD2: read authority
-- =========================================================================
select pg_temp.try_as(:'viewer_id'::uuid, format('select * from public.read_team_documents(%L::uuid)', :'team_a')) as r1 \gset
select pg_temp.check(:'r1' = 'OK', 'TD1 an authorised roster viewer reads Team A''s documents (' || :'r1' || ')');

select pg_temp.try_as(:'stranger_id'::uuid, format('select * from public.read_team_documents(%L::uuid)', :'team_a')) as r2 \gset
select pg_temp.check(:'r2' != 'OK', 'TD2 an unrelated stranger is refused outright (' || :'r2' || ')');

-- =========================================================================
-- TD3: Team A's document never appears on Team B's own read
-- =========================================================================
select pg_temp.as_subject(:'admin_id'::uuid, format('select count(*)::text from public.read_team_documents(%L::uuid)', :'team_b')) as team_b_count \gset
select pg_temp.check(:'team_b_count'::integer = 0, 'TD3 Team A''s document does not leak into Team B''s own read (' || :'team_b_count' || ')');

-- =========================================================================
-- TD6: a storage path belonging to another team is refused
-- =========================================================================
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_document(%L::uuid, %L::text, ''cross-team path'', ''x.pdf'', ''application/pdf'', 1000)', :'team_a', :'valid_path_b')) as g3 \gset
select pg_temp.check(:'g3' != 'OK', 'TD6 a storage path stamped for Team B is refused when adding to Team A (' || :'g3' || ')');

-- =========================================================================
-- TD7: a Club Admin (club-level authority) can add a Team B document with no personal team role
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.add_team_document(%L::uuid, %L::text, ''Club Admin upload'', ''y.pdf'', ''application/pdf'', 1000)', :'team_b', :'valid_path_b')) as g4 \gset
select pg_temp.check(:'g4' = 'OK', 'TD7 a Club Admin can add Team B document with no personal team role (' || :'g4' || ')');

-- =========================================================================
-- TD8/TD9: delete authority and cross-team refusal
-- =========================================================================
-- A disposable second document for the delete tests, so the "Training Plan" document seeded above
-- survives intact for the Season Handover proof (TD12) further down.
select :'club_a'::text || '/' || :'team_a'::text || '/' || gen_random_uuid()::text || '.pdf' as disposable_path \gset
select pg_temp.try_as(:'manager_id'::uuid, format('select public.add_team_document(%L::uuid, %L::text, ''Disposable'', ''d.pdf'', ''application/pdf'', 1000)', :'team_a', :'disposable_path')) as g5 \gset
select pg_temp.check(:'g5' = 'OK', 'setup: disposable Team A document for the delete tests');

select id as doc_a_id from public.club_documents where team_id = :'team_a'::uuid and title = 'Disposable' \gset
select id as doc_b_id from public.club_documents where team_id = :'team_b'::uuid and title = 'Club Admin upload' \gset

select pg_temp.try_as(:'viewer_id'::uuid, format('select public.delete_club_document(%L::uuid)', :'doc_a_id')) as d1 \gset
select pg_temp.check(:'d1' != 'OK', 'TD8a a roster-view-only viewer cannot delete a document (' || :'d1' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.delete_club_document(%L::uuid)', :'doc_b_id')) as d2 \gset
select pg_temp.check(:'d2' != 'OK', 'TD9 Team A''s own delegated manager cannot delete Team B''s document (' || :'d2' || ')');

select pg_temp.try_as(:'manager_id'::uuid, format('select public.delete_club_document(%L::uuid)', :'doc_a_id')) as d3 \gset
select pg_temp.check(:'d3' = 'OK', 'TD8b Team A''s own delegated manager can delete Team A''s own (disposable) document (' || :'d3' || ')');

-- =========================================================================
-- TD10/TD11: storage path authority function
-- =========================================================================
select pg_temp.as_subject(:'manager_id'::uuid, format('select internal.can_access_document_storage_path(%L::text, true)::text', :'valid_path_a')) as write_by_manager \gset
select pg_temp.check(:'write_by_manager' = 'true', 'TD10a Team A''s manager may write to a correctly-shaped Team A path');

select pg_temp.as_subject(:'viewer_id'::uuid, format('select internal.can_access_document_storage_path(%L::text, true)::text', :'valid_path_a')) as write_by_viewer \gset
select pg_temp.check(:'write_by_viewer' = 'false', 'TD10b a roster-view-only viewer may not write');

select pg_temp.as_subject(:'viewer_id'::uuid, format('select internal.can_access_document_storage_path(%L::text, false)::text', :'valid_path_a')) as view_by_viewer \gset
select pg_temp.check(:'view_by_viewer' = 'true', 'TD10c a roster-view-only viewer may still view');

select pg_temp.as_subject(:'stranger_id'::uuid, format('select internal.can_access_document_storage_path(%L::text, false)::text', :'valid_path_a')) as view_by_stranger \gset
select pg_temp.check(:'view_by_stranger' = 'false', 'TD10d a stranger may not view');

select pg_temp.as_subject(:'manager_id'::uuid, 'select internal.can_access_document_storage_path(''../not-a-real-path'', true)::text') as malformed \gset
select pg_temp.check(:'malformed' = 'false', 'TD11 a malformed path is refused outright');

-- =========================================================================
-- TD12: SEASON HANDOVER -- a genuinely new team id inherits the predecessor's documents
-- =========================================================================
select pg_temp.person('Handover Actor', '1970-01-01') as actor_id \gset

select id as u12_doc_id from public.club_documents where team_id = :'team_a'::uuid \gset
select pg_temp.check(:'u12_doc_id' is not null, 'setup: Team A (U12) still has its document before handover');

-- A real canonical U13 Boys type must exist for the resolver to find it.
select internal.resolve_canonical_team_type('youth', 'U13', 'boys', null, 'union') as ctt_u13 \gset
select pg_temp.check(:'ctt_u13' is not null, 'setup: a canonical U13 Boys team type resolves');

insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('TD Next Season', '2099-09-01', '2100-06-30', false, 'union', 2099, 'td-next-' || substr(gen_random_uuid()::text, 1, 8), true, '2099-08-01')
returning id as to_season \gset

insert into public.age_grade_rollovers (club_id, rugby_code, to_season_id, created_by)
values (:'club_a'::uuid, 'union', :'to_season'::uuid, :'actor_id'::uuid)
returning id as rollover_id \gset

insert into public.age_grade_rollover_planned_teams (rollover_id, canonical_team_type_id, origin, source_team_id, planned_by)
values (:'rollover_id'::uuid, :'ctt_u13'::uuid, 'PLAYER_PLACEMENT', :'team_a'::uuid, :'actor_id'::uuid)
returning id as planned_id \gset

select internal.apply_planned_team(:'planned_id'::uuid, :'actor_id'::uuid) as new_team_id \gset
select pg_temp.check(:'new_team_id' is not null and :'new_team_id' != :'team_a', 'TD12a handover genuinely created a NEW team id, not the same U12 row');
select pg_temp.check((select age_group from public.teams where id = :'new_team_id'::uuid) = 'U13', 'TD12b the new team really is U13');

select pg_temp.check(
  exists (select 1 from public.club_documents where id = :'u12_doc_id'::uuid and team_id = :'new_team_id'::uuid),
  'TD12c the SAME document row (never a copy) now belongs to the continuing U13 team'
);
select pg_temp.check(
  not exists (select 1 from public.club_documents where team_id = :'team_a'::uuid),
  'TD12d no document remains attached to the old, now-superseded U12 team id'
);
select pg_temp.check(
  (select count(*) from public.club_documents where id = :'u12_doc_id'::uuid) = 1,
  'TD12e still exactly one row -- re-pointed, never duplicated'
);

-- The continuing team's own Team Profile Documents read now sees it.
select pg_temp.as_subject(:'admin_id'::uuid, format('select count(*)::text from public.read_team_documents(%L::uuid)', :'new_team_id')) as new_team_count \gset
select pg_temp.check(:'new_team_count'::integer = 1, 'TD12f read_team_documents for the continuing U13 team shows the carried-over document');

-- =========================================================================
-- TD13: reactivation needs no re-pointing -- it is the same id already
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.fold_team(%L::uuid, ''TD13 setup: fold the U13 to prove reactivation'')', :'new_team_id')) as fold1 \gset
select pg_temp.check(:'fold1' = 'OK', 'setup: the U13 team is folded');
select pg_temp.check(
  exists (select 1 from public.club_documents where id = :'u12_doc_id'::uuid and team_id = :'new_team_id'::uuid),
  'TD13a folding a team does not touch its documents -- fold_team_core never references club_documents'
);

-- A second, later rollover (rollover_planned_team_identity_idx would refuse a second U13 identity row
-- inside the SAME rollover, and TD12's own planned-team row for this rollover is already applied) --
-- re-planning the SAME U13 identity for a later season must adopt the folded team back, never stand
-- a second one beside it.
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('TD Season After Next', '2100-09-01', '2101-06-30', false, 'union', 2100, 'td-after-next-' || substr(gen_random_uuid()::text, 1, 8), true, '2100-08-01')
returning id as to_season2 \gset

insert into public.age_grade_rollovers (club_id, rugby_code, to_season_id, created_by)
values (:'club_a'::uuid, 'union', :'to_season2'::uuid, :'actor_id'::uuid)
returning id as rollover2_id \gset

insert into public.age_grade_rollover_planned_teams (rollover_id, canonical_team_type_id, origin, source_team_id, planned_by)
values (:'rollover2_id'::uuid, :'ctt_u13'::uuid, 'PLAYER_PLACEMENT', :'new_team_id'::uuid, :'actor_id'::uuid)
returning id as planned2_id \gset

select internal.apply_planned_team(:'planned2_id'::uuid, :'actor_id'::uuid) as reactivated_id \gset
select pg_temp.check(:'reactivated_id' = :'new_team_id', 'TD13b reactivation adopts the SAME team id, not a new one');
select pg_temp.check(
  (select count(*) from public.club_documents where id = :'u12_doc_id'::uuid) = 1
  and exists (select 1 from public.club_documents where id = :'u12_doc_id'::uuid and team_id = :'reactivated_id'::uuid),
  'TD13c the document is still exactly where it already was -- reactivation needed no re-pointing at all'
);

-- =========================================================================
-- TD14: a sibling team never part of this rollover is unaffected
-- =========================================================================
select pg_temp.check(
  exists (select 1 from public.club_documents where id = :'doc_b_id'::uuid and team_id = :'team_b'::uuid),
  'TD14 Team B''s own document is completely untouched by Team A''s handover'
);

rollback;
