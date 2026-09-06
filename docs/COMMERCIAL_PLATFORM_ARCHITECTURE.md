# Commercial Platform — Architecture and Phase A Audit

Ovalball's commercial and platform-control layer: invite-only onboarding,
Beta mode, release management, club trials, Ovalball SaaS subscriptions,
plans and referrals.

This document is the output of **Phase A** (audit before implementation) and
the standing architectural reference for the phases that follow. Written
6 September 2026 against the live schema, not against assumptions.

---

## 1. The finding that shapes everything: two "subscription" domains already collide

The brief calls for tables like `club_subscriptions` and capabilities like
`club.subscription.view`. **Both names are already taken**, and taken by the
opposite domain.

Existing, and belonging to clubs charging their MEMBERS:

| Existing table | Domain |
|---|---|
| `club_subscription_pricing` | A — club charges members |
| `club_subscription_programmes` | A |
| `club_subscription_sibling_rules` | A |
| `membership_obligations` | A |
| `payer_subscriptions`, `player_subscription_payers` | A |
| `gocardless_*` (9 tables) | A |

Existing capabilities, all Domain A:

```
club.subscription.configure
club.subscription.export
club.subscription.manage_enrolment
club.subscription.manage_payment_actions
club.subscription.view_finance
club.gocardless.connect
```

Adding `club_subscriptions` beside `club_subscription_pricing`, or
`club.subscription.view` beside `club.subscription.view_finance`, would put
the two payment domains one typo apart in every query, RLS policy and
capability check. Section 10 of the brief demands these domains never share
business logic; near-identical names are how that rule gets broken by
accident six months from now.

### Decision — Domain B gets its own namespace

Everything for **Ovalball charging clubs** is prefixed `platform_`:

| Concept | Table |
|---|---|
| Release history | `platform_releases` |
| Beta / mode transitions | `platform_mode_events` |
| Plans (Standard, Pro) | `platform_plans` |
| Plan entitlements | `platform_plan_entitlements` |
| A club's Ovalball subscription | `platform_club_subscriptions` |
| Subscription lifecycle events | `platform_subscription_events` |
| SaaS payments (Ovalball merchant) | `platform_payments` |
| Credit ledger | `platform_credits` |
| Trial state | `platform_trials` |
| Referrals | `platform_referrals` |
| Referral rewards | `platform_referral_rewards` |

Capabilities likewise:

```
site.system.beta.manage
site.system.release.manage
site.commercial.view
club.platform_billing.view
club.platform_billing.manage
club.referrals.view
club.referrals.manage
```

`club.platform_billing.*` rather than `club.subscription.*` — the prefix is
the whole point. Reading any policy or query, it is immediately obvious
which side of the wall you are on.

**Hard invariant, restated:** `platform_*` is Pipaxon collecting from rugby
clubs, through Ovalball's own GoCardless merchant. `gocardless_*` and
`club_subscription_*` are a club collecting from its own members, through
that club's connected merchant. No foreign keys, no shared webhooks, no
shared payment rows, ever.

---

## 2. What already exists and must be reused, not rebuilt

### Invitations — a canonical system already exists

| Table | Purpose |
|---|---|
| `invitations` + `invitation_teams` | **the** people-invitation system: `club_id`, `invited_email`, `declared_role`, `club_role`, `status`, `token`, `expires_at`, `accepted_by/at` |
| `guardian_invitations` | guardian → player linking |
| `player_account_invitations` | giving a young player their own login |
| `site_admin_invitations` | Site Admin onboarding |
| `club_ovalball_invitations` | inviting a club onto the platform |
| `club_claims`, `club_join_requests` | claim / request-to-join an existing club |

With RPCs `accept_invitation`, `accept_guardian_invitation`,
`accept_player_account_invitation`, `accept_site_admin_invitation`,
`get_invitation_preview` and friends.

**Phase B builds no new invitation system.** The work is reconciling the
public signup surface with what is already here, and confirming the
authority matrix is enforced server-side.

### Notifications — one normalized system

`public.notifications` with a `type` text column and ~25 existing values
(`fixture_request_received`, `club_claim_approved`, …). New commercial
topics are new `type` values on the same table. No second system.

### Scheduled jobs — a pattern already exists

`pg_cron` is installed and already runs three jobs, each calling a
`SECURITY DEFINER` function in the `internal` schema, scheduled from the
migration that defines it:

```
*/15 * * * *   select internal.process_due_season_transitions()
0 3 * * *      select internal.expire_due_dispensations()
*/15 * * * *   select internal.complete_overdue_fixtures()
```

Trial expiry, notification thresholds and billing runs follow this exact
pattern. No Vercel Cron, no page-load side effects, no new mechanism.

### Build identity — already solved

