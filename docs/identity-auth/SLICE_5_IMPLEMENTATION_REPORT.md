# Identity/Auth Slice 5 — Unified Invitations, Codes and Claims

**Implementation report. Ready for production release.**

Phase 2 AA.3 assigns Slice 5 the unified invitation model (§O), the club claim model (§P), team join
codes, and — by **D-S5-1**, decided at the Slice 4 closure boundary — the unknown-age eligibility gate.

## What Ovalball had before

Six invitation tables, each storing its token **in plaintext**: `invitations`,
`guardian_invitations`, `player_account_invitations`, `site_admin_invitations`,
`club_safeguarding_officer_invitations`, `club_ovalball_invitations`. Four server actions issued into
them and read the secret straight back to build an emailed link. A club claim had two states and no way
for a reviewer to ask a question. An identity whose age had never been recorded was treated as an
adult by every minor-prohibited authority boundary.

## What it has now

**One credential.** `public.access_invitations` holds all eight kinds from O.1. It has no plaintext
column at all — a SHA-256 of the link token and an HMAC of the human code, peppered from Supabase
Vault, which is why `public.issue_invitation` returning the secret **once** is the only moment either
value exists. `invitations_admin_view` is the administrator's read surface and can select neither hash.

**One way in.** `/join` accepts every kind, over `lib/invitations/redeem.ts`, which is the only module
permitted to name the RPC — `scripts/verify-redemption-callers.mjs` fails the build if a second
appears. Redemption **refuses by returning**, because the attempt it just recorded is what the rate
limits read and a raise would roll it back (D-S5-AUTO-2). A refusal is one generic sentence whatever
the cause, so a probe learns nothing from the difference; the two reasons a person can act on —
`AGE_ELIGIBILITY_REQUIRED` and `MEMBERSHIP_REQUIRED` — are the deliberate exceptions.

**One place a staff invitation's teams live.** O.1 gives `CLUB_STAFF` the scope `CL (+ TE list)`, and
`intended_outcome.teams` carries it as `[{"id": …, "roles": […]}]` — per entry, because the People &
Access form already lets a Club Admin invite somebody as Coach of one team and Team Manager of
another, and a flat list could only carry that by giving every role to every team. `team_id` stays
NULL for that kind under a constraint, so there is no second answer (**D-S5-AUTO-8**).

**A claimed title grants nothing.** The claim state machine has six states, a conversation, and an
approval whose roles are the **reviewer's** decision — the title only suggests a default
(**D-S5-AUTO-7**).

**Unknown age is not adulthood.** `internal.person_is_established_adult` gates `internal.grant_role`,
`set_capability_override` and invitation redemption, including becoming a Site Admin. It does not touch
`internal.capability_decision`, so no existing holder loses anything (**D-S5-1**); and because a gate
with no way through it is a wall, `public.record_own_date_of_birth` lets a person supply a date of
birth once and refuses to change one already on file (**D-S5-AUTO-10**).

## Defects this slice found and closed

Every one was found by building the thing, not by reading the design.

| | |
|---|---|
| **Refusals rolled back their own attempt record** | Rate limits could never fire and two probe events were never written (D-S5-AUTO-2) |
| **A null team id slipped past the existence check** | `select … into` over no rows leaves the variable null, which reads as "nothing wrong" — it would have been stored as an authorised team |
| **The membership was written before the team list was validated** | A staff invitation naming a retired team left the person a member of a club they had not joined, from a redemption reporting `REFUSED` |
| **A child-scoped invitation could not be issued** | The derived club and team were passed into the authority check, which is `SCOPE_MALFORMED` for child scope. No guardian could send a player-account invitation |
| **…and could not be redeemed** | The issuer re-check tested club and team scope and nowhere else, so it always returned `issuer_authority_lost` |
| **`PLAYER_ACCOUNT` reported `ACCEPTED` and did nothing** | The player was never linked. A success that changes nothing is worse than a refusal |
| **Becoming a Site Admin had no age gate** | `site_admins` is not in `role_definitions`, so the widest authority on the platform was the one unknown age could still cross |
| **A fourth legacy issuer, unseen by its own guard** | The Safeguarding Officer issuer returned its plaintext token through an RPC rather than a table select, so the allow-list read as empty while it was still minting them |
| **An external Safeguarding Officer nominee could not accept** | Redemption entered the nomination seam and admitted nobody, so it refused everyone not already a member — which is every external nominee, the exact case the invitation exists for |
| **The seed chain had not worked on a fresh database** | Six separate drifts between the seeds and the schema; the development machine never noticed because it was seeded before the rules existed |

## Evidence

| | |
|---|---|
| Platform battery (development) | **4,614 passed, 0 failed across 215 suites** |
| Clean boot from empty | **494 migrations**, then **4,545 passed, 0 failed** |
| Production-shaped rehearsal | booted at production's own ledger **474 / `20270381000000`**, staged to **494 / `20270403000000`**, **4,545 passed, 0 failed** |
| Mutation campaign | **20 mutants, 0 survivors**, restore verified clean either side and guarded against a mutant leaving an overload behind |
| Races | **R1–R6, R12, R18** — real concurrent sessions, self-cleaning, repeatable |
| Browser acceptance | **16/16**, desktop and 320px, run twice from the same database leaving nothing behind |
| Accessibility | one `h1`, every control on `/join` has an accessible name |
| Performance | issue **1.09 ms**, redeem **7.59 ms** end to end, 2,000 invitations read through RLS in **10.1 ms**, preview **0.7 ms** |
| Perimeter | manifest updated for the new RPCs and the narrowed legacy grants, not loosened around them |

## The release order, and why it is not one step

Two of the twenty migrations are **contract** steps: they remove something the currently deployed build
still uses. Measured on the rehearsal, not assumed.

1. **Stage 1 — `20270382000000` … `20270401000000`.** All expand. After them the deployed build can
   still read every legacy token it reads today, the legacy accept RPCs are all still present, and the
   Safeguarding Officer issuer still returns a legacy token. Verified in the rehearsal.
2. **Stage 2 — deploy the application.**
3. **Stage 3 — `20270402000000` and `20270403000000`.** The revoke of the legacy token read
   (`has_column_privilege('authenticated','public.invitations','token','SELECT')` goes true → false),
   and the swap of the Safeguarding Officer issuer to the canonical one.

Running stage 3 early takes the link out of every invitation email until the new build is live. Both
files are numbered after the rest of the slice so the file order *is* the release order, and each says
so in its own header.

## What Slice 5 deliberately does not do

- It does not delete a legacy invitation table or a legacy accept RPC. Phase 2 O.5 honours a legacy
  invitation until it expires, and the adapter surface reaches zero at **Slice 10**.
- It does not retire `is_site_admin()` — AA.3 assigns that to **Slice 7**.
- It does not build a guardian-invitation issuer. That journey runs on guardian *link requests*, and
  no issuing surface existed before this slice either.
- It does not make Date of Birth mandatory at signup (ID-5 stands), and it revokes nobody.
