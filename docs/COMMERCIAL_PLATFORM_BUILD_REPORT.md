# Commercial Platform — Running Build Report

Appended as each phase completes. Architecture reference:
`docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md`.

---

## PHASE A — COMPLETE

### Architecture found, classified

| Existing object | Verdict | Why |
|---|---|---|
| `invitations` + `invitation_teams` | **REUSE** | Canonical people invitations: club_id, invited_email, declared_role, club_role, status, token, expiry, accepted_by/at. No second system. |
| `accept_invitation`, `get_invitation_preview` | **REUSE** | Server-authorised acceptance already exists. |
| `guardian_invitations` / `accept_guardian_invitation` | **REUSE** | Guardian→player linking. |
| `player_account_invitations` | **REUSE** | Young-player logins. |
| `site_admin_invitations` | **REUSE** | Site Admin onboarding. |
| `club_ovalball_invitations` | **REUSE** | Inviting a club onto the platform — the club-first acquisition path. |
| `club_claims`, `club_join_requests`, `directory_requests` | **REUSE** | Claim / join / propose. Already the correct three-way split (§79). |
| `/signup` 4-step wizard | **EXTEND** (Phase K) | Authority model already correct; framing is wrong. Messaging + routing only. |
| `add_child_for_guardian` | **EXTEND** (Phase B) | See security note below. |
| `players`, `guardians`, `player_team_memberships` | **DO NOT TOUCH** | Canonical Side Project 1 identity model. |
| `club_memberships` | **DO NOT TOUCH** | No self-serve INSERT policy — the reason invite-only already holds. |
| `capabilities` (47 rows) | **EXTEND** | Add `site.system.*`, `site.commercial.view`, `club.platform_billing.*`, `club.referrals.*`. |
| `club.subscription.*` capabilities (5) | **KEEP SEPARATE** | Domain A. Never reused for Ovalball billing. |
| `notifications` | **EXTEND** | Add commercial `type` values. One system. |
| `audit_log` (+ `internal.audit_row_change`) | **REUSE** | table_name/record_id/action/changed_by/changed_at/before/after. Attach to every new commercial table. |
| `pg_cron` + `internal.*` jobs (3 live) | **REUSE** | Established pattern for trial expiry / billing runs. |
| `lib/version.ts` (`APP_VERSION`, `APP_BUILD_SHA`) | **REUSE** | §13 immutable build identity already solved. |
| `gocardless_*` (9 tables), `membership_obligations`, `payer_subscriptions` | **KEEP SEPARATE** | Domain A. |
| `club_subscription_pricing/programmes/sibling_rules` | **KEEP SEPARATE** | Domain A despite the name. |
| Club Finance dashboard | **DO NOT TOUCH** | Domain A UI. |
| `lib/payments/gocardless/client.ts`, webhook signature, env gate | **REUSE (transport only)** | Namespaced separately for Domain B. |
| `lib/payments/gocardless/mapper.ts`, `reconcile.ts` | **KEEP SEPARATE** | Domain A semantics. |
| `partner_requests` | **EXTEND** (Phase H) | Natural home for the "Refer a club" CTA (§44). No referral fields today. |
| Legal pages (Terms/Privacy/Subprocessors/Cookies) | **EXTEND** (Phase L) | Add SaaS billing, trial, Beta, referral terms. |
| Social auth / OTP | **DO NOT TOUCH** | §82. Passwordless model unchanged. |

### Greenfield — nothing exists

All 11 commercial tables; Beta/system mode; release history; trials; plans;
entitlements; referrals. Every apparent "referral" hit in the codebase was
an HTML `rel="noreferrer"`, so §43 has nothing to consolidate.

### Two design corrections the audit forced

**1. Namespace collision.** `club_subscriptions` and `club.subscription.view`
from the brief are already taken by Domain A. Domain B therefore uses
`platform_*` tables and `club.platform_billing.*` capabilities. Full
reasoning in the architecture doc.

**2. Less to build than assumed.** Invitations, notifications, jobs, audit
and build identity all already exist and are reused rather than rebuilt.

### Security note carried into Phase B

`public.add_child_for_guardian` is `security definer`, granted to
`authenticated`, and guards only on "signed in" plus "club exists and is
active". It then creates a `players` row, a `guardians` row, and a
`player_team_memberships` row at **any active club**, with no invitation and
no existing relationship to that club.

Mitigating: the team membership is inserted as **`pending`**, so no team or
fixture authority is self-granted, and unmatched cases route to
`player_duplicate_reviews` / `created_needs_club_review` for club review.

Still, an unrelated signed-in person can create a player identity at an
arbitrary club and declare themselves its guardian. That is the exact case
§81 anticipates, and it is Phase B's main piece of work — not a blocker.

### Effect on later phases

- Phase B is narrower than expected: verification plus the Add Child guard.
- Phase K is messaging/routing, not an authority change.
- Phases D and G inherit a working job pattern and a working provider
  transport, so both are smaller than the brief implies.
- Phase F must not name anything `club_subscription*`.

