# Identity/Auth Slice 4G — Safeguarding and Dispensations

Moves the Safeguarding Officer appointment authority and its state machine to the canonical capability
decision, closes the Site Admin blanket read of club safeguarding threads, and makes AN-6 reachable for
the first time. Three migrations, expand → visibility and lifecycle → contract.

Contract: Phase 2 design **J.12 lines 541-553**, section **T** "Appointment"/"Lifecycle"/"Site Admin
access"/"Dispensations", decisions **AN-6** and **AN-9**, audit items **AI #68** and **#69**, under
**AA.3 row 4g** and the programme's locked decision **D-S4-2**.

---

## 1. What was wrong

`internal.grant_role` wrote `confirmation_state = 'CONFIRMED'` the moment a SAFEGUARDING_OFFICER
assignment was created. `public.accept_safeguarding_officer_invitation` called it, with a comment
saying so in as many words: *"The club's nomination and the officer's own email-bound acceptance are
the confirmation."*

So a club could appoint its own Safeguarding Officer from start to finish, with no Ovalball
involvement at any point, and the safeguarding thread that officer then handled was readable by every
site-admin profile in the platform — `read_only` and `content` included — through a bare
`internal.is_site_admin()` at the top of the thread gate.

AN-6 says the appointment needs a second pair of eyes from outside the club. Section T says Ovalball
has no RLS read of a club's safeguarding threads at all, and reaches one only through a reasoned RPC
that leaves a mark the club can see. Neither was true.

---

## 2. The state machine, and the one way in

```
nomination → ACTIVE / PENDING_CONFIRMATION   zero authority
AN-6       → ACTIVE / CONFIRMED              the role becomes real
deactivate → REVOKED                         authority ends, threads transfer
```

PENDING_CONFIRMATION conferring nothing did not need building. Slice 3's `internal.bundle_source`
already refuses a Safeguarding Officer assignment at club, team and self scope unless it is CONFIRMED.
What was missing was anything that ever put an assignment **into** that state.

`internal.enter_safeguarding_nomination` supplies it and is **the seam Slice 5 will call**. Every rule
that must survive email-bound redemption lives in the seam rather than in the RPC above it:

- ACTIVE membership **of this club**, read from the database, never taken from the caller's argument;
- PENDING, SUSPENDED, REVOKED, DECLINED and EXPIRED each refused, **by name**;
- the account active and not a minor, through `internal.grant_role`, which is delegated to rather than
  reimplemented — a second implementation would be a second state machine wearing another name;
- idempotent for a pending nomination, refused for a confirmed one.

No browser role can execute it. Slice 5 therefore needs no second state machine, and cannot build one
that skips a rule: there is nowhere else to enter.

---

## 3. D-S4-2, honoured exactly

No invitation table was created, no token, no code, no redemption RPC. The pre-existing
`club_safeguarding_officer_invitations` machinery predates Slice 4 and belongs to Slice 5's unified
redemption; it is left in place and **not extended**, with two changes and no more — its administration
gates became canonical, and acceptance now enters the state machine instead of granting the role.

4G's own nomination names an existing ACTIVE member of the club. Anybody else — including an active
member of a *different* club, which from this club's point of view is the same thing — comes back
`INVITATION_REQUIRED`, naming Slice 5 as the path. It is returned as an outcome rather than raised,
because "this person needs inviting" is an answer to the question, not a failure of it. The invalid
membership **states** are raised, because nominating a suspended member is a mistake and should read
like one. Neither creates anything.

---

## 4. Six more things the gates found

**The shadow comparison found a live defect.** A member could open a safeguarding thread and then was
refused permission to reply in it: `can_send_safeguarding_conversation` asked
`club.safeguarding.message`, a transitional key only a Club Admin held. J.12 line 545 gives
`safeguarding.conversation.start` to members, volunteers, coaches, managers, the secretary, the admin,
players of 13 and over and guardians — which is who should be able to speak in their own thread.

**The matrix found a capability nothing implemented.** `safeguarding.dispensation.view` has been in the
SO bundle since Slice 3 and no code read it, so an officer could not see the dispensations J.12 line
547 gives them. The dispensation policy now asks it.

**Section T found separation of duties missing entirely.** The person who requested a dispensation
could approve it. Enforced now, before any stage-specific check so it cannot be reached around.

**The matrix found an audit line that recorded nothing.** A security event emitted immediately before a
`raise` is rolled back with the statement that raised it, and Postgres has no autonomous transaction.
The line was removed rather than left reading like an audit trail, and the suite now asserts that
refusals are *not* claimed to be audited and that the refusal changed no state.

**The compatibility proof found the app still asking all three retired keys**, which would have made the
club-settings safeguarding tab vanish. Repointed to the canonical keys — and to
`safeguarding.officer.nominate` rather than `safeguarding.contact.view`, because the latter now reaches
most of a club including parents and would have put a club administration tab in front of them.

