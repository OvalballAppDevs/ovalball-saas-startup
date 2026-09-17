# Identity/Auth Slice 5 — Production Release Report

**Verdict: IDENTITY/AUTH SLICE 5 — PRODUCTION VERIFIED**

Released 17 September 2026. Commit `67969eb`. Production at **494 migrations**, tip
`20270403000000`.

## Why this release was staged

The production-shaped rehearsal — a disposable stack booted at production's own ledger (474, tip
`20270381000000`) — showed that two of the twenty migrations are **contract** steps rather than expand
steps. They remove something the *then-deployed* build still used:

- `20270402000000` revokes the legacy plaintext token read.
  `has_column_privilege('authenticated','public.invitations','token','SELECT')` goes **true → false**.
  The old build read that column to put the link in every club-staff, Site Admin and player-account
  invitation email.
- `20270403000000` swaps the Safeguarding Officer issuer to the canonical one, which hands the old
  build a canonical token it would have put into `/invite/safeguarding-officer/<token>` — a URL that
  only knows how to look the old kind up.

Both were renumbered after the rest of the slice so the **file order is the release order**, and each
says so in its own header.

## What was done, in order

| Stage | Action | Result |
|---|---|---|
| Pre | Reverified HEAD, worktree, protected logos, commits, production ledger/tip, pending set | Production exactly at rehearsed baseline **474 / `20270381000000`**; 12 commits to push, all Slice 5; no migration below the Slice 5 floor |
| 1 | Held back the two contract files; `supabase db push --linked` | Applied **exactly 18** expand migrations. Ledger **492**, tip `20270401000000`. No seeds, no roles |
| 1 | Verified the **then-deployed** build still worked | Legacy token read still available on all five tables; legacy accept RPCs present; Safeguarding Officer issuer still legacy |
| 2 | `git push origin main`, fast-forward `94039d7..67969eb` | Vercel deployed |
| 2 | Confirmed the build is **serving**, not inferred from the push | `/join` — a route that did not exist before this release — went **404 → 200** on the live site |
| 3 | Restored the two contract files; `supabase db push --linked` | Applied **exactly 2** contract migrations. Ledger **494**, tip `20270403000000` |
| Post | Read-only production verification | Every check below |

## Production verification

**Migrations** — ledger **494**; tip `20270403000000`; all **20** Slice 5 migrations recorded; no
unexpected migration applied.

**Production integrity** — 4 identities, 4 profiles, 1 active club membership, 1 active role
assignment, 1 active Site Admin: unchanged. No revoked authority resurrected. No unintended grant.

**D-S5-1** — `NEEDS_ATTENTION` population is **zero**: nobody was retroactively stripped. Three
profiles carry no date of birth and hold no minor-prohibited role. The gate is on
`internal.grant_role`; `internal.capability_decision` is **not** gated, exactly as the decision
requires. `public.record_own_date_of_birth` is live, so the gate is a prompt rather than a wall.

**Canonical invitation architecture** — `access_invitations` has **no plaintext column at all**; it
stores a SHA-256 and an HMAC. The administrator's view can select neither. No browser role may INSERT,
UPDATE or DELETE; RLS is on; `anon` cannot read it. Neither browser role can reach the code pepper.
Redemption still refuses by **returning** — only the three genuinely exceptional raises remain.

**Plaintext token retirement (Phase 2 O.5)** — the seven `site_admin_invitations` rows are all still
there; **no row was deleted**. The six terminal/revoked plaintext credentials are cleared, and **the
one legitimate pending invitation is intact and was not prematurely destroyed**. No browser role can
read a token on any of the five legacy tables, while their rows stay readable. A sweep of every
function in `public` and `internal` confirms none hands a plaintext legacy token back to a caller —
which is how the fourth issuer was found in the first place. *(No plaintext token was retrieved or
printed during verification; counts and state only.)*

**Multi-team `CLUB_STAFF`** — the constraint keeps `team_id` NULL for that kind, so there is no
competing scalar source of truth; redemption reads the authorised list from
`intended_outcome.teams`; team-scoped versus club-scoped comes from `role_definitions` rather than a
list written inside redemption; and `redeem_invitation(p_token, p_code)` has **no team, club, role or
scope argument at all**. No existing staff invitation lost its teams.

**Claims** — six canonical states present; the conversation table exists; the decision uses
`site.claims.review` and contains **no blanket `is_site_admin()`**; a claimed title only *suggests*
roles. The one production claim row is preserved.

