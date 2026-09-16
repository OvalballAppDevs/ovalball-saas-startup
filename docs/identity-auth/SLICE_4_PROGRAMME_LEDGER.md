# Identity/Auth Slice 4 — programme ledger (4C → 4I)

Scope authority for the remaining conveyor. Taken from
`IDENTITY_AUTH_PHASE2_IMPLEMENTATION_DESIGN.md` AA.3 lines 1849-1855, not from
conversational shorthand. Ownership below is **semantic**: a helper is retired by the
slice that owns the *meaning* of the call site, never by whichever slice happens to
grep it first.

## Checkpoint this ledger starts from

4A PRODUCTION VERIFIED · 4B PRODUCTION VERIFIED
repo `774ab9b` · production ledger **450** · tip `20270357000000`

## GLOBAL REMAINING SLICE 4 FOOTPRINT (canonical ledger counting, at 450)

| helper | policies | function bodies |
|---|---|---|
| has_capability | 98 | 123 |
| is_site_admin | 123 | 158 |
| is_full_site_admin | 15 | 46 |
| is_club_admin | 23 | 25 |
| can_manage_club_fixtures | 18 | 57 |
| can_manage_club_fixtures_or_any_team | 2 | 0 |
| can_manage_fixture_side | 3 | 6 |
| can_manage_team | 7 | 28 |
| can_organise_competition | 0 | 2 |
| can_organise_edition | 8 | 1 |
| can_manage_document_library | 6 | 2 |
| staffs_team | 0 | 3 |
| is_messaging_staff | 0 | 0 |
| is_active_player_guardian | 7 | 14 |
| is_own_linked_player | 9 | 9 |

PG15 **138** · PG16 **157** · anon-exec **15**

Ledger slack carried from 4B (counts fell below their ceilings; the ledger permits a
decrease, and §14 asks the owning slice to tighten): `has_capability` bodies 125→123,
`is_site_admin` policies 125→123, `can_manage_club_fixtures` policies 20→18. 4C owns
`can_manage_club_fixtures` and tightens that one; the other two tighten with their owner.

## Sub-slice contracts

### 4C — Fixtures, requests, results, Planner, Import
* Legacy retired: `can_manage_club_fixtures` (fixture call sites only), `can_manage_fixture_side`, direct fixture writes
* Matrix: extend `fixture_management_authority`, `fixture_bulk_planning_authority`
* Owned policies (5 of the 18 `can_manage_club_fixtures`): `fixture_player_call_up_select`,
  `fixture_request_groups_select_scoped`, `fixture_requests_select_scoped`,
  `fixture_requests_update_scoped`, `fixture_result_submissions_select_scoped`;
  plus `can_manage_fixture_side` on `fixtures`, `fixture_communications`
* Invariants (§11): team staff never acquire mass fixture authority; Planner / Mass Planner /
  Import / competition-wide generation stay club or site administrative; `fixture.create`
  never implies bulk. Fixtures Secretary is canonical capability, not a role name.
* NOT owned: the 11 rollover/graduation/season/partnership/referral policies (4I),
  `player_team_dispensation_select` (4G), `team_conversations_select_scoped` (4F)

### 4D — Competitions and tournaments
* Legacy retired: `can_organise_competition` role checks, `calendar.manage` tournament use
* Matrix: `competition_authority_matrix.sql`
* Owned policies: the 8 `can_organise_edition` policies on `competition_group_members`,
  `competition_groups`, `competition_match_fixtures`, `competition_match_verifications`,
  `competition_matches`, `competition_participants`, `competition_rounds`, `competition_stages`
* Invariants (§12): a Competition Match is the canonical schedule/result record and persists
  without an Ovalball participant; a Fixture is the optional club/team projection;
  external-v-external produces zero fixtures; standings use Competition Matches.

### 4E — Calendar, venues, pitches, training
* Legacy retired: role-string RPC checks, public training plans
* Matrix: `venue_training_authority_matrix.sql`
* Carries the U "venues RLS/RPC mismatch" closure and the V presets

### 4F — Messaging and notifications
* Legacy retired: `staffs_team` (3 bodies), `is_messaging_staff` (already 0/0), Site Admin conversation read
* Matrix: `messaging_authority_matrix.sql`
* Owned policy from the fixtures helper: `team_conversations_select_scoped`
* Carries T "Reports" (club safeguarding-officer queue + Ovalball moderation, one row per report)

### 4G — Safeguarding and dispensations  **(locked decision D-S4-2)**
* Legacy retired: per-officer override dependence, Site Admin thread read
* Matrix: extend `safeguarding_officer_security`
* Owned policy from the fixtures helper: `player_team_dispensation_select`
* 4G owns the complete Safeguarding Officer appointment authority and state machine.
  It does **not** own unified invitation redemption.
  * an existing legitimate ACTIVE club member may enter the nomination flow
  * invalid membership states fail closed
  * PENDING_CONFIRMATION grants **zero** Safeguarding Officer authority
  * AN-6 confirmation uses the canonical Slice 3 Site Admin capability; no `is_site_admin`
    shortcut, no self-confirmation
  * no temporary safeguarding invitation table, token or RPC; no partial duplicate of Slice 5
  * external nominees stay fail-closed until Slice 5
  * must close with the explicit deferral: **Slice 5 supplies the email-bound
    SAFEGUARDING_OFFICER invitation and redemption entry path into this same state machine**
* Also carries AN-9, AI #68/#69 (`site_safeguarding_review` with reason +
  `safeguarding.thread_reviewed`), dispensation separation of duties, guardian mandatory
  notification of call-ups and dispensations, and the transitional
  `club.safeguarding.view/message` kept at legacy parity "until 4g"

### 4H — Club administration and finance
* Legacy retired: `is_club_admin` (23 policies at 450)
* Matrix: `club_admin_authority_matrix.sql`
* Owned policies: `club_contacts`, `club_join_requests`, `club_memberships`,
  `club_opponent_notes`, `clubs`, `invitation_teams`, `invitations`, `role_assignments`,
  `team_contacts`, `teams`
* Carries the S boundary including `club.reporting.export` with R and an event

### 4I — Documents, partners, referrals, handover
* Legacy retired: `can_manage_document_library` role checks
* Matrix: `club_misc_authority_matrix.sql`
* Owned policies: the 6 `can_manage_document_library` policies on `club_documents`,
  `document_folders`; plus the 11 rollover/graduation/season/partnership/referral policies
  that still call `can_manage_club_fixtures`
* Carries Z-12 `club-documents` delete policy (`club.documents.manage`) and the U boundary
  that `team.handover.apply` is not a Fixtures Secretary capability

## Standing constraints for every sub-slice

* Slice 2 state machines, Slice 3 `internal.capability_decision`, 4A family authority and
  4B roster authority all remain canonical. No blanket Site Admin bypass, no new
  `is_site_admin` authority, no raw-role authority, no UI-manufactured authority, no direct
  browser authority writes, no parallel permission system.
* One person, one login, many scoped contexts. Site Admin is platform authority and never
  confers club or team authority by itself.
* Site-side `is_site_admin` removal stays **Slice 7**. Do not pull it forward.
* Unknown-age follow-up (`SECURITY_FOLLOW_UP_unverifiable_age.md`): before each sub-slice,
  answer whether it makes unknown-age staff authority or staff-role onboarding more
  reachable. NO → record and continue. YES → stop before release for a human decision.
* Deferred to Slice 5 throughout: unified invitations, codes and claims, including team
  join codes and the safeguarding invitation entry path.

---

# 4C ARCHAEOLOGY (recorded at ledger 450)

## Why semantic ownership matters here, measured

`can_manage_club_fixtures` has 18 policies and 57 function bodies. A mechanical retire
would have pulled four later domains forward, which §3 forbids. The true split:

| owner | policies | function bodies |
|---|---|---|
| **4C fixtures** | **5** | **15** |
| 4D competitions | 0 | 10 |
| 4E calendar/venues/pitches | 0 | 5 |
| 4F messaging | 1 | 7 |
| 4G dispensations | 1 | 0 |
| 4I handover/partners/referrals | 11 | 17 |
| 4A carried debt (`can_manage_player`, 0 refs) | 0 | 1 |
| totals | 18 | 57 |

Refined on inspection: three names that grep into the 4C bucket are not 4C's.
`public.create_partner_invitation` creates a club partnership → **4I**.
`internal.may_send_as` is send-as-club/team messaging → **4F**.
`internal.can_manage_player` is 4A's dangling definition with 0 references → carried debt,
not migrated by 4C. `get_partner_team_availability` and `get_scheduling_group_availability`
read fixture availability and **are** 4C.

