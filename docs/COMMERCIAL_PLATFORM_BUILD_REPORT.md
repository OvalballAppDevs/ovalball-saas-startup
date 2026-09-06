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
