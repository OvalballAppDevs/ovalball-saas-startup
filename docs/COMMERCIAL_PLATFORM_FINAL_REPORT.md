# Ovalball Commercial Platform — Final Report

Phases A to M. Per-phase detail is in
`docs/COMMERCIAL_PLATFORM_BUILD_REPORT.md`; architecture in
`docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md`; the UI plan in
`docs/COMMERCIAL_UI_DESIGN_PLAN.md`.

**Nothing in this workstream has been applied to production, pushed, or
deployed.** Twelve local commits on `main`.

---

## A. Existing architecture audit

Audited against the live schema before writing anything. Six invitation
systems, a normalized notification system, a working `pg_cron` +
`internal.*` job pattern, an audit-log trigger, and build identity all
already existed and were **reused rather than rebuilt**.

The audit forced two design corrections:

1. **A namespace collision.** `club_subscriptions` and
   `club.subscription.view` — the names the brief asked for — were already
   taken by the *opposite* payment domain. Domain B therefore uses
   `platform_*` and `club.platform_billing.*`.
2. **Less to build than assumed.** Every apparent "referral" match in the
   codebase turned out to be an HTML `rel="noreferrer"`, so §43's worry
   about fragmented referral stores did not apply.

## B. Invite-only onboarding

Already true at the data layer: `club_memberships` has no self-serve
INSERT, and `/signup` writes a profile, consent rows and a *request* —
never a membership.

One real hole: `add_child_for_guardian` was `SECURITY DEFINER` and let any
signed-in person create a player identity at **any active club** and
declare themselves its guardian. Now guarded by an accepted invitation, an
existing guardian relationship at that club, or active membership.
Six assertions.

## C. Public signup redesign

Messaging and routing, as Phase A predicted. "Join Ovalball" → **"Bring
your club to Ovalball"**; a new `/invited` page states out loud that
Ovalball is invite-only for people; the sign-in footer names both journeys.
The review step states the trial terms before submitting.

## D. Invitation authority matrix

| Route | Who may initiate | What it grants immediately |
|---|---|---|
| `invitations` | Club Admin of that club | Nothing until accepted |
| `guardian_invitations` | Club Admin / team authority | Nothing until accepted |
| `player_account_invitations` | Guardian-controlled | A login, permissions guardian-controlled |
| `site_admin_invitations` | Full Site Admin | Nothing until accepted |
| `club_ovalball_invitations` | Club Admin | Nothing; a partnership on activation |
| `club_claims` | Anyone | **Nothing** — Site Admin approval creates the membership |
| `add_child_for_guardian` | Authorised guardian only (**new**) | A `pending` team membership, never active |

No route grants club authority without a human decision.

## E. Beta architecture

`platform_mode_events`, append-only, guarded three ways: no write policy at
all, a trigger that raises on UPDATE/DELETE, and a trigger that **derives**
`previous_mode` from history so a caller cannot forge a transition.
Ordering is by an identity column, not `changed_at` — `now()` is
transaction time, and two events in one transaction would otherwise be
ordered by a tie-break on a random uuid. The test suite caught that.

## F. Beta UI

`/admin/releases`. The state block is `forest-950`, Ovalball's own chrome
everywhere else in the product. The button is labelled with its outcome —
**"Start charging clubs"** — not its mechanism, and the dialog will not
submit without a reason. Not red: red is for mistakes, and this is a
decision.

## G. Beta audit

Every transition writes an immutable row with previous mode, new mode,
actor, timestamp and reason, plus an `audit_log` entry. The question "was
Ovalball charging on this date" is answerable from the first day the model
existed — the genesis row records that Ovalball was already in Beta.

## H. Release / version architecture

`platform_releases`: editable notes (notes get corrected), draft/published,
`build_sha` from the existing `lib/version.ts` identity. No DELETE policy —
release history is not tidied away.

## I. System Health updates

`/admin/system-health` unchanged. Release and mode moved to their own page
rather than being bolted onto a read-only diagnostics card, because they
are controls, not diagnostics.

## J. Trial architecture

Thirty **usable** days. `entitlement_seconds − consumed_seconds − (now −
accruing_since)`. `trial_ends_at = start + 30 days` was rejected because
wall-clock time passes whether or not a club can use the product.
A check constraint makes it impossible for status, `accruing_since` and
`pause_reason` to disagree.

## K. Trial pause/resume proof

The brief's own example, asserted:

> 1,555,200 seconds (18 days) remaining → ten days of Beta →
> **1,555,200 seconds remaining**.

Also proven: pausing twice folds in nothing further; leaving Beta does not
resume a pause the club made itself; a club cannot resume out of a Beta
pause; a trial started during Beta starts paused.

## L. Standard / Pro plans