4C additionally owns `can_manage_fixture_side` outright: 3 policies (`fixtures`,
`fixture_communications`) and 6 function bodies.

## 4C owned capability keys (J.6 lines 456-474)

fixture.fixture.view · create · edit · cancel · archive · delete · bulk_edit ·
fixture.planner.use · fixture.import.run · fixture.request.create · respond ·
fixture.result.record · fixture.result.dispute_resolve · fixture.callup.request ·
approve · fixture.communication.send

Scope levels that enforce §11: `fixture.planner.use` **CL**, `fixture.import.run` **CL**,
`fixture.fixture.bulk_edit` **CL** with team defaults removed, `fixture.callup.approve`
**CL** with team defaults removed. `fixture.fixture.create` is C/T and explicitly
"MERGE (removes the direct-insert bypass)".

## Boundary resolved: call-ups are 4C, dispensations are 4G

AA.3 names neither call-ups nor dispensations in 4c, and names "dispensations" in 4g.
Resolved from the design's own namespacing rather than by guess:

* `fixture.dispensation.request` / `approve_team` / `approve_club` and the
  `player_team_dispensation_select` policy → **4G**, which AA.3 explicitly owns, and which
  also carries the separation-of-duties rule that the approver may not be the requester.
* `fixture.callup.request` / `approve` → **4C**. They are fixture-domain keys over a
  fixture, gated by the fixture helpers this slice retires. 4G keeps the safeguarding
  *notification* obligation for call-ups, which is an obligation, not the authority.

This is a scope-boundary reading, not a product or security decision, so it is recorded
rather than escalated. If 4G later needs to tighten call-up authority it extends 4C's work.

## §9 unknown-age gate for 4C

**NO.** 4C migrates fixture authority. It assigns no staff role, creates no membership and
touches no onboarding path, so it does not make unknown-age staff authority or staff-role
onboarding more reachable. Recorded; conveyor continues.

## 4C expected migration strategy

Expand/contract, derived not assumed (§28): an expand migration moving the 18 owned
function bodies and the fixture gates onto `internal.can`, the application release, then a
contract migration moving the 8 owned policies and removing the direct-insert bypass.
Compatibility to be proven by evidence before release.

---

# TEST-RUNNER INVENTORY (the 102/105 unwired finding)

### Accounting, corrected

An earlier note in this session said "102 unwired". That figure was wrong. It came from a grep
that counted three bash keywords (`done`, `else`, `fi`) as suite names. The correct figures:

* `supabase/tests/*.sql` on disk: **255**
* distinct runner entries that are real suites: **153** (154 raw lines matched the pattern; 3 of
  those were the bash keywords `done`, `else`, `fi`, and 4 remaining names have no `.sql` file)
* of those, files present on disk and therefore actually executed: **150**
* **unwired: 105**

The four classes below are **mutually exclusive** — each file is assigned exactly one bucket —
and they total 105, which reconciles. Only the headline was wrong; the classification was not.

| class | count | disposition |
|---|---|---|
| standalone / manual / diagnostic | 75 | intentional. Not regression suites. |
| obsolete / superseded | 1 | leave; superseded by a wired suite. |
| security/authority-shaped | 15 | examined below. |
| uncertain | 14 | programme debt; not Slice 4-owned. |
| **total unwired** | **105** | reconciles with 255 − 150 |

## The question that mattered: was a claimed gate never executed?

**No.** Every security gate 4A and 4B claimed is wired and runs in the battery:
`family_authority_matrix`, `family_isolation_matrix`, `cross_club_isolation_matrix`,
`roster_authority_matrix`, `authority_helper_retirement`, `capability_attack_matrix`,
`capability_precedence_truth_table`, `capability_scope_isolation`, `bundle_legacy_parity`,
`backfill_verification`, `capability_catalogue_integrity`, `fixture_management_authority`,
`fixture_bulk_planning_authority`. The 4A/4B baselines are not undermined; no STOP.

## Why the 15 are unwired — a single root cause

They are **environment-dependent by design**, written against rows nothing in the repository
provisions. `player_movement_authorization_matrix` says so in its own header: *"Reuses real,
pre-existing `auth.users` rows (their OTHER real-world club roles…)"*. Six of them reference
`00000000-0000-0000-0000-000000000002`, a user created by no migration, no seed and no suite.
They cannot run on a clean boot or a fresh database, which is precisely why they are not in
the canonical runner.

This is real test-infrastructure debt. It is **pre-existing, not introduced by Slice 4**, and
fixing it is a test-infrastructure task, not an authority-migration one. Recorded as programme
debt; deliberately **not** turned into a 105-file cleanup.

## 4C-owned decision

AA.3 row 4c names exactly two matrices — `fixture_management_authority` and
`fixture_bulk_planning_authority`. Both are wired and green (13 and 28). No contract-required
4C test is unwired, so nothing is blocked.

`call_up_and_dispensation_security` is call-up-shaped and therefore 4C-adjacent, but it is not
named by the contract and is one of the environment-dependent suites. Resurrecting it would
mean inventing the rows it assumes. **Instead, 4C's own matrix extension carries deterministic
call-up authority coverage**, which closes the gap self-seedingly rather than depending on
state no repository file creates.

---

# 4C RESUMPTION CHECKPOINT  (expand + policy contract COMPLETE; bypass build remains)

## Production — untouched, still the 4B checkpoint
ledger **450** · tip `20270357000000` · audit **7493** · security events **0**.
Nothing from 4C committed, pushed, deployed or applied to production.

## Repository
`main = origin/main = 774ab9b`, nothing staged. Uncommitted, local-only:
`20270358000000_fixture_authority_canonical.sql` (expand),
`20270359000000_fixture_policies_canonical.sql` (policy contract),
the extended `supabase/tests/fixture_management_authority.sql`, and this ledger.
Protected logos verified unchanged: `be2bef0c…` / `bdd32248…`.

## Migration 358 — EXPAND, complete
All 17 4C-owned bodies canonical. Verified: zero `can_manage_club_fixtures`,
`can_manage_team` or `is_site_admin` anywhere in the 4C function surface.

## Migration 359 — POLICY CONTRACT, complete
The 5 owned `can_manage_club_fixtures` policies rewritten canonically
(`fixture_player_call_up_select`, `fixture_request_groups_select_scoped`,
`fixture_requests_select_scoped`, `fixture_requests_update_scoped`,
`fixture_result_submissions_select_scoped`), plus the last bare `is_site_admin` removed from
`fixture_communications_select_staff`. The three `can_manage_fixture_side` policies were already
canonical via 358 and were not rewritten.

Read and answer are now deliberately different widths: `fixture_requests_select_scoped` admits
`fixture.request.create` (a Coach may see a request) while `fixture_requests_update_scoped`
requires `fixture.request.respond` (a Coach may not answer one) — J.6 line 466.

## Retirement — monotonic, nothing increased

| | 4B checkpoint | now | delta |
|---|---|---|---|
| `can_manage_club_fixtures` policies | 18 | **13** | −5 |
| `can_manage_club_fixtures` bodies | 57 | **42** | −15 |
| `can_manage_team` policies | 7 | **3** | −4 |
| `can_manage_team` bodies | 28 | **20** | −8 |
| PG15 | 138 | **132** | −6 |
| PG16 | 157 | **145** | −12 |

Ceilings still to be tightened at the banking gate.

## 4C matrix — extended and deterministic
`fixture_management_authority` is now **46 assertions** (13 legacy + **33 new**). The legacy
section reads local UAT identities and SKIPs without them — on a seedless clean boot it asserted
nothing while still reporting green. The new section seeds its own 3 clubs, 4 teams and 12 people,
so it cannot skip. Coverage: FA-A view/create · FA-B the mass-operation boundary incl. a structural
assertion that **no team bundle grants Planner, Import or bulk edit at all** · FA-C intended change 1 ·
FA-D intended change 2 · FA-E call-ups · FA-F requests and results · FA-G scope negatives.

## Tests green after contract (378 assertions, 0 failures)
`fixture_management_authority` 46 · `fixture_bulk_planning_authority` 28 ·
`roster_authority_matrix` 55 · `family_authority_matrix` 75 · `family_isolation_matrix` 83 ·
`cross_club_isolation_matrix` 87 · `capability_attack_matrix` 4 · `authority_helper_retirement` all PASS.

