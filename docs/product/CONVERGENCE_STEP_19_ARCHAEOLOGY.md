# Convergence Step 19 — UX-8 Entrance Journeys: archaeology

From `f8bcb1c`. The handoff named `ea5e0f8`; Step 16's hardening was banked after it, and both are in
this history.

## 1. The canonical UX-8 scope exists, and it is specific

UX-8 is **not** a general instruction to improve onboarding. `docs/product/CONVERGENCE_STEP_0_MAP.md`
assigns *"UX-8 signup/claim/join entrance journeys"* to Step 19, and the definition is
`docs/product/OVALBALL_APPLICATION_SHELL_UX_AUDIT.md` **§15**, a journey audit ending in **seven
numbered proposals** (§15.6). That section is the contract; this handoff is its expansion.

§15.0 settles the security question before anything else, and it must not be re-litigated: the claimed
job title is **descriptive evidence and cannot grant authority**. `club_claims.claimed_role` is
constrained to seven values, `decide_club_claim` requires `site.claims.review`, granting a role
additionally requires `site.club_roles.manage`, and the reviewer chooses the roles. **Slice 5 secured
this underneath the old UI.** Step 19 is a UX defect repair on top of a sound floor.

### The blocker is cleared

§15.9 placed UX-8 after **6b.2b (SO-4, `auth_flow_states`)**, because that is the canonical carrier of
onboarding intent and building an intent fork on `ovalballSignupPayload` would build on the thing
6b.2c exists to retire. `public.auth_flow_states` **exists**. Proposal 6 additionally needed an
approval surface (Slice 8 / 7e); `app/(app)/club/join-requests/page.tsx`,
`list_pending_club_join_requests`, `approve_club_join_request` and `reject_club_join_request` all
**exist**. Both dependencies are satisfied.

## 2. The real entrances, as they exist

| | entrance | route | state |
|---|---|---|---|
| A | ordinary sign in | `/login` | CANONICAL |
| B | invitation link | `/join?token=` | CANONICAL — previews before auth |
| C | invitation human code | `/join?c=` | CANONICAL — same engine, same page |
| D | new account | `/signup` | CANONICAL but **fused with club onboarding** |
| E | club join (activated club) | `/signup` JOIN branch | CANONICAL |
| F | club claim (unactivated club) | `/signup` step 3, **entered automatically** | CANONICAL mechanism, **wrong door** |
| G | new club / directory request | `/signup` NEW CLUB branch | CANONICAL |
| H | guardian invitation | `/guardian-invite/[token]` | CANONICAL |
| I | Site Admin invitation | `/invite/site-admin/[token]` | CANONICAL |
| J | governing-body invitation | `/join?token=` → `BODY_ROLE_ACTIVE` | CANONICAL (Step 16) |
| K | password recovery | `/login` → recovery | CANONICAL |
| L | MFA continuation | `/security/verify` | CANONICAL, **and carries a defect** |
| M | public Club Home → join | `app/club/[slug]` | present; handoff quality is Step 19's |
| N | player **invitation** | `/player-invite/[token]` | CANONICAL — the optional Player-login acceptance, same preview-then-sign-in-then-accept pattern as the guardian route |
| O | safeguarding officer invitation | `/invite/safeguarding-officer/[token]` | CANONICAL — the separate 4G appointment process, deliberately not claimable |
| P | password recovery | `/forgot-password` | CANONICAL |
| Q | "my club invited me, what now?" | `/invited` | CANONICAL — a public explainer, linked from both `/signup` and `/login`, that points at the code box rather than containing one |
| — | team join code as a public entrance | — | **absent** (§15.4 row D) |
| — | player or guardian **self-service** join | — | **absent** (§15.4 row E, §15.6 proposal 6) |

**§36 classification.** Every route above is **CANONICAL**. `accept_invitation` and
`get_invitation_preview` are the one **COMPATIBILITY BRIDGE** and stay. **Nothing was found DEAD**:
`/invited` looked like a legacy duplicate of `/join` and is not one — it is linked from two live surfaces
and exists to tell somebody without an invitation that there is nothing here for them yet, which is a
better answer than a signup form. No entrance UI was removed, because none had been superseded.

`accept_invitation` and `get_invitation_preview` are the **L7 compatibility bridge** and are not
touched.

## 3. What is actually wrong

Measured in the repository and the running database, not inferred.

