# Convergence Step 16 — Competition / Governing Closure — archaeology

Measured against `7a9960b`, before any Step 16 migration, as §3 requires.

## 0. The master programme's own definition of Step 16

`CONVERGENCE_STEP_0_MAP.md` §8 is the only checked-in assignment:

> | Governing Body foundation → product → workflow closure | **14–16** |

So Step 16 is **workflow closure** and the handoff is the most precise definition
that exists. Nothing in the repository contradicts it. What the repository *does*
contradict is four of the nine closure items — recorded below, with evidence.

---

## 1. FUNCTIONS BEFORE — 24

Steps 14–15's twenty-four, carried in
`CONVERGENCE_STEP_15_FUNCTIONALITY_MATRIX.md` and unchanged here.

---

## 2. The closure table

| # | requested closure | existing canonical owner | gap | risk | disposition |
|---|---|---|---|---|---|
| H13.1 | body capability scope | **`internal.capability_decision`, and the scope is already named `organisation`** | the engine refuses it at rule 1 with `SCOPE_NOT_IMPLEMENTED`; implementing it means a new parameter on the platform's most-called function, plus the override model and `bundle_source` | **RED** | **DECIDED, NOT IMPLEMENTED** — §3 below. Debt renamed to the canonical word and a structural guard added so a second authority system cannot appear |
| H13.3 | affiliation lifecycle | **`club_directory.constituent_body` + `.constituent_body_id`** | none — there is no lifecycle because affiliation is **published reference data**, not a negotiated relationship | GREEN | **CLOSED BY ARCHAEOLOGY** — §4. Provenance surfaced; no verbs invented |
| H14.1 | governing-body invitations | `access_invitations` + `internal.invitation_kind_spec` + `issue_invitation` / `redeem_invitation` | no kind, no organisation scope column | **RED** | **IMPLEMENTED** through the canonical architecture — §5 |
| H14.2 | account-existence oracle | the invitation path itself | `grant_governing_body_role_by_email` answers `NO_ACCOUNT` | **RED** | **CLOSED WITH H14.1** — one path, one answer |
| H14.3 | body competition results / standings | **`lib/competitions/standings.ts`** — already computes from Competition Matches, "never from club fixtures" | no read model and no body surface | AMBER | **IMPLEMENTED** by reuse — §6 |
| H14.4 | messaging | `internal.competition_organiser_recipients` (notifications), `club_conversations` / `team_conversations` / `direct_conversations` | **a real defect** (§7) plus no body sender identity | RED / deferred | **the defect fixed; body-as-sender DEFERRED with an owner decision** |
| H14.5 | welfare | nothing | no defined job exists anywhere in the repository | — | **DEFERRED, owner decision required** — §9 |
| H14.6 | governing-body dispensation | `decide_player_dispensation` | none — the stage is the club's attestation, by design | — | **SEMANTICS PRESERVED, owner decision required** — §8 |
| — | club-side competition entry | `competition_participants` + `competition_match_verifications` + `respond_competition_match` | **entry has no consent step by design; the club's act is per-match confirmation. The gap is that a club cannot see which competitions it is in** | AMBER | **IMPLEMENTED** as a read model and surface — §10 |

---

## 3. H13.1 — the scope is called `organisation`, and the engine already says so

Two pieces of checked-in evidence, neither of which Step 14 or 15 had found:

```sql
-- internal.capability_decision, rule 1
if p_scope_type = 'organisation' then
  decisive_rule := '1'; reason_code := 'SCOPE_NOT_IMPLEMENTED'; return;
end if;
```

```sql
-- public.capabilities
CHECK (cardinality(valid_scopes) > 0
   AND valid_scopes <@ ARRAY['self','child','team','club','organisation','site','public'])
```

`20270350000000_capability_resolver_and_site_profiles.sql` lists it in the
resolver's own header: *"rule 1 hard rule — … invalid or tampered scope,
**organisation scope**"*. **Zero capabilities declare it** today.

So the canonical long-term answer is not in question: **`organisation` is the
reserved scope, it is deliberately unimplemented, and the refusal is a documented
hard rule rather than an oversight.** Step 14 and 15 called it "body scope"; the
platform calls it `organisation`, and the debt is renamed accordingly.

**Decision: do not implement it in Step 16.** The blast radius, read off the
resolver:

1. a **new parameter** on `internal.capability_decision`, which `internal.can`,
   `internal.has_capability`, `internal.bundle_source` and `explain_access` all
   call, and which hundreds of RLS policies reach through;
2. rule 1's club-status and membership-suspension checks have no organisation
   analogue (they would need body-active and role-state equivalents);
3. rules 2–5 read `capability_overrides`, which is club/team-keyed — organisation
   overrides would need a column and new level semantics;
4. rule 6 `internal.bundle_source` resolves bundles from `club_memberships` and
   `role_assignments`, both club-rooted;
