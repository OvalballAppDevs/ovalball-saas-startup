-- TEAM PROFILE -- ABOUT THIS TEAM (Team Profiles Section 1, foundation for Section 8/Team Details).
--
-- AUDITED FIRST: `teams` has no description/about/bio column at all, so every "About This Team" card
-- would otherwise have to be permanently empty or, worse, invented -- the Overview screen's own brief
-- is explicit that text must never be fabricated. This is the one genuinely new field Section 1 needs
-- to read honestly; the same nullable, presentation-only, no-new-capability pattern already used for
-- `clubs.cover_storage_path` (20270564000000).
--
-- SAME AUTHORITY AS EVERY OTHER TEAM FIELD, NO NEW CAPABILITY. `teams_update_admin` already gates every
-- column on this row behind `team.team.manage` (club-scoped) or `team.lifecycle.manage` -- the same
-- capability Section 7's cover-photo authority audit already lands on. No RLS change is needed for one
-- more nullable column on a row that policy already covers.
--
-- READ-ONLY IN SECTION 1. This column exists so Overview can show a real description where one has been
-- set; the actual editor belongs to Team Details (Section 8), never a random inline mutation here.
alter table public.teams add column if not exists description text;

comment on column public.teams.description is
  'Team Profile "About This Team" copy -- optional, presentation-only. Never invented by a client; empty until a team manager writes one through Team Details.';
