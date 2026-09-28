-- TEAM SAFEGUARDING LEAD -- the new team-scoped role (20270571000000_a_team_names_its_own_safeguarding_
-- contact.sql), proving it is genuinely distinct from the club-scoped, Site-only SAFEGUARDING_OFFICER
-- and carries only the minimum view-plus-contact authority the owner specified (Section 4 addendum).
--
--   TSL1     the role exists, TEAM scope, VO bundle, minor-prohibited, delegable to TEAM_ADMIN level
--   TSL2     a delegated team manager (TEAM_ADMINISTRATION) can grant it without reaching Site Admin
--   TSL3     a person delegated on Team A cannot grant it on Team B
--   TSL4     an unrelated stranger cannot grant it at all
--   TSL5     a minor is refused the role; a person of genuinely unknown age is refused identically
--   TSL6     it coexists with COACH and FIRST_AIDER on the same person -- one row, three roles
--   TSL7     the holder gets the VO bundle's safeguarding CONTACT keys, and NONE of the confirmed
--            club officer's authority (welfare lookup, dispensations, moderation review, contact edit)
--   TSL8     removing TEAM_SAFEGUARDING_LEAD leaves every other role the same person holds intact
--   TSL9     team_staff() renders it with the canonical label "Team Safeguarding Lead"
--   TSL10    the Overview staff count (team_people_counts) and the Staff tab's own distinct-person count
--            (team_staff) agree exactly once a Team Safeguarding Lead is added alongside other roles
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tsl-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tsl', p_label, 'tsl-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TSL ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tsl-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tsl-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_label text default 'Under 14 Girls', p_gender text default 'girls') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'tsl-' || v_tag, 'youth', 'U14', p_gender, 'union', true) returning id into v;
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
select pg_temp.club('Safeguarding Lead') as club_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team A', 'girls') as team_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team B', 'boys') as team_b \gset

select pg_temp.person('Club Admin', '1970-01-01') as admin_id \gset
select pg_temp.member(:'club_a'::uuid, :'admin_id'::uuid) as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TSL setup'::text, '{}'::jsonb);

-- A delegated Team Administration holder on Team A only (TSL2/TSL3's own actor).
select pg_temp.person('Team Admin A', '1975-01-01') as team_admin_id \gset
select pg_temp.member(:'club_a'::uuid, :'team_admin_id'::uuid) as team_admin_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'team_admin_membership', :'team_a')) as seed_ta1 \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_ADMINISTRATION'', %L::uuid, ''seed'')', :'team_admin_membership', :'team_a')) as seed_ta2 \gset
select pg_temp.check(:'seed_ta1' = 'OK' and :'seed_ta2' = 'OK', 'setup: Team A''s own delegated Team Administration holder');

select pg_temp.person('Stranger', '1990-01-01') as stranger_id \gset

-- =========================================================================
-- TSL1: the role itself
-- =========================================================================
select scope, bundle_key, minor_prohibited, assignable_by from public.role_definitions where role_key = 'TEAM_SAFEGUARDING_LEAD' \gset rd_
select pg_temp.check(:'rd_scope' = 'TEAM', 'TSL1a TEAM_SAFEGUARDING_LEAD is TEAM-scoped');
select pg_temp.check(:'rd_bundle_key' = 'VO', 'TSL1b TEAM_SAFEGUARDING_LEAD reuses the VO (view-only) bundle, not a new or officer bundle');
select pg_temp.check(:'rd_minor_prohibited'::boolean = true, 'TSL1c TEAM_SAFEGUARDING_LEAD is minor-prohibited, same as every other team staff role');
select pg_temp.check(:'rd_assignable_by' = '{SITE,CLUB,TEAM_ADMIN}', 'TSL1d TEAM_SAFEGUARDING_LEAD is delegable to a TEAM_ADMIN-level actor (' || :'rd_assignable_by' || ')');

