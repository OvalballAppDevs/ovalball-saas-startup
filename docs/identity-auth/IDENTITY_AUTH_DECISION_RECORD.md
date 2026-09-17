# Identity/Auth programme — decision record

The locked product decisions for the identity, authentication and authorization programme, in one
place. Until now they were referenced by number across a dozen release reports without ever being
written down together, which is how a locked decision gets quietly re-litigated.

**These are the product owner's decisions, not the implementation's.** Design and implementation
follow them. Where architecture finds a technical reason to reconsider one, it is raised rather than
silently deviated from — and the deviation is never made by the slice that noticed it.

| | Decision | Decided at | Owner of the work |
|---|---|---|---|
| **D-S4-1** | Slice 4 is delivered as sub-slices 4a–4i in AA.3 order, each banked and released separately | Slice 4 start | Slice 4 (complete) |
| **D-S4-2** | 4G owns the Safeguarding Officer appointment authority and state machine; Slice 5 owns the email-bound invitation and redemption entry path **into that same state machine** | Slice 4 start | 4G (complete) / Slice 5 |
| **D-S4-3** | From a player's 18th birthday, guardian child-scope authority stops applying, decided at request time | Slice 4A | Slice 4A (complete) |
| **D-S4-4** | Adults' account pictures are visible to any signed-in person; a minor's only to the minor, their ACTIVE guardians and staff holding `player.profile.view` | Slice 4A | Slice 4A (complete) |
| **D-S5-1** | Unknown or unverified age must not cross a minor-prohibited or safeguarding-sensitive authority boundary — gated at the canonical write/transition boundary | Slice 4 closure, before Slice 5 | **Slice 5 (not started)** |

---

## D-S5-1 — unknown age does not establish adulthood

**Approved.** Option B of `DECISION_REQUIRED_unknown_age_before_slice_5.md`, which restated the
finding carried since Slice 4B in `SECURITY_FOLLOW_UP_unverifiable_age.md`.

### The decision

For Slice 5, gate the sensitive write and transition paths where adult eligibility must be
established. **An identity with unknown or unverified age must NOT be treated as an adult for the
purpose of crossing a minor-prohibited or safeguarding-sensitive authority boundary.**

### Constraints, as given

1. **Do not redefine `internal.person_is_minor`.** D-S4-4 reads that predicate for account-picture
   visibility, and redefining it would silently move a locked decision belonging to another slice. A
   separate predicate answering *"is the age established at all"* is the right shape.
2. **Do not make Date of Birth universally mandatory at signup.** Phase 2 ID-5 stands.
3. **Do not retroactively revoke existing users** solely because their age is unknown.
4. **Surface existing affected identities as `NEEDS_ATTENTION`** for later review and backfill.
5. **Invitation redemption must not allow an unknown-age identity to acquire a minor-prohibited or
   safeguarding-sensitive role.**
6. **Apply the gate at the canonical write/transition boundary**, so that alternate REST, RPC and
   server-action paths cannot bypass it.
7. **Rehearse against production-shaped data** and identify exactly which existing identities would be
   affected, before any later fail-closed resolver change.

### What this deliberately does not do

It does not change `internal.capability_decision`. Nobody currently holding a role loses it. The
guarantee is fail-closed on **new** crossings and visible-but-tolerated on existing ones, which is
the shape the owner has chosen for this class of fix throughout the programme: prohibit new, flag
existing.

A later move of the guarantee into the resolver itself remains open, and constraint 7 is the gate on
it: it may not happen until a rehearsal has shown exactly which existing identities change state.
Slice 4B measured a version of that change and the platform suite went from 3594/0 to 3508/18 across
roughly fifteen suites spanning Slices 1, 2, 3 and 4a. That blast radius is why it is not bundled
into Slice 5.

### The Safeguarding Officer path, unchanged

D-S4-2 and the 4G state machine are preserved. Slice 5 **reuses** that state machine and does not
create another one. The full external path is:

```
email-bound invitation
  -> authenticated matching identity
  -> adult eligibility established          <- D-S5-1 applies HERE
  -> legitimate ACTIVE club membership
  -> existing 4G PENDING_CONFIRMATION seam
  -> ZERO Safeguarding Officer authority
  -> AN-6 Ovalball confirmation
  -> ACTIVE
```

Every step after the eligibility check already exists and is production-verified: 4G built the
nomination transition, the PENDING_CONFIRMATION state that confers no authority, and the AN-6
confirmation through canonical Slice 3 site capabilities with no `is_site_admin()` shortcut and no
self-confirmation. Slice 5 adds the first two steps and the eligibility gate, and calls into the
rest.

