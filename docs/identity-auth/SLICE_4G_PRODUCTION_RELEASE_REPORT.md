# Identity/Auth Slice 4G — Production Release Report

**Commit** `b702824` — *feat(authorization): move safeguarding appointment authority to the canonical
capability decision*, pushed as a fast-forward `967ff85..b702824`.

**Release order, derived rather than assumed:** migrations first, then the push. C1-C7 measured both
directions. The previous build's nominate, invite and accept RPCs all still work, and acceptance now
lands PENDING_CONFIRMATION — a person ends up holding **less**, never more. The one real window effect
is stated in §5 rather than discovered later.

---

## 1. Before

Production stood at **462 migrations, tip `20270369000000`** — exactly the ledger the rehearsal started
from, which is why the rehearsal's numbers are comparable at all.

| | before |
|---|---|
| tables / functions / policies | 221 / 940 / 378 |
| identities / clubs / teams | 4 / 1 / 17 |
| `club.safeguarding.*` adapter rows | 3 |
| `safeguarding_thread_reviews` | does not exist |
| `internal.grant_role` enters a nomination pending | no — it wrote CONFIRMED |
| Safeguarding Officer assignments | 0 |

Production carries no Safeguarding Officers and no safeguarding threads, so no existing appointment was
affected. That an existing one *would* have been left untouched is what the rehearsal established, on a
seeded club whose officer had been appointed the old way and already read CONFIRMED.

## 2. The migration

`npx supabase db push --linked --dry-run` first: exactly the three 4G migrations, nothing travelling.
Then applied, in order, as the set the rehearsal had already applied one at a time after its own dry run.

```
20270370000000_safeguarding_appointment_canonical.sql
20270371000000_safeguarding_visibility_canonical.sql
20270372000000_safeguarding_policies_canonical.sql
```

## 3. After — every number matches the rehearsal

| | before | after | |
|---|---|---|---|
| ledger | 462 | **465**, tip `20270372000000` | |
| tables | 221 | 222 | `safeguarding_thread_reviews` |
| functions | 940 | 952 | |
| policies | 378 | 379 | |
| **identities / clubs / teams** | **4 / 1 / 17** | **4 / 1 / 17** | **unchanged — no data invented, no authority created** |
| Safeguarding Officer assignments | 0 | **0** | nothing appointed, nothing un-appointed |
| `club.safeguarding.*` adapters | 3 | **0** | retired, not merely unused |
| `grant_role` enters a nomination pending | no | **yes** | AN-6 is reachable |
| PG-15 | 128 | **124** | |
| PG-16 | 124 | **121** | |

## 4. Production verification — 15 of 15

Run against the live database after the migration.

| | check |
|---|---|
| P1 | AN-6 is reachable: a nomination enters PENDING_CONFIRMATION, and `grant_role` no longer confirms it on creation |
| P2 | the resolver refuses an unconfirmed Safeguarding Officer at **all three** scopes |
| P3 | confirmation uses the canonical site capability, with no raw site-admin role check anywhere in the body |
| P4 | and refuses self-confirmation |
| P5 | `safeguarding.officer.confirm` reaches SITE_FULL and SITE_SUPPORT, and no club bundle |
| P6 | the Slice 5 seam exists and **no browser role can call it** |
| P7 | the seam proves ACTIVE membership of **this** club, from the database |
| P8 | no blanket Site Admin read of a safeguarding thread — not in the gate, not in any of the five policies |
| P9 | Ovalball reaches a thread only through the reasoned review, which requires a reason and leaves a record |
| P10 | officer identity comes from confirmed assignments, not the contact table a Club Admin writes |
| P11 | dispensation separation of duties is enforced |
| P12 | the transitional `club.safeguarding.*` keys are retired and nothing asks them |
| P13 | **D-S4-2**: exactly one safeguarding invitation table — the pre-existing one — and no temporary token or redemption RPC |
| P14 | the officer predicate is total: a null club answers empty, not an error |
| P15 | Slices 4C-4F still hold — no direct fixture INSERT, `create_fixture` intact, `is_club_fixture_administrator`, `staffs_team` and `is_messaging_staff` all still gone, the public venue projection and `message_reports` both standing |

## 5. The application

The live site is healthy: `/`, `/login`, `/clubs` and `/public-fixtures` all return 200.

**The one window effect, stated.** The previous build asks `club.safeguarding.view`,
`club.safeguarding.message` and `club.safeguarding.manage_contact`, and the migration retires all three.
For the length of the deploy that build's club-settings safeguarding tab does not appear. It is
fail-closed, self-healing, and has no data effect — and it is the reason the app half of this slice
repoints those three call sites to the canonical keys. It was found by the compatibility proof, not by
a test.

**Stated limit.** Every other 4G application change is server-side and behind authentication — the
nomination action, the AN-6 confirmation surface, and the safeguarding pages that gate on the canonical
keys. Verifying them *in production* would mean signing in, and the only ways to do that would be to use
the product owner's own account or to create production personas. Both are prohibited, so neither was
done.

What stands behind them instead: three sequential browser UAT passes of suites 51-57 (**156/156** each)
against a local database carrying the same schema, including browser suite 57 driving nomination →
refused confirmation by everybody at the club → confirmation by Ovalball → the officer reaching the
thread, and suite 51 replaying the confirmation RPC from eight signed-in sessions that must all be
refused. Plus the fifteen production database checks above, which is where the authority actually lives.

## 6. Verdict

**Slice 4G is released and production-verified at the database layer, with the application layer
verified locally and the reason for that stated above.**

A club can no longer appoint its own Safeguarding Officer. A nomination grants nothing until a named
person at Ovalball confirms it with a recorded reason, and cannot be confirmed by the Club Admin who
made it or by the nominee. No Site Admin reads a club's safeguarding thread through RLS at all; the way
in requires a reason and leaves a record the club's own officers can see. Officer identity comes from a
confirmed role assignment rather than a table a Club Admin writes. And the person who raises a
safeguarding concern can now reply in their own thread, which they could not before.

**Next: nothing.** 4H is not started, and neither is Slice 5.
