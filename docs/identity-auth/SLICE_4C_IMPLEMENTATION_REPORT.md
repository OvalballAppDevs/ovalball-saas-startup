# Identity/Auth Slice 4C — Fixtures

**Phase 2 AA.3 row 4c.** Creating, editing, planning, answering and resulting a fixture now resolves
through `internal.capability_decision`, and the one route that could book a fixture against another
Ovalball club without asking them is closed.

---

## 1. What the slice owns, and what it deliberately does not

`can_manage_club_fixtures` appears in 18 policies and 57 function bodies. 4C migrates **13 policies
and 15 bodies** of them. The rest belong to 4D (training), 4E (messaging and announcements), 4F
(competitions and tournaments), 4G (dispensations) and 4I (documents, partners, handover). A helper
is retired by the slice that owns the *meaning* of the call site, not by whichever slice's grep
happens to match it first — migrating a training policy inside a fixtures slice would move a
decision without anyone having reviewed the decision.

The capability keys 4C owns are J.6 lines 456–474: `fixture.fixture.create`, `.edit`, `.view`,
`.archive`, `.cancel`, `.delete`, `.bulk_edit`, `fixture.planner.use`, `fixture.import.run`,
`fixture.request.create`, `fixture.request.respond`, `fixture.result.record`,
`fixture.callup.request`, `fixture.callup.approve`, and the site masters `site.fixtures.support`,
`site.fixtures.view`, `site.fixtures.delete`.

Call-ups are 4C (a call-up is a fixture selection). Dispensations are 4G (a dispensation is a
regulatory judgement about a player that outlives any one fixture).

---

## 2. The security hole this slice closes

The rule that **a fixture against another Ovalball club is asked for, never simply booked** is a
product invariant. Before this slice it existed only in application code.

A signed-in person could `POST /rest/v1/fixtures` directly. The `fixtures_insert_scoped` policy
asked only whether they could manage the *owning* team; nothing asked whether the *opposition* had
agreed. A fixture could therefore be created with `status = 'Booked'` naming another club's team,
with no `fixture_requests` row and no verification, and it would appear on that club's calendar as a
booked match they had never been asked about.

This was proven against a live database, not inferred. An early probe of mine reported the opposite —
that the database already refused the insert — and it was wrong: the probe used
`status = 'Scheduled'`, which `fixtures_status_check` rejects before any authority logic runs. With a
valid `'Booked'` the insert succeeded. The correction is recorded in the programme ledger rather
than quietly overwritten, because the first answer would have closed the slice with the hole open.

**The fix.** `public.create_fixture(...)` is now the only way in. It derives the club and the
opposition's Ovalball status from the resource rather than trusting its arguments, requires
`fixture.fixture.create` at the owning team or its club, and when the opposition is an Ovalball club
it raises a request instead of writing a fixture. `authenticated` no longer holds `INSERT` on
`public.fixtures` at all, and the migration raises rather than completing if the revoke did not take
effect. With no INSERT privilege there is no second route left to find.

---

## 3. Three intended changes

**1. A Full Site Admin no longer bypasses fixture authority by role.** The bare `internal.is_site_admin()`
disjunct is gone from every policy 4C owns. A site answer now arrives through
`site.fixtures.support`, the same explicit route every other canonical decision uses.

**2. A Team Manager may archive and restore their own team's fixture** (J.6 line 460). The legacy
helper asked a club-level question about a team-level act.

**3. A Coach may raise a fixture request but may not answer one** (J.6 line 466). Answering commits
the club to play another club. This one surfaced only when the full battery ran:
`fixture_editor_authority` had the opponent club's Coach accept a request, and that call now
correctly refuses. The suite was not weakened to accommodate it — it seeds a Fixture Secretary at the
opponent club, asserts the Coach's refusal explicitly as a new assertion, and has the Secretary
answer. The coach persona stays for the sections that test genuine coach authority.

---

## 4. A performance regression, found and fixed before release

The canonical `fixtures_select_related` policy was **55× slower** than the legacy one — 1652 ms
against 30 ms. The cause is structural: Postgres cannot inline a `SECURITY DEFINER` function, so a
per-row resolver call is a per-row function call, and the policy was making one for every candidate
fixture.

Three attempts did not fix it. A parameterless `STABLE` helper was *worse*, because it scanned every
club. Membership-bounded helpers were still per-row. `= any((select ...))` failed outright with
`operator does not exist: uuid = uuid[]`.

What worked was moving the hoistable part of the question **into the policy itself**, as
`IN (select unnest(internal.viewable_fixture_clubs()))`. An uncorrelated subquery in a policy becomes
an InitPlan, evaluated once per statement rather than once per row. Both helpers are bounded by the
caller's own ACTIVE memberships, so neither can widen what the policy already allows. Result:
**23 ms**, at parity with or faster than the legacy policy.

The superseded `internal.fixture_visible_row` is dropped in the same migration. Leaving it installed
made two Slice 4A helper counts read one higher than their ceilings, because the same family branch
existed in both the old body and the new one — an expand migration that keeps the function it
replaces looks, to a counter, exactly like a regression.

---

## 5. Release order

Closing the bypass is a **contract** change: it removes a privilege the currently deployed
application still uses. The order is therefore not the usual one.

