# Convergence Step 11 — Match Centre Community + Rewards

**OVALBALL CONVERGENCE STEP 11 — MATCH CENTRE COMMUNITY + REWARDS —
IMPLEMENTATION COMPLETE — BATCH A UAT PENDING.** Nothing released, nothing
pushed, Step 12 not started.

Certified by **targeted acceptance** under the batched cadence. This step is not
fully release verified, production verified or whole-platform accepted, and must
not be described as any of those until Batch A certification passes. §8 says what
was run; §9 says what Batch A still owes.

| | |
|---|---|
| Starting checkpoint | `e1be6af` (Step 10, Batch A UAT pending) |
| Archaeology | `docs/product/CONVERGENCE_STEP_11_ARCHAEOLOGY.md` |
| BEFORE/AFTER matrix | `docs/product/CONVERGENCE_STEP_11_FUNCTIONALITY_MATRIX.md` |
| FUNCTIONS BEFORE | **33** |
| FUNCTIONS AFTER | **55** |
| FUNCTIONS LOST | **0** |

---

## 1. What the archaeology changed about the plan

**None of it existed.** Not one poll, vote, nomination, Kudos, award or badge
record, anywhere. The ledger had said so since Step 7 and the search confirmed
it: `kudos` and `beast` appear nowhere, `vote` and `award` hit only Rugby Hub
prose about 1895 and about penalties, `nomination` belongs to safeguarding
appointments, and **`reward` belongs to referral credit, which is money**. The
backlog survives as vocabulary with no specification — no prior decision about
audience, anonymity, closure or youth safety to honour.

Two things followed. First, the five award names are **five electorates for one
concept**, so there is one award engine rather than five models. Second, and
larger:

**Match Centre could not say what happened.** `home_score`, `away_score` and
`result_status` are recorded on the fixture and rendered in Fixture Management,
the admin editor, the Calendar and the result confirmation flow — and nowhere on
the canonical page for the match. Attaching recognition to a page with no result
on it would have made voting the most prominent thing about a finished game,
which §28 forbids. So Step 11's first act is to give a played match its
identity: **the hero says the score, where the fixture used to say "VS"**,
read-only, from the value the existing workflow produced.

---

## 2. The canonical model

Two concepts, kept apart because their lifecycles genuinely differ, and
converged where they were the same thing wearing five names.

**An award** is a decision with a lifecycle: one `match_awards` row per
(fixture, team, category), opened by staff on a played match, voted in by a
server-derived electorate, closed to an outcome. **Kudos** is ungated positive
recognition one person gives another: no electorate, no opening, no closing, no
winner. Merging them would have been convergence for the sake of a shared
button.

### The electorate follows the side's age

The recognition that is **Parents' Player** on a youth side is **Players'
Player** on an adult one. Same canonical category, same key; what changes is who
is entitled — the guardians of the participating players, or the players
themselves. An adult side is `teams.category = 'senior'`; **colts and every
youth age grade, U17 and U18 included, keep the parents' electorate**, which is
the locked product decision and is asserted by name (`A3`, `A7`).

| category | electorate | youth name | adult name |
|---|---|---|---|
| `FAMILY_OR_SELF_PLAYER` | guardians of the side, or its adult players | Parents' Player | Players' Player |
| `COACHES_PLAYER` | the side's **active COACH** assignments | Coaches' Player | Coaches' Player |
| `OPPOSITION_PLAYER` | the **other** side's coaches | Opposition Player | Opposition Player |
| `WORK_ETHIC` | the side's coaches | Work Rate | Beast |

The last row is how the backlog's "Beast" survives. It is rugby culture and it
stays for adults; a children's side is offered **Work Rate**; and a club that
calls it something else says so in its own display override.

### Names are canonical; the display name is a team's own

