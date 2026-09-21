# Convergence Step 12 — Rugby Safeguarding + Age-Grade

**OVALBALL CONVERGENCE STEP 12 — RUGBY SAFEGUARDING + AGE-GRADE —
IMPLEMENTATION COMPLETE — BATCH A UAT PENDING.** Nothing released, nothing
pushed, Step 13 not started and not authorised.

| | |
|---|---|
| Starting checkpoint | `83edbe5` (Step 11, Batch A UAT pending) |
| Archaeology | `docs/product/CONVERGENCE_STEP_12_ARCHAEOLOGY.md` |
| BEFORE/AFTER matrix | `docs/product/CONVERGENCE_STEP_12_FUNCTIONALITY_MATRIX.md` |
| FUNCTIONS BEFORE | **52** |
| FUNCTIONS AFTER | **58** |
| FUNCTIONS LOST | **0** |
| Migration | `20270523000000_a_club_can_see_who_is_in_the_right_age_grade.sql` |

---

## 1. Archaeology findings

**Nearly all of it existed, and almost none of it was surfaced.** One search
settles the step's shape: **no file in `app/`, `components/` or `lib/` called
`resolve_player_age_grade` or `resolve_player_regulatory_age`** — the two
canonical age-grade resolvers. The Team page showed no eligibility and no
attention state; a parent had nowhere to see their own child's position; and a
coach's only route to the answer was a date of birth they should not need.

So Step 12 adds **no rules**. It adds two readers that ask the existing
resolvers, and one canonical helper that Match Centre now shares.

Reconciliations with this handoff, current disk winning:

- **The SO authority is not `club_safeguarding_officers`.** Authority lives in
  `role_assignments` with `role_key = 'SAFEGUARDING_OFFICER'` and a
  `confirmation_state`; `club_safeguarding_officers` is the club's *published
  contact record* (`officer_type`, `contact_name`, `contact_email`, statuses
  `not_invited · invite_sent · active · inactive`) and holds **zero rows** on the
  review world. Two things called the same name.
- **`§10`'s "make the pending state understandable" is already done.**
  `/club/settings/safeguarding` already splits pending from confirmed and shows
  `PENDING_CONFIRMATION_EXPLANATION`. Nothing was added.
- **§42's workspace question answers itself.** A dedicated workspace is not
  justified; the officer's surfaces exist and navigation follows the jobs, so no
  route was created.

## 2. Canonical age model

DOB is stored; age is derived; **the season comes from the register**.

| question | canonical answer |
|---|---|
| which season? | `internal.resolve_season_for_date(rugby_code, date)` over `public.seasons` |
| which school year is age measured at? | `internal.regulatory_school_year_start(rugby_code, season)` |
| what age grade is this player? | `internal.resolve_player_age_grade(code, season, dob)` → `canonical_category`, `canonical_age_group`, `age_grade_cutoff_date`, `status` |
| what is their regulatory age? | `public.resolve_player_regulatory_age(...)` → number, label, window, `governing_reference` |
| is this side adult? | `internal.team_is_adult_side(team)` — `teams.category = 'senior'`, the only open-age marker the canonical identity has |
| is this person an established adult? | `internal.person_is_established_adult` |

**Season-age, not age today** (§14), and the cutoff is **31 August** for the
seasons in the register — measured, not assumed: the suite reads the cutoff *from*
the resolver rather than encoding a governing-body rule it has no business
knowing. **Age-grade is never derived from a team name** (§13): with no DOB the
resolver returns `DOB_REQUIRED` and says the grade "must never be inferred from
the team they currently play for".

## 3. Unknown-age reconciliation (D-S5-1)

Recovered from `docs/identity-auth/IDENTITY_AUTH_DECISION_RECORD.md` and left
exactly as decided. `internal.person_is_established_adult` is
`recorded DOB is not null AND not internal.person_is_minor(user)` — **one
predicate**, missing or minor is false, adult is true, and
`internal.person_is_minor` is untouched because D-S4-4 reads it. No second age
predicate was created, no DOB requirement was added at signup, nothing historical
was stripped, and Step 12 gates nothing new: it only **reports**.

