# Slice 6b.2 — session enforcement and auth flow state: the exact contract

**Recovered from source, not inferred from the command.** Every requirement below is quoted or
traced to Phase 2 (`IDENTITY_AUTH_PHASE2_IMPLEMENTATION_DESIGN.md`), the Phase 1 audit, or the
reconciliation register. Where this command *adds* scope that the closure manifest had placed
elsewhere, that is stated.

**Baseline reverified before any editing.** Production release `c03e2b8`; ledger **521 /
`20270430000000`**; Full Site Admin `full` / `SITE_FULL`, ACTIVE / COMPLETE, 10 live sessions;
0 TOTP factors; 0 MFA enforcement groups; 1 pending second-admin invitation; protected logos
`be2bef0c…` / `bdd32248…`; `public.auth_flow_states` **0 rows in production**; working tree carries
only the two untracked protected logos.

---

## 1. What Phase 2 actually says

### D.2 — the three enforcement layers (verbatim structure)

1. **Database (authoritative).** `internal.session_ok()` = session live **and** `aal = 'aal2'`
   **and** the first factor is not setup-restricted **and** the account is usable. Folded into
   `internal.can()`, `internal.has_site_capability()` and a RESTRICTIVE policy `session_ok_required`
   on every non-public table. *"During transition it is also gated by enforcement flags (AG)."*
2. **Server (Next.js).** `requireSession({ aal: 'aal2', recentMinutes? })` in
   `lib/auth/require-session.ts`, *"used by the `(app)` layout, every Server Action and every route
   handler."* It reads the verified user, the assurance level, the `amr` claim and
   `account_security_state`. *"AAL1 → `/security/verify`; setup-restricted → `/account/setup`;
   suspended → `/account/suspended`."*
3. **Proxy (`proxy.ts`).** *"the same redirects for UX only; never relied on."*

### SO-4 (X, social) — verbatim

> "Onboarding context (invitation token hash, claim draft id, `next`) is stored server-side in
> `auth_flow_states` before the OAuth redirect and resolved after callback. OAuth `state` only
> carries the opaque flow id."

Supported by Y.19, the migration comment that created the table: *"Server-side flow context for an
in-flight invitation, claim or signup, keyed by the hash of an opaque httpOnly cookie. The payload
carries ids and a next path — **never authority**."* And: *"This exists because of the H-7 lesson:
invitation context must never travel in user metadata, where the user can edit it."*

### SO-7 — verbatim

> "The signup Turnstile null-token defect and the login landing mismatch (Phase 1 P) are fixed in
> Slice 6: one post-authentication router."

### H-7 (Phase 1 audit, High) — verbatim

