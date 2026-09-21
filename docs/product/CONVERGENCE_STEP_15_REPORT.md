# Convergence Step 15 — Governing Body Product

**PRODUCT IMPLEMENTATION COMPLETE — HARDENING PENDING.** From `83c37e0`. Local only; nothing pushed,
nothing released, no migration-history repair.

## 1. What the archaeology changed

Four findings, recorded in `CONVERGENCE_STEP_15_ARCHAEOLOGY.md`. Two of them stopped work that
would otherwise have looked obviously right.

1. **The dispensation chain's "GOVERNING BODY APPROVAL" stage is not a governing-body action.** It
   looked like a ready-made job. Reading `decide_player_dispensation`, it is authorised by the
   **source club** and requires a reference — "the dispensation certificate the club holds" — and the
   UI already says *"Ovalball records the governing body's approval; it does not grant it."* Taking it
   would have changed what existing records mean, including historical ones, over data that names a
   child and an age-grade exception. Not touched, and asserted not touched.
2. **A constituent body is not a regulatory authority, structurally.** `regulatory_authorities` holds
   four rows — RFU, RFL, World Rugby, IRL — and a county union has no row in it. So the workspace reads
   regulation and edits none, and that is the schema's decision rather than a policy I invented.
3. **The competition organiser gap was one predicate.** Ten competition RPCs funnel through
   `require_edition_organiser` → `can_organise_edition` → `internal.can_organise_competition`,
   which recognised a site capability and the organiser club — but not the body column Step 14 added.
4. **Invitations cannot represent a body.** `access_invitations.kind` is a closed constraint, so a
   governing invitation means changing the protected contract surfaces. Not done, and not faked.

## 2. The IA — four destinations, not six

**Overview · Clubs · Competitions · People & Access**, reached as a **context**, not a page.

Regulation is a contextual link to Rugby Hub, because it is knowledge rather than an operation this
organisation performs. **There is no empty destination standing in for welfare oversight or
organisation messaging**: neither has a backend, and a nav item promising one is the dishonest version
of the same gap.

**Navigation (§22).** `ActiveContextKind` gained a sixth value, `"governing"`. It is the only shape
that satisfies §21 and §22 together: navigation is built *from* the active context, so somebody acting
for the county is offered the organisation's destinations and **not their club's**. A county fixtures
secretary is usually also somebody's Club Admin, and `canManageClubFixturesAnywhere` is session-wide
by design — falling through would have handed them their club's Fixtures, Teams and People while they
were acting for the county. Switching in also **lands** in the workspace, because a refresh in place
would have left the organisation's navigation over a club page.

## 3. The visible product

**Overview** leads with **Needs Attention**, derived from the same three reads the rest of the page
uses so it cannot disagree with what is below it: a competition with no registered season, one with no
teams entered, one with teams and no draw, a sole administrator, no affiliated clubs. Each names the
thing, says why, and links where it is fixed. **No chart, no percentage, no trend** — a county officer
cannot act on any of those.

**Clubs** is the affiliated list with search above ten clubs, location and ground, and a link to each
club's **own public home** — the same page any visitor sees. **Read-only, and it says why.**

**Competitions** lists what the organisation runs with how far each has actually got, starts a new one
from a single field, and hands **straight over to the canonical Competition Creator**. `canOrganise`
comes from the database per row, so a Viewer is told the truth rather than shown a control that will
refuse them.

**People & Access** shows who has access, what they hold, **what that role actually allows**, and when
it was given. Access is granted by the email address on an existing account — **no people picker**,
because a governing administrator has no business receiving a directory of everybody on Ovalball.

## 4. Read-only, and why in each case

| | why |
|---|---|
| **Club affiliation** | a nullable column with no dates, no history and no evidence. A control would rewrite what was true last season as well as this one. → H13.3, Step 16 |
| **Inviting somebody with no account** | `access_invitations.kind` is closed; a private token here instead is the defect. → H14.1 |
| **Regulation** | a constituent body has no row in `regulatory_authorities` |
| **Organisation messaging** | no organisation conversation and no body sender identity exist. A body sending as a club is the Step 11 coupling mistake, wider. → H14.4 |
| **Welfare / safeguarding** | nothing was surfaced, and nothing reaches a DOB, medical field, guardian record or case note. → H14.5 |
| **Dispensations** | the stage is the club's attestation, and the data names a child. → H14.6 |

## 5. RED and AMBER changes

**RED — one.** `internal.can_organise_competition` gains one disjunct for the body organiser. The two
existing disjuncts are byte-for-byte unchanged; the new one can only match a competition whose
`organiser_constituent_body_id` is a body where the viewer holds BODY_ADMIN or BODY_COMPETITIONS. It
grants nothing over any club's own fixtures. Fail-closed: `is_account_active` and `exists` are never
null and `can_manage_body_competitions` coalesces, so the predicate answers a definite boolean —
asserted in the migration and in the suite (§27).

**RED — three new writes.** `create_governing_body_competition` (the body's own rugby code, canonical
season), `grant_governing_body_role_by_email`, `revoke_governing_body_role`.

**AMBER — two reads.** `governing_body_people` (email only to somebody who already manages access),
`governing_body_competitions`. **`governing_body_clubs` widened** — columns added, never removed.

**No table was added. `internal.capability_decision` was not touched** — nothing in the
implementation forced it, so the `body` scope stays H13.1.

## 6. Three real defects the proof caught

1. **`governing_body_people` would have failed at runtime for every caller** — `auth.users.email` is
   `character varying` against a declared `text` column, which plpgsql does not check at creation.
   Found by the SQL suite.
