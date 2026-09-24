# CA-M11 — Identity, Profile, Security & Onboarding: forensic map of HEAD `dc7f742`, and what the slice built

One platform, two clients. This map records every identity, account, security and onboarding flow as the
repository holds it at the CA-M11 checkpoint, and where each converges on the phone. One identity, many
contexts, no second identity model: authority is never decided from user metadata, a route, a selected
context, a role label, a deep-link parameter or a cache. The server decides every read and write; the
phone consumes the decision and cannot widen it.

**Statuses.** `NATIVE PARITY` — done natively through the canonical server operation. `SHARED / CONVERGED`
— one shared module serves both clients. `WEB-FIRST BY DESIGN` — desk work or a flow whose safety
architecture is the website's, and the app says so. `INTENTIONAL HANDOFF` — the app names the job and
opens the canonical web page. `NOT APPLICABLE` — not a phone job, or a web mechanism with no phone
equivalent. `BLOCKED` — waits on release hardening (associated domains, push).

## 1. Cross-cutting facts (from the forensic audit)

| | |
|---|---|
| Identity | One `auth.users` row, one `profiles` row (trigger `create_profile_for_identity`); `profiles.setup_state ∈ {PENDING_DETAILS, COMPLETE}` is **not an authority signal**. Site admins are `site_admins(status='active')`. |
| Session truth | `internal.current_session_aal()` reads `auth.sessions.aal`, never the JWT claim; `internal.session_ok()` = live session ∧ AAL ok ∧ account active, folded into `internal.can()` and a restrictive policy on ~209 tables. |
| MFA policy | `mfa_enforcement_policy` seeds every group with `require_aal2_from = NULL` and a migration self-check fails if any is on: **MFA is optional for everybody at HEAD.** The phone must not assume otherwise. |
| Recent auth (R) | `capabilities.aal ∈ {'A2','R'}` is metadata the resolver never reads. R is enforced by hand, per RPC, through `internal.require_recent_aal2()` (20 call sites) and `internal.recent_aal2(10)` — `sign_out_my_other_devices`, `regenerate_my_recovery_codes`, the club permission and membership operations, impersonation. |
| Password policy | `packages/contracts/src/password-policy.ts` (12 chars, 72 bytes, a capital, a special) is the whole composition rule; the website adds a server-only Have I Been Pwned check on its own actions. GoTrue re-applies its minimum on `updateUser`. `secure_password_change = false`: **neither client asks for the current password** when setting a new one (recorded). |
| Auth flow state | `auth_flow_states` (hashed flow id, one hour, single consume) carries **signup context**, not recovery; only `SIGNUP` is an active kind. Recovery is GoTrue's own PKCE recovery session. |
| Invitations | `access_invitations` stores `token_sha256` and `code_hmac` only; plaintext is returned once by `issue_invitation`. `preview_invitation` (anon-callable) answers kind, scope, inviter, expiry, state — never the invited address or an id; a miss is an empty result. `redeem_invitation` refuses by returning; wrong account = generic refusal + `invitation.identity_mismatch`; the issuer's authority is re-checked at redemption; a `TEAM_JOIN_CODE` produces `JOIN_REQUEST_PENDING`, never access; ≥5 non-redeemed attempts in 15 minutes throttle **before any lookup**. |
| Context | `getSessionContext` → `listSwitchableContexts` → `resolveActiveContext` in `packages/contracts`. The web cookie `ovalball_ctx` is not validated on write and re-checked on read; a stale key falls back club → team → first. The phone now runs `resolveOnboardingState` on top: zero → onboarding, one → enter, many with a still-held memory → restore, many otherwise → **ask** (never the broadest role). |
| Not to copy | The web claim path inserts `club_claims` directly instead of calling `submit_club_claim`; four legacy plaintext-token entrances (`/invite/*`, `/guardian-invite`, `/player-invite`) are still live; `requestEmailChange` has no `guardAction`; `requireSession({recentMinutes})` only ever reads the fixed 10-minute `recent_aal2`. The phone uses none of these. |

## 2. Flow map

