# Section 5 — Partners

## PURPOSE

Absorb Partners fully into Clubhouse (never rebuilt beside it) and close the real, named defect Sections
1/2 found and deferred: a legitimate team-context Coach or Team Manager could never be truthfully told
"this opposition club is one of our club's partners," because `club_partnerships_select_scoped` RLS
only ever returns rows to a caller holding `club.partners.manage` at CLUB scope. READ is now real for a
team-context viewer; MANAGE remains exclusively club-scoped.

## HEAD VERIFICATION

Expected `4a3a301`. Actual HEAD at the start of this section matched exactly.

## BEFORE STATE

### SCHEMA

`club_partnerships`: `id, requesting_club_id, partner_club_id, status, requested_by, requested_at,
responded_by, responded_at, revoked_by, revoked_at, created_at, updated_at, source_fixture_id`.
`status` check constraint: `pending | active | revoked` — there is no separate `declined` status;
`respond_to_club_partnership(p_approve := false)` sets `status = 'revoked'`, distinguished from an
accepted-then-later-revoked partnership only by `responded_at`/`responded_by` being set with no
intervening `active` period, and by the notification text ("declined" vs "revoked") — the domain does
not need a fifth status to tell the two apart. Unique partial index
(`club_partnerships_unique_active_pair_idx`) prevents a second non-revoked row for the same club pair in
either direction — genuinely idempotent against duplicate/simultaneous requests, confirmed by
constraint, not assumed.

### RLS

`club_partnerships_select_scoped`: `site.clubs.view` OR caller holds `club.partners.manage` for
`requesting_club_id` OR `partner_club_id`. `club_partnerships_insert_scoped`: `site.clubs.profile.manage`
OR caller holds `club.partners.manage` for `requesting_club_id`. No UPDATE/DELETE policy — every status
change goes through `respond_to_club_partnership`/`revoke_club_partnership`, both `SECURITY DEFINER`.

### RPCs

- `respond_to_club_partnership(p_partnership_id, p_approve)` — only the INVITED side
  (`partner_club_id`) may respond, re-checked server-side (`internal.can('club.partners.manage', 'club',
  v_p.partner_club_id, ...)`), refuses a non-`pending` row.
- `revoke_club_partnership(p_partnership_id)` — either side, any status (idempotent on an
  already-revoked row — returns silently rather than erroring). This is also how an outgoing pending
  request is cancelled: there is no separate "cancel" RPC.
- `create_partner_invitation` / `reconcile_partner_invitations` — Invite to Ovalball; reconciliation
  into a real `club_partnerships` row happens inside `approve_club_claim`, keyed on directory id, when
  and if the invited club actually claims itself.
- `get_partner_team_availability(p_team_id, p_from, p_to)` — Compare Calendars' own data source.
  **Confirmed this section, not previously documented**: it authorises on `fixture.fixture.view` at CLUB
  scope specifically (`internal.can('fixture.fixture.view', 'club', ...)`), never team scope, even
  though `fixture.fixture.view` is itself grantable at team scope. This is a real, narrower authority
  boundary than `fixture.request.create`/`.respond`, and is the reason this section does NOT widen
  Compare Calendars to team-context viewers (see TEAM CONTEXT below) — doing so would show a button
  whose server call then fails with a confusing "no active calendar-sharing agreement" error for what is
  actually an authority gap, not a partnership gap.

### CAPABILITIES

`club.partners.manage` — `valid_scopes = {club}` only (confirmed live this section); it cannot be
granted or even asked about at team scope, which is precisely what makes merging team-scope capabilities
into partner-management gating structurally impossible to get wrong. `fixture.request.create` /
`fixture.request.respond` — `valid_scopes = {club, team}`. `fixture.fixture.view` — `valid_scopes =
{club, team, child}`, but only ever checked by `get_partner_team_availability` at `club`.

### LIFECYCLE

NONE → (request) → PENDING (direction-specific: outgoing for the requester, incoming for the invited
club) → (respond true) → ACTIVE, or (respond false / revoke) → REVOKED. ACTIVE → (revoke, either side) →
REVOKED. REVOKED is terminal for that row; a fresh request after a revoke creates a NEW row (the partial
unique index only constrains non-revoked rows).

### WEB IMPLEMENTATION (before this section)