## 4. Safeguarding Officer authority and eligibility

The `SO` bundle was already least-privilege and is unchanged: safeguarding
welfare, dispensation, transfer, contact and conversation capabilities, plus
**view-only** people, player-profile, roster, team, fixture, Match Centre,
calendar, venue, tournament, documents and club profile. **No** club
administration, **no** fixture operations, **no** roster management, **no**
finance. Title is not authority; the bundle is.

**The confirmation seam holds in the capability engine, verified rather than
assumed.** Asked as the review world's pending officer at their own club:
`safeguarding.welfare.view` **false**, `safeguarding.dispensation.view`
**false**, `people.member.view` **false**. `safeguarding.contact.view` is true and
correctly so — every bundle holds it (`CA CO FS MB PG PL SO TM VO`), because a
club's safeguarding contact is meant to be findable. `internal.active_safeguarding_officer_ids`
requires `ra.state = 'ACTIVE'` **and** `cm.state = 'ACTIVE'` **and**
`confirmation_state = 'CONFIRMED'`, asserted in the suite (`H1`–`H3`).

## 5. Priya Devlin — the pending state, preserved

`review.step2.officer@ovalball.test` is Priya Devlin, DOB `1986-09-03`, and her
assignment at *Step 2 Review RFC* reads **`state = ACTIVE`,
`confirmation_state = PENDING_CONFIRMATION`, `confirmed_at = null`,
`confirmed_by = null`**. Reading `state` alone says "ACTIVE" and misleads; the
seam is a separate column by design.

**Why it exists:** she is between the nomination and the **AN-6 Ovalball
confirmation**. Her DOB establishes adulthood, so D-S5-1 is satisfied; the
outstanding step is the confirmation itself, and the legitimate resolution is
`public.confirm_safeguarding_officer` by an authorised Ovalball actor through the
site safeguarding surface. **Not a repair, not a backfill.** Her row was not
touched, and every automated proof here uses disposable actors.

## 6. Dispensation, and age-grade eligibility

The existing model was recovered whole and **nothing was rebuilt**:
`player_team_dispensation` with the chain **REQUESTED → SOURCE TEAM APPROVAL →
CLUB APPROVAL → GOVERNING BODY APPROVAL → APPROVED**, stage-order enforcement,
per-stage authorisation, cross-club rejection, revocation, an expiry sweep, and
UI at `/club/player-moves`. Coach and Team Manager acquire no approval authority
from Step 12 — it adds no mutation at all.

**A dispensation is not a DOB override** (§17): the status reader reports an
approved dispensation as what it is, and asserts (`G1`, `G2`) that the recorded
date of birth is unchanged by it.

## 7. What each person now sees

**Coach / Team Manager** (§19, §57) — on their own team, through
`team.roster.view` and nothing more: the players who need attention, each as a
**status and a sentence**. Not a date of birth, not an age, not a medical field,
not a case note — asserted on the function signatures in the migration, in the
suite (`C1`) and in the browser (`A4`, `A5`, `D3`). A settled player is never
listed (`A7`, `C3`), so an ordinary week is an empty panel rather than a roster to
read as a file on each child.

**Parent / Guardian** (§20, §56) — their own child's position in the same words,
beside who they are to the team, with the honest line that the club handles it.
They are not shown the club's attention list (`B2`), another family's child
(`B3`, `D3`), or any date of birth (`B4`). Guardianship confers no safeguarding
authority.

**Player** (§21) — an adult player may ask about themselves through the same
reader; authority comes from `players.user_id` or an active guardian link, never
from a fabricated guardian context.