| Flow | Canonical server/auth domain | Web surface | Mobile surface (after CA-M11) | Shared contract | Authority | AAL | Token/secret? | Deep link | Status | Decision | Security notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Welcome | none | `/` marketing | `app/welcome.tsx` (approved cinematic still, native buttons) | — | none | — | no | — | kept | NATIVE PARITY | Grants nothing; imagery untouched. |
| Get Started (decision) | none | `/signup`, `/join`, `/login` | **`app/get-started.tsx`** — the four real ways in | **`onboarding/entry.ts`** `ENTRY_PATHS` | none | — | no | — | new | NATIVE PARITY | No open registration ending in access, no role picker; the club path opens the canonical web signup. |
| Sign In (password) | GoTrue `signInWithPassword` | `/login` | `app/sign-in.tsx` (entrance notice, Get Started link) | **`auth/wording.ts`** | none | aal1 → challenge if a factor exists | no | — | polished | NATIVE PARITY | One enumeration-safe sentence on both clients. Rate limit is GoTrue's; no Turnstile on native (recorded). |
| Magic-link login | `signInWithOtp` | `/login` (beside password; retiring "T6") | none | — | — | — | link | — | — | NOT APPLICABLE | Never built on the phone; `block_magic_link_login` unconsulted by web code (recorded). |
| Forgot Password | `resetPasswordForEmail` + `record_password_reset_requested` | `/forgot-password` | `app/forgot-password.tsx` | wording | none | — | no (link by email) | recovery link | kept | NATIVE PARITY | Neutral confirmation. Web adds Turnstile; native relies on GoTrue's per-address limit (recorded). |
| Password Recovery | PKCE recovery session → (**factor challenge first if the account holds one**) → `updateUser` → `record_my_security_change('PASSWORD_RESET')` → `signOut({scope:'others'})` | `/account/reset-password` (calls `updateUser` before its challenge — refused for a factor holder; recorded H31) | `app/auth/recovery.tsx` (challenge, then the shared checklist) | `password-policy.ts`, `auth/mfa.ts`, **`components/password-requirements.tsx`** | session | aal1 by definition; a factor holder proves aal2 on this screen; `recovering` outranks the gate | PKCE code, exchanged | `/auth/recovery?code=` | converged + fixed | NATIVE PARITY | Found by the proof: GoTrue refuses a password from an AAL1 session when MFA is enabled. Fails closed to a global sign-out if revocation errors. HIBP does not run on this path (recorded). |
| MFA challenge (sign-in) | `mfa.challenge`/`verify` | `/security/verify` | `app/verify.tsx` | **`auth/mfa.ts`** `pickChallengeFactor` | none | aal1 → aal2 | no | — | one factor rule | NATIVE PARITY | Verified factors only, both screens. Lost authenticator → web recovery code (hand-off link). |
| Step-up (recent auth) | `internal.require_recent_aal2()` | in-page challenge | `app/step-up.tsx` + `src/admin/pending-intent.ts` | `club/permissions.ts` `isRecentAuthRefusal` | none | aal2 within 10 min | no | — | CA-M4 | SHARED / CONVERGED | Verification never performs the mutation; Cancel discards the intent; Security resumes its own. |
| TOTP enrolment | `mfa.enroll` → `challenge`/`verify` → `issue_my_first_recovery_codes` → `record_my_security_change('MFA_ENROLLED')` | `/security/enrol` | **`app/(tabs)/security/enrol.tsx`** | `auth/mfa.ts` (`MAX_TOTP_FACTORS`, stale cleanup) | none | aal1 allowed (elevation) | **QR + secret shown once**, component state only | — | new | NATIVE PARITY | Never persisted, logged, copied or screenshotted; the review list skips this screen. |
| Factor management | `mfa.listFactors`/`unenroll` + `MFA_FACTOR_REMOVED` | `/account/security` | **`security/index.tsx`** | `auth/mfa.ts` `canRemoveFactor`, `factorLabel` | none | aal2 (a factor holder is at aal2) | no | — | new | NATIVE PARITY | The last verified factor cannot be removed on either client: replace, don't remove. Cap 3. |
| Recovery codes | `my_recovery_code_count`, `regenerate_my_recovery_codes` (R) | `/account/security` | `security/index.tsx` | `auth/security.ts` | none | **R** | codes shown once | — | new | NATIVE PARITY | Refusal → step-up → held intent resumed. |
| Recovery-code sign-in | `redeem_my_recovery_code` (deletes every factor, stays aal1) | `/security/recovery` | link from `verify.tsx` | — | none | aal1 | code | — | hand-off | INTENTIONAL HANDOFF | A factor reset is a desk decision. |
| Privileged recovery requests | `privileged_recovery_requests`, `cancel_privileged_recovery` | `/account/security` | none | — | site | — | — | — | — | WEB-FIRST BY DESIGN | |
| Change Password | `updateUser({password})` + `PASSWORD_SET` | `setAccountPassword` (no web UI caller at HEAD) | **`security/password.tsx`** | `password-policy.ts`, checklist | session | as signed in | no | — | new | NATIVE PARITY | No recent-auth on either client; no current-password check on either (recorded). Does not evict other devices — that is its own decision. |
| Sign out other devices | `sign_out_my_other_devices` (R) | `/account/security` | `security/index.tsx` | `auth/security.ts` `otherSessions` | none | **R** | no | — | new | NATIVE PARITY | Keeps the current session; count reported. |
| Signed-in devices | `my_sessions` | `/account/security` | `security/index.tsx` | `describeDevice` | none | — | no | — | new | NATIVE PARITY | Own sessions only (IO-H). |
| Sign Out | `signOut({scope:'local'})` | `/account` | More, Security, Verify | **`src/auth/leave.ts`** | none | — | — | — | one list | NATIVE PARITY | Context, child, drafts, hub caches, attention, pending intents and a held invitation go before the session. |
| Session restoration | `getSession` + `getAuthenticatorAssuranceLevel` (fails closed) | cookie refresh in `proxy.ts` | `src/auth/session.tsx` + `LaunchCanvas` | — | none | classified every launch | session in SecureStore (chunked) | — | kept | NATIVE PARITY | No white flash; invalid/revoked session → signed-out → Welcome. |
| Suspended account | `profiles.account_state`, `session_ok()` false | middleware sign-out → `/login?reason=suspended` | RPC refusals; no dedicated screen | — | — | — | — | — | gap | WEB-FIRST BY DESIGN | Recorded (H31): the phone should read `my_session_assurance.account_usable` and land on a suspended screen. |
| Session versioning | `user_session_versions`, `AUTH_SESSION_VERSION` | middleware → `/login?reason=updated` | not consulted | — | — | — | — | — | gap | NOT APPLICABLE | A web cookie mechanism; recorded (H31) for a mobile equivalent if ever needed. |
| Profile (name, phone) | `profiles` self-update (column grants) | `/account` | `(tabs)/profile` | `identity/profile.ts` (CA-M9) | self | — | no | — | kept | SHARED / CONVERGED | Own row only (IO-K); never DOB, state or memberships. |
| Personal avatar | `avatars` bucket, `profiles.avatar_storage_path` | `/account` | Profile picture control | `resolvePersonalAvatarUrl`, `identity/images.ts` | self | — | signed URL | — | kept | SHARED / CONVERGED | The picture is the control. |
| Postal address | `profiles` address columns | `/account` | hand-off card | — | self | — | no | — | kept | INTENTIONAL HANDOFF | Address lookup is a desk form. |
| Email change | `updateUser({email})` double confirmation | `/account` (`requestEmailChange`, no `guardAction`) | hand-off card | — | self | — | confirmation links | — | kept | WEB-FIRST BY DESIGN | Confirmed by email on both addresses; recorded that the web action lacks the boundary. |
| Date of birth | `record_own_date_of_birth` (once) | `/join` age gate | actionable refusal message → website | — | self | — | no | — | — | INTENTIONAL HANDOFF | An `AGE_ELIGIBILITY_REQUIRED` refusal is shown with the server's sentence; supplying a DOB stays on the web join page. |
| Remember me | cookie lifetime | `/account` | — | — | — | — | — | — | — | NOT APPLICABLE | A native session is persistent by design. |
| Notification preferences | `notification_preferences` | `/account` | Notifications (CA-M8) | `notifications/preferences.ts` | self | — | — | — | kept | SHARED / CONVERGED | |
| Invitation preview | `preview_invitation` | `/join` | **`app/join.tsx`** | **`invitations/preview.ts`** | anon | — | token/code → hashed on arrival | `/join?t=` `?c=` | new | NATIVE PARITY | Same answer signed out and in; no address, no id. |
| Invitation accept | `redeem_invitation` | `/join` (`acceptInvitation`) | `app/join.tsx` | **`invitations/redeem.ts`** (single chokepoint, both trees guarded) | session | as signed in | token/code in memory only | held across sign-in + MFA | new | NATIVE PARITY | Fails closed on any unrecognised outcome; contexts re-read from the server after. |
| Wrong account | `invitation.identity_mismatch` → generic `REFUSED` | `signOutAndReturnToInvitation` | "Use a Different Account" → `leaveSession(keepInvitation)` | wording | — | — | secret kept in memory across the sign-out only | — | new | NATIVE PARITY | The server never names the invited address; the phone explains and offers the way out. |
| Expired / revoked / used | preview `state` | `/join` headlines | `unusableInvitationWording` | `invitations/preview.ts` | — | — | — | — | new | NATIVE PARITY | One sentence per state. |
| Team join code (enter) | `redeem_invitation(code)` → `JOIN_REQUEST_PENDING` | `/join?c=` | `/join` code entry (Get Started, no-context screen) | shared | session | — | code in memory | — | new | NATIVE PARITY | A code never grants access (IO-E). |
| Team join code (issue/revoke) | `issue_invitation('TEAM_JOIN_CODE')`, `revoke_invitation` | `/teams/[id]` | Team Settings → Join Codes (CA-M7) | `team/requests.ts` | `team.join_code.manage` | — | plain code shown once | — | kept | SHARED / CONVERGED | |
| Staff invitations (issue) | `issue_invitation('CLUB_STAFF')` (R) | `/people` | Admin People (CA-M10) | `club/invitations.ts` | `people.invitation.create` | R | plain token shown once | — | kept | SHARED / CONVERGED | |
| Claim club | `submit_club_claim` (zero callers), web inserts `club_claims` | `/signup` club step | Get Started → website | — | anon/session | — | — | — | — | WEB-FIRST BY DESIGN | Turnstile, Club Directory search, reviewer-decided roles. |
| Create account | `create_auth_flow_state('SIGNUP')` + `signInWithOtp(shouldCreateUser)` | `/signup` | Get Started → website | — | anon | — | flow id cookie | — | — | WEB-FIRST BY DESIGN | Open account creation exists on the web; it produces an identity, never a relationship. |
| Legacy entrances | plaintext-token preview RPCs | `/invite/*`, `/guardian-invite`, `/player-invite` | none | — | — | — | plaintext | — | — | NOT APPLICABLE | The phone knows only `/join`. |
| Context discovery | `getSessionContext`, `listSwitchableContexts` | `(app)/layout` | `src/context/contexts.tsx` | `session-context.ts`, `active-context-rules.ts` | none (read convenience) | — | — | — | kept | SHARED / CONVERGED | |
| Zero / one / many | (client rule over the canonical list) | cookie fallback club → team → first | **`onboarding/state.ts`** `resolveOnboardingState` | shared | none | — | — | — | new | NATIVE PARITY | Web still falls back club-first (recorded). |
| Context switcher | — | `context-switcher.tsx` | `context-sheet.tsx` with kind labels | `CONTEXT_KIND_LABEL` | none | — | — | — | polished | NATIVE PARITY | "Club · Club Admin", "Team · Coach", a child's club and side; never an enum or id. |
| Removed context | — | silently falls back | `reconcileSelectedKey` + one notice | shared | none | — | — | — | new | NATIVE PARITY | Stored key dropped on disk and in state. |
| Zero-context onboarding | — | `/welcome` pending-status page | **`src/onboarding/no-context.tsx`** | wording | none | — | — | — | new | NATIVE PARITY | Code entry, find-or-claim (web), support. The web page also names a pending claim's state (recorded). |
| Site admin context | `site_admins` | `/admin` | "Site Admin is on the web" card | shared | site | — | — | — | kept | WEB-FIRST BY DESIGN | Signs in fine with no club. |
| Governing body context | `my_governing_bodies` | `/governing/[id]` | card | shared | body role | — | — | — | kept | WEB-FIRST BY DESIGN | |
| Impersonation | `start_impersonation` (R) | banner | none | — | `site.users.impersonate` | R | — | — | — | WEB-FIRST BY DESIGN | |
| Deep-link router | — | — | `_layout.tsx` + `links/intents.ts` (+ `JOIN`, `TEAM`) | `navigation/destinations.ts` (CA-M8) | none | — | recovery code, invitation secret | all CA-M8 destinations | fixed | NATIVE PARITY | Signed-out links hold minimal intent; a link failure is now read on the sign-in screen. |
| Universal links | associated domains | — | scheme links only | — | — | — | — | — | — | BLOCKED | Release hardening (H31). |
| Push / device lifecycle | — | — | none | — | — | — | — | — | — | BLOCKED | Unchanged; pending. |

