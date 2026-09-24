# CA-M1 / CA-M2 — Admin Centre: Club Profile, Branding, Venues, Teams

One product, two clients. This records what CA-M1 built, the decisions it
applied from the owner's CA-M0 review, and how it was proved. The forensic map
it builds on is `CLUB_ADMIN_CENTRE_MAP.md`; the `R` register is
`RECENT_AUTH_CONVERGENCE.md`.

## What exists now

**Domain operations** (migration `20270540000000`), the one way either client
changes the Club Profile:

| operation | authority | validation | audit |
|---|---|---|---|
| `update_club_profile(club, bio, website, facebook_url, address_display)` | `internal.require_club_profile_editor`: `internal.session_ok()` (live, active, AAL-satisfied — the `session_ok_required` policy the direct write met) then `club.profile.edit` at the club via `internal.can`, or `site.clubs.profile.manage`; 42501 otherwise | trim; empty → null; a web address without a scheme gets `https://`; length ceilings; P0002 for a missing club | `audit_row_change` on `clubs` with the acting person; `updated_by` set |
| `save_club_contact(club, contact?, role, name, phone, email, is_public)` → id | same | name required; role from the check constraint; email shape; a contact being edited must belong to the club (P0002) | `audit_row_change` on `club_contacts`; `created_by`/`updated_by` set |
| `delete_club_contact(contact)` | same, at the contact's club | P0002 when missing | `audit_row_change` delete row |

The row policies (`clubs_update_admin`, `club_contacts_*_admin`) stay as the
floor. Nothing was broadened: `club.profile.edit` is `A2`, no `R`, and the
catalogue is untouched.

