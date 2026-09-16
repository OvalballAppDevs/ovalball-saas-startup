# Identity/Auth Slice 4D — Competitions and Tournaments

**Phase 2 AA.3 row 4d**, design J.8 lines 482–491. Organising a competition, issuing and answering
its matches, and running a tournament now resolve through `internal.capability_decision`.

---

## 1. The exact contract, and the boundary around it

AA.3 row 4d retires **`can_organise_competition` role checks** and **`calendar.manage` tournament
use**, with the matrix named `competition_authority_matrix.sql`.

Two things are deliberately *not* taken. `calendar.manage` also decides **club events**, which is
J.9 and belongs to 4E — `app/(app)/club/events/page.tsx` keeps it. And
`competition_match_verifications_read` keeps asking 4C's `can_bulk_plan_fixtures` and
`can_create_team_fixture`, because "may this club plan fixtures" is a fixture question 4C owns the
meaning of. This is the same boundary 4B drew when its roster policies went on asking 4A's family
helpers.

**The catalogue was already correct.** All ten J.8 keys exist, ACTIVE, with the scopes and bundles
J.8 specifies; Slice 3 seeded them and they are live in production. 4D adds no capability and
changes no bundle. It is a pure resolver migration.

---

## 2. What the gates used to ask

| gate | asked | now asks |
|---|---|---|
| `can_organise_competition` | `can_bulk_plan_fixtures` (4C's Planner gate) | `competition.edition.manage` at the organiser club |
| `can_organise_edition` | the above | the above |
| `can_answer_competition_match` | role strings `'CLUB_ADMIN'`/`'FIXTURE_SECRETARY'`, and a raw `team_permissions` read | `competition.match.respond` at club or team |
| `can_manage_tournament` | `is_site_admin()` + the deprecated `calendar.manage` | `tournament.tournament.manage` at club, or `site.support.act_in_club` |
| `can_manage_tournament_entry` | `is_site_admin()` + `calendar.manage` + `can_manage_club_fixtures` | the tournament key, the team's `calendar.event.manage`, or the site master |
| `issue_competition_matches` | `is_club_fixture_administrator()` ×4 | `competition.match.respond` at the participating club |

`internal.is_club_fixture_administrator(uuid)` — a raw-role helper — had exactly those two callers,
so it is **dropped**, not left uncalled. A zero-caller raw-role helper is a hazard: the next person
needing "is this person a club's fixture administrator" would find a raw-role answer before the
canonical one.

---

## 3. Three intended changes, from a shadow comparison

Seven questions × nine personas = 63 pairs, run before anything changed. Two differed; a third
appeared once J.8's site master equivalents were wired in.

**1. A Coach may no longer answer a competition match.** J.8 line 488 gives
`competition.match.respond` to CA and FS at club scope and TM at team scope. A Coach is not on that
list. Answering commits the club to play the match — the same boundary 4C drew when a Coach kept the
right to *raise* a fixture request and lost the right to *answer* one.

**2. A solo-entered Team Manager no longer takes the whole occasion.** The legacy branch granted the
occasion to someone with team authority over *every* entered team. Its own comment states the
intent: *"A U12 manager does not get the parent occasion just because U12 is going."* But when U12 is
the **only** team entered, "every entered team" is satisfied by one team and the U12 manager got the
whole occasion after all — measured as `true`, not inferred. **The rule contradicted its own stated
intent in exactly that case.** J.8 line 490 makes the occasion club-level. This is less a removal
than the rule finally meaning what it said.

**3. Site support may answer a competition match.** J.8 line 488 names `site.support.act_in_club` as
the site master equivalent; the legacy gate gave site support no route in at all. This is a
**widening**, and it is the architecture working as intended — an explicit named capability, not a
role bypass. It is declared rather than absorbed quietly.

### What is preserved, and one place the site master is withheld

`can_manage_tournament_entry` still lets a Team Manager schedule **their own team's** day. J.8
defines no tournament-entry key, so the governing authority there is the product invariant that
created the entry/occasion split in `20270217000000`: *"THIS team only. The whole point of the split:
a U12 admin schedules U12's day and cannot touch U13's."* That invariant is live — measured — and 4D
keeps it, expressing the team branch as `calendar.event.manage` at team scope. AA.3 is still
satisfied: the deprecated `calendar.manage` string and the `has_capability` adapter are both gone.

In `issue_competition_matches` the site master is deliberately **withheld**. That code asks whether
the organiser has in effect already answered on a participating club's behalf; letting site support
silently pre-confirm a match for a club nobody at that club has spoken for would invent consent.

---

## 4. A performance fix, measured rather than assumed

The eight owned policies became canonical the moment `can_organise_edition` did, so no policy
rewrite was needed for correctness. They were rewritten for a measured reason — reading one
edition's 800 matches as its organising Club Admin:

| | |
|---|---|
| pre-4D (`can_bulk_plan_fixtures` inside the gate) | 153.1 ms |
| 4D gate (canonical `internal.can` inside the gate) | **146.5 ms** — no regression |
| 4D gate + the hoist | **1.8 ms** — about 85× |

4D caused no regression; the cost was already there, inherent to asking per row a question that does
not vary per row. The organiser set depends only on *who* is asking, so it belongs in the policy as
an uncorrelated subquery the planner evaluates once per statement as an InitPlan — the fix 4C
applied to `fixtures_select_related`.

`internal.competition_edition_is_public` is deliberately **not** hoisted: J.8 line 482 marks it KEEP,
and the set of publicly visible editions is platform-wide rather than caller-bounded.

A hoist must not change answers, so it was proved not to: for every persona and affected table, the
hoisted policy's row set was compared against the per-row predicate's — **12 comparisons, 0
mismatches**, on a deliberately non-public edition, because with an active edition every persona sees
everything and the comparison would prove nothing.

---

## 5. A regression I introduced, and what found it

I revoked anon's `EXECUTE` on the hoisted helper, reasoning that
`has_table_privilege('anon','public.competition_matches','SELECT')` is `false`, so anon never
evaluates these policies.

**That was wrong.** It is false because anon's grant is **column-level**: the perimeter manifest
classifies `competition_matches` as PUBLIC and grants anon nineteen named columns, which is how
`app/competitions/[slug]` serves the public competition surface. A column-level grant does not
satisfy a table-level privilege test. The manifest had already recorded this for the helper mine
replaces.

The clean boot said "permission denied"; the full battery then said it twice more, in
`competition_matches` and `identity_foundation_and_perimeter` — two pre-existing suites, one of
which carries the named product assertion that *anon **can** see an external-versus-external match*.
That made the diagnosis unambiguous.

The grant is restored and the migration now raises if anon **cannot** execute the helper. The real
tightening 4D does make is elsewhere: `internal.can_organise_edition(uuid)` is no longer named by any
policy, so anon's EXECUTE on it is withdrawn and the manifest moves accordingly.

The lesson generalises: **a perimeter check that only looks for absence is content when a public
surface goes dark.** CM-G4 now asserts both directions.

---

## 6. Release ordering, derived

Both directions were measured:

```
OLD APP gate (calendar.manage, club)        CA=t  TM=f
NEW APP gate (tournament.tournament.manage) CA=t  TM=f
COMPATIBLE: both builds gate this route identically, so neither order can strand a user.
OLD APP SAFE: the calendar.manage adapter row survives 4D.
NEW APP SAFE: tournament.tournament.manage predates 4D (Slice 3 seeded it).
```

4D withdraws no privilege the running application uses and adds no object the new build needs, so
unlike 4C it needs **no staged release**. Migrations still go before the push, because the push is
the deployment.

---

## 7. Evidence

| Proof | Result |
|---|---|
| Full platform battery | **3840 passed, 0 failed, 199 suites** |
| `competition_authority_matrix` (new) | **70 assertions** |
| `competition_authority_races` (new) | 4/4, three consecutive runs |
| Mutation testing | **6 mutants, 6 killed, 0 survivors**, clean restore |
| `authority_helper_retirement` | 40 assertions, every ceiling at the measured floor |
| Browser suites 51 / 52 / 53 / 54 | 19, 17, 14, **22** — three passes; see the limit below |
| Clean boot from empty | 456 migrations, tip `20270363000000` |
| Production-shaped rehearsal | every seeded row identical before and after |

### Retirement, monotonic

`can_organise_edition` policies **8 → 0** · `is_club_fixture_administrator` **gone** ·
`has_capability` bodies 123 → **121** · `is_site_admin` bodies 146 → **144** ·
`can_manage_club_fixtures` bodies 42 → **41** · **PG16 145 → 143** · PG15 130 unchanged.
Nothing increased.

---

## 8. Stated limits

**The §9 unknown-age check.** 4D touches no role grant, no membership transition and no onboarding
path, so it does not make unknown-age staff authority more reachable. The follow-up carries forward
unchanged.

**One browser run in three was not clean.** Passes 1 and 3 were fully green; in pass 2 suite 51
crashed on a signed-out page and suite 54 reported 21/22. Neither reproduces in isolation — 51 has
since run 19/19 three times alone and 54 22/22 three times alone. The occurrence coincided with
other activity on the same database, and these suites are not safe to run concurrently with
themselves: each deletes stale identities by email prefix at startup, so a second run removes the
first run's people mid-flight. That is an operating hazard of the harness rather than a product
defect. No change was made to shared harness code on the strength of a failure that has not happened
again in six runs; it is recorded with a recommended fix (an advisory lock per prefix).

**J.8 defines no tournament-entry key.** The team-scope branch of `can_manage_tournament_entry` is
therefore governed by the product invariant rather than by the design table, and is expressed with
4E's `calendar.event.manage`. If a later slice introduces a `tournament.entry.*` key, that branch
should move onto it.
