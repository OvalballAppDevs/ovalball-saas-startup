# Slice 6b.2 — stages 2 and 3

**Convergence Step 4.** Banked independently. **Not released.** Step 5 / Slice 7
not started. The L7 contract migration is untouched.

---

## 1. The Slice 6 contract, recovered from the checked-in design

Authority read before any code: `SLICE_6B_CLOSURE_MANIFEST.md`,
`SLICE_6B2_REQUIREMENT_MATRIX.md`, `IDENTITY_AUTH_CLOSURE_LEDGER.md`.

**Slice 6b owns** rows S6-3, S6-5, S6-6, S6-7, S6-8, S6-9, S6-12, S6-13, S6-16,
S6-17, S6-18, S6-21, S6-22, plus S5-6 and S5-7 moved in with a recorded reason.
**Out of 6b:** S6-14 and S6-24 (AN-3 / T-stages), and every provider,
password-configuration, TOTP-enablement, 7e, Slice 8/9/10 item.

| sub-slice | scope | before this stage | now |
|---|---|---|---|
| 6b.1 | S6-2, S6-5, S6-6, S6-7, S6-8, S6-3 code half | released | released |
| 6b.1b | S6-12, S6-13 | **not started** | **not started** |
| 6b.2a | S6-9 session enforcement | released (`e4e8c59`) | released |
| **6b.2b** | **SO-4 / S5-7 — `auth_flow_states` activation** | **not started** | **NOT STARTED — archaeology complete, §5** |
| **6b.2c** | **H-7 / S5-6 — `ovalballSignupPayload` retirement** | **not started** | **NOT STARTED — blocked on 6b.2b by design, §5** |
| **6b.2d** | **S6-17 — headers, CSP, cookie `secure`** | **not started** | **DELIVERED, §4** |
| 6b.2 / SO-7 | social-signup null Turnstile | released (`9af26e5`) | released |
| 6b.3–6b.5 | providers, linking, external config | not started | not started |

Plus one item this step was given that is in no manifest, because it was
reported from production: **the post-login homepage regression (§3)**.

---

## 2. Archaeology

| flow | route/action | server | canonical state | destination |
|---|---|---|---|---|
| password login | `/login` → `submitPasswordLogin` | `signInWithPassword`, then `mfa.getAuthenticatorAssuranceLevel` | GoTrue session + `record_session_version` | client `window.location.assign` |
| email-link login | `/login` → `submitLogin` → `sendSignInLinkIfAccountExists` | `signInWithOtp`, `emailRedirectTo=/auth/callback?next=/dashboard` | as above | callback |
| social login | `/login` → `startOAuthSignIn` | `signInWithOAuth`, `redirectTo=/auth/callback?next=…` | as above | callback |
| signup | `/signup` → `submitSignup` | `signInWithOtp` with `data.ovalballSignupPayload`, `next=/welcome` | **`user_metadata`** | callback → `completeSignupIfNeeded` |
| callback | `/auth/callback` | `exchangeCodeForSession` → `completeSignupIfNeeded` → profile check | profiles, claims, join requests | `safeNextPath(next)` |
| join continuation | `/join` → `/login?next=/join?t=…` | — | `access_invitations` | `next` |
| session refresh | `proxy.ts` → `updateSession` | cookie refresh | GoTrue | — |

**Duplicated state found:** the destination decision existed twice — once
validated in the callback, once raw in the login form. **Client-trusted state
found:** `ovalballSignupPayload` in `user_metadata` (H-7), still live, and
`auth_flow_states` still a table with **zero callers and zero rows** (SO-4).

---

## 3. POST-LOGIN HOMEPAGE REGRESSION

**ROOT CAUSE.** `lib/auth/safe-next.ts` declared `DEFAULT_NEXT_PATH = "/"` — the
public marketing homepage — and every path with no destination to preserve
reached it. The reported symptom was Google sign-in, because
`app/login/login-form.tsx` rendered `<SocialAuthButtons>` **with no `next` prop
at all**, so the OAuth start encoded that default into its own callback URL
(`/auth/callback?next=%2F`) and the callback faithfully delivered a freshly
authenticated person to the front page. Google OAuth is enabled in production.

