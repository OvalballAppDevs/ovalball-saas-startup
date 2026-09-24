# H32 — pitch-allocation placement authority: analysis and proposal (NOT APPLIED)

Status: **PROPOSAL ONLY**. Nothing in this document has been applied. Per the
default rule on authority-semantics changes, this is a STOP-and-report; any
migration remains a separate, explicitly-authorised decision.

## 1. The divergence, restated precisely

`update_fixture_schedule` (and its single-field siblings `update_fixture_pitch`
/ `update_fixture_venue`) authorise every scheduling write — including a
pitch-allocation placement — through `internal.can_edit_fixture_schedule`,
which asks `fixture.fixture.edit` at either side of the fixture (or
`site.fixtures.support`). The Pitch Allocation board's own UI, the Calendar
tab, the proposal/policy RLS and both clients' capability probes gate on
`venue.pitch_allocation.view` / `.manage`. The two keys are not the same
grant, and the catalogue itself records `venue.pitch_allocation.*` as
historically re-pointed from a `legacy_key` of `fixture.edit` — i.e. the
allocation keys were minted as the intended authority and the RPC was never
migrated onto them.

Concretely, today:

- A **Volunteer holding only the `volunteer_pitch_allocation` preset**
  (`venue.pitch_allocation.view` + `.manage`, no `fixture.fixture.edit`
  anywhere) can open the board, run Auto Allocate, and write a proposal — and
  cannot save a single placement. `update_fixture_schedule` refuses with
  `42501`. Pinned as **PA-C2** in `supabase/tests/pitch_allocation_ca11_1.sql`.
