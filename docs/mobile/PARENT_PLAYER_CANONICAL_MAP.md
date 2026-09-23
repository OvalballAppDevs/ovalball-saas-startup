# Parent/Guardian + Player — the canonical map

Section 21 of the directive, answered before any code. Everything below was read
out of the repository or the live database, and the four RED boundaries were
**executed** rather than inferred.

Checkpoint: `d736ebb`.

---

## A. Web routes and components implementing Parent/Guardian

| Route | What it is |
|---|---|
| `app/(app)/parent/children/` | The family: add a child, link requests, team confirmation, child controls, invite a child login |
| `app/(app)/parent/players/[playerId]/details/` | The child's own record, including the protected `playing_pathway` (Gender) |
| `app/(app)/parent/players/[playerId]/access/` | Guardian-granted permissions for that child |
| `app/(app)/parent/players/[playerId]/subscription/` | **The real payment surface** — enrolment, mandate, payments, cancellation |
| `app/(app)/account/parent-guardian-section.tsx` | The parent block inside Account |
| `app/(app)/agenda/` | Fixtures **and** training for the family, with inline availability |
| `app/(app)/fixtures/[fixtureId]/` | **Match Centre** — the participant-facing game |
| `app/(app)/training/[sessionId]/` | **Training Centre** |
| `app/(app)/calendar/` | The calendar, shared with staff and gated by capability per action |
| `app/(app)/rugby-hub/parents/` | The Parents & Guardians hub area |

There is no separate "parent app" on the web. The parent product is the shared
surfaces, filtered by the family scope.

## B. Canonical server contracts those routes use

`add_child_for_guardian` · `request_child_link` · `my_guardian_link_requests` ·
`cancel_guardian_link_request` · `request_additional_guardian` ·
`respond_to_additional_guardian_request` · `set_guardian_player_permission` ·
`get_player_permission_summary` · `set_player_playing_pathway` ·
`set_player_avatar` · `issue_invitation` · `get_enrolment_eligibility` ·
`preview_first_payment` · `preview_player_allocation` · `claim_responsible_payer` ·
`record_billing_request` · `respond_to_attendance` ·
`respond_to_training_attendance` · `get_my_players_for_fixture` ·
`get_my_players_for_training_session` · `get_my_attendance_authority` ·
`get_match_centre_capabilities` · `get_training_session_card` ·
`fixture_availability_summary` · `my_direct_message_candidates` ·
`open_direct_conversation`.

## C. Family / guardian authority

`public.guardians` (`state` ACTIVE/PENDING_APPROVAL/SUSPENDED/REVOKED/…, with
`status = lower(state)` enforced) is the one relationship. It is Guardian →
**Player**, never Guardian → Team; team scope is derived from
`player_team_memberships`.

Two canonical resolvers sit on top:

- **`internal.resolve_attendance_response_source`** — who may answer availability.
  Guardian always. Self at 18+. Self at 16–17 only with recorded
  `approve_own_attendance` consent. Under 16 never. Unknown age **raises**.
- **`internal.player_contact_eligibility`** — who may be contacted about a player.
  Every active guardian; the player themselves only at 18+, or 16–17 with
  `direct_coach_communication` consent. "Having a login is not the test."

Consent lives in `guardian_player_permissions`, resolved by
`internal.guardian_permission_effective`, which requires **every** active
guardian to have granted it.

The context layer exposes this as `AgendaScope { kind: "family"; children }` and
`SwitchableContext { kind: "parent" | "family" }` — presentation and default
scope only, built from relationships the session already proved.

## D. Messaging recipient and safeguarding authority

One predicate: **`internal.may_direct_message`**, in this order —

1. **Both parties adult, first and unconditional.** "Nothing below can reach past
   this: not a shared club, not a guardian relationship, not a fixture, not an
   existing thread, not administrator status."
2. A personal block, in either direction, is absolute.
3. Site then club policy for the pair.
4. Only then relationship: an existing thread, a shared club, shared team staff,
   or **opposite sides of a fixture within 60 days**.

The fixture clause requires `internal.team_messaging_staff` on **both** sides,
which resolves `messaging.fixture_conversation.participate` — held only by the
Club Admin, Coach, Fixture Secretary and Team Manager bundles, and
`minor_prohibited`. Parents and players hold none of them.

`public.fixture_opposition_contacts` returns nothing at all unless the caller is
team messaging staff on one of the two sides.

### Proved, not assumed

```
parent asking fixture_opposition_contacts        -> 0 rows
parent's own candidate list, "Fixture contact"   -> 0
may_direct_message(parent -> opposition admin)   -> false
open_direct_conversation with a guessed id       -> REFUSED
```