### Unresolved, inherited

`policy_acknowledgements` exists locally but not in production, so a
brand-new signup fails partway. Unrelated to this workstream but sits on the
onboarding path Phases B and K touch. Not blocking local work.

### Files

`docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md` (new), this report (new).
No code or schema changed in Phase A.

---

## PHASE B — COMPLETE

Invite-only onboarding. The invariant being defended: **authentication never
grants a club or team relationship.**

### Audit first

Most of the invariant already held, and the audit is why Phase B is small:

- `club_memberships` has no self-serve INSERT policy, so signing in cannot
  produce club membership.
- `/signup` writes a profile, consent rows and a *request*
  (`club_claims` / `club_join_requests` / `directory_requests`) — never a
  membership.
- Six invitation systems already exist with server-authorised acceptance
  RPCs. None was rebuilt.

One real hole, carried over from the Phase A security note.

### The hole, and the fix

`public.add_child_for_guardian` is `security definer`, granted to
`authenticated`, and guarded only on "signed in" and "club exists and is
active". Any signed-in person could therefore create a player identity at
**any** active club and declare themselves its guardian.

`supabase/migrations/20260930100000_invite_only_add_child_guard.sql`
reproduces the function verbatim and adds an authority guard ahead of every
write. The caller must have one of:

1. an accepted `guardian_invitations` row for that club,
2. an existing `guardians` → `player_team_memberships` → `teams.club_id`
   relationship at that club, or
3. an active `club_memberships` row at that club.

Otherwise: *"You need an invitation from this club before you can add a child
to it."* Nothing else in the function changed — the team membership is still
inserted as `pending`, and duplicate routing to `player_duplicate_reviews`
is untouched.

Condition 2 is what keeps the change non-disruptive: a guardian already
known to the club keeps working, with no re-invitation.

### Verification

`supabase/tests/invite_only_onboarding.sql`, run against the local Docker
database. Six assertions, all PASS:

| # | Assertion | Result |
|---|---|---|
| 1 | A stranger cannot add a child at a club | PASS — rejected with the invitation message |
| 2 | An accepted guardian invitation grants the context | PASS |
| 3 | A club A invitation does **not** unlock club B | PASS |
| 4 | An existing guardian can still add a second child | PASS — not disrupted |
| 5 | Self-service add-child never yields an **active** team membership | PASS |
| 6 | `club_memberships` still has no self-grant INSERT policy | PASS |

Run with:

```bash
docker exec -i supabase_db_ovalball-saas-startup \
  psql -U postgres -d postgres -f - < supabase/tests/invite_only_onboarding.sql
```

The script is wrapped in `begin` / `rollback`, so it leaves no fixtures
behind.

### Not applied to production

The migration is applied **locally only**, per the standing instruction that
no production migration happens in this workstream without explicit
authorisation. It queues behind the already-outstanding
`policy_acknowledgements` migration.

### Files

- `supabase/migrations/20260930100000_invite_only_add_child_guard.sql` (new)
- `supabase/tests/invite_only_onboarding.sql` (new)

No application code changed. Phase K handles the signup surface's framing.

---

## PHASE C — COMPLETE

Release history and platform mode. Two ideas kept deliberately apart:

- A **release** records that a version shipped, with notes people read. It
  is editable, because notes get corrected.
- The **platform mode** (`beta` / `live`) decides whether Ovalball charges
  clubs at all. Its history is **append-only**, because "when did Beta end"
  is a question that decides money.

### Capabilities

Two new delegation flags on `site_admins`, three capabilities:

| Capability | Flag |
|---|---|
| `site.system.release.manage` | `manage_system` |
| `site.system.beta.manage` | `manage_system` |
| `site.commercial.view` | `view_commercial` |

Two flags rather than three: recording a release and flipping Beta are the
same operational act by the same person on the same day. Reading commercial
data is a different concern — it is money, and it is readable without being
able to change anything — so it keeps its own flag.
`internal.has_site_role_capability` gains three branches; every existing
branch is carried over verbatim. Grant/revoke RPCs
`set_site_admin_system_capability` and `set_site_admin_commercial_capability`
mirror `set_site_admin_seasons_capability` exactly, notification included.

### `platform_releases`

`version`, `build_sha` (the immutable identity from `lib/version.ts`),
`channel`, `title`, `notes`, `status`, `released_at/by`. Unique on
`(channel, version)`. Published releases are readable by anyone — the notes
are written for users; drafts are Site Admin only, which is the point of a
draft. Writes gated by `site.system.release.manage`. **No DELETE policy**:
release history is not tidied away.

### `platform_mode_events`

Append-only, and enforced three ways rather than trusted:

1. No UPDATE or DELETE policy.
2. A `BEFORE UPDATE OR DELETE` trigger that raises — the real guard, because
   a `SECURITY DEFINER` function bypasses RLS entirely.
3. `previous_mode` is **derived by a trigger from the existing history**,
   never accepted from the caller, so a direct client INSERT cannot claim a
   transition that did not happen.