A team may override the name it *displays*. That string is presentation only:
the canonical category, its key and its electorate are untouched, and the
migration **fails if any function outside the renderer, the setter and the staff
configuration reader so much as mentions the column** — with a second check that
no eligibility or administration function mentions it at all. `H1`–`H4` prove a
rename changes the label, leaves the catalogue alone, moves nobody into or out
of the electorate, and does not leak to another team.

### Totals to staff, the winner to the team

Closing tallies the votes server-side. A clear winner is recorded; **a tie is
reported as a tie** rather than resolved by a rule nobody agreed; an award nobody
voted in says so. The team is told **who won and never by how much** — the count
is returned only to staff and only once closed (`F1`–`F3`). `match_award_votes`
has **no select policy at all**: the ballot is known to the server, which needs
it for eligibility and for one-vote-per-person, and is read by no browser
session, including the staff who see totals.

### Recognition is not an economy

There is no points table, no currency and **no endpoint that grants a badge**,
because there is nothing to grant: a player's recognition is derivable from award
and kudos rows that already happened, each keeping the fixture and team it
belongs to. The migration fails if a `points`, `amount`, `balance`, `credit` or
`pence` column ever appears in either table. The reader that would put that
history on a person's profile belongs to the **Player profile** surface, which
this step is told not to redesign — so it is named here, not shipped with no
caller.

---

## 3. Authority — all server-derived, none of it from a badge

| action | authority |
|---|---|
| open, close, remove recognition | `internal.can_administer_match_community` → `internal.can_manage_fixture_side`, the **same** authority Match Centre already calls `can_manage_fixture` |
| switch a category on, set its display name | `team.news.manage` at team or club scope — the granted capability that already describes "the people who speak for the team" |
| vote (family) | an `active` guardian of an `ACTIVE` roster player, or the adult player themselves |
| vote (coaches) | an `ACTIVE` `COACH` assignment on an `ACTIVE` membership |
| vote (opposition) | an `ACTIVE` `COACH` on the other side |
| give Kudos | a family, player or staff relationship to that side |

**`team.community.manage` was left alone, deliberately.** It is the key this
ought to be: `capabilities` holds it, the Club Digital Home's migration says team
news "mirrors" it, and `who_is_speaking_is_not_who_pressed_send` calls it. But
**no bundle grants it and no key map mentions it** — its only caller sits in an
`or` chain beside `can_address_team_audience` and `is_full_site_admin`, so the
clause is always false and the feature works anyway. Wiring it into bundles would
silently change who may speak **as a team in Messenger**, which is not Step 11's
to change. Recorded as a finding in §10; not activated here.

**A Team Manager is not a Coach.** §12 asked for this explicitly and the
electorate honours it: `D4` proves a Team Manager is not promoted into the
coaches' award, even though the two share most team capabilities.

**Administration is not participation.** `K1`–`K6`: a parent is offered no
configuration at all, staff are, a parent cannot open, close or configure, and
another club's admin sees no community on a match that is not theirs.

---

## 4. Minors

The design's binding constraint, and it is a measurement rather than a
preference: on the review world **2 of 26 under-18 players have an account**. A
"Players' Player" cast by children would be an empty feature for the teams that
matter most and, where it worked, a way to canvass children for votes. So youth
recognition is chosen by the adults who were there, and:

- no public totals, and no totals to the team at all;
- no ranking, and therefore no implicit "who came last";
- nothing negative to give — the Kudos vocabulary is closed and positive;
- no free text about a child anywhere in the schema;
- community data is absent from `public_club_fixtures`, which still carries no
  score and no participants.

Step 12 owns safeguarding and age-grade. Nothing here should need removing then.

---

## 5. Lifecycle

`status` is `Planned · Booked · To Be Determined · Annual Holiday · Festival ·
Lancashire Cup · Cancelled · Completed`; `result_status` is `none ·
awaiting_confirmation · final · disputed · amendment_pending ·
external_recorded · unverified`. **There is no LIVE state and none was
invented.** There is also **no `Postponed` fixture status** — postponement exists
for *competition matches* only — so "postponed" was tested as what the schema
actually supports.

