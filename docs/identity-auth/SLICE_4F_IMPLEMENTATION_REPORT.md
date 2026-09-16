# Identity/Auth Slice 4F — Messaging and Notifications

Moves the authority behind Ovalball's Messenger from legacy helpers and role strings to the
canonical capability decision, and replaces the reporting mechanism with the one section T
specifies. Three migrations, expand → section T → contract.

Contract: Phase 2 design **J.10 lines 511-523** (thirteen keys) and **section T "Reports"**, under
**AA.3 row 4f**, whose named targets are `staffs_team`, `is_messaging_staff` and the Site Admin
conversation read.

---

## 1. The exact contract

All thirteen J.10 keys already existed ACTIVE with exactly the bundles J.10 specifies. **4F adds no
capability and changes no bundle.** What it changes is which code asks which question.

| retired | added |
|---|---|
| `internal.staffs_team` (dropped) | `internal.team_messaging_staff` |
| `internal.is_messaging_staff` (dropped) | — |
| `team.community.manage` adapter rows (2, deleted) | — |
| the four report columns as the *record of record* | `public.message_reports`, `public.report_message`, `public.club_message_reports`, `internal.message_report_club` |

`internal.team_messaging_staff` is the replacement that matters, and its shape is forced by the
question. `staffs_team` asked "does **this person** staff this team" — a question about somebody
else. `internal.can()` cannot answer it: it reads `auth.uid()`. So the replacement resolves through
`internal.capability_decision(p_subject, …)` with session checks off, because it is asking about a
person's standing authority and not about their live session. No browser role holds EXECUTE on it.

---

## 2. Seven intended changes

1. **A Fixtures Secretary may no longer block someone from a club's conversations, and a
   Safeguarding Officer now may.** J.10 line 518: blocking is moderation, not fixtures.
2. **The Site Admin blanket conversation read is gone.** A site answer arrives through
   `site.messages.moderate`, which J.10 marks "(reported only)".
3. **A report is its own row.** See §3.
4. **Site message-policy authority is `site.messages.policy.manage`,** not a role string.
5. **Speaking in a club's name stops asking 4C's fixture-planning gate** and asks
   `messaging.announcement.send_club`.
6. **The site branches of `may_send_as` and of both audience helpers ask `site.support.act_in_club`.**
   That key sits in `SITE_FULL` and no other bundle, so the same people answer the same way — but
   through the canonical decision rather than a role literal, and revocably.
7. **`site.messages.moderate` no longer reaches direct, safeguarding or announcement threads.**
   See §4.

---

## 3. The defect section T exists to fix

Reporting a message wrote four columns onto the message row: `reported_at`, `reported_by`,
`report_reason`, `report_status`. There is one set of them per message, so **a second person
reporting the same message replaced the first person's report** — reason, reporter and all.

The case that needs a second report most is the one where the first was not acted on.

`public.message_reports` is one row per report, with a partial unique index on
`(message_id, reported_by) where status = 'open'` so that a person pressing the button twice is
idempotent rather than an error. The backfill preserves reason, reporter and status verbatim: 5 of 5
existing reports on the development database, and 3 of 3 on the production-shaped rehearsal, where
the three were deliberately seeded `open`, `reviewed` and `resolved` so the status column had
something to lose. The four columns stay on the message as a
denormalised "this has been reported" flag that existing surfaces already read; they are simply no
longer the record.

The club queue (`public.club_message_reports`) is the **Safeguarding Officer's**, via
`messaging.moderation.club_review`. A Club Admin is deliberately excluded from the row policy: J.10
line 520 gives that key to the SO bundle alone, and a report may be *about* a Club Admin.

---

## 4. Four things the gates found that reading the diff would not have

**The retirement ledger found a residue.** Adding 4F to `authority_helper_retirement` failed
immediately on `internal.may_send_as`, which still asked `is_full_site_admin()` in three branches. Two
of them have a recorded site master in J.10 lines 514-515 and were canonicalised. The third —
"may you speak as Ovalball itself" — has no row in J.10 and no key in the catalogue, so it is
carried, and the ledger now asserts the count is **exactly one** so neither of the other two can
quietly revert.

**The matrix found a blanket bypass under the send path.** `may_send_as` delegates both
organisational branches to `internal.can_address_club_audience` / `can_address_team_audience`, and
both opened with a bare `internal.is_site_admin()`. Any site-admin profile — `read_only`, `content`,
`fixture_ops`, `message_moderator` — could post in any club's or team's name and read that audience.
Canonicalising `may_send_as` alone would have moved the bypass one function further away and left it
reachable. It is closed with the same J.10 site master; the club-level branches beside it
(`is_club_admin`, `team.attendance.view`) are left alone and belong to 4H.

