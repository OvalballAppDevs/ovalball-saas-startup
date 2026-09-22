# Convergence Step 16 — Competition / Governing Closure

**PRODUCT IMPLEMENTATION COMPLETE — HARDENING PENDING.** From `7a9960b` (Step 15), which came from
`83c37e0`. Local only; nothing pushed, nothing released, no migration-history repair, no canonical gate.

## 1. Archaeology settled four of the nine items before any code

The master programme's only checked-in definition of Step 16 is *"Governing Body foundation → product →
**workflow closure**"*, so the handoff is the most precise definition that exists. What the repository
*did* contradict is four of the closure items — recorded in `CONVERGENCE_STEP_16_ARCHAEOLOGY.md`.

1. **The capability scope is called `organisation`, and the engine already says so.**
   `internal.capability_decision` refuses it at rule 1 with `SCOPE_NOT_IMPLEMENTED`, and
   `public.capabilities.valid_scopes` already permits the word. Steps 14–15 called it "body scope".
2. **Affiliation is published reference data.** `club_directory.constituent_body` holds the county's
   published *name* — "Lancashire RFU", "Hertfordshire RFU" — beside the FK, from sources like
   `lancashire_rfu` and `official_club`. And there is **no requirement for a lifecycle anywhere in the
   repository**: searching `docs/` for "affiliat" outside Step 14/15's own documents returns nothing.
3. **Competition entry has no club-side consent, by design.** `competition_participants.status` is
   `('entered','withdrawn')`, organiser-written. Tournaments *do* have entry consent
   (`respond_tournament_invitation`), which is what shows competitions not having it is a decision.
4. **The dispensation stage is the club's attestation** — and there is not even a column in which a
   native Ovalball body decision could be recorded.

## 2. What visibly changed

**For the organisation:** a competition now has a page showing its **real results and its table**, from
Competition Match truth, with the organiser's own points rule — including matches between two clubs that
are not on Ovalball. **What the clubs have not answered** is on it, which a county could not see at all
before. People & Access **invites** somebody instead of granting to an existing account, shows who is
**invited but has not accepted**, and can send again or withdraw. Starting a competition **shows what it
inherits** — season, code, organiser — rather than describing it in a sentence.

**For the club:** `/fixtures/competitions` gained **Competitions You're In** — which competitions, which
season, which of its teams, **who runs it**, and what needs answering — linking to the canonical
Competition Requests. There is deliberately **no enter or withdraw control**, because that is not the
club's act.

## 3. Two real defects, both silent

1. **A body organiser was never told what its own clubs answered.**
   `internal.competition_organiser_recipients` notified Site Admins whenever
   `organiser_club_id is null` — true of *every* body-organised competition — so
   `respond_competition_match` told the platform and not the county.
2. **And could not read the answers either.** `internal.organised_edition_ids()` gates the SELECT policy
   on eight competition tables and recognised the organiser *club* only; measured against the review
   county it returned **0** editions for that county's own administrator. Most of those eight have an
   `is_public` fallback — **`competition_match_verifications_read` does not**, which is the one that
   matters. Together, a county was completely blind to its clubs' responses.

Both fixed by one added disjunct each, narrowing nothing.

## 4. Item by item

| item | outcome |
|---|---|
| **Body invitations (H14.1)** | **CLOSED** through the canonical architecture — one kind, one scope column, one spec row, one disjunct, one redemption branch. No second system. |
| **Account oracle (H14.2)** | **CLOSED.** `grant_governing_body_role_by_email` **dropped**; one path that works either way. |
| **Results / standings (H14.3)** | **CLOSED** by reuse of `lib/competitions/standings.ts`. No second computation. |
| **Affiliation lifecycle (H13.3)** | **CLOSED BY DECISION.** Published reference data, no repository requirement, and the Clubs page now says where the list comes from and offers no control that would overwrite it. |
| **Club competition entry** | **CLOSED as a read.** The gap was legibility, not consent. |
| **Organisation scope (H13.1)** | **DECIDED, NOT IMPLEMENTED**, and renamed. `governing.access.manage` registered with `valid_scopes = {organisation}` — *required*, because `access_invitations.issuer_capability` is a foreign key into the catalogue — so the vocabulary has one home while the engine keeps refusing the scope. |
| **Messaging (H14.4)** | **Defect fixed; body-as-sender DEFERRED** — no organisation conversation and no `may_send_as` model exists. |
| **Welfare (H14.5)** | **DEFERRED.** Every safeguarding concept is club-scoped; nothing escalates to a county. |
| **Dispensation (H14.6)** | **SEMANTICS PRESERVED, DEFERRED.** |

