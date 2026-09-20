# Convergence Step 7 — closure and programme carry-forward

Step 7 itself is banked at `58182c7`. This document is the closure pass: the
harness and reporting work that had to happen **before** Step 7 could be called
accepted, the measured evidence behind it, and the ledgers the programme carries
forward.

Nothing here changes product behaviour. Every change in this pass is to the test
harness, the release runner, or the written record.

---

## 1. Why the gate exhausted the machine — measured, not assumed

The instruction was explicit: investigate rather than assume, and do not
optimise on guesswork. So the first thing done was measurement, and the first
thing measurement did was kill the obvious theory.

### What the machine actually looked like

| | |
|---|---|
| physical memory | 16,384 MB |
| genuinely available at rest | ~2,500 MB |
| swap in use **before anything of ours ran** | 17,243 / 18,432 MB — **94%** |

The ambient consumers, at rest, with no gate running: the Docker VM that hosts
Supabase (1.18 GB), Google Chrome (1.1 GB), Claude (0.85 GB), the `claude` CLI
(0.43 GB), VS Code (0.36 GB), Microsoft's helpers (0.34 GB), Adobe's (0.23 GB).

`os.freemem()` is not the number that matters on macOS — it reports only the
free list and ignores the inactive pages the kernel hands back on demand, so it
reads catastrophically low on a machine that is coping. `vm_stat`'s free +
inactive + speculative is what a process can actually expect to get, and that is
what `scripts/browser-verification/resource.mjs` reads.

### The theory that was wrong

The suspicion in the letter was that the gate loads or retains all UAT personas
or browser contexts concurrently. Two parts of that turned out to be false and
one turned out to be true, and the difference matters:

- **No browser leak between suites.** Zero orphaned Playwright processes were
  found at rest, repeatedly. Suites do not leave browsers running.
- **No accidental parallelism.** The harness is bespoke `playwright-core`
  scripts, not Playwright Test. There are no workers. `run-platform-tests.sh`
  runs each suite as its own `node` process, sequentially, and every suite calls
  `launch()` exactly once.
- **But contexts inside a suite did coexist for no reason.** Thirty-one of the
  forty-four suites had no `finally`, and many opened a second, third or fourth
  persona context while the earlier ones were still alive with nothing left to
  ask them.

### The measurement that decided it

Two suites were sampled at three-second intervals while they ran, for peak
browser process count and peak aggregate RSS:

| suite | contexts created | held open | peak procs | peak browser RSS |
|---|---|---|---|---|
| `31-competition-creator` | 4 | **4** | 12 | **1351 MB** |
| `65-session-boundary-and-signup-challenge` | 5 | ≤1 | 10 | **891 MB** |

Suite 65 creates **more** contexts than suite 31 and peaks **460 MB lower**,
because it disposes each one when it is finished with it. That is the whole
finding, and it is a measurement rather than an inference.

After disposing suite 31's four personas in sequence:

| `31-competition-creator` (after) | 4 | ≤2 | 10 | **975 MB** |
|---|---|---|---|---|

All thirty-nine of its assertions unchanged, all still passing.

### What was NOT done

Product operations were **not** serialised to save memory. Every test that needs
two actors at once still has two actors at once:

- `10-fixture-opposition` — A sends a message, B's unread badge must increment.
  Both stay alive. That is the product behaviour under test.
- `14-training-cancellation` — staff cancel, the recipient must be notified in
  their own live session. Both stay alive.
- `31-competition-creator` — the organiser must see the consequence of Preston's
  change request **in the session that issued the match**. Those two stay alive
  together for exactly that exchange, and are disposed immediately after it.
- `64-password-recovery-journey` — already disciplined; it keeps two alive only
  for its genuine two-actor test.

What was removed is infrastructure concurrency that no assertion depended on: a
signed-out visitor kept alive through a club admin's work, a 390px viewport kept
alive through an accessibility sweep, a Team Manager refusal kept alive to the
end of a run.

**Suites changed:** 16, 18, 19, 22, 30, 31, 38, 68, 69, 74, 77, 78.
Every one re-run individually afterwards: **361 assertions, 0 failures.**

### The rest of the resource model, checked rather than assumed

The letter asked about several other candidates. Each was looked at, and each
was measured after the accepted full batch rather than reasoned about:

| candidate | finding |
|---|---|
| traces, videos, HAR files | **none.** No suite calls `recordVideo`, `tracing.start` or `recordHar`. Nothing is retained per test. |
| screenshots | **not accumulating.** Seven files, 696 KB total, in `.screenshots`, written by fixed name and overwritten each run. |
| globalSetup / globalTeardown | **does not exist.** These are bespoke scripts, not Playwright Test; there is no global phase to leak from. |
| repeated production builds | **none.** `70-production-csp` deliberately builds nothing — it starts the production server against the existing build and stops it, so the policy under test is the real one. |
| orphan processes after the batch | **zero** `browser-verification` node processes and **zero** `ms-playwright` processes survived the run. No stray `next start`. |
| Docker | one Supabase stack, up throughout, unchanged by the gate. |

---

---