A partial unique index allows exactly one genesis row. The table is Site
Admin only because `reason` is internal record-keeping; everyone else reads
the mode through `public.current_platform_mode()`, which returns the mode
and when it started, and nothing else.

**Ordering is by `seq`, not `changed_at`.** `now()` is transaction time, so
two events written in one transaction carry an identical timestamp and
"current mode" would be decided by a tie-break on a random uuid. The test
suite caught this. `seq bigint generated always as identity` fixed it.

### Genesis

One seeded event: mode `beta`, `changed_by` null, with a reason recording
that Ovalball was already operating in Beta — invite-only, no billing
enabled — when the model was introduced. Nothing invented; the history
answers "was the platform charging on date X" from day one rather than
opening with a gap.

### Application surface

`lib/platform/mode.ts` — `getPlatformMode()` / `isBeta()`. It fails to
`beta` when the mode cannot be read, because Beta is the mode that does not
bill: a database blip must never be the reason a club gets charged.

### Verification

`supabase/tests/platform_release_and_mode.sql`, 12 assertions, all PASS:

| # | Assertion |
|---|---|
| 1 | Mode reads as `beta` from the genesis event |
| 2 | A non-admin cannot change the mode |
| 3 | A non-admin cannot record a release |
| 4 | `beta → live` records, `previous_mode` derived as `beta` |
| 5 | Setting the current mode again records nothing and returns null |
| 6 | Mode history cannot be UPDATEd |
| 7 | Mode history cannot be DELETEd |
| 8 | A forged `previous_mode` is overwritten by the derived value |
| 9 | Exactly one genesis event can exist |
| 10 | A recorded release starts as a draft |
| 11 | No club-charges-members function references `platform_` |
| 12 | Platform mode never reads the club-charges-members domain |

Assertions 11 and 12 are the standing wall between the two payment domains,
checked against `pg_get_functiondef` rather than against intent.

```bash
docker exec -i supabase_db_ovalball-saas-startup \
  psql -U postgres -d postgres -f - < supabase/tests/platform_release_and_mode.sql
```

`npm run typecheck` and `eslint` clean. `types/database.types.ts`
regenerated from the local database: 119 additions, **0 deletions**.

### Not applied to production

Local only, same as Phase B.

### Files

- `supabase/migrations/20261001000000_platform_release_and_mode.sql` (new)
- `supabase/tests/platform_release_and_mode.sql` (new)
- `lib/platform/mode.ts` (new)
- `types/database.types.ts` (regenerated)

Phase I builds the Site Admin surface for both. Phase D attaches trial
pause/resume to `set_platform_mode`.

---

## PHASE D — COMPLETE

The trial engine. Thirty **usable** days, not thirty calendar days.

### Why the obvious model was rejected

`trial_ends_at = started_at + 30 days` cannot express any of this, because
wall-clock time passes whether or not a club can use the product. A club
that spends ten days of its trial inside a Beta period would silently lose
them.

`platform_trials` therefore stores an entitlement, an accrued consumption,
and a mark of when the current accrual started:

```
remaining = entitlement_seconds
          - consumed_seconds
          - (now() - accruing_since, when accruing)
```

Pausing folds the open interval into `consumed_seconds` and clears
`accruing_since`; resuming sets it again. Both are idempotent by
construction — pausing an already-paused trial finds `accruing_since`
already null and has nothing to fold in — which is what makes a retried
request or a double Beta transition harmless.

A `platform_trials_state_coherent` check constraint makes it impossible for
`status`, `accruing_since` and `pause_reason` to disagree about whether the
clock is running.

### The table takes no direct writes

`platform_trials` has a SELECT policy and **no INSERT, UPDATE or DELETE
policy at all**. Every transition goes through a function, so the accrual
arithmetic has exactly one implementation
(`internal.trial_remaining_seconds`). Assertion 15 checks this against
`pg_policy` rather than against intent.

### Beta

Entering Beta pauses every running trial with `pause_reason = 'beta'`.
Leaving Beta resumes **only** those — a trial the club or an admin paused
for their own reasons stays paused. A club cannot resume itself out of a
Beta pause: doing so would start charging time for a period Ovalball has
said it is not charging for. Beta is paused time, never accrued debt, so no
club is back-billed.

A trial started *during* Beta starts paused rather than immediately burning
days the club cannot use.

### Capabilities

| Capability | Held by |
|---|---|
| `club.platform_billing.view` | Club Admin (not Fixture Secretary, not members) |
| `club.platform_billing.manage` | Club Admin |
| `site.commercial.manage` | **Full Site Admin only — deliberately not delegable** |

`site.commercial.manage` exists because the first draft gated
`extend_club_trial` on `site.commercial.view`. A view capability must never
authorise a write, and extending a trial changes what a club owes. The new
branch in `internal.has_site_role_capability` returns `false`, so only the
`is_full_site_admin()` short-circuit above it can grant it.

### Notifications