| Stage | Action | Why |
|---|---|---|
| A | Apply `20270358000000` + `20270359000000` + `20270360000000` | Expand and policy contract, plus the `create_fixture` RPC. The deployed application keeps working: it still direct-inserts and still holds INSERT. |
| B | Deploy the application | `createFixture` now calls `public.create_fixture`, which Stage A already created. Nothing direct-inserts any more. |
| C | Apply `20270361000000` | Revokes INSERT and drops `fixtures_insert_scoped`. Safe only once B is live. |

**The revoke is its own migration for a reason.** My first plan put `create_fixture` and the revoke
together in `20270360000000` and released that as Stage C. Re-reading the order before releasing
showed it opens an outage window: at Stage B the new application calls `public.create_fixture`,
which under that plan would not exist in production until Stage C, so every club's fixture creation
would fail for the length of the gap. Splitting the function's creation (Stage A, pure expand) from
the revoke (Stage C, pure contract) is what removes the window. Either half alone in the wrong place
breaks creation — the RPC too late, or the privilege withdrawn too early.

---

## 6. Evidence

| Proof | Result |
|---|---|
| Full platform battery | **3761 passed, 0 failed, 197 suites** |
| `fixture_management_authority` | 99 assertions |
| `fixture_bulk_planning_authority` | 28 assertions |
| `fixture_editor_authority` | 19 assertions |
| `authority_helper_retirement` | 35 assertions, every ceiling at the measured floor |
| Perimeter manifest | 11/11 |
| Creation races (`fixture_creation_races`) | 4/4 × 3 runs |
| Clean boot from empty | all **454** migrations, disposable stack, tip `20270361000000` |
| Production-shaped rehearsal | every seeded row identical before and after |
| Browser suites 51, 52, 53 (Playwright, real sessions) | 17/17, 17/17, 14/14 — **9 green runs over 3 passes** |
| `tsc` / `eslint` / `git diff --check` | clean |

### Retirement, monotonic

`has_capability` 98 / 123 · `is_site_admin` 115 / 146 · `can_manage_club_fixtures` 13 / 42 ·
`can_manage_fixture_side` 2 / 6 · `can_manage_team` 2 / 20 · **PG15 130** (was 138) ·
**PG16 145** (was 157). Nothing increased.

---

## 7. A provenance regression, caught before staging

`fixtures.source` separates club work from Site Admin work, and the Site Admin fixtures list filters
on it. The old `createFixture` wrote `site_admin_manual`; the first version of `public.create_fixture`
hardcoded `club_created`, which would have quietly emptied that filter for every new fixture and
recorded Site Admin's work as the club's.

The principle was right and the implementation was not: `source` must never be an argument, because
a caller must not be able to describe their own fixture as somebody else's work — but "server-derived"
is not "constant". It is now derived from **which authority granted the call**: passing on
`fixture.fixture.create` at the team or club records `club_created`; passing only on
`site.fixtures.support` records `site_admin_manual`. The caller cannot choose which branch authorised
them, so it stays uncounterfeitable. Assertion FA-H4b pins it.

Applying that lesson to the remaining columns found a second, worse omission. When the opposition is
a claimed Ovalball club that has **not named a team yet**, the old action put the structured identity
of the side being asked for onto the request — `target_team_age_group`, `target_team_gender`,
`target_team_squad_designation`. That is Central Fixture Participant Resolution; without it the other
club receives a request it cannot answer. The RPC had no parameters for them, so both live callers
would have dropped them silently.

They are now arguments. Accepting them is safe in a way accepting `source` would not have been: they
describe the *team being asked for*, never the caller's own authority, so there is nothing to forge —
and they are ignored outright once `p_opponent_team_id` names a real team, so they cannot contradict
it. FA-H7b and FA-H7c pin both halves.

The lesson is general enough to be worth stating: when a migration moves a write out of the
application and into the database, every column the application was setting has to be accounted for,
not only the ones the security argument is about.

---

## 8. Stated limits

**The delete policy's change is not observable.** `fixtures_delete_admin` is migrated off the bare
`is_site_admin()` onto `site.fixtures.delete`, which lowers the PG-15 count, but no browser role can
reach it: `DELETE` on `public.fixtures` is granted only to `postgres` and `service_role`, and both
carry `BYPASSRLS`. The matrix asserts the capability answers and the privilege closure, and says
plainly that the authority change itself is **NOT OBSERVABLE**, rather than staging a scenario that
would imply otherwise.

**A seedless boot proves less of the matrix, by design.** On the clean-boot stack
`fixture_management_authority` reports 86 assertions rather than 99. The 13 missing ones are the
original legacy section, which reads the UAT seed identities and SKIPs when they are absent. That
gap is precisely why the slice added the deterministic FA-A…FA-L sections, which seed their own
clubs, teams and people and therefore cannot silently skip: a suite that can report zero assertions
on a clean database is a suite that can pass without testing anything.

**An unrelated seed defect.** Booting from empty with seeds enabled fails at
`supabase/seeds/local_uat_parent_player.sql` with *"Cannot activate a B squad without an active
primary team at this level"*. A control stack booting the **same tree with 4C held back** —
production's exact ledger — fails identically, so the defect pre-dates this slice. It is recorded as
an out-of-scope finding with no owner assigned rather than patched inside a 4C release.