2. **`governing_body_competitions` read `seasons.start_date`, which does not exist** (it is
   `starts_on`). Same reason it compiled. Found while writing the suite.
3. **One role had two names** — the sidebar said *Organisation Administrator*, People & Access said
   *Administrator*, for the same row in the same table. Found by the browser journey; resolved to one
   authority, `lib/governing/roles.ts`, and asserted by D1b.

Also fixed in passing: a `?code=league` link to Rugby Hub that would have been silently ignored, and
a radio group whose accessible name folded the whole role description into it.

## 7. Focused proof

| | |
|---|---|
| `supabase/tests/step15_governing_product.sql` | **66 / 66** — the full §28 matrix over the organiser predicate, the three writes, and the boundaries |
| `84-governing-body-product-journey` | **59 / 59** — product journey, Viewer, unauthorised, 390px, axe on four surfaces, keyboard, self-cleaning (run twice) |
| `83-governing-body-foundation` | **15 / 15** — two assertions repointed at where Step 15 moved the same guarantees |
| `step14_governing_body` | **25 / 25** |
| `competition_authority_matrix` | **87 / 87** — the direct regression proof for the RED change |
| `competition_matches` · `competition_creator_conformance` · `fixture_bulk_planning_authority` | **28 / 28** · **13 / 13** · **28 / 28** |
| `security_perimeter_guard` · `perimeter_manifest.test.mts` | **6 / 6** · **12 / 12** |
| `active-context.verify.ts` | **31 pass, 1 pre-existing unrelated fail** (H14.7) |
| tsc · build · lint | clean · clean (5 governing routes) · 181/5/176, the unchanged baseline |
| Static guards | content standard, authority guards, SQL suite registry (**289** declared, 0 undeclared), browser suite registry (**57** in the gate), Match Centre shared, fixture bulk authority — all pass |
| axe | four changed surfaces, **0 introduced** violations (1 declared pre-existing: the message-badge contrast) |

**Not run, deliberately (§36):** no canonical gate, no clean boot, no production rehearsal, no
whole-platform browser regression.

**Two suites fail on seeding and are pre-existing:** `competition_management` and
`fixture_competition_edit`, both `SPECIAL_PURPOSE` ("manual verification"), both dying on FK
violations before reaching any organiser check. `verify-auth-security` has 5 pre-existing failures on
the retired magic-link/password path. Not chased (§29).

## 8. FUNCTIONS BEFORE 12 · AFTER 24 · LOST 0

Item by item in `CONVERGENCE_STEP_15_FUNCTIONALITY_MATRIX.md`, including the two things Step 15
*changed* rather than added and why nothing became unreachable.

## 9. The review world

`Ovalball Review County RFU` (`source = 'local_review'`) at `/governing/7d01b631-86fb-4c44-9708-e22b83daf744`, and it is now
**reproducible from the canonical script** — Step 14 created it by hand, which meant the review world
could be rebuilt and the organisation could not:

```
node scripts/review-fixtures/step2-review-club.mjs enrich-governing
```

Five affiliated clubs, **all synthetic**; three officers — `uat.preston.admin` (Administrator, and
also a Club Admin, which is the point), `uat.coach` (Competitions Officer, also a club coach),
`uat.adult.player` (Viewer); and **Review County Junior Cup**, created through the product in the
canonical current season. **Preston Grasshoppers RFC is deliberately not affiliated** — it names a real
club, and recording a real club as belonging to an invented union is the kind of plausible-but-wrong
data that gets believed later.

## 10. Step 16 closure list

Gaps Step 15 exposed between Governing Body, Competition, affiliation and authority:

1. **Affiliation lifecycle** — request, approve, transfer, suspend, effective dates, who decided
   (H13.3). The UX is designed on the Clubs page; the record does not exist.
2. **The canonical invitation system does not know about organisations** (H14.1), and closing it closes
   the account-existence oracle (H14.2).
3. **Competition results as a competition record** for a body — table, standings, results list from
   Competition Match truth (H14.3).
4. **Does a governing body decide the dispensation stage natively**, beside the club's attestation
   rather than instead of it (H14.6)? A product decision with a migration behind it.
5. **Competition entry from the club's side** — a club asking to enter a county competition, rather
   than the organiser entering it. Step 15 only surfaced the organiser's half.
6. **Promoting the `body` capability scope** (H13.1) — needed if governing authority ever has to be
   delegable per capability rather than per role.
7. **Organisation communications** (H14.4) and **welfare oversight** (H14.5) both need a product and
   safeguarding decision before any engineering.

## 11. For the owner's deferred review

Sign in as `uat.preston.admin@ovalball.test`, note the default context is still the **club**, then
switch to *Ovalball Review County RFU* in the context switcher.

- **Does it feel like a governing-body workspace, or like an admin panel?**
- **Is the IA right** — are Clubs, Competitions and People the right three primary jobs, and is
  Overview earning its place?
- **Does it feel distinct from Club Admin?** Switch back and forth; the club's Fixtures, Teams and
  People should vanish and return.
- **Is the organisation context obvious** from the sidebar and from each page's heading?
- **Is Needs Attention useful, or noise?** It currently raises: a competition with no teams entered,
  and that you are the sole administrator.
- **What feels missing?** The known gaps are results and standings, affiliation management, inviting
  somebody without an account, and anything welfare-shaped. Step 16 owns the first four.

Two specific judgements worth your eye: **starting a competition asks only for a name** (code and
season come from canonical data) — is that too little? And **Clubs links to each club's public home**
rather than anything administrative — is that the right depth for a county officer?