**Safeguarding external entry** — redemption feeds 4G's `internal.enter_safeguarding_nomination`
seam, and there is exactly **one** such seam. The nominee is now admitted behind the club-people lock,
which is what makes an external nominee able to accept at all. **AN-6 is intact**: `internal.grant_role`
writes `PENDING_CONFIRMATION` for an officer and refuses to *assign* one at all outside a
`SAFEGUARDING_APPOINTMENT`, and `internal.bundle_source` refuses the bundle until confirmed. Age
eligibility and AN-6 are both present in redemption and neither substitutes for the other.

> One verification assertion initially read **false**: it looked for `PENDING_CONFIRMATION` inside the
> nomination seam. That was the assertion being wrong, not the invariant. The seam deliberately
> delegates — *"reimplementing any of that here would be a second state machine by another name"* — and
> the forcing lives in `internal.grant_role`, where it is annotated **AN-6**. Re-asserted where it is
> actually enforced, and confirmed.

**Perimeter** — `anon` cannot read `access_invitations` or the admin view, and cannot issue, redeem or
record a date of birth. `anon` *can* call `preview_invitation`, which is by design: a link has to
preview without an account. No new anon-readable invitation surface exists.

**Audit and secrecy** — seven `invitation.*` event types registered plus
`identity.date_of_birth_recorded`. A sweep of `security_events` finds **no secret-shaped metadata key
ever written**. Refusal attempts persist without rollback. `audit_log` remains immutable to browser
roles.

**Live application** — `/`, `/login`, `/join`, `/invited`, `/clubs`, `/public-fixtures` all 200 on
both the apex and `www` after the contract stage. The three legacy invite routes 307 to
`/join?t=<token>`, so a canonical token pasted into an old URL is answered rather than called invalid.
A bogus token gives the single generic refusal with **no email address disclosed**.

## Pre-release evidence

| | |
|---|---|
| Platform battery (development) | **4,614 passed, 0 failed across 215 suites** |
| Clean boot from empty | **494 migrations**, then **4,545 passed, 0 failed** |
| Production-shaped rehearsal | booted at **474 / `20270381000000`**, staged to **494 / `20270403000000`**, **4,545 passed, 0 failed** |
| Mutation campaign | **20 mutants, 0 survivors**, restore verified clean either side |
| Races | **R1–R6, R12, R18** — real concurrent sessions, self-cleaning, repeatable |
| Browser UAT | **16/16**, desktop and 320px, run twice leaving nothing behind |
| Accessibility | one `h1` on `/join`; every control has an accessible name |
| Performance | issue **1.09 ms**, redeem **7.59 ms** end to end, 2,000 invitations through RLS in **10.1 ms**, preview **0.7 ms** |

## NOT OBSERVABLE IN PRODUCTION

These are deliberately unexercised against production, because proving them there would mean
manufacturing identities or spending a real credential. Each is covered by the evidence named.

| Flow | Why not | Covered by |
|---|---|---|
| Issuing and redeeming a real invitation end to end | Would require manufacturing production personas | Browser UAT 16/16; `invitation_authority_matrix` (70); `invitation_team_list` (39) |
| The one pending legacy Site Admin invitation | Redeeming it would consume a legitimate credential | State verified only: still pending, token intact, no row deleted |
| The D-S5-1 refusal-then-answer journey | Needs an identity with no recorded date of birth | Browser UAT E1–E2; `age_eligibility_matrix` (44) |
| A team join code being typed | Needs a second real person | Browser UAT G1–G3; races R5, R6 |
| Concurrent redemption | Needs two simultaneous production sessions | Races R1–R6, R12, **R18** |
| Claim review conversation | Needs a real claimant and reviewer | `club_claim_authority_matrix` (42); race R12 |

## Intentional deferrals to Slice 6 and later

- The six legacy invitation tables and their accept RPCs remain. Phase 2 **O.5** honours a legacy
  invitation until it expires; the adapter surface reaches zero at **Slice 10**.
- `is_site_admin()` retirement is **Slice 7** (AA.3).
- Passwords, TOTP and the magic-link retirement are **Slice 6**. Redemption already calls
  `internal.session_ok()`, so it inherits the AAL2 requirement without being changed again.
- No guardian-invitation issuer was built: that journey runs on guardian *link requests*, and no
  issuing surface existed before this slice either.
- Date of Birth is still optional at signup (**ID-5** stands) and nobody was revoked.
