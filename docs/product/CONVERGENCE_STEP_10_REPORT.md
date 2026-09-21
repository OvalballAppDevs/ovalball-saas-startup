# Convergence Step 10 — Team Experience

**OVALBALL CONVERGENCE STEP 10 — TEAM EXPERIENCE — IMPLEMENTATION COMPLETE —
BATCH A UAT PENDING.** Nothing released, nothing pushed, Step 11 not started.

Step 10 is certified by **targeted acceptance** under the batched convergence
cadence: an individual step proves itself, and the expensive whole-platform
certification runs once for Batch A (Steps 10–12) after Step 12, against a
frozen tree. This step is **not** fully release verified, production verified or
whole-platform accepted, and must not be described as any of those until Batch A
certification passes. What was run and what was deferred is in §7 and §8.

| | |
|---|---|
| Starting checkpoint | `8c2567f` |
| Archaeology | `docs/product/CONVERGENCE_STEP_10_ARCHAEOLOGY.md` |
| BEFORE/AFTER matrix | `docs/product/CONVERGENCE_STEP_10_FUNCTIONALITY_MATRIX.md` |
| FUNCTIONS BEFORE | **37** |
| FUNCTIONS AFTER | **46** |
| FUNCTIONS LOST | **0** |

---

## 1. What the Team page was, and what it is now

Measured, not remembered. At `8c2567f` the page rendered a back link, the team's
name, a settings form, a roster editor, a join code, a news link and a lifecycle
control. **That is an administration screen.** Of the questions a team page
exists to answer — what is next, results, training, availability, who the staff
are, where Match Centre belongs, and what am I to this team — it answered none.
A parent opening it could not tell from the page that they were a parent.

**Almost nothing needed building. Almost everything needed connecting.** Every
section added consumes a canonical source that already existed:

| what appeared | where it came from | new data |
|---|---|---|
| What's Next — fixtures and training together | `lib/agenda/load.ts`, the reader the Calendar and family agenda already use | none |
| Recent Results | the same reader | none |
| the availability answer | Step 9's control and server entry point, verbatim | none |
| the home side named first | Step 7's `fixtureSides` | none |
| Match Centre, and the way back | Step 7's fixture identity and return allowlist | one declared surface |
| the club crest | Step 6's resolver | none |
| who you are to the team | one new reader over four existing canonical tables | none |
| a cover photo | the bucket club news already uses | one column |

---

## 2. What Step 10 built

### 2.1 What you are to this team

`public.my_team_relationship(team)` returns **a list**, because one person is
often two or three things to one team — a coach who is also a parent of a child
in it is the most ordinary shape in grassroots rugby. Collapsing that into a
single "primary role" is exactly what the identity programme spent eight slices
not doing.

**A badge is presentation, never authority.** Nothing authorises off it; every
control still asks the capability engine independently. What it prevents is the
opposite error, and the tests prove each case: a **revoked** role stops being a
badge immediately (A6), removing one relationship leaves every other standing
(A7), a **suspended** membership cannot reach the team at all so no badge can
outlive it (A8), and reactivation brings it back because the role was never
deleted (A9).

A Parent/Guardian badge **names the child**, so a parent of two children in one
team sees two distinguishable badges rather than the same word twice.

### 2.2 What's next, and what just happened

Fixtures and training in one list from the canonical reader, with results
beneath. Presented by Step 7's rules — the home side is named first, training
has no opposition and is never given a fake one — and **only the fields the
agenda actually carries**: the match type is not on an agenda row, and promising
a field the data model does not have is how a team page starts lying quietly.

### 2.3 The answer, on the team's own row

Step 9's `AttendanceAnswer`, unchanged, wired to the same server entry point and
the same canonical record. Whose rows get one is decided by
`answerablePlayerIds` — the viewer's own player record and the children they are
guardian of — and **the server refuses everything else regardless**. A coach
reading this page gets no control for somebody else's child.

### 2.4 Coming back to the team

