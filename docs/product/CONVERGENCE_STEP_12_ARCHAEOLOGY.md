# Convergence Step 12 — Rugby Safeguarding + Age-Grade — archaeology

Measured against `83edbe5`, on the current disk, before any design. Where the
handoff and the repository disagree, the repository wins and the reconciliation
is recorded here.

## 1. The finding that decides the step

**Nearly all of it already exists server-side, and almost none of it is
surfaced.** This is the same shape Steps 10 and 11 found: the canonical answers
are built, and nothing asks them.

The proof is one search. **No file in `app/`, `components/` or `lib/` calls
`resolve_player_age_grade` or `resolve_player_regulatory_age`** — the two
canonical age-grade resolvers. The Team page shows no eligibility, no attention
state and no age-grade status; a parent has nowhere to see their own child's
age-grade position; and a coach has no way to ask "is this player eligible for
this side" other than by reading a date of birth they should not need.

So Step 12 is a **connection and convergence** step, not a construction one.

## 2. What exists — the canonical age model

| object | what it answers |
|---|---|
| `public.resolve_player_regulatory_age(rugby_code, season_id, dob)` | the governing-body regulatory age for a season: `school_year_start`, `regulatory_age_number`, `regulatory_age_label`, `window_starts_on/ends_on`, `governing_reference`, and a `status` that includes `SEASON_NOT_FOUND` and `DOB_REQUIRED` |
| `public.resolve_player_age_grade(rugby_code, season_id, dob)` | `age_grade_cutoff_date`, `age_at_cutoff`, `school_year`, `canonical_category`, `canonical_age_group`, `status` |
| `internal.regulatory_school_year_start(rugby_code, season_id)` | the school-year start the age is measured against — **season-derived**, not "age today" |
| `internal.player_effective_age(player, as_of)` | chronological age at a supplied date |
| `internal.person_is_established_adult(user)` | **D-S5-1**: `recorded DOB is not null AND not internal.person_is_minor(user)` |
| `internal.person_is_minor` · `internal.player_is_adult` | the minor predicates D-S4-4 and Step 9 already read |
| `internal.enforce_fixture_age_eligibility()` | a **trigger on `public.fixtures`**, enabled, making age eligibility an unbypassable boundary rather than UI filtering |
| `internal.resolve_age_grade_rule_bundle(...)` | the regulatory fact bundle for a code and regulatory identity, with `primary_source_key` / `primary_source_locator` per fact |

Three things follow, and they answer §§11–14 without inventing anything:

1. **DOB is stored; age is derived.** Every resolver takes a date and a season or
   an as-of date. Nothing stores an age.
2. **Age-grade is season-based, not "age right now"** — §14 is already modelled,
   through `regulatory_school_year_start`.
3. **`resolve_player_regulatory_age` refuses to infer.** With no DOB it returns
   `DOB_REQUIRED` and says so: regulatory age "must never be inferred from the
   team they currently play for". §13 is enforced at the resolver.

## 3. What exists — safeguarding

**Two different things are both called "safeguarding officer", and the
distinction matters.**

| | |
|---|---|
| `public.role_assignments` with `role_key = 'SAFEGUARDING_OFFICER'` | **the authority.** Carries `confirmation_state`, constrained so that *only* this role may have one: `CHECK ((role_key = 'SAFEGUARDING_OFFICER') = (confirmation_state IS NOT NULL))`, values `PENDING_CONFIRMATION · CONFIRMED` |
| `public.club_safeguarding_officers` | **the club's published officer record and contact** — `officer_type`, `contact_name`, `contact_email`, status `not_invited · invite_sent · active · inactive`. Currently **zero rows** on the review world |

`internal.active_safeguarding_officer_ids(club)` reads the **first** of those and
requires `ra.state = 'ACTIVE'` *and* `cm.state = 'ACTIVE'` *and*
**`ra.confirmation_state = 'CONFIRMED'`**.

Around them: `club_safeguarding_officer_invitations`,
`club_safeguarding_officer_conversations`, `safeguarding_thread_reviews`, and
some thirty RPCs — nominate, invite, accept, confirm, deactivate, resend, revoke,
contact update, conversations, site review.

### The SO capability bundle is already least-privilege

Bundle `SO` holds, at club scope: `safeguarding.welfare.view`,
`safeguarding.dispensation.view`, `safeguarding.dispensation.notify`,
`safeguarding.transfer.view`, `safeguarding.transfer.notify`,
`safeguarding.contact.view`, `safeguarding.conversation.handle`,
`safeguarding.officer.contact_edit@self`, `messaging.moderation.club_review`,
`messaging.block.manage`, plus **view-only** `people.member.view`,
`people.member.view_contact`, `player.profile.view`, `team.roster.view`,
`team.team.view`, `fixture.fixture.view`, `matchcentre.fixture.view`,
`calendar.event.view`, `venue.venue.view`, `tournament.tournament.view`,
`club.documents.view`, `club.profile.view`.

It contains **no** club administration, **no** fixture operations (no planner,
import, bulk edit, competition or result capability), **no** roster management and
**no** finance. §8 is already satisfied by the catalogue, and §33's "legitimate
fixture/calendar visibility" is already present as view-only.

### The confirmation seam holds in the capability engine, verified

Tested as the review world's pending officer, at their own club:

| asked | answer |
|---|---|
| `safeguarding.welfare.view` | **false** |
| `safeguarding.dispensation.view` | **false** |
| `people.member.view` | **false** |
| `safeguarding.contact.view` | true — and correctly so: that capability is held by **every** bundle (`CA CO FS MB PG PL SO TM VO`), because a club's safeguarding contact is meant to be findable by its members |

So `PENDING_CONFIRMATION` confers **zero safeguarding authority**, in the engine
as well as in the one predicate. This is the 4G seam the decision record
describes, and it is real.