Standard £15/month, available. Pro £25/month, **Coming Soon and not
purchasable**, because no premium feature exists that Standard lacks.
A check constraint makes `purchasable = true` impossible unless
`status = 'available'`, and an assertion fails the moment Pro gains an
entitlement Standard does not have — which is exactly when the label would
become a lie.

## M. Entitlement architecture

One resolver, `internal.club_effective_plan`. Phase E promised it would be
the only function needing a change when subscriptions arrived; Phase F
changed exactly that one function and every check picked it up untouched.

Four entitlements are marked **non-gateable** — safeguarding, permissions,
audit, data rights. They are granted to every club on every plan and on no
plan at all, and a trigger **refuses** any attempt to attach one to a plan.
§24 is structural, not a thing to remember.

## N. Club Subscription UI

`/club/settings/ovalball-billing`. All nine billing states have written
copy. Beta is not a banner — the "Next collection" line reads *"Nothing
while Ovalball is in Beta"*, where the question is asked. Pro gets no
disabled button; it gets an honest sentence that is **computed** from the
two plans' entitlement sets.

## O. Ovalball SaaS / club-member payment separation

| Shared | Separate |
|---|---|
| HTTP transport (`gcRequest`) | Merchant token |
| HMAC signature verification | Webhook endpoint |
| | Event inbox table |
| | Every table written |
| | The switch that permits it |

Asserted, not asserted-to: no `platform_*` function reads a Domain A table,
no foreign key joins the two domains, and the two webhook inboxes do not
overlap.

One naming violation was caught by these assertions and fixed:
`cancel_club_subscription` was Domain B but read as Domain A.

## P. Provider lifecycle

Recorded before any state moves, deduplicated on the provider's own event
id. Nothing trusts a webhook body — it is a link and a verb, and the real
resource is re-fetched. A subscription cannot go live without a mandate; a
sandbox subscription cannot be promoted to production; terminal payment
statuses cannot be walked backwards.

## Q. Referral architecture

One referral table, layered on the existing `club_ovalball_invitations`
rather than a second invitation system. No separate rewards table: a reward
*is* a credit-ledger row, and "one per referral" is a unique column.

## R. Referral reward proof

Qualification happens in exactly one place — inside
`apply_platform_payment_status` on the transition to `confirmed`. That
function already returns early on an already-terminal payment, so the guard
that makes payments idempotent makes rewards idempotent too.

Proven not to earn: opening an invitation, registering, a trial, choosing a
plan, a mandate, a submitted payment, a replayed webhook. Proven to earn:
the first collected payment, exactly once. Proven to withdraw: reversal of
the qualifying collection, exactly once.

## S. Partner Request referral integration

`internal.reconcile_partner_invitations` — already the function that
matches a pending club-to-club invitation to a newly created club — now
also registers the referral. One matcher, not two that must agree.

## T. Legal updates

Terms §12 renamed to "Payments a club collects from its members"; new §13
"What a club pays Ovalball"; new `/legal/referral-terms`. Four items marked
`[NEEDS INPUT]` rather than invented.

**`LEGAL_VERSION` deliberately not bumped** — see AB.

## U. Notification integration

No new system. One new **mandatory** topic (`platform_billing`) and three
types, on the existing normalized `notifications` table. Verified live: the
account preferences page already renders the topic as ALWAYS ON with no
change to that page.

## V. RLS / capabilities

Every commercial table has RLS on. **No money table accepts a direct
INSERT, UPDATE or DELETE** — every transition is a function.

Two security defects found and fixed by these tests:

1. `revoke execute … from public` does **not** remove Supabase's
   default-privilege grants to `anon` and `authenticated`. All five
   money-moving provider functions were callable by any signed-in user.
2. `platform_mode_events` accepted a direct INSERT, which would have
   changed the mode **without** pausing trial clocks — a platform saying it
   was in Beta while every club's trial ran down.

## W. Audit trail

Every commercial table carries `internal.audit_row_change`, asserted by
enumeration rather than by inspection. Three tables are append-only by
trigger, not merely by a missing policy — because a `SECURITY DEFINER`
function bypasses RLS.

## X. Idempotency / concurrency

| Operation | Made idempotent by |
|---|---|
| Start trial | Returns the existing trial |
| Pause / resume | No open interval to fold in |
| Beta transition | Returns null when already in that mode |
| Billing cycle | Unique `idempotency_key` per cycle |
| Payment status | Terminal states return early |
| Credit application | Partial unique index, one per payment |
| Referral reward | Unique `reward_credit_id`; one qualified per club |
| Reward reversal | Existence check on the reversal row |
| Plan selection | Re-choosing the current plan is a no-op |
| Club activation | Trial start returns the existing trial |