**The battery's role-literal guard found the Site Admin page filtering `role_assignments` by role-key
strings.** The confirmation queue became a capability-gated RPC, so the only authority question the
page asks is the one the database answers.

---

## 5. Performance

| read | pre-4G | 4G |
|---|---|---|
| 200 dispensations as the **Club Admin** | ~35 ms | **~30 ms** |
| 200 dispensations as the **Safeguarding Officer** | ~118 ms, **0 rows** | **~1 ms**, 200 rows |
| one 300-message safeguarding thread | — | 45 ms |

The officer's read was 110 ms until the safeguarding term was hoisted into an uncorrelated subquery and
moved to the front of the policy. `EXPLAIN (ANALYZE)` showed the time going to `can_manage_team` and
`can_manage_club_fixtures` — 4B's and 4C's helpers — running once per row and answering no, before the
term that says yes was reached. Postgres cannot inline a SECURITY DEFINER function, so the only way an
officer stops paying for three fixture-authority questions per row is to answer the safeguarding one
first. SA-P asserts the hoisted set selects exactly the rows the per-row question would.

---

## 6. Mutation testing

Twelve mutants, **twelve killed, no survivors**, over two rounds. The first round is the informative one:

- **M2** showed "no self-confirmation" had never actually been tested. Every persona tried was refused by
  the *capability* check first, so the self-confirmation rule was never the deciding one. It took a Full
  Site Admin who is also a member of the club and is the nominee — the one person for whom the two rules
  come apart.
- **M4** and **M5** showed the RPC shadowing the seam. Both deleted the seam's membership checks and both
  survived, because `nominate_club_safeguarding_officer` checks first. Slice 5 does not inherit the RPC.
- **M4** survived a second time even through the seam, because `grant_role` beneath it also refuses a
  non-active membership. The assertion now requires the refusal to **name the state**, which is the seam's
  own contribution and what a redeeming person will be shown.

---

## 7. Evidence

| gate | result |
|---|---|
| `safeguarding_authority_matrix.sql` | 115 assertions, SA-A … SA-P, deterministic and self-seeding |
| `safeguarding_officer_security.sql` | extended to 36, per AA.3 row 4g |
| `safeguarding_authority_races.test.mts` | 4 passed, three times, real concurrent sessions |
| browser suite 57 | 27/27 |
| shared harness, suite 51 | extended with N12a-e; 30/30 |
| full banking battery | **4187 passed, 0 failed across 205 suites** |
| clean empty-database rebuild | 465 migrations from empty; 16 suites, 902 assertions; perimeter 11/11 |
| production-shaped rehearsal | 462 → 465 one at a time, each dry-run first; the existing officer untouched; only data delta `audit` +8 |
| compatibility matrix | 7/7 |

PG-15 **128 → 124**. PG-16 **124 → 121**.

---

## 8. The unknown-age gate (programme §9)

**4G does not make safeguarding authority newly reachable through an identity whose age cannot be
established, and it narrows the route that already exists.**

`internal.person_is_minor` returns false when it has no date of birth, so an unknown-age identity passes
the minor prohibition on SAFEGUARDING_OFFICER. That is true **today**, through
`accept_safeguarding_officer_invitation` → `grant_role`, and it is the programme's carried follow-up.
4G leaves that helper untouched and invents no age policy. What changes is that such a person can no
longer become an active officer without a named human at Ovalball confirming them, where the club's own
acceptance used to be enough. SA-M1-M4 pin both halves so a later change cannot remove the narrowing
quietly.

---

## 9. Stated limits

- **`internal.is_club_admin` stays in the dispensation club and governing-body stages.** Section T says
  "the club stage needs CA", which is what that helper says; AA.3 row 4h owns retiring it.
- **The pre-existing safeguarding invitation machinery is untouched.** Unified redemption is Slice 5's.
- **The previous build loses the club-settings safeguarding tab for the length of the deploy**, because it
  asks three keys the migration retires. Measured, fail-closed, self-healing, no data effect.
- **Carried programme debt is unchanged**: the unknown-age follow-up, the 4C `local_uat_parent_player`
  seed defect, the `training_centre_visibility` seedless-boot limitation, the Playwright prefix-cleanup
  concurrency hazard, the deliberately carried pitch-view boundary, `may_send_as`'s platform branch
  (Slice 7) and the club-level branches of the audience helpers (4H).

---

## 10. What is deferred

**SLICE 5 DEFERRED:** the email-bound SAFEGUARDING_OFFICER invitation and redemption entry path. It must
call `internal.enter_safeguarding_nomination` — the same seam, the same PENDING_CONFIRMATION state, the
same AN-6 confirmation — and cannot bypass minor prohibitions, account or membership state, scope binding
or capability rules. External nominees stay fail-closed until then.
