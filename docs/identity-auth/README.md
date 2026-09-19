# Identity, Authentication & Authorization Programme

Release records for the identity/auth programme. These documents are
**historical records of work that has happened** — they are not re-written when
presentation improves, and a released slice's report is not edited after the
fact.

Three documents here are the exception, because they are living rather than
historical: this index, `SLICE_4_PROGRAMME_LEDGER.md` (appended to, never
rewritten) and `IDENTITY_AUTH_DECISION_RECORD.md`.

## Decisions

| Document | What it is |
|---|---|
| `IDENTITY_AUTH_DECISION_RECORD.md` | **The locked decisions, in one place** — D-S4-1 to D-S4-4, D-S5-1, and the delegated D-S5-AUTO-1 to D-S5-AUTO-11. Referenced by number throughout the release reports |
| `SECURITY_FOLLOW_UP_unverifiable_age.md` | The technical record of the unverifiable-age finding, raised at 4B and carried to the Slice 4 boundary. Owner now assigned: Slice 5, by D-S5-1 |
| `DECISION_REQUIRED_unknown_age_before_slice_5.md` | The four options that decision was chosen from, kept as the record of what was weighed |

## Slice 4A — Family and Players

Released and production verified on 15 September 2026.

| Document | What it is |
|---|---|
| `SLICE_4_PLAN.md` | Contract extraction and plan for the whole of Slice 4, including the 4b–4i work package map (§2) and the Slice 4A closure brief (§11) |
| `SLICE_4_IMPLEMENTATION_REPORT.md` | Implementation report for sub-slice 4a plus the shared Slice 4 harness, at the point it was declared ready for release |
| `SLICE_4A_CONTRACT_CLOSURE_REPORT.md` | Contract closure against the 4A naming and the client legacy checks |
| `SLICE_4A_PRODUCTION_RELEASE_REPORT.md` | The production release itself — verdict **IDENTITY/AUTH SLICE 4A — PRODUCTION VERIFIED** |

**State at close:** commit `909f5be` serving on ovalball.co.uk and www;
database at 448 migrations, tip `20270354000000`.

## Slice 4B — Teams and Roster

Released and production verified on 16 September 2026, commit `774ab9b`.

| Document | What it is |
|---|---|
| `SLICE_4B_ARCHAEOLOGY.md` | The call-site archaeology 4B was scoped from |
| `SECURITY_FOLLOW_UP_unverifiable_age.md` | A cross-slice finding recorded, not fixed: an account whose age cannot be established is treated as an adult by the minor prohibition. It pre-dates 4B. It had no owner for the whole of Slice 4 and was assigned to **Slice 5** at the Slice 4 closure boundary by **D-S5-1** |

## Slice 4C — Fixtures

Released and production verified on 16 September 2026, commit `be4c52b`.
Production at 454 migrations, tip `20270361000000`, zero schema drift.

| Document | What it is |
|---|---|
| `SLICE_4C_IMPLEMENTATION_REPORT.md` | Implementation report for sub-slice 4c, including the direct-insert bypass it closes, its three intended changes and its stated limits |
| `SLICE_4C_PRODUCTION_RELEASE_REPORT.md` | The production release itself — the three staged steps and the verdict **IDENTITY/AUTH SLICE 4C — PRODUCTION VERIFIED** |
| `SLICE_4_PROGRAMME_LEDGER.md` | The running programme ledger — scope authority, archaeology, corrections and every checkpoint from 4C onwards. Unlike the slice reports, this one is appended to rather than frozen |

## Slice 4D — Competitions and Tournaments

Released and production verified on 16 September 2026, commit `ecdb9e4`.
Production at 456 migrations, tip `20270363000000`, zero schema drift.

| Document | What it is |
|---|---|
| `SLICE_4D_IMPLEMENTATION_REPORT.md` | Implementation report for sub-slice 4d — the three intended changes, the hoist, and the anon regression it caught |
| `SLICE_4D_PRODUCTION_RELEASE_REPORT.md` | The production release itself — verdict **IDENTITY/AUTH SLICE 4D — PRODUCTION VERIFIED** |

## Slice 4E — Calendar, Venues, Pitches, Training

Released and production verified on 16 September 2026, commit `f78de26`.
Production at 459 migrations, tip `20270366000000`, zero schema drift.

| Document | What it is |
|---|---|
| `SLICE_4E_IMPLEMENTATION_REPORT.md` | Implementation report for sub-slice 4e — the U "venues RLS/RPC mismatch" closure, four intended changes, and the third encounter with the per-row resolver |
| `SLICE_4E_PRODUCTION_RELEASE_REPORT.md` | The production release itself — a three-stage release ordered by evidence; verdict **IDENTITY/AUTH SLICE 4E — PRODUCTION VERIFIED** |

## Slices 4F–4I and the final closure

Each released and production verified on 16–17 September 2026.

| Slice | Domain | Commit | Documents |
|---|---|---|---|
| 4F | Messaging and notifications | `2d18a01` | `SLICE_4F_IMPLEMENTATION_REPORT.md`, `SLICE_4F_PRODUCTION_RELEASE_REPORT.md` |
| 4G | Safeguarding and dispensations (D-S4-2) | `b702824` | `SLICE_4G_IMPLEMENTATION_REPORT.md`, `SLICE_4G_PRODUCTION_RELEASE_REPORT.md` |
| 4H | Club administration and finance | `eb4342a` | `SLICE_4H_IMPLEMENTATION_REPORT.md`, `SLICE_4H_PRODUCTION_RELEASE_REPORT.md` |
| 4I | Documents, partners, referrals, handover | `c7a9a96` | `SLICE_4I_IMPLEMENTATION_REPORT.md`, `SLICE_4I_PRODUCTION_RELEASE_REPORT.md` |
| — | Final contract closure | `753d3cd` | `SLICE_4_CLOSURE_AUDIT.md`, `SLICE_4_FINAL_CLOSURE_RELEASE_REPORT.md` |

