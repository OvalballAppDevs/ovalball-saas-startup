# Convergence Step 9 — Parent / Player / Family

**TECHNICAL STATUS: READY FOR PRODUCT REVIEW.** Nothing released. Step 10 not
started.

| | |
|---|---|
| Starting checkpoint | `c06dd1a` |
| Archaeology | `docs/product/CONVERGENCE_STEP_9_ARCHAEOLOGY.md` |
| BEFORE/AFTER matrix | `docs/product/CONVERGENCE_STEP_9_FUNCTIONALITY_MATRIX.md` |
| FUNCTIONS BEFORE | **66** |
| FUNCTIONS AFTER | **70** |
| FUNCTIONS LOST | **0** |

---

## 1. What archaeology changed about the step

The handoff could be read as "build the parent response experience". The
repository says otherwise, and the repository is authoritative.

**The whole availability model already existed.**
`public.player_fixture_attendance` carries `fixture_id`, `training_session_id`
**and** `event_id` — one canonical record for fixtures, training and club
events. Three canonical writers exist and all three already had UI callers. The
states are `ATTENDING`, `CANNOT_ATTEND`, `UNSURE`, and **no row at all** for
"not answered yet". And who may answer is decided in exactly one place:

```
internal.resolve_attendance_response_source(player)
  active guardian                  -> 'guardian'
  the player, 18+                  -> 'player'
  the player, 16 or 17             -> 'player', ONLY with recorded guardian consent
  the player, under 16             -> refused
  anybody else, incl. their Coach  -> refused
```

So Step 9 built **no availability system, no second state, no second table and
no new authority.** §16's warning against `availability_v2` was already
satisfied by the schema; §22's question about training was answered by it.

What was missing was narrower, and more embarrassing: **the answer was always
one navigation away.** The agenda counted what was outstanding, said "N
activities need your response", and then told the parent, in its own copy,
*"Open a fixture to change whether you can make it."*

---

## 2. What Step 9 built

### 2.1 The answer, on the row

One reusable control (`components/fixtures/agenda/attendance-answer.tsx`) and
one server entry point (`app/(app)/agenda/respond-actions.ts`), calling the
canonical actions that already owned the writes.

- **Three buttons, always all three, always in the same order.** A parent
  answering four things on a Tuesday evening is recognising shapes, not reading.
- **No optimism.** The button shows what the *server* accepted. An answer the
  database refuses — a sixteen year old without recorded consent, a player who
  left the team — leaves the previous answer standing and says why. A control
  that flipped first and reconciled later would tell a parent their child is
  expected at a match nobody has been told about.
- **State is never carried by colour alone**: `aria-pressed`, a fill, and a
  tick.
- **Each control names whose rugby it is about**, because a page of them would
  otherwise announce "Can Attend" eight times. Measured: 12 distinct accessible
  names out of 12 controls.

When it is offered is its own small, tested rule
(`components/fixtures/agenda/answerable.ts`, 8 assertions): only for a row about
a named player, only for rugby that has not happened, and never for a fixture
that is cancelled, postponed or abandoned. **It invents no deadline** — the
canonical rules carry none, and adding one in a component would be a product
decision made in the wrong place.

### 2.2 A player is not a parent of themselves

`team_permissions.view_only` is the Slice 2 compatibility path and was used for
**both** parents and players before the canonical relationships existed. The
context builder turned every surviving `view_only` row into a `kind: "parent"`
context, deduping against guardian relationships but **not** against the
viewer's own linked player teams — so a linked player was offered a context
captioned "Parent / Player (view only)" that framed their own rugby as somebody
else's child.

**This is Step 0's recorded "player-shown-as-Parent/Guardian" defect.** One
condition removes the duplicate;
`identity_and_context.test.mts` 4f proves the player no longer gets it and **4g
proves an unmigrated parent still does** — the duplicate went, the relationship
did not.

### 2.3 The adult transition — the rule, the state, and the adult's own decision

Archaeology found that at eighteen **nothing happened, and the adult could do
nothing about it.** `internal.player_contact_eligibility` returns every active
guardian regardless of age, and so does the attendance resolver. And the remedy
did not exist: `remove_guardian_relationship` requires
`family.relationship.remove` **at the club**, a staff capability, so the one
person whose data it is could not act.

Step 9 adds two objects and **no automation**:

**`public.player_adult_transition(player, as_of)`** — a read, taking the date as
a parameter so the rule is provable at the boundary without waiting for a
birthday. Five states: `MINOR`, `APPROACHING_ADULT` (within 90 days),
`ADULT_WITH_GUARDIAN_ACCESS`, `ADULT`, `UNKNOWN`. A player with no date of birth
has not secretly turned eighteen, and `UNKNOWN` says so.