## 4. Priya Devlin — reconciled

The handoff says *"Priya Devlin — Safeguarding Officer PENDING_CONFIRMATION"*.
**Measured, that is correct, and it is not where a first glance finds it.**

`review.step2.officer@ovalball.test` is Priya Devlin, DOB `1986-09-03`, and her
`SAFEGUARDING_OFFICER` assignment at *Step 2 Review RFC* reads
**`state = ACTIVE`, `confirmation_state = PENDING_CONFIRMATION`,
`confirmed_at = null`, `confirmed_by = null`**. Reading `state` alone says
"ACTIVE" and is misleading; the confirmation seam is a separate column, on
purpose. There is **no** `club_safeguarding_officers` row for her, which is a
second, independent fact about the club's published contact.

**Why the state exists** is the documented journey, from
`docs/identity-auth/IDENTITY_AUTH_DECISION_RECORD.md`:

```
nomination -> adult eligibility established (D-S5-1 applies HERE)
           -> legitimate ACTIVE club membership
           -> PENDING_CONFIRMATION, with ZERO Safeguarding Officer authority
           -> AN-6 Ovalball confirmation
           -> ACTIVE + CONFIRMED
```

She is between the nomination and the **AN-6 Ovalball confirmation**. The
legitimate resolution is `public.confirm_safeguarding_officer` by an authorised
Ovalball actor through the site safeguarding surface — not a repair, not a
backfill. Her DOB establishes adulthood, so D-S5-1 is satisfied and the
outstanding step is genuinely the confirmation itself.

**She is left exactly as she is.** Nothing in this step repairs, confirms or
touches that row.

## 5. What exists — dispensation

`public.player_team_dispensation`, with RPCs `request_player_dispensation`,
`decide_player_dispensation`, `revoke_player_dispensation`, the shared core
`internal.request_player_dispensation_core`, the expiry sweep
`internal.expire_due_dispensations`, and two team-id readers
(`internal.dispensation_team_ids`, `internal.safeguarding_dispensation_team_ids`).
Its own suite documents the chain it enforces: **REQUESTED → SOURCE TEAM APPROVAL
→ CLUB APPROVAL → GOVERNING BODY APPROVAL → APPROVED**, with stage-order
enforcement, per-stage authorisation, cross-club rejection, revocation and an
expiry sweep.

UI callers exist at `app/(app)/club/player-moves/` (a dispensation panel) and in
the rollover/graduation surfaces. **There is no Dispensation v2 to build**, and
§17 is already true of the model: a dispensation is an explicit exception record;
nothing in it edits a date of birth.

## 6. What exists — educational content, and its boundary

`get_rugby_hub_safeguarding_content`, `get_rugby_hub_safeguarding_by_identity`,
`get_rugby_hub_safeguarding_routes`, `internal.resolve_safeguarding_content_bundle`,
`internal.resolve_safeguarding_reporting_routes`, plus
`regulatory_reporting_routes` and `regulatory_reporting_route_citations`, behind
`/rugby-hub/safeguarding` and `/rugby-hub/safeguarding/contact`.

Content is already **identity-aware** (`..._by_identity`) — which is what §6 asks
for, and it means code-specific guidance does not need inventing. The boundary
§5 and §38 demand is intact today: no operational eligibility decision reads Hub
content, and `enforce_fixture_age_eligibility` is a trigger over canonical data.

## 7. L25 — the five Step-12-adjacent suites outside the gate, measured

Run deliberately, standalone, as §62 requires. **All five fail, and none of them
is simply "stale".**

| suite | what running it showed |
|---|---|
| `fixture_age_eligibility` | 11 passed, 12 failed. Header: *"NOT a migration — never applied automatically by `db reset`. Run by hand, AFTER permission_matrix.sql"* |
| `gender_age_grade_rules` | 8 passed, 11 failed. Header: run after `permission_matrix.sql` **and** `season_rollover.sql`, "reuses seasons/teams from both" |
| `player_team_dispensation` | 0 assertions — setup fails on `club_memberships_user_id_fkey`. Declared "manual verification", transaction-scoped |
| `senior_cohort_graduation` | 0 assertions — same FK. Declared manual, transaction-scoped |
| `player_movement_eligibility_resolver` | 0 assertions. Declared manual |

**And the documented procedure cannot work.** `permission_matrix.sql` ends with
**`rollback;`** — so running it first leaves nothing behind for the suite that
says it depends on it. `season_rollover.sql` ends with `commit;`. Neither is in
the canonical gate either.

That is the honest disposition evidence: these are **declared special-purpose
suites with a prerequisite that the prerequisite itself discards**, not suites
that rotted. Classifying them `RETIRED` because they fail would have been wrong,
and wiring them into the gate would have made the gate red for a reason that has
nothing to do with the product. Recorded for Batch A, per §63.

## 8. Reconciliations carried into the build

1. **Nothing to build for the age model; everything to connect.** The canonical
   resolvers exist and no UI calls them.
2. **Step 11's adult test is a local derivation.** `internal.match_side_is_adult`
   reads `teams.category = 'senior'` directly. §35 asks whether Step 12 can
   establish a canonical reusable answer — it can, and the convergence must not
   change the agreed outcome (colts and all youth grades keep the family
   electorate).
3. **A coach must not need a date of birth.** The status vocabulary is the
   product; DOB, medical data and case notes stay out of any operational payload.
4. **No SO workspace is justified.** `/club/settings/safeguarding` already exists
   and the SO's own jobs live on the surfaces they belong to. §42's instruction is
   to follow the jobs, so Step 12 adds no new route.
5. **Priya stays pending.** The state is legitimate, understood, and its
   resolution is a real user action.