Recognition requires `Completed`. Opening on anything else is refused (`C1`), and
a fixture that **stops** being a played match stops taking votes rather than
quietly collecting them (`C6`, proved by cancelling one mid-award). An upcoming
Match Centre renders no community surface at all, asserted in the browser
(`A5`), and still says "VS" (`A6`).

---

## 6. The rugby is untouched

No function in this step can write to `public.fixtures`, and the migration
**fails if one ever could** — checked by source, again in the SQL suite (`I2`),
with the fixture's own score and status re-read after every vote, kudos and
closure and found exactly as recorded (`I1`). Availability stays entirely
separate: `player_fixture_attendance` is operational attendance truth and is not
a poll, and nothing in this step reads or writes it.

---

## 7. Storage, moderation and history

Kudos removal is **soft**: the row leaves the surface immediately and keeps
`removed_by` and `removed_at`, so the history of the moderation survives what the
page stops showing (`G8`–`G10`). A giver withdrawing their **own** thank-you is a
plain delete — there is no moderation history worth keeping about somebody
changing their own mind — and it reaches nobody else's (`G6`, `G7`). Both are
addressed the way the surface shows them, by match and player, because the
aggregate view names no giver and hands the page no row id.

Historical truth: a won award keeps its fixture and team after the player leaves
the side (`J1`), while **current** entitlement follows the current roster (`J2`),
and a winner leaving *as the award closes* does not rewrite it (`R5`).

---

## 8. STEP 11 TARGETED ACCEPTANCE

### Step 11's own proof

| what | result |
|---|---|
| `step11_match_community` (SQL, new) | **59 passed, 0 failed** |
| `match_community_races` (TS, new) | **5 races, 0 failed** |
| `79-match-community-journey` (browser, new) | **24 passed, 0 failed**, exit 0 |

The browser journey walked **1440 → 390 → 320**: no horizontal overflow at either
phone width, the score and the recognition both kept on a phone, axe **1 total, 1
pre-existing and declared, 0 introduced**, no uncaught page errors, and its own
cleanup asserted. The declared violation is the shell unread badge (L22);
measured on the same page with the panel absent, the page's violations are
identical.

The races, in one line each: a double submission stays one vote; two voters both
land; a vote racing the close is counted or refused and a closed award never
gains one; two admins closing at once produce one outcome, one winner and one
closer; and the winner leaving as it closes does not rewrite the award.

### Migration-specific verification

`20270522000000` adds six tables, one nullable column on `club_articles`, eight
`internal` helpers and twelve browser-facing RPCs, and **checks itself**: no
community function writes to `fixtures`, every mutation meets the canonical
session gate, one-vote-per-person is a unique constraint, `match_kudos` has no
free-text column, no points or currency column exists in either recognition
table, the display override is read nowhere that decides anything, and `anon`
reaches none of it. Applied incrementally to the current schema per the batched
cadence; its **fresh-database assertions are checked into
`scripts/isolated-clean-boot.sh`** and wait for Batch A.

Grants, measured: the twelve public RPCs are `authenticated` + `service_role`,
**`anon` on none**, and the eight `internal` helpers are executable by **nobody**.
`security_perimeter_guard` (6), `identity_foundation_and_perimeter` (39),
`platform_rls_sweep` (10) and `definer_rpc_session_contract` (37) all pass, and
the perimeter manifest declares every new RPC and all six tables —
`perimeter_manifest` (12 assertions) passes, including that the ballot's select
posture is `none`.

### Regression set

| suite | result |
|---|---|
| `step10_team_experience` · `step9_family_and_availability` · `step8_operational_access` | 29 · 41 · 69 |
| `match_centre_core` · `match_centre_capabilities` · `calendar_match_centre_link` | 22 · 7 · 18 |
| `cross_club_isolation_matrix` · `family_isolation_matrix` | 87 · 84 |
| `club_digital_home` | 64 |
| **every TypeScript suite** — 80 suites | **772 passed, 0 failed** |
| `50-team-home-journey` · `49-family-availability-journey` · `53-fixture-authority` (browser) | 22 · 25 · 14, all exit 0 |

