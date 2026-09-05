-- Site Admin Club Management needs one query surface that joins
-- club_directory (canonical identity) with clubs (the activated Ovalball
-- profile, present only once a club is claimed) plus a couple of cheap
-- aggregates -- without that, the admin list page would need N+1 queries
-- per row just to know "is this claimed" and "how many Club Admins does
-- it have". A view is the right tool here, not a new table: it's a query,
-- not a duplicate store of club_directory/clubs' own data, so the
-- underlying two-table architecture (directory = canonical identity,
-- clubs = activated profile) stays exactly as it is -- writes from the
-- admin UI still go to club_directory or clubs directly, never to this
-- view.
--
-- security_invoker = true (PG15+) is deliberate, not the default: a plain
-- view's row-visibility can end up keyed to the view OWNER's privileges
-- rather than the querying user's, which would risk this view silently
-- bypassing club_directory_select / clubs_select RLS for whoever queries
-- it. security_invoker makes every underlying table's RLS evaluate against
-- the actual calling session (auth.uid() etc.), exactly like querying
-- club_directory/clubs directly would -- so this view is only ever as
-- permissive as the two tables it reads already are. In practice that
-- means: Site Admin sees every row (both tables' SELECT policies already
-- grant is_site_admin() everything); anyone else sees only the same
-- active/claimed subset they could already see querying the tables
-- directly. The Club Management page itself is additionally gated at the
-- page level (ctx.isSiteAdmin redirect, matching /admin/claims'
-- convention) -- a UX courtesy, not the security boundary.
create view public.admin_club_overview
  with (security_invoker = true) as
select
  cd.id as directory_id,
  cd.name,
  cd.rugby_code,
  cd.country,
  cd.nation,
  cd.region,
  cd.county,
  cd.town,
  cd.postcode,
  cd.home_ground,
  cd.address,
  cd.website as directory_website,
  cd.official_email,
  cd.source,
  cd.external_id,
  cd.source_url,
  cd.source_updated_at,
  cd.active as directory_active,
  cd.verification_status,
  cd.notes,
  cd.constituent_body,
  cd.normalized_key,
  cd.updated_at as directory_updated_at,
  cd.created_at as directory_created_at,
  c.id as club_id,
  c.slug,
  c.status as club_status,
  c.bio,
  c.website as club_website,
  c.facebook_url,
  c.address_display,
  c.logo_storage_path,
  c.legacy_logo_path,
  c.created_at as activated_at,
  c.updated_at as club_updated_at,
  (c.id is not null) as is_activated,
  coalesce(admin_counts.club_admin_count, 0) as club_admin_count,
  -- Data-quality signals, computed here so the list page can filter/badge
  -- on them without a second round trip. Deliberately booleans a Site
  -- Admin reviews by hand -- never an automatic merge (see 20260831170000
  -- and the seed-duplicate fix earlier this project for why silent
  -- merging is exactly the mistake to avoid).
  (cd.postcode is null or cd.postcode = '') as flag_missing_postcode,
  (cd.town is null or cd.town = '') as flag_missing_town,
  (cd.rugby_code is null or cd.rugby_code = '') as flag_missing_rugby_code,
  (dup_key.key_count > 1) as flag_duplicate_normalized_key,
  (cd.external_id is not null and dup_ext.ext_count > 1) as flag_duplicate_external_id,
  (cd.verification_status not ilike '%verified%') as flag_unverified,
  (cd.active = false) as flag_inactive
from public.club_directory cd
left join public.clubs c on c.directory_id = cd.id
left join lateral (
  select count(*) as club_admin_count
  from public.club_memberships cm
  where cm.club_id = c.id and cm.role = 'CLUB_ADMIN' and cm.status = 'active'
) admin_counts on true
left join lateral (
  select count(*) as key_count
  from public.club_directory cd2
  where cd2.normalized_key = cd.normalized_key
) dup_key on true
left join lateral (
  select count(*) as ext_count
  from public.club_directory cd3
  where cd3.source = cd.source and cd3.external_id = cd.external_id
) dup_ext on true;

grant select on public.admin_club_overview to authenticated;