## THE ONE REMAINING 4C CONTRACT ITEM — the direct-insert bypass

AA.3 row 4c retires "direct fixture writes"; J.6 line 457 says *"MERGE (removes the direct-insert
bypass)"* with **RPC `create_fixture`**. Investigated, and it is a build rather than a rewrite:

* `authenticated` holds **INSERT, SELECT, UPDATE** directly on `public.fixtures`.
* **No `create_fixture` RPC exists.** Nothing in the database inserts into `public.fixtures`
  except `accept_fixture_request` and `publish_import_row`.
* The application inserts directly at `app/(app)/admin/fixtures/actions.ts:420`, and updates
  status at lines 639 and 657.

Doing it properly requires: build `create_fixture` (which **must** route a fixture against another
Ovalball club through canonical inter-club verification — Confirm / Request Change / Decline — from
this creation surface too, not around it), migrate that app call site, then revoke INSERT from
`authenticated`. Deliberately not rushed: a create path that skipped inter-club verification would
be a product regression, not just an authority one.

## Remaining for 4C, in order
1. `create_fixture` RPC + app migration + revoke direct INSERT.
2. Attack tests, races where applicable, mutation testing, suite 51 extension.
3. Playwright UAT ×3, performance comparison.
4. Compatibility/release-order proof, production-shaped rehearsal, clean boot, full battery.
5. Tighten the retirement ceilings; then READY, staged release, production verification, then 4D.

## Why the stop is here
Expand and the policy contract are both complete and verified, with every matrix green. The only
remaining contract item is a new RPC carrying a product invariant, which deserves its own careful
pass rather than the tail of a long session. Nothing is half-applied: both migrations are local,
uncommitted, and production is exactly as 4B left it.

---

# 4C — DIRECT FIXTURE CREATION ARCHAEOLOGY (§1) AND A PROVEN BYPASS

## Every legitimate fixture-creation surface

| # | surface | owner | notes |
|---|---|---|---|
| A | `createFixture` server action, `app/(app)/admin/fixtures/actions.ts` | **4C** | the direct INSERT this contract retires |
| B | `public.accept_fixture_request` | **4C** | creates the fixture *after* the other club accepts |
| C | `public.publish_import_row` | **4C** | `fixture.import.run` |
| D | `internal.project_competition_match` | **4D — preserve boundary** | Competition Match → Fixture projection. Not pulled forward. |

## Surface A, traced in full

* **Caller authority**: the action calls `requireAuthenticated` only. All real authority comes from
  RLS `fixtures_insert_scoped` → `internal.can_manage_fixture_side(owning_team_id, …)`, canonical since 358.
* **Owning team**: `input.owningTeamId`, caller-supplied. **Club**: derived from that team.
* **Ovalball-opposition detection**: if `opponentTeamId` is given, its club is looked up and counts as
  Ovalball when `clubs.status = 'active'`; otherwise an active club matching `opponentDirectoryId`.
* **If the opposition is an Ovalball club**: the action creates `fixture_request_groups` +
  `fixture_requests` and returns `pendingRequest: true` — **no fixture row is written**. The fixture
  only exists once the other club accepts, via surface B.
* **If not**: a direct INSERT with `source = 'site_admin_manual'`.
* Caller-supplied fields: owning_team_id, home_away, opponent_team_id, opponent_directory_id,
  raw_opposition_text, kickoff_date, kickoff_time, game_type, status, venue_id, notes,
  competition_edition_id, pitch_id. Server-derived: only `source`.
* Validation: kickoff date required; opposition text required. Side effects: `revalidatePath`.
* Triggers that fire on insert: audit, team snapshot, active-owning-team, age eligibility, group
  participant validity, shared-team capacity, competition-controlled fields, competition rugby code,
  meet-time consistency, conversation sync. **None enforces cross-club verification.**

## The bypass, proven

The "an Ovalball opponent is asked, never booked" invariant lives **only in the application action**.
Nothing in the database enforces it. Measured on the local database at the current checkpoint, as a
Team Manager holding legitimate team-scoped `fixture.fixture.create`:

```
A) Ovalball opponent, direct insert : INSERTED — bypass
B) external opponent, direct insert : INSERTED
```

A direct REST insert naming another **active Ovalball club's team** as `opponent_team_id` creates the
fixture outright, with **no `fixture_requests` row and no verification**. The other club is given a
fixture it never agreed to, and has no Confirm / Request Change / Decline.

*(An earlier probe in this session reported the database refusing this. That probe was malformed — it
used an invalid `status` value and was rejected by `fixtures_status_check` before reaching any
authority logic. The corrected probe above is the accurate one.)*

This is precisely what AA.3 row 4c means by retiring "direct fixture writes" and what J.6 line 457
means by "MERGE (removes the direct-insert bypass)". No product decision is required: the Phase 2
contract already specifies the remedy, so §3's STOP condition does not apply.

## The fix, as designed

1. `create_fixture` RPC, SECURITY DEFINER: requires canonical `fixture.fixture.create` at the owning
   team or its club; derives club and opposition status **server-side**; routes an active-Ovalball
   opposition into the request/verification flow instead of writing a fixture; server-derives `source`.
2. **Revoke INSERT on `public.fixtures` from `authenticated`.** With no direct insert privilege, every
   creation path is a SECURITY DEFINER function that enforces its own rules — the invariant stops
   depending on which surface the caller chose.
3. Migrate `app/(app)/admin/fixtures/actions.ts` to the RPC.
4. Prove: direct REST insert fails; the legitimate application path still succeeds; an Ovalball
   opposition still produces a request rather than a fixture.

SELECT and UPDATE grants are **not** revoked blindly — they map to reading and editing, which are
separate operations with their own policies and their own Phase 2 owners.


---

# 4C CHECKPOINT — CREATION CONTRACT COMPLETE (bypass closed)

## Production — still untouched
ledger **450** · tip `20270357000000` · audit **7493** · security events **0**.

## Migration 360 — `create_fixture` and the bypass retirement
* `public.create_fixture` (SECURITY DEFINER): derives club and opposition status **from the
  resource**, requires canonical `fixture.fixture.create` at the owning team or its club, routes an
  active-Ovalball opposition into `fixture_request_groups` + `fixture_requests` instead of writing a
  fixture, and server-derives `source`.
* **`revoke insert on public.fixtures from authenticated`**, and `fixtures_insert_scoped` dropped.
  The migration asserts the revoke took effect and fails loudly if it did not.
* SELECT and UPDATE deliberately untouched — reading and editing are separate operations with their
  own policies and their own Phase 2 owners.

Measured, as a Team Manager holding legitimate team-scoped `fixture.fixture.create`:

| | before 360 | after 360 |
|---|---|---|
| direct insert, Ovalball opponent | **INSERTED — bypass** | permission denied |
| direct insert, external opponent | INSERTED | permission denied |
| `create_fixture`, external | — | fixture created |
| `create_fixture`, Ovalball opponent | — | **no fixture, request raised** |
| `create_fixture`, ordinary Member | — | refused |

## Application
`app/(app)/admin/fixtures/actions.ts` `createFixture` now calls the RPC; the Ovalball-opponent branch
that used to live in the action is gone, because the database decides it. `types/database.types.ts`
regenerated — diff is **+`create_fixture` only**, nothing removed (verified explicitly).

## Two existing assertions corrected, not weakened
`fixture_bulk_planning_authority` B5 and B6 proved their points with direct INSERTs.
* **B5** asserted a Team Manager could create a single fixture against `v_other_dir` — which the suite
  seeds as an **active Ovalball club**. That is precisely the booking-without-asking the bypass
  allowed. It now asserts the Team Manager may still *initiate* it and that the opponent is **asked**.
* **B6** passed only because no INSERT privilege remained, which would have masked a real
  team-scope regression. It now goes through the RPC, so it proves the scope refusal itself.

## Matrix
`fixture_management_authority` is now **62 assertions**, adding FA-H1…H16: privilege-layer closure,
direct-insert refusal, external vs Ovalball routing, directory-named opposition still routed to
verification, server-derived source, persona coverage (CA, FS, Coach, wrong-team Coach, wrong-club
Club Admin, Member, Volunteer, Safeguarding Officer, guardian, stranger), the RPC's own refusal, the
Site Admin position, and that `fixture.create` never implies Planner or Import.

## Retirement
`can_manage_club_fixtures` 13 policies / 42 bodies · `can_manage_fixture_side` **2** policies (was 3;
`fixtures_insert_scoped` retired) / 6 bodies · `can_manage_team` 3 / 20 · PG15 **132** · PG16 **145**.