## 2. Telemetry that names which of six things happened

`scripts/browser-verification/resource.mjs` exists so that a partial log is
never again uninterpretable. It distinguishes:

| | |
|---|---|
| application failure | an assertion about the product was false |
| test failure | an assertion about the product was wrong |
| browser crash | the browser went away mid-suite |
| **OOM kill** | the kernel stopped the process; nothing failed |
| resource leak | each suite leaves more behind than it took |
| already exhausted | the machine had nothing to give before we started |

It is deliberately small: two shell reads and an aggregate, taken at checkpoints
a person chose. No sampler, no time series, no dependency. This is not a
monitoring project.

The runner now prints, before the first browser suite:

```
  RESOURCE PREFLIGHT  2553MB available of 16384MB, swap 17536/18432MB, 0 browser proc (0MB), 1 suite proc (45MB)
  RESOURCE PREFLIGHT — UNSUITABLE FOR CLEAN FULL BATCH
        swap is 95% used before the gate starts
        The gate will still run. A kill or a stall from here is the
        machine, not the product -- free memory and run it again before
        reading a partial result as a failure.
```

**The gate is never silently skipped and green is never fabricated.** The
preflight reports; it does not refuse. A gate that declined to run would be
worse than one that runs badly, because the result would be uninterpretable in
the other direction.

### The threshold was recalibrated from measurement

`MINIMUM_AVAILABLE_MB` was first set to 800 from a guess that a suite costs
400–700 MB. The measurements above say 891–1351 MB. **800 MB was a threshold a
machine could pass and still be killed**, so it is now 1200 MB: one suite's
measured peak plus the node process that runs it.

---

## 3. A crash in suite N no longer poisons suite N+1

Three things, at three levels:

**In the harness.** `launch()` now registers the browser it opened and installs
a one-time crash guard for `uncaughtException`, `unhandledRejection`, `SIGINT`
and `SIGTERM`. Thirty-one suites have no `finally`; rather than ask forty-four
scripts to remember, the thing that opens the browser is the thing that
guarantees it closes. The guard does not swallow the error — the suite still
fails loudly with its own stack. What changes is that it stops costing the run a
browser.

**In the runner.** After every suite, any surviving `ms-playwright` process is
swept. Only this gate's own browser build is ever touched; a browser a person is
using is never a candidate.

**In the reporting.** The runner captured each suite's output and never its exit
status, so a suite killed by the kernel after recording twenty passes printed
`ok`. It now distinguishes:

- `KILL` — exit 137. Named as an OOM kill, counted separately from `FAIL`, and
  printed with the resource reading at the moment it happened.
- `CRASH` — exited non-zero having recorded only passes. The suite did not
  finish; that is not a clean run and must never print `ok`.
- `FAIL` — an assertion about the product was false.

---

## 4. A numbered suite cannot silently exist outside the gate

Step 7 found twenty-seven permanent fixture-operations suites that were in no
runner, twelve of them failing. The obvious fix — "remember to add it to the
runner too" — is the fix that had already failed twenty-seven times, because it
asks a person to keep two lists in step from memory.

So there is **one** list: `BROWSER_SUITES` in `scripts/run-platform-tests.sh`.
`scripts/verify-browser-suite-registry.mjs` reads it from the runner itself
rather than copying it, and requires every numbered file in
`scripts/browser-verification/` to be either in that list or **declared** in
`scripts/browser-verification/suite-registry.json` with a reason long enough for
the next reader to act on. It also fails on a suite listed but missing from
disk, a suite both run and declared exempt, and a declaration that outlived its
file. It runs as part of the gate.

Running it for the first time found **thirty-one further numbered suites outside
the runner** — inherited from the messaging, release-smoke and identity
programmes. Every one is now declared, honestly, as **NOT YET RECONCILED /
UNVERIFIED** against the current schema, and carried as **L25**. Wiring an
unverified suite into the gate would make the gate's colour mean less, not more;
declaring it names the debt and puts a tripwire under the thirty-second.

---

## 5. One way to reach axe, and no absolute paths

Eight suites each found their own way to `axe-core` — five spellings across
`fs.readFileSync`, `new URL`, `readFileSync`, `createRequire` and
`require.resolve`. One suite carried, in its own header comment, the record of
an absolute path into a generated job directory that no longer exists: the
accessibility check it performed had silently stopped being performed.

There is now one `axeSource()` in the harness, resolving through
`import.meta.resolve`, and all eight call sites use it. The registry guard fails
the gate if a suite resolves axe any other way.

The same guard rejects **any** absolute path in a browser suite. Running it the
first time found two: `03-u18-bypass` and `08-announcement-realtime` imported
`@supabase/supabase-js` by absolute path into one machine's checkout. Both now
use the bare specifier. Carried as **L27**.

---

## 6. A suite that cleaned up everything except what it could not see

`69-invitations-and-joining` issues a team join code, asserts it can be revoked,
and revokes it. Its teardown then swept invitations by
`invited_email_normalised like '<its own prefix>'` — and **a team join code has
no invited email**, so the sweep never reached one. Revoking was the security
property under test; deleting the row was the suite cleaning up after itself,
and the two are not the same obligation.