`tsc --noEmit` clean. `npm run build` compiles successfully. Lint: **5 errors,
all pre-existing in files this step does not touch**, unchanged from Step 10.
Static guards: **12 of 12 pass**, including `verify-match-centre-shared` (the
community layer is part of the one shared surface, not a second one) and
`verify-browser-suite-registry` (the new suite registers itself).

**Both isolation matrices initially failed, correctly, and that is the point.**
`cross_club_isolation_matrix` and `family_isolation_matrix` refuse to pass while a
club-, team- or player-linked table is unclassified; they named `match_awards`,
`match_award_votes`, `match_kudos` and `team_award_category_settings`. Classified
to the fixture domain (`4c`) and the teams domain (`4b`) respectively, with the
reason written beside them, after which both pass.

---

## 9. Deferred to Batch A certification

Not run, and not claimed: the complete unsplit canonical gate; the full-chain
clean boot from empty; the production-shaped rehearsal from the production tip;
cross-domain Team ↔ Match Centre ↔ Family ↔ Fixture ↔ Safeguarding proof; browser
integration UAT across Steps 10–12 together; the accumulated deferred manual
review checkpoint.

No early-escalation condition was met: no foundational auth invariant changed, no
migration-order uncertainty arising from this step, no shared identity
corruption, no unexplained regression attributable to it, no harness integrity
problem, no security perimeter uncertainty.

**Preserved for the rehearsal:** Step 11 contributes one migration,
`20270522000000`. It creates new tables and one nullable column, performs **no
backfill and no data transformation**, and so needs nothing measured from this
step beyond its position in canonical order.

---

## 10. §46 — the original backlog, dispositioned

Nothing disappears.

| backlog item | disposition |
|---|---|
| **Polls** | **SUPERSEDED** — by the award engine, which is a poll with a server-derived electorate and a roster-shaped ballot. Creator authority, audience, opening, closing, one response, changing a response, result visibility, fixture/team scope and privacy are all proven in `step11_match_community`. **Club-wide polling remains a separate product** and was not redesigned. |
| **Kudos** | **COMPLETE** — a fixed positive vocabulary, giver-withdrawable, staff-removable, aggregated and unattributed. |
| **Awards** | **COMPLETE** — one canonical catalogue, per-team switches, per-team display names. |
| **Parents' Player** | **COMPLETE** — and it is the same canonical category as Players' Player, with the electorate following the side's age. Retained for U17/U18 by explicit decision. |
| **Players' Player** | **COMPLETE** — the adult form of that category. Not offered as child voting on a youth side, for the measured reason in §4. |
| **Coaches' Player** | **COMPLETE** — active `COACH` assignments only; a Team Manager is not promoted into it. |
| **Opposition Player** | **COMPLETE where an opposition actor exists**, and **DEFERRED — dependency named** where it does not. Against `raw_opposition_text` there is no authenticated opposition representative; the award cannot be opened and says why. The missing dependency is an authenticated identity for a club that is not on Ovalball. No public voting URL was invented. |
| **Beast / work-ethic** | **COMPLETE, reworded by age** — `WORK_ETHIC` displays as Beast for adults and Work Rate for children, and a club may call it its own thing. |
| **Badges** | **SUPERSEDED** — recognition history is derived from award and kudos rows, not granted. No badge table, no grant endpoint. |
| **Rewards** | **NOT APPLICABLE as an economy** — no points, no currency, no financial liability; `reward` remains the referral credit domain and is untouched. |
| **Attendance distinction** | **ALREADY COMPLETE — VERIFIED** — availability is operational truth, untouched and unmerged; Step 9's suite still passes 41. |
| **Youth safety / privacy** | **COMPLETE for this step** — §4. Step 12 owns the wider standard. |
| **Match Centre community** | **COMPLETE** — one shared role-aware surface, on the canonical fixture, below the rugby. |
| **Post-match write-ups** | **ALREADY COMPLETE — VERIFIED, now connected** — `club_articles` has carried `MATCH_REPORT` since the Club Digital Home; it had no fixture. One nullable column and one link, no second article model. |