## 5. RED changes

| | |
|---|---|
| `internal.organised_edition_ids` | one disjunct — RLS on eight tables |
| `internal.competition_organiser_recipients` | notification routing |
| `public.issue_invitation` | organisation scope resolution and the body column |
| `public.redeem_invitation` | one branch, and the **issuer** re-check learning the organisation case |
| `internal.can_administer_invitation` | one disjunct — revoke and resend |
| `access_invitations` | one nullable scope column, three constraint changes, `scope_key` regenerated |
| `public.capabilities` | one row |
| **dropped** | `grant_governing_body_role_by_email` |

**No table was added. `internal.capability_decision` was not touched.**

## 6. Two things the proof caught

1. **An organisation invitation filed at `issued_level = 'SITE'` could never be redeemed.** Redemption's
   step 8 re-checks the *issuer's* authority and its `SITE` branch requires a `site_admins` row — a county
   officer has none, so every invitation was refused as `issuer_authority_lost`. Fixed with an
   `ORGANISATION` level and an issuer-keyed disjunct. Caught by the suite's first run.
2. **A `Date.now()` comparison in a render** — the same impure-render defect Step 10 removed from the team
   page. The reader now answers `expires_soon`, because the database is the thing that knows the time.

Also: the Step 16 browser journey initially picked `uat.coach` as its "club admin with no county role",
who is in fact the county's Competitions Officer — so the affiliation assertion failed *correctly*. The
persona selection now excludes body-role holders, which is what makes it a test of affiliation.

## 7. Focused proof

| | |
|---|---|
| `step16_governing_closure` | **72 / 72** — invitations, redemption, revoke/resend, the RLS half, notification routing, the club's side, affiliation and organising conferring nothing, two races, and the boundaries |
| `85-competition-governing-closure` | **38 / 38** — both sides in one journey, viewer negative, axe (**0 violations**), a real `<table>`, 390px, self-cleaning; run four times |
| `84` · `83` | **60 / 60** · **15 / 15** — updated where Step 16 moved the same guarantees |
| `step15_governing_product` · `step14_governing_body` | **67 / 67** · **26 / 26** |
| `invitation_authority_matrix` | **71 / 71** — both invitation functions were rewritten |
| `invitation_joining_closure` · `invitation_team_list` · `invite_only_onboarding` | **23 / 23** · **39 / 39** · **7 / 7** |
| `competition_authority_matrix` · `competition_matches` · `competition_creator_conformance` · `fixture_bulk_planning_authority` | **87 / 87** · **28 / 28** · **13 / 13** · **28 / 28** |
| `security_perimeter_guard` · `perimeter_manifest.test.mts` | **6 / 6** · **12 / 12** |
| tsc · build · lint | clean · clean · **181/5/176, the unchanged baseline** |
| Static guards | content standard, authority guards, SQL registry (**290** declared, 0 undeclared), browser registry (**58** in the gate), Match Centre shared, fixture bulk authority |

**Not run, deliberately:** no canonical gate, no clean boot, no production rehearsal, no whole-platform
sweep. `partner_club_invitations` (SPECIAL_PURPOSE) still fails on its own club-claim seeding, as before.

## 8. FUNCTIONS BEFORE 24 · AFTER 34 · LOST 0

Item by item in `CONVERGENCE_STEP_16_FUNCTIONALITY_MATRIX.md`, including why dropping
`grant_governing_body_role_by_email` loses nothing.

## 9. Review world

Reproducible, and now with something in it:

```
node scripts/review-fixtures/step2-review-club.mjs enrich-governing
node scripts/review-fixtures/step2-review-club.mjs enrich-governing-competition
```

**Review County Junior Cup** now has **four Under 12 Boys sides** from four affiliated clubs (all four
genuinely field one), **six matches issued, three with results**, and **twelve club answers outstanding**
— written entirely through the product's own competition RPCs, so every record is one the Competition
Creator would have made. Both halves are reviewable: the county's view and the club's.

## 10. OWNER PRODUCT DECISIONS REQUIRED

**D1 — Should a governing body decide an age-grade dispensation natively in Ovalball?**
*Today:* the `governing_body` stage is the **source club** recording the certificate it holds
off-platform; the UI says so; `player_team_dispensation` has no `constituent_body_id`, and existing
rows' `governing_body_decided_by` points at **club** administrators.
*Options:* **(a)** leave it as attestation only; **(b)** add a **native decision beside** it, as a second
provenance path, leaving historical rows untouched; **(c)** replace attestation with native decision.
*Consequence:* (c) **falsifies existing records about children** and is not recommended. (b) is a
migration plus a queue, and puts a county officer in front of a child's age-grade exception — which is a
safeguarding decision before it is an engineering one. (a) costs nothing and is honest.

