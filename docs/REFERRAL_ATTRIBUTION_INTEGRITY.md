# Referral Attribution Integrity — Phase F₀

The canonical record of how a referral comes to exist on Ovalball, what can go
wrong with it, and how it is repaired. This is the source of truth for referral
**attribution**; `docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md` covers referral
**analytics** and links here rather than restating any of it.

| | |
|---|---|
| Phase | F₀ — referral attribution & reconciliation integrity |
| Migration | `supabase/migrations/20261012000000_referral_attribution_integrity.sql` |
| Regressions | `supabase/tests/referral_attribution_integrity.sql` (33 assertions) |
| Baseline at start | `main` @ `f6cefb7`, 225 migrations, working tree clean |
| Applied to | Local Supabase Docker only. **No remote migration, no push, no deploy.** |

---

## 1. The invariant

> If an eligible Ovalball referral invitation legitimately results in the
> corresponding club relationship, the canonical referral attribution exists
> **exactly once**, and it does not depend on any best-effort application-layer
> side effect.

Enforced at the database boundary, in the same transaction as the business fact
it describes. `public.platform_referrals` remains the only referral store; no
second system was created (asserted permanently — see §7, assertion 30).

**Attribution is not reward.** The invariant above guarantees only that the
*claim* exists. Whether it ever pays is decided elsewhere and is unchanged by
this phase: a reward requires the referred club's **first successfully collected
Ovalball subscription payment**, which remains impossible while the platform is
in Beta.

---

## 2. Three defects, proven before they were fixed

### R-0 — four CLUB_ADMIN capabilities silently dropped

`internal.has_club_role_capability()` is re-declared **in full** by nine separate
migrations. `20261011000000_training_management_schema.sql` (Side Project 2,
merged into Main) re-declared it from a base that predated the commercial
platform. It added `club.training.manage` and, because it sorts after
`20261006000000`, silently removed four keys:

```
DROPPED: club.referrals.manage      club.referrals.view
         club.platform_billing.manage   club.platform_billing.view
ADDED:   club.training.manage
```

**Live effect in Main before this migration:** no Club Admin could make a
referral, see their own referrals, choose an Ovalball plan, or read their own
Ovalball billing. The commercial platform was switched off for every club.

Proven by direct capability resolution against a real CLUB_ADMIN membership:

```
is_club_active                                   = t
has_club_role_capability('club.edit_profile')    = t
has_club_role_capability('club.referrals.manage')= f   ← the defect
```

It also explains five failing regression suites and the live data anomaly below:
because `claim_club_referral` raised `42501` on every call, R-1's best-effort
application path was failing **100% of the time**, silently, in production code.

### R-1 — attribution was an application-layer side effect

`create_partner_invitation()` committed the invitation and returned. A *second,
separate* RPC round trip from the server action then attempted the referral, and
logged-and-continued on failure:

```ts
if (invitationId) {
  const { error: referralError } = await supabase.rpc("claim_club_referral", { … })
  if (referralError) console.error("claim_club_referral failed …")
}
```

Two transactions, no invariant. Reproduced end to end and rolled back:

```
--- invitation AFTER reconciliation:   accepted=t   partnership_created=t
--- referral rows after a successful conversion: 0
```

A fully successful club conversion, with the attribution permanently absent.
Nothing downstream repairs it: `register_referred_club()` begins by selecting the
referral and returns `false` when there is none.

### R-2 — no expiry lifecycle, and reconciliation excluded lapsed invitations

`club_ovalball_invitations` was the only invitation type in the schema with **no
expiry handling at all** (`invitations`, `site_admin_invitations`,
`guardian_invitations` and `player_account_invitations` all set `status='expired'`
in their accept paths). Meanwhile `reconcile_partner_invitations` matched only
`status = 'pending' AND expires_at > now()`.

A club claimed on day 15 therefore produced **neither** a partnership **nor** a
referral. Reproduced and rolled back:

```
--- invitation AFTER reconciliation:
    status=pending  accepted=f  partnership_created=f  was_expired=t
--- referral: status=pending, has_referred_club=f
```

Note this is worse than the Stage 1 audit recorded: R-2 destroyed the
**partnership** as well as the referral.

---

## 3. Resolution

### R-0 — restored, and guarded against recurrence

`internal.has_club_role_capability()` is re-declared as the **union** of what
both prior versions intended: every training-management key carried over
verbatim, plus the four commercial keys restored. Nothing removed.

Two guards were added because this will otherwise happen a tenth time:

1. The migration itself raises and refuses to apply if any of the five keys is
   missing from the function it just created.
2. `referral_attribution_integrity.sql` assertion 1 resolves nine capabilities
   against a real CLUB_ADMIN membership, so the next stale re-declaration fails
   CI instead of disabling a product area in silence.

### R-1 — one implementation, at the database boundary

```
internal.ensure_club_referral(invitation_id, source, actor)   ← the only implementation
        ▲                                    ▲
        │                                    │
create_partner_invitation()            claim_club_referral()
  same transaction as the invitation     explicit, capability-checked
  authority: can_manage_club_fixtures    authority: club.referrals.manage
  source: 'invitation'                   source: 'manual'
```

`ensure_club_referral` deliberately carries **no capability check of its own** —
authorization belongs to the business act that calls it, and both entry points
check before they reach it. That is what makes this one business path with two
authorized doors rather than two competing implementations.

Idempotency is structural: `platform_referrals.invitation_id` is `UNIQUE`, the
function locks the invitation row (the referral may not exist yet, so two
concurrent callers must serialise on something that does), returns the existing
referral when there is one, and uses `on conflict … do nothing` with a re-read as
a final race guard.

**The application-layer call was removed** from
`app/(app)/partner-clubs/actions.ts`, per the "do not leave two competing
business paths" requirement. `claimReferralForInvitation` in
`app/(app)/club/settings/ovalball-billing/actions.ts` is retained deliberately:
it is the Club Admin's own tool for an invitation that predates this migration,
it is capability-checked, and it now delegates to the same single implementation.

**One authority nuance, stated rather than hidden.** Creating an invitation
requires `can_manage_club_fixtures`, which a FIXTURE_SECRETARY holds, whereas
`claim_club_referral` requires `club.referrals.manage` (CLUB_ADMIN only). A
fixture secretary's invitation therefore now records a referral for their club.
This is not a broadening of referral **eligibility**: the reward accrues to the
club, the club authorised the invitation, and every eligibility gate
(self-referral, already-a-subscriber, referring club still active, first
collected payment) is unchanged. Assertions 5 and 6 pin both halves.

### R-2 — expiry and acceptance semantics, made precise

The distinction that matters:

| Situation | Attributable? |
|---|---|
| Invitation was **live when the club submitted its claim**; a Site Admin approved it weeks later | **Yes.** Approval latency is Ovalball's, not the club's. |
| Invitation had **already lapsed before the club acted** | **No.** It never becomes a successful referral. |

`reconcile_partner_invitations` gained a third parameter,
`p_reference_at timestamptz default now()`, and `approve_club_claim` passes
`v_claim.created_at` — the moment the club acted. The match became
`status in ('pending','expired') AND expires_at > p_reference_at`: it is the
timestamp that decides, not the label, so the nightly sweep cannot race the
decision.

`internal.expire_due_club_ovalball_invitations()` provides the missing lifecycle,
scheduled as `expire-club-ovalball-invitations` at `30 3 * * *`. It is status
hygiene only — it never touches a referral, never creates a partnership, and
never makes anything eligible.

`reconcile_partner_invitations` also now calls `ensure_club_referral` before
`register_referred_club`, so an invitation created before this migration can
still be registered rather than silently skipped.

---

## 4. Reconciliation

`public.reconcile_referral_attribution(p_dry_run boolean default true)`