## 3. Counts

| Status | Count |
|---|---|
| NATIVE PARITY | 24 |
| SHARED / CONVERGED | 9 |
| WEB-FIRST BY DESIGN | 9 |
| INTENTIONAL HANDOFF | 3 |
| NOT APPLICABLE | 4 |
| BLOCKED | 2 |

## 4. Contracts converged

`packages/contracts/src/invitations/{preview,redeem}.ts` (preview interpretation, purpose words, the
redemption chokepoint, `entranceOutcome`), `packages/contracts/src/auth/{wording,mfa,security}.ts`,
`packages/contracts/src/onboarding/{state,entry}.ts`. The website now re-exports
`lib/invitations/redeem.ts`, builds `lib/invitations/entrance-landing.ts` on `entranceOutcome`, reads
`INVITATION_PURPOSE` on `/join` and `MAX_TOTP_FACTORS` from the shared package.
`scripts/verify-redemption-callers.mjs` now guards both clients' trees with one chokepoint.

## 5. Personas and proof

`uat.unrelated` (0 relationships) is the safe identity: given a temporary password for the proof, it
walks sign-in, Change Password, native enrolment, the challenge, step-up with a held intent and its
cancellation, recovery by email, a `CLUB_STAFF` invitation issued by `uat.coach`, the wrong-account
escape, and a profile edit read back on the website — then every row is put back (password unset, no
factor, no codes, no membership, no invitation, no profile change, the pre-existing sessions restored).
`uat.manyhats` proves many contexts (asked once, kind labels, restored); `uat.siteadmin` a site admin
without a club; `uat.team.admin` a removed team context; `uat.guardian.one` → `uat.guardian.two` cache
isolation. Permanent coverage: `supabase/tests/identity_onboarding_ca11.sql` (IO-A…IO-K) and
`supabase/tests/js/identity_onboarding_ca11.test.mts`.

