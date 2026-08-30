-- Idempotent club_directory import from the staged CSV.
--
-- Dedup strategy:
--   1. external_id is unpopulated for every row in this source (verified
--      during extraction), so the (source, external_id) unique constraint
--      provides no protection here -- all matching is done via the
--      conservative fallback key below.
--   2. Fallback key: (source, normalized_key, postcode). A staging row with
--      zero matching existing rows is INSERTed as new. Exactly one match is
--      UPDATEd in place (this is what makes re-running the import
--      idempotent). More than one match is left untouched and reported as
--      ambiguous -- never silently merged.
--   3. Postcode comparison uses `IS NOT DISTINCT FROM`, not `=`, since
--      ordinary `=` treats NULL = NULL as unknown (neither true nor false),
--      which would make every NULL-postcode row (the majority of this
--      dataset) look like it has zero existing matches on every re-import,
--      inserting a fresh duplicate each time instead of updating in place.
--      `IS NOT DISTINCT FROM` is Postgres's purpose-built NULL-safe equality:
--      NULL IS NOT DISTINCT FROM NULL evaluates true.
--
-- Entire import runs in one transaction: either all of it applies, or none
-- of it does.

begin;

create temp table cd_staging (
  name text, rugby_code text, country text, nation text, region text, county text, town text,
  home_ground text, address text, postcode text, website text, official_email text,
  source text, external_id text, source_url text, source_updated_at text, active boolean,
  verification_status text, notes text, constituent_body text, normalized_key text
);

\copy cd_staging (name, rugby_code, country, nation, region, county, town, home_ground, address, postcode, website, official_email, source, external_id, source_url, source_updated_at, active, verification_status, notes, constituent_body, normalized_key) from '/tmp/club_directory_staging.csv' with (format csv, header true, null '')

create temp table cd_match_counts as
select s.ctid as staging_ctid, s.name, s.source, s.normalized_key, s.postcode,
  (select count(*) from club_directory cd
     where cd.source = s.source
       and cd.normalized_key = s.normalized_key
       and cd.postcode is not distinct from s.postcode) as match_count
from cd_staging s;

-- Insert rows with no existing match.
insert into club_directory (
  name, rugby_code, country, nation, region, county, town, home_ground, address,
  postcode, website, official_email, source, external_id, source_url,
  source_updated_at, active, verification_status, notes, constituent_body,
  normalized_key
)
select s.name, s.rugby_code, s.country, s.nation, s.region, s.county, s.town, s.home_ground, s.address,
  s.postcode, s.website, s.official_email, s.source, nullif(s.external_id, ''), s.source_url,
  s.source_updated_at::timestamptz, s.active, s.verification_status, s.notes, s.constituent_body,
  s.normalized_key
from cd_staging s
join cd_match_counts m on m.staging_ctid = s.ctid
where m.match_count = 0;

-- Update rows with exactly one existing match (idempotent re-import path).
update club_directory cd set
  name = s.name, rugby_code = s.rugby_code, country = s.country, nation = s.nation,
  region = s.region, county = s.county, town = s.town, home_ground = s.home_ground,
  address = s.address, postcode = s.postcode, website = s.website, official_email = s.official_email,
  source_url = s.source_url, source_updated_at = s.source_updated_at::timestamptz,
  active = s.active, verification_status = s.verification_status, notes = s.notes,
  constituent_body = s.constituent_body, normalized_key = s.normalized_key,
  updated_at = now()
from cd_staging s
join cd_match_counts m on m.staging_ctid = s.ctid
where m.match_count = 1
  and cd.source = s.source
  and cd.normalized_key = s.normalized_key
  and cd.postcode is not distinct from s.postcode;

\echo '--- ambiguous rows (match_count > 1, left untouched) ---'
select s.name, s.source, s.normalized_key, s.postcode, m.match_count
from cd_staging s join cd_match_counts m on m.staging_ctid = s.ctid
where m.match_count > 1;

\echo '--- import summary ---'
select
  (select count(*) from cd_staging) as staging_rows,
  (select count(*) from cd_match_counts where match_count = 0) as inserted,
  (select count(*) from cd_match_counts where match_count = 1) as updated,
  (select count(*) from cd_match_counts where match_count > 1) as ambiguous_skipped;

commit;