Requires **Site Admin AND `site.commercial.manage`** — which
`internal.has_site_role_capability` makes Full-Site-Admin-only and
non-delegable. Defaults to a dry run, so calling it without thinking changes
nothing.

| Category | Finding | Behaviour |
|---|---|---|
| `repaired` | `missing_referral_for_accepted_invitation` | Creates the referral (`attribution_source='reconciliation'`) and registers the referred club — **only** when exactly one club holds an accepted invitation to that directory club |
| `repaired` | `pending_referral_for_activated_club` | Registers the referred club against an existing pending referral |
| `requires_review` | `ambiguous_referrer` | Two or more clubs hold accepted invitations to the same club. **Never guessed.** Reported with the rival count |
| `requires_review` | `self_referral_invitation` | Inviting and referred club are the same |
| `requires_review` | `qualified_referral_without_reward` | Money owed and unpaid — always a person's decision, never auto-issued |
| `unresolvable` | `reward_credit_without_referral` | Reported, never repaired, never deleted (see §6) |

Idempotent: a repaired referral is no longer missing, so a second run finds
nothing to do (assertion 13). Eligibility is not bypassed — repair calls
`register_referred_club`, which applies the self-referral and
already-a-subscriber gates and records a rejection reason. A rejected repair is
still a correct repair: the truthful outcome is *attributed and ineligible*, not
*no record*.

`platform_referrals.attribution_source` (`invitation` | `reconciliation` |
`manual`) records the path, which `audit_log` cannot infer. `audit_log` already
records who and when via the `audit_row_change` trigger, and reconciliation
writes `created_by = auth.uid()` for a Site-Admin-invoked repair and `null` for
the automatic path inside claim approval — so automated and manual repair are
distinguishable, as required.

---

## 5. Referral data health

Two functions, both Site Admin + `site.commercial.view`, both `security definer`
with an explicit guard as their first statement.

`public.referral_data_health()` — counts and a status only. No identifiers, no
emails, no tokens. This is what a dashboard tile calls.

`public.referral_data_health_detail()` — per-anomaly drill-through: stable ids
and club names only. It is a thin wrapper over the **dry run**, so the list a
Site Admin reads and the list a repair would act on can never disagree.

### Status semantics

| Status | Condition |
|---|---|
| `HEALTHY` | every detector reads zero |
| `RECONCILIATION NEEDED` | `missing_attribution` or `pending_for_activated_club` > 0 — safe repair will fix it |
| `ACTION REQUIRED` | `qualified_without_reward`, `reward_without_referral`, `duplicate_attribution` or `ambiguous_referrer` > 0 — money, or ambiguity data cannot settle |

`ACTION REQUIRED` is deliberately reserved for the two things a machine must not
decide. Reconciliation does **not** clear it: anomalies it cannot safely resolve
remain visible after it runs, which is the point.

Two detectors are expected to read zero forever, and are kept as defence in
depth rather than removed:

- `qualified_without_reward` is structurally impossible — the CHECK constraint
  `platform_referrals_qualified_has_reward` already guarantees that `qualified`
  implies a reward credit, a qualifying payment and a `qualified_at`. Assertion
  17 asserts the constraint rather than forging the state.
- `duplicate_attribution` is prevented by the partial unique index
  `platform_referrals_one_qualified_per_referred_club`.

A detector that only checks what it believes cannot fail is not a detector.

---

## 6. Historical data classification

Run against the real local database as a Full Site Admin, then rolled back.

| Anomaly | Classification | Treatment |
|---|---|---|
| Invitation `7f09e78d…` — `accepted`, partnership created, no referral (invited club *Walcot RFC*) | **SAFE TO REPAIR AUTOMATICALLY** | Repair verified: referral created, status → `registered`, `attribution_source='reconciliation'` |
| Credit `bd75a294…` — £15.00, `source='referral_reward'`, no owning referral | **UNRESOLVABLE** | Reported only. Never attached, never deleted |

Health before and after the trial repair:

```
before:  ACTION REQUIRED   missing_attribution=1   reward_without_referral=1
after:   ACTION REQUIRED   missing_attribution=0   reward_without_referral=1
```

Exactly the intended behaviour: the repairable gap closes, and the money anomaly
keeps the status at `ACTION REQUIRED` rather than being tidied away.

### The orphan credit, investigated

- `reason = 'Local verification credit'`, `created_by` null, `applied_to_payment_id` null.
- `audit_log` shows a single `insert` and nothing else.
- Its club (*Capability Engine Test Away RUFC*) has made **zero** referrals.
- The entire database contains **one** `platform_payments` row, `status='failed'`, for a different club.

It is local test-suite seed data that declares itself as such. No referral can be
reconstructed, and attaching it to the nearest referral would be a fabrication.

**Does schema integrity permit orphaned referral rewards?** Yes, and deliberately
so. The ownership FK runs `platform_referrals.reward_credit_id → platform_credits`,
not the reverse, because `qualify_referral_for_payment` must insert the credit
*before* it can record the id on the referral. A constraint requiring every
`referral_reward` credit to be owned would make that ordering impossible without
restructuring money code. The right instrument is therefore a detector, not a
constraint — and adding risk to the reward path to catch a test-data artifact
would be a bad trade. `platform_credits` is append-only (assertion 20), so an
orphan can never be deleted away either.

---

## 7. Regression coverage

`supabase/tests/referral_attribution_integrity.sql` — **33 assertions, all
passing**, wrapped in `begin … rollback`.

| Brief | Assertion |
|---|---|
| — (R-0) | 1 — nine capabilities resolve for a real CLUB_ADMIN |
| A | 2 — the normal path creates exactly one referral, in the same transaction |
| B | 3 — the legacy application claim is idempotent and returns the same referral |
| C | 7, 8 — an invitation live when the club claimed stays attributable after it lapses, and the partnership is created too |
| D | 9 — an invitation that lapsed before the club acted does not become a referral |
| E | 12 — an unambiguous historical gap is repaired and marked `reconciliation` |
| F | 14 — two competing referrers are reported for review; neither is attributed |
| G | 13 — repeated reconciliation creates nothing further |
| H | 4 — one invitation can carry only one referral |
| I | 27 — nothing in F₀ qualified a referral |
| J | 28, 29 — no reward credit issued; the platform is still in Beta |
| K | 3, 4, 13 — retry, uniqueness, repeated reconciliation |
| L | 15, 16 — orphan-reward detector fires (as a delta) and never deletes |
| M | 17, 18 — qualified-without-reward is constraint-prevented; the detector reads zero |
| N | 11 — the missing-attribution detector fires |
| O | 22 — reconciliation requires the non-delegable `site.commercial.manage` |
| P | 24, 25, 26 — a Club Admin cannot read health, detail, or run reconciliation |
| Q | 20, 21 — no email or token in detail output; none copied onto the referral |
| R | the suite rolls back; row counts verified identical before and after |

Additional: 5, 6 (fixture-secretary authority), 10 (expiry sweep), 19 (ACTION
REQUIRED holds), 20 (append-only ledger), 23 (view_commercial can read), 30 (still
one referral table), 31, 32 (audit trail and attribution-source distinguishable).

Credit-count assertions are measured as **deltas** against a baseline captured at
suite start, because the local database already contains an orphan reward credit
of its own — an absolute assertion would have been testing pre-existing noise.

---

## 8. Safety properties preserved

**Beta.** `open_platform_billing_cycle` still raises while the mode is not
`live`, so no payment can be created, none can be confirmed, and no referral can
reach `qualified`. Nothing in F₀ touches trial clocks, platform mode, plan
purchasability, or any provider gate. Assertions 27–29 pin this.

**Financial domain separation.** Referral credits remain `platform_credits`, in
the Ovalball SaaS subscription domain. Nothing here touches `gocardless_*`,
`club_subscription_programmes`, `membership_obligations` or any club member-payment
table.