**D2 — What is governing-body "welfare", if anything?**
*Today:* nothing. Every safeguarding concept is club-scoped — officers nominated at a club, confirmed by
Ovalball, notified by `internal.notify_club_safeguarding_officers(club_id, …)`. Nothing escalates to a
county and no table records a body's involvement.
*Options:* **(a)** nothing, and say so; **(b)** **officer-compliance oversight only** — does each
affiliated club have a confirmed Safeguarding Officer? — which needs no case data at all; **(c)** case
escalation.
*Consequence:* (b) is genuinely useful and reads no child's record. (c) would put a county inside club
case notes and needs a safeguarding decision, a legal basis and a privacy classification first.

**D3 — Who may a governing body message, and as whom?**
*Today:* the organiser↔club channel exists as **notifications** and is now routed correctly. There is no
organisation conversation and no sender identity for a body.
*Options:* **(a)** notifications only; **(b)** a **competition-scoped** thread between the organiser and
the participating clubs, which has a natural boundary; **(c)** a general body→club broadcast.
*Consequence:* (c) is the `team.community.manage` coupling mistake with a wider blast radius — one
organisation speaking as another identity. (b) is bounded by the competition and is the safe first step.

**D4 — Who at a club should be able to withdraw a team from a competition?**
*Today:* **nobody** — entry and withdrawal are the organiser's act, and a club that cannot field a side
declines the individual matches. That is the canonical model and Step 16 did not change it.
*Options:* **(a)** leave it; **(b)** let `competition.match.respond` holders request a withdrawal, which
the organiser confirms; **(c)** let a Club Admin withdraw unilaterally.
*Consequence:* (c) lets a club vanish from a table mid-season without the organiser agreeing. (b) is a
request, not an authority, and matches how the rest of the fixture product behaves.

## 11. Step 17's list

Step 16 exposed no new gaps between the four concepts beyond the deferrals above. What is left is:
the `organisation` capability scope (H13.1), the governing-body email event (H15.1), server-side
standings for a native client (H15.3), and whichever of D1–D4 the owner decides.

## 12. Manual review checkpoint

Sign in as `uat.preston.admin@ovalball.test`, switch to *Ovalball Review County RFU*
(`/governing/7d01b631-86fb-4c44-9708-e22b83daf744`). Then sign in as the Club Admin of an entered club and open
**Fixtures & Calendar → Competitions**.

- **Does affiliation make sense from both sides?** The county lists its clubs and says where the list
  comes from; the club sees the county named as the organiser of a competition it is in — and neither
  gives the other any authority.
- **Does competition entry feel like a relationship?** The county enters teams and issues a draw; the club
  sees what it is in and answers each match.
- **Can the county see its real results naturally?** Competitions → Results & Table.
- **Does People & Access feel like inviting somebody**, rather than searching a user database?
- **Does switching Club ↔ Governing Body feel like switching jobs?**
- **Are we giving the governing body too much authority anywhere?** The specific things it deliberately
  cannot do: read a club's fixtures, members or roster; affiliate or un-affiliate a club; message as a
  club; touch anything safeguarding-shaped; withdraw a team from its own competition on a club's behalf.

## 12. Hardening pass (after `1858392`)

**One product defect, three verification gaps.** Full detail in the hardening ledger (H15) and the
functionality matrix; the short version is that this report's §9 claim about external-versus-external
matches was true but untested, and §28's question about losing access was answered for revocation and
not for suspension.

The defect: `redeem_invitation` reinstated a **SUSPENDED** governing-body role, and could raise it at the
same time — measured, a `SUSPENDED BODY_COMPETITIONS` officer redeemed and returned as an ACTIVE
`BODY_ADMIN`. Nothing writes `SUSPENDED` yet, so this was closed before it was reachable. The fix is
migration `20270530000000`, which refuses it the way this function refuses everything else: by returning
`REFUSED / ORGANISATION_ACCESS_SUSPENDED`, not by raising. An earlier attempt that raised was caught by
`invitation_authority_matrix` **IN-K2**, whose whole point is that a raise rolls back the attempt record
and defeats the redemption rate limits.

`step16_governing_closure` goes **72 → 91** assertions. **FUNCTIONS LOST remains 0.**

**Still owed:** the migration has been applied to the running local database and proved there, but the
full chain has **not** been booted from empty since it was added. That remains required before release.
