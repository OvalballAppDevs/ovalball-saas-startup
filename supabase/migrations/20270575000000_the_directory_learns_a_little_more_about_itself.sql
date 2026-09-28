-- OVERNIGHT DIRECTORY ENRICHMENT -- the smallest extension to the EXISTING Online Directory
-- Verification architecture (club_directory_research_proposals, directory_verification_runs,
-- lib/directory-research/provider.ts, app/(app)/admin/clubs/data-quality/*), never a second
-- directory, never a competing proposal/colour/crest system.
--
-- FORENSIC AUDIT (read in full before writing this migration): the review-then-accept
-- proposal pipeline already exists and is a DELIBERATE product decision --
-- proposal-review.tsx's own comment: "Never a bulk 'accept all' here -- every field-level
-- change gets an individual look." This migration adds capacity for three things the
-- existing pipeline could not yet propose, so tonight's research (and any future run) can
-- flow through the SAME reviewed-by-a-human mechanism rather than a second one:
--
--   1. BIO -- club_directory.bio already exists as a column (added in an earlier migration)
--      but was never a valid research-proposal field, so nothing could ever stage a proposed
--      biography for review. Added to the field check constraint only -- no new column.
--
--   2. PLAYING COLOURS -- club_kits (20260000000000-ish era) is the canonical STRUCTURED hex
--      colour model, but it is FK'd to clubs.id (an activated Ovalball organisation) and
--      cannot represent an unclaimed directory-only club's colours at all -- there is
--      nowhere for ~1,390 directory-only clubs' colours to legitimately live. This adds
--      primary_colour/secondary_colour/accent_colour to club_directory itself, using the
--      EXACT SAME hex-validation shape club_kits already established (never a competing
--      colour representation), as directory-level facts. club_kits remains the sole
--      authority for a CLAIMED club's own configured kit and is never read from or written
--      to by directory research -- Section 13's own rule ("do not overwrite an Ovalball
--      team's explicitly configured kit with scraped club colours").
--
--   3. LOGO CANDIDATES -- researchClub()'s own return type has always included
--      `logoCandidate: { sourceUrl, evidence } | null`, but processVerificationBatchAction
--      never persisted it anywhere (confirmed by reading that file in full) -- a real,
--      pre-existing gap between what research could find and what a reviewer could see.
--      LogoManager (app/(app)/admin/clubs/[directoryId]/logo-manager.tsx) is a direct,
--      single-click upload tool with no staging step of its own, and a wrong crest is a
--      brand-identity mistake, not a text-field typo -- so a candidate is recorded as
--      evidence for a human to look at and then upload themselves through that existing
--      tool, never auto-applied to logo_storage_path by research.

alter table public.club_directory_research_proposals drop constraint club_directory_research_proposals_field_check;
alter table public.club_directory_research_proposals add constraint club_directory_research_proposals_field_check
  check (field = any (array['name','country','nation','region','county','town','home_ground','address',
                             'postcode','website','official_email','constituent_body','notes',
                             'bio','primary_colour','secondary_colour']));

alter table public.club_directory
  add column primary_colour text,
  add column secondary_colour text,
  add column accent_colour text,
  add constraint club_directory_primary_colour_check check (primary_colour is null or primary_colour ~* '^#[0-9a-f]{6}$'),
  add constraint club_directory_secondary_colour_check check (secondary_colour is null or secondary_colour ~* '^#[0-9a-f]{6}$'),
  add constraint club_directory_accent_colour_check check (accent_colour is null or accent_colour ~* '^#[0-9a-f]{6}$');

comment on column public.club_directory.primary_colour is
  'Directory-level researched playing colour (hex, same validation shape as club_kits) -- never authoritative once a club activates: club_kits.primary_colour on the real clubs row governs an activated club''s own kit, and is never overwritten by directory research.';

alter table public.club_directory
  add column logo_candidate_url text,
  add column logo_candidate_source text,
  add column logo_candidate_evidence text,
  add column logo_candidate_found_at timestamptz;

comment on column public.club_directory.logo_candidate_url is
  'A researched, identity-verified crest source URL awaiting a human''s own upload via the existing LogoManager tool -- never itself the applied crest (logo_storage_path is untouched by research) and never fetched/rehosted without that human step.';
