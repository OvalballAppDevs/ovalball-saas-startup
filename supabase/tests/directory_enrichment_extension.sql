-- OVERNIGHT DIRECTORY ENRICHMENT -- proves the additive schema extension
-- (20270575000000_the_directory_learns_a_little_more_about_itself.sql) behaves correctly:
-- bio/primary_colour/secondary_colour are valid research-proposal fields, club_directory's
-- new colour columns reject invalid hex exactly like club_kits already does, logo candidate
-- columns exist and never touch logo_storage_path, and the existing one-pending-proposal-
-- per-field uniqueness still holds for the new fields.
--
-- DE1   bio is now a valid proposal field
-- DE2   primary_colour is now a valid proposal field
-- DE3   an unknown field is still rejected (the enum is closed, not opened up generally)
-- DE4   club_directory.primary_colour rejects a non-hex value
-- DE5   club_directory.primary_colour accepts a valid hex value
-- DE6   a logo candidate can be recorded without touching logo_storage_path
-- DE7   the existing one-pending-proposal-per-field uniqueness holds for a new field too
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('DE Test RUFC', 'DE Town', 'DE County', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'de-test-' || substr(gen_random_uuid()::text, 1, 8))
returning id as directory_id \gset

select id as researcher_id from auth.users where email = 'uat.fullsiteadmin@ovalball.test' \gset

-- =========================================================================
-- DE1/DE2/DE3: proposal field enum
-- =========================================================================
select pg_temp.try(format(
  'insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by) values (%L, ''bio'', ''A test biography.'', ''official_website'', ''high'', %L)',
  :'directory_id', :'researcher_id'
)) as de1 \gset
select pg_temp.check(:'de1' = 'OK', 'DE1 bio is a valid proposal field (' || :'de1' || ')');

select pg_temp.try(format(
  'insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by) values (%L, ''primary_colour'', ''#7A0025'', ''official_website'', ''high'', %L)',
  :'directory_id', :'researcher_id'
)) as de2 \gset
select pg_temp.check(:'de2' = 'OK', 'DE2 primary_colour is a valid proposal field (' || :'de2' || ')');

select pg_temp.try(format(
  'insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by) values (%L, ''favourite_biscuit'', ''Digestive'', ''official_website'', ''high'', %L)',
  :'directory_id', :'researcher_id'
)) as de3 \gset
select pg_temp.check(:'de3' != 'OK', 'DE3 an unrecognised field is still rejected (' || :'de3' || ')');

-- =========================================================================
-- DE4/DE5: colour hex validation on club_directory itself
-- =========================================================================
select pg_temp.try(format('update public.club_directory set primary_colour = ''maroon'' where id = %L', :'directory_id')) as de4 \gset
select pg_temp.check(:'de4' != 'OK', 'DE4 a non-hex colour value is rejected (' || :'de4' || ')');

select pg_temp.try(format('update public.club_directory set primary_colour = ''#7A0025'' where id = %L', :'directory_id')) as de5 \gset
select pg_temp.check(:'de5' = 'OK', 'DE5 a valid hex colour value is accepted (' || :'de5' || ')');

-- =========================================================================
-- DE6: logo candidate never touches logo_storage_path
-- =========================================================================
update public.club_directory
set logo_candidate_url = 'https://example.test/de-crest.png', logo_candidate_source = 'official_website', logo_candidate_evidence = 'Test evidence.', logo_candidate_found_at = now()
where id = :'directory_id'::uuid;

select pg_temp.check(
  (select logo_storage_path is null and logo_candidate_url = 'https://example.test/de-crest.png' from public.club_directory where id = :'directory_id'::uuid),
  'DE6 a logo candidate is recorded without ever setting logo_storage_path'
);

-- =========================================================================
-- DE7: uniqueness holds for a new field
-- =========================================================================
select pg_temp.try(format(
  'insert into public.club_directory_research_proposals (directory_id, field, proposed_value, source, confidence, researched_by) values (%L, ''bio'', ''A second, competing proposal.'', ''official_website'', ''high'', %L)',
  :'directory_id', :'researcher_id'
)) as de7 \gset
select pg_temp.check(:'de7' != 'OK', 'DE7 a second pending proposal for the same (directory_id, field) is refused (' || :'de7' || ')');

rollback;
