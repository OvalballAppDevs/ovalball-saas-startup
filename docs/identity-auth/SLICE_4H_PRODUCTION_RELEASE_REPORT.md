# Identity/Auth Slice 4H — Production Release Report

**Commit** `eb4342a` — *feat(authorization): move club administration and finance to the canonical
capability decision*, pushed as a fast-forward `18ace8d..eb4342a`.

**Release order, derived rather than assumed:** migrations first, then the push. C1-C7 measured both
directions.

---

## 1. Before

Production stood at **465 migrations, tip `20270372000000`** — exactly the ledger the rehearsal started
from.

| | before |
|---|---|
| tables / functions / policies | 222 / 952 / 379 |
| identities / clubs / teams | 4 / 1 / 17 |
| `is_club_admin` policies / bodies | **23 / 20** |
| club administration and finance adapter rows | 13 |
| `internal.club_ids_with` / `public.record_club_export` | neither exists |
| PG-15 / PG-16 | 124 / 121 |

## 2. The migration

`npx supabase db push --linked --dry-run` first: exactly the four 4H migrations, nothing travelling.
Then applied, in order, as the set the rehearsal had already applied one at a time after its own dry
run.

```
20270373000000_club_admin_authority_canonical.sql
20270374000000_club_finance_authority_canonical.sql
20270375000000_club_admin_policies_canonical.sql
20270376000000_club_finance_policies_canonical.sql
```

## 3. After — every number matches the rehearsal

| | before | after |
|---|---|---|
| ledger | 465 | **469**, tip `20270376000000` |
| **`is_club_admin` policies** | **23** | **0** |
| `is_club_admin` bodies | 20 | 14 (4b's, 4c's, 4i's — named, not taken) |
| 4H adapter rows | 13 | **0** |
| 4i's and 4a's adapter rows | present | **still present** |
| policies using the hoist | 0 | **25** |
| PG-15 | 124 | **100** |
| PG-16 | 121 | **91** |
| **identities / clubs / teams** | **4 / 1 / 17** | **4 / 1 / 17** — no data invented |

## 4. Production verification — 13 of 13

| | check |
|---|---|
| P1 | ledger 469, tip `20270376000000` |
| P2 | **no policy anywhere decides authority with `is_club_admin`** |
| P3 | the 14 remaining bodies are 4b's, 4c's and 4i's, and are still there |
| P4 | the eleven club administration and finance adapter rows are retired |
| P5 | and 4i's and 4a's are **not** — no slice took another's count |
| P6 | nothing in the database asks a retired club or finance key |
| P7 | **J.13: nothing that acts on a club's money carries a Site Admin branch** |
| P8 | section S: the export gate exists, asks `club.reporting.export`, and emits a reason-bearing `export.generated` |
| P9 | the hoist is installed, in the subquery form the planner folds, used by 25 policies, and nowhere in the `= any (...)` form |
| P10 | `anon` may call the two policy helpers — transitive reads need it — and holds no direct read of the ten tables |
| P11 | the membership policy asks the master J.3 records **by name** |
| P12 | Slices 4C-4G still hold — no direct fixture INSERT, `is_club_fixture_administrator`/`staffs_team`/`is_messaging_staff` still gone, `message_reports` and `safeguarding_thread_reviews` standing, and a safeguarding nomination still enters PENDING_CONFIRMATION |
| P13 | identities, clubs and teams unchanged at 4 / 1 / 17 |

P9 first reported FAIL against a case-sensitive pattern; Postgres renders the subquery as
`IN ( SELECT unnest(...))`. The assertion was wrong, not the deployment, and re-running it correctly —
including a check that **no** policy kept the un-foldable `= any (...)` form — passes.

## 5. The application

The live site is healthy: `/`, `/login`, `/clubs` and `/public-fixtures` all return 200.

**The one window effect, stated.** The previous build asks the eleven retired aliases on its
club-settings and finance surfaces, so for the length of the deploy those tabs hide. Fail-closed,
self-healing, no data effect — and the reason the app half of this slice repoints those call sites.
Its RPCs all keep working: same names, same signatures, canonical gates (C3, C4).

**Stated limit.** Every 4H application change is server-side and behind authentication — the club
settings and finance pages, and the export's new reason field. Verifying them *in production* would
mean signing in, and the only ways to do that would be to use the product owner's own account or to
create production personas. Both are prohibited, so neither was done.

What stands behind them: three sequential browser UAT passes of suites 51-58 (**192/192** each) against
a local database carrying the same schema — including suite 58 driving the club roll, the invitation
list, the private contact card and the opponent notes from five signed-in sessions plus a signed-out
one, the export refused without a reason and allowed with one, and a Full Site Admin refused the club's
subscription; and suite 51 replaying the export and the finance RPC from eight sessions that must all
be refused. Plus the thirteen production database checks above, which is where the authority lives.

## 6. Verdict

**Slice 4H is released and production-verified at the database layer, with the application layer
verified locally and the reason for that stated above.**

`internal.is_club_admin` decides nothing in any policy in Ovalball. No site-admin profile can touch a
club's money. A club's roll of children cannot leave Ovalball without a named person giving a reason
that is recorded against it. And a Club Admin reading a 400-member roll now waits about 2ms instead of
about 21.

**Next: nothing.** 4I is not started, and neither is Slice 5.
