# Identity/Auth Slice 4F — Production Release Report

**Commit** `2d18a01` — *feat(authorization): move messaging and notification authority to the
canonical capability decision*, pushed as a fast-forward `117a63f..2d18a01`.

**Release order, derived rather than assumed:** migrations first, then the push. C1-C7 measured both
directions. The previous build calls `report_fixture_message`, which is kept and delegates to
`report_message`; the new build requires `report_message`, `club_message_reports` and
`message_reports`, all created by this slice. So production is correct whichever build is serving at
any moment in the deploy window — which is the point of doing the compatibility work rather than
sequencing on faith.

---

## 1. Before

Production stood at **459 migrations, tip `20270366000000`** — exactly the ledger the rehearsal
started from, which is why the rehearsal's numbers are comparable at all.

| | before |
|---|---|
| tables / functions / policies | 220 / 938 / 377 |
| identities / clubs / teams | 4 / 1 / 17 |
| `internal.staffs_team` | present |
| `internal.is_messaging_staff` | present |
| `team.community.manage` adapter rows | 2 |
| `public.message_reports` | does not exist |

Production carries no messages and no reports, so the backfill had nothing to move there. That it
*would* have moved them correctly is what the rehearsal established, on a seeded history with three
reports in three different states.

## 2. The migration

`npx supabase db push --linked --dry-run` first: exactly the three 4F migrations, nothing travelling.
Then applied, in order, in one push of the set the rehearsal had already applied one at a time.

```
20270367000000_messaging_authority_canonical.sql
20270368000000_message_reports_canonical.sql
20270369000000_messaging_policies_canonical.sql
```

## 3. After — every number matches the rehearsal

| | before | after | |
|---|---|---|---|
| ledger | 459 | **462**, tip `20270369000000` | |
| tables | 220 | 221 | `message_reports` |
| functions | 938 | 940 | |
| policies | 377 | 378 | |
| **identities / clubs / teams** | **4 / 1 / 17** | **4 / 1 / 17** | **unchanged — no data invented, no authority created** |
| `staffs_team` | 1 | **0** | dropped |
| `is_messaging_staff` | 1 | **0** | dropped |
| `team_messaging_staff` | 0 | **1** | |
| `team.community.manage` adapters | 2 | **0** | retired, not merely unused |
| `message_reports` | 0 | **1** | |
| PG-15 | 130 | **128** | |
| PG-16 | 135 | **124** | |

## 4. Production verification — 13 of 13

Run against the live database after the migration.

| | check |
|---|---|
| P1 | `messaging.block.manage` reaches Club Admin and Safeguarding Officer, and **not** the Fixtures Secretary — intended change 1, in production |
| P2 | `messaging.moderation.club_review` reaches the Safeguarding Officer alone |
| P3 | all thirteen J.10 keys are ACTIVE |
| P4 | no 4F function calls a legacy authority helper |
| P5 | `may_send_as` keeps **exactly one** `is_full_site_admin` branch and asks the J.10 site master |
| P6 | no browser role may call the third-party predicate |
| P7 | one open report per reporter is enforced by an index, not by convention |
| P8 | anon reaches neither `message_reports` nor the club queue |
| P9 | the explicit-participant route into a fixture conversation survives |
| P10 | a question with no subject answers no |
| P11 | Slices 4C-4E still hold — no direct fixture INSERT, `create_fixture` intact, the raw-role fixture-administrator helper still gone, the public venue projection standing, the calendar adapters still retired |
| P12 | no 4G surface was created early — **D-S4-2 untouched** |
| P13 | the third-party predicate is total: a null subject is `false`, not an error |

## 5. The application

The live site is healthy: `/`, `/login`, `/clubs` and `/public-fixtures` all return 200, and `/terms`
and `/privacy` redirect exactly as they do locally.

**Stated limit.** Every application change in 4F is server-side and behind authentication — the
reporting RPC both call sites now use, and the two Site Admin surfaces that gate on
`site.messages.moderate`. Verifying them *in production* would mean signing in, and the only way to
do that without using the product owner's own account would be to create production personas.
Both are prohibited, so neither was done.

What stands behind those changes instead: three sequential browser UAT passes of suites 51-56
(124/124 each) against a local database holding the same schema, including the two intended changes
replayed as real POST requests from the sessions of people who are not allowed to make them; and the
production database checks above, which is where the authority actually lives.

For the same reason I did not attempt to identify which build Vercel is serving at the moment of
writing: the asset fingerprints are not reproducible between builds, and there is no public marker.
The push is what triggers the deploy, and the compatibility matrix is what makes the answer not
matter.

## 6. Verdict

**Slice 4F is released and production-verified at the database layer, with the application layer
verified locally and the reason for that stated above.**

`staffs_team` and `is_messaging_staff` are gone from production — dropped, not left uncalled. The
Site Admin blanket conversation read is gone, including the part of it that was arriving through the
read policy's first term. A report is its own row. Blocking belongs to moderation. And the bypass
that would have let any site-admin profile post in any club's name is closed.

Carried deliberately and recorded: `may_send_as`'s platform branch (Slice 7), the club-level
branches of the audience helpers (4H), and the safeguarding conversation policy (4G).

**Next: nothing.** 4G is not started, and neither is Slice 5.
