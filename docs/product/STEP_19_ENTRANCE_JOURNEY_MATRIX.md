# Ovalball entrance journeys — the product map

Every legitimate way into Ovalball, what a person sees, what the server does, and where they end up.
Written at Step 19 (UX-8). **One identity system**: these rows establish different *relationships*, never
different accounts.

`accept_invitation` and `get_invitation_preview` remain the **L7 compatibility bridge** and are untouched.

## Invitation entrances

All of them share one page (`/join`), one preview (`preview_invitation`), one acceptance
(`redeem_invitation` through `lib/invitations/redeem.ts`) and one landing rule
(`lib/invitations/entrance-landing.ts`). There is no second acceptance engine, and the human-code route
is the same product as the link.

| | ENTRY | UNAUTHENTICATED | AUTH CONTINUATION | SERVER ACTION | SUCCESS | LANDING | FAILURE | MOBILE |
|---|---|---|---|---|---|---|---|---|
| **Invitation link** | `/join?t=` | previews the club/team/organisation and who invited them; never whether the address has an account | `/login?next=/join?t=…`, validated by `safeNextPath`; MFA now carries the destination too | `redeem_invitation`, bound to the confirmed email | outcome-specific | from the relationship established — see below | invalid · closed · spent, each with a next action | 390 / 320 ✓ |
| **Human code** | `/join?c=` | same page, same preview | same, **and the code now travels** — it used to be dropped at sign-in | same | same | same | "That code doesn't work" | 390 / 320 ✓ |
| **Guardian invitation** | `/guardian-invite/[token]` | its own journey (child data) | own | canonical guardian link | relationship pending or active | family surface | own | inherited |
| **Site Admin invitation** | `/invite/site-admin/[token]` | platform authority, own journey | own | canonical | `SITE_ADMIN_ACTIVE` | `/admin` | own | inherited |
| **Player invitation** | `/player-invite/[token]` | token-scoped preview via `get_player_account_invitation_preview` — never the row's full RLS | own | canonical | player login active | player surface | own | inherited |
| **Safeguarding officer** | `/invite/safeguarding-officer/[token]` | token-scoped preview only | own | canonical 4G appointment | officer confirmed | club safeguarding | own | inherited |

### Where an accepted invitation lands, and why

Keyed by `SuccessfulRedemptionOutcome`, so a new outcome cannot be added without deciding this.

| outcome | lands | context adopted | says |
|---|---|---|---|
| `MEMBERSHIP_ACTIVE` | `/dashboard` | — | — |
| `PENDING_CONFIRMATION` | `/welcome` | — | "Your club still has to confirm your role before it starts." |
| `JOIN_REQUEST_PENDING` | `/welcome` | — | "Request sent. You will get in once somebody at the club approves it." |
| **`BODY_ROLE_ACTIVE`** | `/governing/<bodyId>` | **`governing:<bodyId>`** | — |
| `SITE_ADMIN_ACTIVE` | `/admin` | `site_admin` | — |
| `ACCOUNT_SETUP_CONFIRMED` | `/account` | — | — |
| `ACCEPTED` | `/dashboard` | — | — |
| `ALREADY_REDEEMED` | `/dashboard` | — | "You had already accepted that invitation." |

Two rules are doing the work. **A request never redirects into the application**, because a silent
redirect to a dashboard reads as "you are in" — UX-8 §16. And **a newly granted context is adopted, not
merely navigated to**, because the active context resolves from the `ovalball_ctx` cookie rather than
from the URL: arriving at a workspace without adopting it wraps the new page in the old navigation.

## Account and club entrances

| | ENTRY | UNAUTHENTICATED | AUTH CONTINUATION | SERVER ACTION | SUCCESS | LANDING | FAILURE | MOBILE |
|---|---|---|---|---|---|---|---|---|
| **Create an account** | `/signup` | **"Create your Ovalball account"** — no longer "Bring your club to Ovalball" | email confirm, then the wizard resumes from `auth_flow_states` | `create_auth_flow_state` (kind SIGNUP/CLAIM); answers are server-side, the cookie holds only an opaque flow id | account created | wizard continues | per-field | ✓ |
| **Join an activated club** | `/signup` → JOIN | club named; all fifteen roles, because its Club Admin decides who is what | as above | `club_join_requests` | request made | `/welcome`, truthfully pending | — | ✓ |
| **Club not on Ovalball** | `/signup` → **fork** | **asks what they are here for** instead of routing them into a claim | as above | none until chosen | — | claim, or the honest answer | — | ✓ |
| **Set a club up (claim)** | `/signup` → fork → **chosen** | seven claim-eligible roles, no free text; the authority sentence sits **beside the question** | as above | `club_claims` (pending) | claim submitted | `/welcome` | ineligible role explained | ✓ |
| **Club not listed** | `/signup` → NEW CLUB | directory request | as above | `directory_requests` | request made | `/welcome` | — | ✓ |
| **Ordinary sign in** | `/login` | — | `safeNextPath` | Supabase auth | session | `next`, or `/dashboard` | per-attempt | ✓ |
| **MFA continuation** | `/security/verify` | bounces to login **keeping the destination** | `safeNextPath` on the way in *and* out | TOTP challenge | AAL2 | the entrance they were completing | wrong code | ✓ |
| **Public Club Home → join** | `app/club/[slug]` | club's own identity | → `/signup` or `/join` | as above | — | as above | — | ✓ |
| **Password recovery** | `/forgot-password` | — | own | canonical | reset sent | `/login` | per-attempt | ✓ |
| **"My club invited me"** | `/invited` | a plain answer, and a pointer to the code box | — | none | — | `/join` | — | ✓ |

## The wrong account

An entrance link works when somebody is already signed in, and redemption is bound to the session's
**confirmed** email — so following a link made out to another address is refused rather than silently
attached to the wrong person. The refusal is deliberately generic: it does not say whether the invitation
was expired, withdrawn or simply meant for somebody else, because saying so would let a prober find out
which.

That is right, and it leaves one honest case looking like a dead end — a person signed in as one of their
own two addresses. So any refusal on a signed-in acceptance now also offers **Sign In As Somebody Else**,
which ends the session and returns to the same invitation. It reveals nothing about the invitation, and
it is the only legitimate next action there is.

## What the claim journey is careful about

The claimed job title is **evidence, not authority**, and this was already true underneath the old UI
(Slice 5): `club_claims_claimed_role_eligible` permits seven values, `decide_club_claim` requires
`site.claims.review`, granting any role additionally requires `site.club_roles.manage`, and **the
reviewer chooses the roles**. Step 19 changed only what is asked and in what order — the UI now offers
what the database accepts, and says "choosing a title here does not give you that role" next to the
picker rather than below the fold.

Safeguarding / Welfare Officer stays claim-ineligible by constraint, and the screen says why when it is
chosen.

## Absent, deliberately

| | why |
|---|---|
| **Team join code** as a public entrance | §15.4 row D. No public entrance exists and none was invented |
| **Player self-service join** | §15.4 row E and §15.6 proposal 6 — a product journey of its own, not an entrance-coherence repair. Its approval surface now exists (`club/join-requests`), so it is buildable; it is recorded as debt rather than half-built |
| **A role on the invitation preview** | UX-8 §7 illustrates it. Deferred: governing roles have a canonical label authority (`lib/governing/roles.ts`) but club-staff invitation roles (`COACH`, `TEAM_MANAGER`) have none, and inventing a second naming authority to fill a preview line is the wrong trade. Recorded as debt |
| **A second onboarding system** | Step 6 owns first-run onboarding (§28) |