A new `platform_billing` topic, **mandatory** like `account_security`: a
club being told its trial is about to end is not a marketing preference, it
decides whether the club keeps working next week. Types
`platform_trial_ending_soon` and `platform_trial_ended`. The two Phase C
access-change types were also registered against `account_security`
alongside their siblings.

### Scheduled work

`internal.process_due_trials()` on `*/15 * * * *`, following the three
existing `pg_cron` + `internal.*` jobs exactly, with
`public.run_trial_expiry_check()` for a Site Admin to run on demand.
Idempotent twice over: a completed trial no longer matches the status
filter, and a threshold already in `notified_thresholds` is never notified
again. Warnings at 14, 7, 3 and 1 days.

`pg_cron` is scheduled on the **local** database only; provisioning it on
the remote project is a deployment step for whoever operates it.

### Application surface

`lib/platform/trial.ts` — `getClubTrial()`, `trialDaysRemaining()`,
`isTrialRunning()`, `isPausedByBeta()`. Days remaining rounds **up**: a
trial with two hours left has one day left, not zero.

### Verification

`supabase/tests/platform_trials.sql`, 17 assertions, all PASS. The one that
matters most is assertion 4, which is the brief's own example:

> 1,555,200 seconds (18 days) remaining, ten days of Beta, **1,555,200
> seconds remaining**.

| # | Assertion |
|---|---|
| 1 | A trial started while Live is active, thirty days remaining |
| 2 | Starting again returns the same trial; no restart, no second row |
| 3 | Entering Beta pauses and folds twelve elapsed days into consumed time |
| 4 | Ten days of Beta cost the club nothing |
| 5 | Pausing twice folds in nothing further |
| 6 | Leaving Beta does not resume a club's own pause |
| 7 | A club cannot resume out of a Beta pause |
| 8 | A trial started during Beta starts paused |
| 9 | An exhausted trial completes instead of resuming |
| 10 | The expiry engine completes the trial and notifies the Club Admin |
| 11 | A second expiry run completes nothing and sends nothing |
| 12 | A threshold warning is sent once, not on every run |
| 13 | `site.commercial.view` does not permit extending a trial |
| 14 | An extension revives a completed trial with exactly the extra time |
| 15 | `platform_trials` has no INSERT/UPDATE/DELETE policy |
| 16 | An unrelated account reads nothing about a club's trial |
| 17 | No trial or mode function reads the club-charges-members domain |

```bash
docker exec -i supabase_db_ovalball-saas-startup \
  psql -U postgres -d postgres -f - < supabase/tests/platform_trials.sql
```

`npm run typecheck` and `eslint` clean. `types/database.types.ts`
regenerated: additions only, **0 deletions**.

### Not applied to production

Local only, same as Phases B and C.

### Files

- `supabase/migrations/20261002000000_platform_trials.sql` (new)
- `supabase/tests/platform_trials.sql` (new)
- `lib/platform/trial.ts` (new)
- `types/database.types.ts` (regenerated)

---

## PHASE E — COMPLETE

Plans and entitlements.

### The two plans

| Plan | Price | Status | Purchasable |
|---|---|---|---|
| Standard | £15 / month | available | **yes** |
| Pro | £25 / month | coming_soon | **no** |

Prices are the brief's own (§23, §76), not invented. Pro is closed because
**no premium feature exists yet that Standard does not already include**,
and §25 is explicit that an empty tier must not be sold. Assertion 16
checks that claim against the data rather than against a comment: it fails
the moment Pro gains an entitlement Standard lacks, which is exactly when
the Coming Soon label would become wrong.

The rule is structural, not procedural. A check constraint,
`platform_plans_purchasable_only_when_available`, makes `purchasable = true`
impossible unless `status = 'available'`, so no code path can quietly open
Pro without also changing what it says it is.

### Price history

`price_version` is bumped by a trigger whenever `price_pence` or `currency`
changes, and only then. A commercial event can therefore snapshot
`(code, price_pence, currency, price_version)` and a later price change
cannot rewrite what a club was charged or what a referral reward was worth
(§41, §74).

### Entitlements

`platform_entitlements` is the registry of stable keys, seeded from what
Ovalball actually does today — audited against the live application, with
nothing aspirational in it (§24).

The registry carries a `gateable` flag, and this is the part worth
noticing. §24 says essential safety must never sit behind Pro. Rather than
trusting everyone to remember, four keys are marked non-gateable:

```
safety.safeguarding
safety.permissions
safety.audit
safety.data_rights
```

A non-gateable entitlement is granted to **every club, on every plan, and
on no plan at all**, and a trigger **refuses** any attempt to attach one to
a plan. Assertion 8 proves the refusal; assertion 10 proves a club with no
plan whatsoever still gets all four.

### The resolver

One function decides which plan a club is on:

```sql
internal.club_effective_plan(club_id)
```

Phase E resolves a running or paused trial to `standard`, and everyone else
to null. **Phase F re-declares this one function** to consult
`platform_club_subscriptions` first, and every entitlement check in the
application picks the change up untouched. That is the whole reason §27
asked for a resolver rather than `if plan == "pro"` scattered through pages.

