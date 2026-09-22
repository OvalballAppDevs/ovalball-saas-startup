# Ovalball Mobile — Entrance Completeness Audit

Forgot Password was missed, so every other way into and out of the app was checked the same way:
**is there a path, and what happens if a person takes it?**

| journey | state | what happens today |
|---|---|---|
| **Sign in** | ✅ **complete** | Email and password, the platform's actual flow. Refusal is undifferentiated |
| **Forgot password** | ✅ **complete** (this pass) | Link → app → set password → sign in. 25 assertions |
| **MFA / AAL2** | ✅ **complete** | `listFactors → challenge → verify`; fails closed if assurance cannot be established; the only ways out are forward or sign out |
| **Sign out** | ✅ **complete** | Clears the session and the selected context; proved that neither survives on the device |
| **Expired / invalid session** | ✅ **complete** | The auth listener drops to `signed-out` and the gate routes to sign-in. A refresh that fails mid-session is the same path |
| **Network failure** | ✅ **complete** | The app stays on screen, the read fails into a product state with Try Again, and recovers without a restart |
| **Recovery link expired / used / malformed** | ✅ **complete** | One message for every reason, and a way to ask for another |
| **No account / cannot sign in at all** | ⚠️ **web** | "Create an account" and "Join a club" are on the website, said plainly on the sign-in screen. Not a dead end — a signpost |
| **Social sign-in** | ⚠️ **deferred, correctly** | Google, Apple and Facebook exist in `lib/auth/oauth-providers.ts` and **all three are switched off**. No button is drawn, because a button whose provider is not configured sends a real person into a provider error page |
| **Invitation / join deep link** | ⚠️ **deferred, and now honest about it** | `resolveIntent` recognises `/join` and `/invitation` and returns `NOT_YET_SUPPORTED` rather than `UNKNOWN`, so the app knows the difference between "ours, not built" and "not ours". The journeys belong to M6 |
| **Account suspended / disabled** | ❌ **GAP — not handled** | See below |
| **Email change / verify** | ⚠️ **web** | Account settings are on the website |

## The one real gap found

**A suspended or disabled account has no mobile presentation.** `redeem_invitation` returns
`ORGANISATION_ACCESS_SUSPENDED` and the platform has the concept, but the mobile app has no branch for
it: an account that is suspended between launches would either sign in and find an empty product, or
see a generic failure. It is **not** in the same class as Forgot Password — there is no dead end,
because signing in still resolves — but it is a state the app cannot currently name.

Left for its own pass rather than guessed at here: what a suspended person should be told is a product
decision, and it needs the canonical suspension states read properly rather than a message invented to
fill a gap.

## Not dead ends, deliberately

Messages, People, Subscriptions, Notifications, club administration and Site Admin all say what they
will hold and open the website. That is a signpost, not a dead end, and it is the honest answer until
the milestone that owns each one arrives.