`app/(app)/clubhouse/page.tsx` redirected to `/fixtures` for anyone whose `activeManageableClubId` was
null — which is EVERY team-context viewer, unconditionally, even though `lib/app-context/build-
nav-items.ts` (Section 2) already pushed a working-looking "Clubhouse" nav link for exactly that
audience (`teamClubhouseAccess`). **This was a real, live, reachable defect**: the nav promised a
destination the page itself refused. `ClubMapCard` (the shared card behind both the map's popups and the
explorer's list) rendered Request Partnership/Accept/Decline/Revoke/Invite unconditionally for
`!club.isOwnClub && club.clubId` — safe only because the redirect above meant nobody without
`club.partners.manage` had ever been able to reach the component that renders it.

### NATIVE IMPLEMENTATION (before this section)

`readClubDetail` (`club-detail.ts`) fetched capabilities at CLUB scope only, regardless of
`viewerTeamId` — so `deriveClubNetworkActions`'s `canFindFixture` was **false** for a genuine
team-context Coach even though the function's own pre-existing test (`"a team-context viewer... gets a
safe projection: can find a fixture"`) asserted the intended behaviour by hand-constructing a capability
set that the real code path never actually produced. `readClubhouseMarkers` never accepted a
`viewerTeamId` parameter at all, so a team-context viewer's markers always carried `partnershipStatus:
"unknown"`.

### OLD PARTNER CLUBS ROUTES

Both already fully consolidated from Clubhouse V1: `app/(app)/partner-clubs/page.tsx` and
`app/(app)/partner-clubs/[clubId]/page.tsx` are thin `redirect()`s into `/clubhouse` and
`/clubhouse/[clubId]`. `CalendarAccessAction` (`app/club/[slug]/calendar-access-action.tsx`) already
imports `requestPartnership` from `clubhouse/actions`, not a second copy. No "Partner Clubs" nav entry
exists anywhere. Notification destinations (`packages/contracts/src/notifications/destinations.ts`)
already route `partner_request_received`/`calendar_share_approved`/`calendar_share_declined` to
`/clubhouse`. **Classification: all LEGITIMATELY RETAINED FOR COMPATIBILITY (redirects) or already
CONTEXTUAL CLUBHOUSE LINKS — no live duplicate product surface found.**

## CANONICAL READ MODEL

One new function, `get_team_club_partnerships(p_team_id uuid)` (migration `20270555000000`), a
`SECURITY DEFINER` RPC returning exactly `id, requesting_club_id, partner_club_id, status` — the
identical shape the existing direct-table read already returns to a `club.partners.manage` holder, so
`buildPartnershipIndex`/`resolvePartnershipStatus` (both pure, both already tested) need no changes at
all to consume either source. Authority is derived entirely server-side: the caller's club is looked up
FROM `p_team_id` (never trusted from the client), and the caller must hold `fixture.request.create` or
`fixture.request.respond` AT THAT SPECIFIC TEAM. No new partnership table, view or cache — `club_
partnerships` remains the one canonical domain.

`readClubhouseMarkers` (`map-read-model.ts`) now takes an optional `viewerTeamId`: when the viewer holds
no club-scope `club.partners.manage`, it tries the team-scope RPC before falling back to `"unknown"` —
never both, never guessing which source to trust. `holdsPartnerAuthority` (feeding
`resolvePartnershipStatus`) is now true whenever EITHER source produced trusted rows.

## TEAM CONTEXT

A team-context viewer with real fixture authority at their team now gets a truthful `partnershipStatus`
everywhere the marker model reaches: the map, the list, the Partner filter, and the Section 4 club
profile sheet — one fix point, four surfaces, by construction (they all consume the same
`ClubMapMarker`). `readClubDetail` additionally fetches team-scope capabilities and widens **only**
`canFindFixture` (never `canCompareCalendar`, never any partner-management action) — see RPCs above for
why Compare Calendars specifically stays club-scope-gated. `deriveClubNetworkActions` itself is
UNCHANGED: every one of its existing tests still passes unmodified, because the widening happens as a
deliberate, narrow, documented override in the I/O layer (`readClubDetail`), not inside the pure
decision function.

## CLUB CONTEXT

Unchanged. `activeManageableClubId`'s own role check (`CLUB_ADMIN`/`FIXTURE_SECRETARY`) continues to
gate the existing rich web page and `club.partners.manage` continues to gate every mutating action —
this section did not touch that authority path, only closed the gap next to it.

## PROFILE INTEGRATION

No changes to `club-detail.ts`'s `ClubDetail` shape. It already carried `partnershipStatus`/
`partnershipId` straight from the marker (Section 4); Section 5 makes that value real for a team-context
marker instead of always `"unknown"`.

## MAP INTEGRATION

`applyClubhouseFilter(markers, "partners", null)` — unchanged pure function — now returns correct
results for a team-context caller too, because the markers it filters now carry real status. No new
marker fields, no marker payload growth.

## PARTNERS VIEW

`app/(app)/clubhouse/page.tsx` now branches on `canManagePartnerships` (`activeManageableClubId !==
null`) rather than redirecting non-managers away:

- **Club-context (unchanged)**: "Pending Requests" (direction-labelled, Accept/Decline/Cancel) and "My
  Partner Clubs" (crest, town, rugby code, Shared calendar, Revoke) — exactly as before, same direct
  table read, same components.
- **Team-context (new, read-only)**: a "Partner Clubs" section built from the SAME shared marker read
  model (`getPartnerClubsMapData(clubId, teamId)` → `applyClubhouseFilter(..., "partners", null)`) —
  crest, name, town/county, rugby code, "View club" link. **No Pending Requests section for this path** —
  a deliberate scope decision, not an oversight: the minimal RPC returns no `requested_at`/
  `source_fixture_id`, direction/date data a rich pending-requests UI would need, and a team-scoped
  viewer cannot act on a pending request regardless. Widening the RPC's columns to support this was
  judged out of scope for this pass (see DEFERRED).
- Empty state (team-context, no partners): "Build your rugby network / Discover clubs in Clubhouse and
  connect with clubs you regularly play." — exactly the directive's specified copy.

`PartnerClubsExplorer`/`ClubMap`/`ClubMapCard` (the shared "Find a Club" map+list, used by BOTH branches)
now take a `canManagePartnerships` prop threaded through from the page. Request Partnership/Accept/
Decline/Revoke/Invite are gated on it; View Club/Shared Calendar are not (the latter navigates to an
already independently-authority-checked destination rather than mutating anything).

## REQUESTS

Unchanged domain semantics. Direction is already distinguished everywhere it is shown
(`PartnershipRequestRow`'s "Received"/"Sent" pill, `deriveClubNetworkActions`'s
`pending_outgoing`/`pending_incoming`) — this predates Section 5 and was re-verified, not rebuilt.

## ACCEPT / DECLINE / CANCEL / REMOVE

All four continue to run through exactly two RPCs (`respond_to_club_partnership`,
`revoke_club_partnership`), both unchanged this section, both re-verified live this section (SETUP/M1/M2
in the new permanent test). Remove/revoke never touches fixtures, messages or history — it updates
`club_partnerships.status` only, confirmed by reading the function body directly (see RPCs above).

## CALENDAR EFFECT

`get_partner_team_availability` unchanged and re-audited (see RPCs above) — still returns only
`fixture_date`/`'unavailable'` per date, never event detail.

## MESSAGING EFFECT

Not touched. `club_partnerships_notify_partner_club` trigger and any messaging auto-accept behaviour
tied to partnership status are unchanged; Section 10 owns building on top of them.

## NOTIFICATIONS

Unchanged — already routes to `/clubhouse` (see OLD PARTNER CLUBS ROUTES above). No new notification
type created.

## ACTION CENTRE

Not touched this section — incoming partnership requests were already able to surface there via the
existing `notifications` rows; nothing in this section changes read/resolved semantics.

## OLD PRODUCT CONSOLIDATION

See OLD PARTNER CLUBS ROUTES above — confirmed already complete from V1, re-verified rather than
rebuilt.

## SECURITY

The new RPC never trusts a client-supplied club id: it derives the caller's club from `p_team_id` and
checks the caller's REAL capability at that exact team via `internal.can`, the same resolver every other
authority decision in this codebase goes through. `search_path = ''`, `SECURITY DEFINER`, minimal
projection (four columns, confirmed by a permanent test reading `pg_proc.proargnames` directly, not by
inspecting a sample row). Granted to `authenticated` only, declared in
`supabase/security/perimeter-manifest.json` (`functions.authenticated_public` with its real consumer
file, and `functions.service_role_public`) — the full regression run confirms this added no new
perimeter drift (`perimeter_manifest`'s two pre-existing, unrelated failures are unchanged, same
assertions, same count, before and after).

## A REAL LIVE REGRESSION FOUND AND FIXED THIS SECTION

Required live-browser proof (below) found `permission denied for table club_directory` loading
`/clubhouse` at all — for ANY viewer, not specific to team-context. Root cause: Section 3 added `source`
to `fetchAllDirectoryRows`'s select list (for `isKnownTestFixture`), but `authenticated`'s column-level
SELECT grant on `club_directory` (`20270342000000`) was never widened to include it. This had been
latent and unreachable-by-test since Section 3 shipped — no unit test exercises it (pure-function tests
don't hit the DB) and Sections 3/4 both recorded no live browser/device proof. Fixed by migration
`20270556000000` (`grant select (source) on public.club_directory to authenticated`) and a corresponding
manifest update. Re-verified live afterward — see PROOF.

## TESTS

**New**: `supabase/tests/clubhouse_team_partnership_read.sql` (11 assertions, registered `CANONICAL_
GATE` in `suite-registry.json`) — self-seeding, rolled back, no persistent identity touched:

- an authorised Club A admin can request, an authorised Club B admin can accept (SETUP)
- Club A's team-scoped Coach genuinely holds no `club.partners.manage` (R1)
- that Coach truthfully reads Club B as ACTIVE via `get_team_club_partnerships` (R2)
- the OLD direct-table path stays exactly as silently empty as before for the same Coach (R3)
- an ordinary club member with no `team_permissions` row is refused even for their own team (A1)
- Club C's own coach cannot read Club A's partnership state by naming Club A's team (X1) — the crafted
  cross-club call
- Club C's own team genuinely has zero partnerships — a true empty, not a masked refusal (X2)
- the Coach cannot revoke the partnership they can now truthfully see (M1)
- the Coach cannot respond to a pending request either (M2)
- the RPC's return shape is exactly `id, requesting_club_id, partner_club_id, status` (P1)

Existing `deriveClubNetworkActions` tests in `clubhouse.test.mts` (own-club rejection, parent/player
false, UNKNOWN-cannot-partner, directory-only rejection, team-context-can-find-fixture) were re-run
unmodified and still pass — Section 5 deliberately did not touch that function.

## CROSS-CLIENT PROOF

**Web, live, both branches, genuinely verified this section** (Playwright, `uat.team.manager@ovalball.test`
and `uat.coach@ovalball.test`, the automated test club/world, not the persistent manual-review world):

- team-context viewer reaches `/clubhouse` with no redirect (was previously bounced to `/fixtures`)
- read-only "Partner Clubs" heading renders (not "My Partner Clubs")
- no "Request Partnership" or "Invite" button anywhere on the page for that viewer
- "Find a Fixture" entry point still present
- club-context viewer's existing rich "My Partner Clubs" section and "Find a Club" explorer are
  unaffected

**Not done this section**: the directive's full WEB↔APP cross-device mutation sequence (web Club Admin A
requests → app Club Admin B accepts → app Team Staff A sees Partner Club → app Team Staff A cannot
manage) — no native device/simulator was available in this environment (same constraint every prior
section recorded). The equivalent authority proof (team-context read works, management stays refused) is
covered by the new SQL test instead, which exercises the identical RPC the native client calls.

## REVIEW WORLD RESTORATION

The two live browser checks read state only — no partnership was created, accepted, declined or revoked
against the persistent review world, and neither UAT identity's role/capabilities were modified. The
persistent world is unchanged; `git status` after this section shows no seed/fixture file touched.

## DEFERRED

- A richer team-context Pending Requests view (would need `get_team_club_partnerships` widened to
  include `requested_at`/`source_fixture_id` — a second, small migration; judged unnecessary this pass
  since a team-scoped viewer cannot act on a pending request regardless).
- The full native (Expo) live-device cross-client proof — no device/simulator access this section, same
  as every prior section.
- Widening `get_partner_team_availability` to accept team-scoped `fixture.fixture.view` so Compare
  Calendars can genuinely work for team-context viewers — a real, separate authority decision on an
  existing, already-shipped, security-sensitive function; deliberately not touched this pass (see RPCs).
- A dedicated axe accessibility pass on the newly-added read-only Partners markup (plain semantic HTML,
  reused existing card/button primitives elsewhere; not independently re-audited this section).

## SECTION 6 HANDOFF

Section 6 (Find a Fixture) inherits: `canFindFixture` now correctly true for a legitimate team-context
viewer against an on-Ovalball club (closing the last piece of the "team staff should be able to use
partner info for Find Fixture" requirement); the still-open Compare-Calendars-for-team-context gap,
explicitly NOT closed this section and requiring its own authority decision if ever taken on; and the
one canonical `get_team_club_partnerships` read path, which Section 17 (Recent Opponents & Network
Memory) should reuse rather than building a second team-scoped partnership query.
