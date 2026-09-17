# Slice 5 — progress record

**Status: RELEASED AND PRODUCTION VERIFIED.** Production is at **494 migrations**, tip
`20270403000000`, commit `67969eb`.

`SLICE_5_PRODUCTION_RELEASE_REPORT.md` is the release record and the verdict.
`SLICE_5_IMPLEMENTATION_REPORT.md` is the full picture and the ten defects this slice found. This file
remains the running record of how it got there.

This file is the resume point. Everything below was verified, not assumed.

## Banked and verified

| | Commit |
|---|---|
| **D-S5-1 age eligibility** — predicate, write-boundary gates, grandfathering, 32-assertion matrix | `819830a` |
| **Canonical invitation core** — schema, Vault-peppered secrets, issue/preview/redeem/revoke/resend/expiry | `e2ede9f` |
| **Redemption chokepoint** — one caller, fail-closed, verifier proven to fail on violation | `20892f7` |
| **Legacy plaintext token retirement** — terminal rows cleared, live pending honoured | `242c95d` |
| **Invitation races R1–R6** — real concurrent sessions | `53baee5` |
| **Legacy read surface corrected + reader allow-list** | `d7b93e4` |
| **Club claim state machine** — six states, conversation, authority split, title grants nothing | `41a85f8` |
| **Claim race R12** — competing approvals | `c7ef5f8` |

**Evidence at this checkpoint**
- Platform battery **4555 passed, 0 failed across 214 suites**; `tsc` clean.
- `invitation_authority_matrix` **62 assertions**; `age_eligibility_matrix` **32**;
  `club_claim_authority_matrix` **42**.
- Mutation: **15 mutants, 0 survivors**, restore verified either side.
- Races: **R1–R6 and R12**, 7/7, self-cleaning and repeatable.
- Clean boot: **485 migrations from empty**, 23 suites, **1294 assertions**, 0 failures.
- Production-shaped rehearsal at ledger 474 with production's row shape: seven `site_admin_invitations`
  in, six revoked tokens cleared, the pending one retained, no row deleted, no authority changed.
- Production's D-S5-1 **NEEDS_ATTENTION population is zero** — the one minor-prohibited holder has an
  established age; the three profiles with no date of birth hold no such role.

Autonomous decisions D-S5-AUTO-1 … 6 are in `IDENTITY_AUTH_DECISION_RECORD.md`.

## Not done — the remainder of Slice 5

1. **Application layer.** `/join` (link and code) unifying `/invite`, `/invited`, `/guardian-invite`
   and `/player-invite`; invitation emails; People & Access Invite; Team Join Codes UI; Claim a Club;
   Site Admin claims review; onboarding for invitees without accounts; public entry points; removal of
   `ovalballSignupPayload`. Not started.
   **This is also what completes the legacy token retirement** — moving these three actions onto
   `public.issue_invitation` is what stops new plaintext being written and lets the read surface close
   (D-S5-AUTO-6).
2. **Race R18.** Needs an email-change handler, which this slice has not built.
3. **Still owed.** Browser UAT 43 and 44; accessibility; performance measurement of the invitation and
   claim paths; release-order proof for the application changes; release and production verification.

## Resume here

Start at the **application layer**. The order that matters:

1. **Migrate the three legacy issuers** — `app/(app)/people/actions.ts`,
   `app/(app)/admin/site-admins/actions.ts`, `app/(app)/parent/children/actions.ts` — onto
   `public.issue_invitation`. This is what stops new plaintext being written, shrinks the
   `verify-legacy-invitation-token-readers` allow-list toward zero, and lets the read surface close
   (D-S5-AUTO-6). It is the substance of Slice 5 closure items 2 and 3.
2. **`/join`**, consuming `preview_invitation` and `redeemInvitation` from the chokepoint, so
   canonical invitations are actually redeemable by a person.
3. The remaining journeys, then UAT, accessibility, performance, a fresh clean boot and rehearsal.

**One design question is already visible and unresolved.** Legacy `invitations` supports MULTIPLE team
assignments through `invitation_teams`; canonical `access_invitations` has a single `team_id`. O.1
describes CLUB_STAFF scope as "CL (+ TE list)", so the team list belongs in `intended_outcome`, and
`redeem_invitation` needs to grant per team. Decide that before migrating the club-staff issuer, or the
migration will quietly drop multi-team invitations.

## Two things the next run should know

**The redemption caller contract is security-critical.** `redeem_invitation` refuses by RETURNING, not
raising (D-S5-AUTO-2), because raising rolled back the attempt record and defeated the rate limits.
Anything that calls it must import `redeemInvitation` from `lib/invitations/redeem.ts`;
`scripts/verify-redemption-callers.mjs` fails the build otherwise.

**The local migration ledger is stale.** Slice 4G onwards were applied to the local database by piping
files into `psql`, so `supabase_migrations.schema_migrations` reads 462 while the schema is current.
The disposable clean-boot and rehearsal stacks use the ledger properly and are the reliable evidence;
do not read the local ledger as production state.