Building a second appointment state machine in Slice 5 would breach D-S4-2.

### Where the current behaviour is pinned

`supabase/tests/roster_authority_matrix.sql` **RA7** pins today's behaviour as it actually is, using
only objects that predate Slice 4B, so that Slice 5 changes those assertions deliberately rather than
by accident. That assertion is the tripwire for this decision: when it changes, D-S5-1 is being
implemented.

### The three questions, resolved

Slice 5 stopped at implementation because "adult eligibility established" had no defined
representation, evidence standard or transition. The owner resolved all three. This is an **approved
clarification of D-S5-1**; it is not permission to change D-S4-4 or to redefine
`internal.person_is_minor`.

**Q1 — evidence standard.** A **canonical recorded date of birth that establishes the person is an
adult** is sufficient age evidence for ordinary minor-prohibited staff authority. This is an
**age-eligibility** rule, **not** external identity or proof-of-age verification, and must never be
described as independently verified proof of age.

For SAFEGUARDING_OFFICER, a recorded DOB establishing adulthood is required **before** entering the
nomination path, **and** 4G's AN-6 Ovalball confirmation remains independently mandatory. AN-6 is not
itself proof of age. **Neither substitutes for the other.**

**Q2 — scope.** The gate applies to **every** role and capability transition the canonical catalogue
classifies `minor_prohibited` — seven roles (CLUB_ADMIN, COACH, FIXTURES_SECRETARY,
SAFEGUARDING_OFFICER, TEAM_ADMINISTRATION, TEAM_MANAGER, VOLUNTEER) and 212 capabilities. The
affected set is **derived from the canonical metadata**, never from a second handwritten list in the
invitation UI. Alternate REST, RPC and server-action paths are included.

**Q3 — representation.** A canonical predicate over the person's canonical recorded DOB. No separate
eligibility-state table. Semantics: *"does the canonical recorded DOB establish that this person is
currently an adult under Ovalball's existing age boundary?"* — missing DOB `FALSE`, unusable DOB
`FALSE`, recorded minor `FALSE`, recorded adult `TRUE`; server-derived, never client-authoritative,
deterministic, and tested at the exact boundary dates. Existing age arithmetic is reused rather than
duplicated.

### What this deliberately still does not do

It does **not** make Date of Birth mandatory to create or use an Ovalball account. An identity with
no recorded DOB may hold an account, hold relationships and use everything not prohibited to minors.
The gate applies only where a write or transition would confer `minor_prohibited` authority.

Where such an identity reaches a redemption flow without sufficient DOB, the transition fails closed
and the designed eligibility-required continuation is shown. **A one-time invitation is not consumed
before every eligibility check required for the transition has succeeded**, and it remains redeemable
once eligibility is established rather than being silently discarded.

### Existing holders

Unchanged: no retroactive revocation. Existing holders whose age cannot be established remain
`NEEDS_ATTENTION` for later review and backfill. Slice 5 identifies and rehearses that population
against production-shaped data but does not revoke it. Enforcement is at the **write/transition**
boundary; `internal.capability_decision` is not changed, so no read-time resolver change can
retroactively strip authority.

### Status

**Implemented in Slice 5 stage 1**, commit `819830a`. RA7 remains the tripwire.

---

## Autonomous decisions (delegated authority, Slices 5–10)

The owner delegated ordinary implementation, architecture, migration, compatibility and security
decisions within the approved Identity/Auth programme, to be recorded here with the decision, the
reason, the alternatives rejected, the authority consequence and the owning slice.

### D-S5-AUTO-1 — invitation events carry no secret-shaped metadata key

**Decision.** `invitation.issued` no longer records `code_hint` in its event metadata.
**Reason.** The platform's audit guard refuses any metadata key matching password/token/secret/code/otp,
and it refused this one. The hint is two characters for administrator display, but a blanket rule
about key *names* should not acquire exceptions — the next key called `code_something` would pass on
the precedent.
**Alternatives rejected.** Widening the guard's pattern (weakens a working control for a cosmetic
gain); renaming the key to evade the pattern (defeats the control by wordplay).
**Consequence.** None for authority. The event carries `invitation_id`, and
`access_invitations.code_hint` is one join away, so nothing is lost and the audit trail stops
restating a fragment of a secret.
**Owning slice.** 5.

### D-S5-AUTO-2 — a refused redemption returns, it does not raise

