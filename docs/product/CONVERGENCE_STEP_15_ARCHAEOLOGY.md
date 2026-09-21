# Convergence Step 15 — Governing Body Product — archaeology

Measured against `83c37e0`, before any Step 15 migration, as §2 requires.

Step 14 recovered the *model*. This pass asked the different question Step 15
actually turns on: **what does a rugby governing-body user need Ovalball to help
them do, and how much of that is already built?**

Four of the findings below changed the step. Two of them stopped work that would
otherwise have looked obviously right.

---

## 1. The governing-body approval that is deliberately NOT a governing-body action

`player_team_dispensation` enforces the chain **REQUESTED → SOURCE TEAM APPROVAL
→ CLUB APPROVAL → GOVERNING BODY APPROVAL → APPROVED**. On the face of it that is
a ready-made job for a Step 15 workspace: a county officer signing off age-grade
dispensations for their clubs.

**It is not, and taking it would have broken a deliberate product decision.**
Reading `public.decide_player_dispensation`, the `governing_body` stage is
authorised by **`fixture.dispensation.approve_club` at the source club** and
requires `p_governing_body_reference` — described in its own error message as
*"the dispensation certificate/case number the club holds"*. The UI agrees, in
`app/(app)/club/player-moves/`:

> Ovalball records {the governing body's} approval — **it does not grant it**.

So that stage means *"the club is recording the certificate it already holds from
its county"*. It is an attestation of an off-platform decision, not an Ovalball
approval queue.

**Decision: Step 15 does not touch it, and does not surface dispensations at
all.** Two reasons, and the second is the stronger:

1. Re-pointing that stage at a body officer would silently change what an
   existing, fully-tested approval record *means* — including historical ones.
2. A dispensation names **a child, their age grade and the exception granted
   over it**. §15 is explicit that affiliation is not access to private player
   evidence. This is precisely that data.

Whether a governing body should one day decide the stage **natively on Ovalball**,
beside the attestation rather than instead of it, is a real product question with
a real migration behind it. **Recorded for Step 16** (§35), not answered here.

## 2. A constituent body is not a regulatory authority — structurally

§13 and §14 warn against a body becoming an editor of verified rugby knowledge.
The schema already settles it, so this is not a policy I invented:

| | |
|---|---|
| `regulatory_authorities` | **4 rows** — RFU, RFL, World Rugby, IRL |
| `constituent_bodies` | **35 verified rows** — county unions, armed forces, university, schools, referees |

**They are different tables and a constituent body has no row in the authority
one.** A county union operates *under* the RFU's regulations; it does not publish
them. `regulatory_competition_overlays` — the one table that could have connected
a competition to a regulation — holds **0 rows**.

**Decision: the workspace links to Rugby Hub in the body's own rugby code and
edits nothing.** Regulation is knowledge, the workspace is operations, and Step 15
creates no second CMS and no publishing model.

## 3. The competition organiser gap — one predicate, one chokepoint

Step 14 added `competitions.organiser_constituent_body_id`. **Nothing reads it for
authority**, so a body could be recorded as organising a competition it had no
power over. The relevant chain is unusually clean:

```
10 competition RPCs
  (save_competition_participants, save_competition_rounds, save_competition_stage,
   issue_competition_matches, update_competition_match(es), record_competition_match_result,
   cancel_competition_match, delete_competition_draft_match, replace_competition_draft_matches)
        -> internal.require_edition_organiser
        -> internal.can_organise_edition
        -> internal.can_organise_competition   <-- ONE function, two disjuncts today
```

`internal.can_organise_competition` recognises only **a site capability** or **the
organiser club**. No RLS policy references the chain; the only other caller is
`public.update_competition_metadata`.

**Decision: extend that one function by one disjunct** for the body organiser.
This is the difference between a workspace that describes competitions and one
that runs them, and it is *completing* the column Step 14 added rather than
weakening anything: the two existing disjuncts are untouched, and the new one can
only ever match a competition whose `organiser_constituent_body_id` is a body the
viewer holds `BODY_ADMIN` or `BODY_COMPETITIONS` at. It grants nothing over any
club's own fixtures.

Three-valued safety (§27): `is_account_active` is
`p_user_id is not null and exists(...)`, `exists` is never null, and
`can_manage_body_competitions` already coalesces. The predicate answers a definite
boolean, and the Step 15 migration asserts it.

There is a **second, app-side layer** that must agree:
`lib/competitions/organiser-scope.ts` adds the *context* the database cannot see
(`acting = siteAdmin || organiserClubId === scope.clubId`). A body has no
representation there, so it is extended in the same shape.

`create_club_competition` is the precedent for creation —
`internal.can_bulk_plan_fixtures(club)`, the club's own rugby code enforced, season
from `internal.competition_season_for`, competition + edition in one call. The body
equivalent is built to mirror it exactly, including the **rugby-code isolation**
rule: a union body cannot organise a league competition.

## 4. Invitations cannot represent a body, and must not be faked

`access_invitations.kind` is a closed check constraint:
`SITE_ADMIN · ACCOUNT_SETUP · CLUB_STAFF · SAFEGUARDING_OFFICER · GUARDIAN ·
PLAYER_ACCOUNT · TEAM_JOIN_CODE · CLUB_REFERRAL`. There is no body column and no
kind that fits, so representing one means a new kind, a new scope column, a new
`intended_outcome` shape, and changes to `issue_invitation`, `accept_invitation`
and `get_invitation_preview` — the contract surfaces that are explicitly protected.

**Decision (§12): no Governing Body invitation v2, and no bolted-on token.** Step
15 grants a role to somebody who **already has an Ovalball account**, resolved by
**exact email inside the grant RPC** so no people-search surface exists.
`site_search_users` is deliberately not reused: a body admin must not receive a
platform-wide people lookup. Where no account exists, the product says so plainly
and the canonical invitation extension is recorded for Step 16.

## 5. Navigation: the workspace is a context, and the type already expects one

`ActiveContextKind` is `"site_admin" | "club" | "team" | "parent" | "player" |
"family"`, and `lib/app-context/build-nav-items.ts` builds navigation *from the
active context*. Its own comment records the last time this list grew, for the
same reason.

**Decision (§21, §22): a sixth kind, `"governing"`.** It is the only shape that
satisfies both requirements at once — the context is stated in the switcher and
the identity block, and because navigation is built *from* the active context, a
person active as a governing officer is offered no club or team destinations at
all. Navigation remains discovery, never authority: `getSessionContext` already
returns only relationships the database confirmed.

## 6. What the read model is missing

`get_governing_body`, `my_governing_bodies`, `governing_body_clubs`,
`set_governing_body_role` — four functions. The product needs three more reads and
two more writes, and **no new table**:

| need | why it cannot be read today |
|---|---|
| who holds access | no reader; `constituent_body_roles` is readable under RLS but carries no names |
| the body's competitions | `get_governing_body` returns a **count** and nothing else |
| affiliated clubs, usefully | `governing_body_clubs` exists and is enough; the page truncated it at 12 |
| removing access | `set_governing_body_role` grants; nothing revokes |
| creating a competition | `create_competition` is Site Admin; `create_club_competition` is a club |

## 7. Boundaries confirmed, not assumed

- **Messaging (§17).** Conversations are `club_conversations`, `team_conversations`,
  `direct_conversations` and `fixture_messages`. There is **no organisation-level
  conversation and no sender-identity model for a body**. Step 15 builds no
  messaging and gives no "send as" anything. Recorded for Step 16.
- **Safeguarding (§15).** Nothing in Step 15 reads a date of birth, a medical
  field, a guardian record or a case note, and the migration asserts it.
- **Affiliation (§8).** `club_directory.constituent_body_id` is a nullable FK with
  no history, no dates and no evidence. **Read-only in Step 15**; the lifecycle
  (request, approve, transfer, suspend, effective dates) is designed in the report
  and deferred, because a half-built workflow that silently overwrites which county
  a club belonged to last season is worse than an honest read.
- **Groups / regions (§18).** Step 14's decision stands. `body_type` already
  distinguishes a county union from a schools or referees' body; no second
  hierarchy is added.
- **Capability scope (§4).** `internal.capability_decision` is **not touched**.
  Every Step 15 authority question is answerable by the three dedicated Step 14
  predicates over the relationship. Nothing in the implementation forced the issue,
  so the `body` scope stays hardening debt.

## 8. Functions before

| | |
|---|---|
| FUNCTIONS BEFORE | **12** (Step 14's count) — the body record and its provenance; club affiliation; Site Admin editing of it; a person↔body relationship with three roles; three authority predicates; a body as competition organiser (recorded, unauthorised); the four read/write RPCs; the `/governing` list and `/governing/[bodyId]` foundation page; the dashboard entry |