```
is_adult_messaging_user(a minor with a login)    -> false
minor may_direct_message(coach)                  -> false
minor's recipient list                           -> 0 people
minor opening a DM with a coach                  -> REFUSED
coach may_direct_message(minor)                  -> false
```

**Both RED boundaries in §1 and §11 already hold at the server.** They are not
hidden buttons. A 16–17 year old with `direct_coach_communication` consent still
cannot open a DM — that consent governs being *contacted about* them, not
initiating.

## E. Fixture vs Match Centre separation

Already correct and structurally guarded.

- `app/(app)/fixtures/[fixtureId]` **is** Match Centre — participant-facing, one
  route, one component set, enforced by `scripts/verify-match-centre-shared.mjs`.
- `app/(app)/admin/fixtures/[fixtureId]` is Fixture Management, and redirects to
  `/dashboard` for anyone not Site Admin or involved-club staff.
- Planner, Import, Competition Creator and bulk tools are club-only capabilities.

Proved for a guardian on a real fixture: `can_manage_fixture` **0**,
`can_view_participants` **0**.

## F. Calendar and event model

One canonical agenda in `packages/contracts/src/agenda/` — `loadAgenda`,
`resolveAgendaScope`, `resolveWindow`, `applyAgendaFilters`. Fixtures and
training are both `AgendaItem`s; training has no opposition and is never given a
fake one.

Every calendar mutation is an RPC with its own capability check
(`create_training_session`, `cancel_training_session`, `cancel_fixture`,
`archive_fixture`, `create_tournament`…). **A parent is read-only because the
server refuses the writes**, not because the buttons are absent.

## G. Availability, and the staff notification path

One model: `player_fixture_attendance`, three states — `ATTENDING`,
`CANNOT_ATTEND`, `UNSURE` — plus the absence of a row, which is AWAITING.
Fixtures and training are rows of the **same table**. Vocabulary, order, tone and
question are shared in `packages/contracts/src/availability/`.

**The staff notification in §9 does not exist.** There is no trigger on
`player_fixture_attendance` beyond `set_updated_at` and `audit_row_change`, and
no notification type for an availability answer. What exists is the opposite
direction: a two-week job that *asks* outstanding families
(`fixture_attendance_invitation`). This is a class-D gap and must be built as a
canonical domain event before mobile can consume it.

## H. Notifications and push readiness

`public.notifications` with `notification_types`, `notification_topics`,
`notification_topic_channels` and per-user `notification_preferences`. Delivery
is gated per recipient by `internal.should_deliver_notification` via a trigger,
so an opted-out person is skipped centrally.

Live types include `fixture_details_changed`, `fixture_kickoff_change_proposed`,
`fixture_pitch_changed`, `training_session_updated`, `new_direct_message`,
`new_fixture_message`, `guardian_relationship_changed`.

**Push does not exist.** Every topic's `push_ready` is `false`, and there is no
device/token table of any kind. §10 requires building it as canonical platform
infrastructure.

## I. GoCardless / payment / subscription architecture

Real and substantial: `lib/payments/gocardless/` (client, OAuth, billing
requests, payments, mandates, reconcile, webhooks, merchant token) over
`club_subscription_programmes`, `club_subscription_pricing`,
`club_subscription_sibling_rules`, `membership_obligations`,
`player_subscription_payers`, `gocardless_mandates`, `gocardless_subscriptions`,
`gocardless_payments`, `gocardless_billing_requests`.

The parent journey is `claim_responsible_payer` → `get_enrolment_eligibility` →
`preview_first_payment` → **GoCardless's own hosted Billing Request Flow**
(`authorisation_url`, with `redirect_uri` back to the parent subscription page) →
`record_billing_request` → activate/cancel.

**The mandate step is legitimately hosted by the provider.** §14's "deliberate
secure handoff and return/deep-link journey" is the correct shape; a native
mandate form is not available and must not be faked.

## J. Rugby Hub

Seventeen areas under `app/(app)/rugby-hub/` — game, rules, glossary,
officiating, positions, skills, coaching, development, player-welfare,
safeguarding, parents, people, clubs, competitions, international, story.

Content is **in the database** (`hub_*` tables), read by `lib/app-context/*-data.ts`
modules that are all `server-only` but otherwise portable Supabase queries —
the same shape as every module already moved to the shared package. No fork is
needed or permitted.

## K. Player / U18 safeguards

- **Messaging**: absolute, proved above.
- **Availability**: under 16 never self-answers; 16–17 needs recorded consent.
- **Roles**: every meaningful role is `minor_prohibited`, and `internal.grant_role`
  additionally requires `person_is_established_adult` — a recorded DOB proving
  adulthood — for any *new* crossing into that authority. Unknown age is **not**
  adulthood there.
