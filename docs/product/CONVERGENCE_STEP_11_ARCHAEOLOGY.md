# Convergence Step 11 — Match Centre Community + Rewards — archaeology

Measured against `e1be6af`, before any design. Everything below is from the
repository or the running schema, not from the handoff.

## 1. The finding that decides the step

**None of it is implemented.** Not one poll, vote, nomination, Kudos, award,
badge or recognition record exists anywhere in the product.

The record says so in its own words, and has said so since Step 7 —
`docs/product/CONVERGENCE_LEDGER.md:1400`:

> Polls, Kudos, post-match community write-ups, Players'/Parents'/Coaches'/
> Opposition Player, work-ethic and Beast awards, award configuration, badges,
> voting eligibility — *later Match Centre Community / Rewards work. The fixture
> data and API surfaces support them; none is implemented.*

`docs/product/CONVERGENCE_STEP_0_MAP.md:207` assigns "Polls · awards · Kudos ·
write-ups" to **Step 11**, and `CONVERGENCE_STEP_9_ARCHAEOLOGY.md:196` routes
"community, rewards, polls, kudos" to the same place.

### Verified by search, not by trusting the note

| term | migrations | app/lib/components | what the hits actually are |
|---|---|---|---|
| `kudos` | 0 | 0 | nothing |
| `poll` | 0 | 0 | the two test hits are the words "pollute"/"pollution" |
| `vote` | 2 | 0 | Rugby Hub history prose — clubs voting to leave the RFU in 1895 |
| `award` | 8 | 0 | Rugby Hub law content — "a penalty is awarded", "a scrum is awarded" |
| `recognition` | 1 | 0 | Rugby Hub concussion return-to-play prose |
| `nomination` | 14 | 13 | **safeguarding appointment** nomination, invitation redemption, message reports |
| `reward` | 16 | 20 | **the commercial referral benefit** — `reward_amount_pence`, `reward_credit_id`, `reward_plan_code`: a subscription credit, not cash (see §1.1) |
| `badge` | 10 | 98 | the shadcn `Badge` UI primitive, status pills, and Step 10's role badges |
| `beast`, `write-up` | 0 | 0 | nothing |

Two of those are traps: the vocabulary is taken, and taken by something else.
**Nomination** already means a safeguarding appointment. **Reward** already means
the commercial referral benefit, which §1.1 sets out precisely. Step 11 must not
overload either word in the schema, and must not reuse either model.

## 1.1 What the existing `reward` actually is

Measured, because the first draft of this document called it "money" and that is
not accurate.

**The product is "one month free": a successful referral earns the referring club
a month of its own subscription.** `docs/COMMERCIAL_PLATFORM_BUILD_REPORT.md:1442`
carries the offer copy — *"Refer Walcot RFC — get one month free"* — and
`docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md:1018` states what that is internally:
**a pence amount, not a month**, being the referring club's own plan price at the
moment of earning, snapshotted with `reward_plan_code` and `reward_price_version`
and never recomputed.

It is **a subscription credit and not cash**. `platform_referrals.reward_credit_id`
points at `public.platform_credits`, whose `source` is constrained to
`referral_reward · goodwill · beta_adjustment · application · reversal`. A credit
is positive when earned; it may go negative only as an `application`, which the
schema **requires** to carry an `applied_to_payment_id`, or as a `reversal`, which
must name the credit it reverses. A `referral_reward` credit must satisfy
`amount_pence = snapshot_price_pence` — one month at that club's own price,
exactly. There is **no payout, withdrawal or cash-out path**: no foreign key of
any kind joins `platform_credits` to `gocardless_payouts`, and a GoCardless payout
is money arriving for Ovalball, not credit leaving for a club.

Site Admin reports the benefit's **value** in money on purpose, and
`SITE_ADMIN_DASHBOARD_ARCHITECTURE.md:1040` records why: free months *applied* are
not canonically derivable back into whole months once credit has been applied to
payments, so the analytics speak in value while the product copy keeps saying
"one month free".

**The architectural conclusion is unchanged, and is the reason any of this
matters: a commercial referral benefit is not rugby recognition.** The referral
tables, the credit ledger and the word `reward` are not reused for Parents'
Player, Players' Player, coaches' recognition, Kudos, match awards or rugby
badges. Step 11 introduces no credit, no points and no financial liability, and
nothing it creates can reach `platform_credits`.