| | defect | canonical owner | risk |
|---|---|---|---|
| **D1** | **`BODY_ROLE_ACTIVE` is absent from the entrance destination map.** `app/join/join-panel.tsx` maps seven outcomes and falls back to `/dashboard`; Step 16 added an eighth and nobody added the row. A new Competitions Officer lands on a club dashboard — the exact thing §22 forbids. Worse, the governing **context is never set**: context resolves from the `ovalball_ctx` cookie, not the URL, so even navigating to the workspace would leave club navigation over body pages | UX-8 §22–§24 | **AMBER** |
| **D2** | **A pending request lands on `/dashboard`.** `JOIN_REQUEST_PENDING` and `PENDING_CONFIRMATION` both route there, which does not say pending. §16 is explicit: *"If pending, say pending."* | UX-8 §16, §24 | GREEN |
| **D3** | **Open redirect on the MFA continuation.** `app/security/verify/verify-flow.tsx:30` reads `next` straight off the query string into `window.location.assign`, with no `safeNextPath`. `lib/auth/safe-next.ts` fixed exactly this on the password path in Slice 5 and its own header warns *"two copies of an open-redirect guard is exactly how one of them drifts"* — this is a third consumer that never called it | UX-8 §8, §11 | **RED** |
| **D4** | **MFA discards the entrance intent.** `app/login/login-form.tsx:143` sends `result.needsMfa ? "/security/verify" : safeNextPath(next)` — the MFA branch drops `next`, so anyone whose account requires AAL2 is ejected from the invitation journey. §11 names this | UX-8 §11 | AMBER |
| **D5** | **`/signup` announces club onboarding to everyone.** `app/signup/steps/account-step.tsx:81` `<h1>` = *"Bring your club to Ovalball"*, and `step-imagery.ts` repeats it. There is no intent fork | §15.6 **#1** | GREEN |
| **D6** | **Claim is entered automatically.** `app/signup/steps/club-step.tsx:283` `setMode(result.claimed ? "join" : "claim")` — a database fact about the club decides which journey a person is in. Intent is never asked | §15.6 **#2** | GREEN |
| **D7** | **The claim offers fifteen roles where the database accepts seven.** `RolePicker` renders all of `CLUB_ROLES`; `club_claims_claimed_role_eligible` permits Club Chair / Chairman / Chairperson, Club Secretary, Fixture Secretary, Club Administrator, Director of Rugby, Committee Member, Treasurer. The other eight reach a graceful dead-end | §15.6 **#3** | GREEN |
| **D8** | **The one sentence that corrects the screen is last.** *"Submitting this request does not automatically grant control of the club"* sits after the role picker, the teams checklist and the declaration — below the fold on a phone, as §15.8 measured | §15.6 **#4** | GREEN |
| **D9** | **The invitation preview does not say what you would become.** `preview_invitation` returns `kind, scope_label, inviter_label, expires_at, state` — no role. §7's own example asks for *"Role: Fixture Secretary"* | UX-8 §7 | AMBER |

### Already done, not re-done

- §15.6 **#5** (teams wording) — `club-step.tsx:493` already reads *"Which teams does your club run?"*.
- §15.6 **#7** (claim-ineligible roles explained) — `ClaimAuthorityNotice` already does this.
- §8's open-redirect guard on the **password and OAuth** paths — `safeNextPath`, Slice 5.
- §14 failure states on `/join` — bad link, bad code and closed invitation are already distinguished.
- §28 first-landing / onboarding — **Step 6 owns it.** Not rebuilt.

## 4. Disposition

Implement **D1–D8**. D3 is the only security change and gets a focused proof plus a permanent static
guard, because the failure mode here is a fourth consumer drifting, not this one line.

**D9 deferred.** It needs a new column on `preview_invitation`, which is a drop-and-recreate of a public
RPC, and then a decision about who names a role: governing roles have a canonical label authority
(`lib/governing/roles.ts`, established in Step 15 as the one authority for those names) but club-staff
invitation roles are stored as `COACH` / `TEAM_MANAGER` with no label authority anywhere. Inventing a
second naming authority to fill one preview line is the wrong trade, and §7 asks for the preview "where
safe" rather than unconditionally. The preview already names the club or organisation and who invited
them, which is what makes the link trustworthy. Recorded as debt.

**Out of scope, deliberately:** §15.6 **#6** (a full player/guardian self-service join entrance) is a
product journey of its own, not an entrance-coherence repair, and rows **N** and **O** above stay
absent. Recorded as debt rather than half-built.

**FUNCTIONS BEFORE: 16** (the entrances in §2 that exist). Reconciled in
`STEP_19_ENTRANCE_JOURNEY_MATRIX.md`.

## 5. FUNCTIONS AFTER

**FUNCTIONS BEFORE 16 · FUNCTIONS AFTER 17 · FUNCTIONALITY LOST 0.**

The seventeenth is the unclaimed-club fork: a screen that did not exist, because the product used to make
that decision silently. Nothing was removed — the claim journey, the join branch, the directory request,
all six invitation routes, sign-in, recovery, MFA, the invited-explainer and the public club home all
still work, and the JOIN branch
still offers all fifteen club roles because its Club Admin decides who is what.

One function was **restored rather than added**: accepting a governing-body invitation. It existed in the
database from Step 16 and did not work through the product, so it is counted as a defect fixed rather
than a function gained.
