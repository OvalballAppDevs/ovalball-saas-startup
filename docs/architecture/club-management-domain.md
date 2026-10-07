# Club management — the canonical domain

**One person. One club relationship. One team structure. One membership model. One payment domain. One
admission system. One authority model. One set of server rules. Many views of the same truth.**

This note is the map the club-management surfaces are built against: what each concept is, which record
holds it, which server door changes it, and the invariants between them. It was written on 5–6 October 2026
from a read-only forensic audit of the code and the live local database (evidence, with file and line
references, in that night's audit files), before the work it governs. Where today's estate falls short of
the map, the gap is listed at the end with its status. A view (web page, phone screen, notification) never
owns one of these concepts — it reads the canonical record through the canonical reader.

---

## 1. The concepts and where each one lives

| Concept | Canonical record | The one door that changes it | Notes |
|---|---|---|---|
| **Person** | `auth.users` + `profiles` | sign-up / invitation redemption | Roles never create a second person. |
| **Club** | `clubs` (identity from `club_directory`) | `decide_club_claim` (creates); deactivate / reactivate | Club and team names are not person names. |
| **Club relationship** ("club membership") | `club_memberships` (`PENDING`, `ACTIVE`, `SUSPENDED`, `ENDED`) | `internal.admit_club_member`; lifecycle `transition_club_membership` | Being a member is *not* paying for membership (§5). |
| **Club role** | `role_assignments` over `role_definitions` (10 roles) | `assign_role` → `internal.grant_role` | Additive. Club Admin, Fixtures Secretary, Safeguarding Officer, Member. |
| **Club access** | capability engine: role bundles + `capability_overrides` | `internal.capability_decision` / `internal.can`; overrides by the Permissions screen (needs a recent authenticator) | There is no second role catalogue. |
| **Team** | `teams`, identity `(rugby code, category, age grade, pathway, squad)` | `create_club_team` | Name derived, never typed (`compactTeamLabel` / `fullTeamLabel`). |
| **Team role** | `internal.team_role_assignments` (Coach, Team Manager, First Aider, Team Safeguarding Lead, Volunteer, hidden Team Admin add-on) | `assign_role` (team scope) | A parent who coaches is one person with two relationships. |
| **Player** | `players` (one row per child or adult who plays) | the admission doors (§3) | `date_of_birth` nullable and minimal: collected to place a child in the right age grade (privacy map). |
| **Guardian relationship** | `guardians` | family link requests / invitations | Who may act for, and be contacted about, a child. |
| **Team placement** | `player_team_memberships` (`ACTIVE` …) | every placing door, guarded by `player_membership_season_grade_guard` | A place is not a membership and not a payment. |
| **Dispensation** | `player_team_dispensation` (one player, team, club, season) | `request_dispensation`, `decide_dispensation`, `revoke_player_dispensation` | The only exception to the age grade. |
| **Membership product** | `club_subscription_programmes` (+ effective-dated `club_subscription_pricing`, `club_subscription_sibling_rules`) | `configure_subscription_programme`, `set_subscription_price`, sibling rules | Today: one product per club, monthly. |
| **Membership (enrolment / entitlement)** | `player_subscription_payers` (one active row per player and product) | `claim_responsible_payer` (parent or adult player), `set_responsible_payer` (club) | Carries the responsible payer and the price snapshot. |
| **Responsible payer** | `player_subscription_payers.payer_user_id` → `gocardless_customers (club, payer)` | as above | A **person**, never the child's player row. |
| **Mandate** | `gocardless_mandates` | GoCardless billing request flow, recorded by the webhook / reconciliation | Permission to collect. Not a payment. |
| **Payment schedule** | `gocardless_subscriptions` | `activateMembership` | The provider's recurring instruction. |
| **Payment obligation** | `membership_obligations` (one per player, product, month) | `create_membership_obligations_for_period` | What is owed for a month, and its state. |
| **Payment** | `gocardless_payments` (+ `payment_refunds`) | webhook → `apply_payment_status_transition` | Money that moved, or tried to. |
| **Discount** | sibling rules (product) + snapshot on the enrolment | sibling rule functions | Applied once, at enrolment, to the person's price. |
| **Reminder** | `notifications` (the one notification system) | *to be built on it* — §7 | No finance-only notification engine. |
| **Invitation** | `access_invitations` | `issue_invitation` / `redeem_invitation` | One invitation, share, link and QR mechanism. |
| **Referral** | `platform_referrals` (+ the club's one referral link) | `create_partner_invitation`, link introductions | Credit is club → Ovalball money, never member money. |
| **Club claim** | `club_claims` | `submit_club_claim` → `decide_club_claim` | The first Club Admin comes from an approved claim. |

## 2. The journey, and the record each step writes

```
PERSON                    auth.users + profiles              (one, whatever their roles)
  ↓ admitted              club_memberships ACTIVE            internal.admit_club_member
CLUB RELATIONSHIP         role_assignments                   assign_role → grant_role
  ↓ placed                player_team_memberships ACTIVE     age guard: fits, or an approved dispensation
TEAM PARTICIPATION        (guardians for a child)
  ↓ requires              membership requirement             derived: an active place at a club that runs a product
MEMBERSHIP REQUIREMENT
  ↓ enrolled by           player_subscription_payers         the responsible payer claims it (or the club sets it)
RESPONSIBLE PAYER
  ↓ authorises            gocardless_mandates                the payer's Direct Debit, through GoCardless
MANDATE
  ↓ owes                  membership_obligations             one per month, per player
PAYMENT OBLIGATION
  ↓ collected by          gocardless_subscriptions → gocardless_payments
COLLECTION
  ↓ settles               payment status → obligation status (apply_payment_status_transition)
RECONCILIATION
```

## 3. Invariants

1. **Roles are additive and never create a person.** A parent made a Coach is the same `auth.users` row,
   the same `club_memberships` row, with one more `team_role_assignments` row.
2. **A move is not a new person.** A player moving team ends one place and starts another; the player row,
   the guardian links, the club membership and the enrolment all survive.
3. **Financial history survives** team moves, role changes, deactivation and season handover. Nothing in
   the money tables is deleted or rewritten to make a view tidier.
4. **A club membership is not a team placement**, a **payment is not eligibility**, and a **mandate is not a
   payment**. Each is its own record with its own state; views combine them, records never collapse.
5. **The age grade is enforced on the place, server-side, for every door.** A place outside the grade needs an
   approved dispensation for that player, team, club and season. A place without a date of birth cannot be
   checked and is refused (an existing one is flagged, not removed). Union girls' dual bands come from the
   canonical allocation rule, not a second copy of it.
6. **Authority is derived on the server** from the caller's session and canonical relationships — never from a
   club, team, player or payer id the client sends. Privileged decisions (overrides, suspension, dispensation
   decisions) need a recent authenticator code.
7. **The child is never the debtor.** Money is asked of the responsible payer; a child is contacted only where
   the canonical contact rules allow, and never chased for payment.

## 4. Two money relationships, never one

| | Member / parent → club | Club → Ovalball |
|---|---|---|
| What | club membership fees | the club's Ovalball plan |
| Whose GoCardless | the **club's** account (OAuth) | **Ovalball's** account |
| Records | `club_subscription_*`, `player_subscription_payers`, `membership_obligations`, `gocardless_*` | `platform_*` |
| Authority | club finance capabilities (`finance.*` at club scope) | `finance.platform_billing.*`, Site Admin commercial |

They share no table and must share no language on screen. The audit found entanglements to undo over time:
shared GoCardless transport and environment switch, Site Admin commercial capabilities in member-payment
RLS, shared `finance.*` names, a mobile route to the Ovalball plan only through member-payment permissions,
a dormant platform fee mode inside member payments. Club → Ovalball billing is **not wired end to end**
(no Direct Debit setup, nothing writes the provider ids the webhook needs, no billing-cycle scheduler).

## 5. Membership state — one derivation, every view

A **club member** is a person with an `ACTIVE` club membership. A **player who needs membership** is one
with an active team place at a club that runs a membership product. **Paid up** is a payment fact about
the current month. They are different questions and the views say which one they answer.

The canonical per-player state, for the current month, derived in one place on the server and read by
every view (club, team, family, phone and web):

| State | Meaning | From the canonical records |
|---|---|---|
| **Up to date** | this month is paid | obligation `PAID` |
| **Collecting** | the money is on its way | obligation `SUBMITTED` / `RETRYING`; or a Direct Debit in place whose collection the payer has started (a GoCardless subscription), with this month not yet due |
| **Due** | a payer has taken it on, but something is still theirs to do; not yet late | active enrolment with no live mandate (`SETUP_UNFINISHED`), or a live mandate whose membership was never started — no GoCardless subscription, so nothing would ever be collected (`NOT_STARTED`, 20270753000000) |
| **Overdue** | not collected and past the due date plus grace | obligation unpaid, not with the bank, past due + 5 days |
| **Action needed** | something has failed and a person must act | obligation `FAILED` / `CHARGEDBACK`; mandate failed, cancelled or expired while enrolled |
| **Not set up** | needs membership, nobody has set it up | active team place, no active enrolment |
| **Exempt** | the club waived or exempted it | obligation `EXEMPT` / `WAIVED` |
| **Ended** | membership finished | enrolment `ended`, or the place ended (a still-collecting enrolment here is *Action needed*) |

Raw provider statuses (`pending_submission`, `paid_out` …) are evidence on the detail screen, never the
headline.

**Where it lives.** `internal.membership_standing(club, as_of)` (migrations 20270746000000, 20270748000000,
20270753000000) is the one derivation, with a reason code beside each standing (for example `PAYMENT_FAILED`,
`MANDATE_PROBLEM`, `LEFT_THE_TEAM`, `PAYER_NOT_GUARDIAN`, `SETUP_UNFINISHED`, `NOT_STARTED`, `WITH_THE_BANK`,
`SCHEDULED`), the membership the player holds or would hold, and whether collection has started. It is read
through `club_membership_board` (club scope), `team_membership_board` (team scope, **no money and no payer**),
`club_member_membership` (one player, club scope) and `family_membership_standing` (the family), and given
words once in `packages/contracts/src/membership/board.ts` and `operate.ts` (segments, filters, team
breakdown, reminder audiences, guidance per reason) for both clients. A due date is never earlier than the day
the member joined, so nobody is Overdue on their first day; money with the bank is Collecting, never Overdue.
The month's obligation is the **current** payer's: after a payer change, the month the old payer owed is
history, never the new payer's. A paused club still shows every member already paying; players nobody set up
are not chased while no one can join. A reader who does not pay (a second guardian, the player) learns only
that the membership is set up and which one — never the payer's amounts or how their Direct Debit is doing.

**"Need action" is one set**: Action needed, Overdue, Not set up and Due (a Direct Debit the family has still to
finish or start), each counted once — `NEEDS_ACTION` / `needsActionCount` in `operate.ts`. The club's overview
figure, the Members segment, a team's Memberships page and a team's home all count it, so no two of them can
disagree. The Payments ledger's **Needs Attention** filter is a different, older thing — months by obligation
status (failed, overdue, not yet collected) — and keeps its established name.

**Reminders** (`send_membership_reminders`, `send_team_membership_attention`) go through the one
notification system as `membership_reminder` / `membership_team_attention` (topic *Membership payments*),
to the responsible payer, or — when nothing is set up — to the guardians `internal.player_contact_eligibility`
allows, and to an adult player themselves; never to a child. One reminder per player in 72 hours; at most
100 per sender per day (50 per call; the clients send larger audiences in batches and never retry); the club
may tell a team's staff once a day. The words come from one composer (`internal.membership_reminder_body`),
which `membership_reminder_preview` also uses, so the preview a club sees is exactly what the family receives;
they name the player, the club and the month, never an amount. Which message a family gets is decided once
(`internal.membership_reminder_variant`: set up, start, not collected, due, overdue, or attention), and the
preview returns **one example per message with how many families get it** (`examples`), because an audience
mixes situations and a single example would misdescribe the rest. A bulk reminder is confirmed before it is
sent — on the club's Reminders page by the preview itself, and for a team's staff by a confirmation that shows
those messages first (app and website); one player's Remind sends at once. Each reminder is recorded in
`finance_audit_log` (`membership_reminder_sent`) with its sender, scope and recipient count, and
`membership_reminder_history` shows it — to a team's staff only for their own team's players, never who or
how many were told.

**Changing who pays** (`release_responsible_payer`, 20270753000000) ends the current payer's set-up so another
guardian can take the membership on through their own Direct Debit (`claim_responsible_payer`). It is refused
while a GoCardless collection is running (cancel the membership first) or a payment is on its way to the bank,
so two Direct Debits never collect for one player; it is audited (`payer_released`) and the old payer is told
(`membership_payer_released`).

## 6. Money words — what each number means

The board's figures are **membership amounts** for the selected scope (club, team, product) and period, in
the club's currency, before GoCardless's own fee. What reached the bank is a separate record: **payouts**
(below).

| Figure | Definition | Never includes |
|---|---|---|
| **Expected** | amount due on obligations for months that have started | cancelled, exempt, waived or refunded obligations |
| **Collected** | confirmed and paid-out payments, less refunds GoCardless has **confirmed** | scheduled or submitted payments; a mandate; a refund still pending |
| **Outstanding** | expected minus collected, for obligations not yet paid | anything exempt or cancelled |
| **Overdue** | outstanding obligations past due + 5 days that are not with the bank | in-flight collections |
| **Failed** | obligations whose collection failed or was charged back, not yet resolved | — |
| **Refunded** | refunds GoCardless has confirmed (a refund made at GoCardless is recorded from its own events, 20270754000000) | a pending or failed refund |
| **Waived / exempt** | the value the club chose not to collect | — |
| **Next collection** | current price × active enrolments for the next month | anything not yet enrolled |

| **Ovalball's fee** | 2.5% earned on collected payments (`internal.membership_fee_position` = `EARNED`) | an expected or pending fee; a fee on a refunded payment |
| **Fee on refunded payments** | Ovalball's fee on payments later refunded — GoCardless's documentation does not say whether it comes back (decision #14) | — |
| **Club receives** | collected, less the part of Ovalball's fee the club bears (earned and on refunds), before GoCardless's own fee | GoCardless's fee (known only from payouts) |

A retried payment counts once (its obligation is one row); a refunded payment stops counting as collected once
GoCardless confirms the refund.

**Payouts** (20270754000000). When GoCardless pays the club (`payouts.paid`), the payout and every item in it
are read from GoCardless with the club's own connection and kept (`gocardless_payouts`,
`gocardless_reconciliation_entries` — GoCardless serves items for six months only). Each item keeps GoCardless's
own type and amount to a tenth of a penny, with VAT; items for the club's own Ovalball payments are linked to
them, the rest is the club's other GoCardless activity. `club_payouts` explains each payout in the order the
money moved — members paid through Ovalball → GoCardless's fees (VAT included) → Ovalball's fee → refunds →
failures → other activity → paid into the bank — and says whether the items add up. Recording is idempotent
(a replay replaces the items) and an archived item list never wipes items already held.

## 7. Authority and privacy (least privilege)

| | Club Admin | Team Manager / staff | Parent / guardian | Adult player | Site Admin |
|---|---|---|---|---|---|
| Team compliance (counts, per-player state words) | ✓ | own team only | — | — | read only |
| Exact amounts, payment history, mandate status | ✓ | **none** — status, reason, membership name and reminder state only (decision #2, 20270753000000) | own child, as the payer only | own only | read only (commercial) |
| Responsible payer's contact details | with `people.member.view_contact` | — | — | — | — |
| Payouts and reconciliation | ✓ (`finance.subscription.view`) | — | — | — | — |
| Configure products, prices, discounts | ✓ | — | — | — | — |
| Assign / waive / exempt / cancel / refund / retry | ✓ | — | cancel own | cancel own | — |
| Send a membership reminder | ✓ (club → payer, club → team; `finance.enrolment.manage`) | to payers of their own team's players (`finance.subscription.view` at the team) | — | — | — |
| Connect / disconnect GoCardless | ✓ (`finance.gocardless.connect`; no recent-authenticator requirement yet — an open decision) | — | — | — | — |
| Club revenue and export | ✓ | — | — | — | aggregate only |

There is **no Treasurer role** today: finance is held by the Club Admin bundle, and a Club Admin can delegate
viewing, enrolment and export to a named person through overrides. A distinct finance role is a product
decision, not an implementation detail.

## 8. Known gaps, and their status

Evidence for each is in the audits of 5–6 October 2026; status as of the end of that night's programme.

| Gap | Status |
|---|---|
| Webhook failures never retried; payment status could move backwards; disconnect kept a usable token; `record_billing_request` trusted a client club id; first-month double charge | **Fixed** — 20270744000000 and `lib/payments/gocardless/*` (claimable inbox + 500 on failure + replay; observation-ordered status; token revoked and queued; club derived; explicit subscription start) |
| A zero-value obligation (100% discount) failed the whole club's generation | **Fixed** — 20270744000000 (exempt month; one payer's failure isolated) |
| A create that succeeded at GoCardless but was never recorded failed every retry for 30 days (`409 idempotent_creation_conflict`); a rate limit (`429`) failed at once | **Fixed** — `lib/payments/gocardless/client.ts`: a plain create's conflict is fetched back by the id GoCardless names; a read or a keyed create waits out a rate limit and retries at most three times; a create without a key is never repeated (`gocardless_client_resilience`, GC1–GC5) |
| Payer-suspended and blocked mandates read as Active | **Fixed** — 20270744000000 section 7, the reconciler and the standing (MS17) |
| A minor could self-claim as payer; price functions answered anybody | **Fixed** — 20270744000000 |
| About twenty state derivations in four vocabularies | **Fixed for every summary view** — one standing (20270746000000) read by the club board, the team board (web + phone), the team overview and, through `family_membership_standing` (20270747000000), the family summary and its attention item; the obligation ledger's words no longer collide with it. The family *detail* card still reads the payer's own provider records, so a second guardian sees the standing but not the Direct Debit detail (open) |
| No reminder or chasing workflow | **Fixed** — 20270746000000 |
| A minor could be admitted as a club Member with no guardian | **Fixed** — 20270745000000 (refused at the table, and at approval) |
| Dispensation: missing date of birth passed; union girls' dual bands refused; decisions had no recent-authenticator requirement | **Fixed** — 20270742000000 |
| Membership never ends by itself: obligations are generated for every active payer whatever the person's status, and removal, leaving, graduation and handover never touch money | **Open (owner decision #1)** — proved as today's rule by `membership_lifecycle_journeys` (LL1–LL4); visible as **Action needed** with guidance on every view. Options and a recommendation are in the decision register |
| The responsible payer can never be changed (`set_responsible_payer` has no caller) | **Fixed** — `release_responsible_payer` (20270753000000), then the family door; `set_responsible_payer` stays uncalled (it would end an enrolment without cancelling a live collection) |
| A Direct Debit in place whose membership was never started read *Collecting* | **Fixed** — `NOT_STARTED` (20270753000000): Due/Overdue, remindable, a family task |
| GoCardless's fee, payouts and refunds made at GoCardless were never recorded | **Fixed** — 20270754000000 (payouts and items on `payouts.paid`; refunds from their own events) |
| A sibling's membership asks the same payer to authorise a second Direct Debit | **Open (owner decision #17)** — `membership_lifecycle_journeys` LF3 |
| Signup's boys and mixed teams dropped at claim approval | **Fixed** — 20270747000000 (seeded by key, display name, compact name, age group and gender, or the old phrasing) |
| Admission: six player-creation doors with no merge; three join queues; claims can leave a club without a Club Admin; removal ends roles but not places, guardian access or Direct Debits; overrides return on re-admission | **Open** — proven by the people audit; the journeys in `supabase/tests/admission_journeys.sql` pin today's canonical behaviour so the fixes have a baseline |
| Club → Ovalball billing not wired end to end | **Open** — see the platform billing audit |
