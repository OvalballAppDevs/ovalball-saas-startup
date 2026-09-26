# Section 9 — Fixture Negotiation

## PURPOSE

Make CA-M11.5's canonical counter-proposal state machine (`counter_fixture_request`,
`accept_fixture_request`'s counter-aware acceptance, `fixture_request_history`) reachable from a real
control on both clients. The audit before this section confirmed the RPCs, the `fixture_requests`
columns and the check-constraint values had existed since CA-M11.5, but nothing had ever called
`counter_fixture_request` outside `packages/contracts/src/team/requests.ts` itself — the UI simply never
offered it. This section is UI assembly over an already-correct, already-scoped domain: **no new RPC,
no new column, no new table.**

## SCOPE BOUNDARY (INHERITED FROM THE RPC, NOT INVENTED HERE)

`counter_fixture_request` refuses a scheduling-group-targeted request (`target_team_id is null`) and a
request confirming an already-existing fixture (`existing_fixture_id is not null`) — negotiation only
ever applies to an ordinary open team-to-team request. Both clients' new `canNegotiate` field mirrors
this exactly, so the control is never even offered where the RPC would refuse it; the RPC's own check
remains the real boundary regardless.

## THE ONE THING THAT HAD TO BE GOT RIGHT: WHOSE TURN IS IT

`last_proposed_by_team_id` (defaulting to `requesting_team_id` when never countered) names whichever
side's proposal currently stands; the OTHER side is always the one authorised to accept, decline or
counter next. Both clients now compute this same responder logic client-side (`isMyTurn` in
`projectRequest`, mirrored inline in the web `RequestRow`) purely so a page never offers Accept/Decline/
Suggest Another to the side that just made the standing proposal — the server re-checks this
independently on every call and remains the actual authority. Pinned in
`supabase/tests/js/fixture_request_negotiation_projection.test.mts` (7 assertions) against the RPC's own
state machine (sent → countered by target → countered back by requester → resolved).

## WEB

- `app/(app)/fixtures/actions.ts`: added `counterFixtureRequest` and `readFixtureRequestHistory` server
  actions, forwarding to the RPCs exactly like the existing `acceptFixtureRequest`/`declineFixtureRequest`.
- `app/(app)/fixtures/page.tsx`: the two plain team-to-team queries (outgoing/incoming) now also select
  `status`/`updated_at`/`countered_*`/`last_proposed_by_team_id`/`requesting_team_id` and admit
  `counter_proposed` alongside `sent` — previously a countered request vanished from the page entirely,
  since both queries filtered `.eq("status", "sent")`. Scheduling-group and named-team-identity requests
  are deliberately unchanged (out of scope, see above).
- `app/(app)/fixtures/request-row.tsx`: a standing-counter notice line (who suggested what, and any
  note), a "Suggest Another" control (date/kick-off/venue/note, reusing the existing stale-write
  `updatedAt` as `p_expected_updated_at`) offered alongside Accept/Decline (incoming) or Cancel
  (outgoing) whenever `canNegotiate` and the request is open, and a "History" disclosure reading
  `fixture_request_history`.

## MOBILE

- `packages/contracts/src/team/requests.ts`: `REQUEST_FIELDS`/`RequestRow`/`projectRequest` extended
  with the same counter columns plus the computed `canNegotiate`/`isMyTurn`/`updatedAt` fields, shared by
  both clients' read path.
- `apps/mobile/app/(tabs)/team/requests.tsx`: "Waiting for Your Answer" and "Waiting for Them" now
  bucket by `isMyTurn` rather than by original request direction — a countered request whose turn has
  flipped back to this team now correctly appears as awaiting action rather than falling into "Recently
  Settled" (a real bug the old `status !== "sent"` settled-filter had, found while building this: a
  `counter_proposed` row is not settled, it is the most action-needed state there is). New
  `NegotiationControls` component (Suggest Another form using the existing `DateField`/`TimeField`/
  `ChoiceField`/`TextField` kit, plus a History disclosure) is offered per-card alongside the existing
  Accept/Decline, gated on `authority.requestRespond && r.canNegotiate`. Withdraw is now correctly
  restricted to `status === "sent"` (a countered request cannot be withdrawn by the same status-update
  path — declining achieves the equivalent outcome).

## TESTING (RISK-BASED — GREEN)

The underlying RPCs are pre-existing, unmodified CA-M11.5 canonical functions with their own prior test
coverage; this section only adds client callers and a pure client-side mirror of their responder logic.
`supabase/tests/js/fixture_request_negotiation_projection.test.mts` (7/7 passing) pins that mirror
against the exact state-machine transitions the RPCs themselves implement. No migration was added or
changed. A live browser/device walkthrough of an actual two-sided counter-negotiation was **not**
performed this pass (deferred as an explicit, stated gap — see the final report); both clients'
TypeScript compile cleanly against these changes (`tsc --noEmit` clean on the web and mobile
tsconfigs).

## KNOWN DEBT

None new. H31/H32 unaffected.
