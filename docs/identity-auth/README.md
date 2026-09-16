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
| `IDENTITY_AUTH_DECISION_RECORD.md` | **The locked decisions, in one place** — D-S4-1 to D-S4-4 and D-S5-1. Referenced by number throughout the release reports |
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

**Slice 5 is not started.** It is next in order, and it carries **D-S5-1**: the
unknown-age eligibility gate, approved at this boundary and not yet
implemented.

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