5. `bundle_capabilities.scope_type` is constrained to five values.

That is whole-platform RED work on the single most-called function in the
platform, which is precisely what `SCOPE_NOT_IMPLEMENTED` exists to hold shut.

**What replaces it until then, and why it is not a second authority system.**
Governing authority is **one** resolver chain — `internal.body_role` →
`can_view_body` / `can_manage_body` / `can_manage_body_competitions` — over one
relationship table, in the same shape as `internal.is_active_safeguarding_officer`
(a relationship a capability decision consults). Step 16 adds
`supabase/tests/step16_governing_closure.sql` assertions that (a) exactly those
three predicates decide governing authority, (b) nothing else does, and (c) **no
capability declares `organisation` while the engine refuses it** — because an
ACTIVE capability the engine can never allow is a trap for the next person, which
is why Step 14 registered none.

---

## 4. H13.3 — affiliation is published reference data, so there is no lifecycle

The finding that closes it: **`club_directory.constituent_body` is a `text`
column holding the county's published name**, beside the resolved
`constituent_body_id` FK.

| | |
|---|---|
| `Bishop's Stortford RFC` | `Hertfordshire RFU` |
| `Widnes Rugby Football Club` | `Lancashire RFU` |
| `Old Bedians Rugby Football Club` | `Lancashire RFU` |

Their directory rows carry `source = 'lancashire_rfu'`, `'official_club'`,
`'gloucestershire_rfu'`, `'devon_rfu'` — **acquired from the county unions' own
published club lists**, exactly as `constituent_bodies` itself carries
`source = 'rfu_official'` with a `source_url` and a `source_checked_on`.

**Which county a club belongs to is a fact the RFU publishes, not an agreement two
Ovalball parties reach.** A county does not invite a club to affiliate; the
governing-body structure says which county the club is in. This is the same
principle CLAUDE.md already states for regulation — *regulation derives from
regulation* — and the same reason there is no rename control on a team identity.

**There is also no requirement for a lifecycle anywhere in the repository.** A
search of `docs/` for "affiliat" outside the Step 14/15 documents I wrote returns
**nothing**. The verbs in §10 — invite, accept, activate, end, suspend, move —
have no product source behind them.

**Decision: affiliation stays read-only, and Step 16 shows its provenance instead
of inventing a workflow.** A body officer who believes the list is wrong is
looking at a **reference-data correction**, which belongs with whoever maintains
the Club Directory, not at a button that silently overwrites a published fact and
last season's meaning with it. Recorded for the owner as a decision, not a gap.

---

## 5. H14.1 / H14.2 — the canonical invitation architecture extends cleanly

`internal.invitation_kind_spec(kind)` is a per-kind table of
`(issuer_capability, scope_type, site_alternative, lifetime, issued_level)`, and
`issue_invitation` checks the issuer against it with one disjunct per scope type
(`site`, `club`, `team`, `child`) plus a `site_alternative`. `redeem_invitation`
holds the whole hardened redemption — 15-minute and daily throttles, terminal
states persisted before refusal, one generic refusal message for missing, revoked,
expired and used alike, email binding to the session's own **confirmed** address,
`invitation_redemptions` idempotency, and `use_count`.

**`invite_safeguarding_officer` is the precedent**: a dedicated issuer that
**calls `public.issue_invitation`** rather than writing its own token. (The
counter-example, `invite_player_account` over its own
`player_account_invitations` table, is exactly the parallel system this step must
not copy.)

So Step 16 adds a kind, not a system: `GOVERNING_BODY_OFFICER`, one nullable
`access_invitations.constituent_body_id`, one spec row at
`scope_type = 'organisation'`, one disjunct in `issue_invitation`, one branch in
`redeem_invitation`, and the body in `preview_invitation`'s scope label.

**The body travels in `p_intended_outcome`, not a new parameter.** Adding
`p_body_id` to `issue_invitation` would create an overload that makes every
existing call ambiguous, and dropping the function to re-add it puts a contract
surface at risk for no product gain. For this kind the organisation genuinely *is*
part of the intended outcome — "become Competitions Officer at this body" — and
`issue_invitation` validates it and writes it to the column, so the scope is a
real column for `scope_key`, the live-uniqueness index and RLS.

**The oracle closes because there is only one path left.** `People & Access`
invites; the invitation works whether or not the address already has an account,
so the product never has to distinguish. `grant_governing_body_role_by_email` —
the function that answered `NO_ACCOUNT` — is **removed**, not left with no
callers, because CLAUDE.md is explicit that a zero-caller helper is still a hazard.
`set_governing_body_role` survives as Site Admin master control and as what
redemption uses internally.

---

## 6. H14.3 — standings already exist, and are already canonical

`lib/competitions/standings.ts`:

> Standings are computed from Competition Matches — every match, **including two
> clubs that are not on Ovalball** — never from club fixtures. A match counts once
> it has both scores and has not been cancelled. Points are the organiser's (a
> stage setting), not a hardcoded rule.

It is what `app/competitions/[slug]/page.tsx` renders. So H14.3 is a read model
and a surface; **computing a second table would be the defect.** External-v-external
visibility comes free, because the module never looks at a fixture.

---

## 7. A real defect: a body organiser is not told what its own clubs answered

`internal.competition_organiser_recipients(edition_id)` is two branches:

```sql
select cm.user_id ... join club_memberships cm on cm.club_id = c.organiser_club_id
                        and cm.role in ('CLUB_ADMIN','FIXTURE_SECRETARY')
union
select sa.user_id ... join site_admins sa ... where c.organiser_club_id is null   -- <—
```

A body-organised competition has `organiser_club_id IS NULL`, so **branch 1
returns nobody and branch 2 treats the competition as unowned and notifies Site
Admins instead.** When a club confirms, requests a change to, or declines one of
the county's matches, `respond_competition_match` notifies the platform and not
the county.

This is the honest, canonically-supported slice of H14.4: the organiser↔club
communication channel already exists as notifications, and it is mis-routed.
Fixed in Step 16. **Body-as-a-sender-identity remains deferred** — there is no
organisation conversation and no `may_send_as` model, and granting one
organisation the right to speak as another identity is the `team.community.manage`
coupling mistake with a wider blast radius.

---

## 8. H14.6 — the dispensation semantics, confirmed a second time

`decide_player_dispensation`'s `governing_body` stage is authorised by
`fixture.dispensation.approve_club` **at the source club**, and refuses without
`p_governing_body_reference` — *"the dispensation certificate/case number the club
holds"*. `app/(app)/club/player-moves/` says it in the product's own words:
*"Ovalball records {the governing body's} approval — it does not grant it."*

`player_team_dispensation` has `governing_body_reference`,
`governing_body_decided_by` and `governing_body_decided_at` but **no
`constituent_body_id`** — there is no column in which a native Ovalball body
decision could even be recorded, and `governing_body_decided_by` on existing rows
points at **club** administrators. Reinterpreting those rows as native decisions
would falsify them.

**Step 16 changes nothing here** and asks the owner the question instead (§38 of
the handoff, and the register in the report). A safe unresolved decision is
better than changing the meaning of a child's regulatory record.

---

## 9. H14.5 — welfare has no definable job yet

Searched: `safeguarding_*` tables and RPCs, `docs/architecture/safeguarding-officer-model.md`,
`docs/PRIVACY_DATA_MAP.md`. Every safeguarding concept is **club-scoped** —
officers are nominated at a club, confirmed by Ovalball, and notified through
`internal.notify_club_safeguarding_officers(club_id, …)`. Nothing escalates to a
county, nothing aggregates across clubs, and no table records a governing body's
involvement in a case.

There is no under-specified feature to build carefully; there is **no feature**.
Deferred with an owner decision, which §21 names as a successful outcome.

---

## 10. Club-side competition: entry is the organiser's act; the club's act is the match

`competition_participants.status` is constrained to **`'entered' | 'withdrawn'`** —
there is no `invited`, `accepted` or `declined`, and `save_competition_participants`
is organiser-only through `internal.require_edition_organiser`. So the model has
**no club-side consent to entry**, and §16's candidate statuses must not be
created from the prompt.

The club-side half is at the **match**: `competition_match_verifications` per
(club, team) per match with `confirmed | change_requested | declined`, answered by
`respond_competition_match` under `internal.can_answer_competition_match`, which
is `competition.match.respond` at club **or** team scope. It is already surfaced
at `/fixtures/competitions/requests` ("Competition Requests"). **Tournaments are
the deliberate contrast** — `invite_tournament_participant` /
`respond_tournament_invitation` do have entry consent, which is why competitions
visibly do not.

**So §15's entry-authority question is already answered canonically** and needs
nothing invented: entering and withdrawing a team is the organiser
(`require_edition_organiser`); answering a match is
`competition.match.respond` at the club or the team.

**The actual gap is legibility.** `/fixtures/competitions` lists only the
competitions a club **organises**, so a club taking part in the county cup can see
individual match requests and has nowhere that says *which competitions we are
in, in which season, with which teams, run by whom, and what is outstanding*.
That is a read model and a surface — Step 16's club-side deliverable.

---

## 11. FUNCTIONS AFTER / LOST

Recorded in `CONVERGENCE_STEP_16_FUNCTIONALITY_MATRIX.md` at the end of the step.
**FUNCTIONALITY LOST must be 0**, including `grant_governing_body_role_by_email`,
whose one product function — give a named person access by email — is preserved
and widened by the invitation that replaces it.