A second, independent defect was found in the same line of enquiry:
`login-form.tsx` read `searchParams.get("next")` and assigned it **without
validation**, so `/login?next=https://evil.example` was an **open redirect on the
password path** — beside a guard that had validated the same value since Slice 5.
`safe-next.ts`'s own header warns that two copies of an open-redirect guard is
how one of them drifts. This was the drift.

**CANONICAL FIX.** One destination decision, in the file that already owned it.
`AUTHENTICATED_HOME = "/dashboard"` is named once; `DEFAULT_NEXT_PATH` is that
value; the login form now calls `safeNextPath`; the social buttons carry the same
validated destination. A `NOT_A_DESTINATION` set rejects `/`, `/login`,
`/signup`, `/auth/callback` and `/logout` — same-origin and well formed, so they
passed every existing check, and they are how somebody lands back where they
started. A malformed percent-escape is now rejected too: `new URL` carries
`/%%%` straight through, which is not a property to leave in a redirect
validator. **No parallel role-routing table was added** — `/dashboard` resolves
context through the existing `(app)` layout.

**ORDINARY LOGIN FINAL DESTINATION:** Dashboard.
**INVITATION/JOIN CONTINUATION:** preserved — `/join?t=…` and `/join?c=…` survive
authentication exactly, query and all.
**UNSAFE/STALE CONTINUATION FALLBACK:** Dashboard, never the homepage. Refusing
an attack and dropping the person on the marketing site reads as a broken login
rather than a blocked one.
**REAL BROWSER: PASS.** Seven personas, session caches cleared so each is a
genuine magic-link round trip, asserting the *settled* URL: **20/21**. Club
Admin, Team Manager, Fixture Secretary, Volunteer, Parent/Guardian and ordinary
member all settle on `/dashboard`. **Nobody lands on `/`.**

The one exception is not this defect and not a product defect: the UAT Full Site
Admin fixture has **empty `first_name` and `surname`**, so `hasCompletedProfile`
is false and the callback sends it to `/signup` by existing design
("authentication is not onboarding"). The same blank-name fixture gap was
recorded in Step 2. A Site Admin *with* a completed profile lands on the
Dashboard.

**PERMANENT REGRESSION TEST:** `supabase/tests/js/post_login_destination.test.mts`
— 9 tests covering the default, no continuation, eight open-redirect shapes,
control-character smuggling, malformed encodings, the stale-destination set,
continuation preservation, that every surface goes through the one guard, and
that no surface repeats the destination string.

---

## 4. 6b.2d — transport security (S6-17)

**Before:** none present at all. **Now**, from `lib/auth/security-headers.ts`,
emitted by `proxy.ts` on every matched route:

`Content-Security-Policy` with `default-src 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and
`script-src 'self' 'nonce-…' 'strict-dynamic' https://challenges.cloudflare.com`.
Plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy` and `Permissions-Policy`; `Strict-Transport-Security`
and `upgrade-insecure-requests` are **production only**, because on a local http
origin one pins `localhost` to https in the developer's browser and the other
upgrades the Supabase calls until the stack stops answering.

**A nonce, not `'unsafe-inline'`.** Next injects its own inline bootstrap on
every page, so a policy with neither produces a blank application — precisely the
"wrong CSP breaks the product silently" risk the matrix recorded. Allowing all
inline script would have made `script-src` decorative. The proxy mints one nonce
per request and sets it on the **request** before `updateSession` builds the
response, because `NextResponse.next({ request })` forwards headers as they are
at that moment; setting it afterwards leaves it on an object nothing reads. That
ordering is asserted permanently.

`'unsafe-inline'` remains for **style** only: there is no nonce path for the
style *attribute* form, and inline CSS is not script execution. Stated, not
hidden.

**Verified in a real browser against a PRODUCTION BUILD**, which is the only
meaningful test — `next dev` injects its own unnonced HMR and overlay scripts, so
violations there say nothing about what ships:

| | violations |
|---|---|
| `/`, `/login`, `/signup`, `/join` | **0** |
| `/dashboard`, `/people`, `/club/permissions` (authenticated) | **0** |

All pages rendered and the application stayed interactive. Permanent test:
`supabase/tests/js/security_headers.test.mts` — 8 tests, including that no
wildcard or plain-http origin is ever named and that no origin appears that
Ovalball does not load.

**Cookie `secure`** is unchanged: Supabase SSR sets it from the request scheme,
so production is already `secure` and local http is not. No code was added to
claim credit for existing correct behaviour.

---

## 5. 6b.2b and 6b.2c — NOT STARTED, and why

The requirement matrix's own staging decision **D-S6B-AUTO-11** orders these:
6b.2b (SO-4) then 6b.2c (H-7), with *"6b.2c cannot start before 6b.2b works"*,
because §7 of the original authorisation says **do not delete the legacy payload
before the canonical replacement works**.

**Archaeology, re-verified this stage:**

- **`auth_flow_states`** — `id`, `flow_id_sha256`, `kind`, `payload`, `user_id`,
  `expires_at`, `consumed_at`. **Zero callers in the application. Zero functions
  in the database reference it.** It is a designed carrier that was never wired:
  hashed flow id, server-authored payload, bounded, expiring, single-use by
  construction.
- **`ovalballSignupPayload`** — three live occurrences:
  `app/signup/submit-signup.ts:73` (writer, into `signInWithOtp` `data`),
  `lib/signup/complete-signup.ts:55` (binding-hash check) and `:230` (reader).
  Browser-bound by an httpOnly cookie, so the payload only applies to the browser
  that submitted it — but it remains pre-auth, attacker-authored data in
  `user_metadata`, which is exactly what SO-4 exists to remove.

Building the flow-state cutover half-way, or stubbing it, would leave two
onboarding-intent carriers live at once — the outcome §21 of the authorisation
forbids. They are reported NOT STARTED rather than inflated.

---

## 6. What was preserved

Slice 1–5 authority untouched: no capability, membership, role, family,
invitation or safeguarding path was modified. Step 3 joining is intact —
continuations for `/join?t=` and `/join?c=` are asserted to survive
authentication byte for byte. Site Admin remains identity-scoped. The
`PENDING_CONFIRMATION` → zero-SO-authority guarantee is untouched and still
covered by `users_and_permissions_authority.sql` E1–E6.

**No new dependency was added in this step.**

---

## 7. FUNCTIONALITY LOST: 0

| journey | before | after |
|---|---|---|
| email/password login | worked; raw unvalidated `next` | works; validated |
| email-link login | worked → `/dashboard` | unchanged |
| social login | worked → **public homepage** | works → Dashboard |
| logout, password recovery | unchanged | unchanged |
| invitation link / code / QR continuation | preserved via `next` | preserved, and now provably |
| club claim, team code, player/guardian joining | unchanged | unchanged |
| Site Admin, multi-context login | unchanged | unchanged |
| session refresh | unchanged | unchanged, plus headers |

---

## 8. Remaining auth work, with owners

| item | owner |
|---|---|
| SO-4 `auth_flow_states` activation | **6b.2b** |
| H-7 `ovalballSignupPayload` retirement | **6b.2c**, after 6b.2b |
| S6-12, S6-13 recovery limits and minor age gate | 6b.1b |
| S6-16, S6-18, S6-21, S6-22 providers and linking | 6b.4 |
| S6-3 production half, S6-4, S6-10, S6-11, S6-19, S6-20 | 6b.5, **owner action in the Supabase dashboard** |
| S6-14, S6-24 | AN-3 / T1+ |
| 7e master control, Slices 8/9/10 | as designed |
| **L7 contract migration** | **the release after Step 3 deploys** — retained, untouched |


---

# Stage 3 — SO-4, H-7, L6 and the CSP decision

## 9. 6b.2b — SO-4, delivered

**The defect, verbatim from the reconciliation:** *"Onboarding context in
`auth_flow_states`; OAuth `state` carries only an opaque id" — MISSED, table
exists, 0 application references; context still rides in `ovalballSignupPayload`
user metadata (Phase 1 H-7)."*

`public.auth_flow_states` shipped in Slice 5 with exactly the right shape and
nothing ever called it. Its `kind` CHECK already enumerated the design's
purposes — INVITATION, CLAIM, SIGNUP, LINK_IDENTITY, SETUP — and RLS was on with
**no policies at all**, which is the designed shape: reachable only through
definer functions that did not exist yet.

**Migration `20270503000000`** adds those two functions and nothing else. No new
table, no second carrier, no schema change beyond them.

| property | where it lives |
|---|---|
| unguessable id | 256 bits, base64url, **only its SHA-256 stored** |
| server-authored | RLS on, zero policies, definer functions only |
| bounded purpose | table CHECK, narrowed again to the purposes Slice 6 owns |
| expiry | one hour, the table's own default |
| single use | one UPDATE with `consumed_at is null` in its WHERE clause |
| identity binding | consumption stamps `auth.uid()` |
| session liveness | `internal.session_ok()`, **not** just `auth.uid()` |
| purpose confusion | the kind is in the WHERE clause; a mismatch is "no such state" |
| fail closed | every refusal returns NULL — expired, used, wrong purpose and never-existed are indistinguishable |
| auditable | `auth.flow_state_consumed`, carrying the kind and never the payload |

**Only SIGNUP is migrated.** `internal.auth_flow_kind_is_active` refuses the
other four, because a half-wired purpose would be a second onboarding carrier
beside the first.

**Two existing security gates caught omissions on the first full run, and both
were real:**

- **RPC-30** (the S6-9 closure) flagged `consume_auth_flow_state` as a
  browser-callable definer mutator outside the session gate. It checked
  `auth.uid()` only, so a revoked session with an unexpired JWT could have spent
  a state. Now gated on `internal.session_ok()`.
- **P1 / V6** flagged `create_auth_flow_state` as a new anon-executable definer
  function and `consume_auth_flow_state` as a new event writer. Both are
  deliberate and are now **declared**, narrowly and with reasons, in the three
  perimeter suites — the creator must be anon-callable because a signup has no
  session; the consumer is authenticated-only and gated.

## 10. 6b.2c — H-7, the writer retired

`ovalballSignupPayload` is **no longer written**. `submitSignup` sends no
`data` to `signInWithOtp` at all — not a smaller payload, not a reference —
because leaving anything there would keep the shape alive.

The **reader** survives for exactly one release, clearly marked, as the contract
half: somebody who started the wizard before this deploys has their answers in
metadata and would otherwise be stranded mid-signup. Since nothing writes it, no
new pre-auth authoring surface exists from the moment this ships.

## 11. L6 — closed, with root cause

**Visibility was the wrong readiness signal.** The forgotten-password link is
rendered by a client component whose method state starts in password mode, so it
exists only after hydration *and* the reveal. Next server-renders the reveal
button, so it is visible and looks clickable **before any handler is attached**;
a click landing in that window does nothing, and under batch load that window is
wide enough to hit. The fix waits for what the reveal *produces* — the password
field — and re-issues the click if it did not appear, at most three times.

**Evidence:** 3/3 standalone at 34/34, plus 34/34 inside a full platform batch —
the environment that failed it twice.

The same anti-pattern was found and fixed in suite 68's revoke assertion, which
waited 2.5 seconds instead of waiting for the row to go.

## 12. The two blockers

**L8 — the CSP cannot be enforced yet.** Nonce-bound `script-src` with
`'strict-dynamic'` leaves this Next version's application **un-hydrated**: the
framework emits inline bootstrap scripts without the nonce, and `'strict-dynamic'`
then refuses the chunks they would have loaded. Both documented noncing routes
were implemented and tested against a production build. The policy therefore
ships **report-only**; the transport headers are **enforced**. The three ways
forward are materially different security positions and the checked-in design
does not settle which — so it is recorded, not chosen unattended.

**L9 — clean boot cannot run without destroying the review world.** The project's
mechanism is `supabase db reset`, which rebuilds the working database holding the
canonical personas and the owner's own review changes. A disposable database was
attempted; 338 of 524 migrations applied, with the failures traceable to the
hand-built bootstrap rather than the chain — a proof of the harness, not of the
migrations. **6b.2b is implemented and tested but NOT clean-boot verified.**

## 13. Status

**SLICE 6 — NOT COMPLETE.** 6b.2b and 6b.2c are delivered and tested; 6b.2d is
delivered as transport headers plus a report-only policy; L6 is closed. The slice
cannot be called complete while L8 is undecided and L9 unproven.