**Shared contracts** (`packages/contracts/src/club/profile.ts`,
`admin-centre.ts`, `../required-reasons.ts`): `readClubProfile` (the tables
under RLS, as the website reads them), `updateClubProfile` / `saveClubContact`
/ `deleteClubContact` (the operations), `canEditClubProfile` and
`readAdminCentreAccess` (`my_capabilities`), `clubProfileFieldsDiffer` (what
"unsaved changes" means), `clubProfileErrorMessage` (one error rule),
`ADMIN_CENTRE_SECTIONS` (the sections, each gated by the capability the
website's Club Settings navigation gates the same job on), and
`REASON_REQUIRED_OPERATIONS` (the twelve operations that ask the server for a
reason — asserted equal to the server's own set).

**Web**: `app/(app)/club/actions.ts` — `saveClubProfile`, `saveClubContact`
and `deleteClubContact` call the shared wrappers; the page, the form and the
contacts section are unchanged. Crest upload/removal is unchanged (already a
storage-policy-gated write shared with the app's `identity/images.ts`).

**Mobile**:

- `More → Club Admin → Admin Centre`, shown only in a club context and only
  when `my_capabilities` returns at least one Admin Centre capability at that
  club (`src/admin/access.ts`, re-asked on context change and on focus). Never
  from a role label.
- `/admin` landing: the club's crest and name in the bar; **In the App** (Club
  Profile) and **On the Web Today** (Teams, News & Announcements, Permissions,
  Guardians & Players, Safeguarding Officer, Season Handover, Lookup
  Administration, Subscriptions & Payments), each row only when the server
  says so, each web row opening the website's own page in the system browser.
  No dead rows, no WebView.
- `/admin/club-profile`: the club's name (read-only, from the Club Directory),
  About the Club, Website, Facebook, Home Ground Address as native inputs;
  one dirty-tracked draft with **Discard / Save Changes** in a fixed footer
  that appears only when there are unsaved changes; **Public Contacts** with
  Add Contact / Edit / Remove (two-step confirm), role chips, public switch.
  Re-reads on mount, on focus and after every write; locks the fields and
  says why when the server refuses with 42501; no queued mutation, no local
  store, no optimistic authority.

## Owner decisions applied

1. **`R`** — no mobile enforcement, no bulk enablement; CA-M1's mutations are
   `A2` only; the register is `RECENT_AUTH_CONVERGENCE.md`.
2. **Capability, not role** — visibility and editability come from
   `my_capabilities`; the role-authorised RPC mismatches are recorded there for
   their own slices; access was not broadened.
3. **Domain operation first** — the four profile fields and the contacts are
   now RPCs on both clients. No direct mutation was kept: the "provably
   simple" exception was not needed.
4. **One required-reasons list** — `REASON_REQUIRED_OPERATIONS`, twelve
   entries, asserted equal to the set of public functions calling
   `internal.require_reason`. The people/permissions screens consume it when
   their slice ships.
5. **One audit history** — the row triggers record every change from either
   client with the acting person. Client origin as non-authoritative metadata
   was **not** added: it would have meant touching the shared audit trigger
   for a column no reader yet needs; recorded as an option, not a gap.
6. **Fix with the owning slice** — only the price oracle was fixed outside a
   slice (commit `149613f`, RED containment, see its migration and suite).

Contact names are **not** passed through `internal.normalise_person_name`: a
club contact may be a desk or an office ("Club Office", "Fixtures Desk") as
well as a person, and the normaliser would re-spell acronyms; the website
never normalised them either. The trim-and-require rule is the same on both
clients because it lives in the operation.

## Proof

- `supabase/tests/club_profile_domain_operation.sql` (CANONICAL_GATE, 22/22):
  update/create/edit/delete through the operations with trimming, scheme,
  lower-casing and `updated_by`; every validation refusal (22023/P0002);
  stranger and other-club admin refused (42501); **stale authority** — a Site
  Admin `set_capability_override(… 'deny' …)` refuses the holder's next save
  and `my_capabilities` says no, `revoke_capability_override` restores;
  site master may act; audit rows carry the actor; anon holds no grant; the
  required-reasons list equals the server's set.
- `supabase/tests/js/mobile_admin_centre.test.mts` (6/6): both clients through
  the operations, never the tables; no role branching; every section gated on
  a capability the website gates on; no queue/store; field and error rules;
  one reasons list.
- Perimeter manifest test green with the three operations declared;
  `security_perimeter_guard`, `cross_club_isolation_matrix`,
  `gocardless_function_grant_audit` green; web and mobile typecheck clean;
  eslint clean; iOS export.
- **Cross-client proof in the review world** (`scratchpad/admin/proof.mjs`,
  Playwright at 390 px, `uat.coach` — a Club Admin): web read → mobile change
  → web reread (same value, `audit_log` row with the actor) → web change →
  mobile refocus (same value) → mobile adds a contact → web shows it → mobile
  removes it → web reread (gone, delete audited) → **stale authority**: Site
  Admin withholds `club.profile.edit` through `set_capability_override` while
  the mobile screen holds an edit; Save is refused by the server with the
  server's own sentence, the fields lock, the Admin Centre no longer lists
  Club Profile; the override is revoked and the screen is editable again →
  baseline restored through the web form. Screenshots beside `proof.json`.

## Not in CA-M1 (and where it goes)

- Every "On the Web Today" section: its own CA-M slice, in the owner's order.
- Client-origin audit metadata: optional, see decision 5.
- The pre-existing suite debts found while running the gate are listed in the
  CA-M1 report, not fixed here (decision 6).


---

# CA-M2 — Club identity, Branding, Venues and Teams

## Preflight findings (re-read from disk, not the CA-M0 inventory)

- **Branding.** The crest is `clubs.logo_storage_path` (own upload in the public `club-logos`
  bucket under the club's id, policy `club.logo.manage`) with the Club Directory's branding logo
  as the canonical fallback (`resolveClubLogoPathFrom`); the app already had the same replace /
  remove flow the website has (`identity/images.ts`, upload → link → delete old, previous crest
  kept on failure). The kit is `club_kits` (variant `primary` / `alternate`) written only by
  `upsert_club_kit` (club.profile.edit; CHECK constraints validate pattern and hex). Club
  colours are DERIVED from the home kit by `resolveClubTheme` / `clubAccents…`; there is no
  colour table and none was added. The only web-only pieces were the swatch list (now
  `KIT_SWATCHES` in contracts) and the pre-flight validation (now `kitInputProblem`).
- **Venues.** Reads are `venues` / `club_pitches` under RLS. Every mutation was already an RPC,
  but a venue save was Next-only choreography (`create_venue` or `update_venue`, then
  `set_venue_address`, then a server-side geocode). No delete exists anywhere (no policy, no
  grant, no RPC, no button); `set_venue_active(false)` is the only removal and keeps every
  fixture, session and pitch. Web-only rules that stay web-only and are recorded: the first-run
  wizard's "postcode required / line 1 or town / home ground needs a pitch"; the address lookup
  (getAddress.io, server key); `lib/geocoding/backfill.ts` writing `venues` directly (the one
  direct table write in the domain, relying on `authenticated`'s column UPDATE grant on
  `venues`) — documented, not fixed (decision 6).
- **Teams.** A team is a canonical Team Directory identity (`canonical_team_types` projected by
  code through `canonical_team_types_by_code`); name and slug are trigger-derived; identity is
  immutable after creation on the web (Season Handover moves it). The website CREATED a team with
  the one direct INSERT into `teams` in the application, resolving fields from a LABEL. Fold /
  reactivate (`fold_team`, `reactivate_team`) already authorise on `team.lifecycle.manage` in the
  database; the role check CA-M0 flagged was on the web page (`canManage` from
  `club_memberships.role`) and on the Add Team gate (`club.profile.edit`).

## What CA-M2 built

**Migrations (forward-only):** `20270542000000` `save_club_venue(club, venue?, name,
directions, line1, line2, town, county, postcode, country, set_default)` — one transaction over
`create_venue` / `update_venue`, `set_venue_address` (still the one address writer) and
`set_default_venue`; `internal.session_ok` then `internal.can_manage_venue`. `20270543000000`
`create_club_team(club, canonical_team_type_key, squad_letter?)` — `team.team.manage` or
`site.team_roles.manage`; the club's code from the Club Directory; the identity must be offered
for it; B/C only where the catalogue allows squads; the triggers derive everything else; pins
that `fold_team` / `reactivate_team` authorise on `team.lifecycle.manage`.

**Shared contracts:** `club/branding.ts` (read crest + kits + derived theme, `saveClubKit`,
capabilities, one error rule), `club/venues.ts` (reads, `saveClubVenue`, active / default /
pitch operations, capabilities, `venueAddressLine`, `venueMapsQuery` — coordinates only when
`geocode_status = 'success'`), `club/teams.ts` (directory read grouped by the shared taxonomy,
catalogue + availability, `createClubTeam`, fold / reactivate, alias for B/C squads only,
capabilities), and `teams/catalog.ts` + `teams/directory-taxonomy.ts` moved from `lib/teams`
(web shims left).

**Web:** venue create / update actions call `save_club_venue`; team creation calls
`create_club_team` by key (the direct insert is gone); `/teams/[teamId]` gates the alias editor on
`team.team.manage` and fold / reactivate on `team.lifecycle.manage` (the role check is gone);
`/teams` gates Add Team on `team.team.manage`; the kit editor uses the shared swatches.

**Mobile:** Admin Centre → Branding (crest via the existing picture sheet; Home / Away kit with
pattern, colours, live shirt, per-variant save; derived club colours shown), Venues (list with
home ground and pitch counts; create / edit; Make Home Ground; Deactivate with confirmation;
Reactivate; Open in Maps; pitches add / rename / deactivate), Teams (grouped by the shared
taxonomy; Add Team from the Directory by key with the website's availability rules; team
identity read-only; squad name for B/C; Fold with reason and confirmation; Reactivate). Every
control asks its own capability; every screen re-reads on focus and after each write.

## Authority by action

| action | capability (server) |
|---|---|
| see Branding section | club.profile.edit (section gate) |
| replace / remove crest | club.logo.manage (storage policy + clubs row) |
| save a kit | club.profile.edit (`upsert_club_kit`) |
| see Venues section / list | venue.venue.manage (section gate); rows under venue.venue.view |
| create / edit venue, home ground, deactivate | venue.venue.manage |
| add / rename / deactivate pitch | venue.pitch.manage |
| see Teams section / list | team.team.manage (section gate); rows under team.team.view |
| add team, squad name | team.team.manage |
| fold / reactivate | team.lifecycle.manage (catalogue `R`, not enforced today — see register) |

## Proof

- `supabase/tests/club_identity_venues_teams_operations.sql` (CANONICAL_GATE, 29/29): venue
  create / edit / default / duplicate / nameless; stranger refused; Fixtures Secretary admitted
  by bundle, ordinary member refused; deny override refuses then revoke restores; deactivate
  keeps venue and pitch; audit with actor. Team by key with derived name and regulatory
  identity; B squad; duplicate; not-offered identity (Girls U13, union); D squad; unknown key;
  Fixtures Secretary refused. Fold: Fixtures Secretary refused; a holder by capability GRANT
  folds and reactivates; a Club Admin with the capability DENIED is refused; reason required;
  audit. Kit on club.profile.edit; anon grants.
- `mobile_admin_centre.test.mts` (12/12): person / crest / kit regression (crest from the logo
  columns, shirt from the kit, no avatar; header crest never a kit); protected Ovalball logos
  untracked and present; one swatch list; venues never written directly, no delete, no typed
  pin; teams via the operation, no name parsing, no age grade hard-coded, fold gated on the
  capability on the web; catalogue and taxonomy shared.
- Browser proof (`scratchpad/admin/proof-ca2.mjs`): landing lists Club Profile, Branding,
  Venues, Teams; kit mobile → web → mobile with audit; crest tile drawn from `club-logos`, shirt
  as SVG, no avatar; venue created on mobile → web; edited on web → mobile; deactivated on mobile
  → web (row kept, audited); **stale authority**: deny on `venue.venue.manage` mid-edit → save
  refused with the server's sentence, Admin Centre drops Venues, revoke → editable; team added on
  mobile from the Directory → web lists it, resolves to `RFU-U9` with 17 Rules of Play; folded
  on mobile → web shows folded; reactivated on web → mobile; proof team folded back.