Features call `public.club_has_entitlement(club_id, key)`. The check is
server-side; `lib/platform/entitlements.ts` fails closed on error, because
an unreadable answer is not a grant (§72).

### Application surface

- `lib/platform/entitlements.ts` — typed keys, `getClubEntitlements()`,
  `clubHasEntitlement()`, and `requireEntitlement()` for the top of a
  server action, so the gate sits next to the work rather than next to the
  button that starts it.
- `lib/platform/plans.ts` — `getPlatformPlans()`, `formatPlanPrice()`.

### Verification

`supabase/tests/platform_plans_entitlements.sql`, 17 assertions, all PASS:

| # | Assertion |
|---|---|
| 1 | Standard is £15/month and Pro is £25/month, GBP, monthly |
| 2 | Pro is Coming Soon and not purchasable |
| 3 | A Coming Soon plan cannot be made purchasable |
| 4 | Pro opens correctly when its status is changed with it |
| 5 | A price change bumps `price_version` |
| 6 | Rewriting the same price does not bump it |
| 7 | A Club Admin cannot change Ovalball's plan terms |
| 8 | An essential entitlement cannot be attached to a plan |
| 9 | A club with neither trial nor subscription is on no plan |
| 10 | …but still has every essential entitlement |
| 11 | Safeguarding granted, a paid feature not |
| 12 | A club on trial resolves to Standard |
| 13 | A trial grants the core product and the essentials together |
| 14 | Pausing a trial does not switch the product off |
| 15 | An unregistered entitlement key is never granted |
| 16 | Pro includes nothing Standard does not |
| 17 | The resolver never reads the club-charges-members domain |

```bash
docker exec -i supabase_db_ovalball-saas-startup \
  psql -U postgres -d postgres -f - < supabase/tests/platform_plans_entitlements.sql
```

`npm run typecheck` and `eslint` clean. `types/database.types.ts`
regenerated: additions only, 0 deletions.

### Not applied to production

Local only.

### Files

- `supabase/migrations/20261003000000_platform_plans_entitlements.sql` (new)
- `supabase/tests/platform_plans_entitlements.sql` (new)
- `lib/platform/entitlements.ts` (new)
- `lib/platform/plans.ts` (new)
- `types/database.types.ts` (regenerated)

---

## PHASE F — COMPLETE

The club subscription domain. Four tables, no provider: Phase G attaches
GoCardless, and this phase is the domain it will report into, so the whole
lifecycle is testable before any money can move.

### Tables

| Table | Shape |
|---|---|
| `platform_club_subscriptions` | One per club. Plan, **snapshotted price**, status, period, next collection. |
| `platform_subscription_events` | Append-only lifecycle log, each event carrying the terms as they stood. |
| `platform_payments` | Ovalball's own collections. Gross / credit applied / net, with a unique `idempotency_key` per cycle. |
| `platform_credits` | Append-only ledger. Positive earns, negative spends or reverses. |

`platform_club_subscriptions` has a SELECT policy and **no INSERT, UPDATE or
DELETE policy** — same discipline as `platform_trials`.

### Price snapshots

The subscription stores `plan_price_pence`, `plan_currency` and
`plan_price_version` taken at selection, and nothing reads
`platform_plans.price_pence` to decide what to collect. Assertion 4 raises
the list price to £19 and confirms the club's agreed £15 is untouched.

### The credit ledger is a ledger, not a counter

There is no `free_months` column to decrement. A counter loses the answer to
"where did this come from" the moment it is wrong, and a reversal has
nowhere to live. Instead:

- Balance is `sum(amount_pence)` over the club's rows.
- A trigger refuses any negative row that would take the balance below zero
  — checked against the ledger, not a cached figure.
- A partial unique index allows **one application per payment** and **one
  reversal per credit**, so "exactly once" is a constraint rather than
  careful code.
- Earned rows carry `snapshot_plan_code / snapshot_price_pence /
  snapshot_price_version`, so a later price change cannot revalue a reward
  already earned (§41).

### A cycle worth nothing is skipped

`club_next_collection()` applies credit at calculation time and reports
`will_skip` when the net comes to zero. A £0.00 direct debit is a real bank
instruction: it confuses payers and costs provider fees for nothing (§71).

### Two judgement calls, stated plainly

**`past_due` still grants the product.** A failed payment is a dunning
conversation, not a reason to lock a club out of its own fixtures
mid-season. Assertion 8 pins this down so it cannot be changed silently.

**`cancelled` still grants the product.** Cancelling stops the next
collection; the club keeps the period it has already paid for. Only `ended`
withdraws access.

### The resolver, extended as promised

Phase E said `internal.club_effective_plan` would be the only function
needing a change. It was: it now prefers a subscription and falls back to a
trial, and every entitlement check in the application picked that up
without being touched.

`public.club_platform_billing_state()` is the canonical state resolver
(§89) — plan, subscription status, price, next collection, trial state,
credit balance and platform mode, in one row.

### Verification

`supabase/tests/platform_club_subscriptions.sql`, 21 assertions, all PASS.
Beyond the lifecycle and ledger cases, two structural ones:

- **20** — no `platform_*` function reads a Domain A table.
- **21** — no foreign key joins the two payment domains, checked against
  `pg_constraint`.

The three earlier suites were also tightened in this phase. They matched
Domain A on the bare substring `club_subscription`, which
`platform_club_subscriptions` legitimately contains; they now match Domain
A's actual table and function names. All three still pass in full (12, 17,
17).

```bash
docker exec -i supabase_db_ovalball-saas-startup \
  psql -U postgres -d postgres -f - < supabase/tests/platform_club_subscriptions.sql
```

`npm run typecheck` and `eslint` clean. Types regenerated: additions only.

### Not applied to production. No provider enabled.

Local only. No GoCardless credential, connection or webhook exists in this
phase.

### Files

- `supabase/migrations/20261004000000_platform_club_subscriptions.sql` (new)
- `supabase/tests/platform_club_subscriptions.sql` (new)
- `lib/platform/subscription.ts` (new)
- `supabase/tests/platform_release_and_mode.sql`,
  `platform_trials.sql`, `platform_plans_entitlements.sql` (tightened)
- `types/database.types.ts` (regenerated)

---

## PHASE G — COMPLETE (no provider enabled)

The provider side of Ovalball's own billing. **No credential exists, no
switch is on, and nothing can collect.**

### What is shared with the club-charges-members integration, and what is not

Shared: the HTTP transport (`gcRequest`) and the HMAC signature check.
Those are mechanics with no business meaning — a signed request is a signed
request — and duplicating them would mean two copies of security-critical
code to keep correct.

Separate: **the merchant token, the webhook endpoint, the event inbox, the
tables written, and the switch that permits any of it.** An event arriving
at `/api/platform-billing/webhooks` can only ever move Domain B state, and
one arriving at `/api/gocardless/webhooks` can only ever move Domain A
state. That is a property of the routing, not of remembering to check.

### Three gates before a penny moves

1. `GOCARDLESS_ENV` + `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` — the
   existing two-variable production gate.
2. `OVALBALL_SAAS_BILLING_ENABLED=true` — **this domain's own switch**, so
   a fully working Domain A configuration can never start Ovalball billing.
3. `GOCARDLESS_PLATFORM_ACCESS_TOKEN` and
   `GOCARDLESS_PLATFORM_WEBHOOK_SECRET` actually being set.

All three are unset everywhere. `.env.example` documents the names only.

### The state machine

`platform_provider_events` is Domain B's own inbox, unique on the
provider's event id — which is the entire replay defence. Every event is
recorded before any state moves, and a redelivery finds the row already
there and does nothing.

Nothing trusts a webhook body. It is a link and a verb; the real resource
is re-fetched and is authoritative for status and amount.

Four structural rules, each enforced rather than remembered:

- **A subscription cannot be `scheduled`, `active` or `past_due` without a
  mandate** — a check constraint, so billing cannot start on a hopeful
  assumption.
- **A sandbox subscription cannot be promoted to production**, or the
  reverse: the environment is recorded with the provider references and a
  mismatch is refused.
- **Terminal is terminal.** A confirmed, failed, cancelled or skipped
  payment cannot be walked backwards, and cannot be confirmed twice.
- **No cycle opens in Beta.** Refused at the source rather than opened and
  cancelled afterwards.

### A failed collection returns its credit

Credit consumed by a collection that then fails is given back as a
**reversal row**, not by deleting the application. The ledger is
append-only and "we took it and gave it back" is the true history.

This exposed a Phase F constraint that was wrong:
`platform_credits_reversal_is_negative` assumed every reversal removed
credit. That is only true of reversing an *earning*; reversing an
*application* returns credit and is positive. Replaced with
`platform_credits_reversal_needs_target`.

### Two defects this phase's own tests caught

**1. A naming violation I introduced in Phase F.** The Phase C
domain-separation assertion failed on `cancel_club_subscription` — a Domain
B function whose name reads as Domain A at every call site. Renamed to
`cancel_club_platform_subscription`, and `club_next_collection` to
`club_platform_next_collection` for the same reason. The naming rule
applies to functions, not only tables.

**2. A real security hole.** `revoke execute … from public` does **not**
remove Supabase's default-privilege grants, which give `EXECUTE` on every
new `public` function directly to `anon` and `authenticated`. Every one of
the five money-moving provider functions was therefore callable by any
signed-in user. Each revoke now names `public, anon, authenticated`, and
assertion 15 checks the resulting ACL rather than trusting that the revoke
did what it looked like it did.

The same pass locked six `internal` commercial helpers, which are
`SECURITY DEFINER` with no authorisation check of their own.
`internal.has_capability` and `internal.is_site_admin` were deliberately
**not** revoked: RLS evaluates them as the querying role, and revoking them
would break every policy in the product.

One earlier assertion was also wrong in its own right: `%gocardless_%` in
`LIKE` matches the literal string `'gocardless'`, because an unescaped
underscore is a wildcard. All four suites now escape it.