`RETURN_SURFACES` is Step 7's deliberate allowlist and it is the security
boundary, not a pattern. Step 10 declares **one** id-carrying surface: the
pathname must be `/teams` plus exactly one more segment, and that segment must
be a uuid. `/teams-evil/<uuid>`, `/teams/<uuid>/settings`, `/teams/<uuid>/..`,
`/teams/not-a-uuid` and a percent-encoded separator all resolve to `/fixtures`,
asserted one at a time.

### 2.5 A team cover photo

One column, reusing the bucket, the path shape and the storage policies club
news already has. **No new storage, no new pipeline, no new permission model**,
because Step 6 and the Club Digital Home built all three and a second copy of
any of them would be the defect. One deterministic fallback chain — the team's
cover, then the club's crest, then **nothing**, because a fabricated picture of
a team is worse than none.

---

## 3. The defect the browser journey found

**A guardian could not open their own child's team page.** `canView` required
the active context's club to equal the team's club, and a guardian in All
Children mode has **no active club by design** — a family view is deliberately
not scoped to one. Every parent was redirected to `/dashboard`.

The conjunct was the right instinct aimed at the wrong clause. The leak it was
written against was a **session-wide** one — "does this account hold club
authority anywhere" — and `team.team.view` is not that: the engine resolves it
at this team, inheriting from this team's club only, so a Club Admin of one club
still cannot see another's. The club scoping stays on `canManage`, which is the
club-wide authority it was about.

**No capability was added or widened.** `bundle_capabilities` already gave the
Parent/Guardian, Player, Coach and Team Manager bundles `team.team.view` at team
scope. The model was right; the page's gate was not.

---

## 4. Proof

### Server — `supabase/tests/step10_team_experience.sql`, 29 assertions, 0 failures

| section | what it establishes |
|---|---|
| **A** | a coach who is also a parent is **two** relationships; a badge is per team, not per club; a revoked role is not a badge; a suspended membership cannot reach the team at all; reactivation restores it |
| **B** | a badge is **not** authority — a parent badge confers no roster authority, a Coach badge confers no team-settings authority |
| **C** | **team IDOR** — another club's Club Admin cannot ask about this team, a coach cannot reach another club's team by naming it, a forged id is not found rather than leaked, and a parent sees their own child and never the other family's |
| **D** | **team staff do not become club administrators** — a coach may arrange a single fixture for their own team and may reach neither Import, Planner, bulk edit, competition creation nor permissions management |
| **E** | **a Site Admin inspecting a team does not join it** — they may inspect, hold no relationship to it, and are still not a club member afterwards |
| **F** | the cover photo needed no second media architecture |

### Browser — `50-team-home-journey`, 22 assertions, 0 failures

Staff and family over the **same team**: a Team Manager reaches it, sees what
they are to it and what is next, opens the canonical fixture, and **comes back
to the team rather than to a fixture list**; and cannot reach the Planner,
Import or competition creation from any of it. A guardian reaches the same team,
**is shown as a Parent/Guardian with the child named rather than as the
player**, answers on the team's own row into the same canonical record, and
after a reload sees the server's answer.

axe: **1 violation, 1 pre-existing and declared, 0 introduced** — the
application-shell unread badge, which is L22's and stays with its owner. No
horizontal overflow at 390 or 320, and the phone keeps What's Next rather than
hiding it.

### Clean boot from empty — PASS

Step 10's reader correct from empty, `step10_team_experience` **29/29** against a
fresh database, with guards that a badge cannot outlive a revoked role or a
suspended membership and that no second media architecture appeared.

---

## 5. L3 — remains OPEN, and the handoff's premise does not hold

§6 asked for the exact checked-in definition rather than a guess, and the guess
and the record disagree.

The ledger assigns L3's key half to **Slice 10**, and `Slice 10` in the
identity programme's own register is **Identity/Auth Slice 10 — Legacy
retirement**, not Convergence Step 10. They share a number and nothing else.
Its scope is dropping `club_memberships.role`, `role_capability_defaults`,
`team_permissions` and the rest of the compatibility surface, and its acceptance
condition reads:

> zero references in CI; full runner, clean boot and all browser suites green;
> **production usage telemetry zero for 30 days before each drop.**