> "**Signup metadata poisoning**: unauthenticated `signInWithOtp({shouldCreateUser:true, data:
> ovalballSignupPayload})` for any email stores attacker-chosen claim/profile data that is written as
> the real owner on first login."

Phase 1's own remedy statement: *"Claim data stored server-side after authentication only (no pre-auth
metadata payload — fixes H-7)."*

---

## 2. The 6b.2 row set

| Row | Source | Assigned here by | Currently |
|---|---|---|---|
| **S6-9** `requireSession` on every boundary | Phase 2 D.2 layer 2 | closure manifest | **MISSED** — exists, **zero callers** |
| **S6-8** `/account/suspended` + suspension enforcement | Phase 2 D.2 | manifest, reopened by 6b.1 | route exists, nothing routes to it |
| **S6-17** security headers, CSP, cookie `secure` | Phase 2 H | closure manifest | **none present at all** (verified: no `next.config` headers, no CSP anywhere) |
| **S5-7 / SO-4** `auth_flow_states` | Phase 2 X SO-4, Y.19 | **moved into 6b.2 by this command** (manifest had 6b.3) | dead schema — 0 callers, 0 production rows |
| **S5-6 / H-7** `ovalballSignupPayload` | Phase 1 H-7, Phase 2 AK | **moved into 6b.2 by this command** (manifest had 6b.3) | 3 live occurrences, browser-bound but still in `user_metadata` |
| **NEW-1 / SO-7** social-signup null Turnstile | Phase 2 X SO-7 | **moved into 6b.2 by this command** (manifest had 6b.3) | `account-step.tsx:79` passes `turnstileToken={null}` |

**Explicitly NOT in this unit**, and not started: SO-1/2/3/5/6 provider and linking closure, Apple
and Facebook configuration, any production Auth setting, TOTP enablement, AN-3, 7e, Slice 8.

---

## 3. Current enforcement map (measured, not assumed)

Boundaries counted on disk: **5 layouts**, **8 route handlers**, **126 files carrying `"use server"`**
with **467 exported async functions**.

| Boundary | IDENTITY | SESSION LIVENESS | ACCOUNT STATE | AAL | CAPABILITY |
|---|---|---|---|---|---|
| `proxy.ts` → `updateSession` | `getUser()` | refresh only | **yes** — re-reads `account_status` every request, signs out on `suspended` | no | no |
| `app/(app)/layout.tsx` | `getUser()` → `/login` | no | no | no | relationship check → `/welcome` (UX, not authority) |
| Server Components under `(app)` | inherited | no | no | no | via RLS on read |
| **Server Actions (467)** | **ad hoc per action** | **no** | **no** | **no** | **RLS / RPC only** |
| Route handlers (8) | ad hoc | no | no | no | RLS / RPC only |
| `/auth/callback` | exchanges code | n/a | no | no | n/a |
| `/security/*` | own checks | no | no | own | n/a |
| Database (`session_ok`, `can`, `has_site_capability`, RESTRICTIVE policy) | `auth.uid()` | **yes** | **yes** | **yes** (AG-gated) | **yes — authoritative** |

**The actual missing layer** is not "capability in the application" — that exists and is
authoritative in the database, and duplicating it in middleware is explicitly forbidden. It is a
**uniform server-side session boundary**: today a protected Server Action invoked directly, with no
layout having run, meets no identity, liveness, account-state or AAL check of its own. It reaches the
database, which refuses correctly — so this is **defence-in-depth and honest refusal, not an open
door** — but D.2's layer 2 is entirely absent and a direct invocation currently produces a bare
database error rather than a stated refusal.

### The T0 trap, and why `requireSession` is already safe

D.2 says `requireSession({ aal: 'aal2' })`. Taken literally at T0 — where **0 factors and 0
enforcement groups exist** — that would redirect every user on the platform to `/security/verify`
and lock everyone out. The existing implementation already avoids this: it reads
`enforcement_required` from `my_session_assurance()`, which is `not internal.session_aal_ok()`, so an
AAL1 session passes unless *either* the person's group is being enforced *or* the caller explicitly
asks for `aal: 'aal2'`. **T0 stays T0.** This is the single most important property 6b.2 must not
break, and it is proven by test, not by inspection.

### D-S6B-AUTO-10 is locked

Suspended/disabled ⇒ **no usable Ovalball session or authority**. `/account/suspended` is a
defensive presentation destination, never an authority exception, and the fail-closed middleware is
not weakened. `sessionRefusal("ACCOUNT_UNAVAILABLE")` therefore resolves to a signed-out destination,
**not** to `/account/suspended` — which also means D.2's literal "suspended → `/account/suspended`"
is superseded here by the recorded owner decision.

---

## 4. Severity, stated honestly

| Finding | Live in production today? |
|---|---|
| S6-9 missing layer 2 | Yes, but the database refuses; the cost is poor refusals, not lost authority |
| SO-7 null Turnstile on social signup | **No** — production has **no** social provider enabled (`external` shows `email` only), so the button does not render. The defect is **latent**, and fixing it now means it is correct before any provider is ever switched on |
| H-7 payload in `user_metadata` | Partially mitigated — an httpOnly browser-binding cookie means the payload only applies to the browser that submitted it. The architecture is still "pre-auth attacker-authored data in metadata", which is what SO-4 exists to remove |
| SO-4 dead schema | Yes — `auth_flow_states` has 0 rows and 0 callers in production |
| S6-17 no headers/CSP | Yes |

---

## 5. Staging decision — D-S6B-AUTO-11

**6b.2 as commanded is not one unit. It is four, and they have different risk profiles.** Stating that
plainly is worth more than a thin pass over all of them, because §20 of the authorisation says
closure must not be inflated and §16 says no manually-run-only gate may support READY.

| Stage | Scope | Risk | Needs a migration |
|---|---|---|---|
| **6b.2a — session enforcement + SO-7** | S6-9, the suspension proofs, SO-7 | **high lockout** (gates every authenticated page) | no |
| **6b.2b — canonical flow state** | SO-4: `auth_flow_states` activation | medium | **yes** — expand, then cutover |
| **6b.2c — legacy retirement** | H-7: `ovalballSignupPayload` | medium — must not run before 6b.2b works | possibly (contract) |
| **6b.2d — transport security** | S6-17: headers, CSP, cookie `secure` | medium — a wrong CSP breaks the product silently | no |

They are ordered by dependency, not by preference: **6b.2c cannot start before 6b.2b works**, because
§7 says explicitly *"Do NOT delete it before the canonical replacement works"*; and **6b.2b wants the
session boundary already proven**, because the flow-state consume path runs inside it.

This stage delivers **6b.2a only**, completely and with its permanent gates wired into the release
runner. 6b.2b, 6b.2c and 6b.2d are **NOT STARTED** — not partially done, not stubbed, no dead code
added. The archaeology for all four is in sections 1–4 above and remains valid for the next stage.