**Statuses** (§43) are only the ones the data supports: `ELIGIBLE`,
`OUTSIDE_AGE_GRADE`, `DISPENSATION_PENDING`, `DISPENSATION_APPROVED`,
`AGE_EVIDENCE_REQUIRED`, `AGE_GRADE_NOT_ESTABLISHED`, `SEASON_NOT_ESTABLISHED`,
`UNKNOWN_TEAM`. Nothing says "invalid", and nothing labels a child. **No health
or risk inference** exists anywhere (§44): the product reports the record.

## 8. Match Centre convergence (§35)

Step 11 decided "is this side adult" locally by reading `teams.category`. Step 12
makes `internal.team_is_adult_side` the canonical answer and
`internal.match_side_is_adult` **delegate** to it — same name, same signature,
same answer, one place. The migration asserts the two agree **for every team that
exists**, and so does the suite (`E1`). U17/U18 remain youth sides and keep the
family electorate (`E2`, `E3`), so the agreed Step 11 outcome is unchanged —
`step11_match_community` still passes **59/59** and its browser journey **24/24**.

## 9. Boundaries held without new work

**Age-18 interaction** (§22–23): Step 9's transition is untouched. Historical
decisions stay historical — a dispensation is a record of a decision, and the
status reader recalculates *current* position from canonical rules each time it is
asked, so nothing needs deleting at the boundary. No background processing was
added; the deferred scheduler remains Step 9's recorded future work.

**Consent** (§24): the 16–17 self-availability consent was **not** reused. Step 12
records no consent and reads none.

**Medical / emergency** (§25): archaeology only. No field was read, widened or
surfaced, and the migration fails if an operational reader ever returns one.

**Safeguarding notes / cases** (§26): not touched, not exposed, not reachable
from Team, People or any Step 12 reader.

**Public privacy** (§27): Step 12 adds no public surface.
`public_club_fixtures` still carries no score and no participant data, and both
new readers are `authenticated`-only with `anon` on neither (`D7`).

**Mini Rugby** (§37), **Users & Permissions** (§28), **invitations** (§29),
**joining** (§30), **Site Admin** (§31), **Club Admin** (§32), **training**
(§34), **Rugby Hub** (§38), **regulatory sources** (§39) and the **Governing Body
boundary** (§40): no change. Step 12 created no capability, no role, no
invitation path, no regulatory fact and no governing-body surface. Hub content
remains educational and decides nothing: eligibility comes from the resolvers and
`enforce_fixture_age_eligibility`.

**Code-specific guidance** (§6) needed no new machinery:
`get_rugby_hub_safeguarding_by_identity` is already identity-aware, and the
status sentences carry the rugby code implicitly by resolving through the team's
own `rugby_code`.

## 10. Privacy classification for Step 12 data

Step 12 adds **no table and no column**. Its two readers are classified as:

| reader | audience | classification |
|---|---|---|
| `team_age_grade_attention` | holders of `team.roster.view` at that team, or `site.clubs.view` | **TEAM OPERATIONAL** — status and player name only; no evidence |
| `my_player_age_grade_status` | the player themselves, or an active guardian | **FAMILY** — the same status vocabulary, own player only |

Both are declared in `supabase/security/perimeter-manifest.json`, and
`perimeter_manifest` (12 assertions) passes.

## 11. STEP 12 TARGETED ACCEPTANCE

### Step 12's own proof

| what | result |
|---|---|
| `step12_safeguarding_and_age_grade` (SQL, new) | **34 passed, 0 failed** |
| `age_grade_status_races` (TS, new) | **3 races, 0 failed** |
| `80-safeguarding-age-grade-journey` (browser, new) | **22 passed, 0 failed**, exit 0 |

The browser journey ran **1440 → 390 → 320**: no horizontal overflow, the
attention state and its reason survive both phone widths, **no date of birth at
any width**, axe **1 total, 1 pre-existing and declared, 0 introduced**, no
uncaught page errors, and its disposable player removed with the removal
asserted.