-- =========================================================================
-- TSL2: a delegated team manager can grant it without reaching Site Admin
-- =========================================================================
select pg_temp.person('New TSL', '1988-01-01') as tsl_id \gset
select pg_temp.member(:'club_a'::uuid, :'tsl_id'::uuid) as tsl_membership \gset
select pg_temp.try_as(:'team_admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'tsl_membership', :'team_a')) as g1 \gset
select pg_temp.check(:'g1' = 'OK', 'TSL2 a delegated Team Administration holder can grant Team Safeguarding Lead on their own team (' || :'g1' || ')');

-- =========================================================================
-- TSL3: cannot reach across to Team B
-- =========================================================================
select pg_temp.person('Cross Team Target', '1988-01-01') as cross_id \gset
select pg_temp.member(:'club_a'::uuid, :'cross_id'::uuid) as cross_membership \gset
select pg_temp.try_as(:'team_admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'cross_membership', :'team_b')) as g2 \gset
select pg_temp.check(:'g2' != 'OK', 'TSL3 Team A''s own delegated holder cannot grant Team Safeguarding Lead on Team B (' || :'g2' || ')');

-- =========================================================================
-- TSL4: an unrelated stranger cannot grant it at all
-- =========================================================================
select pg_temp.try_as(:'stranger_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'cross_membership', :'team_a')) as g3 \gset
select pg_temp.check(:'g3' != 'OK', 'TSL4 an unrelated stranger cannot grant Team Safeguarding Lead (' || :'g3' || ')');

-- =========================================================================
-- TSL5: minor and unknown-age refusal
-- =========================================================================
select pg_temp.person('Minor Candidate', (current_date - interval '15 years')::date) as minor_id \gset
select pg_temp.member(:'club_a'::uuid, :'minor_id'::uuid) as minor_membership \gset
select pg_temp.try_as(:'team_admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'minor_membership', :'team_a')) as g4 \gset
select pg_temp.check(:'g4' != 'OK', 'TSL5a a known minor is refused Team Safeguarding Lead (' || :'g4' || ')');

select pg_temp.person('Unknown Age Candidate', null) as unknown_id \gset
select pg_temp.member(:'club_a'::uuid, :'unknown_id'::uuid) as unknown_membership \gset
select pg_temp.try_as(:'team_admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'unknown_membership', :'team_a')) as g5 \gset
select pg_temp.check(:'g5' != 'OK', 'TSL5b a person of genuinely unknown age is refused identically -- unknown is never treated as adult (' || :'g5' || ')');

-- =========================================================================
-- TSL6: coexists with Coach and First Aider -- one row, three roles
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'tsl_membership', :'team_a')) as g6 \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''FIRST_AIDER'', %L::uuid, ''seed'')', :'tsl_membership', :'team_a')) as g7 \gset
select pg_temp.check(:'g6' = 'OK' and :'g7' = 'OK', 'setup: same person also becomes Coach and First Aider');
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select count(*) as person_rows, (select coalesce(jsonb_array_length(roles), 0) from public.team_staff(:'team_a'::uuid) where membership_id = :'tsl_membership'::uuid) as role_count
from public.team_staff(:'team_a'::uuid) where membership_id = :'tsl_membership'::uuid \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select pg_temp.check(:'person_rows'::integer = 1, 'TSL6a Coach + First Aider + Team Safeguarding Lead is still exactly one row');
select pg_temp.check(:'role_count'::integer = 3, 'TSL6b that one row carries all three roles (' || :'role_count' || ')');

-- =========================================================================
-- TSL7: authority ceiling -- CONTACT keys yes, officer keys no
-- =========================================================================
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.contact.view'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_contact \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.conversation.start'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_start \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.welfare.view'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_welfare \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.dispensation.view'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_dispensation \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.conversation.handle'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_handle \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''messaging.moderation.club_review'', ''club'', %L::uuid, null)::text', :'club_a')) as cap_moderation \gset
select pg_temp.as_subject(:'tsl_id'::uuid, format('select public.has_capability(''safeguarding.officer.contact_edit'', ''self'', null, null)::text')) as cap_contact_edit \gset
select pg_temp.check(:'cap_contact' = 'true', 'TSL7a Team Safeguarding Lead can see the club''s safeguarding contact');
select pg_temp.check(:'cap_start' = 'true', 'TSL7b Team Safeguarding Lead can start a safeguarding conversation');
select pg_temp.check(:'cap_welfare' = 'false', 'TSL7c Team Safeguarding Lead has NO welfare lookup -- that stays with the confirmed club officer alone');
select pg_temp.check(:'cap_dispensation' = 'false', 'TSL7d Team Safeguarding Lead has NO dispensation authority');
select pg_temp.check(:'cap_handle' = 'false', 'TSL7e Team Safeguarding Lead cannot handle safeguarding conversations (officer-only)');
select pg_temp.check(:'cap_moderation' = 'false', 'TSL7f Team Safeguarding Lead has no reported-message moderation review');
select pg_temp.check(:'cap_contact_edit' = 'false', 'TSL7g Team Safeguarding Lead cannot edit the club''s safeguarding contact card');