### Verification

`supabase/tests/platform_gocardless.sql`, 18 assertions, all PASS. Notable:

| # | Assertion |
|---|---|
| 1 | A subscription cannot be active without a mandate |
| 2 | A redelivered provider event is recorded once |
| 4 | A sandbox mandate cannot be promoted to production |
| 5 | No cycle can open while Ovalball is in Beta |
| 7 | Re-running a cycle returns the existing payment, never a second collection |
| 9 | A replayed confirmation records nothing further |
| 10 | A confirmed payment cannot be moved back to pending |
| 12 | A failed collection marks past due and returns the credit |
| 14 | A fully-credited cycle is recorded as skipped, never sent as zero |
| 15 | No provider state function is reachable from a browser session |
| 18 | The internal commercial helpers carry no grant to a browser role |

All five suites pass together: 12 + 17 + 17 + 21 + 18.
`npm run typecheck`, `eslint`, and `scripts/verify-auth-security.mjs`
(64 checks) clean.

### Provider status — stated plainly

**No sandbox UAT has been run.** No GoCardless credential exists for
Ovalball's own merchant, so nothing in this phase has been exercised
against the real provider. The verification above is of the state machine
the provider reports into, not of the provider. Phase M carries this as an
open gap, and it is the reason the final verdict cannot be an unqualified
one until sandbox UAT is done.

### Files

- `supabase/migrations/20261005000000_platform_gocardless.sql` (new)
- `supabase/tests/platform_gocardless.sql` (new)
- `lib/platform/gocardless/env.ts`, `lib/platform/gocardless/billing.ts` (new)
- `app/api/platform-billing/webhooks/route.ts` (new)
- `supabase/migrations/20261004000000_platform_club_subscriptions.sql` (function renames)
- `lib/platform/subscription.ts`, all four earlier test suites, `.env.example`
- `types/database.types.ts` (regenerated)

---

## PHASE H — COMPLETE

The referral engine.

> Refer another rugby club to Ovalball. If they start a paid subscription
> and their **first payment is successfully collected**, your club gets one
> month of its current plan free.

Everything difficult is in "first" and "successfully collected". Not a
click, not a registration, not a trial, not a mandate, not a submitted
payment.

### Two things deliberately not built

**No second invitation system.** §115 forbids one, and
`club_ovalball_invitations` already means "this club invited that club onto
Ovalball" — contact, token, expiry, status. A referral is the **commercial
claim layered on one of those**, joined by a unique `invitation_id`.

**No separate rewards table.** A reward *is* a credit-ledger row. "One
reward per referral" is a unique column (`reward_credit_id`) on the
referral, not a table whose only job would be to hold that constraint. The
architecture doc listed `platform_referral_rewards`; this is a deliberate
departure from it.

### Where qualification happens

In exactly one place: inside `apply_platform_payment_status`, on the
transition to `confirmed`. That function already returns early on an
already-terminal payment, so **a redelivered webhook cannot earn a second
reward** — the guard that makes payments idempotent makes rewards
idempotent too, rather than a second mechanism that has to agree with it.

Every condition is checked there:

- the payment must be the referred club's **first** confirmed payment,
  counted against the ledger of confirmed payments rather than inferred
  from the subscription's status;
- the referral must be `registered`;
- the referring club must still be active, so a folded club does not accrue
  credit it can never use;
- self-referral is refused, by a check constraint *and* at registration;
- a club that has already paid Ovalball cannot be referred at all.

A partial unique index allows **one qualified referral per referred club**,
so two clubs claiming the same introduction cannot both be paid.

### Value, fixed once

The reward is one month of the **referring** club's own plan, read once at
the moment of earning and written to both the referral and the credit row.
Assertion 11 raises Standard from £15 to £99 and confirms the earned reward
is still £15.

### Losing it

If the qualifying collection later fails or is charged back, the reward is
withdrawn as a **reversal row** — never by deleting the earning. The ledger
is append-only, and "earned, then withdrawn" is the true history. A repeat
delivery reverses once, not once per delivery.

### One privacy decision

The **referred** club cannot see the referral. Whether another club earns a
commission for introducing you is not your business, and surfacing it would
make the relationship awkward for no benefit. The RLS policy scopes reads
to the referring club.

### Verification

`supabase/tests/platform_referrals.sql`, 20 assertions, all PASS. The ones
that carry the promise:

| # | Assertion |
|---|---|
| 4 | A club cannot refer itself |
| 6 | The referred club starting a **trial** earns nothing |
| 7 | A plan and a mandate earn nothing |
| 8 | A **submitted** payment earns nothing until collected |
| 9 | The first collected payment earns one month of the referrer's plan |
| 10 | A redelivered confirmation cannot earn a second reward |
| 11 | A price change does not revalue a reward already earned |
| 12 | A club that already pays Ovalball cannot be referred |
| 14 | Reversing the qualifying collection withdraws the reward |
| 15 | A reward is withdrawn once, not once per delivery |
| 17 | The referred club cannot see the referral |
| 19 | No club can have two qualified referrers |
| 20 | Exactly one referral table exists |

