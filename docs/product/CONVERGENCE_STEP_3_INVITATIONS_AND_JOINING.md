# Convergence Step 3 — Invitations & Joining

**Scope:** the product closure over the canonical Slice 5 invitation/joining
architecture. **Status:** built, tested, banked. **Not released.** Step 4 not
started.

Slice 5 is not replaced, extended or worked around. No new invitation table, no
second token model, no second role-grant path, no client-authored intended
outcome, and **no migration**.

---

## 1. Archaeology — the whole joining system

### 1.1 Two complete invitation stacks were live

| | canonical (Slice 5) | legacy |
|---|---|---|
| record | `public.access_invitations` | `public.invitations` — **0 rows** |
| issue | `issue_invitation` | — |
| preview | `preview_invitation(token, code)` → `anon`, `authenticated` | `get_invitation_preview(token)` → **`anon`**, `authenticated` |
| redeem | `redeem_invitation(token, code)` | `accept_invitation(token)` → `authenticated` |
| resend | `resend_invitation` | — |
| revoke | `revoke_invitation` | direct `UPDATE` |
| UI | `/join` | `/invite/[token]` |

The legacy stack was **granted and callable**. `accept_invitation` writes
`club_memberships`, `invitation_teams`, `access_review_items` and
`notifications` — a second role-grant path, exactly what this programme forbids.
It could not actually grant anything because its table has been empty since
Slice 5, but "the table is empty" is not an authorisation boundary.

### 1.2 The canonical stack was largely unreachable

Everything below already existed, was granted, and had no way for a person to
use it:

| capability | state before Step 3 |
|---|---|
| human invitation code | generated, HMAC'd, **discarded at issue** — `createInvitation` ignored `data.code` |
| `resend_invitation` | fully implemented, rotates both secrets, **no button anywhere** |
| `preview_invitation` by **code** | supported since Slice 5; `/join` passed `p_code: undefined` and declared a `c` search param it never read |
| share link | printed as a bare `<code>` under an apology about development email |
| QR | did not exist |
| team join code | issued a code; the token `issue_invitation` returned alongside it was discarded, so a code could be read aloud but never linked or scanned |

### 1.3 Path inventory

| path | issuer | entry | canonical record | outcome | auth | redemption | terminal states |
|---|---|---|---|---|---|---|---|
| **CLUB_STAFF** | `people.invitation.create` | link · code · QR | `access_invitations` | club role + per-team roles in `intended_outcome` | email-bound, session required | canonical | Accepted · Revoked · Expired |
| **TEAM_JOIN_CODE** | `team.join_code.manage` | code · link · QR | `access_invitations` | a **request**, never access | session required | canonical | as above |
| **GUARDIAN** | `family.invitation.create` | link | `access_invitations` | guardian relationship | email-bound | canonical | as above |
| **PLAYER_ACCOUNT** | `player.account.invite` | link | `access_invitations` | player account | email-bound | canonical | as above |
| **SAFEGUARDING_OFFICER** | `safeguarding.officer.nominate` | link | `access_invitations` | membership → **PENDING_CONFIRMATION**, never active SO | email-bound | canonical | as above |
| **SITE_ADMIN** | `site.admins.manage` | link | `access_invitations` | site admin | email-bound | canonical | as above |
| **ACCOUNT_SETUP / CLUB_REFERRAL** | site / `club.referrals.manage` | link | `access_invitations` | account · club referral | email-bound | canonical | as above |
| **club join request** | the person asking | `/people` queue | `club_join_requests` | membership on approval | — | `decide_club_join_request` | approved · declined |
| **player join request** | guardian | `/club/join-requests` | `player_club_join_requests` | squad placement on approval | — | `approve_player_club_join_request` | approved · declined |
| **club claim** | claimant | `/claims` | `club_claims` | reviewed grant, never automatic Club Admin | — | `decide_club_claim` | approved · rejected |

Lifetimes come from one place, `internal.invitation_kind_spec`: 72 hours for
SITE_ADMIN and ACCOUNT_SETUP, 7 days for CLUB_STAFF, 14 for
SAFEGUARDING_OFFICER, GUARDIAN, PLAYER_ACCOUNT and CLUB_REFERRAL, 30 for
TEAM_JOIN_CODE.

---

## 2. Canonical end-to-end architecture

```
issue_invitation ── access_invitations ──┬── club_invitation email → /join?t=…
   (server-authored intended_outcome)    │
   returns token + code ONCE             ├── link      /join?t=<token>   ─┐
   stores only sha256(token), hmac(code) ├── code      /join?c=<code>    ─┼→ preview_invitation
                                         └── QR of the link              ─┘        │
                                                                                   ▼
                                                              redeem_invitation (one transaction)
                                                                                   │
                                            membership · team roles · family link · SO nomination
```

**One authority, three ways to hand it over.** The QR encodes the link; the link
and the code resolve to the same row. There is exactly one share URL shape.

---

