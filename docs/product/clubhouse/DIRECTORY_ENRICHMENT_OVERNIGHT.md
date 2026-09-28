# Overnight Canonical Rugby Club Directory Enrichment — Architecture Audit

Written before any data changes, per the programme's own Section 3 requirement.

## The one canonical directory

`public.club_directory` (Postgres table) is the sole canonical Rugby Club Directory. No
second directory, no parallel JSON, no separate mobile dataset exists or was created by
this programme.

Schema (confirmed live via `\d public.club_directory`): `id`, `name`, `rugby_code`
(union/league), `country`, `nation` (England/Scotland/Wales/Northern Ireland/Republic of
Ireland), `region`, `county`, `town`, `home_ground`, `address`, `postcode`, `website`,
`official_email`, `source`, `external_id`, `source_url`, `source_updated_at`, `active`,
`verification_status`, `notes`, `constituent_body`(_id), `normalized_key`, `logo_storage_path`,
`latitude`/`longitude`, `geocoded_at`, `geocode_status`, `geocode_source`, `bio`,
`facebook_url`, `admin_verification_status`.

`public.clubs` (an activated Ovalball organisation) has `directory_id references
club_directory(id)` and its OWN copies of `bio`, `website`, `logo_storage_path`,
`address_display`, `latitude`/`longitude` — an activated club's operational profile is a
separate, richer record. **Directory research only ever touches `club_directory`. It never
writes to `clubs`, and a `clubs` row's own data is never read back into or overwritten by
directory research.** 18 of 1,408 directory rows are currently linked to an activated
`clubs` row.

`public.venues` requires a non-null `club_id` (an activated club) — there is categorically
no venue row for a directory-only club, so a directory club's ground stays as
`club_directory.home_ground`/`address`/`postcode` plain text, never a fabricated `venues`
row.

`public.club_kits` is the canonical STRUCTURED playing-colour model, but it is FK'd to
`clubs.id` only — an unclaimed directory club (1,390 of 1,408 rows) has nowhere to record
colours at all. This gap is closed tonight (see Migration below) by adding
`primary_colour`/`secondary_colour`/`accent_colour` to `club_directory` itself, using the
exact same hex-validated shape `club_kits` already uses. `club_kits` remains the sole
authority for an activated club's own configured kit; it is never read from or written to
by directory research.

## The Online Directory Verification pipeline already exists

This is the single most important finding of this audit: **a mature, fully-built,
staging-then-review enrichment pipeline already exists** for exactly this task. Nothing
here needed a new architecture — only research content and three small, additive schema
extensions.

- `lib/directory-research/provider.ts` — `researchClub()`. Fully specified contract
  (`DirectoryVerificationProposal`, confidence bands, four-tier source-priority policy),
  currently returns `{status: "not_configured"}` for every call because no third-party
  research provider API key exists in this environment (matches this repo's own
  established "honest `not_configured`, never a fake result" convention, e.g.
  `lib/address-lookup/lookup.ts`).
- `public.club_directory_research_proposals` — one staged row per (directory_id, field),
  with `current_value`, `proposed_value`, `source`, `source_url`, `confidence`, `status`
  (pending/accepted/rejected/conflicting). A partial unique index enforces at most one
  PENDING proposal per (directory_id, field) — naturally idempotent re-running.
- `public.directory_verification_runs` / `directory_verification_run_records` — a
  resumable, checkpointed run/batch model. Scopes: `current_club`, `filtered`,
  `needs_review`, `missing_data`, `entire_directory`. A run tracks
  `total_records`/`processed_records`/`proposals_created`/`conflicts_found`/
  `no_result_count`/`failed_count` and is safe to leave partially processed — it only
  flips to `completed` once `processed_records >= total_records`.
- RPCs (all `SECURITY DEFINER`, all gated on `internal.can_run_directory_verification()`
  → `site.directory.manage`, Full Site Admin or Club Data Admin only):
  `start_directory_verification_run`, `get_directory_verification_next_batch`,
  `record_directory_verification_result`, `preview_directory_verification_scope`,
  `list_directory_verification_runs`, `accept_directory_research_proposal`,
  `reject_directory_research_proposal`.
- `app/(app)/admin/clubs/data-quality/*` — the Site Admin review UI. `query.ts`'s counts
  read `admin_club_overview` (a `security_invoker` view with `flag_missing_*`/
  `flag_unverified`/`flag_duplicate_*` columns) — the same flags the scope resolver
  (`internal.resolve_directory_verification_scope`) uses, so the dashboard and the run
  scopes can never disagree about what "missing" means.

**A deliberate, explicit product decision, confirmed by reading `proposal-review.tsx`'s
own comment:** *"Never a bulk 'accept all' here — every field-level change gets an
individual look."* Acceptance is a one-proposal-at-a-time, human, capability-gated action.
This is why tonight's programme **stages real, well-sourced proposals for the owner's own
morning review through this exact existing tool, and does not itself call
`accept_directory_research_proposal` for any of them** — see the final report for the full
reasoning. `logo-manager.tsx`'s upload action, by contrast, has no staging step of its own
(a direct single-file upload) precisely because a crest is glance-verifiable by a human —
so tonight's crest research proposes a **candidate** (source URL + evidence) for a human
to look at and then upload themselves through that existing tool, never fetches/rehosts an
image automatically.

## What was NOT built tonight (and why)

- No second directory, no new table competing with `club_directory_research_proposals`.
- No automated bulk-accept of any proposal, however high-confidence.
- No new colour system — `club_directory.primary_colour`/`secondary_colour`/
  `accent_colour` reuse `club_kits`' exact hex-validation shape.
- No `researchClub()` rewrite pretending to call a real provider that doesn't exist — the
  function is left honestly `not_configured` for any *future automated* run. Tonight's
  proposals were produced by real, source-cited agentic research (this session, using
  live web search and page verification) and inserted through the exact same
  `record_directory_verification_result` RPC a real provider would call, so they carry
  identical provenance shape and flow through the identical review queue.
- No Republic of Ireland population — 0 ROI rows exist today; adding a new national
  dataset is a population-definition decision, out of scope for an enrichment pass, and is
  called out as an opportunity in the final report instead.