**A test bug worth recording.** Assertion 17 first passed for the wrong
reason and then failed for the right one: this script's session is
`postgres`, which **bypasses RLS entirely**, so an RLS assertion run
straight from the DO block proves nothing. It now switches to the
`authenticated` role for that check. Every other access assertion in this
suite goes through a `SECURITY DEFINER` function with its own capability
check, which is a genuine test under any role — but Phase M will add a
role-switched sweep across all the `platform_*` tables rather than assume.

### Application surface

`lib/platform/referrals.ts` — `getClubReferrals()`, `claimReferral()`,
`getCreditBalancePence()`, and `REFERRAL_OFFER_SUMMARY`, which says
"successfully collected" rather than "signs up" because that is what the
engine actually requires and the copy must not promise more.

### Legal

The referral terms (§46) are Phase L. Nothing user-facing publishes the
offer yet.

### Files

- `supabase/migrations/20261006000000_platform_referrals.sql` (new)
- `supabase/tests/platform_referrals.sql` (new)
- `lib/platform/referrals.ts` (new)
- `types/database.types.ts` (regenerated)

---

## PHASE I — COMPLETE (live-verified)

The Site Admin surfaces. Design plan written first:
`docs/COMMERCIAL_UI_DESIGN_PLAN.md`. Zero new design tokens.

### `/admin/releases` — Release & platform mode

The Beta ↔ Live switch is the most consequential control in the product.
It is made to feel that way by **saying what it does**, not by painting it
red: red is for mistakes, and this is a decision. The button is labelled
with its outcome — *"Start charging clubs"* — rather than its mechanism,
and the confirm dialog will not submit without a reason of at least ten
characters, because the mode history is append-only and that sentence is
the only explanation anyone will have later.

The state block is `forest-950`. That is the one bold move on these pages,
and it is earned: forest-950 is Ovalball's own chrome everywhere else in
the product, so it is the right ground for the block that states what
Ovalball itself is doing.

Mode history renders as a **time rail** rather than numbered markers. It is
a chronology that continues downward and cannot be rewritten, which is what
a line says and what numbers would not.

### `/admin/commercial`

Attention first, counts second, table last. Nobody opens this page to learn
that eleven clubs are on Standard; they open it because something needs
doing. Three attention cases: a failed payment, a trial ending within a
week, and a club that chose a plan but never finished its Direct Debit.
When nothing needs attention the section says so — an empty state here is
good news and reads as good news.

The counts are one line of running text with tabular figures, not six
big-number tiles: they are context, not the point of the page.

"Extend trial" sits at the end of a row rather than as a prominent button —
it is rare and Full Site Admin only. `site.commercial.view` does **not**
grant it.

`public.platform_commercial_overview()` (new migration) computes remaining
trial time with the same `internal.trial_remaining_seconds` the club-facing
surfaces use, rather than re-deriving it in TypeScript. A second
implementation is a second thing that can be wrong about money.

### Live verification

Run against the local stack at `http://localhost:3000`, signed in through
the real passwordless flow as `test.site.admin@ovalball.local` (magic link
collected from Mailpit), desktop viewport 1512×763.

| Checked | Result |
|---|---|
| `/admin/releases` renders, Beta state block correct | PASS |
| Confirm button disabled until a reason is typed | PASS |
| **Beta → Live actually applied** — block flipped to "Ovalball is live", button to "Stop charging clubs", attribution to the signed-in admin | PASS |
| New history entry appeared with reason and green dot | PASS |
| Record a release — form prefilled with `0.0.1` and the real build SHA `6282b11` | PASS |
| Release saved and listed as **Draft** | PASS |
| `/admin/commercial` empty states | PASS |
| Populated: 3 attention rows, correct counts line, correct status pills | PASS |
| **Extend trial applied** — Burnley went `Trial · 2d` → `Trial · 16d` and correctly dropped out of "Needs attention" | PASS |
| Both nav links appear in the Site Admin nav | PASS |

That last one is the whole chain proven at once: UI → server action →
capability check → `SECURITY DEFINER` RPC → recomputed remaining time →
re-rendered page.

**Gap, stated:** only the desktop viewport was verified live. The mobile
card fallbacks (`md:hidden` lists replacing both tables) are written but
have not been seen rendered. Phase M covers them.

Local verification data was seeded directly into the local database for
this and is **not** committed.

### Files

- `app/(app)/admin/releases/{page,platform-mode-panel,release-panel,actions}.tsx|ts` (new)
- `app/(app)/admin/commercial/{page,extend-trial-dialog,actions}.tsx|ts` (new)
- `supabase/migrations/20261007000000_platform_commercial_overview.sql` (new)
- `docs/COMMERCIAL_UI_DESIGN_PLAN.md` (new)
- `lib/app-context/session-context.ts` (+`manageSystem`, +`viewCommercial`)
- `lib/app-context/build-nav-items.ts`, `lib/app-context/active-context.verify.ts`
- `types/database.types.ts` (regenerated)