## 3. L1 — disposition

**Option A: deleted as genuinely dead legacy code.**

`lib/email/recipients.ts` had a `club_invitation` **RecipientRef** branch reading
`public.invitations`. Proof before deletion:

- **zero constructors** — nothing anywhere builds `{ kind: "club_invitation" }`;
- the live sender, `createInvitation`, uses the `access_invitation` branch, which
  reads `access_invitations` correctly;
- the `club_invitation` **event key** is a different field, is live, and is
  untouched;
- its template already links to the canonical `/join?t=…`.

Chain proven end to end: **ISSUE** `issue_invitation` → **EMAIL** `club_invitation`
→ **LINK/CODE** `/join?t=` or `/join?c=` → **PREVIEW** `preview_invitation` →
**REDEEM** canonical redemption → **STATE CHANGE** on `access_invitations`.
**No email path can resurrect `public.invitations`:** no application code reads
that table at all any more.

---

## 4. Legacy retired, and what is deliberately left

**Retired now (application):** `app/invite/[token]/` — the legacy staff accept
route, its `get_invitation_preview` call and its `accept_invitation` button.
Evidence: no link anywhere in the app, no email template, and its table empty
since Slice 5.

**Deliberately NOT dropped yet (database): `accept_invitation` and
`get_invitation_preview`.** Expand → deploy → contract. The currently deployed
application still contains the route that calls them; revoking or dropping them
in the same change would strand it between schema states. The **contract step**
is: revoke EXECUTE from `anon` and `authenticated`, then drop both functions,
**in the release after this one deploys**. Recorded as ledger **L7**.

`public.invitations` itself is **retained**. It holds no rows, but dropping a
table is not required to end its authority, and the programme rule is not to
delete historical structures merely because the live path is obsolete.

---

## 5–8. What was built

**Issue result (§4).** `InvitationShare` — the link, the human code, a QR of the
link, what accepting it grants, the expiry, and the fact that **this is the only
time either secret can be shown**, because only hashes are stored. Nothing
reconstructs them, and the product says so rather than letting somebody close the
panel and come back for it.

**Copy link (§5).** A real button with a copied state, keyboard usable, beside a
readonly selectable input as the fallback when a browser refuses the clipboard.
The link is the canonical redemption route and there is no second URL shape.

**Human code (§6).** Surfaced at issue, and now a first-class way in: `/join?c=`
previews before anything is accepted, publicly, so somebody read a code down the
phone sees which club it is for. Case and dashes are normalised **by the
database**. A code matching nothing previews nothing — no error shape to probe.

**QR (§7).** Rendered **server-side** as an SVG of the same link, so no QR
library reaches the browser bundle. Hidden from assistive technology with the
meaning in a caption, shown behind a toggle, and never the only way to do
anything. One dependency added (`qrcode` + types) after confirming none existed.

**Resend (§8).** `resend_invitation` already defined the semantics and Step 3 did
not invent any: it **rotates both secrets**, so the previous link and code stop
working the moment it returns — which makes it the remedy for an invitation sent
to the wrong address, not merely for one that was lost. Intended outcome and
audit lineage survive; expiry refreshes from the kind's lifetime; `resend_count`
and `last_sent_at` are recorded and a security event is emitted. It refuses
anything not still ISSUED. The UI says the old ones no longer work.

---

## 9–11. Revoke · status · team join codes

**Revoke** targets the canonical row through `revoke_invitation`, requires
authority, records who and why, invalidates future redemption, and **refuses** a
second revoke rather than reporting success — pinned rather than assumed.

**Status** is the canonical lifecycle, worded: stored `state` for REDEEMED /
REVOKED / EXPIRED, and expiry and exhaustion derived from the row exactly as
`preview_invitation` derives them for the recipient, so the club and the person
holding the link are never told different things. Rows show recipient, outcome,
issuer, issued date, expiry and resend count. **No token or code is shown after
issue.**

**Team join codes** keep every existing behaviour and gain the same panel. The
model is unchanged and was verified: possession grants nothing — redemption
produces a **request** for somebody at the club to decide.

---

## 12–16. Requests, safeguarding, age

Club join requests and player join requests keep their canonical paths and their
separation; Step 2's Users & Permissions remains the administrative home and no
separate "Invitation Admin" product was built. The claim rules are untouched: a
claimed title stays descriptive, and approval is not automatic Club Admin.

**Safeguarding Officer** is unchanged and re-proved: an invitation never creates
active SO authority — it produces membership, then the same 4G nomination,
PENDING_CONFIRMATION, zero authority, AN-6, ACTIVE. Step 2's presentation of
PENDING_CONFIRMATION is intact.

**Age eligibility** (D-S5-1 Option B) is untouched: `person_is_established_adult`
gates MINOR_PROHIBITED outcomes, missing DOB is not eligible, and ordinary
non-sensitive joining does not require a DOB.

---

## 17. Zero functionality loss