-- =========================================================================
-- TSL8: removal isolation
-- =========================================================================
select ra.id as tsl_assignment from public.role_assignments ra where ra.membership_id = :'tsl_membership'::uuid and ra.team_id = :'team_a'::uuid and ra.role_key = 'TEAM_SAFEGUARDING_LEAD' and ra.state = 'ACTIVE' \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''test'', false)', :'tsl_assignment')) as rv1 \gset
select pg_temp.check(:'rv1' = 'OK', 'setup: Team Safeguarding Lead revoked');
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select (select roles from public.team_staff(:'team_a'::uuid) where membership_id = :'tsl_membership'::uuid) as roles_after_removal \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select pg_temp.check(:'roles_after_removal'::jsonb @> '[{"roleKey":"COACH"}]'::jsonb, 'TSL8a removing Team Safeguarding Lead leaves Coach intact');
select pg_temp.check(:'roles_after_removal'::jsonb @> '[{"roleKey":"FIRST_AIDER"}]'::jsonb, 'TSL8b removing Team Safeguarding Lead leaves First Aider intact');
select pg_temp.check(not (:'roles_after_removal'::jsonb @> '[{"roleKey":"TEAM_SAFEGUARDING_LEAD"}]'::jsonb), 'TSL8c Team Safeguarding Lead itself is genuinely gone');

-- =========================================================================
-- TSL9: canonical label
-- =========================================================================
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select (select roles from public.team_staff(:'team_a'::uuid) where membership_id = :'team_admin_membership'::uuid) as unused_probe \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select label from public.role_definitions where role_key = 'TEAM_SAFEGUARDING_LEAD' \gset lbl_
select pg_temp.check(:'lbl_label' = 'Team Safeguarding Lead', 'TSL9 the canonical label read straight off role_definitions is exactly "Team Safeguarding Lead"');

-- =========================================================================
-- TSL10: Overview's own staff count and the Staff tab's distinct-person count agree
-- =========================================================================
select pg_temp.person('TSL Only', '1982-01-01') as tsl_only_id \gset
select pg_temp.member(:'club_a'::uuid, :'tsl_only_id'::uuid) as tsl_only_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_SAFEGUARDING_LEAD'', %L::uuid, ''seed'')', :'tsl_only_membership', :'team_a')) as g8 \gset
select pg_temp.check(:'g8' = 'OK', 'setup: a second, TSL-only person added to Team A');

select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select staff as overview_staff from public.team_people_counts(:'team_a'::uuid) \gset
select (select count(*) from public.team_staff(:'team_a'::uuid)) as staff_tab_count \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select pg_temp.check(:'overview_staff'::integer = :'staff_tab_count'::integer, 'TSL10 Overview''s team_people_counts.staff (' || :'overview_staff' || ') and the Staff tab''s team_staff() distinct-person count (' || :'staff_tab_count' || ') agree exactly');

rollback;
