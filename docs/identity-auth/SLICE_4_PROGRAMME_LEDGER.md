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