---

## 11. Findings recorded, not fixed

### 11.1 `team.community.manage` grants nothing

The capability exists, three migrations reference it, and **no bundle or key map
grants it**. Its one live caller is an `or` clause that is always false, so
nothing is broken today. It is the natural home for community administration, and
activating it would change Messenger's "who may speak as a team" as a side
effect — so it is named for whoever owns that decision rather than wired here.

### 11.2 Two more stale SQL suites, outside the gate

`fixture_results` (7 of 22) and `fixture_status_lifecycle` (0 assertions) both
fail in their own **setup**, on `fixtures_owning_team_id_fkey` and
`club_memberships_user_id_fkey` — seed data referring to rows that no longer
exist. Neither references any Step 11 object; both are among the suites the
canonical gate does not run. Added to the L25 population rather than repaired
here, exactly as the four found in Step 10 were.

### 11.3 L25 — SQL suite governance, remeasured

| | |
|---|---|
| SQL suite files | **285** (284 at Step 10, plus `step11_match_community`) |
| executed by the canonical gate | **181** (180, plus the same) |
| **not executed** | **104** |
| known stale among them | **6** — `player_guardian_security`, `team_lifecycle`, `capability_engine`, `team_scoped_fixture_requests` (Step 10) and now `fixture_results`, `fixture_status_lifecycle` |

Step 11 did not wire the 104 in, delete any, declare any obsolete by filename, or
repair the stale ones — and does **not** claim the canonical gate executes every
repository SQL suite. Step 11's own permanent suite is registered in the gate and
was executed by this acceptance. The declaration model (`CANONICAL-GATE`,
`SUPERSEDED`, `RETIRED`, `SPECIAL-PURPOSE`, `UNVERIFIED`, each with an owner) and
a runner that detects an undeclared suite remain **Batch A's** to land before its
canonical-gate claim means what it says.

### 11.4 Carried forward untouched

`46-family-authority` still cannot run: it crashes in its own cleanup, deleting
teams before the memberships that reference them, blocked by residue created
2026-09-20. No row was hand-deleted to get a green run. The **local migration
history drift** remains OPEN: history tip `20270430000000`, the 21 rows
unrepaired, the persistent UAT database not reset, its 118 identities intact.
`20270522000000` was applied incrementally to the current schema, which extends
that drift by one file by the same mechanism, recorded here rather than papered
over.

---

## 12. DEFERRED MANUAL REVIEW CHECKPOINT

Manual review stays deferred. When it happens, the useful experiences are:

1. **A played match, as a parent.** The hero says the score. Below the rugby,
   "Parents' Player" offers the side's players; choose one; reload; the choice is
   still there. Give Kudos from the list. Take it back.
2. **The same match, as team staff.** Switch an award on, rename it to whatever
   the club calls it, open voting, close it. The winner is named; the count is
   marked *staff only*.
3. **An upcoming match, as anybody.** No recognition at all, and the hero says
   "VS".
4. **An away match against a club that is not on Ovalball.** The opposition award
   is offered as unavailable, with the reason.
5. **A phone at 390 and 320.** Both the score and the recognition survive.

The persistent review world was **not** rebuilt and **no persistent persona was
mutated**: every automated suite here seeds and removes its own actors and data,
and the residue checks after each run read zero. No persistent-world enrichment
was made, so there is none to record.

---

## 13. Bank status

**IMPLEMENTATION COMPLETE — BATCH A UAT PENDING.** No release. No push. Step 12
not started and not authorised.