**Decision.** `redeem_invitation` returns `{"outcome":"REFUSED", ...}` for every refusal. Only a
missing session and missing input still raise.
**Reason.** This was a real defect, not a style choice. The function logged every attempt into
`invitation_redemption_attempts` and then raised — and the raise rolled the log entry back. Postgres
has no autonomous transactions here, so the O.2 rate limits could never fire, and
`invitation.identity_mismatch` and `invitation.issuer_authority_lost` were never written. An attacker
could guess codes without limit and leave no trace, which is exactly what the attempt table exists to
prevent. It is the M-5 lesson from Slice 4G in a new place.
**Alternatives rejected.** `dblink` or `pg_background` for an autonomous transaction (adds an
extension and a second connection to the most security-sensitive path in the slice); writing the
attempt from a trigger (same rollback); keeping the raise and accepting no rate limiting (abandons an
O.2 requirement).
**Consequence.** Rate limiting and the two probe-detection events now work. Callers must treat
`REFUSED` as failure; the refusal message stays identical for every cause, so a prober still cannot
tell a revoked invitation from one that never existed.
**Owning slice.** 5.

### D-S5-AUTO-4 — one chokepoint for invitation redemption

**Decision.** `lib/invitations/redeem.ts` is the only module permitted to name the `redeem_invitation`
RPC. `scripts/verify-redemption-callers.mjs` fails the build if anything else does, and runs in the
permanent battery.
**Reason.** D-S5-AUTO-2 made refusals return rather than raise, which was necessary but created a
caller contract that does not look dangerous at the call site: the RPC call *succeeds* on a refusal,
so a caller that ignores the result, or treats an unrecognised outcome as success, grants a
membership or a role the database refused. Proving that property about arbitrary future call sites is
hard; having one chokepoint is easy and checkable.
**Alternatives rejected.** A lint rule that inspects each call site for an outcome check (brittle, and
it cannot see through a helper); trusting review (this is exactly the mistake review does not catch);
returning a tagged error object from the RPC and hoping callers destructure it.
**Consequence.** Redemption returns a discriminated union that cannot be used without inspection, and
fails closed on any outcome this build does not recognise — including an outcome a *newer* database
knows about, which is the dangerous case. The verifier additionally refuses a success list containing
`REFUSED`. Refusals share one generic message so they cannot become an enumeration oracle; only
`AGE_ELIGIBILITY_REQUIRED` and `MEMBERSHIP_REQUIRED` are surfaced, because a person can act on those.
**Owning slice.** 5.

### D-S5-AUTO-5 — the legacy token columns become nullable, and column-limited

**Decision.** All six legacy invitation tables get `token` set nullable, and their table-level SELECT
grant is replaced by an explicit per-column grant that omits `token`.
**Reason.** O.5 says to null the plaintext token on terminal rows, and every one of the columns was
`NOT NULL`, so the disposition was literally impossible to carry out. Separately, a column-level
`REVOKE` does nothing while a table-level grant exists — PostgreSQL's table grant already covers every
column — so excluding the secret required replacing the grant rather than revoking a piece of it.
**Alternatives rejected.** A sentinel value such as `''` or `'RETIRED'` (still has to be excluded
everywhere, and reads as a token in a backup); deleting terminal rows outright (destroys the
read-only history O.5 deliberately keeps); leaving the grant alone and relying on nothing querying the
column (that is a habit, not a control).
**Consequence.** Terminal and expired rows lose the secret; a live pending invitation keeps it until
expiry, so nothing legitimate is invalidated. No browser role can select the column at all, so a
future policy written too loosely still cannot leak it. Production held **six revoked
`site_admin_invitations` rows with plaintext platform-authority tokens**; those are cleared by this
migration, and the one pending invitation is honoured until it expires.
**Owning slice.** 5.

### D-S5-AUTO-3 — "you have already accepted this" is answered before the terminal-state check

**Decision.** The per-person idempotency answer moved ahead of the missing/revoked/expired/used check.
**Reason.** A one-time invitation is `REDEEMED` after use, so the person who had just accepted it was
told, generically, that it could not be used. The commonest cause of a second click is a slow page or
a back button.
**Alternatives rejected.** Leaving the order and having the server action infer the cause — it cannot,
because the refusal is deliberately identical for every cause.
**Consequence.** Safe. The lookup is keyed on `(invitation, user)`, so it tells that person only what
they already did and a stranger has no row. Everyone else still gets the one generic sentence.
**Owning slice.** 5.
