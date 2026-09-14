-- Local UAT data for FIXTURE OPERATIONS and the COMPETITION CREATOR.
--
-- WHY THIS FILE EXISTS
--
-- Three things could not be proved in a browser with the seeds alone:
--
--   OPPOSITION DEFAULTS -- choosing an Ovalball opposition club should preselect
--       its one matching team and, away, its primary ground and only pitch.
--       Every other activated club in the local seeds has no teams or no ground.
--   ASKED, NOT BOOKED -- a fixture or competition match against an Ovalball club
--       is a request that club answers. That needs a second Ovalball club with a
--       real Club Admin to answer it.
--   A COMPETITION -- groups, fixtures and a knockout need clubs on both sides of
--       the line: on Ovalball (asked) and not (competition-managed only).
--
-- WHAT IT PROVIDES
--
--   Preston Grasshoppers RFC, activated:  Under 12 Boys, Under 12 Girls,
--       Under 13 Boys; default ground Lightfoot Green with exactly one pitch.
--   uat.preston.admin@ovalball.test       Club Admin of Preston Grasshoppers.
--
-- Committed, idempotent, additive and local-only, like every UAT seed. Authority
-- is not manufactured: the Club Admin has the club_memberships row a real Club
-- Admin has, and the capability engine derives the rest.

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The fixture operations UAT seed is local-only.';
  end if;
end $$;

-- The directory entry, when the directory seed did not already bring it.
insert into public.club_directory
  (name, rugby_code, country, nation, town, county, postcode, home_ground, source, source_url, verification_status, normalized_key, active)
select 'Preston Grasshoppers RFC', 'union', 'United Kingdom', 'England', 'Preston', 'Lancashire', 'PR4 0TA', 'Lightfoot Green',
       'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'preston-grasshoppers-rfc', true
where not exists (select 1 from public.club_directory where name = 'Preston Grasshoppers RFC' and rugby_code = 'union');

update public.club_directory set home_ground = 'Lightfoot Green'
where name = 'Preston Grasshoppers RFC' and rugby_code = 'union' and home_ground is null;

insert into public.clubs (directory_id, slug, status)
select d.id, 'preston-grasshoppers-uat', 'active'
from public.club_directory d
where d.name = 'Preston Grasshoppers RFC' and d.rugby_code = 'union'
  and not exists (select 1 from public.clubs c where c.directory_id = d.id)
order by d.created_at
limit 1
on conflict (slug) do nothing;

insert into public.venues (club_id, name, slug, address_line_1, town, county, postcode, country, is_default_home, active)
select c.id, 'Lightfoot Green', 'preston-grasshoppers-lightfoot-green', 'Lightfoot Lane', 'Preston', 'Lancashire', 'PR4 0TA', 'United Kingdom', true, true
from public.clubs c where c.slug = 'preston-grasshoppers-uat'
on conflict (slug) do nothing;

insert into public.club_pitches (club_id, display_name, sort_order, venue_id, size_category)
select c.id, 'Pitch 1', 1, v.id, 'full'
from public.clubs c join public.venues v on v.club_id = c.id and v.slug = 'preston-grasshoppers-lightfoot-green'
where c.slug = 'preston-grasshoppers-uat'
  and not exists (select 1 from public.club_pitches p where p.club_id = c.id and p.display_name = 'Pitch 1');

insert into public.teams (club_id, rugby_code, category, age_group, gender, active)
select c.id, 'union', 'youth', v.age_group, v.gender, true
from public.clubs c
cross join (values ('U12', 'boys'), ('U12', 'girls'), ('U13', 'boys')) as v(age_group, gender)
where c.slug = 'preston-grasshoppers-uat'
  and not exists (
    select 1 from public.teams t
    where t.club_id = c.id and t.age_group = v.age_group and t.gender = v.gender and t.squad_designation is null
  );

-- The club's own administrator, to answer requests.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'uat.preston.admin@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
where not exists (select 1 from auth.users u where u.email = 'uat.preston.admin@ovalball.test');

insert into public.profiles (id, first_name, surname, email)
select u.id, 'Harriet', 'Calloway', u.email
from auth.users u
where u.email = 'uat.preston.admin@ovalball.test'
  and not exists (select 1 from public.profiles pr where pr.id = u.id);

insert into public.club_memberships (club_id, user_id, role, status)
select c.id, u.id, 'CLUB_ADMIN', 'active'
from public.clubs c cross join auth.users u
where c.slug = 'preston-grasshoppers-uat' and u.email = 'uat.preston.admin@ovalball.test'
  and not exists (select 1 from public.club_memberships m where m.club_id = c.id and m.user_id = u.id);