- A **Club Admin or Fixtures Secretary whose `.manage` has been withheld by an
  override** keeps `fixture.fixture.edit`, so the proposal/auto-allocate
  workspace is correctly refused, but a manual placement through the same RPC
  still lands. Pinned as **PA-C1** (the divergence's own name in the test).
- A **Coach or Team Manager** (team-scope `fixture.fixture.edit`, club-scope
  `.view` only) cannot write a proposal, yet can place their own team's
  fixture on any of the club's active pitches through the ordinary fixture
  editor, because that editor calls the identical RPC.
- `club_scheduling_policy`'s own RLS was never re-pointed at all: it still
  asks legacy `fixture.edit` at club scope, a third small inconsistency the
  CA-M4 guard cannot see because its filter is scoped to `pitch_allocation%`
  tables.

This was investigated in depth by a research pass this session (full analysis
retained in the session's task output); its conclusion, reproduced here
because it is the basis for the recommendation below:

> The gate on `fixture.fixture.edit` is an inherited coupling that was
> knowingly left in place, not a designed rule: it predates the allocation
> keys, was twice explicitly deferred (in the RPC's original migration and
> again when the RLS was re-pointed), is contradicted by the catalogue's own
> description and declared `db_enforcement` for `venue.pitch_allocation.manage`
> (`RPC → can_CL` — a promise no RPC keeps), by the dedicated volunteer preset,
> by the permission editor's own grouping, by both clients' UI gates, and by
> four product documents that already call it a defect. What *is* intentional
> and must be preserved by any fix: the RPC's either-side shape (either club on
> a fixture may act for its own side) and the single-writer invariant that only
> the fixture RPCs ever mutate a fixture's pitch/venue/kickoff columns.

## 2. Options considered

**Option A — make `update_fixture_schedule` also or instead ask
`venue.pitch_allocation.manage` when `p_source = 'PITCH_ALLOCATION'`.**
Rejected. `p_source` is an unvalidated, caller-supplied audit label with no
integrity check anywhere in the RPC; making it authority-bearing means a
caller chooses its own gate by choosing what string to pass. It also does not
cleanly cover the separate `update_fixture_pitch` clear-path.

**Option B — a dedicated `allocate_fixture_pitch` (and `deallocate`) RPC,
scoped to the allocation key, called only by the shared package's
`allocateFixtureOnPitch` / `clearFixturePitch`.** The board's placement and
removal calls move onto it; `update_fixture_schedule` / `update_fixture_pitch`
remain fixture-edit-gated for Fixture Management, Messages and the ordinary
fixture editor. This closes the Volunteer-preset gap and the CA/FS-with-
manage-withheld gap, preserves the either-side kick-off negotiation (untouched
— it isn't a placement), and is the option the ledger's own H32 entry already
names ("or adding a pitch-allocation-specific write"). It is also the only
option under which `venue.pitch_allocation.manage`'s catalogued
`db_enforcement` of `RPC → can_CL` becomes literally true.

**Option C — leave the RPC; correct the catalogue and docs instead**, framing
`.manage` as authority over the allocation *workspace* (proposals,
auto-allocate, the policy row) while a placement is described everywhere as a
fixture edit. Rejected as the primary fix, because it does not make the
`volunteer_pitch_allocation` preset able to do the job its own label promises
("Arrange which team plays on which pitch, and when") without also granting
club-scope `fixture.fixture.edit` — which is a real widening of a Volunteer's
authority, not a documentation fix, and breaks the preset-completeness
assertions in `supabase/tests/step8_operational_access.sql`.

## 3. Recommendation (not applied)

**Option B**, plus two independent, low-risk cleanups that are correct under
any of the above and were left out of scope until this document names them:

1. Re-point `club_scheduling_policy`'s insert/update RLS from legacy
   `fixture.edit` to `venue.pitch_allocation.manage`, and widen the CA-M4
   guard (`20270546000000…`'s `pg_policies` check) to also cover
   `club_scheduling_policy`, not only `pitch_allocation%`-named tables.
2. On the website only, change `requirePitchAllocationAccess` to ask
   `venue.pitch_allocation.manage` / `.view` instead of legacy `fixture.edit`,
   and stop `resolve-nav-capabilities.ts` aliasing `canPitchAllocation` to
   `canFixtureEdit` — a line its own file header already forbids.

## 4. Blast radius if Option B is later authorised

- New RPC + `deallocate` counterpart; `packages/contracts/src/pitch-allocation/operations.ts`
  (`allocateFixtureOnPitch`, `clearFixturePitch`) re-pointed at it; both
  clients need no change beyond that shared call, because both already call
  through the shared package.
- `supabase/tests/pitch_allocation_ca11_1.sql`: PA-C1 stops describing a
  divergence (rewrite its assertion and name); PA-C2 becomes a positive save;
  PA-D1/D2 re-point at the new RPC and must keep stamping
  `audit_log.after->>'source' = 'PITCH_ALLOCATION'`.
- `supabase/tests/js/club_admin_parity_ca11_1.test.mts` and this session's new
  `supabase/tests/js/pitch_allocation_board_ca11_2.test.mts` assert
  `rpc("update_fixture_schedule"` / `rpc("update_fixture_pitch"` for the
  allocation writes — both need re-pointing at the new RPC name.
- `supabase/tests/fixture_status_lifecycle.sql` and
  `supabase/tests/pitch_venue_home_side_fix.sql` currently exercise the old
  RPC path with `p_source := 'PITCH_ALLOCATION'`; they should be re-pointed to
  exercise the real board path rather than keep testing a path the board no
  longer uses, and the status-lifecycle logic they pin must be shared with the
  new RPC rather than duplicated into it.
- Docs to update: this file, the ledger's H32 entry, `CA_M11_1_CLUB_ADMIN_PARITY_MAP.md`,
  `CA_M10_CLUB_OPERATIONS_MAP.md` (CO-VP), `ADMIN_CENTRE.md`'s CA-M4 table.
- `supabase/migrations/20270508000000_a_fixtures_pitch_belongs_to_its_venue.sql`'s
  own closing guard says a fifth writer of the venue/pitch pair must extend its
  list and honour the pitch-belongs-to-venue rule — the new RPC is that fifth
  writer and must satisfy it.

No code in this repository has been changed as part of this document. CA-M11.2
proceeds with the divergence as-is, pinned and reported, exactly as CA-M11.1
left it.
