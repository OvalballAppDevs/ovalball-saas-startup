# DECISION REQUIRED before Slice 5 — unverifiable age

> **RESOLVED — Option B approved.** Recorded as **D-S5-1** in
> `IDENTITY_AUTH_DECISION_RECORD.md`, which is now the authority. This document is kept as the
> record of what was weighed: the four options, their consequences, and the recommendation the owner
> was choosing between. It is not re-written to match the outcome.
>
> The approved decision adds two things beyond Option B as described below: invitation redemption is
> named explicitly as in scope, and the gate must sit at the **canonical write/transition boundary**
> so alternate REST, RPC and server-action paths cannot bypass it. The Safeguarding Officer path
> reuses 4G's existing state machine rather than a second one, preserving D-S4-2.
>
> **Slice 5 is not started.**

---


This is a restatement for the human review boundary, not a new finding and not a proposal that has
been implemented. The full technical record is `SECURITY_FOLLOW_UP_unverifiable_age.md`, raised in
Slice 4B and carried unchanged through 4C–4I and the final closure pass. **Nothing here has been
built.** The decision belongs at the Slice 5 boundary.

## 1. What happens today

`internal.person_is_minor(user)` answers *"is this person **known** to be under 18"*. It reads a date
of birth from `profiles`, falls back to the newest `players.date_of_birth` the person owns, and wraps
the comparison in `coalesce(..., false)`. So an account with no recorded date of birth answers
**exactly as a forty-year-old does**:

```
person_is_minor(no date of birth) = false     <- indistinguishable from an adult
person_is_minor(recorded 12yo)    = true
```

`internal.capability_decision` reads that predicate for its rule-1 hard prohibition. Measured:

```
UNRECORDED AGE as TEAM_MANAGER -> allowed=t  rule=6  ROLE_BUNDLE      <- prohibition bypassed
RECORDED 12yo  as TEAM_MANAGER -> allowed=f  rule=1  MINOR_PROHIBITED
```

This is the ordinary case, not an edge case: Phase 2 **ID-5** makes Date of Birth optional unless the
person is a Player. On the development database 26 of 30 profiles had no date of birth.

It affects every `minor_prohibited` role — CLUB_ADMIN, SAFEGUARDING_OFFICER, FIXTURES_SECRETARY,
VOLUNTEER, COACH, TEAM_MANAGER, TEAM_ADMINISTRATION — and the safeguarding-sensitive team capabilities
their bundles carry.

## 2. Why Slice 5 specifically changes the risk

Every route into a minor-prohibited role today starts **inside** a club: somebody who already has
authority adds somebody the club knows. Slice 5 owns **external email-bound invitation and
redemption** — invitations, join codes and claims, including `TEAM_JOIN_CODE` and team join code
issuance.

That is the difference that matters. Today an unknown-age account reaching Team Manager requires a
club administrator to put them there. After Slice 5, a person who has never been seen by the club can
arrive from an email link, create an account with **no date of birth** because the form does not
require one, redeem an invitation or code, and hold a safeguarding-sensitive role over children —
with no human at the club having established that they are an adult, and with the platform unable to
tell the difference between "adult" and "we never asked".

Slice 5 does not create the gap. It removes the human step that is currently, accidentally, the only
thing narrowing it.

D-S4-2 already routes external email-bound safeguarding invitation and redemption to Slice 5, so the
first thing Slice 5 builds is the thing that widens this.

## 3. The options

**A — Do nothing for now; ship Slice 5 as specified.**
Cheapest, and consistent with how it has been carried so far. The consequence is that Slice 5's first
release measurably widens a known gap in a children's sport platform: "we could not establish an age"
continues to read as "this is an adult", now reachable without anyone at the club looking.

**B — Gate the write paths, leave the resolver alone (fail-closed on new, flag existing).**
`internal.grant_role`, `transition_role_assignment`, `set_capability_override` and Slice 5's
redemption path refuse to place an account with no established age into a `minor_prohibited` role.
`internal.capability_decision` is untouched, so nobody currently holding a role loses it. The
remaining gap surfaces as `NEEDS_ATTENTION` naming the missing field. This is the owner's stated
preference for this class of fix, and it is the shape 4B measured before withdrawing it.
Consequence: a real onboarding cost — a person invited to a staff role must supply a date of birth
before the role takes effect, and someone must build the surface that asks for it. Existing holders
keep working, so no club is locked out.

**C — Make the resolver itself fail closed.**
Rule 1 fires on unestablished age, not merely on known-minor. Strongest guarantee and the smallest
amount of code. Consequence: it is retroactive. Production has one active club membership, one active
role assignment and one Full Site Admin; a club could lose its only Club Admin with no route back.
4B measured a version of this and the platform suite went from 3594/0 to 3508/18 across ~15 suites
spanning Slices 1, 2, 3 and 4a — every failure the same `23514` meeting a fixture with no date of
birth. That blast radius is the signal it needs its own slice, not a corner of another.

**D — Require Date of Birth at signup for everyone.**
Closes it at the source and is the simplest rule to explain. Consequence: it changes ID-5, a Phase 2
product decision, and adds friction to every account including parents and spectators who will never
hold a staff role. It also does nothing about accounts that already exist.

## 4. What I would recommend, and am not building

**B, with C's guarantee added later behind a backfill.**

Gate the writes now — including Slice 5's redemption path, as part of Slice 5 rather than after it —
so the new external route cannot become an escalation path on the day it ships. Leave
`capability_decision` alone so no existing holder is cut off. Surface unestablished age as
`NEEDS_ATTENTION` against the person and the club. Then, once a correction surface exists and a
backfill has actually asked existing staff for a date of birth, move the guarantee into the resolver
so it holds regardless of which write path was used.

Two constraints on whatever is chosen, both from the existing record and both binding:

- **Do not redefine `internal.person_is_minor`.** Slice 4A's locked decision **D-S4-4** reads that
  predicate for account-picture visibility, and redefining it would silently move a locked decision in
  another slice. A separate predicate answering *"is the age established at all"* is the right shape.
- **Rehearse against production-shaped data** and show exactly which existing accounts would change
  state, before any release.

`supabase/tests/roster_authority_matrix.sql` RA7 pins today's behaviour deliberately, so whichever
slice fixes this changes those assertions on purpose rather than by accident.

## 5. What is needed from you

A decision on A/B/C/D, and if it is B or C, a decision on the two open questions the follow-up
already lists: whether Date of Birth becomes mandatory at signup or is collected when a
minor-prohibited role is first offered, and how existing accounts are asked and what happens to their
authority while they have not answered.