Twenty-two `REVOKED` `TEAM_JOIN_CODE` rows had accumulated on the automated UAT
club, one per run. The suite now writes a marker on anything it issues without
an email address and sweeps by that marker. Carried as **L26**.

---

## 7. The manual review world — reported, not repaired

The canonical review club (`step2-review-rfc`) is carried forward unchanged. No
Step 7 review club was created; the world is enriched through canonical product
writes, never rebuilt.

`step2-review-club.mjs verify` reports three differences from the state `up`
builds. All three are one continuous session on **2026-09-18**, by
`review.step2.admin@ovalball.test` — the review Club Admin's own account —
through the product's own transitions:

| what changed | when | by |
|---|---|---|
| a club join request from `review.step2.applicant@ovalball.test` (`BASIC_USER`) approved | 16:20:51 | `review.step2.admin@ovalball.test` |
| a player join request for **Mina** approved and placed in **Under 14 Girls** | 16:21:10 | `review.step2.admin@ovalball.test` |
| a second waiting invitation issued — a `TEAM_JOIN_CODE` | 16:26:44 | `review.step2.admin@ovalball.test` |

**This is user review drift and it is reported, not repaired.** Approving a join
request is what reviewing the product looks like. Nothing was put back. The
baseline in `step2-review-club.mjs` is also left alone, because moving it would
erase the evidence that a real person used the product.

No permanent automated test depends on this world. Every suite seeds and cleans
its own fixtures under its own tag prefix; the review world is never destroyed
or reseeded to make a test pass.

---

## 8. The acceptance proof — one run, unsplit

The whole gate, in one invocation, not split into groups:

```
6256 passed, 0 failed across 252 suites.
GATE EXIT 0
```

| required | result |
|---|---|
| all 44 browser suites | **44 run, 44 ok** — 1,061 browser assertions |
| 0 unexpected failures | **0 FAIL** |
| 0 OOM kills | **0 KILL** |
| 0 missing suites | **0** — and the registry guard now proves the runner list and the directory agree, on every run |
| crashes | **0 CRASH** |

The batch had been killed by the kernel three times before this pass. This time
the preflight recorded the machine as unsuitable — swap 95% used before the
first suite — and the run completed anyway, because the thing that had been
consuming the memory was the harness, not the machine.

**Measured across the whole batch, at 45 checkpoints:**

- available memory never fell below **2,442 MB**, and ended higher than it
  started (2,442–3,137 MB, against 2,510 MB at rest before the run);
- **0 browser processes survived between suites** at every single checkpoint.
  The orphan sweep never had anything to sweep, which is the result that says
  the disposal work — not the sweep — is what fixed it.

Two accessibility `NOTE`s are printed, both **declared pre-existing** and both
reported rather than hidden: the application-shell unread badge (L22, belongs to
whichever step owns the shell) and one `.opacity-45` caption on club setup step
1. Neither is new and neither is suppressed.

---

## 9. Step 7 — TECHNICALLY ACCEPTED

Step 7 is recorded **TECHNICALLY ACCEPTED** at `58182c7`, on the evidence above.

The closure changes in this pass are harness, runner and record only, and are
banked separately from Step 7 itself so that the product commit and the
evidence-machinery commit can be read apart.

**Nothing has been released.**

---

## 10. Manual review checkpoints — accumulating, not replacing

The product owner reviews by hand, in Chrome, against the local stack, as the
persistent personas. Checkpoints accumulate across steps: a later one does not
retire an earlier one, because the point of a persistent review world is that
the same people and the same club can be looked at again.

| step | what is reviewable, and where it is written |
|---|---|
| Step 2 | Navigation, users and permissions — `docs/product/STEP_2_MANUAL_REVIEW_WALKTHROUGH.md`, the one place persona identities and local sign-in are written down |
| Step 6 | Club ground, club notes privacy, Site Admin master control — `docs/product/CONVERGENCE_STEP_6_REPORT.md` |
| Step 7 | Fixture Control Centre with its period stepper, match type, venue and pitch; Fixture Search; the Calendar's team filter; Match Centre and its return path; Pitch Allocation with two bookings on one morning; the away fixture reading "Opposition v Under 12 Boys" — `docs/product/CONVERGENCE_STEP_7_REPORT.md` §35 |
| Step 7 closure | Nothing new to review. This pass changed no product surface. The review world is exactly as Step 7 left it, plus the owner's own 2026-09-18 session recorded in §7 above |

```
node scripts/review-fixtures/step2-review-club.mjs report     # what is there
node scripts/review-fixtures/step2-review-club.mjs verify     # what differs, and nothing is changed
```

`verify` prints differences and fixes nothing, by design. The rule it enforces
was learned by breaking it: four Coach assignments were once removed as though
they were drift from a stray test, and the timestamps later lined up with a real
session in the review Club Admin's own account.

---

## 11. What this pass did not do

- No product code changed.
- Nothing was released.
- Step 8 was not started.
- No production write of any kind.
- No intentional product concurrency was removed.
- The review world was not modified, reseeded or repaired.