**`public.end_my_guardian_access(relationship, reason)`** — the adult player
alone, ending one guardian's access to their own record. It uses the canonical
age predicate rather than a second age calculator, requires an adult, refuses
anybody who is not the player the relationship is about, revokes **with a
reason rather than deleting** (a family fact survives a birthday), and emits
`guardian.unlinked` on the canonical audit trail.

It does none of the things the instruction forbids: no guardian is deleted, no
ownership transferred, no permission silently changed, no family record
disconnected.

| | |
|---|---|
| **STEP 9 RULE — COMPLETE** | the state, the boundary, the adult's decision, all deterministic and audited |
| **DEFERRED EXECUTION MECHANISM** | noticing a birthday *on the day* and telling the people involved needs a scheduler, and **Ovalball has no background-processing owner yet**. The state above is exactly what such a scheduler would read. Named, not omitted. |

---

## 3. The defect Step 9's own tests found in Step 9's own code

`v_user = internal.actor()`, where `v_user` is a player's nullable `user_id`,
yields NULL. `false or NULL or false` is NULL, and `if not (NULL)` **does not
fire** — so every unrelated caller would have been allowed to ask about a child
with no account. Three-valued logic in an authority check fails **open**, which
is the one direction it must never fail.

Caught by C6 and C7 before it shipped, fixed with
`v_user is not null and v_user = internal.actor()`, and the shape is now
asserted in the clean-boot proof so it cannot come back.

---

## 4. Proof

### Server — `supabase/tests/step9_family_and_availability.sql`, 41 assertions, 0 failures

| section | what it establishes |
|---|---|
| **A** | who may answer: a guardian may; an unrelated person may not; **the team's own Coach may not**; an adult player may for themselves; a seventeen year old may not without recorded consent; one player may not answer for another; an invented status is refused |
| **B** | **one truth per player and fixture** — the second guardian answering replaces the answer rather than adding one, the latest answer stands, and the author and their entitlement are both recorded; a family may change its mind repeatedly |
| **C** | the adult boundary **at** the boundary: minor the day before, eighteen on the day, `ADULT_WITH_GUARDIAN_ACCESS` after; a Coach and a stranger are both refused the question entirely |
| **D** | the adult's decision, and **nothing else moving**: their player record, account, team placement, club membership, the same guardian's other relationships and their own availability answer all survive; the decision is on the audit trail; the ended guardian can no longer answer for them |
| **E** | **family IDOR both ways** — naming another family's player id, or the other guardian's relationship id, changes nothing, and neither family can read the other's answers |
| **F** | a family relationship confers **no** fixture, permission or role authority |

### Browser — `49-family-availability-journey`, 25 assertions, 0 failures

The §63 and §64 journeys in one, as a guardian with two children on two teams:

- an ordinary sign-in lands on `/dashboard` with **no role-specific routing**,
  and the canonical resolver produces a family context with both children;
- the answer is offered **on the row**, not behind a navigation;
- it reaches the canonical record as `guardian`, with the author recorded;
- **after a reload the server's answer is what is shown** (`aria-pressed=true`);
- one child's answer is independent of the other's, in both directions;
- Match Centre is the same canonical fixture and **opening it neither duplicates
  nor disturbs** the answer — one record, whichever surface reached it;
- **F1, the Step 7 → Step 9 integration proof:** an authorised operational
  viewer's `fixture_availability_summary` reads **"1 of 3"** because a parent
  pressed a button in a browser. The display Step 7 built and the response Step
  9 owns are the same record.
- axe: **0 violations, none pre-existing, none introduced**; no horizontal
  overflow at 390 or 320; the answer stays a 44px target at both.

### One accessibility defect, introduced and caught in the same hour

The first version of the control used `bg-pitch-600 text-white` for the chosen
answer. Suite 49's axe run failed it: that pair measures ~3.1:1, which is L22's
exact defect, on a control a parent taps every week. `app/globals.css` already
records the measurement and the decision — dark ink on the brand green clears
6:1 — so the control now uses it.

### Clean boot from empty — PASS

The full migration chain, Step 9's objects, and `step9_family_and_availability`
**41/41 against a fresh database**. The guard also asserts the null-comparison
shape from §3 so the fail-open cannot return.

---

## 5. Original-backlog disposition