## 2. The original backlog, recovered

The original notes survive as a named list in two dispositions (the ledger line
above, and `CONVERGENCE_STEP_7_REPORT.md:722`, which is where Step 7 explicitly
declined to pull them forward). There is no separate notes file: `HANDOFF.md`
contains no community or rewards backlog, and the phrases "Parents' Player",
"Players' Player", "Coaches' Player", "Opposition Player" and "Beast" appear
**nowhere else in the repository** — no code, no schema, no test, no other doc.

So the intent is recoverable but the specification is not. There is no prior
decision about audience, anonymity, eligibility, closure or youth safety to
honour or contradict; the concepts arrive as vocabulary only. §46 of the handoff
is therefore the first place any of them is dispositioned.

## 3. What Match Centre is today

One canonical route, `app/(app)/fixtures/[fixtureId]/page.tsx`, one component set
in `components/fixtures/match-centre/`, one server view model
`lib/app-context/match-centre-data.ts` (517 lines), exactly as
`scripts/verify-match-centre-shared.mjs` requires.

| section | component | what it answers |
|---|---|---|
| hero | `hero.tsx` | status pill, date, **Meet**, **Kick-off**, home side first, both crests and kit, cancellation reason |
| availability | `attendance-panel.tsx` | the viewer's own answer(s), per person, written through Step 9's entry point |
| conditions | `match-conditions.tsx` | venue, address, pitch, the pitch diagram and the forecast — one answer, deliberately not split |
| participants | `participant-list.tsx` | staff-visible roster with avatars, responses, call-up markers, aggregate counts |
| opposition | `message-opposition.tsx` | direct conversation with an opposition contact |
| messaging | `messaging-panel.tsx` | the fixture conversation, with `canView` / `canPost` / `canModerate` |
| staff | `communication-panel.tsx` | fixture communication actions |

Server authority comes from two RPCs and nothing else:
`get_match_centre_capabilities(p_fixture_id)` returning
`can_view_participants`, `can_message`, `can_manage_fixture`; and
`get_my_attendance_authority(p_player_id)` returning `can_respond`. The first is
the pattern every new community flag should follow — it resolves through
`internal.has_capability(key, scope, club_id, team_id)` and
`internal.can_manage_fixture_side(...)`, and its own comment explains why a
staff-visibility flag must match the underlying RLS exactly rather than promise a
section that comes back partial.

### The gap that shapes everything

**Match Centre never shows the result.** `home_score`, `away_score` and
`result_status` are recorded on `public.fixtures` and are rendered in Fixture
Management, the admin fixture editor, the Calendar and the result confirmation
flow in Messages — and **nowhere** in Match Centre. The page's own header comment
says time, status and result "is edited in Fixture Management, which owns the
form"; editing is indeed not Match Centre's job, but the consequence is that the
canonical page for a match that has been **played** cannot say what happened.

That is not a detail. Post-match recognition attached to a page with no result on
it makes voting the most prominent thing about a finished rugby match, which §28
forbids. Any honest Step 11 has to give Match Centre a played-match identity
first, **read-only**, reusing the existing result data and never mutating it.

## 4. The lifecycle, measured

`public.fixtures.status` is constrained to: `Planned`, `Booked`,
`To Be Determined`, `Annual Holiday`, `Festival`, `Lancashire Cup`, `Cancelled`,
`Completed`. `result_status` is constrained to: `none`,
`awaiting_confirmation`, `final`, `disputed`, `amendment_pending`,
`external_recorded`, `unverified`. The view model narrows status to
`PLANNED | AWAITING_OPPOSITION | ACCEPTED | AMENDMENT_PENDING | CANCELLED | COMPLETED`.

**There is no LIVE or IN PROGRESS state, and no live-match infrastructure.** Per
§5 none will be invented. There is also **no `Postponed` status**: postponement
exists only for *competition matches*
(`20270306000000_competition_matches.sql`, `20270307000000_competition_match_operations.sql`),
not for fixtures, so "postponed" in Step 11 must be tested as what the schema
actually supports — a fixture that is `Cancelled`, or rescheduled by moving
`kickoff_date` — rather than as a state that does not exist.

