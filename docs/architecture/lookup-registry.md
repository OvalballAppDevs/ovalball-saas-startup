# Ovalball Lookup Usage Registry

Status: living document, first drafted during the Master Architecture Pass (2026-09-03), values
verified directly against the live local schema (`docker exec ... psql -c '\d <table>'`).

## How to read this document

Every dropdown, status badge, or classification in Ovalball falls into one of two buckets:

- **Managed Business Configuration** — a real table, Site-Admin-editable (or club-admin-editable
  within a scope), server-validated. New values can be added by an authorized human without a code
  change.
- **Controlled System Domain** — a Postgres `CHECK` constraint enum (or a TypeScript literal union
  mirroring one). Adding a value requires a migration and almost always a corresponding code change
  (new label, new badge color, new business rule) — never casually editable through an admin UI.

Before adding a new dropdown, option list, or status badge anywhere in the app: check this table
first. If the domain is already listed, use its canonical source and existing shared
selector/label-map — do not add a new hardcoded array. If it's missing, add a row here before
shipping the feature.

---

| Domain | Classification | Canonical source | Stable ID | Managed by | Shared presentation | Known consumers |
|---|---|---|---|---|---|---|
| **Rugby Code** | Controlled | `CHECK (rugby_code = ANY ('union','league'))`, repeated on `clubs`/`club_directory`/`seasons`/`competitions`/`tournaments`/`teams` | the literal string `'union'` / `'league'` | Code, not editable | `lib/seasons/validation.ts`'s `RugbyCode` type + `seasonYearLabel()` | Season creation/validation, Calendar/Rollover season resolution, Competition/edition scoping, Tournament creation |
| **Season** | Managed | `seasons` (`rugby_code`, `season_year_start`, generated `season_year_end`, `starts_on`, `ends_on`, `pre_season_starts_on`, trigger-derived `name`) | `seasons.id` | Site Admin (`/admin/seasons`), server-validated via `validateSeasonDates()`, app-level `(rugby_code, season_year_start)` uniqueness (not yet a DB constraint — see below) | `lib/seasons/validation.ts` | `/admin/seasons`, `/club/rollover`, `/calendar` (via `internal.resolve_season_for_date`), `fixtures` insert trigger |
| **Fixture Status** | Controlled | `fixtures_status_check`: `Planned, Booked, To Be Determined, Annual Holiday, Festival, Lancashire Cup, Cancelled, Completed` | the literal string | Code | `lib/fixtures/status.ts` (`ALL_FIXTURE_STATUSES`, `FIXTURE_STATUS_LABEL`, `FIXTURE_STATUS_BADGE_CLASS`) — consolidated this pass from 4 independent local color maps (2 of which had a real live bug: "Booked" colored the same amber as "Planned") | Fixture Management, Fixture Detail, Dashboard, Calendar, mobile fixture card |
| **Fixture Source** | Controlled | `fixtures_source_check`: `club_created, site_admin_manual, csv_import, competition_import` | the literal string | Code | `SOURCE_LABEL` in `app/(app)/admin/fixtures/format.ts` | Fixture Management filters/table |
| **Fixture Result Status** | Controlled | `fixtures_result_status_check`: `none, awaiting_confirmation, final, disputed, amendment_pending, external_recorded, unverified` | the literal string | Code | Not yet consolidated into a shared label map — verify before adding a new consumer | Fixture result reconciliation (`lib/app-context/reconcile-results.ts`), Fixture Detail |
| **Game Type** | Controlled | `fixtures_game_type_check`: `Friendly, League Fixture, Cup Fixture, Scheduled Match` | the literal string | Code | `app/(app)/admin/fixtures/types.ts` | Add/Edit Fixture forms |
| **Home/Away** | Controlled | `fixtures_home_away_check`: `Home, Away, TBD, Not Applicable` | the literal string | Code | `HomeAwayBadge` component | Fixture rows everywhere |
| **Fixture Request Status** | Controlled | `fixture_requests_status_check`: `draft, sent, accepted, declined, counter_proposed, cancelled, expired` | the literal string | Code | `STATUS_LABELS` map in `app/(app)/messages/page.tsx` | Messages list, `/fixtures` (before this pass blocked it for Parent View) |
| **Rugby Team Category / Age Group** | Controlled | `teams_age_group_check` (verified live: `U6`–`U18`) | the literal string | Code | `lib/teams/age-groups.ts`'s `YOUTH_AGE_GROUPS` — consolidated this pass from two independently-hardcoded arrays, one of which was wrong (only went to U16) | Team creation, Rollover, Opponent Resolver |
| **Club Role** | Controlled | `club_memberships_role_check` (verified: `BASIC_USER, CLUB_ADMIN, FIXTURE_SECRETARY`) | the literal string | Code | `lib/permissions/role-labels.ts`'s `CLUB_ROLE_LABEL`/`clubRoleLabel()` — consolidated this pass from ~8 independent local label maps | People, Team People, Group Form, Connected Users, Membership Card, User Filters, Messages detail |
| **Team Permission** | Controlled | `team_permissions_permission_check` (verified: `team_admin, coach, manager, view_only`) | the literal string | Code | Same `lib/permissions/role-labels.ts`, `TEAM_PERMISSION_LABEL`/`teamPermissionLabel()` | Same consumers as Club Role, plus `active-context.ts`'s Context Switcher labels |
| **Site Admin Role / Capability** | Controlled (role) + Managed (per-person capability grants) | `site_admins.admin_role` (`full, fixture_ops, club_data, user_access, message_moderator, read_only`) + five independent boolean grants (`diagnostic_club_access`, `manage_team_catalogue`, `manage_competitions`, `manage_fixture_support`, `manage_global_lookups`) | `site_admins.user_id` | Site Admin (`/admin/site-admins`) | `app/(app)/admin/site-admins/profiles.ts`'s `profileLabel()` | Site Admin nav, Require-Site-Admin guard, Site Admin invitation |
| **Competition** | Managed | `competitions` (`rugby_code`-scoped) + `competition_editions` | `competitions.id` / `competition_editions.id` | Site Admin with `manage_competitions` capability | Not yet audited for a shared selector — flag before adding a new picker | Calendar competition filter, Fixture edit |
| **Venue** | Managed | `venues` (club-scoped, `is_default_home`) | `venues.id` | Club Admin (`/club/venues`) or Site Admin with `manage_global_lookups` | — | Fixture creation, Ovie's default-home-venue resolution |
| **Pitch** | Managed | `club_pitches` (club-scoped) | `club_pitches.id` | Same as Venue | — | Fixture creation, Training scheduling |
| **Canonical Team Type** | Controlled | `canonical_team_types` (a real table, but Site-Admin-only via `manage_team_catalogue` — closer to Controlled than fully open Managed) | `canonical_team_types.id` | Site Admin with `manage_team_catalogue` capability | `lib/teams/catalog.ts` | Team creation/rollover |
| **Partnership State** | Controlled | `club_partnerships_status_check`: `pending, active, revoked` | the literal string | Code (state machine driven by RPC, not freely editable) | Not yet consolidated | Partner Clubs page, public club page CTA |
| **Club Conversation Status** | Controlled | `club_conversations_status_check`: `pending, accepted, declined` | the literal string | Code | `STATUS_LABELS` (shared with Fixture Request Status map in `messages/page.tsx`) | Messages |
| **Invitation Status** | Controlled | `invitations_status_check`: `pending, accepted, revoked, expired` | the literal string | Code | Not yet consolidated | People invite flow |
| **Club Claim Status** | Controlled | `club_claims_status_check`: `pending, verified, rejected` | the literal string | Code | Not yet consolidated | Admin Clubs, public claim flow |
| **Club Claim Role** | Controlled | `club_claims_claimed_role_eligible`: 7 named committee roles | the literal string | Code | — | Club claim form |
| **Document Category** | Controlled | `club_documents_category_check`: `visitor_guide, fixture_information, ground_pitch_information, parking, match_day_information, image, other` | the literal string | Code | `lib/documents/categories.ts`'s `DOCUMENT_CATEGORY_LABEL` | Documents page |
| **Support Ticket Status** | Controlled | `support_tickets_status_check`: `new, in_progress, closed` | the literal string | Code | `lib/support/types.ts`'s `SUPPORT_STATUS_LABELS` — consolidated this pass (was a hardcoded local array in `support-filters.tsx`) | Admin Support |
| **Support Ticket Category** | Controlled | `support_tickets_category_check`: 15 named categories | the literal string | Code | Not yet consolidated | Support ticket form |
| **Tournament Status** | Controlled | `tournaments_status_check`: `pending_host_confirmation, confirmed, cancelled, completed` | the literal string | Code | Not yet consolidated | Calendar tournament entries |
| **Tournament Participant Status** | Controlled | `tournament_participants_status_check`: `pending, accepted, declined, external_recorded` | the literal string | Code | Not yet consolidated | Calendar tournament entries |
| **Fixture Event Type** | Controlled | `fixtures_event_type_check`: `holiday, festival, vacant` | the literal string | Code | Overlaps conceptually with Fixture Status's `Annual Holiday`/`Festival` values — worth a closer look for whether these are genuinely two independent domains or should collapse into one (flagged, not resolved this pass) | Calendar |