| function | before | after | status |
|---|---|---|---|
| Invite someone (club role + per-team roles) | `/people` | unchanged, plus a usable result | **IMPROVED** |
| Multi-team CLUB_STAFF outcome | `intended_outcome.teams` | untouched, asserted | **PRESERVED** |
| Invitation link | bare `<code>` | link + Copy + QR | **IMPROVED** |
| Human invitation code | discarded at issue | shown once, explained | **IMPROVED** |
| Accept by link | `/join?t=` | unchanged | **PRESERVED** |
| Accept by code | typed, redeemed blind | previewed first | **IMPROVED** |
| Pending invitations list | Step 2 | plus issuer, issued date, resend count, canonical status | **IMPROVED** |
| Revoke | Step 2 | unchanged, repeat-revoke pinned | **PRESERVED** |
| Resend | **absent from the product** | reissue with rotation | **IMPROVED** |
| Team join code create/revoke/list | `/teams/[teamId]` | unchanged, plus link and QR | **IMPROVED** |
| Club join request approve/decline | `/people` | unchanged | **PRESERVED** |
| Player join request | `/club/join-requests` | unchanged | **PRESERVED** |
| Guardian / player-account / SO / site-admin invitations | own routes | unchanged | **PRESERVED** |
| Legacy `/invite/[token]` accept | dead route over an empty table | removed | **approved removal** (§4) |

**FUNCTIONS LOST: 0**

---

## 18. Deliberately retained for later steps

- **Site Admin invitation semantics** — converged in presentation only. 7e master
  control, AAL2-sensitive grants, two-admin grants and impersonation stay with
  the later auth slices.
- **Password, TOTP, recovery codes, social providers, session hardening** —
  Identity/Auth Slice 6+.
- **Family product** — Step 9. Step 3 made the request lifecycle coherent and
  rebuilt nothing.
- **UX-8 entrance journeys** — `/join` accepts the canonical mechanisms; the
  entrance redesign is not started. `auth_flow_states` untouched.
- **`accept_invitation` / `get_invitation_preview` drop** — ledger L7, the
  contract half of expand→contract.

---

## 19. Dependencies

Two additions, both after checking what was already present.

- **`qrcode` + `@types/qrcode`** — there was no QR capability of any kind in 19
  dependencies. Used **server-side only**, producing an inline SVG, so nothing
  reaches the browser bundle. Writing a QR encoder by hand was rejected: a subtly
  wrong Reed-Solomon implementation produces a code that scans to the wrong URL.
- **`playwright-core` — restored, and now declared.** It was present in
  `node_modules` but in neither `dependencies` nor `devDependencies`, so the
  first `npm install` of this step pruned it as extraneous and every browser gate
  stopped running. It is now a devDependency, which is what it always should have
  been: the browser gates are part of `run-platform-tests.sh` and a test
  dependency that only exists by accident is not reproducible. No browser binary
  was downloaded or changed.

---

## 20. DEFERRED MANUAL REVIEW CHECKPOINT

Real-browser UAT was performed throughout in isolated Playwright contexts —
**69-invitations-and-joining 33/33**, plus 30 mobile and accessibility
assertions at 1440, 390 and 320. Nothing below is unverified; it is what benefits
from a human eye.

**Personas and logins:** unchanged, from the canonical directory
`docs/product/STEP_2_MANUAL_REVIEW_WALKTHROUGH.md`. No new logins were created.
The review world is untouched — the three differences from its built baseline are
the owner's own earlier Chrome work and were deliberately left alone.

### Surfaces worth a look

| surface | why |
|---|---|
| `/people` → **Invite someone** → send | The new share panel: link, code, QR, outcome, expiry, and the "only time" warning. This is the biggest visual change in the step. |
| `/people` → a waiting invitation | Provenance line, canonical status, **Resend** beside Revoke. |
| **Resend** on that invitation | The reissue panel, and whether *"The link and code they were sent before no longer work"* lands hard enough. |
| `/join` signed out, with `?c=<code>` | What somebody read a code down the phone actually sees. |
| `/teams/[team]` → **Team Join Code** | The same panel as every other invitation — the coherence claim, made visible. |

### Product decisions that particularly want a human judgement

1. **"Copy what you need now."** The code genuinely cannot be shown again. The
   panel says so in one sentence at the bottom. Is that prominent enough, or
   should it be the first thing rather than the last?
2. **Resend rotates.** It is the correct and only possible security semantics,
   and it is also surprising — "resend" normally means "send the same thing
   again". The wording that carries this is *"The link and code they were sent
   before no longer work."* Is that enough for a volunteer who just wanted to
   nudge somebody?
3. **QR behind a toggle.** It is hidden until asked for, so the panel stays short
   on a phone. Should it be open by default on a club's own screen?
4. **A team join code now has a link.** Previously code-only. A link in a group
   chat is how these actually travel, and possession still grants nothing — but
   it is a genuine widening of how easily the code spreads, and that is a product
   call rather than a technical one.
