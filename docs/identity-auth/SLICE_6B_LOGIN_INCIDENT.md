# Slice 6b hotfix — the security check that locked the owner out

**Incident date:** 17 September 2026. **Symptom first reported:** *"My admin details don't work anymore."*

## Observed production symptom

The established Full Site Admin, signed out deliberately and using Email + Password with a correct
password, received:

> We couldn't complete the security check. Please try again.

The same message appeared at the authentication-method level (under Continue with Google) and inside
the password form, simultaneously. No amount of retrying helped.

## Root cause

The login page kept **two variables for one fact**:

| | |
|---|---|
| `humanToken` | the single-use Cloudflare Turnstile token |
| `humanPassed` | whether the visitor had cleared the challenge |

The password failure branch cleared only the first:

```js
if (!result.ok) {
  setStatus("error")
  setErrorMessage(result.message)
  if (securityCheckActive) setHumanToken(null)   // token gone
  return                                          // humanPassed still true
}
```

The submit button is gated on `humanPassed` alone:

```js
disabled={ !syntaxValid || status === "submitting" || !humanPassed || (usePassword && password.length === 0) }
```

So after **any** first failure the button stayed enabled with no token behind it. Every retry posted
`turnstileToken = null`; `verifyTurnstileToken` returned `missing-token`; the server refused
fail-closed, exactly as designed, and returned its single generic message. **The password was never
sent to Supabase** — production Auth logs show zero activity for the entire attempt window.

Self-reinforcing: each retry re-cleared the token. The widget re-issues only on Cloudflare's
`expired-callback` (~5 minutes), so it briefly self-healed and one further failure re-trapped the
visitor. A correct password could not get through.

**Introduced by `4ecde7b` (Slice 6)**, which added password sign-in to the login form. The correct
pattern already existed in the same file, in the pre-existing magic-link path from `6282b11`:

```js
setHumanToken(null)
setHumanPassed(false)      // ← the half that was not copied
```

### A second instance, same machine

`SocialAuthButtons` receives `turnstileToken` and `ready` as **props** and, on failure, set a local
error without telling the parent anything. The consumed token and `ready = true` persisted, so every
subsequent provider click replayed a dead token and produced the identical message. That is why both
messages were on screen at once. The `400: OAuth state not found or expired` at 15:44 is a consistent
first trigger: that round-trip spent the token and the page never recovered.

## Fix

The two variables become one, with the rule stated once in `lib/auth/challenge-state.ts`:

> **NO VALID TOKEN ⇒ NOT SUBMITTABLE**

- `humanPassed` and `humanToken` are now **derived** from a single `challenge` value, so they cannot
  disagree. A boolean can no longer outlive the token it stood for.
- `spendChallenge()` is called wherever a token is handed to a protected request, and it does two
  things: forgets the challenge, **and remounts the checkpoint** so Cloudflare issues a fresh token.
  Clearing the state alone would have left the button correctly disabled and the visitor with no way
  to re-enable it — trading a loud lockout for a quiet one.
- `SocialAuthButtons` gains `onChallengeSpent` and refuses to dispatch when a required challenge has
  no token. Both new props **default to today's behaviour**, so the only caller whose behaviour
  changes is the login page.

**`lib/auth/turnstile.ts` is untouched.** Server verification still exchanges the token with
Cloudflare, still validates the hostname, still fails closed, and still returns one generic message.

## Affected methods

| Method | Before | After |
|---|---|---|
| Email + password | locked after the first failure | fresh challenge, retry works |
| Google OAuth | dead token replayed after a failed round-trip | challenge spent, fresh one required |
| Magic link | already correct (`6282b11`) | unchanged, now expressed through the shared rule |
| Signup (social) | **still passes `turnstileToken={null}`** — see Known, not fixed | unchanged |

## Regression tests

| Test | Covers |
|---|---|
| `supabase/tests/js/turnstile_challenge_state.test.mts` (15) | A–F deterministically: verify → spend → retry blocked → fresh challenge → allowed; the consumed token is never reused; **F2 holds the exact incident shape** — `{token: null, passed: true}` must not be submittable. Each of the three login methods walks the sequence. |
| `scripts/browser-verification/63-turnstile-login-recovery.mjs` (12) | The owner's journey: wrong password → refused **as a credential failure** → fresh challenge → correct password → signed in **on the same page with no reload**. Both attempts carry a token; a further Cloudflare round-trip is observed after the failure. 320px included. |

Turnstile runs for real in the browser suite using Cloudflare's **published always-passes test keys**,
so the state machine under test is production's rather than a fail-open stand-in.

**Mutation-checked:** reinstating the original defect makes suite 63 fail hard — the button never
re-enables and the click times out. The suite is not decoration.

## Before / after invariant

| | Before | After |
|---|---|---|
| Token spent, `passed` flag | token `null`, flag **true** | both cleared together |
| Submit button | **enabled** with no token | disabled until a fresh token |
| Fresh challenge after failure | only on Cloudflare expiry (~5 min) | immediately, by remount |
| Token posted on retry | `null` | a freshly issued token |

## Known, and deliberately NOT fixed here

- **`app/signup/steps/account-step.tsx` passes `turnstileToken={null}` unconditionally**, and
  `signup-shell.tsx` never passes it the site key, token or `humanPassed`. Social **sign-up** therefore
  cannot work while Turnstile is configured. This is Phase 1's recorded null-token defect, which
  Phase 2 **SO-7** assigned to Slice 6; the login path was fixed, the signup path was not. The
  reconciliation's SO-7 row is corrected accordingly. Owner: **Slice 6b proper.**
- `/forgot-password`, `/account/setup`, `/account/suspended` remain 404.
- `scripts/verify-auth-security.mjs` is **not wired into the runner and its assertions are stale** —
  three of them still assert "Ovalball remains passwordless", which Slice 6 deliberately overturned.
  Wiring it as-is would fail the build. Its Turnstile boundary assertions all pass. Owner:
  **test/perimeter closure.**

## Production verification plan

No migration, no database mutation, no Auth configuration change, no MFA change. After deploy,
read-only: expected build live; Turnstile still enabled; ledger still 520 / `20270429000000`; Full
Site Admin still `active / SITE_FULL`; MFA still T0 with zero enforcement; no unexpected auth events;
signed-out browser checks only. **The owner confirms the fix by signing in.**