---

## Explicit non-findings

- **No single generic `lookups` table exists anywhere**, and none should be created — every domain
  above is a proper, independently-owned table or a `CHECK` constraint on its natural home table,
  matching the Master Architecture Pass's own §2 instruction.
- **`season_year_end`** on `seasons` is a `generated always as (season_year_start + 1) stored`
  column applied uniformly regardless of `rugby_code` — confirmed via search that no current
  consumer reads it; `lib/seasons/validation.ts` deliberately never touches it, and the Rugby
  League single-calendar-year question (§44 of the original consolidation brief) remains reported,
  not resolved, exactly as instructed at the time.
- **No `season_year_options` table** — year dropdown options are generated deterministically
  (`seasonYearStartOptions()`), per the explicit earlier instruction not to build one.

## Consolidated this pass (single canonical source now, previously duplicated)

Fixture Status, Fixture Source, Youth Age Groups, Club Role, Team Permission, Support Ticket
Status, Site Admin Profile labels — all now have exactly one label/color map each, imported
everywhere instead of redeclared. See the Relationship Registry's §9/§16 for the authorization-side
equivalent of this same consolidation.

## Not yet consolidated (flagged, not yet fixed — lower priority than the security-class fixes)

Fixture Result Status, Partnership State, Club Conversation Status, Invitation Status, Club Claim
Status, Support Ticket Category, Tournament Status, Tournament Participant Status, Document
Category's own label map exists but hasn't been audited for duplicate local copies elsewhere. None
of these were found to have a live *bug* (unlike the Fixture Status color bug) — they're duplication
risk, not confirmed incorrect today, which is why they were deprioritized behind the security-class
fixes in this pass.