**Age-boundary matrix** (§48), with deterministic dates and a fixed reference date
of `2026-11-15`: the cutoff is read from the resolver, and the day before, the day
of, and the day after the 31 August boundary are asserted — same school year
either side of the boundary date, a different grade the day after (`A1`–`A3`). The
boundary is exercised twelve school years back, because a baby born on the
boundary has no age grade at all and would prove nothing, and because a future
date of birth is refused by the schema — correctly.

**Races** (§50): Step 12 adds no mutation, so its race surface is read-against-
write. A status read racing a dispensation approval returns exactly one coherent
answer and never `ELIGIBLE` by accident; a player leaving the team as the status is
read simply stops being listed, and reading a status alters no decision behind it;
two simultaneous readers agree.

**Fail-closed null semantics** (§49): an unknown team is named rather than treated
as eligible, and an unknown player is never reported eligible (`F1`, `F2`).

### Regression set

| suite | result |
|---|---|
| `safeguarding_authority_matrix` | **130** |
| `safeguarding_officer_foundation` · `_security` · `_dispensation_notifications` | 24 · 36 · 8 |
| `minor_prohibitions` · `age_eligibility_matrix` · `player_age_resolver` · `player_playing_pathway` | 11 · 44 · 21 · 20 |
| `step11_match_community` · `step10_team_experience` · `step9_family_and_availability` · `step8_operational_access` | 59 · 29 · 41 · 69 |
| `family_isolation_matrix` · `cross_club_isolation_matrix` · `platform_rls_sweep` | 84 · 87 · 10 |
| `definer_rpc_session_contract` · `security_perimeter_guard` | 37 · 6 |
| **every TypeScript suite** — 81 suites | **775 passed, 0 failed** |
| `50-team-home-journey` · `79-match-community-journey` · `49-family-availability-journey` (browser) | 22 · 24 · 25, all exit 0 |

**750 SQL assertions, 0 failed** across the acceptance and regression set.
`tsc --noEmit` clean. `npm run build` compiles successfully. Lint **181 problems,
5 errors, 176 warnings — byte-identical to the Step 11 baseline, zero
introduced** (one warning this step briefly added, an unused test helper, was
removed rather than carried). Static guards **12 of 12**, including
`verify-browser-suite-registry` (the new suite registers itself: 53 in the gate,
28 declared exempt, 81 on disk).

## 12. Migration and history drift

One migration, `20270523000000`. It creates **no table and no column**: four
functions, two of them browser-facing. It **checks itself** — no operational
reader may return a date of birth, an age or anything medical; both readers meet
the canonical session gate; the electorate adult test and the canonical one must
agree for every team; the season must resolve through the register; nothing writes
to `players`, `teams`, `fixtures` or `player_team_dispensation`; `anon` reaches
neither reader; and **both canonical resolvers must exist where the migration
expects them** — added after a schema-qualification slip proved that a dangling
reference is otherwise a runtime error for whoever opens the page first.

Its **fresh-database assertions are checked into `scripts/isolated-clean-boot.sh`**
and wait for Batch A. Applied incrementally to the current schema per the batched
cadence.

**Migration history drift remains OPEN and unrepaired**: tip `20270430000000`,
521 rows, cause **UNKNOWN**. No repair, no `schema_migrations` edit, no reset, no
persona destroyed. This step's migration was applied incrementally, extending the
drift by one file by the same mechanism, recorded rather than papered over.

## 13. L25 — Step-12-owned SQL suite dispositions

Five Step-12-adjacent suites sit outside the canonical gate. All five were **run
deliberately**, and none is simply stale:

| suite | measured | disposition, on evidence |
|---|---|---|
| `fixture_age_eligibility` | 11 passed, 12 failed | **SPECIAL_PURPOSE** — its own header says *"NOT a migration … Run by hand, AFTER permission_matrix.sql"* |
| `gender_age_grade_rules` | 8 passed, 11 failed | **SPECIAL_PURPOSE** — declared to need `permission_matrix.sql` **and** `season_rollover.sql` |
| `player_team_dispensation` | 0 assertions, setup FK | **SPECIAL_PURPOSE** — declared manual, transaction-scoped |
| `senior_cohort_graduation` | 0 assertions, setup FK | **SPECIAL_PURPOSE** — declared manual, transaction-scoped |
| `player_movement_eligibility_resolver` | 0 assertions | **SPECIAL_PURPOSE** — declared manual |