**Proof outcome (Expo Web export, Playwright, local stack, 2026-09-24).** Every section passed: A welcome →
Get Started → wrong then right password; B native password change (stamped, `password.set` recorded, new
password signs in); C native enrolment (one verified factor, ten codes, session at aal2); D the challenge
at sign-in (wrong-code sentence, then in); E other devices signed out (one revoked), step-up shown for
Replace My Codes, Cancel performed nothing, the held intent resumed after a code; F forgot password →
local mail → recovery link → **the factor challenged first** → new password → `password.reset_completed`
→ other sessions gone → sign in with the new password then the code; G an invitation issued by the club
previewed signed out (club and inviter named, no address), held across sign-in and the code, accepted
(`MEMBERSHIP_ACTIVE`, the stored VOLUNTEER role), Home became the club; a link for somebody else refused
generically with "Use a Different Account", which signed out keeping the invitation and returned to it
after sign-in; H a phone number saved on the phone read on the website's Account page; I `uat.manyhats`
asked once, rows "Club · Club Admin", "Club · Fixture Secretary", "Club · Safeguarding Officer", "Team ·
Coach", "Parent / Guardian · …", the chosen team restored on relaunch; J `uat.siteadmin` sees the Site
Admin card and no family home; K `uat.team.admin`'s coach role revoked → notice + no-context screen, the
stored key dropped, restored; L guardian one's caches never reach guardian two, and a sign-out leaves no
key in storage. Screenshots (no enrolment or recovery-code screen captured) and `results.json` are in
the session scratchpad. Review world restored to its recorded baseline; the only residue is append-only
audit history (`security_events`, `audit_log`), which is immutable by design.

