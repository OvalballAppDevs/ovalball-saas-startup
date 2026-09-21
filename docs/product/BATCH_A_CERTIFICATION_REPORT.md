# Ovalball Product Convergence — Batch A — Technical Certification Report

**VERDICT: BATCH A — NOT YET TECHNICALLY ACCEPTED.**

The frozen-tree complete unsplit canonical gate **exited 1**. §51's pass
condition requires exit 0, so the batch is not certified, and this report does
not claim it is. Everything else Batch A asked for passed, including the two
expensive proofs that were deferred from Steps 10–12.

| | |
|---|---|
| Step 10 — Team Experience | `e1be6af` — implementation complete |
| Step 11 — Match Centre Community + Rewards | `83edbe5` (+ `fec391a` documentation correction) |
| Step 12 — Rugby Safeguarding + Age-Grade | `5dda09f` |
| Batch A governance and fix | `71d2358` |
| **Frozen tree for acceptance** | **`71d23589531a5c3d44142f2423e5493ecb008118`** |
| Released · pushed · Step 13 | **no · no · not started** |

---

## 1. Functionality reconciliation (§4)

| step | BEFORE | AFTER | LOST |
|---|---|---|---|
| Step 10 — Team Experience | 37 | 46 | **0** |
| Step 11 — Match Centre Community + Rewards | 33 | 55 | **0** |
| Step 12 — Rugby Safeguarding + Age-Grade | 52 | 58 | **0** |