**The performance work found a dropped branch.** Putting the pre-4F body of
`can_access_fixture_conversation` beside the new one for a like-for-like measurement showed that the
rewrite had silently dropped the `fixture_conversation_participants` branch — the route by which
somebody explicitly *added* to a conversation, such as a referee or a neutral-ground contact, reaches
it without holding anything at either club. The table is empty in development, so nothing failed. It
is restored, and MA-B9…B12 pin it.

**EXPLAIN found the rest of the blanket read.** `fixture_messages_select_scoped` evaluates
`can_access_any_conversation` as its **first** term, and on a team, direct, safeguarding or
announcement row all three of its arguments are null. The function answered that question about
nothing affirmatively for a `site.messages.moderate` holder — handing them every thread in Ovalball
through the back of the same policy J.10 removes the blanket read from the front of. A question with
no subject now answers no.

---

## 5. Performance

| read | pre-4F | 4F | |
|---|---|---|---|
| 600 messages across 30 fixture threads | ~385 ms | **~228 ms** | 41% faster |
| one 300-message team conversation | ~65 ms | **~69 ms** | within noise |

The team read was **169 ms** until the read policy's first term was guarded by a column test, the way
every other term in that policy already was. Postgres cannot inline a SECURITY DEFINER function, so
an unguarded call in a policy runs once per row regardless of what the planner would prefer. The
guard is behaviour-preserving by construction — the function already answered false for those rows —
and MA-L4 asserts that row for row, for nine personas, rather than assuming it.

---

## 6. Mutation testing

Twelve mutants, **twelve killed, no survivors**, over two rounds. The first round is the informative
one: **M5** showed nothing exercised `team_messaging_staff` — the headline item of AA.3 row 4f;
**M9** showed every persona who could speak as a team also held `team.attendance.view`, so the
announcement clause beside it was never deciding; **M11** showed the assertion meant to prove the
sender-identity *trigger* used a persona the *row policy* already refused, and so proved RLS while
claiming to prove the trigger.

M11 also exposed a hole in the harness: restoring only this slice's migrations left a mutant aimed
at an earlier slice's object live in the database, so the next mutant was measured against a
half-broken schema.

---

## 7. Release ordering, DERIVED

The new build requires `report_message`, `club_message_reports` and `message_reports`; all three are
created by this slice, so a build deployed before the migrations fails on the first report.

The previous build calls `report_fixture_message`. It is **kept** — Vercel deploys on push and the
migrations go first, so the old build runs against this schema for the length of the deploy — but it
now **delegates** to `report_message`. Dropping it would break every report in that window; leaving
its old body would make every report in that window overwrite somebody else's.

That question is also what found the seventh defect: Match Centre's own `reportMessage` still named
the old RPC, so half the product kept the overwrite. Both call sites now use `report_message`.

**Migrations first, then push.** C1-C7 measure both directions.

---

## 8. Evidence

| gate | result |
|---|---|
| `messaging_authority_matrix.sql` | 114 assertions, MA-A … MA-M, deterministic and self-seeding |
| `messaging_authority_races.test.mts` | 4 passed, three times |
| browser suite 56 | 26/26 |
| shared harness, suite 51 | extended with N10a/b and N11a/b; 25/25 |
| full banking battery | **4052 passed, 0 failed across 203 suites** |
| clean empty-database rebuild | 462 migrations from empty; 13 suites, 714 assertions; perimeter 11/11 |
| production-shaped rehearsal | 459 → 462 one at a time, each dry-run first; 3/3 legacy reports backfilled verbatim; only data delta `audit` +2 |
| compatibility matrix | 7/7 |
| browser UAT | suites 51-56, three sequential passes, 124/124 each |

PG-15 **130 → 128**. PG-16 **135 → 124**.

---

## 9. Stated limits

- **`may_send_as`'s platform branch still asks `is_full_site_admin()`.** J.10 defines no capability
  for speaking as Ovalball, and AA.3 assigns site-side role-string removal to Slice 7. Pinned by name
  in the retirement ledger so it cannot grow.
- **The club-level branches of the audience helpers are untouched.** `is_club_admin` is AA.3 row 4h's
  to retire, and `team.attendance.view` is the existing contract for addressing a team.
- **No 4G work is pulled forward.** Reports route to whoever holds `messaging.moderation.club_review`;
  Slice 2 already models the Safeguarding Officer role and Slice 3 already seeded the bundle. No
  nomination, no confirmation, no invitation. D-S4-2 untouched.
- **Carried programme debt is unchanged**: the unknown-age follow-up, the 4C
  `local_uat_parent_player` seed defect, the `training_centre_visibility` seedless-boot limitation,
  the Playwright prefix-cleanup concurrency hazard and the deliberately carried pitch-view boundary.
- **§9 unknown-age check**: 4F grants no role, changes no membership transition and adds no
  onboarding path. The follow-up carries forward unchanged.
