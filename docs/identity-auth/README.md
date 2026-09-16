# Identity, Authentication & Authorization Programme

Release records for the identity/auth programme. These documents are
**historical records of work that has happened** — they are not re-written when
presentation improves, and a released slice's report is not edited after the
fact.

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
| `SECURITY_FOLLOW_UP_unverifiable_age.md` | A cross-slice finding recorded, not fixed: an account whose age cannot be established is treated as an adult by the minor prohibition. It pre-dates 4B and has no assigned owner |

## Slice 4C — Fixtures

Released and production verified on 16 September 2026, commit `be4c52b`.
Production at 454 migrations, tip `20270361000000`, zero schema drift.

| Document | What it is |
|---|---|
| `SLICE_4C_IMPLEMENTATION_REPORT.md` | Implementation report for sub-slice 4c, including the direct-insert bypass it closes, its three intended changes and its stated limits |
| `SLICE_4C_PRODUCTION_RELEASE_REPORT.md` | The production release itself — the three staged steps and the verdict **IDENTITY/AUTH SLICE 4C — PRODUCTION VERIFIED** |
| `SLICE_4_PROGRAMME_LEDGER.md` | The running programme ledger — scope authority, archaeology, corrections and every checkpoint from 4C onwards. Unlike the slice reports, this one is appended to rather than frozen |

## Programme state

**Not started:** 4d–4i. The Slice 4 programme is **not** complete. Next in order
is 4d (Training). 4g remains banked under decision D-S4-2 and is not to be
implemented ahead of its turn, and Slice 5 is not started.

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
