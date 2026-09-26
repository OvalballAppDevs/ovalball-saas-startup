# Sections 15/16 — Looking for Opposition / Opportunity Matching

## OWNER AUTHORISATION

The parked draft (`supabase/migrations/20270554000000_looking_for_opposition.sql`) was reconciled
against current architecture, classified **B** by the owner (adopt the concept, reissue as a new
migration, never apply the parked file), and Sections 15/16 were then explicitly authorised — including
network-wide visibility for youth teams, with an absolute rule that only TEAM + CLUB + fixture-scheduling
intent is ever disclosed, never a person. The parked file remains untouched, unapplied, historical
reference only — checksum `bb96286c50d919ab57aaabaf42f06ccbd497f809d711a7b84048c918f7e5fff3`, identical
before and after this section.

## NEW MIGRATIONS

- `20270560000000_looking_for_opposition_current.sql` — the whole domain, written fresh.
- `20270561000000_fixture_request_countered_was_never_registered.sql` — a genuine, currently-live Section
  9 defect found while reconciling the notification catalogue (see below), fixed in its own migration
  rather than editing the already-applied `20270553000000` in place.

Both applied via the owner-mandated procedure: parked file moved to the session scratchpad, migration
applied, parked file restored and re-checksummed byte-identical, ledger verified to show only the two new
versions as applied.

## WHAT THE PARKED DRAFT GOT RIGHT (KEPT UNCHANGED IN SUBSTANCE)

Team-owned listing; select-only RLS with every write behind a SECURITY DEFINER function; converge-into-
`accept_fixture_request` with no second fixture-creation path; multiple-responses-one-winner with
transactional supersede; the home/away inversion (publisher-relative → responder-relative); stale-write
protection via `p_expected_updated_at`.

## WHAT WAS FIXED, EACH FOUND BY DILIGENCE

1. **Safeguarding (the one defect the owner named as unacceptable).** The parked draft's four
   notification fan-outs joined `team_permissions` with no rank filter — `team_permissions.permission`
   has a fourth value, `'view_only'`, documented as "(parents/players)". Every notification insert now
   carries `tp.permission in ('team_admin', 'coach', 'manager')`, the same filter `counter_fixture_request`
   already established. **Permanent negative proof**: `looking_for_opposition.sql` LFO-S2/S2b/S3 —
   a view_only team member receives zero opportunity notifications; the real staff recipient does.
2. **Ownership integrity.** `internal.fixture_opportunity_derive_club_id()`, a BEFORE INSERT/UPDATE
   trigger, recomputes `publishing_club_id` from `publishing_team_id` unconditionally — defence in depth
   against `publishing_team_id` (Club A) + `publishing_club_id` (Club B) ever persisting together.
