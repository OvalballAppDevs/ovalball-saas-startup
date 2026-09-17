# Slice 5 — progress record

**Status: IN PROGRESS. Not released. Production is unchanged at ledger 474, tip `20270381000000`.**

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

**Evidence at this checkpoint**
- Platform battery **4512 passed, 0 failed across 212 suites**; `tsc` clean.
- `invitation_authority_matrix` **62 assertions**; `age_eligibility_matrix` **32**.
- Mutation: **15 mutants, 0 survivors**, restore verified either side.
- Races: **6/6**, self-cleaning and repeatable.
- Clean boot: **485 migrations from empty**, 23 suites, **1294 assertions**, 0 failures.
- Production-shaped rehearsal at ledger 474 with production's row shape: seven `site_admin_invitations`
  in, six revoked tokens cleared, the pending one retained, no row deleted, no authority changed.
- Production's D-S5-1 **NEEDS_ATTENTION population is zero** — the one minor-prohibited holder has an
  established age; the three profiles with no date of birth hold no such role.

Autonomous decisions D-S5-AUTO-1 … 6 are in `IDENTITY_AUTH_DECISION_RECORD.md`.

## Not done — the remainder of Slice 5

1. **Club claims (P, Y.13).** `club_claims` state machine, `club_claim_messages`,
   `submit_club_claim`, `reply_to_claim`, `decide_club_claim`, the state backfill. Not started.
2. **Application layer.** `/join` (link and code) unifying `/invite`, `/invited`, `/guardian-invite`
   and `/player-invite`; invitation emails; People & Access Invite; Team Join Codes UI; Claim a Club;
   Site Admin claims review; onboarding for invitees without accounts; public entry points; removal of
   `ovalballSignupPayload`. Not started.
   **This is also what completes the legacy token retirement** — moving these three actions onto
   `public.issue_invitation` is what stops new plaintext being written and lets the read surface close
   (D-S5-AUTO-6).
3. **Races R12 and R18.** Both need subsystems not yet built: competing club claims needs the claims
   machine, and the email-change race needs an email-change handler.
4. **Still owed.** Browser UAT 43 and 44; accessibility; performance measurement of the invitation and
   claim paths; release-order proof for the application changes; release and production verification.

## Resume here

Start at **club claims**, then the application layer, then the remaining evidence. Nothing banked
depends on the order of the remainder.

## Two things the next run should know

**The redemption caller contract is security-critical.** `redeem_invitation` refuses by RETURNING, not
raising (D-S5-AUTO-2), because raising rolled back the attempt record and defeated the rate limits.
Anything that calls it must import `redeemInvitation` from `lib/invitations/redeem.ts`;
`scripts/verify-redemption-callers.mjs` fails the build otherwise.

**The local migration ledger is stale.** Slice 4G onwards were applied to the local database by piping
files into `psql`, so `supabase_migrations.schema_migrations` reads 462 while the schema is current.
The disposable clean-boot and rehearsal stacks use the ledger properly and are the reliable evidence;
do not read the local ledger as production state.