**Found by the proof.** (1) GoTrue refuses a password from an AAL1 recovery session when a factor exists —
fixed on the phone (challenge first), recorded for the website (H31). (2) Publishing the context list
before the remembered key was read made the onboarding decision ask on every launch — fixed in the
provider. (3) A site admin's Home drew a participant "Nothing coming up" — fixed. (4) The invitation
screen mounted from the route before the deep-link router had held the secret — the screen now re-reads it.

## 6. Recorded gaps (ledger H31)

The website's reset cannot complete for a factor holder (found by the proof; the phone challenges first); no Turnstile and no HIBP on the native reset path; no current-password check on either client's
password change (`secure_password_change = false`); no suspended-account screen on the phone; session
versioning is web-only; the web still falls back club-first for a stale context and names a pending
claim's state on `/welcome`; the web claim path bypasses `submit_club_claim`; `requestEmailChange` lacks
`guardAction`; magic-link login remains on the web with its block flag unconsulted; four legacy
plaintext-token entrances remain live; universal links and push are release hardening;
`mobile_foundation.test.mts` carries three pre-existing failures unrelated to this slice.

## 7. Physical-iPhone walkthrough (prepared, not performed)

A. Cold launch: forest canvas, no white flash, Welcome. B. Get Started: four choices, no role. C. "Join
or set up my club" opens Safari on `/signup`. D. "I already have an account" → Sign In. E. Wrong
password: one sentence, button does not jump. F. Right password, no factor: Home. G. Zero-context Home:
"No rugby here yet" with code entry, find-or-claim, help. H. More → Security: "Password only", this
device listed. I. Change Password: checklist ticks live; confirm mismatch named; success card. J. Sign
out; sign in with the new password. K. Set Up Authenticator: QR scans in a real authenticator app; key
by hand works; wrong code refused; right code → recovery codes shown once. L. Security: "Two-step on",
"Add another before removing", 10 codes. M. Sign out; sign in → One more step; wrong code sentence;
right code → Home. N. Replace My Codes after 10 minutes → Confirm it's you → Cancel → nothing changed.
O. Same → code → new codes shown. P. Sign Out Other Devices with a second device signed in → count.
Q. Forgot your password? → neutral confirmation → Mail app → link opens the app (scheme) → Set a new
password → Password updated → Continue to Sign In. R. Recovery link opened twice → "no longer valid" on
the sign-in screen. S. Invitation link from Mail while signed out → preview → Sign In to Accept → code →
back on the invitation → Accept → You're in → Continue → the club is Home. T. Same link again → "already
been used". U. A link sent to somebody else → refused → Use a Different Account → sign in as the right
person → back on the invitation. V. Team code typed from Get Started → preview → Accept → "Request sent".
W. Profile phone changed → visible on the website's Account page. X. Many contexts: first launch asks;
rows read "Club · Club Admin", "Team · Coach"; choose; relaunch restores. Y. Site admin only: the web
card, no switcher. Z. Role removed by the club while the app is open → pull to refresh → notice → no
context. AA. Sign out on More: relaunch shows Welcome; another person signs in and sees none of the
first person's child, drafts or notifications. AB. Background 15 minutes → foreground → session still
live, no flash. AC. Airplane mode on Sign In → "No connection". AD. Airplane mode on Security → error
state, retry. AE. `/teams/<id>` scheme link while signed out → sign in → lands on the team. AF. Lost
authenticator → "Use a Recovery Code on the Website" opens Safari. AG. Nothing secret appears in
Settings → Ovalball → storage, in Console.app, or in any screenshot.
