# Identity/Auth Slice 4D — Production Release

**Commit `ecdb9e4`.** Fast-forward `3e8b932..ecdb9e4` on `main`. Released 16 September 2026.

---

## 1. What was released

Competition and tournament authority now resolves through `internal.capability_decision`. Six gates
move off role strings and the deprecated `calendar.manage` key onto the canonical J.8 keys; the
eight competition read policies follow; and `internal.is_club_fixture_administrator`, a raw-role
helper, is dropped.

Thirteen files: two migrations, two application files, the platform runner, the perimeter manifest,
three test suites, one browser suite, and the programme documents. The two protected logos remained
untracked and unstaged throughout, SHA-1s unchanged —
`be2bef0c978869aaa73e474cd5abdf5aec1fff6c` and `bdd3224871f0561d971f93f519764f0502092504`.

---

## 2. The release, as executed

Unlike 4C, 4D needed **no staging**, and that was derived rather than assumed:

```
OLD APP gate (calendar.manage, club)        CA=t  TM=f
NEW APP gate (tournament.tournament.manage) CA=t  TM=f
COMPATIBLE: both builds gate this route identically, so neither order can strand a user.
OLD APP SAFE: the calendar.manage adapter row survives 4D.
NEW APP SAFE: tournament.tournament.manage predates 4D (Slice 3 seeded it).
```

4D withdraws no privilege the running build uses and adds no object the new build needs.

1. **Dry run.** `supabase db push --linked --dry-run` listed exactly the two expected migrations.
2. **Migrations first**, because the push is the deployment:
   ```
   Applying migration 20270362000000_competition_authority_canonical.sql...
   Applying migration 20270363000000_competition_policies_canonical.sql...
   ```
   Both carry `DO` blocks that raise on a wrong outcome — that `internal.is_club_fixture_administrator`
   is gone, that anon **can** execute the hoisted helper, and that anon no longer holds the obsolete
   one. They completed without error, **so those assertions passed inside production.**
3. **Push.** `3e8b932..ecdb9e4`. Deployment confirmed live 40 seconds later, not assumed: the
   prerendered `/login` response changed `etag` `326f5974…` → `242e5209…` and its content-hashed
   chunk set `15f43204…` → `fea9dfa7…`. Both domains returned 200 afterwards.

---

## 3. Production state

```
rows 456 · applied remotely 456 · remote tip 20270363000000 · pending: none
20270362000000: APPLIED
20270363000000: APPLIED
```

`supabase db diff --linked` — which replays the whole tree into a shadow database and compares it
with the live remote schema — reports:

```
No schema changes found
```

So the live schema is **exactly** the one the 3840 assertions and the clean boot ran against: every
function body, every policy expression, every grant. No drift, no partially-applied object.

---

## 4. What is verified in production, and what is not

**Verified in production.** Both migrations applied in order; their embedded assertions passed
there; the live schema is identical to the tested tree; the new build is live on both domains and
serving.

**NOT OBSERVABLE ON CURRENT PRODUCTION DATA.** Every per-persona authority distinction — the three
intended changes, the organiser refusals, the entry/occasion split. Observing them needs signed-in
identities holding particular roles at particular clubs, and production has one club with one active
membership. Creating identities to make them observable is prohibited, and would be the wrong trade
anyway: it would put fabricated people into a real club's records to improve a report.

**Also not observable:** the anon public-competition path. It needs a published competition edition
in production, and there is none; `/competitions` has only a `[slug]` route, so its 404 is the
correct shape rather than a regression. That path is proven instead on the local and clean-boot
databases, by `CM-G4b` and by the two pre-existing suites (`competition_matches`,
`identity_foundation_and_perimeter`) that caught the anon regression described in the implementation
report.

---

## 5. Evidence

| Proof | Result |
|---|---|
| Full platform battery | **3840 passed, 0 failed, 199 suites** |
| `competition_authority_matrix` (new) | 70 assertions |
| `competition_authority_races` (new) | 4/4, three consecutive runs |
| Mutation testing | 6 mutants, **6 killed, 0 survivors**, clean restore |
| `authority_helper_retirement` | 40 assertions, every ceiling at the measured floor |
| Perimeter manifest | 11/11 |
| Clean boot from empty | 456 migrations, tip `20270363000000`, all suites 0 failed |
| Production-shaped rehearsal | every seeded row identical before and after |
| Browser suites 51 / 52 / 53 / 54 | 19 / 17 / 14 / 22 — three passes, one anomaly (below) |
| Performance | competition read 153 ms → **1.8 ms** |
| `tsc` / `eslint` / `git diff --check` | clean |

### Retirement, monotonic

`can_organise_edition` policies **8 → 0** · `is_club_fixture_administrator` **dropped** ·
`has_capability` bodies 123 → **121** · `is_site_admin` bodies 146 → **144** ·
`can_manage_club_fixtures` bodies 42 → **41** · **PG16 145 → 143** · PG15 **130** unchanged.
Nothing increased.

---

## 6. Risks and deferrals

**A browser run that was not clean.** Passes 1 and 3 were fully green; in pass 2 suite 51 crashed on
a signed-out page and suite 54 reported 21/22. Neither reproduces: 51 has since run 19/19 three
times alone and 54 22/22 three times alone. The occurrence coincided with other activity on the same
database, and these suites are not safe to run concurrently *with themselves* — each deletes stale
identities by email prefix at startup. Recorded as an operating hazard with a recommended fix (an
advisory lock per prefix); no shared harness code was changed on the strength of an unreproducible
failure.

**J.8 defines no tournament-entry key.** The team-scope branch of `can_manage_tournament_entry` is
governed by the product invariant rather than the design table, and is expressed with 4E's
`calendar.event.manage`. If a later slice introduces `tournament.entry.*`, that branch should move.

**Unknown-age follow-up.** 4D touches no role grant, membership transition or onboarding path, so it
does not make unknown-age staff authority more reachable. It carries forward unchanged.

**Pre-existing, not fixed here:** the seed defect in `supabase/seeds/local_uat_parent_player.sql`
recorded at 4C remains open and has no assigned owner.

---

## 7. Verdict

**IDENTITY/AUTH SLICE 4D — PRODUCTION VERIFIED**

4e–4i are not started. Next in order is 4e (Calendar, venues, pitches, training). 4g remains banked
under decision D-S4-2 and is not to be implemented ahead of its turn. Slice 5 is not started.