`SLICE_4_CLOSURE_AUDIT.md` is the one to read first: it classifies every
remaining legacy consumer with its later owner, and it is what established that
Slice 4 is finished rather than merely stopped.

## Programme state

**Slice 4 is complete.** All nine sub-slices 4a–4i are released and production
verified, and the final contract closure pass closed the three residual items
the audit found. Production is at **474 migrations**, tip `20270381000000`.

No item Phase 2 assigns to Slice 4 remains unfinished. What is still standing is
listed in the closure audit with the later owner Phase 2 or a prior slice
assigned it — principally the `is_site_admin` retirement, which AA.3 assigns to
**Slice 7**, and the legacy adapter, which reaches zero at **Slice 10**.

**Slice 5 is released and production verified.** Production is at **494
migrations**, tip `20270403000000`, commit `67969eb`. It delivers the unified
invitation model (Phase 2 §O), the club claim state machine (§P), team join
codes, and **D-S5-1**.

It was released in **three stages**, because two of its twenty migrations
remove something the then-deployed build still used — measured on a rehearsal
booted at production's own ledger, not assumed. `/join` going 404 → 200 on the
live site is what confirmed the new build was serving before the contract
stage ran.

| Document | What it is |
|---|---|
| `SLICE_5_IMPLEMENTATION_REPORT.md` | What Ovalball had, what it has now, and the ten defects the work found |
| `SLICE_5_PRODUCTION_RELEASE_REPORT.md` | The release itself — verdict **IDENTITY/AUTH SLICE 5 — PRODUCTION VERIFIED** |
| `SLICE_5_PROGRESS.md` | The running record of how it got there |

## Slice 6 — Password, MFA, recovery and sessions

**Released and production verified.** Production is at **507 migrations**, tip `20270416000000`,
commit `53e1575`.

This is **AG.2 step T0**: password, TOTP and recovery codes available to everyone, the Security page
live, and **no enforcement switched on for anybody**. Production had four identities, zero verified
TOTP factors, two with no password at all and exactly one Full Site Admin, so a release that demanded
AAL2 would have locked out every user including the only person who could fix it. Rehearsed at
production's own ledger with that population: **0 of 9 live sessions denied**.

| Document | What it is |
|---|---|
| `SLICE_6_PRODUCTION_RELEASE_REPORT.md` | The release itself, the eight defects it found, and every deferred step — verdict **IDENTITY/AUTH SLICE 6 — PRODUCTION VERIFIED** |
| `../security/BREAK_GLASS.md` | What to do when no Full Site Admin can sign in. A gate on enforcement, not a routine tool; **not yet rehearsed**, which is why T3 is deferred |

## Slice 7 — Site Admin master control and Users & Access

**Released and production verified on 17 September 2026**, commits `bf5ce97` … `cc16441`, thirteen
migrations. Production at **520 migrations**, tip `20270429000000`.

| Document | What it is |
|---|---|
| `SLICE_7_IMPLEMENTATION_REPORT.md` | What 7a–7d built: the master-control preamble, the twenty Q.3 RPCs, the two-administrator grant, the presentation-role retirement |
| `SLICE_7_PRODUCTION_RELEASE_REPORT.md` | The release itself — verdict **IDENTITY/AUTH SLICE 7 — PRODUCTION VERIFIED** |
| `SITE_ADMIN_BOOTSTRAP.md` | AN-3: how a second Full Site Admin is created. **Still an owner action (S7-13).** |

## Slice 7e — the closure: master control reaches a person

**Delivered and proved locally at Convergence Step 5. NOT RELEASED.**

The authority model was complete; the operator interface was not. Seventeen of the twenty-three
master-control RPCs had no caller anywhere in the product, so the two-administrator rule could not be
performed at all and three provenance timelines answered a question no screen asked.

| Document | What it is |
|---|---|
| `SLICE_7E_REQUIREMENT_RECOVERY.md` | **Superseded.** Kept as the record of why 7e waited on Stage 0 rather than being built against a boundary that could not be positively tested |
| `SLICE_7E_IMPLEMENTATION_REPORT.md` | All thirteen Slice 7 rows reconciled, what was built, and the four defects the work found (ledger L13–L16) |
| `SLICE_7E_RELEASE_PLAN.md` | The release that has not happened: order, the one production check to make first, verification, rollback, and L7's contract half |

Four migrations, `20270504000000` … `20270507000000`. **S7-13 remains with the owner.**

## Provenance

The terminal crashed shortly after the 4A release completed. The four Slice 4A
documents were recovered on 16 September 2026 from the session transcript and
the session scratchpad, both of which live under `/private/tmp` and do not
survive a reboot. They are reproduced verbatim; nothing was reconstructed or
summarised. Reports for slices 1–3 remain in the same volatile location and
have not yet been recovered.

That is why this directory is committed rather than left on disk: a file under
`/private/tmp`, or an untracked file in a working tree, is not a durable record.
The recovered 4A set was carried untracked through the 4B release; it is banked
here with 4C so that the next crash costs nothing.