## Focused regression green (416 assertions, 0 failures)
fixture_management_authority 62 · fixture_bulk_planning_authority 28 · roster_authority_matrix 55 ·
family_authority_matrix 75 · family_isolation_matrix 83 · cross_club_isolation_matrix 87 ·
capability_attack_matrix 4 · capability_scope_isolation 22. `tsc` clean; `git diff --check` clean.

## Remaining for 4C
Attack/race/mutation on the create path · suite 51 · Playwright UAT ×3 · performance ·
compatibility/release-order proof (360 is a **contract** migration: the old app direct-inserts and
will break, so the app must deploy before it) · production-shaped rehearsal · clean boot ·
full battery · tighten ceilings · then READY.

---

# 4C — FULL-BATTERY FALLOUT AND THE THIRD INTENDED CHANGE (ledger 478)

The first full platform battery over the 4C tree finished **3728 passed / 5 failed**. Every
failure was in one of three files, and none of them was a defect in the 4C migrations.

## `authority_helper_retirement` — a retirement count that went *up*
`is_active_player_guardian` read 15 against a ceiling of 14, and `is_own_linked_player` 10
against 9. The cause was that migration 358 introduces `internal.fixture_family_visible_row`
carrying the Slice 4A family branch, while the function it replaces,
`internal.fixture_visible_row`, was still installed. Both bodies contained the same branch, so
the same call site was counted twice. Dropping the now-callerless
`internal.fixture_visible_row` in 358 returned both counts to their ceilings. This is the
reason a retirement count is asserted monotonically rather than by grep: an expand migration
that leaves the superseded function behind looks, to a counter, exactly like a regression.

## `perimeter_manifest` — the manifest, not the perimeter
Three new `internal` policy helpers and one new public RPC were executable by `authenticated`
with no manifest entry, which is the test doing its job. Two corrections were needed.

The first was mine: I removed the stale entries with a `startswith("create_fixture")` filter,
which also removed the long-standing, unrelated
`create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer)`. It is
restored verbatim from `HEAD`. The lesson generalises — a prefix filter over a signature list
is not a safe way to remove one entry, because signatures share prefixes by design.

The second was a schema mistake: `functions.authenticated_public` is keyed `public.<signature>`,
so an `internal` helper placed there is silently never matched. `internal` helpers belong in
`functions.authenticated_internal`, which is a flat list of bare signatures. The three helpers
moved there, `fixture_visible_row(uuid, uuid, uuid, uuid)` came out (it no longer exists), and
`public.fixtures` `authenticated.insert` moved from `"all"` to `"none"` with an `insert_reason`
recording that creation now travels through `public.create_fixture`. The manifest suite is green
at 11/11, and the resulting diff touches only those entries.

## `fixture_editor_authority` — INTENDED CHANGE 3
Section I had the **opponent club's Coach** answer an inter-club fixture request via
`public.accept_fixture_request`. Under the canonical decision that is `fixture.request.respond`,
which design J.6 line 466 does not grant to a Coach: a Coach may **raise** a fixture request but
may not **answer** one. Answering commits the club to a fixture against another club, and that
is a club-level commitment.

This is the third declared intended change of 4C, alongside (1) Full Site Admin losing the
blanket fixture bypass in favour of an explicit `site.fixtures.support`, and (2) a Team Manager
gaining archive/restore over their own team's fixture (J.6 line 460).