Row-level `for update` locks on every read-then-write path.

## Y. Tests

`./scripts/run-platform-tests.sh` — **131 assertions, 0 failures, 9 suites.**

| Suite | Assertions |
|---|---|
| invite_only_onboarding | 6 |
| platform_release_and_mode | 12 |
| platform_trials | 17 |
| platform_plans_entitlements | 17 |
| platform_club_subscriptions | 21 |
| platform_gocardless | 18 |
| platform_referrals | 20 |
| platform_activation | 10 |
| platform_rls_sweep | 10 |

Plus the pre-existing `scripts/verify-auth-security.mjs` (64) and
`scripts/verify-legal-routes.mjs` (151), both still passing.

## Z. Browser UAT

Run against the local stack, signed in through the **real passwordless
flow** (magic link collected from Mailpit), at 1512×763.

| Surface | Verified |
|---|---|
| `/admin/releases` | Beta state block; confirm disabled without a reason; **Beta → Live actually applied** with history entry; release recorded as draft with the real build SHA |
| `/admin/commercial` | Empty states; three attention rows; counts line; status pills; **trial extension applied** (2d → 16d, dropped out of attention) |
| `/club/settings/ovalball-billing` | Trial state; Pro card with no button; **choosing Standard created the subscription**; Beta changed the collection line |
| `/invited`, `/signup`, `/login` | New framing and both signposts, signed out |
| `/legal/terms`, `/legal/referral-terms` | Read end to end; renumbering correct |
| `/account` | The new notification topic renders as ALWAYS ON |

**Not verified: mobile.** See AB.

## AA. Build / type / lint

- `npm run build` — **compiled successfully**; all four new routes present.
- `npm run typecheck` — clean.
- `eslint` — clean on every file touched. One pre-existing warning in
  `app/legal/privacy/page.tsx`, untouched by this work.

## AB. Known gaps

1. **No GoCardless sandbox UAT.** No credential exists for Ovalball's own
   merchant, so nothing in Phase G has been exercised against the real
   provider. What is verified is the state machine the provider reports
   into. **This is the reason for the verdict below.**
2. **Mobile not visually verified.** The browser tool's `resize_window`
   does not change the layout viewport (confirmed: still 1512px after
   resizing to 390). The responsive structure was checked statically —
   every table sits inside an `overflow-x-auto` wrapper *and* is `hidden`
   below `md` with a card-list alternative, and there are no fixed pixel
   widths — but it has not been seen rendered narrow.
3. **`LEGAL_VERSION` not bumped, deliberately.** Terms §13 is a material
   change, but every `terms_acceptances` row records the accepted version
   and **there is no re-acceptance flow**. Bumping would make every
   existing acceptance point at a superseded version and close nothing.
   Needs an owner decision, then a flow.
4. **Four legal items need a decision**: price-change notice period, credit
   expiry, part-period refunds, VAT treatment.
5. **`/legal/referral-terms` needs a solicitor** for its contractual
   wrapper. Its facts are accurate and enforced.
6. **`policy_acknowledgements` is still not in production** — inherited
   from the auth workstream, unrelated to this one, and still on the
   onboarding path.
7. **No production migration applied.** Nine migrations exist locally only.
8. **Local database contains verification data.** Seeded deliberately to
   exercise populated states. To clear it:
   `delete from public.platform_trials; delete from public.platform_credits;
   delete from public.platform_payments; delete from public.platform_club_subscriptions;`

## AC. Production provider status

| Gate | State |
|---|---|
| `GOCARDLESS_ENV` | unset (defaults to `sandbox`) |
| `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` | unset |
| `OVALBALL_SAAS_BILLING_ENABLED` | **unset** — Domain B's own switch |
| `GOCARDLESS_PLATFORM_ACCESS_TOKEN` | **unset** |
| `GOCARDLESS_PLATFORM_WEBHOOK_SECRET` | **unset** |
| Platform mode | `beta` — Ovalball is not charging clubs |

Nothing can collect a penny from a club. Five things would each have to be
changed deliberately by a person first.

---

# Verdict

**OVALBALL COMMERCIAL PLATFORM — IMPLEMENTATION VERIFIED / PROVIDER UAT
DEFERRED**

The implementation is complete and verified: 131 database assertions, a
clean build, and browser UAT of every new surface at desktop width through
the real authentication flow. The GoCardless integration for Ovalball's own
billing is implemented but has **not** been exercised against the provider,
because no credential for Ovalball's own merchant exists and the domain's
own switch is off — which is the condition §114 names for this verdict
rather than the unqualified one.

Two further things stand between this and "VERIFIED": sandbox UAT once
credentials exist, and mobile browser UAT, which this environment cannot
perform.
