-- Root cause of "Wigan has no crest and Site Admin can't add one": every
-- logo column lived only on public.clubs (the ACTIVATED-club row), and the
-- Site Admin club detail page's whole Media/crest tab was conditionally
-- rendered only `club ? [...] : []` -- an unactivated canonical
-- club_directory row (no clubs row yet) had nowhere to store a crest and
-- no UI to set one, even though Site Admin already legitimately manages
-- every other club_directory field (name, town, postcode) regardless of
-- activation (club_directory_update_admin already permits it -- this
-- column rides the same existing policy, no new RLS needed).
--
-- clubs.logo_storage_path remains authoritative once a club activates and
-- its own officials upload their own crest (self-service, unchanged) --
-- this canonical column is the fallback everywhere a crest is shown:
-- coalesce(clubs.logo_storage_path, club_directory.logo_storage_path).
-- Never a second/shadow logo system -- one canonical directory-level
-- record, read by every surface that already resolves a club's identity
-- through club_directory (fixture overview, opponent search, messaging,
-- admin club list/detail).

alter table public.club_directory add column logo_storage_path text;

comment on column public.club_directory.logo_storage_path is
  'Canonical crest for this directory entry, settable by Full Site Admin/Club Data Admin regardless of whether the club has activated on Ovalball. Falls back for display whenever the activated clubs.logo_storage_path (that club''s own self-managed crest) is not set -- never the other way around, so an activated club''s own upload always wins.';

-- ============================================================
-- admin_fixture_overview: resolve BOTH sides' crest through the same
-- coalesce so Fixture Management, fixture detail, and the messenger all
-- show the identical canonical-or-own crest.
-- ============================================================

create or replace view public.admin_fixture_overview
  with (security_invoker = true) as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.status,
  f.game_type,
  f.source,
  f.import_batch_id,
  f.replaces_fixture_id,
  f.raw_opposition_text,
  f.opponent_directory_id,
  f.opponent_team_id,
  f.season_label,
  f.notes,
  f.cancelled_at,
  f.cancellation_reason,
  f.created_at,
  f.updated_at,
  t.id as owning_team_id,
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  opp_cd.name as opponent_club_name,
  opp_t.display_name as opponent_team_name,
  comp.name as competition_name,
  v.name as venue_name,
  (select count(*) from public.fixture_messages fm where fm.fixture_id = f.id) as message_count,
  coalesce(c.logo_storage_path, cd.logo_storage_path) as owning_club_logo_path,
  opp_c.id as opponent_club_id,
  -- Three possible sources: the opponent's own activated-club upload, the
  -- canonical directory row reached via opponent_directory_id (the
  -- unactivated-opponent path), or the canonical directory row reached via
  -- the resolved opponent team's own club (the activated-opponent path) --
  -- coalesced in that priority order, never a second logo system.
  coalesce(opp_c.logo_storage_path, opp_cd.logo_storage_path, opp_dir_fallback.logo_storage_path) as opponent_club_logo_path,
  f.pitch_allocation,
  f.home_score,
  f.away_score,
  f.result_status,
  f.result_submitted_at,
  f.result_confirmed_at,
  f.result_amendment_proposed_home_score,
  f.result_amendment_proposed_away_score
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.club_directory opp_dir_fallback on opp_dir_fallback.id = opp_c.directory_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id;

grant select on public.admin_fixture_overview to authenticated, anon;

-- ============================================================
-- admin_club_overview: expose the canonical directory-level crest (new
-- column, appended at the end -- CREATE OR REPLACE VIEW requires every
-- pre-existing column to keep its position) and correct flag_missing_logo
-- so a canonical crest already covers the flag even before activation.
-- ============================================================

create or replace view public.admin_club_overview
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
  (cd.postcode is null or cd.postcode = '') as flag_missing_postcode,
  (cd.town is null or cd.town = '') as flag_missing_town,
  (cd.rugby_code is null or cd.rugby_code = '') as flag_missing_rugby_code,
  (dup_key.key_count > 1) as flag_duplicate_normalized_key,
  (cd.external_id is not null and dup_ext.ext_count > 1) as flag_duplicate_external_id,
  (cd.verification_status not ilike '%verified%') as flag_unverified,
  (cd.active = false) as flag_inactive,
  (coalesce(cd.website, c.website) is null or coalesce(cd.website, c.website) = '') as flag_missing_website,
  (c.logo_storage_path is null and c.legacy_logo_path is null and cd.logo_storage_path is null) as flag_missing_logo,
  (c.id is not null and (c.bio is null or c.bio = '')) as flag_no_public_profile,
  (pending_claim.has_pending) as flag_pending_claim,
  cd.logo_storage_path as directory_logo_storage_path
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
) dup_ext on true
left join lateral (
  select exists(
    select 1 from public.club_claims cc where cc.directory_id = cd.id and cc.status = 'pending'
  ) as has_pending
) pending_claim on true;

grant select on public.admin_club_overview to authenticated;