The suite was not weakened to accommodate it. It now seeds a Fixture Secretary at the opponent
club, asserts the Coach's refusal explicitly as new assertion **I2b**, and then has the Fixture
Secretary answer. The coach persona is kept for sections F (opponent-side notifications) and
C/D (the opponent coach may change the schedule but not the owning club's details), which are
genuine coach authority and unchanged. The suite is green at 19 assertions, one more than before.

---

# 4C — THE LAST TWO OWNED POLICIES, AND THE CLEAN BOOT (ledger 479)

## Two policies the first pass left behind
Adding a 4c block to `authority_helper_retirement` — the same shape as the 4a and 4b blocks, asserting
that no function or policy 4c owns still calls a legacy helper — immediately found two that did:

```
fixtures.fixtures_delete_admin                 DELETE  is_site_admin()
fixture_requests.fixture_requests_insert_scoped INSERT  is_site_admin() OR can_manage_team(requesting_team_id)
```

Both are squarely 4C's meaning, not another slice's: raising a fixture request and deleting a fixture
are fixture questions. They had been missed because the first pass worked from the *read* policies,
and these are the corresponding *writes*. Both are now migrated in `20270359000000`.

**Raising a request** becomes `fixture.request.create` at the requesting team, or at the group's
requesting club, or `site.fixtures.support`. This is the write side of the read policy already
migrated, and it is deliberately wider than answering one: a Coach may raise a request and may not
answer it. `can_manage_team` was both wider than the question and non-inheriting. The application's
only insert path, `createFixtureRequest` in `app/(app)/fixtures/new/actions.ts`, writes
`requesting_team_id` and `group_id` and is satisfied by the team branch or the club branch
unchanged, so no application change follows.

**Deleting a fixture** becomes `site.fixtures.delete`. A club archives; only the site deletes.

## An honest limit on the delete change
`fixtures_delete_admin` is evaluated by nobody who can reach it. DELETE on `public.fixtures` is
granted only to `postgres` and `service_role`, and both carry `BYPASSRLS`. Rewriting the policy is
still right — it removes a legacy reference and lowers the PG-15 count — but the authority change is
**NOT OBSERVABLE** through any browser role, and the matrix says so rather than staging a scenario
that would imply otherwise. FA-L6/L7 assert the capability answers (a Club Admin does not hold
`site.fixtures.delete`, a Full Site Admin does, through the bundle rather than the bare role);
FA-L8/L9 assert what actually protects the row — that no browser role holds DELETE at all, and that
the policy no longer carries the bypass.

## Matrix
`fixture_management_authority` is now **96 assertions**, adding FA-L1…L9. FA-L1 pins the Coach's
ability to raise, FA-L2 that the write binds to the team and not merely the club (which the old
`can_manage_team` did not), FA-L3 the Club Admin's club-wide inheritance, FA-L4/L5 the Member and
anonymous refusals.

## Ceilings, tightened to the measured floor
Every ceiling now sits at what the tree actually leaves behind, so any future increase fails:

| helper | policies | bodies | was |
|---|---|---|---|
| `has_capability` | 98 | 123 | 98 / 125 |
| `is_site_admin` | 115 | 146 | 125 / 158 |
| `can_manage_club_fixtures` | 13 | 42 | 20 / 57 |
| `can_manage_fixture_side` | 2 | 6 | 3 / 6 |
| `can_manage_team` | 2 | 20 | 7 / 28 |

`PG15` **130** (was 138) · `PG16` **145** (was 157). `authority_helper_retirement` is 35 assertions.

## Clean boot from empty
All **453** migrations, including 358, 359 and 360, apply to a fresh disposable stack (`s4cboot`,
port prefix 582) built from an empty database. Nothing was stubbed or pre-installed.

The first attempt stopped *after* the last migration, in the seed step:

```
Seeding data from supabase/seeds/local_uat_parent_player.sql...
ERROR: Cannot activate a B squad without an active primary team at this level. (SQLSTATE 23514)
```

Rather than assume that was 4C's doing, a control stack (`s4cctl`, prefix 583) booted the **same
tree with 358/359/360 held back** — production's exact ledger of 450 — with seeds enabled. It fails
identically. The defect is in the seed file, pre-dates this slice, and is recorded as an
out-of-scope finding with no owner assigned rather than patched inside a 4C release. The clean-boot
proof therefore runs with that seed step disabled; the suites it runs seed their own deterministic
data and do not depend on it.

## Production ledger, confirmed read-only before release
`supabase migration list --linked` reports 453 rows, **450 applied remotely**, remote tip
`20270357000000` (4B), and exactly three pending: `20270358000000`, `20270359000000`,
`20270360000000`. Production is untouched and stands where 4B left it.

## Clean-boot results (all green)

```
453 tip 20270360000000
create_fixture 1 · viewable_fixture_clubs 1 · viewable_fixture_teams 1 · fixture_family_visible_row 1
superseded fixture_visible_row 0 · authenticated INSERT on fixtures 0

fixture_management_authority     86   fixture_bulk_planning_authority  28
fixture_editor_authority         19   authority_helper_retirement      35
roster_authority_matrix          55   family_authority_matrix          75
cross_club_isolation_matrix      87   capability_attack_matrix          4
capability_scope_isolation       22   perimeter_manifest            11/11
```

`fixture_management_authority` reports **86** here rather than 99 because the original legacy section
reads the UAT seed identities and SKIPs without them. That gap is exactly why the slice added the
deterministic FA-A…FA-L sections: a suite that can report zero assertions on a clean database is a
suite that can pass without testing anything.

## Application surfaces re-checked before the contract migration
A repository-wide search for `.from("fixtures")` combined with `.insert` or `.upsert` across `app`,
`lib` and `components` returns **nothing**. `createFixture` was the only direct-insert surface and it
now calls the RPC, so Stage C revokes a privilege that no deployed code path will still be using once
Stage B is live. Creation paths inside `SECURITY DEFINER` functions — `accept_fixture_request` and the
publish/import routines — run as the function owner and are unaffected by a grant to `authenticated`.

## The release order had a hole in it, found before release (ledger 480)
The plan recorded at ledger 419 was Stage A = 358 + 359, Stage B = application, Stage C = 360, with
`20270360000000` both creating `public.create_fixture` and revoking the INSERT privilege.

Re-reading that immediately before releasing showed it opens an outage window. At Stage B the newly
deployed `createFixture` calls `public.create_fixture`, and under that plan the function would not
exist in production until Stage C. Every club's fixture creation would fail for the length of the
gap — not a permission error but `function does not exist`.

The fix is the expand/contract discipline the programme already requires, applied one level deeper.
`20270360000000` is now **pure expand**: it only adds the function, and is safe to apply while the
old application is still serving. The new `20270361000000_retire_fixture_insert_bypass.sql` is
**pure contract**: `revoke insert`, `drop policy fixtures_insert_scoped`, and the assertion that the
revoke took effect. Stage A becomes 358 + 359 + 360; Stage C becomes 361.

Both halves apply cleanly and idempotently against the local database, and the tree is now 454
migrations. The general lesson: a migration that both creates the new route and closes the old one
cannot be ordered correctly against an application deployment, because the deployment needs the
first half before it and the second half after it.

## A provenance regression I introduced, caught on the last read (ledger 481)
Reviewing the deployed application diff one final time before staging it showed that the old
`createFixture` wrote `source: 'site_admin_manual'` and `public.create_fixture` hardcoded
`'club_created'`.

`fixtures.source` is not decoration. Its column comment calls it *"Where this fixture record came
from — club_created (the normal club-facing flow), site_admin_manual, csv_import, or
competition_import. Provenance only, never editable identity"*, and
`app/(app)/admin/fixtures/fixture-filters.tsx` offers **Site Admin** as a filter over it. Hardcoding
one constant would have quietly emptied that filter for every fixture created from then on, and
would have recorded Site Admin's work as the club's.

The principle behind the hardcode was right — a caller must not be able to describe their own
fixture as somebody else's work, so `source` must never be an argument. The mistake was reading
"server-derived" as "constant". The honest derivation is **which of the three authority answers
granted the call**: if the caller passed on `fixture.fixture.create` at the team or the club, the row
is `club_created`; if they passed only on `site.fixtures.support`, it is `site_admin_manual`. That is
still uncounterfeitable, because the caller cannot choose which branch authorised them.

`v_club_authorised` now holds the club answer, the site capability is tested separately, and
`v_source` follows. New assertion **FA-H4b** pins it by having the Full Site Admin persona create a
fixture and checking the row reads `site_admin_manual`; FA-H4 keeps the club case. The matrix is
**97 assertions**.

The general point, which is why this is in the ledger rather than only in a commit: when a migration
moves a write out of the application and into the database, every column the application was setting
has to be accounted for, not just the ones the security argument is about. `source` was not part of
the bypass, which is exactly why it nearly travelled unexamined.

## A second column set nearly lost the same way (ledger 482)
Checking the rest of the columns the old `createFixture` wrote — the discipline the `source` mistake
had just taught — found a second omission, and a worse one.

When the opposition is a **claimed Ovalball club that has not named a team yet**, the old action put
the structured identity of the side being asked for onto the request:

```
target_team_age_group · target_team_gender · target_team_squad_designation
```

That is Central Fixture Participant Resolution. Without it the other club receives a request with no
indication of which of their sides is wanted, and cannot answer it. `public.create_fixture` had no
parameters for these, so they would have been silently dropped from both live callers —
`app/(app)/admin/fixtures/add-fixture-dialog.tsx` and `app/(app)/calendar/create-fixture-dialog.tsx`.

They are now three arguments on the RPC. Accepting them as arguments is safe in a way that accepting
`source` would not have been: they describe the **team being asked for**, never the caller's own
authority, so there is nothing to forge. And they are ignored outright when `p_opponent_team_id`
already names a real team, so a caller cannot use them to contradict the named opponent.

Assertions **FA-H7b** and **FA-H7c** pin both halves. The matrix is **99 assertions**.

Adding the three arguments changes the function's signature, so the perimeter-manifest entry and the
generated types were updated with it; the types diff remains purely additive (+21, nothing removed).
The stale 13-argument signature was dropped from the local database — it exists nowhere else, because
`20270360000000` has never been applied to production.

## Final green state before release (ledger 483)

| Proof | Result |
|---|---|
| Full platform battery | **3761 passed, 0 failed, 197 suites** |
| Clean boot from empty | **454** migrations, tip `20270361000000`, all suites 0 failed, manifest 11/11 |
| `fixture_management_authority` | 99 with seeds, 86 seedless |
| `authority_helper_retirement` | 35, every ceiling at the measured floor |
| `fixture_creation_races` | 4/4 |
| `tsc` · `eslint` · `git diff --check` | clean |

The clean boot also confirms exactly **one** `public.create_fixture` exists there — the sixteen-argument
signature — so the thirteen-argument version that briefly existed on the local database during
development is an artefact of iterating in place and reaches nothing else. `20270360000000` has never
been applied to production, so production will only ever see the final signature.

Protected logos verified untouched immediately before staging: `Ovalball Square Logo.png`
`be2bef0c978869aaa73e474cd5abdf5aec1fff6c`, `Overball Logo Low Res.png`
`bdd3224871f0561d971f93f519764f0502092504`. Both remain untracked and are not staged.

---

# 4C — PRODUCTION RELEASE (ledger 484)

Commit `be4c52b`, fast-forward `774ab9b..be4c52b`, pushed to `main`. Twenty-two files; the two
protected logos remained untracked and unstaged throughout, SHA-1s unchanged.

## The three stages, as executed

**Stage A — 12:5x UTC.** `20270361000000` was moved out of `supabase/migrations/` so that
`supabase db push --linked` could apply only the expand set, then moved back immediately afterwards.
Applied: `20270358000000`, `20270359000000`, `20270360000000`. The application then running was the
4B build, which still direct-inserts and still held INSERT, so it was unaffected.

**Stage B.** `git push origin main` → Vercel. The deployment was confirmed live before proceeding,
not assumed: the prerendered `/login` response changed `etag`
`4c7fee48…` → `4c9af1c8…`, its `age` reset from 9732 to 0, and the content-hashed chunk set changed
`d005086b…` → `fa7d9607…`. Detected 120 s after the push. Both `ovalball.co.uk` and
`www.ovalball.co.uk` returned 200 afterwards.

**Stage C.** `supabase db push --linked` applied `20270361000000`. This is the migration that revokes
INSERT, and it ends with a DO block that raises if `authenticated` still holds the privilege. It
completed without error, so **that assertion passed inside production** — which is the point of
writing the check into the migration rather than only into a test.

## Production state after release
`supabase migration list --linked`: **454 rows, 454 applied remotely, remote tip `20270361000000`,
none pending.** All four 4C migrations report APPLIED. No migration reported an error at any stage.

## What is verified in production, and what is not

**Verified in production:** the full migration chain applied in the intended order; the revoke
assertion passed there; the deployment is live on both domains and serving.

**NOT OBSERVABLE ON CURRENT PRODUCTION DATA:** every per-persona authority distinction — the three
intended changes, the refusals, the request routing. Observing them needs signed-in identities
holding particular roles at particular clubs, and production has one club with one active membership.
Creating identities to make them observable is prohibited, and would be the wrong trade regardless:
it would put fabricated people in a real club's records to improve a report. Those distinctions are
proven instead on the local and clean-boot databases, where the suites seed their own deterministic
people — 3761 assertions across 197 suites, and 9 green browser runs against real authenticated
sessions.

## Zero schema drift, confirmed after release
`supabase db diff --linked` replays the full 454-migration tree into a shadow database and compares
it with the live remote schema. It reports **"No schema changes found"**.

This is worth recording separately from the ledger check, because the two prove different things. The
migration list says *which migrations ran*. The diff says the schema they produced is **exactly** the
schema every one of the 3761 assertions and the clean boot were run against — the same function
bodies, the same policy expressions, the same grants. It rules out a partially-applied object, and it
rules out any hand-edited difference between what was tested and what is serving.

## Verdict
**IDENTITY/AUTH SLICE 4C — PRODUCTION VERIFIED.**

4d–4i are not started. Next in order is 4d (Training). 4g stays banked under decision D-S4-2 and is
not to be implemented ahead of its turn. Slice 5 is not started.

---

# 4D ARCHAEOLOGY AND OWNERSHIP MAP (recorded at ledger 485)

Taken from the exact AA.3 row 4d contract and design J.8 lines 482-491, not from helper names.
AA.3 row 4d retires **`can_organise_competition` role checks** and **`calendar.manage` tournament
use**, and names the matrix `competition_authority_matrix.sql`.

## Every call site, measured on the live database at 454

| helper | policies | bodies | callers |
|---|---|---|---|
| `can_organise_competition` | 0 | 3 | `can_organise_edition`, `update_competition_metadata` |
| `can_organise_edition` | **8** | 1 | the eight competition read policies, `require_edition_organiser` |
| `can_manage_tournament` | 0 | 5 | save/cancel/get centre, reserve/release pitch |
| `can_manage_tournament_entry` | 0 | 6 | save/delete game, record/remove opponent, remove entry |
| `can_manage_competitions` | 5 | 6 | already canonical — `has_site_capability('site.competitions.manage')` |
| `can_answer_competition_match` | 0 | 1 | `respond_competition_match` |
| `require_edition_organiser` | 0 | 10 | the ten organiser-gated Creator RPCs |

## What 4D does NOT take

`calendar.manage` also decides **club events**, which is J.9 and belongs to 4E. AA.3 says 4d retires
the *tournament* use, and that is all it retires. `app/(app)/club/events/page.tsx` keeps reading
`calendar.manage` until its own slice. Equally, `competition_match_verifications_read` keeps asking
4C's `can_bulk_plan_fixtures` and `can_create_team_fixture`: "may this club plan fixtures" is a
fixture question that 4C owns the meaning of, exactly as 4B's roster policies kept asking 4A's
family helpers.

## The catalogue was already right

All ten J.8 keys exist, ACTIVE, with the scopes and bundles J.8 specifies — Slice 3 seeded them and
they are live in production. 4D therefore adds no capability and changes no bundle. It is a pure
resolver migration: the gates stop asking role strings and a deprecated adapter, and start asking
the catalogue.

## §9 unknown-age check for 4D
Does 4D make unknown-age staff authority or staff-role onboarding more reachable? **No.** 4D touches
no role grant, no membership transition and no onboarding path; it only changes which capability key
a competition or tournament gate asks. The follow-up carries forward unchanged.

---

# 4D SHADOW COMPARISON (AA.4) — SEVEN QUESTIONS × NINE PERSONAS

Legacy answer versus canonical answer, on a seeded world, before anything was changed. 63 pairs,
**two** differences — and a third appeared once the site master equivalents J.8 specifies were wired
in. All three are declared intended changes.

## INTENDED CHANGE 1 — a Coach may no longer answer a competition match
`can_answer_competition_match` read raw role strings twice: `is_club_fixture_administrator()` matched
`'CLUB_ADMIN'`/`'FIXTURE_SECRETARY'` on the membership, and a raw `team_permissions` read matched
`('team_admin','coach','manager')`. J.8 line 488 gives `competition.match.respond` to CA and FS at
club scope and TM at team scope. **A Coach is not on that list.** Answering commits the club to play
the match — the same boundary 4C drew when a Coach kept the right to raise a fixture request and
lost the right to answer one.

## INTENDED CHANGE 2 — a solo-entered Team Manager no longer takes the whole occasion
`can_manage_tournament` had a branch granting the occasion to someone with team authority over
**every** entered team. Its own comment explains the intent: *"A U12 manager does not get the parent
occasion just because U12 is going."* But when U12 is the **only** team entered, "every entered
team" is satisfied by one team and the U12 manager got the whole occasion after all — measured as
`true`, not inferred. The rule contradicted its own stated intent in exactly that case. J.8 line 490
settles it: the occasion is club-level (CL, CA and FS). So this is less a removal than the rule
finally meaning what it said.

## INTENDED CHANGE 3 — site support may answer a competition match
J.8 line 488 names `site.support.act_in_club` as the site master equivalent for
`competition.match.respond`. The legacy gate gave site support no route in at all. This is a
**widening**, and it is the architecture working as designed: an explicit, named site capability
rather than a role bypass. It is declared rather than absorbed quietly.

## What is deliberately PRESERVED
`can_manage_tournament_entry` gives a Team Manager authority over **their own team's** entry. J.8
defines no tournament-entry key, so the governing authority there is the product invariant that
created the entry/occasion split in `20270217000000`: *"THIS team only. The whole point of the
split: a U12 admin schedules U12's day and cannot touch U13's."* That invariant is live — measured,
not assumed — and 4D preserves it, expressing the team branch as `calendar.event.manage` at team
scope. AA.3's requirement is still met: the deprecated `calendar.manage` string and the
`has_capability` adapter are both gone.

There is one place where the site master is deliberately **withheld**: `issue_competition_matches`
asks `competition.match.respond` at the participating club to decide whether the organiser has in
effect already answered for it, and does **not** ask the site capability. Letting site support
silently pre-confirm a match for a club nobody at that club has spoken for would invent consent.
The function's own comment already said so about Site Admin; the canonical rewrite keeps it true.

---

# 4D IMPLEMENTATION (ledger 486)

## Migrations
`20270362000000_competition_authority_canonical.sql` — **expand**. Rewrites the five competition and
tournament gates onto `internal.can`, migrates `issue_competition_matches` off its four raw-role
reads, and drops the now-callerless `internal.is_club_fixture_administrator`.

`20270363000000_competition_policies_canonical.sql` — the eight owned read policies, plus the
hoisting helper `internal.organised_edition_ids()`.

Neither withdraws a privilege, changes a signature or adds an application dependency, so neither is
a *release-ordering* contract step. That is proven below rather than assumed.

## A performance fix the slice did not strictly owe, and why it was taken anyway
The eight policies became canonical the moment `can_organise_edition` did, so no policy rewrite was
required for correctness. They were rewritten for a measured reason. Reading one edition's 800
matches as its organising Club Admin:

| | |
|---|---|
| pre-4D (`can_bulk_plan_fixtures` inside the gate) | 153.1 ms |
| 4D gate (canonical `internal.can` inside the gate) | **146.5 ms** — no regression |
| 4D gate + the hoist | **1.8 ms** — about 85× |

So 4D caused no regression; the cost was already there, inherent to asking per row a question that
does not vary per row. The organiser set depends only on *who* is asking, so it belongs in the
policy as an uncorrelated subquery the planner evaluates once per statement as an InitPlan — the
same fix 4C applied to `fixtures_select_related`.

`internal.competition_edition_is_public` is deliberately **not** hoisted: J.8 line 482 marks it
KEEP, and the set of publicly visible editions is platform-wide rather than caller-bounded, so
hoisting it would build a large array for every reader to save a cheap flag test.

A hoist must not change answers, so it was proved not to: for every persona and every affected
table, the row set the hoisted policy returns was compared against the row set the per-row predicate
would have returned — **12 comparisons, 0 mismatches**, on a deliberately *non-public* edition so
the organiser branch is the only way in. With an active edition every persona sees everything and
the comparison would have proved nothing.

## A grant I removed, and had to put back — CORRECTED
The first version of the hoist granted `EXECUTE` on `internal.organised_edition_ids()` to **anon** as
well as `authenticated`. I removed the anon grant, reasoning that none of the eight tables grants
anon `SELECT`, so anon never evaluates these policies. **That reasoning was wrong and the removal was
a regression.** It is recorded here rather than quietly reversed, because the mistake is reusable.

`has_table_privilege('anon', 'public.competition_matches', 'SELECT')` returns **false**, which reads
like "anon never touches this table". It is false because anon's grant is **column-level**: the
perimeter manifest classifies `competition_matches` as PUBLIC and grants anon nineteen named
columns, which is how `app/competitions/[slug]` serves the public competition surface. A
column-level grant does not satisfy a table-level privilege test. The manifest had already written
this down — it lists `can_organise_edition(uuid)` under `anon_internal_policy_helpers` with the
reason *"Evaluated by row policies when anon reads: … competition_matches …"* — and I did not read it
before trusting the privilege probe.

The grant is restored, and the migration now raises if anon **cannot** execute the helper, which is
the assertion that would have caught this immediately. What 4D does tighten instead is real:
`internal.can_organise_edition(uuid)` is no longer named by any policy, so anon's EXECUTE on **it** is
withdrawn, and the manifest moves accordingly.

The lesson generalises past this slice: a perimeter check that only looks for absence is content
when a public surface goes dark. `CM-G4` now asserts both directions — anon reads none of a
non-public edition, and **does** read a public one.

## Application
Two UI capability reads move off the deprecated key:
`app/(app)/calendar/page.tsx` (`canCreateTournament`) and `app/(app)/tournaments/new/page.tsx`
(`canCreate`), both now `tournament.tournament.manage`. `app/(app)/club/events/page.tsx` keeps
`calendar.manage` — it is a club event, which is 4E's.

No other application change: every 4D write already travels through `supabase.rpc(...)`, and a
repository-wide search for a direct insert, update or upsert on any `competition_*` or
`tournament_*` table returns nothing.

## Release ordering, DERIVED
Both directions were measured, not asserted:

```
OLD APP gate (calendar.manage, club)        CA=t  TM=f
NEW APP gate (tournament.tournament.manage) CA=t  TM=f
COMPATIBLE: both builds gate this route identically, so neither order can strand a user.
OLD APP SAFE: the calendar.manage adapter row survives 4D.
NEW APP SAFE: tournament.tournament.manage predates 4D (Slice 3 seeded it).
```

So 4D needs **no staged release**, unlike 4C. Migrations still go before the push, because the push
is the deployment.

---

# 4D — WHAT THE CLEAN BOOT CAUGHT (ledger 487)

The first clean boot of the 4D tree came up correctly — 456 migrations from empty, every 4D object
present, `is_club_fixture_administrator` gone, zero `can_organise_edition` policy references, anon
holding no EXECUTE, and 4C still intact — but `competition_authority_matrix` stopped at 53
assertions with:

```
ERROR:  permission denied for function organised_edition_ids
```

The cause was mine: I had revoked anon's `EXECUTE` on the hoisted helper. The clean boot said
"permission denied", and the **full battery then said it twice more** — `competition_matches` and
`identity_foundation_and_perimeter`, two pre-existing suites, both stopped at the same function.
Those two are what made the diagnosis unambiguous, because `competition_matches` contains a named
product assertion that *anon **can** see an external-versus-external match*. Anon reading the public
competition surface is the §12 invariant, not an accident.

So the revoke was wrong and is reversed; the full correction is recorded under ledger 486.

Two things are still worth keeping from the episode. First, a test written against a looser grant
can depend on the **shape** of a refusal without saying so: CM-G4 expected "zero rows" and got
"permission denied", and the helper it used had no exception handler, so the block aborted rather
than failing one assertion. Second, the local database had carried the looser grant since before the
revoke, so the local matrix went on passing while a database built from empty disagreed — which is
the whole case for booting from empty rather than trusting a long-lived development database.

CM-G4 now asserts anon reads none of a non-public edition, CM-G4b that it **does** read a public one,
and CM-G4c pins the column-level grant and helper EXECUTE that make the public surface work. The
matrix is **70 assertions**.

Mutation testing was re-run against the corrected matrix: **6 mutants, 6 killed, 0 survivors**, with
a clean restore.

## Browser verification, and one anomaly reported rather than buried (ledger 488)
Suites 51, 52, 53 and 54 were run three passes each: **pass 1 and pass 3 fully green**
(19 / 17 / 14 / 22), pass 2 green for 52 and 53, with suite 51 crashing and suite 54 at 21/22.

Suite 51's crash was a signed-out page: the parent's context landed on `/login` at N2, so the
assertion that the guardian is offered the gender form threw rather than failed. It is **not
reproducible in isolation** — 51 has since run 19/19 three consecutive times alone, and 54 22/22
three consecutive times alone, six clean runs against one bad one.

The one occurrence coincided with other activity against the same database. These suites are not
safe to run concurrently **with themselves**: each deletes stale identities by email *prefix* at
startup, so a second run of the same suite removes the first run's people mid-flight, and every
later assertion then measures a signed-out page. That is an operating hazard of the harness, not a
product defect, and it is the most likely explanation here.

What was ruled out rather than assumed: the shared harness does **not** blindly trust a cached
session — `tryCachedSession` reads the identity back from the product and drops the cache if it
disagrees — so a stale session cache is not the cause. No change was made to the shared harness on
the strength of a failure that cannot be reproduced; changing infrastructure four suites depend on,
to fix something that has not happened again in six runs, would be the worse trade. It is recorded
as a documented risk with a named recommended fix: the suites should take a database-level advisory
lock for their prefix so a second concurrent run waits instead of deleting the first one's people.

---

# 4D — PRODUCTION RELEASE AND VERDICT (ledger 489)

Commit `ecdb9e4`, fast-forward `3e8b932..ecdb9e4`. Migrations applied **before** the push, because
the push is the deployment; no staging, because compatibility was measured in both directions and
both builds gate the affected route identically.

Deployment confirmed live 40 s after the push on two independent markers: `/login` etag
`326f5974…` → `242e5209…` and chunk set `15f43204…` → `fea9dfa7…`. Both domains 200.

**Production:** 456 rows, 456 applied, tip `20270363000000`, none pending, and
`supabase db diff --linked` reports **"No schema changes found"** — the live schema is exactly the
one the 3840 assertions and the clean boot ran against.

**Verdict: IDENTITY/AUTH SLICE 4D — PRODUCTION VERIFIED.**

4e–4i are not started. Next in order is 4e (Calendar, venues, pitches, training). 4g stays banked
under D-S4-2. Slice 5 is not started.

---

# 4E ARCHAEOLOGY AND EXACT OWNERSHIP MAP (recorded at ledger 490)

AA.3 row 4e retires **"role-string RPC checks, public training plans"**, with the matrix
`venue_training_authority_matrix.sql`, and carries the **U** "venues RLS/RPC mismatch" closure and
the **V** presets. Design J.9 lines 496-507 holds the eleven keys.

## 4E-OWNED FOOTPRINT

| object / path | current authority | canonical capability | scope | why 4E owns it |
|---|---|---|---|---|
| `internal.can_manage_club_event` | `is_site_admin()` + `calendar.manage` | `calendar.event.manage` | club, team | J.9 497 |
| `internal.club_event_visible_row` | `is_site_admin()` + raw `club_memberships` read | `calendar.event.view` | club | J.9 496 |
| `internal.can_manage_training` | `club.training.manage` / `team.training.manage` | `training.plan.manage` | club, team | J.9 505 MERGE |
| `internal.training_session_visible_row` | `is_site_admin()` + raw membership read | `training.session.view` | club, team | J.9 504 |
| 4 venue RPCs | **`internal.is_club_admin()`** (raw role) | `venue.venue.manage` | club | J.9 500; the U mismatch |
| `public.set_venue_address` | `club.venues.manage` + `is_site_admin()` | `venue.venue.manage` | club | J.9 500 |
| 5 pitch RPCs | `can_manage_club_fixtures` (4C's gate) | `venue.pitch.manage` | club | J.9 501 |
| 10 training RPCs | `club.training.manage` ×10 | `training.plan.manage` | club | J.9 505 |
| `venues_select` | **`true`** | `venue.venue.view` + `public_venues` | club | J.9 499, M-2 residue |
| `training_plans_select`, schedule rules | **`true`** | `training.session.view` | club, team | J.9 504 |
| venue / pitch / training write policies | legacy keys | the canonical manage keys | club | J.9 500/501/505 |
| 8 application capability reads | `calendar.manage`, `calendar.view`, `club.venues.manage`, `club.pitches.manage`, `club.training.manage`, `fixture.edit` | the canonical keys | club | the UI half of the same rename |

## NOT 4E — named so it is not mistaken for an oversight

| object | why not 4E | owner |
|---|---|---|
| `app/(app)/club/events/page.tsx` … other `calendar.manage` uses | *club events* are J.9, but the remaining non-tournament, non-event uses are their own domains | their slice |
| `club_pitches_select` = `true` | J.9 defines `venue.pitch.manage` and `venue.pitch_allocation.*` but **no pitch-view key**; anon already holds nothing | a later slice |
| `get_tournament_centre` pending-invitation filter | a *display* filter, not an authority gate; never held the calendar key | tournament participation |
| `update_tournament_venue` recipient query (`cm.role in (...)`) | selects who is **notified**; decides no authority | a later slice |
| `training_plan_schedule_rules` family branch | "a player on this team, or their guardian" is 4A's question | 4A |
| `competition_match_verifications_read` 4C helpers | "may this club plan fixtures" is a fixture question | 4C |

## A Slice 4D remnant that BLOCKED 4E
Four RPCs still decided **tournament** authority with the deprecated `calendar.manage`:
`save_tournament`, `add_tournament_team_entry`, `get_tournament_centre`, `update_tournament_venue`.
They are AA.3 row **4d**, and 4D's retirement assertion missed them because it checked the function
list 4D declared rather than the contract's wording.

4E could not complete its own J.9 RENAME while they held the key, so their **authority gates** are
closed here on J.8 line 490's already-defined behaviour — plus two bare `is_site_admin()` bypasses
found beside them. Nothing else of 4D's is touched, and the matrix asserts only the three gates 4E
actually changed.

## §9 unknown-age check for 4E
Does 4E make unknown-age staff authority or staff-role onboarding more reachable? **No.** It grants
no role, changes no membership transition and touches no onboarding path; every change either
narrows a read or unifies two existing answers into one. The follow-up carries forward unchanged.

---

# 4E SHADOW COMPARISON (AA.4) AND FOUR INTENDED CHANGES (ledger 491)

Ten questions × eight personas = 80 pairs, run before anything changed. Four differences, all four
specified by J.9 and by the bundles Slice 3 already seeded.

**1. A Fixtures Secretary may now manage a venue.** This *is* the U section's "venues RLS/RPC
mismatch". The venue RPCs asked `internal.is_club_admin(club)` while the venues RLS asked
`club.venues.manage`, which CA **and** FS hold — so a Fixtures Secretary could change a venue row
through one door and was refused the same act at the other. J.9 line 500 makes
`venue.venue.manage` CA and FS, one authority for one resource.

**2. An ordinary club Member may no longer see training sessions or plans.** J.9 line 504 gives
`training.session.view` to CA and FS at the club and CO, TM and PL at the team, with PG at the
child — MB is absent, and the key is marked safeguarding-sensitive. The legacy helper admitted
anyone holding any active membership row. A training session is a standing record of where named
children will be on a given evening, so this narrowing is the point of the key rather than a
side-effect of it. A club **event** is deliberately unaffected: `calendar.event.view` does include
MB, because a club event is not a child's timetable.

**3. Another club, or a signed-in stranger, may no longer read this club's venues.** `venues_select`
was `true`. Anonymous exposure had already been narrowed by Slice 1 to `(id, name)`, but every
*signed-in* account could read every club's venues in full — addresses, directions, notes.

The obvious thing that could have broken is an AWAY fixture at the opposition's ground, and that was
measured rather than hoped: `public.update_fixture_venue` refuses unless the fixture is a **home**
fixture and the venue belongs to that fixture's own club. A visiting club therefore never resolves
another club's venue row; an away fixture carries free-text `venue_address`.

**4. Site support gains venue and training management** through the explicit site masters J.9 names
(`site.clubs.profile.manage`, `site.support.act_in_club`), where the legacy gates gave it no route
in at all. A widening, declared, and by named capability rather than role.

## What the battery then said about those changes
Eleven failures across eight suites, every one a genuine consequence rather than a flake:

* `authority_helper_retirement` — `is_active_player_guardian` 15/14 and `is_own_linked_player` 10/9.
  **The Slice 4C lesson repeating**: `training_family_visible_row` was introduced to carry the family
  branch for the policies while `training_session_visible_row` still contained its own copy, so 4A's
  counters saw each call site twice. The helper now delegates instead of repeating.
* `security_perimeter_guard` — `public_venues` is an owner-rights view readable by anon, which P4
  forbids except for the deliberately public list. It joins that list, which is what it is for.
* `bundle_legacy_parity`, `backfill_verification` — retiring the calendar adapter removes 10 further
  legacy role defaults, so the intended-removal list goes from 17 to 27, each named with its reason.
* `capability_catalogue_integrity` — 72 → 70 pre-Slice 3 keys still resolvable.
* `capability_override_ceilings` — its "legacy names accepted" case used `calendar.manage`, which is
  no longer a legacy name that resolves. It now uses `club.edit_profile`, which still is, so the
  coverage is kept rather than deleted.
* `training_centre_visibility` — its "a member of the owning club sees the session" case used a
  persona **named** `v_coach` that was seeded as a bare `BASIC_USER` with no team permission, so it
  was really asserting club-wide visibility. It is now an actual coach, and an ordinary member is
  seeded alongside to assert the narrowing. That is more coverage than before, not less.

---

# 4E — PERFORMANCE, AND A THREE-STAGE RELEASE DERIVED FROM EVIDENCE (ledger 492)

## The per-row resolver, a third time
Reading one club's 800 training sessions as its Club Admin:

| | |
|---|---|
| pre-4E (raw membership read inside the helper) | 46.7 ms |
| 4E gate, still called per row | **106.9 ms** — a real 2.3× regression |
| 4E gate, sets hoisted into the policy | **0.9 ms** |

The first hoist was not enough on its own, and the reason is worth recording. `training_plans`
stayed linear — 6.6 ms for 50 rows, 53.8 ms for 400 — until `EXPLAIN` was actually read instead of
guessed at. The plan showed the filter beginning with `internal.can_manage_training(club_id,
team_id)`, with both hoisted SubPlans *"never executed"*: `training_plans_write_scoped` is a
**FOR ALL** policy, so its `USING` clause is OR'd into every SELECT as well. It had never shown up
before because `training_plans_select` was `true`, which let the planner satisfy every row from the
trivial policy and never call the write gate at all. **Enforcing a read that was previously
unenforced is what exposed it.** Hoisting the manage sets too brought 400 plans to 1.1 ms.

A guess was tried first and rejected on the evidence: raising the family helper's planner `COST` to
10000 changed nothing, because the family helper was never the cost.

## Release ordering: neither pure order is safe
4E is the first slice in this conveyor to **retire a legacy capability adapter**, so the old build's
question stops resolving the moment the migration lands. Measured:

```
OLD BUILD, NEW DB   calendar.manage(CA)=f   club.training.manage(CA)=t   club.venues.manage(FS)=t
NEW BUILD, NEW DB   calendar.event.manage(CA)=t  training.plan.manage(CA)=t  venue.venue.manage(FS)=t
```

* **Migrations first** → the deployed build's `hasCapability('calendar.manage')` reads FALSE, so a
  Club Admin loses the club-events controls, and its `/competitions/[slug]` loses venue names when
  anon's grant on `venues` goes.
* **Application first** → the new `/competitions/[slug]` reads `public.public_venues`, which would
  not exist yet.

So the slice releases in **three stages**, and the contract migration was split to make that
possible:

| Stage | Action | Why |
|---|---|---|
| A | `20270364000000` + `20270365000000` | Both purely additive. The gates become canonical and `public_venues` appears; the running build neither knows nor needs either. |
| B | Deploy the application | It now asks the canonical keys and reads `public_venues`, both of which Stage A has provided. |
| C | `20270366000000` | Revokes anon's grant on `venues`, narrows the reads, closes the 4D remnant and retires the calendar adapter — all safe only once B is live. |

Note that `club.training.manage`, `club.venues.manage` and `club.pitches.manage` keep resolving:
`internal.has_capability` passes an unmapped key straight through to the canonical decision, and
those keys still exist. Only `calendar.manage` and `calendar.view` had adapter rows, and only they
stop resolving. That is why Stage C's blast radius is exactly two surfaces rather than the whole
domain.

## The rehearsal's one data delta, explained rather than waved through
The production-shaped rehearsal reports the seeded shape identical except `audit 2859 → 2863`. That
is exactly four rows, and they are the four `capability_key_map` deletions — `calendar.manage` and
`calendar.view` at club and team scope — recorded by the audit coverage the design requires on the
capability tables. Verified by querying the audit rows themselves, not inferred from the count. No
club, person, venue, plan, session or event row changed.