| item | disposition |
|---|---|
| **Family bugs** | **partly COMPLETE, partly DEFERRED with names** — see the table below. Nothing disappears under the phrase. |
| Additional parents / guardians | **ALREADY COMPLETE — VERIFIED.** `request_additional_guardian` + `respond_to_additional_guardian_request`; H-4 records that a guardian cannot self-approve. Step 9 verified rather than rebuilt. |
| Parent/Guardian role vs relationship | **ALREADY COMPLETE — VERIFIED.** It is a relationship in `public.guardians`, never a role, and §F of the SQL suite proves it confers no authority. |
| Player identity / account | **ALREADY COMPLETE — VERIFIED.** `issue_invitation(PLAYER_ACCOUNT, p_player_id)` binds to the player record; the Phase 0 unbound invitation is not reachable. |
| Player join flow · parent join flow · team codes | **ALREADY COMPLETE — VERIFIED** (Slice 5 / Step 3). Reused, not redesigned. |
| Multiple children | **COMPLETE** — proved end to end in suite 49, including that one child's answer does not leak into the other's. |
| Multiple clubs | **ALREADY COMPLETE — VERIFIED** by the canonical context model; not re-proved in a browser because the automated UAT world has no two-club family, and fabricating one would be inventing review data. |
| **Age-18 handover** | **RULE COMPLETE; EXECUTION MECHANISM DEFERRED** to a background-processing owner that does not yet exist. State, boundary, audit and the adult's own decision all shipped. |
| Availability Can Attend / Can't Attend / Maybe | **COMPLETE** — on the row, canonical states, canonical writer. |
| Availability counts integration | **COMPLETE** — suite 49 F1. |
| QR sharing | **ALREADY COMPLETE — VERIFIED.** Step 3 established QR over the canonical invitation mechanism; the family journey reuses team join codes and needs no second QR system. |
| Calendar family visibility | **ALREADY COMPLETE — VERIFIED** (Step 7), with the family agenda now answerable. |
| Match Centre family journey | **COMPLETE** — same canonical fixture, same record, safe return. |
| Privacy / safeguarding boundary | **COMPLETE for what Step 9 touched**; the wider safeguarding surface is untouched and stays with its owner. |

### The named family defects from Step 0

| defect | disposition |
|---|---|
| **player-shown-as-Parent/Guardian** | **FIXED** — §2.2, with a regression proving the parent case still works |
| **child→adult handover** | **RULE FIXED, scheduler DEFERRED** — §2.3 |
| **additional-parent workflow** | **ALREADY FIXED — VERIFIED** (H-4) |
| **child identity showing the wrong person** | **ALREADY FIXED — VERIFIED.** `lib/app-context/identity-display.ts` distinguishes the signed-in person from a child context explicitly and has its own verification file; `parent_player_identity.test.mts` passes 9/9. |
| **Add Child inconsistency** | **DEFERRED — family-domain reconciliation.** Step 9 could not reproduce it: `add_child_for_guardian` behaves correctly in the SQL estate, and the browser suite that covers it (`46-family-authority`) is **not independently repeatable** — see L25 below. Fixing a suite that cannot be trusted twice is not evidence, so this is recorded with its measurement rather than claimed. |

---

## 6. L25 — the Step 9 pass

| | |
|---|---:|
| L25 BEFORE STEP 9 | **26** |
| STEP-9-OWNED DISPOSITIONED | **0** |
| L25 REMAINING | **26** |

**Zero, honestly.** The one suite squarely in Step 9's domain,
`46-family-authority`, was run twice:

- first run: **13 of 14**, with F1 (a Site Admin seeing a person's family
  relationships) failing on HTTP 200;
- second run of the *same unchanged suite*: **2 of 4**, failing at A2 with "no
  player", because the first run's teardown had not completed.

A suite whose failure mode changes between runs cannot be wired into a gate —
that is the isolation rule every fixture-operations suite adopted in Step 7.
Worse, **its identities cannot be removed at all**: they are referenced by
`public.audit_log`, which `internal.refuse_history_rewrite()` correctly makes
append-only. Step 9 removed their memberships and guardian relationships so they
confer nothing, and left the rows, because deleting audit history to tidy a test
would break a platform invariant to fix a test-hygiene problem.

Both measurements are in `scripts/browser-verification/suite-registry.json`. No
suite was registered without being run, and none was mass-registered.

---

## 7. L26 — still open, and deliberately not widened

Step 9 exercised invitations heavily and **did not touch the invitation test
fixture architecture**, so L26 stays exactly as it was. No broad sweep by email,
marker, invitation type or status was added anywhere.

## 8. What Step 9 did not do

- **No second family model, availability system, state, table or authority.**
- **No messaging redesign**, no notification infrastructure #2, no QR system #2.
- **L7's compatibility bridge untouched** — `accept_invitation` and
  `get_invitation_preview` remain.
- **L11, L15, L22, L23, S7-13 and L3's key half** left with their own owners.
- **Team surfaces unchanged** — Step 10 owns the Team product, and the answer
  control was built to be reusable by it rather than as a competing experience.
