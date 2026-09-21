# Convergence Step 14 — Governing Body Foundation — archaeology

Measured against `5e92c93`, before any migration, as §26 requires.

## 1. The finding: most of the model already exists

**`public.constituent_bodies` has been in the schema all along, with 35 real rows.**

| | |
|---|---|
| Shape | `rugby_code`, `nation`, `canonical_name`, `short_name`, **`body_type`**, `active`, `source`, `source_url`, `source_checked_on` |
| Rows | **35** — 28 `GEOGRAPHIC` (county RFUs), 3 `ARMED_FORCES`, 2 `UNIVERSITY`, 1 `SCHOOLS`, 1 `REFEREES` |
| Provenance | `source = 'rfu_official'` with a URL and a checked-on date per row — verified reference data, not invented |
| Referenced by | **`club_directory.constituent_body_id`** — the club↔body affiliation already exists (6 of 1400 directory clubs currently affiliated) |
| Surfaced in | only Site Admin club-directory editing, as a field on a club. There is no organisation surface at all |

So **organisation identity and club affiliation are already canonical**. Step 14
must not create a second organisation table, a second affiliation table, or a
"groups of clubs" hierarchy beside this one.

## 2. What genuinely does not exist

| gap | evidence |
|---|---|
| **Any person↔body relationship** | nothing links a person to a constituent body, anywhere |
| **Any governing capability** | `select count(*) from capabilities where key ~ 'body\|governing\|constituent'` → **0** |
| **Any organisation scope** | `bundle_capabilities.scope_type` is constrained to `self · child · team · club · site`. There is no body scope, and `internal.capability_decision(subject, key, scope_type, club, team, player, …)` takes no body argument |
| **Competition ownership by a body** | `competitions` has `organiser_name` (free text) and `organiser_club_id` (a club). A body cannot own a competition |
| **Any product surface** | no route, no navigation, no read model |

## 3. Why the access model needs one new table

`role_assignments` is the canonical role and lifecycle machine — ACTIVE/REVOKED,
suspension, confirmation — and reusing it would have been the obvious choice.
**It cannot carry this**: `role_assignments.club_id` and
`role_assignments.membership_id` are both **NOT NULL**, so every role assignment
hangs off a club membership. A governing-body officer is deliberately *not* a
club member, and loosening those columns to make room would weaken the club model
for every other role in the platform.

So Step 14 adds exactly one relationship table, `constituent_body_roles`,
modelled on the same state vocabulary, and one nullable column on `competitions`.
Nothing else.

## 4. Why no new capability scope, this step

Adding a sixth scope would mean changing `internal.capability_decision`'s
signature and resolution — the single most important function in the platform,
called by every authority decision. That is a RED change with a whole-platform
blast radius, and a foundation step is the wrong place for it.

Instead, governing-body authority resolves through **one dedicated function** over
the canonical relationship, in the same shape as
`internal.is_active_safeguarding_officer` (a capability plus a relationship that
names *which* one). The capability **keys are registered in the canonical
`public.capabilities` catalogue** so the vocabulary has one home.

**Promoting a `body` scope into `capability_decision`** is recorded as hardening
debt for whoever owns the capability engine — it is the right end state, and it
is not a sprint decision.

## 5. Groups of clubs — the §9 decision

The backlog asks for "groups of clubs / regional bodies". **`body_type` already
answers this**: a county RFU, an armed-forces union, a schools or university
union and a referees' society are all real rugby organisations and are all
already constituent bodies.

**Decision: a group of clubs that is a real rugby organisation IS a constituent
body, and Step 14 adds no second grouping concept.** An arbitrary ad-hoc
collection of clubs — a friendly league somebody invents, a shared training
pool — is *not* modelled here, because inventing a second hierarchy beside the
verified one is how two answers to "which organisation is this" get created.
If an ad-hoc grouping is later needed, it belongs beside competitions, not beside
governing bodies.

## 6. Boundaries confirmed, not assumed

- **Knowledge is not authority (§6).** Rugby Hub entities and
  `regulatory_*` facts describe governing bodies; none of them is an operational
  record and none grants anything. Step 14 links nothing from Hub into authority.
- **Regulatory fact is not permission (§7).** The age-grade and regulatory
  resolvers answer rugby questions. Authority here comes only from an ACTIVE row
  in `constituent_body_roles`.
- **Competition architecture is locked (§10).** Competition → Participants →
  Matches → optional Fixtures is untouched. A body becomes one more kind of
  organiser beside the existing club organiser; nothing is made to require a body.
- **Safeguarding (§19).** A body relationship grants no safeguarding capability,
  no DOB, no medical data, no case notes. Nothing in this step touches those.
- **Site Admin** remains site-scoped and does not become a member of any body.

## 7. Functions before

| | |
|---|---|
| FUNCTIONS BEFORE | **4** — the body record itself; its verified provenance; club affiliation via `club_directory.constituent_body_id`; and Site Admin editing of that affiliation on a club |