- **Staff → young person contact**: `player_contact_eligibility`, consent-gated.

## L. Where mobile duplicates or contradicts web

| # | Finding |
|---|---|
| 1 | **No child filter.** `AgendaFilterState.playerId` exists on the web; the mobile `AgendaFilter` has no `playerId` at all. §4's "All \| Pippa \| George" cannot be built from what mobile has. |
| 2 | **Rugby Hub is a placeholder** (`DestinationFoundation`). §12. |
| 3 | **Subscriptions is a placeholder.** §14. |
| 4 | **More hands off to the web** for People, Notifications, Profile and Security. |
| 5 | **Bottom bar is HOME · FIXTURES · CALENDAR · MESSAGES · MORE** — see conflict O-1. |
| 6 | `match-centre/load.ts` makes 11 direct table reads. Correct today (RLS decides), but the web resolves the same fixture through `getMatchCentreContext`; the two agree by construction only for the parts already shared. |
| 7 | `identity/images.ts` makes 16 direct reads — the picture-editing path added this session. Storage policy is the real boundary, but there is no shared reader. |
| 8 | **No availability confirmation** of the kind §8 describes. The control moves; nothing says "Pippa can attend". |
| 9 | **No Needs Attention beyond one rule** — mobile derives it from the next fixture's unanswered availability only. |

## M. Proposed shared extractions

| Move | Why |
|---|---|
| `playerId` into the mobile filter, from the shared `AgendaFilterState` | One filter model; delivers §4 and §6 child filtering |
| `lib/app-context/*-data.ts` hub readers → `packages/contracts/src/hub/` | §12, and they are already portable |
| Parent subscription read (`get_enrolment_eligibility`, mandate/payment projection) → a shared `packages/contracts/src/payments/` reader | §14 without a second payment system |
| A canonical **availability-answered domain event** + recipient resolver | §9; does not exist yet |
| A canonical **push device registry** + delivery channel | §10; does not exist yet |
| `notification_preferences` reader/writer → shared | §10, §13 |
| An `AvailabilityConfirmation` presentation model | §8, so web and mobile word it identically |

## N. Exact P1 slice

**P1 — Parent shell + canonical child/family context.** No new authority.

1. Add `playerId` to the mobile `AgendaFilter`, sourced from the proved
   `AgendaScope.children`, and apply it through the shared `applyAgendaFilters`
   rule rather than a second one.
2. A native segmented child filter on Home, Fixtures and Calendar — **All ·
   Pippa · George** — built only from `guardianRelationships`.
3. Make child identity unmistakable on every family card: name, team, and the
   child's own avatar, visually distinct from the signed-in person's.
4. Confirm the parent bottom bar against conflict O-1 before changing it.
5. Targeted proof: a two-child parent sees both and only both; one child's
   filter never yields the other's rows; an unrelated child id yields nothing.

## O. Conflicts requiring an owner decision

**O-1 — Navigation.** §2 says the parent bar is HOME · FIXTURES · CALENDAR ·
**RUGBY HUB** · MORE. The bar is currently HOME · FIXTURES · CALENDAR ·
**MESSAGES** · MORE, and `tab-projection.ts` records that as an explicit owner
decision at M3: "messaging is a DAILY operational job… while Rugby Hub is
something you go and read." This directive reverses it for the parent context.
Confirm, and say whether it changes for staff contexts too.

**O-2 — Unknown age.** §1 says unknown age must not be assumed adult.
`internal.is_adult_messaging_user` returns **true** for an account with no date
of birth anywhere. It is deliberate and documented in
`supabase/tests/adult_messaging_age_fallback.sql`: safe only because children
cannot self-register, so a child always has a `players` row with a DOB. The two
agree in every case the product can currently produce. Tightening it to
fail-closed is a one-line change with a real cost — every adult with no recorded
DOB loses messaging. Owner's call.

**O-3 — Availability states.** §8 asks for "at minimum CAN ATTEND / CANNOT
ATTEND". The canonical product has **three**: Attending, Can't attend, Unsure.
§8 permits existing canonical states, so the plan is to keep all three. Confirm.

**O-4 — Confirmation wording.** §8's examples ("Pippa can attend") are
third-person sentence case, which matches the register vocabulary but not the
first-person Title Case button words the content standard now requires
("I'm Available"). Proposal: the confirmation is a **statement about the child**
and takes the register words; the buttons stay first-person. Confirm.

**O-5 — Two things do not exist and must be built canonically first**: the
availability→staff notification (§9) and push infrastructure (§10). Neither is a
mobile feature. Both are platform work that web benefits from, and both land
before the mobile half of P5 and P11 can be honest.