**Reward exactly-once.** Unchanged and still enforced three independent ways:
`reward_credit_id` UNIQUE, the partial unique index on qualified-per-referred-club,
and the early return in `apply_platform_payment_status` on an already-terminal
payment, which defeats webhook replay before the qualify path is reached.

**Eligibility not broadened.** Self-referral is blocked by a CHECK constraint and
by runtime checks in both `register_referred_club` and
`qualify_referral_for_payment`. `create_partner_invitation` still refuses to
invite a directory club that already has a `clubs` row. `register_referred_club`
still rejects a club that has any confirmed `platform_payments`.

**Authorization.** All three new RPCs are `security definer` with an explicit
guard as their first statement, are revoked from `public, anon, authenticated`
and granted only to `authenticated` (where the in-function guard then decides).
Verified refused for anon at the transport layer: `HTTP 401 permission denied`
for all three.

---

## 9. Open product-policy questions — documented, not decided

Unchanged by F₀ and still owner decisions:

| # | Question | State |
|---|---|---|
| P-1 | Is there a cap on referral rewards per club? | No cap in code |
| P-2 | Do referral credits expire? | No expiry in code |
| P-3 | Should referrals attributed during Beta qualify once billing goes Live? | Undefined. Today a `registered` referral simply waits — defensible, but not a stated policy |
| P-4 | May a leaderboard name the person who sent the invitation, or clubs only? | **DECIDED (Decision E): clubs only.** The canonical referrer and reward beneficiary is `platform_referrals.referring_club_id`. A Site Admin who sends an invitation on a club's behalf is the *actor* — recorded in `created_by`, `club_ovalball_invitations.invited_by` and `audit_log` — and never the beneficiary. Dashboard terminology is **Top Referring Clubs**. No person-level referral reward system exists or is to be created |
| P-5 | May the referral contact email appear in the Site Admin operational log? | Recommended yes, Site Admin only. Not implemented in F₀ — the health functions return no email at all |
| P-6 | Should a fixture secretary's invitation attribute a referral to their club? | **Implemented as yes** (§3, R-1). Flagged for confirmation — reversible by moving the `ensure_club_referral` call behind a capability check |

---

## 10. One defect F₀ introduced, found and fixed in Phase A

Adding the defaulted `p_reference_at` parameter to
`internal.reconcile_partner_invitations` did **not** replace the two-argument
function — `create or replace function` cannot change a signature, so it created
a second one. Both were live, and because the third parameter has a default a
two-argument call matched both:

```
ERROR: function internal.reconcile_partner_invitations(unknown, uuid) is not unique
```

Production behaviour was never wrong: the only live caller,
`approve_club_claim`, passes three arguments, and the two remaining
two-argument call sites are inside function bodies that `20261012000000` itself
superseded. But it is a landmine for the next caller and it broke
`supabase/tests/partner_club_invitations.sql`.

Fixed in `20261013000000_site_admin_dashboard_read_model.sql` by dropping the
stale two-argument form, with a migration-time assertion that exactly one
remains and permanent regressions (`site_admin_dashboard.sql` 29 and 30). This
codebase had the same class of defect before — see
`20261011120000_duplicate_function_overload_fix.sql`.

---

## 11. What F₀ deliberately did not do

No dashboard, no charts, no Top Referrers, no referral funnel, no reward cards,
no live referral log, no redesign of `/admin/commercial`. No reward policy change.
No second referral system. No remote migration, no push, no deploy. Side Project 3
untouched.

**The Site Admin referral administration surface is now built** (Stage 1 R-5):
`/admin/commercial/referrals`. F₀ made the underlying truth reliable and gave
that surface its two canonical reads (`referral_data_health`,
`referral_data_health_detail`) and its one canonical action
(`reconcile_referral_attribution`); the screen consumes them as-is and defines
no anomaly of its own. Findings are rendered verbatim, and when either read
fails the page says so — it never renders "No anomalies found." for a check that
did not run, which on a data-integrity screen would be a false all-clear.
