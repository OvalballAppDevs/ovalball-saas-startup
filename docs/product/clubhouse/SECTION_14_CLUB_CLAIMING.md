# Section 14 — Club Claiming & Verification

## PURPOSE

Build the submission side of `submit_club_claim`/`reply_to_claim`/`decide_club_claim` (Slice 5's
"club claim state machine", `20270393000000_club_claims_state_machine.sql`) on both clients. The RED
risk rating and the standing "do not make claiming a casual one-tap action" instruction governed every
decision below — this grants authority over a real club, potentially including a children's rugby
club's data, so it is deliberately not frictionless.

## AUDIT FINDINGS (BEFORE BUILDING)

- **The state machine is mature and correct**, read in full: `submit_club_claim` rate-limits (3/day per
  claimant), enforces one live claim per person per club (`club_claims_one_live_per_claimant_idx`),
  records whether the club already has an active Club Admin, and writes a `security_events` row.
  `decide_club_claim` requires `site.claims.review` to triage and additionally `site.club_roles.manage`
  to actually grant a role — a claimed title (`claimed_role`) is only ever a **suggestion**
  (`internal.claim_suggested_roles`); the reviewer's own choice is what grants anything. `reply_to_claim`
  is the two-way NEEDS_INFORMATION conversation. Site Admin's review UI
  (`app/(app)/admin/claims/claim-card.tsx`) already consumes all of this correctly.
- **The H31-style "direct insert bypassing submit_club_claim" concern from earlier research could not
  be found in the current codebase.** Grepped every web file touching `club_claims`
  (`app/(app)/admin/clubs/[directoryId]/{page,actions}.tsx`) — both are read-only `SELECT`s for the Site
  Admin club-detail page, not an insert. There is no bypass to fix; the actual, confirmed gap is that
  **no submission UI existed on either client at all**.
- **`claim_claims`'s `evidence` jsonb column is written but never read or displayed by the existing
  review UI.** Adding evidence upload to the submission form would produce data nobody reviews — so
  this section deliberately does not add one; the two fields the review screen actually shows
  (`claimedRole`, `authorityDeclaration`) are the two fields collected.

## AUTHORITY: WHO MAY SUBMIT A CLAIM

`submit_club_claim` checks only `internal.session_ok()` — no club or team capability. This is
deliberate and different from every other Clubhouse action built this run (Message, Invite): **claiming
is how someone GETS authority over a club, not something that already requires it.** Both clients'
"Claim This Club" is offered to any signed-in viewer who reaches the club's card at all, never gated on
`canManagePartnerships`/`canManageClubFixtures`/any existing authority signal.

## THE FORM ITSELF (DELIBERATELY NOT ONE TAP)

Both clients require two real inputs before `submit_club_claim` is ever called:

- **A role**, from `CLAIMABLE_ROLES` — the exact seven values
  `club_claims_claimed_role_eligible` accepts (`20260831190000_club_claims_add_treasurer.sql`), moved
  into one shared `packages/contracts/src/clubhouse/claims.ts` rather than hand-duplicated per client
  (pinned in `clubhouse_claim_roles.test.mts` against the migration's own text, so a future allow-list
  change cannot leave one client silently offering a role the database will reject). Defaults to
  "Committee Member" — `claim_suggested_roles`'s own neutral case, suggesting no role grant at all,
  never a privileged default like Club Chair.
- **A written authority declaration**, minimum 20 characters client-side (the database only requires
  non-null) — enough to force an actual sentence rather than a single word, matching what the review
  screen actually quotes back to the reviewer as the claimant's own statement.

A `23505` (unique-violation, the one-live-claim-per-person-per-club index) is translated to "You already
have an open claim on this club" rather than a raw Postgres error.

## WEB

- `app/(app)/clubhouse/claim-actions.ts` (new server action) and `claim-club-dialog.tsx` (new): "Claim
  This Club" alongside Invite in `club-map-card.tsx`'s directory-only-club block — ungated by
  `canManagePartnerships`, unlike Invite.

## MOBILE

- `apps/mobile/src/clubhouse/claims.ts` (new) and `apps/mobile/app/(tabs)/clubhouse/map.tsx`: the same
  form (reusing the existing `Field`/`ChoiceField`/`TextField` kit), offered whenever
  `marker.networkState === "not_on_ovalball"`, with its own submitted-confirmation state.

## SCOPE DELIBERATELY NOT TAKEN

No evidence upload (see above — nothing reviews it today; adding one would be building for a screen
that doesn't exist). No claim-status tracking screen for the claimant on either client (checking on a
submitted claim, or continuing a NEEDS_INFORMATION conversation via `reply_to_claim`) — the confirmation
message says a Site Admin will be in touch, matching what the domain can actually notify on; a "my
claims" screen is a real, separate follow-up rather than assumed into this pass.

## TESTING

`supabase/tests/js/clubhouse_claim_roles.test.mts` (new, 2 assertions): pins the shared role list
against the migration's own allow-list text, and confirms Safeguarding/Welfare Officer stays excluded
(a genuine prior product decision, not an oversight this form should quietly reintroduce). Both clients'
`tsc --noEmit` are clean; ESLint on every new/touched file is clean. A live-device/browser walkthrough of
an actual submission → Site Admin review → approval round trip was **not** performed this pass.

## KNOWN DEBT

None new.