`lib/version.ts` exports `APP_VERSION` (from `package.json`, currently
`0.0.1`) and `APP_BUILD_SHA` (from `NEXT_PUBLIC_GIT_SHA`, captured at build
time in `next.config.ts`). Section 13 wants an immutable build identity
separate from an editable semantic version — that already exists and is
reused rather than replaced.

`package.json` is at `0.0.1`, which matches the brief's suggested first Beta
release, so no fabricated version history is needed.

### GoCardless client code — reusable, namespaced separately

`lib/payments/gocardless/` has proven client, webhook-signature,
idempotency, mapper and env-gating code. Domain B reuses the *transport*
(`client.ts`, signature verification, the two-flag production gate) but gets
its own connection identity, its own webhook route, and its own tables.
The mapper and reconciliation logic are Domain A's and stay there.

---

## 3. What is genuinely greenfield

- **All eleven commercial tables.** None exists.
- **Beta / system mode.** No concept of it anywhere.
- **Release history.** Only a version string; no record, no notes, no audit.
- **Referrals.** Nothing. Every apparent match in the codebase was an HTML
  `rel="noreferrer"`. Section 43's worry about fragmented referral stores
  does not apply — there is nothing to consolidate.
- **Trials.** No trial concept.
- **Plans / entitlements.** No plan records; no entitlement resolver.

---

## 4. Current public signup, and what Phase K must change

Today `/signup` is a four-step wizard: email → personal details → club →
review. Its club step already does the right thing and must be preserved
(section 79):

- existing unclaimed club → `club_claims`
- existing claimed club → `club_join_requests`
- club not in directory → `directory_requests` for Site Admin validation

Critically, **it already grants no authority**: `complete-signup.ts` inserts
a profile, consent rows and a *request*, and never touches
`club_memberships`, which has no self-serve INSERT policy. So the invite-only
invariant (sections 1–4) is already true at the data layer.

What is wrong is the *framing*: the wizard reads as generic self-service
account creation rather than "bring your club to Ovalball", and there is no
"already invited?" path on the public surface. Phase K is largely a
messaging and routing change, not an authority change.

---

## 5. Trial model

Thirty **usable** days, not thirty calendar days (sections 18–19). Beta
pauses consumption.

```
platform_trials
  club_id
  entitlement_seconds      default 30 days
  consumed_seconds         accrued, never derived from wall-clock alone
  accruing_since           null while paused
  started_at
  completed_at
```

Remaining time is `entitlement_seconds - consumed_seconds - (now -
accruing_since when accruing)`. Pausing sets `consumed_seconds +=
now - accruing_since` then nulls `accruing_since`. Resuming sets
`accruing_since = now`. Both operations are idempotent: pausing an
already-paused trial is a no-op because `accruing_since` is already null.

That is what makes section 18's example hold — 18 days remaining, ten days
of Beta, still 18 days remaining — and why `trial_end = start + 30 days`
was rejected.

---

## 6. Beta semantics

`platform_mode_events` is append-only; there is no mutable boolean. Current
mode is the latest event. Each row records `previous_mode`, `new_mode`,
`release_id`, `changed_by`, `changed_at`, `reason` (section 8).

Beta pauses **Ovalball charging clubs** and pauses trial consumption. It has
**no effect whatsoever** on clubs charging their members — that domain does
not read system mode at all, which is enforced by the namespace separation
above rather than by remembering to check.

No back-billing (section 85): Beta is paused time, not accrued debt.

---

## 7. Referral qualification

Reward is earned only on **first successfully confirmed Ovalball SaaS
payment** from a genuinely new club (section 38). Not a click, not a
registration, not a trial, not a mandate, not a submitted payment.

The credit ledger (section 70) is append-only rows, never a mutable
`free_months` counter, and the reward value is snapshotted at earning time
so later price changes cannot rewrite history (section 41).

---

## 8. Phase order

| Phase | Scope | State |
|---|---|---|
| A | Audit | **done — this document** |
| B | Invite-only onboarding reconciliation | pending |
| C | Release + Beta model | pending |
| D | Trial engine | pending |
| E | Plans + entitlements | pending |
| F | Club subscription domain | pending |
| G | Ovalball SaaS GoCardless | pending |
| H | Referral engine | pending |
| I | Site Admin UI | pending |
| J | Club Admin UI | pending |
| K | Public signup redesign | pending |
| L | Legal + notifications | pending |
| M | Tests + UAT | pending |

No production migration in this workstream until explicitly authorised
(section 60). No production SaaS collection until explicitly authorised
after sandbox UAT (sections 33, 110).

---

## 9. Open item inherited from the auth workstream

`policy_acknowledgements` is applied locally but not in production, so a
brand-new signup fails partway. It is unrelated to this workstream but sits
directly on the onboarding path Phase B and Phase K touch, so it should be
cleared first. See `docs/CHECKPOINT_AUTH_2026_09_06.md`.
