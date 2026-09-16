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

### Status

**Recorded, not implemented. Slice 5 is not started.**
