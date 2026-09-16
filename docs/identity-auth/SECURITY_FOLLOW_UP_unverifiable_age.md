# CROSS-SLICE SECURITY FOLLOW-UP — OWNER ASSIGNED: SLICE 5

> **DECIDED.** The product owner approved **Option B** at the Slice 4 closure boundary. It is
> recorded as **D-S5-1** in `IDENTITY_AUTH_DECISION_RECORD.md`, and the options it was chosen from
> are in `DECISION_REQUIRED_unknown_age_before_slice_5.md`.
>
> In short: gate the sensitive write and transition paths so an identity whose age is unknown or
> unverified cannot cross a minor-prohibited or safeguarding-sensitive authority boundary. Do not
> redefine `internal.person_is_minor`, do not make Date of Birth mandatory at signup, do not
> retroactively revoke anyone, and surface existing affected identities as `NEEDS_ATTENTION`.
> Invitation redemption is explicitly in scope. **Slice 5 is not started.**
>
> Everything below is the original technical record, unchanged. It is what the decision was made
> from, and the constraints it lists — especially the D-S4-4 warning and the rehearsal requirement —
> are carried into D-S5-1 verbatim.

---

**Unverifiable age does not trigger the minor prohibition.**

Raised during Identity/Auth Slice 4B (teams and roster). Slice 4B neither introduced
this nor fixed it. Phase 2 assigned no slice to it, which is why it was carried without an
arbitrary owner through 4C–4I; **Slice 5 is now its assigned owner by decision D-S5-1.**

## Exact current semantics

`internal.person_is_minor(p_user_id)` answers "is this person **known** to be under 18". It
reads a date of birth from `public.profiles`, falling back to the newest
`public.players.date_of_birth` the person owns, and wraps the comparison in
`coalesce(..., false)`. An account with no recorded date of birth anywhere therefore
answers exactly as an adult does:

```
person_is_minor(unrecorded age) = false     -- identical to a 40-year-old
person_is_minor(recorded 12yo)  = true
person_is_minor(recorded 40yo)  = false
```

`internal.capability_decision` reads that predicate for its rule-1 hard prohibition:

```sql
if c.minor_prohibited and internal.person_is_minor(p_subject) then
  decisive_rule := '1'; reason_code := 'MINOR_PROHIBITED'; return;
end if;
```

Measured on a database at ledger 448, **before** any Slice 4B migration, with
`TEAM_MANAGER` granted at a team and `team.roster.manage` requested:

```
UNRECORDED AGE as TEAM_MANAGER -> allowed=t  rule=6  ROLE_BUNDLE      <-- prohibition bypassed
RECORDED 12yo  as TEAM_MANAGER -> allowed=f  rule=1  MINOR_PROHIBITED
```

The prohibition does not fire. The unrecorded-age account is denied only when it holds no
role at all, and then merely by rule 8 `DEFAULT_DENY`.

## Affected role and bundle categories

Every role marked `minor_prohibited` in `public.role_definitions`:
**CLUB_ADMIN, SAFEGUARDING_OFFICER, FIXTURES_SECRETARY, VOLUNTEER, COACH, TEAM_MANAGER,
TEAM_ADMINISTRATION** — and every `minor_prohibited` capability their bundles carry,
including the safeguarding-sensitive team keys (`team.roster.view`, `team.roster.manage`,
`team.join_request.review`, `team.join_code.manage`, `team.team.manage`).

The same predicate is also read by `internal.grant_role`,
`public.transition_role_assignment`, `public.set_capability_override`,
`internal.apply_planned_team` and `internal.can_view_account_avatar`.

## Why this is reachable in ordinary use

Phase 2 **ID-5** makes Date of Birth optional unless the person is a Player, and the signup
form (Phase 2 line 1952) records it as "optional; required if Player is chosen". A
non-player account therefore carries no date of birth **by default**, which is the ordinary
case and not an edge case. On the development database 26 of 30 profiles were in exactly
that state.

## Why fail-closed enforcement is desirable

A club cannot demonstrate that the adult holding a safeguarding-sensitive role over
children is an adult. "We could not establish an age" currently reads the same as "this is
an adult", which is the wrong default for a children's sport platform. Unknown age must
never become an authority-escalation route.

## Why changing grant_role now is cross-domain, not a 4B change

`internal.grant_role` is the Slice 2 canonical write path for **every** role in every
domain. A fail-closed gate placed there was built and measured during Slice 4B before being
withdrawn:

> Platform suite went from **3594 passed / 0 failed** to **3508 passed / 18 failed**, across
> roughly **15 suites** spanning Slices 1, 2, 3 and 4a — every failure the same errcode
> `23514` meeting a fixture that creates a person with no date of birth.

Affected suites included `platform_activation`, `safeguarding_officer_foundation`,
`safeguarding_officer_security`, `safeguarding_officer_dispensation_notifications`,
`handover_successor_teams`, `identity_security_containment`, `membership_state_machine`,
`role_assignment_state_machine`, `role_assignment_ceilings`, `backfill_verification`,
`capability_catalogue_integrity`, `bundle_legacy_parity`, `capability_override_ceilings`,
`membership_races` and `perimeter_manifest`.

A blast radius that uniform, in suites belonging to other slices, is the signal that the fix
does not belong to the slice that noticed it.

## Migration and backfill questions that must be solved first

1. **Existing holders.** Production currently has 1 active club membership, 1 active role
   assignment and 1 Full Site Admin. If a strict rule is applied to the resolver, a club can
   lose its only Club Admin with no route back. The owner's stated preference for this class
   of fix is *prohibit new, flag existing*: gate the write paths, leave
   `internal.capability_decision` alone, and surface the remaining gap as
   `NEEDS_ATTENTION` naming the missing field.
2. **Collection.** Does Date of Birth become mandatory at signup, or is it collected only
   when a minor-prohibited role is first offered? ID-5 says it is set once by the person and
   corrected only by `site.users.identity.correct` or the guardian flow.
3. **Backfill.** How are existing accounts asked for a date of birth, by whom, and what
   happens to their authority while they have not answered.
4. **Correction path.** `site.users.identity.correct` already exists; the UI to record a
   date of birth against an existing adult account does not.

## Requirements on the eventual fix

- It must be **rehearsed against production-shaped data** before release, in the same way
  Slice 4A and 4B rehearsed theirs, and the rehearsal must show exactly which existing
  accounts would change state.
- It must prove that **unknown age cannot become an authority-escalation route** — that the
  unrecorded case resolves at rule 1 and not at rule 6.
- It must **not redefine `internal.person_is_minor`**. Slice 4A's locked decision **D-S4-4**
  reads that predicate for account-picture visibility; redefining it would silently move a
  locked decision in another slice. A separate predicate answering "is the age established
  at all" is the right shape.
- It must re-run the Slice 4A family authority, family isolation and avatar regressions,
  and the Slice 4B roster matrix, since all of them touch the same predicate.

## Flag

**This must be raised again before any later slice makes staff-role onboarding or
assignment easier** — in particular Slice 5 (unified invitations, codes and claims, which
introduces `TEAM_JOIN_CODE` and team join code issuance) and Slice 7 (Users & Access,
Create User). Each of those makes it easier to put a person into a minor-prohibited role,
and therefore widens this gap rather than narrowing it.

## Pinned in tests

`supabase/tests/roster_authority_matrix.sql` RA7 pins the current behaviour as it actually
is, using only objects that predate Slice 4B, so that whichever slice fixes this changes
those assertions deliberately rather than by accident.