**And the documented procedure cannot work.** `permission_matrix.sql` ends with
**`rollback;`**, so running it first leaves nothing behind for the suites that say
they depend on it (`season_rollover.sql` ends with `commit;`). Neither prerequisite
is in the gate either.

That is why neither "wire them in" nor "call them retired" would have been
honest. They are **declared special-purpose suites whose prerequisite discards its
own seed** — a repairable dependency, recorded for Batch A with the evidence, not
renamed to look resolved. Step 12 wired in **only its own** suite, and ran it.

**Inventory now, measured:** **286** SQL suite files, **181** executed by the
canonical gate, **105 not executed**.

**And measuring it found a defect in the gate itself.** The `SUITES` array listed
`site_admin_profile_matrix` **twice**, so the canonical gate ran that suite twice
and counted its assertions twice — inflating the very total Batch A is meant to
rely on. The duplicate is removed, leaving 181 entries and 181 distinct suites.
It is recorded here rather than quietly fixed, because an honest gate claim
depends on the gate not double-counting: any earlier reported assertion total
includes one suite twice.

The declaration mechanism itself (`CANONICAL_GATE ·
SPECIAL_PURPOSE · SUPERSEDED · RETIRED · UNVERIFIED`, with an owner, plus a runner
guard that detects an undeclared suite) is **prepared, not implemented** — §63's
explicit fallback, because doing it properly means classifying 104 files on
evidence rather than by filename, and that is Batch A's job.

`46-family-authority` remains **explicitly open**: it still crashes in its own
cleanup, deleting teams before the memberships referencing them. No audit history
was hand-deleted, no FK weakened, no teardown broadened. Step 12 does not own its
fixture architecture.

## 14. Batch A remaining work

Deferred, and not claimed: the complete unsplit canonical gate; the full-chain
clean boot from empty; the accumulated production-shaped rehearsal from the
production tip; SQL-suite declaration and governance closure sufficient for an
honest gate claim; cross-domain Team ↔ Family ↔ Fixture ↔ Match Centre ↔
Safeguarding integration UAT; mobile; accessibility; security and privacy;
persistent review-world verification; and the accumulated deferred manual review
checkpoint.

No early-escalation condition was met: no foundational auth invariant changed
(D-S5-1 and the SO seam were verified, not altered), no migration-order
uncertainty from this step, no shared identity corruption, no unexplained
regression, no harness integrity problem, no perimeter uncertainty.

## 15. DEFERRED MANUAL REVIEW CHECKPOINT

Manual review stays deferred. When it happens:

1. **A coach on their own team.** The Age Grade — Needs Attention panel names who
   needs a look and why, in words, with no date of birth on the page. A team with
   nothing outstanding shows no panel at all.
2. **A parent on the same team.** Their own child's position in the same words,
   and no sign of the club's list or anybody else's child.
3. **Priya Devlin, at Step 2 Review RFC.** `/club/settings/safeguarding` shows her
   as pending with the explanation. The legitimate resolution is an Ovalball
   confirmation from the site safeguarding surface — deliberately **not** performed,
   so the state survives for review.
4. **An away club's admin on somebody else's team.** No attention panel, no player
   named.
5. **A phone at 390 and 320.** The attention state and its reason survive; the date
   of birth still does not appear.

The persistent review world was **not** rebuilt and **no persistent persona was
mutated**: every suite here seeds and removes its own actors and data, and the
residue checks after each run read zero. No persistent-world enrichment was made,
so there is none to record.

## 16. Bank status

**IMPLEMENTATION COMPLETE — BATCH A UAT PENDING.** No release. No push. Step 13
not started and not authorised. Batch A certification is due next, and not
automatically.