- **The persistent review world untouched.**

---

## 9. The targeted pre-gate, and the two defects the canonical gate still found

§58's cheap pre-gate ran first and was **fully green**: TypeScript clean, four
guards passing, 8 SQL suites (341 assertions), 9 JS suites (97 assertions), the
two changed browser suites (56 assertions), and the clean boot from empty.

The canonical gate still found two things, and both were **harness races, not
product defects**. Each was root-caused rather than accepted, per §47.

### `34-planner-away-ground-request` — a cache defeating the retry that exists for it

**CRASH**, exited 1 after 7 assertions, `TimeoutError` navigating to
`/account`. It passed **12/12 alone**, and memory was measured at **4.6 GB free
at that moment**, so it was neither a product failure nor the machine.

Root cause: `signIn` has a three-attempt retry precisely because signing in is
flaky. But it first calls `tryCachedSession`, which probes `/account` to check
whether a cached cookie jar still belongs to the right address — and that
navigation sat **outside any try/catch, before the retry loop**. One slow route
threw straight out of `signIn`, past all three attempts.

**A cache may never be the thing that fails a run.** The probe's failure now
means only "no usable cached session", and the full sign-in that follows proves
the identity for real. Asserted structurally in
`supabase/tests/js/runner_exit_truth.test.mts`.

### `76-branding-propagation` — reading an image before it existed

**FAIL** on S6BR-01, *"(no club crest rendered)"*, about a page that renders the
crest perfectly well: **14/14 alone**.

Root cause: `crestPathsOn` sampled `img` elements the instant `networkidle`
resolved, and a Next image is not wired up at that moment — `currentSrc` is
empty until it begins loading. Under a loaded gate the page won every time
except once. The same lesson Step 7 learned from suite 78 reading a URL before
the router had pushed it: **assert on a condition, not on a moment.**

The reader now waits, bounded, for a club-logo image to be attached, and
swallows that timeout on purpose so a surface that genuinely shows no crest can
still say so. Proved twice consecutively before the gate was restarted.

### Process

Each cycle was: finish the run, root-cause, fix, rerun the targeted pre-gate,
re-freeze, restart the canonical gate **from the beginning**. No result was
assembled from groups, and no partial run was cited as evidence.

---

## 10. The acceptance gate — one stable tree, one complete run, unsplit

```
6572 passed, 0 failed across 257 suites.
GATE EXIT 0
```

| required | result |
|---|---|
| 0 FAIL | **0** |
| 0 KILL | **0** |
| 0 CRASH | **0** |
| 0 EMPTY | **0** |
| 0 missing required suites | **0** — the registry guard proves it every run |
| browser suites | **50 of 50**, 1,235 assertions |

Measured across the batch at 50 checkpoints: available memory never fell below
**2,379 MB**, and **zero browser processes survived between suites** at every
one.

Step 9's own evidence inside that run: `step9_family_and_availability` **41
passed**, `49-family-availability-journey` **25 passed**.

---

## 11. Deferred manual review checkpoint

Manual Chrome review remains deferred. Isolated browser UAT was mandatory and
was done. **The review world is exactly as Step 8 left it**: Priya's
Safeguarding Officer nomination is still `PENDING_CONFIRMATION`, the six Step 7
fixtures are there, and `step2-review-club.mjs verify` reports the same three
differences from the review administrator's own 2026-09-18 session. Nothing was
repaired, and no persona was mutated to make a test pass.

```
node scripts/review-fixtures/step2-review-club.mjs report
node scripts/review-fixtures/step2-review-club.mjs verify    # prints differences, fixes nothing
```

| as | where | what is new |
|---|---|---|
| **Marta Ferreira** (guardian of Leo) | `/dashboard` → `/agenda` | **the answer is on the row.** Three buttons, no navigation. Press one, reload, and see the server's answer — not an optimistic one |
| | same | the **Waiting for your response** caption under anything unanswered, and the count on the dashboard moving as you answer |
| | `/fixtures/<id>` | Match Centre is the same record: opening it neither duplicates nor disturbs what you just said |
| **Hannah Whitmore** (Club Admin) | `/admin/fixtures` | the availability summary moves because a parent pressed a button. This is the Step 7 ↔ Step 9 join, and it is the single most worthwhile thing to look at |
| **a player with their own account** | `/agenda` | their own rugby, answered as themselves — and no "Parent / Guardian" framing of it, which is the defect Step 0 recorded |

Worth trying deliberately, at 390px: answer for one child, switch to the other,
and check that nothing from the first child's context followed you.

**Nothing new was added to the review world.** Step 9 needed no shape it did not
already have, and inventing a second guardian or a nearly-eighteen player purely
to demonstrate a feature would be fabricating review data.