Measured today: `club_memberships.role` holds **23 rows**,
`role_capability_defaults` holds **122**, and **103 files** still reference the
`FIXTURE_SECRETARY` spelling.

> **L3 — remains OPEN because its key half's acceptance condition requires
> thirty days of zero production usage telemetry before dropping
> `club_memberships.role` and `role_capability_defaults`, and Ovalball has
> released nothing. No code change in this step can satisfy it, and dropping
> those columns is Identity/Auth Slice 10's scope, not the Team product's.**

The label half stays closed. Nothing was silently carried: the disposition is
here, with the measurement and the owner.

---

## 6. LOCAL MIGRATION HISTORY DRIFT — a local-environment finding

Found while starting the local stack for Step 10 review. **It is an environment
finding, not a product finding and not a security finding**, and it changes
nothing about Step 10's code, schema or acceptance.

| | |
|---|---|
| History tip | **`20270430000000`** |
| Later migration files represented by current-schema objects | **21** (`20270501000000` … `20270521000000`) |
| Probed objects present | **59 / 59** |
| Probed objects absent | **0 / 59** |
| Failed forward replay | **rolled back** — no partial state |
| Persistent UAT data | **unaffected** — 118 `uat.*@ovalball.test` identities intact |
| Cause | **UNKNOWN** |

