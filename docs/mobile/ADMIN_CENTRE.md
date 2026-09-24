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

---

# CA-M3 — People & Memberships, and the venue pin

## The geocoding dependency, and its correction

CA-M2 shipped a venue that was saved on mobile with `geocode_status = 'pending'` and no pin,
because geocoding lived in the Next.js server action that ran after the web form saved
(`lib/geocoding/backfill.ts` → `geocodeVenueFromPostcode`, a postcodes.io call from the web
process). A venue saved from the phone never met that code. Both clients are now equal because
the platform pins the venue itself:

- `20270544000000` — `pg_net` is enabled; `internal.venue_geocode_requests` records each
  outstanding lookup; `internal.record_venue_geocode` is the one pin writer (it refuses when the
  venue's postcode has changed since the lookup was issued, so a stale answer never lands);
  `internal.request_venue_geocode` issues the postcodes.io lookup; `internal.collect_venue_geocodes`
  turns 200 → `success`, 404 → `failed`, anything else → retry; `process-venue-geocoding` runs every
  minute under `pg_cron`. A trigger on `venues` requests a pin after insert and after any postcode
  change. `public.request_venue_geocoding(venue)` (`venue.venue.manage`) re-asks for one venue;
  `public.geocode_pending_venues()` (`site.clubs.profile.manage`) re-asks for all.
- The web no longer geocodes after save; its Site Admin backfill calls `geocode_pending_venues`.
  `geocodeVenueFromPostcode` is deleted. No client holds a provider secret (postcodes.io needs
  none) and no client computes or caches a coordinate. A failed lookup keeps the venue and marks
  it `failed`; the map link falls back to the address text (`venueMapsQuery`). There is no guessed
  pin.
- Proof: a venue saved on mobile (SW1A 1AA) was pinned in 51 s and a venue saved on the web (BB10
  2LS) in 46 s, each shown pinned on the other client; the pin rows carry no actor (the platform
  wrote them). `supabase/tests/venue_geocoding_platform.sql` (CANONICAL_GATE, 15/15) simulates
  the HTTP responses.

## The People read model

One paginated, searchable read model — `public.club_people(club, search, filter, limit, offset,
membership_id)` (`20270545000000`) — behind `people.member.view`. It returns members in ACTIVE,
SUSPENDED and PENDING with their primary club role, team roles (from `team_permissions`) and
additional non-seat roles (from `role_assignments`), plus CLUB_STAFF invitations that are ISSUED
and unexpired as `kind = 'invited'`. Filters are the states the domain already has (`all`,
`staff`, `members`, `pending`, `suspended`, `invited`); nothing was invented. Email is returned
only to a holder of `people.member.view_contact` (or Site Support acting in the club) and an
invitation's address is masked otherwise. It asserts, in its own definition, that it never reads
`players`, `guardians` or `date_of_birth`. `public.club_assignable_roles(club)` lists the
additional roles a club may give itself (visible, assignable by CLUB, not a primary seat, not the
site-confirmed Safeguarding Officer).

**Shared contracts** — `packages/contracts/src/club/people.ts`: `readClubPeople`,
`readClubPerson`, `readAssignableRoles`, `readPendingJoinRequests`, `readPeopleCapabilities`, and
one wrapper per operation: `setPrimaryClubRole` (`set_primary_club_role`), `transitionMembership`
(`transition_club_membership` to SUSPENDED / ACTIVE / REVOKED), `setTeamAccess` /
`removeTeamAccess`, `assignAdditionalRole` (`assign_role`) / `endRoleAssignment`
(`transition_role_assignment` → REVOKED), `decideJoinRequest`. `reasonRuleFor(rpc, context)`
reads `REASON_REQUIRED_OPERATIONS`: "required" when the list says always, and for
`transition_club_membership` when acting on somebody else (the one condition a client can settle
for itself); otherwise "optional" and the server still decides.

**Web** — `/people` is gated on `people.member.view` via the shared capabilities (the
`CLUB_ADMIN`-role gate is gone), lists from `club_people`, and its role change, suspend / restore
(new, with a reason), remove and team-role removal call the shared wrappers. `/people/[id]` is
unchanged in shape and already used the same RPCs.

**Mobile** — Admin Centre → People: server search, filter chips, paged list ("Show More"),
"Waiting On You" join requests with approve / decline; a person screen with Identity (name,
email where permitted, personal avatar through `resolvePersonalAvatarUrls`), Club Membership
(Change Club Role), Team Roles (add from the club's active teams with the shared permission
options; remove), Additional Roles (from `club_assignable_roles`; end), Access (Suspend /
Restore / Remove From Club). Every write goes through one `ReasonSheet`
(`apps/mobile/src/admin/reason-sheet.tsx`): it names the change, asks for the reason when the
shared rule says so (confirm disabled until given), shows the server's own sentence on refusal,
and re-asks the screen's authority on 42501. Nothing executes on a swipe or a single tap. The
screen hides every control for the viewer's own membership and re-reads on focus and after each
write.

## Authority by action

| action | capability (server) |
|---|---|
| see People section / list / person | people.member.view |
| see an email address | people.member.view_contact |
| change club role, give / end an additional role | people.role.assign_club (`internal.club_people_authority`) |
| suspend / restore / remove a membership | people.role.assign_club as enforced today; the catalogue names people.membership.suspend / .revoke — recorded in the register, not changed here |
| add / remove a team role | people.role.assign_team (`set_team_access` / `remove_team_access`) |
| approve / decline a join request | people.join_request.review |
| Safeguarding Officer | never through these operations (server refuses) |

What the server already protects, and what these screens rely on rather than re-implement:
a Club Admin cannot suspend or remove their own membership; the last Club Admin cannot be
removed or demoted (`assert_club_keeps_an_admin`); any role, including Volunteer, needs an adult
date of birth on the person's profile (the sheet shows that sentence when it applies).

## Boundaries kept

No permission editor and no capability-override write anywhere in People (test-guarded). No
Site Admin information, no memberships at other clubs, no safeguarding records, no players or
guardians, no date of birth (the read model asserts this about itself). Invitations are shown
in their pending state only; issuing, resending and revoking stay on the web. Messaging is
untouched.

## Proof

- `supabase/tests/club_people_memberships.sql` (CANONICAL_GATE, 29/29): read model rows,
  contact gating, filters, search, paging, invited rows, self flag; role change, team role,
  Volunteer given and ended, Safeguarding Officer refused, suspension needs a reason, suspended
  filter, restore, self-suspension refused, last-admin refused, removed leaves the list, stranger
  refused, deny override on `people.role.assign_club` refuses then revoke restores; the read
  model never touches players / guardians / date of birth.
- `mobile_admin_centre.test.mts` (14/14): People gated on `people.member.view` on both clients;
  every mutation through the shared wrappers; no direct table reads or writes; no override
  writes; the reason rule from the one list; filters; name resolution.
- Browser proof (`scratchpad/admin/proof-people.mjs`, subject Bethan Price, reversible): list,
  search, filter, self marked, no date of birth; club role Member → Fixture Secretary on mobile →
  web select shows it → back on web → mobile shows Member; Volunteer given on mobile → web person
  page lists it → ended on mobile → gone on web; Under 8 Mixed B Manager given on mobile → web
  chip → removed on mobile → gone; suspended on mobile (confirm disabled until a reason is given)
  → web shows Suspended → restored on web → mobile shows Active; **stale authority**: deny on
  `people.role.assign_club` mid-screen → the server's refusal sentence in the sheet, controls gone
  on refocus, People stays listed because `people.member.view` is still held, revoke → controls
  back; the removal sheet needs a reason and was cancelled (removal is terminal; proved in SQL);
  16 audit rows with the acting Club Admin as actor; the review world ends as it began.
- The review persona Bethan Price now has a date of birth on file (recorded through
  `record_own_date_of_birth` as herself), an intentional, persistent enrichment: without one the
  server refuses her every role, which is the product behaving correctly.

## Mapped, not built: CA-M4

`docs/mobile/ROLES_AND_PERMISSIONS_MAP.md` records the capability read model, club versus team
scope, bundles, the override operations, protected capabilities, delegation, reasons, `R`,
self-protection and the suites that guard them, for the Roles & Permissions slice that follows.

---

# CA-M4 — Roles & Permissions: canonical capability authority, scoped decisions, recent authentication

## The model, in the product's words

**ROLE = default bundle.** Coach, Team Manager, Fixture Secretary, Club Admin: each is a bundle of
capabilities (`role_definitions` → `capability_bundles` → `bundle_capabilities`). **DECISION = scoped
exception.** ALLOW or WITHHOLD one capability for one person at the club or at one team
(`capability_overrides`, written only by `set_capability_override`). A decision never changes the role,
never rewrites the bundle, never reaches another scope. **INHERIT = no decision**: the role answers.
**RESTORE DEFAULT = the decision is removed** (`revoke_capability_override`), never an opposite decision.
**The SERVER computes the effective answer** (`internal.capability_decision`, rules 0–8, unchanged in
precedence) and **both clients consume the same row** from one computation.

## Authority mismatches found and corrected first (migration `20270546000000`)

Before a switch was offered, every operation behind it was checked against the key the switch names.

| switch / operation | enforced before | enforced now |
|---|---|---|
| Suspend / Restore Membership | `people.role.assign_club` via `internal.club_people_authority` | `people.membership.suspend` via `internal.club_membership_authority` |
| Remove From Club | `people.role.assign_club` | `people.membership.revoke` |
| Cancel Fixtures (`cancel_fixture`) | `fixture.result.record` via `can_submit_fixture_result` | `fixture.fixture.cancel` via `internal.can_cancel_fixture` (same shape: either side's team or club, or Ovalball support) |
| Pitch Allocation (`pitch_allocation_proposals*` policies) | legacy `fixture.edit` | `venue.pitch_allocation.manage` (writes) / `.view` (reads) |

No broadening: `people.membership.suspend` / `.revoke` are `grant_level = 'N'` and only the Club Admin
bundle holds them — the same holder set as before. What is new is that a Site Admin withhold of either
now bites (RP-G2). The other editor keys were audited and already enforced where they are named
(`create_fixture` → `can_create_team_fixture`, `update_fixture_*` → `can_edit_fixture_details`,
`accept_fixture_request`, `can_submit_fixture_result`, `can_manage_training`, `can_manage_club_event`,
`fixture_requests_insert_scoped`, `can_bulk_plan_fixtures`, `bulk_update_fixtures`). The editor exposes
**only the audited keys** (`EDITOR_KEYS` in `packages/contracts/src/club/permission-groups.ts`); a
capability without a proven server check is not offered.

## The canonical read model

`internal.person_capability_rows(subject, scope, club, team, keys)` answers, per delegable capability at
the scope: `label`, `description`, `domain`; `effective`, `decisive_rule`, `reason_code`, `source`
(`role` / `granted` / `denied` / `restricted` / `none`); **`role_default`** and **`role_default_role`**
(what the person's bundles supply with every decision ignored — `internal.bundle_source`); the explicit
decision (`override_id`, `override_effect`, `override_level`, `override_reason`, `override_granted_at`,
`override_granted_by`, `override_expires_at`); and `editable` (`internal.override_authority_level` for
the caller, never for self). Three public readers share it: `club_person_permissions(club, user, scope,
team?, keys?)` (one person, one scope; gated on `people.capability.manage` or `people.access.explain`
or `site.users.view`), and the website's grids `club_member_capabilities` / `club_team_capabilities`
(re-expressed over it, same columns plus `user_id`). `club_person_permission_scopes(club, user)` lists
the scopes a decision about a person can name: the club, and each team they hold a role on.

Neither client computes an effective answer. `stateOf(row)` in the contract only *reads* whether a
decision exists and which effect it has; `effective` is always the server's column.

## Scope

Scope is first-class on both clients. The native editor has a segmented control — **Club** and one
chip per team the person holds a role on — with one sentence under it saying where the decision
applies. The website keeps its scope switcher in the URL. A team decision is never promoted to club
scope: the write carries `p_scope_type` and `p_team_id` exactly as chosen, and the server refuses a
team scope for a person with no role on that team (RP-D1). Club-wide powers (Planner, import, bulk
edit, delete) have no team scope in the catalogue and cannot be named at one (RP-B8).

## The three-state control

Every editable row offers **Use role default / Allow / Withhold**, never a boolean. When a decision
exists the row shows all three truths — `Role default: Allowed by Coach`, the decision badge
(`Allowed explicitly` / `Withheld` / `Expired decision`), and the effective result — so a Club Admin
never has to remember what they changed six months ago. Allow appears only where the server says the
caller may decide (`editable`), which already folds in delegability, `grant_level`,
safeguarding-sensitivity, the caller holding the key by bundle, and self. A withhold needs a reason
(the server's own rule, `permissionReasonRule("withhold") === "required"`); an allow and a restore take
one when offered. The boilerplate reason the website used to send is gone; the reason is the person's.

## Recent authenticator (R) — first enforcement

`people.capability.manage`, `people.membership.suspend` and `people.membership.revoke` are `R` in the
catalogue. `set_capability_override`, `revoke_capability_override` (and through it
`apply_capability_preset`) and `transition_club_membership` (suspend / restore / remove of another
person) now call `internal.require_recent_aal2(interval '10 minutes')` **after** the authority
decision. Definition (existing architecture, `internal.recent_aal2`): a TOTP verification recorded in
`auth.mfa_amr_claims` for the **current session** within the last ten minutes; a session without a
`session_id` claim (service key, SQL harness) is not a browser session and passes. Failure raises 42501
"Enter a code from your authenticator to continue." Both clients inherit it from the one place.

- **Web:** the actions call `guardAction({ recentMinutes: 10 })` first (a boolean gate on
  `my_session_assurance().recent_aal2`) and, on either refusal, return `href: /security/verify`; the
  panel and the People rows render "Verify Now" → `/security/verify?next=<current path>`, and the
  existing verify flow returns through `safeNextPath`.
- **Mobile:** `apps/mobile/app/step-up.tsx` is the canonical TOTP challenge on the current session with
  a Cancel (the person is already signed in). The `ReasonSheet` / decision sheet recognise the
  refusal (`isRecentAuthRefusal`), hand the pending intent to `usePendingIntent` (memory only), and
  the screen navigates to the step-up. On return the sheet re-opens with the same ask and reason
  ("Verified. Confirm to continue.") and the person confirms again — **the server authorises again**;
  the mutation never runs because a code was accepted.

Proved (RP-F1–F7): AAL2 with no code → refused; code two minutes old → accepted; four hours old →
refused (decision, restore and suspension alike); fresh code but capability withheld meanwhile →
refused as unauthorised, not asked for a code. Authentication is not authorisation.

## Subject and scope validity

A decision names an active member (23514 otherwise) and, at team scope, somebody with an active role
on that team. The engine's rule 5 now ignores a TEAM allow once that role has gone
(`TEAM_ROLE_LAPSED` in the trail): no grant outlives the relationship it was made for (RP-D4–D6). Two
existing suites granted team keys to people with no team role; their fixtures now give the person a
team role first (`capability_override_ceilings.sql` OC5, `team_fixture_authority.sql` H7).

## Ceilings, self, last admin

Non-delegable keys (`grant_level` N/S) and safeguarding-sensitive keys are neither listed nor
decidable by a club; `site.*` keys are refused by name; a crafted site-scope decision by a Club Admin
is refused. A person's own rows are never editable and the server refuses self. Because no club-level
decision can touch `people.capability.manage` (N, not delegable), **no override path can leave a club
without a permission administrator** — the last-admin invariant lives in role-land
(`assert_club_keeps_an_admin`) and needs no twin here (RP-C2).

## Role change with a decision in place

A decision persists across a role change and still decides: a Coach withheld fixture creation at
Under 12 who becomes Team Manager there is still withheld, and the read model shows the new role
default (RP-I5). Both clients read the same row, so both say the same thing.

## Audit and history

Every decision emits `override.granted` (actor, subject, capability, effect, level, scope, reason)
and every restore `override.revoked`; a replacement emits both. `audit_log` holds the row change.
`club_access_history` (gated on `people.access.explain`) is the club-readable timeline with human
labels; the native person permissions screen shows its last ten entries. There is no second history
table.

## Native IA

Admin Centre → **Roles & Permissions** (people picker) → person → editor; and Admin Centre → People →
person → **Roles & Permissions**. The editor: name and role line; scope control; grouped rows from the
shared `groupsForScope`; a decision sheet with the three radios and the reason field; History. The
website's Permissions page keeps its grid but now shows the role default, badges, and reason prompts,
and calls the same contract.

## Proof

- `supabase/tests/roles_and_permissions_ca4.sql` (CANONICAL_GATE, 60/60): RP-A role defaults and
  decisions; RP-B the fixture case and no Planner escalation; RP-C ceilings, site, safeguarding, self,
  last admin; RP-D subject and scope, TEAM_ROLE_LAPSED; RP-E admin stale authority; RP-F R; RP-G
  membership keys; RP-H cancel and pitch allocation keys; RP-I cross-club, read-only persona, no title
  authority, role change with a decision; RP-J audit.
- Neighbouring suites after the migration: `capability_override_ceilings` 37/37,
  `capability_precedence_truth_table` 50/50, `team_fixture_authority` 51/51,
  `fixture_management_authority` 100/100, `mobile_fixture_authority` 27/27, `capability_attack_matrix`,
  `capability_scope_isolation`, `capability_defaults_architecture`, `explain_access_matches_enforcement`,
  `capability_adapters`, `club_people_memberships` 29/29, `membership_state_machine`,
  `cross_club_isolation_matrix` 87/87, `aal_enforcement`, `audit_immutability`,
  `security_events_no_secrets`, `site_admin_users_access_closure`, `site_master_control`,
  `role_assignment_*`, `age_eligibility_matrix` — all green. JS: override / authority / membership
  races, navigation architecture, bottom bar projection, fixture return context, perimeter manifest,
  shared contracts — green.
- Browser proof (`scratchpad/ca4/proof-ca4.mjs`, subject Bethan Price, decider Priya Nair with an
  authenticator enrolled for the run and removed afterwards; every decision restored and the seeded
  Under 12 decision put back): web withhold at Under 12 → mobile shows "Withheld", the role default and
  the effective result; Coach kept, view kept, `create_fixture` refused, control read unchanged for the
  decider; mobile restore default → web shows "From their Coach role" with no decision row and no
  opposite decision; mobile allow at Under 8 Mixed B (Volunteer, no role default) → web shows "Allowed
  explicitly", creation there yes, elsewhere no, Planner / import / bulk / club-wide all false; web
  restore → mobile "Not allowed". R on mobile: stale claim → step-up screen with nothing written →
  code → return to the exact editor → sheet re-opened with choice, reason and note → nothing written
  until the explicit confirm → then written. Step-up cancelled → nothing written, no sheet then or on a
  later visit. R on the web (membership suspend): refusal sentence + "Verify Now" → verify → back at
  People with the member still active → deliberate confirm → suspended → restored. Stale admin: server
  sentence in the sheet, no controls on refocus, section gone from the Admin Centre, People stays,
  controls back on revoke. Stale subject: the server's "holds no role on that team" sentence, scope gone
  on refocus. Read-only persona (Fixture Secretary): People yes, Roles & Permissions absent, the editor
  says "You do not have access to this person's permissions.", crafted write and read both 403.
  Audit: `override.granted` / `override.revoked` / `membership.*` events with actor, subject,
  capability, effect, scope, team, level and reason; the club timeline shows the same with human
  labels; a restore is `override.revoked` and leaves no opposite decision.
- iOS export on the final source (`scratchpad/hub-ios-ca4`, 15 MB): the editor, the step-up and the
  read model are in the bundle. Physical iPhone review is pending; it needs an authenticator enrolled
  on the website for the Club Admin persona first.