3. **Real expiry, and a genuine mid-build correction.** `expired` was a declared status nothing could
   enter. `internal.fixture_opportunity_effective_status()` derives it transactionally from
   `proposed_date` — no cron. An EARLIER version of this migration also tried to *persist* that
   transition from inside the refusing function ("lazily expire, then refuse") — **found broken while
   testing this exact suite**: a raised exception always rolls back an update made earlier in the same
   call, so the persist never survived. Corrected to query-time-only: every consumer that matters (the
   RLS policy, every mutating function's own refusal check, `find_fixture_opportunities`) calls the
   effective-status function fresh; the stored column may legitimately lag behind for a listing nobody
   successfully touches again, which is harmless.
4. **The duplicate-request interaction, explicitly integrated.** Section 8 (this run, chronologically
   after the parked draft) added `internal.enforce_fixture_request_not_duplicate()`. `accept_fixture_
   opportunity_response` now pre-checks the exact same predicate and returns a specific, actionable
   refusal (errcode `23505`, the existing `fixture_requests.id` carried in the error's `hint`) — never a
   raw trigger exception, never a silent merge, the existing canonical request is always preserved.
5. **Notification catalogue registration — the whole domain, not just four new types.** Reconciling this
   (owner's own instruction #6) found a genuinely live, undiscovered Section 9 bug from last night:
   `fixture_request_countered` was NEVER registered in `notification_types` — every real call to
   `counter_fixture_request` in production would have raised a foreign-key violation on its own
   notification insert, failing "Suggest Another" outright. Fixed in `20270561000000`. All five types
   (the four new ones plus the missed one) are now registered, routed (`notificationHref`), tested
   (`notification_destinations.test.mts`), and included in `CLUBHOUSE_NOTIFICATION_TYPES`.
   `scripts/verify-notification-catalogue.mjs` — clean, 93/93.
6. **A real batched discovery read model (Section 16).** `find_fixture_opportunities(p_team_id)` —
   never a bare `select * from fixture_opportunities` with client-side filtering. Re-derives compatibility
   and authority itself (SECURITY DEFINER bypasses RLS). Distance and partnership are DELIBERATELY NOT
   computed server-side: the function returns raw, already-public `club_directory` location facts for the
   publishing club (never its venue — Section 3's own architecture note already declined to expose any
   other club's venue coordinate), and the client combines them with its own already-known origin via the
   EXISTING `resolveClubLocation`/`distanceMiles` — no second geo calculation, no widened authority
   boundary. Partnership state is read directly off the same markers population every other Clubhouse
   screen already trusts.

## OWNERSHIP / CAPABILITIES / RLS

Unchanged from the parked draft's own (correct) design: `publishing_team_id` is canonical ownership,
`fixture.request.create`/`.respond` are the only two capabilities involved, both tables carry a
SELECT-only policy for `authenticated` (no INSERT/UPDATE/DELETE grant exists at all — proved live,
LFO-A6).

## DATE MODEL

Single concrete date, kept deliberately simple (Option A) — a team wanting several dates publishes
several listings. No fuzzy date-range model was built; this matches the current availability
architecture cleanly and avoids complexity the product does not yet need.

## AVAILABILITY

`internal.fixture_opportunity_team_availability(team_id, date)` — coarse `busy`/`no_known_clash`, reusing
the exact blocking sources (fixture/competition/training/club_event/pending-request)
`team_scheduling_availability`/`find_fixture_candidate_availability` already check, scoped to one team and
one date. Deliberately **never partnership-gated** — the calling team's own calendar, always readable
about itself, and Looking for Opposition is by design network-wide discovery, not partners-only. Surfaced,
never hidden: a busy team still sees and can still respond to an opportunity (LFO-D4/D5 prove both real
values render; nothing is silently dropped).

## RESPONSE MODEL / CONVERGENCE

One logical response per opportunity+team (unique constraint, reopened via `on conflict` after
withdraw/decline/superseded — never a second row). Accepting resolves the opportunity and every other
pending response to `superseded` in the same transaction (LFO-L6d proves this holds even for the
single-response case). Acceptance converges into `fixture_request_groups`/`fixture_requests` then calls
the existing `accept_fixture_request` — proved live to create a real `fixtures` row with the responder
correctly owning it and the publisher as opponent (LFO-C1), and to never contain a direct `fixtures`
insert of its own (LFO-C2, a structural `prosrc` check).

## WEB

- `app/(app)/clubhouse/opportunities/{page,actions,opportunities-client}.tsx` — Discover / My Listings
  tabs, publish form, respond/withdraw, review-and-decide responses, cancel own listing.
- Entry point: a secondary card inside Find a Fixture (owner's own product judgement — never a fifth
  Clubhouse Home tile).
- `packages/contracts/src/clubhouse/opportunities.ts` — the one shared read/write layer both clients use.

## MOBILE

- `apps/mobile/app/(tabs)/clubhouse/opportunities.tsx` — the same feature set, native presentation
  (warm chalk/forest/white cards, matching established Clubhouse visual language), same shared contracts.
- Entry point: the same secondary card inside the mobile Find a Fixture screen.

Both clients share: opportunity lifecycle, matching, authority, response semantics, availability
vocabulary, distance truth (same client-side functions, not duplicated per client), and convergence into
`accept_fixture_request`.

## ACTIVITY

The four new types are in `CLUBHOUSE_NOTIFICATION_TYPES` (viewer-relevant staff events only — response
received, response declined, opportunity filled, opportunity cancelled). No global social feed; nothing
here exposes youth scheduling activity to a family/player identity (the same staff-only recipient filter
that gates the notifications themselves).

## NETWORK MEMORY

Not touched. No relationship scoring, no "good opponent" ranking was built or considered — opportunity
interaction is not treated as authority anywhere in this domain.

## TESTING

`supabase/tests/looking_for_opposition.sql` — **39/39 passing**, self-contained/transactional
(CANONICAL_GATE, registered in `suite-registry.json`), covering authority, safeguarding, lifecycle,
convergence and discovery exactly as required. `notification_destinations.test.mts` (4 new rows) and
`clubhouse_activity_types.test.mts` (updated) — both green. `scripts/verify-notification-catalogue.mjs`
— clean, 93/93. `scripts/verify-sql-suite-registry.mjs` — clean. `scripts/verify-content-standard.mjs` —
clean. Both clients' `tsc --noEmit` clean. ESLint on every new/touched file: zero new findings (the one
recurring `set-state-in-effect` pattern is confirmed pre-existing across every comparable Clubhouse
screen on both clients, not something this section introduced).

`supabase/security/perimeter-manifest.json` updated: 2 new tables, 7 new `public` functions (authenticated
+ service_role), 1 new `internal` function granted to `authenticated` (called directly from the RLS
policy, so it needs its own grant). `supabase/tests/js/perimeter_manifest.test.mts`: the table/view check
now passes cleanly; two OTHER checks ("every consumer... exists and calls the function", "signed-in
EXECUTE never exceeds the manifest") still fail, but confirmed via `git stash` to be **pre-existing,
unrelated failures** (unconnected rollover/notification functions) — none of this section's own additions
appear in either failure list.

**Not done, stated plainly**: no live-device/browser walkthrough was performed. An isolated clean-boot
verification (`scripts/isolated-clean-boot.sh`) was attempted twice and failed both times at Supabase's
own baseline schema initialisation — before the migration chain was even reached — consistent with
genuine local machine resource contention (a lingering `expo run:ios`/Metro process, heavy desktop
applications, low free memory), not a defect in this migration. This is a real, stated gap, not a
silently-skipped step.

## KNOWN DEBT

None new from this section. **H31/H32 unaffected.**