`supabase_migrations.schema_migrations` stops at `20270430000000`, while every
object the twenty-one later files create is present in the schema — including
`public.my_team_relationship` from Step 10's own migration. `supabase migration
up --local` therefore attempts to replay already-present work and stops on the
first file; that attempt **rolled back cleanly**, proved by the three functions
`20270502000000` redefines after `20270501000000` replaces them
(`claim_email_delivery`, `claim_disabled_email_suppression`,
`record_email_delivery_result`) all still carrying their `20270502` bodies.

**The `20270501000000` failure is expected and is not a defect.** Its embedded
check asserts that no browser-callable SECURITY DEFINER mutation escapes the
canonical session gate *at the point that migration runs*. `create_auth_flow_state`
is created two files later by `20270503000000`, so from empty it does not yet
exist and the check passes; replayed out of historical order against a schema
that already holds it, the check must fail. That function is a declared, narrow
and documented exception in `supabase/tests/definer_rpc_session_contract.sql` —
a signup has no session — with `consume_auth_flow_state` gated as the other half
of the pair. The historical check is correct as authored and is not weakened.

**Cause is recorded as UNKNOWN.** Applying the files by a route that does not
write migration history would produce exactly this state, but that is a
plausible mechanism and not established provenance, so it is not claimed.

### What was deliberately not done

No history was manufactured. `supabase migration repair` was not run, and
`supabase_migrations.schema_migrations` was not inserted into, updated or
deleted from. The persistent UAT database was not reset and its identities were
not recreated. No migration was edited to accommodate the drift.

**Object presence is not proof that a migration landed as authored.** Fifty-nine
present objects say nothing about grants, revocations, data transformations,
triggers, policies, indexes, constraints, function bodies or each file's own
invariants, so the probe evidences drift and does not license repair.

### The two questions stay separate

The authoritative migration-chain proof remains the **isolated clean boot**: a
genuinely fresh disposable database, the complete chain from the first migration
to the Step 10 tip in canonical order, the Step 10 fresh-database assertions,
then the disposable environment destroyed and the persistent UAT project left
untouched. That establishes **CHAIN FROM EMPTY = VALID**.

It does **not** establish **PERSISTENT LOCAL HISTORY = SAFE TO REPAIR**. That
second question is investigated separately and only after the chain is green, by
comparing the persistent schema against the clean-boot schema on the twenty-one
disputed migrations semantically — function definitions, tables, columns,
constraints, indexes, triggers, RLS policies, grants and revokes, views,
relevant backfills and each migration's self-checks — not by object name. Only
that evidence could support reporting **MIGRATION HISTORY REPAIR — SAFE TO
PERFORM** with the exact twenty-one versions, and repair stops for an explicit
decision even then. Any discrepancy is reported and history is **not** repaired
around it.

---

## 7. STEP 10 TARGETED ACCEPTANCE

Run today against the current local schema, which carries every Step 10 object.
This **replaces** the old handoff's requirement of a complete canonical gate for
this step; that gate moves to Batch A. Every figure below is from a run, and the
two suites of assertions Step 10 owns are named first.

### Step 10's own proof

| what | result |
|---|---|
| `step10_team_experience` (SQL) | **29 passed, 0 failed** |
| `50-team-home-journey` (browser, real Chromium) | **22 passed, 0 failed**, exit 0 |
| `team_cover` (TS) | **6 passed** |
| `fixture_return_context` (TS) | **15 passed** |

The browser journey walked **1440**, then **390** and **320**: no horizontal
overflow at either phone width, What's Next kept rather than hidden, axe **1
violation — 1 pre-existing and declared, 0 introduced** (the application-shell
unread badge, L22's), no uncaught page errors, and its own cleanup asserted.

### Migration-specific verification

`20270521000000` adds `public.my_team_relationship(uuid)` and one column,
`public.teams.cover_image_path`. Both are present and exercised. The new RPC is
**declared in `supabase/security/perimeter-manifest.json`** as `APPLICATION_RPC`
with its single consumer, and `security_perimeter_guard` passes (**6**). The
session-gate closure passes (`definer_rpc_session_contract`, **37**). Forward
behaviour is proven by the 29 SQL assertions and the browser journey above.

### Regression set — directly affected domains

| suite | result |
|---|---|
| `security_perimeter_guard` · `definer_rpc_session_contract` | 6 · 37 |
| `team_people_roster` · `roster_authority_matrix` | 16 · 55 |
| `step9_family_and_availability` (Step 9 family/availability) | 41 |
| `step8_operational_access` (Step 8 role/capability) | 69 |
| `family_authority_matrix` · `family_isolation_matrix` | 79 · 84 |
| `match_centre_core` · `match_centre_capabilities` · `calendar_match_centre_link` | 22 · 7 · 18 |
| `capability_scope_isolation` · `cross_club_isolation_matrix` (IDOR) | 22 · 87 |
| `fixture_availability_summary` · `fixture_attendance_invitations` | 12 · 16 |
| **every TypeScript suite** — 79 suites | **767 passed, 0 failed** |
| `49-family-availability-journey` (browser) | 25 passed, exit 0 |
| `52-roster-authority` (browser) | 17 passed, exit 0 |
| `53-fixture-authority` (browser) | 14 passed, exit 0 |

TypeScript `tsc --noEmit`: **clean**. Lint: **5 errors, all pre-existing in files
Step 10 does not touch** (`recovery-flow.tsx`, `club-step.tsx`,
`activity-card.tsx`, `messaging-panel.tsx`, `runner_exit_truth.test.mts`), plus
176 warnings at baseline. Static guards: **10 of 10 pass** —
`verify-one-team-catalogue`, `verify-legacy-invitation-token-readers`,
`verify-redemption-callers`, `verify-authority-guards`,
`verify-content-standard`, `verify-match-centre-shared`,
`verify-training-centre-shared`, `verify-browser-suite-registry`,
`verify-event-centre-shared`, `verify-fixture-bulk-authority`.

### One lint error was Step 10's, and is fixed

`app/(app)/teams/[teamId]/page.tsx` called `Date.now()` during render through a
hand-rolled `horizon(days)` helper — an impure call the React Compiler rule
rejects, and a **second** implementation of date arithmetic beside the canonical
one. It now uses `shiftDays` from `lib/agenda/window.ts`, the pure UTC helper the
Agenda page's own window already resolves through. That removes the impurity and
the duplicate, and fixes a latent day-boundary difference: the old helper did
local-time arithmetic before taking an ISO date, so near midnight its sixty-day
window could disagree with every other agenda window in the product.

---

## 8. Deferred to Batch A certification

Not run for this step, by the batched cadence, and **not** claimed:

- the complete unsplit canonical gate;
- the full-chain clean boot from empty across the whole migration chain;
- the production-shaped rehearsal from the actual production tip;
- cross-domain Team ↔ Match Centre ↔ Family ↔ Fixture ↔ Safeguarding proof;
- browser integration UAT across Steps 10–12 together;
- the accumulated deferred manual review checkpoint.

None of the early-escalation conditions were met: no foundational auth invariant
changed, no migration-order uncertainty arising from Step 10, no shared
fixture/family/team identity corruption, no unexplained regression attributable
to this step, no harness integrity problem and no security perimeter
uncertainty. Every failure found today is explained and predates Step 10 — §9.

**Preserved for the later rehearsal:** Step 10 contributes exactly one migration,
`20270521000000`, adding one function and one nullable column with no backfill
and no data transformation, so the accumulated Batch A sequence needs nothing
measured from this step beyond its position in canonical order.

---

## 9. Findings outside Step 10's scope — documented, not fixed

Recorded as risks for the product owner to schedule. None is caused by Step 10,
none was worked around, and **no row was deleted and no suite was edited** to
make anything pass.

### 9.1 Four SQL suites fail on the current schema, all predating Step 10

| suite | mechanism |
|---|---|
| `player_guardian_security` | seeds a team as `category='colts'` with a null gender; `teams_set_canonical_type` derives a non-null gender, and `teams_gender_category_check` recognises a gender only for `category` in (`senior`,`youth`), so the row is refused and the setup block aborts — 6 assertions then fail on absent data |
| `team_lifecycle` | seeds a U12-or-older team with no pathway; the "a team always carries its pathway" trigger refuses it |
| `capability_engine` | `insert … on conflict (id)` into `public.team_permissions`, which is now a compatibility **VIEW** and has no unique constraint; separately, three statements call definer RPCs with no session and are refused by the canonical session gate |
| `team_scoped_fixture_requests` | the same `team_permissions` view insert, then RLS refusals downstream of the missing setup |

Provenance, measured: the constraint and trigger come from migrations no later
than `20270112000000`, and the `team_permissions` view conversion from no later
than `20270422000000` — all **before** the twenty-one drifted migrations
(`20270501…`) and long before Step 10. Neither failing suite references
`my_team_relationship` or `cover_image_path`, and Step 10's only schema change is
one nullable column. The drift in §6 is **not** the cause.

### 9.2 105 of 284 SQL suite files are not run by the canonical gate

`scripts/run-platform-tests.sh` lists **180** suites; `supabase/tests/` holds
**284** `.sql` files. All four suites in §9.1 are among the **105** the gate does
not run, which is why they were free to go stale as the schema moved. There is no
declaration mechanism for a SQL suite that sits outside the gate —
`verify-browser-suite-registry.mjs` enforces exactly that for **browser** suites,
after Step 7 found twenty-seven nobody was running, and the SQL side has no
equivalent. This bears directly on what a Batch A canonical gate can be said to
prove, so it wants a decision before that certification, not after.

### 9.3 `46-family-authority` cannot run: pre-existing residue plus a cleanup order defect

The suite exits 1 with **0 assertions**, crashing inside its own `cleanupTag`:
`delete from public.teams where club_id = v_club` is refused by
`player_team_memberships_team_id_fkey`, because it deletes teams before the
memberships referencing them. The blocking rows — team
`664197e2-…7631ab4` ("Under 15 Boys") and one active membership — were created
**2026-09-20 21:58 UTC**, before this session, so this is residue from an earlier
run and not repeatable-by-construction. Left in place deliberately: deleting rows
by hand to get a green run is exactly how an isolation failure gets hidden.

Step 10's family boundary is not left unproven by it — the guardian half of
`50-team-home-journey` (B1–B6), `family_authority_matrix` (79) and
`family_isolation_matrix` (84) all pass.

### 9.4 A suite with zero assertions currently reports `ok`

`team_conversation_activation` produced **0 passed, 0 failed** and the gate's
classifier reports that as `ok`. A suite that asserts nothing is not evidence,
and it reads identically to one that does.