**The three totals must not simply be added.** The BEFORE sets are disjoint by
domain — Team, Match Centre surface, safeguarding and age-grade — and Step 10's
Match Centre entries (#34, #43, #44) are the *navigation edge* from a team to a
fixture, not the Match Centre surface Step 11 counts. There is **exactly one
genuine double count**: Step 11 counted "the electorate follows the side's age"
and Step 12 counted "one canonical adult answer" — the same capability, which
Step 12 canonicalised into `internal.team_is_adult_side` and Step 11's
`match_side_is_adult` now delegates to.

**Batch A distinct total: 46 + 55 + 58 − 1 = 158. FUNCTIONALITY LOST: 0.**

Evidenced, not asserted: `step10_team_experience` 29, `step11_match_community`
59, `step12_safeguarding_and_age_grade` 34, plus the domain suites
(`safeguarding_authority_matrix` 130, `match_centre_core` 22,
`age_eligibility_matrix` 44, `step9_family_and_availability` 41,
`step8_operational_access` 69) — all green, on both the persistent database and
a database built from empty.

---

## 2. SQL suite governance (§5–§12)

**Implemented**, because the old model could not support an honest gate claim.

| | |
|---|---|
| Single declaration source | `supabase/tests/suite-registry.json` |
| Runner | `scripts/run-platform-tests.sh` **derives** its gate list from it |
| Guard | `scripts/verify-sql-suite-registry.mjs`, wired into the gate |

The guard fails when a suite file is undeclared, a declared path no longer
exists, a disposition is invalid, an entry lacks an owner or reason, a
`SUPERSEDED` entry names no successor, a prerequisite names a suite that does
not exist, or the runner stops deriving its list from the registry. **A
duplicate registration is now structurally impossible** — a JSON object cannot
hold the same key twice.

### Final counts

| disposition | count |
|---|---|
| TOTAL SQL SUITES | **286** |
| CANONICAL_GATE | **181** |
| SPECIAL_PURPOSE | **73** |
| SUPERSEDED | 0 |
| RETIRED | 0 |
| UNVERIFIED | **32** |
| **UNDECLARED** | **0** |

**What UNVERIFIED limits.** Those 32 suites have no declared intent in their own
headers and have not been archaeologised. They are **not evidence of anything**,
they are not counted as coverage, and no claim in this report rests on them.
They are declared so that they are not silent.

### The defect measuring it found

The runner's hand-maintained array listed **`site_admin_profile_matrix` twice** —
the gate ran that suite twice and counted its assertions twice, in the total
acceptance rests on. Any assertion total reported before `71d2358` includes one
suite twice. Fixed.

A second harness defect was caught before it could stop the gate: the first
derivation used `mapfile`, which is bash 4+, and this machine's bash is **3.2**.
Replaced with a portable read.

### §7 — the 105 were not mass-wired

Dispositions are evidence-based: **73 of the un-gated suites declare themselves**
manual, "NOT a migration", or dependent on another suite in their own headers.

**And the documented procedure for the dependent ones cannot work.**
`permission_matrix.sql` and `season_transitions.sql` both end with
**`rollback;`**, so a suite told to run *after* them finds nothing left behind.
Those suites are **not gate coverage and not currently runnable coverage
either**, and are recorded as such with the prerequisite defect named against
them. Neither wiring them in nor calling them `RETIRED` would have been honest.

### §9 — known stale suites, dispositioned with measurements

`player_guardian_security`, `team_lifecycle`, `capability_engine`,
`team_scoped_fixture_requests`, `fixture_results`, `fixture_status_lifecycle`,
`fixture_age_eligibility`, `gender_age_grade_rules`, `player_team_dispensation`,
`senior_cohort_graduation` and `player_movement_eligibility_resolver` each carry
their measured standalone result and their cause in the registry — seed data
older than a constraint, a `team_permissions` view that no longer takes
`ON CONFLICT`, a session gate added after the suite was written, or a
prerequisite that rolls back. **No product architecture was changed to satisfy
an obsolete test.**

---

## 3. `46-family-authority` (§10) — teardown repaired

**The recorded reason was wrong.** It said the suite's identities could not be
removed at all because `public.audit_log` is append-only. What actually blocked
it: the cleanup owned players **by tagged surname**, so a player the *product*
named — an approved Add Child creates one with no tag — held a place in the
run's own team, and `delete from public.teams` was refused by
`player_team_memberships_team_id_fkey`. The suite died in setup before asserting
anything.

The ownership boundary now sits where the relationships are: a place in a team
**this run created**, a player one of this run's throwaway identities
**created**, and a guardian link owned **from both ends** — with any player
holding a team place outside the run's own club left alone.

**Measured after the repair:** two consecutive runs, identical results (3 passed,
2 failed), **zero cleanup errors and zero residue** — no `uat.slice4a` users,
clubs, teams or players remain. It is now independently repeatable.

**It stays exempt.** A2 and A4 still fail: the Add Child flow completes in the
browser and shows "Waiting for Your Club" yet writes neither a `players` row nor
a `player_duplicate_reviews` row. That is the Add Child inconsistency Step 9
already deferred. **Owner: the family domain.** No product architecture was
changed to make another domain's suite green.

## 4. L26 (§11) — preserved OPEN

Not closed. The invariant it stands for — *a test cleans only records it owns* —
was applied in the `46-family-authority` repair, which is a worked example of it.
`TEAM_JOIN_CODE` cleanup remains marker-scoped rather than fixture-scoped.
**Owner: invitation / test-fixture hygiene.**

---

## 5. Full-chain clean boot (§14–§15) — **PASS**

Run twice on the permanent isolated harness, in a disposable Supabase project
with its own id and ports. The persistent review world was never touched, and
the disposable project was destroyed afterwards.

**CHAIN FROM EMPTY = VALID.** The complete migration chain applied in canonical
order with no skip, no manual patch and no repair, and every checked-in
clean-boot assertion passed:

Step 4, Slice 7e, Step 6, Step 7, Step 8, Step 9, **Step 10** (team reader
correct from empty, no badge outliving its relationship), **Step 11** (recognition
seeded, positive, one-vote-per-person, no currency), **Step 12** (age grade from
the canonical resolvers and the canonical season, without evidence, one shared
adult answer).

Semantics, not an exit code — the estate's own suites against the fresh database:

| | |
|---|---|
| `auth_flow_state_authority` · `definer_rpc_session_contract` · `security_perimeter_guard` | 28 · 37 · 6 |
| `site_admin_users_access_closure` · `authority_helper_retirement` | 37 · 77 |
| `club_venue_pitch_integrity` · `club_directory_privacy` | 21 · 19 |
| `fixture_availability_summary` · `fixture_search_and_venue_authority` | 12 · 15 |
| `step8` · `step9` · `step10` · **`step11`** · **`step12`** | 69 · 41 · 29 · **59** · **34** |

Step 11 and Step 12 were added to the clean-boot estate list by this batch.

### The defect the clean boot found

`authority_helper_retirement` failed **1 of 77**:

```
FAIL HR1 can_manage_fixture_side: 2 policies (ceiling 2), 7 function bodies
         (ceiling 6) -- a legacy reference was added
```

Step 11's `internal.can_administer_match_community` delegated to a legacy
authority helper that is under a **shrink-only** retirement ceiling. Steps 11 and
12 never ran that suite; the canonical gate does. **This is precisely what the
batch checkpoint exists to catch.**

Fixed by `20270524000000`, which moves community administration onto the
canonical capability decision (`fixture.fixture.edit` at team and club scope,
plus the same site support capability the wrapper honoured) rather than raising a
shrink-only ceiling. Behaviour unchanged; ledger back at 6; the migration asserts
its own ceiling. **77/77.**

---

## 6. Persistent vs canonical schema comparison (§16)

The disposable clean-boot database was kept alive and compared against the
persistent UAT database. **B was not modified.**

| compared | result |
|---|---|
| `pg_dump --schema-only` of `public` + `internal` (73,191 lines) | **14 diff lines**, of which 12 are pg_dump session nonces |
| Function grants for `anon` / `authenticated` / `service_role`, plus `SECURITY DEFINER` flags | **identical** |
| Table RLS enabled/forced state and `SELECT/INSERT/UPDATE/DELETE` privileges | **identical** |
| RLS policies, with `USING` and `WITH CHECK` expressions — 894 | **identical** |
| Capability bundle grants — 418 | **identical** |
| Seeded catalogues (capabilities, bundles, role definitions, key map, presets, award categories, kudos kinds) | **identical** |

**Total semantic facts compared: 1,603 + 894 + 418. Differences: one.**

That one difference is `internal.session_live_only()`, whose body is
` select internal.session_live(); ` on the persistent database and the same
statement across three lines on the fresh chain. **Identical semantics, different
whitespace** — a cosmetic fingerprint of however the persistent database received
that migration, and the only trace of the drift anywhere in the schema.

## 7. Migration-history repair verdict (§17) — **NOT PERFORMED**

**MIGRATION HISTORY REPAIR — SAFE TO PERFORM**, on the evidence above.

The exact versions a repair would record — **24**, contiguous, and no history row
exists without a matching file:

```
20270501000000 … 20270524000000
```

(545 migration files, 521 history rows, tip `20270430000000`.)

**Not performed, and the persistent history is untouched**, per §17. Two limits
on that verdict, stated rather than buried: the comparison covered the `public`
and `internal` schemas, grants, RLS, policies and the seeded catalogues — **not**
storage buckets and policies, the `auth` schema, scheduled jobs, or every
migration-created data backfill; and the drift range has grown from the original
21 to 24 as Steps 11, 12 and Batch A were applied incrementally by the same
route. **Cause remains UNKNOWN** and is not guessed at.

---

## 8. Production-shaped rehearsal (§18) — **PASS**

The production tip was read from **authoritative release evidence** — the
production project's own migration history — not inferred from local state:
**`20270502000000` (`a_delivery_result_belongs_to_its_claimant`)**.

**22 migrations** (`20270503000000` … `20270524000000`) applied from that tip, in
canonical order, **one at a time, each dry-run first**, against a disposable
production-shaped database. No production writes.

| measured | before → after |
|---|---|
| site_* functions | 29 → **33** (+4) |
| policies | 594 → **601** (+7) |
| `internal.is_site_admin` | 1 → **0** (a deliberate retirement) |
| profiles · club_memberships · role_assignments · site_admins | 15 → 15 · 4 → 4 · 5 → 5 · 2 → 2 |
| clubs · venues · club_pitches · teams · fixtures | 2 → 2 · 2 → 2 · 1 → 1 · 10 → 10 · 2 → 2 |
| fixture_requests · competitions · competition_matches | 0 → 0 · 0 → 0 · 0 → 0 |

**No membership, role, profile, administrator, club, venue, pitch, team or
fixture moved.** The estate's assertions passed against the rehearsed database
(`site_admin_users_access_closure` 37, `authority_helper_retirement` 77,
`security_perimeter_guard` 6, `definer_rpc_session_contract` 37).

**L7 (§19) survives**: `accept_invitation` and `get_invitation_preview` are
untouched. Batch A performed no contract.

---

## 9. Integrated cross-domain browser UAT (§20–§24) — **33/33**

`81-batch-a-integration-journey` is new, permanent and registered. It walks
Steps 10–12 **together**, over a real **youth** side and a real **adult** side,
in isolated Playwright contexts.

**One answer per concept, asserted first against the database:** Match Centre's
electorate test and the canonical adult test agree on **every team**; the youth
side is youth and the adult side adult; U17/U18 remains youth and keeps
"Parents' Player"; the same canonical category is named for the age of the side
it is on.

**Staff (§21):** Team → What's Next → age-grade attention with a reason → the
played fixture → Match Centre → **the score** → community after the rugby, not
instead of it → back to **the Team**. **No roster member's date of birth appears
on the page** (three roster dates of birth checked by value).

**Family (§22):** their own child named; **not** shown the club's attention list;
not shown another family's child; no date of birth; offered **Parents' Player**;
availability still its own question and not a poll; a vote written to the
canonical record.

**Player (§23):** an adult player reaches their own senior side's played match,
is **never** offered a parents' award, and is not treated as their own parent.

**Outsider:** another club's admin gets no age-grade attention and no community
controls.

**Mobile (§39):** 1440 → 390 → 320 across the combined Team → Match Centre walk.
No horizontal overflow; the attention state and the score both survive the phone.

**Accessibility (§40):** axe on the changed surfaces — **1 total, 1 pre-existing
and declared, 0 introduced**. The declared one is the application-shell unread
badge (L22). No unrelated contrast debt was "fixed".

**Races (§41):** 12 races green — `match_community_races` 5,
`age_grade_status_races` 3, `fixture_creation_races` 4. None weakened.

### A test defect this journey found in itself

Its first privacy assertion failed the team page for containing a `yyyy-mm-dd`
string — which was a **fixture date** in What's Next. The assertion now asks the
database for the roster's actual dates of birth and looks for **those**. Recorded
because the first version would have reported a privacy leak that did not exist.

---

## 10. Step 11 derived-decision reconciliation (§25)

| decision | verdict |
|---|---|
| `teams.category = 'senior'` as the adult discriminator | **VALIDATED** — and canonicalised into `internal.team_is_adult_side`. It is the only open-age marker the canonical team identity carries, and `resolve_adult_category` already filtered on it; the migration asserts both tests agree for every team |
| Beast / Work Rate split by age | **VALIDATED, narrowly** — display-only (`name_youth`/`name_adult`), carries no authority, and a team may override the displayed name |
| the exact six Kudos entries | **DEFERRED DECISION** — they are rows in `match_kudos_kinds`, changeable without a migration, and no checked-in note specifies a vocabulary. Owner: product |
| one award engine rather than five | **VALIDATED** — the five backlog names differ only in electorate; four distinct electorates resolve from one engine, asserted |
| `can_manage_fixture_side` gating | **ADJUSTED** — it added a reference to a legacy helper under a shrink-only ceiling. Moved to the canonical capability decision by `20270524000000` |
| `team.news.manage` for team-level settings | **VALIDATED** — the granted capability that already describes "the people who speak for the team" |
| COACH-only electorate | **VALIDATED** — §12 states a Team Manager is not automatically a Coach; asserted (D4) |
| tie semantics | **VALIDATED** — no checked-in rule breaks ties; inventing one would assert a decision the votes did not make |
| self-Kudos prohibited | **VALIDATED** — asserted (G3) |
| removal semantics (staff soft-remove, giver hard-delete) | **VALIDATED** — soft removal preserves moderation history; a withdrawal has none to keep |
| read-only Match Centre result | **VALIDATED** — no community function can write to `fixtures`, asserted in the migration and the suite |
| profile history reader deferral | **VALIDATED as a deferral** — owner: the Player profile surface |

## 11. `team.community.manage` / Messenger boundary (§26)

**Unactivated, preserved.** Granting it would give `CA@club · CO@team · TM@team`
the ability to satisfy `internal.may_send_as` for a **team identity**, enforced
on insert by `internal.enforce_sender_identity` — broadening who may speak as a
team in Messenger. Recorded as **L27** with its owner: the messaging-authority
owner of those two functions, plus a capability-catalogue decision. Batch A
changed no Messenger authority.

---

## 12. The final gate (§45–§47) — **EXIT 1**

One unsplit invocation on the frozen tree `71d2358`, beginning to end.

| | |
|---|---|
| Total suites reported | **323** |
| Total assertions | **6,728 passed, 3 failed** |
| SQL suites executed | **181** (the CANONICAL_GATE set, derived from the registry) |
| TypeScript suites | **81** |
| Browser suites | **54** run (28 declared exempt, 82 numbered on disk) |
| FAIL | **1** — `76-branding-propagation` (13 passed, 1 failed) |
| CRASH | **2** — `58-club-admin-authority`, `59-club-misc-authority` |
| KILL | 0 |
| EMPTY | 0 |
| Missing / undeclared | **0** |
| **Gate exit code** | **1** |
| Orphan browser processes after the run | **0** |

**SPECIAL_PURPOSE and UNVERIFIED suites are not inside that total.** The 181
executed are the declared canonical set; the other 105 are declared and excluded,
and none of them is reported as passing.

### The three failures, classified

**None is a Steps 10–12 product regression**, and **all three passed in an
earlier run of the same tree**, which is itself the finding.

| suite | run 2 | run 3 | classification |
|---|---|---|---|
| `76-branding-propagation` | **ok, 14 passed** | FAIL 13/1 | **environment-sensitive**, reproduces standalone |
| `58-club-admin-authority` | **ok, 30 passed** | CRASH after 1 assertion | **harness flake** in shared `signIn` |
| `59-club-misc-authority` | not reached | CRASH after 1 assertion | same |

- **`76-branding-propagation` — S6BR-01**: *"with no crest of its own, the public
  Club Home shows the Club Directory's — (no club crest rendered)"*. The public
  club query **does** join `club_directory(logo_storage_path)` and does call
  `resolveClubLogoUrl`, and the Site Admin surface (S6BR-02) resolves the same
  fallback correctly in the same run. **Owner: Step 6 / Club Digital Home.** No
  Step 10–12 or Batch A commit touches the public club home or the logo resolver
  (measured: 0 files in each).
- **`58` / `59` — CRASH**: both die in the shared harness at
  `harness.mjs:269` — *"The sign-in submit is still disabled 10s after switching
  to the link method."* This is the magic-link fallback path in `signIn`, and the
  identity programme has **retired magic-link login**. **Owner: acceptance
  harness.** Both passed minutes earlier on the same tree.

Two earlier gate invocations are **diagnostic evidence only** and are not offered
as acceptance: the first ran no browser suites at all (`SUPABASE_SERVICE_ROLE_KEY`
not exported — the gate declared it and listed every suite as "not run"); the
second was spoiled by four further missing environment variables and was stopped
mid-run.

---

## 13. Persistent UAT world (§48)

Inspected, not rebuilt.

| | |
|---|---|
| UAT identities | **118**, unchanged |
| Priya Devlin | `state = ACTIVE`, **`confirmation_state = PENDING_CONFIRMATION`**, `confirmed_at` null — untouched |
| Step 2 Review RFC, its teams and fixture season | present |
| Residue from automated suites | **zero** — no awards, votes, kudos, award settings, `BatchA %` fixtures, `S12Age%` players or `uat.slice4a` identities remain |
| Migration history | tip `20270430000000`, 521 rows — **unrepaired** |

Priya's two states remain distinct (§31): the **role assignment's
`confirmation_state` is the authority state**; `club_safeguarding_officers` is
the club's **published contact record** and holds no rows. Neither was conflated
and neither was mutated.

---

## 14. The branding question — measured, and a correction

**The earlier "font utility missing" hypothesis is WITHDRAWN.** It was wrong
twice, both times through my own search errors: an unescaped `.` in a grep that
matched the CSS *variable* rather than the class, and then a pattern that did not
allow for pretty-printed development CSS. **No branding or styling change was
made on the strength of those incorrect readings.** Confirmed: the Bebas Neue
assets exist, the font variable is present, `.font-display` / `.font-heading`
resolve through `--font-display`, and both development and production CSS contain
the expected rule.

**Measured in a real browser, per §"do not infer from source CSS alone":**

| | element | classes | computed `font-family` | Bebas resource |
|---|---|---|---|---|
| **Local `/login`** | `span` "OVALBALL" | `font-display text-xl tracking-wide` | `"Bebas Neue", "Bebas Neue Fallback"` | **only `Bebas Neue Fallback:loaded`** |
| **Local app shell** (`/dashboard`) | same | same | same | **only `Bebas Neue Fallback:loaded`** |
| **Deployed** (`ovalball.co.uk/login`) | same | same | same | **`Bebas Neue:loaded`** — the real face |

**The computed `font-family` is identical everywhere.** What differs is the
**font resource**: the development server serves **no real webfont at all** — its
stylesheet contains **0** `src: url` declarations and only a
`@font-face { font-family: Bebas Neue Fallback; src: local(Arial); … }` with
metric overrides — while a production build embeds **15** real webfont sources, 9
of them Bebas. So locally the wordmark renders as **Arial with Bebas metrics**,
and on the deployed site as **real Bebas Neue**.

**Cause: font resource loading in the development environment. Not CSS, not the
cascade, not variable scope, not class selection, and not a code change.** No
correction was made: production is correct, and the fix would touch typography
plumbing, which is out of scope without a decision.

**The confirmed historical UI difference is `1ffdcb6 — feat(shell): one person,
several places to stand`**, which deliberately changed the shell identity block
from a club-first presentation to signed-in-person plus current context. **Not a
Step 10–12 regression, not reverted, not altered.** It goes to the deferred
manual review checkpoint for owner review.

**Standing brand rule reaffirmed:** the logo, wordmark, display typography and
protected brand assets are never changed incidentally.
`public/icons/Ovalball Square Logo.png` and
`public/icons/Overball Logo Low Res.png` remain untouched and untracked.

---

## 15. What Batch A still needs

1. **`76-branding-propagation` S6BR-01** — establish why the public Club Home
   renders no crest when the Site Admin surface resolves the same fallback in the
   same run. Owner: Step 6 / Club Digital Home. Batch A did not change product
   code to make it pass.
2. **`58` / `59` sign-in crashes** — the shared harness still takes a magic-link
   path that the identity programme retired. Owner: acceptance harness.
3. **Re-run the complete unsplit gate** from a newly frozen tree once those are
   resolved. The current run is not acceptance evidence.

## 16. DEFERRED MANUAL REVIEW CHECKPOINT — BATCH A

For the owner, using the persistent personas. Concise on purpose.

1. **The shell identity block.** It now names the signed-in person and their
   current context ("Hannah Whitmore · Step 2 Review RFC · Club Admin") where the
   deployed build names the club with its crest. Deliberate, from `1ffdcb6`.
   **Decide whether that presentation stays.**
2. **The wordmark, locally.** It renders in Arial with Bebas metrics on
   `localhost` because the dev server serves no real webfont; the deployed site
   is correct. Decide whether local review fidelity is worth self-hosting the
   font.
3. **A coach on their own team** — Age Grade attention names who needs a look and
   why, with no date of birth anywhere.
4. **A parent on the same team** — their own child's position, and no sign of the
   club's list.
5. **A played match** — the score in the hero, then Parents' Player on a youth
   side and Players' Player on an adult one; the winner to the team, the count to
   staff only.
6. **Priya Devlin at Step 2 Review RFC** — pending, with the explanation. The
   resolution is an Ovalball confirmation; deliberately not performed.
7. **A phone at 390 and 320** across Team → Match Centre.