## 5. Authority archaeology

`public.capabilities` already contains **`team.community.manage`**. It is the
obvious administration authority for this step, and it has a history:
`20270340000000_a_club_has_a_home.sql` says team news "mirrors
team.community.manage: the people who already speak for" the team, and
`20270240000000_who_is_speaking_is_not_who_pressed_send.sql` calls it to decide
whether an identity may speak as a team.

**But nothing grants it.** `bundle_capabilities` has **zero** rows for
`team.community.manage`, and `capability_key_map` has no entry mapping it to or
from anything. Its only live caller sits in an `or` chain beside
`internal.can_address_team_audience(...)` and `internal.is_full_site_admin()`, so
the feature works and the clause is simply always false. A dangling key, not a
live defect — recorded in the report as a finding rather than fixed here.

The comparable, *granted* team capability is `team.news.manage`, held by
`CA @club`, `CO @team` and `TM @team` — Club Admin, Coach, Team Manager. That is
the real shape of "the people who already speak for the team".

**Participation eligibility is a different question from administration**, and
the canonical pattern for it already exists twice: Step 9/10's
`answerablePlayerIds` — the viewer's own `players.user_id` row plus the children
they are an `active` guardian of — and `get_my_attendance_authority`. Step 11
takes eligibility from those relationships, never from a badge.

## 6. Minors

`players.user_id` exists, so a player *may* have an account, but on the review
world **2 of 26 under-18 players do** and 1 of 1 adults does. Youth rugby is
overwhelmingly represented by a player record with guardians and no login.

`supabase/tests/minor_prohibitions.sql` establishes that staff roles are never
held by an under-18 by any path. Age resolution already exists
(`player_age_resolver`, `adult_messaging_age_fallback`,
`adult_player_self_registration`), and Step 10 shipped the
turning-eighteen transition.

The design consequence is blunt: **a "Players' Player" vote cast by the children
themselves is not a thing a youth team can actually do**, because the children
do not have accounts. Building it as the primary mechanism would produce an
empty feature for the teams that matter most, and a way to canvas children for
votes in the few cases where it worked.

## 7. What already exists that Step 11 should reuse rather than rebuild

| need | canonical home that already exists |
|---|---|
| post-match write-up | **`public.club_articles`** with `category = 'MATCH_REPORT'`, a `team_id`, `visibility`, `status`, publish workflow, hero image and a 20,000-character body. It has **no `fixture_id`** — the article and the match it describes are not linked |
| moderation of user content | `public.message_reports` (`status` open → reviewed → resolved, `reported_by`, `reviewed_by`, `resolved_by`) |
| audit | `internal.audit_row_change` (100 callers, trigger-based) and `public.audit_log`; `public.security_events` for security facts |
| public projection | `public.public_club_fixtures` — carries **no score** and no participant data, consistent with the locked decision that friendly fixture scores stay non-public |
| positive-only team surface | Step 10's Team home, `components/teams/`, already consuming canonical readers |

## 8. Design implications carried into the build

1. **Give Match Centre a played-match identity first** — result, read-only, from
   the canonical fixture, never mutated by anything community does.
2. **One recognition model, not five.** The backlog's five award names are
   *audiences* for one concept, not five concepts.
3. **Kudos and awards differ in lifecycle, so they stay separate**: Kudos is
   ungated positive recognition a person gives directly; an award is a decision
   with an opening, a closing and a result.
4. **Eligibility is server-derived** from guardian/player/staff relationships,
   scoped to the fixture's own sides.
5. **Youth-conservative by default**: team-scoped visibility, no public totals,
   no ranking of children, nothing negative to give.
6. **Opposition recognition is only possible where the opposition is an Ovalball
   team** (`fixtures.opponent_team_id is not null`). Against
   `raw_opposition_text` there is no authenticated actor, and inventing one from
   knowledge of a fixture URL is exactly what §13 forbids.
7. **No currency, and no borrowing of the commercial one.** `reward` belongs to
   the referral subscription benefit (§1.1). Recognition creates no credit, no
   points and no financial liability.
