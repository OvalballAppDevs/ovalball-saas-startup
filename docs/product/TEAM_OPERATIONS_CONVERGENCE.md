# Team Operations / Identity / Notification convergence

Owner-directed product correction, raised from a live review of the Team context at Preston
Grasshoppers. From `a3a4ff7`. Step 19 (UX-8) is **paused, not discarded** — it is banked at `a01df21`
and `a3a4ff7`.

**This document is the archaeology plus what was actually corrected. It is deliberately explicit about
what was NOT done**, because the handoff covers fifty-six sections and a pass that touched all of them
lightly would be worse than one that fixed a few things at the root and said so.

## 1. Canonical owners

| concept | CANONICAL DATA OWNER | CURRENT UI OWNER | PROBLEM | TARGET RULE | STATUS |
|---|---|---|---|---|---|
| club logo / crest | `club_directory.logo_storage_path` | `ClubAvatar` | fell back to kit artwork | crest, else the club's initials — **never** a shirt | **FIXED** |
| club / team kit | `clubs` kit columns → `RugbyKit` | `RugbyKit` | used as a crest fallback | kit only where kit is the subject | **FIXED** |
| person profile image | `profiles.avatar_storage_path` | `UserAvatar` (rounded-full) | *none — architecture correct* | person's photo, else their initials | **VERIFIED CORRECT** |
| team identity | `teams` + `canonical_team_presentation` | `fullTeamLabel` / `compactTeamLabel` | none found | structured identity, derived name | unchanged |
| shell identity block | `resolveIdentityDisplay` | `context-switcher.tsx` | *none — already person-first* | names the person, shows their face | **VERIFIED CORRECT** |
| dashboard hero | `club-desk.tsx` → `CrestPlate` | `CrestPlate` | showed a shirt | club logo | **FIXED** |
| notifications | `public.notifications` (`type` + `data`, FK to `notification_types`) | `notification-bell.tsx` | see §3 | structured meaning, resolved server-side | **PARTLY FIXED** |
| notification target | `lib/notifications/destinations.ts` | same | 3 of 86 fell through; one mis-routed | one map, complete, from stable ids | **FIXED** |
| club join requests | `club_join_requests` + `list_pending_club_join_requests` | `/people` | notification sent people to `/admin/claims` | the club reviews these on People & Access | **FIXED** |
| player club join requests | `player_club_join_requests` | `/club/join-requests` | — *a different concept, easily confused with the row above* | keep distinct | documented |
| fixture requests | `fixture_requests` | `/fixtures` | see §4 | "Fixtures" must not mean requests | **DIAGNOSED, NOT FIXED** |
| fixture overview | `/fixtures/management` (staff), `/agenda` (family) | both | see §4 | one truth, different authority | **DIAGNOSED, NOT FIXED** |
| calendar | `/calendar` | shared | not investigated this pass | reuse family projection | NOT DONE |
| availability | existing availability domain | — | not investigated this pass | — | NOT DONE |
| team people | `team_memberships` / roster | `/teams/[id]` | not investigated this pass | team-scoped, not Club People | NOT DONE |
| subscriptions / GoCardless | existing finance domain | `/player/payments`, club billing | not investigated this pass | capability-gated | NOT DONE |
| Rugby Hub navigation | `/rugby-hub` | `buildNavItems` | present for parent/player/governing, **absent from team staff** | reachable from Team context | **DIAGNOSED, NOT FIXED** |
| active context | `ovalball_ctx` + `resolveActiveContext` | shell | none found | cookie is preference, server decides | unchanged |
| capabilities | `internal.can` | server | none found | unchanged | unchanged |

## 2. Identity — root cause

`ClubAvatar` took a `fallback` node. `CrestPlate` built one out of the club's home kit, on the stated
reasoning that a shirt is *"the next most recognisable thing a club owns"*. Preston Grasshoppers has
**no crest** (`logo_storage_path` is empty), so every surface showing its identity — the Club Desk
hero, the public club home, the chrome bars, article headers — showed an illustration of a shirt.

There was a second, subtler half. `ClubAvatar.settle()` discarded a **real, working crest** whenever it
rendered smaller than half its box, and showed the fallback instead — so a club with a perfectly good
low-resolution badge could upload it and still be represented by a shirt.

**The fix is structural.** The `fallback` prop is *gone*, not merely unused: with no way to pass kit
artwork into club presentation, club presentation cannot return it. The small-crest branch is gone too.
`scripts/verify-identity-presentation.mjs` (wired into the gate) fails on any component that
reintroduces either, that renders club identity and kit together without being declared a kit surface,
or that feeds club artwork into a person's avatar and vice versa.

**The person block was already right.** It uses `UserAvatar` — deliberately `rounded-full` so a face
never reads as a crest — fed from `profiles.avatar_storage_path`, gated by `avatarUsesPersonPhoto`
(false only for a guardian's named child, which is correct: a child must not wear the adult's face).
Upload exists at `account/avatar-form.tsx`. **No review persona has uploaded a photo**, which is why the
block shows initials. That is the fallback working, not a defect.

## 3. Notifications — what was actually wrong

The model is already the shape §23 asks for: `type` (a foreign key into an 86-row `notification_types`
registry) plus `data` jsonb, and **no client-authored href**. Destinations are resolved by
`lib/notifications/destinations.ts`, a pure map guarded by `verify-notification-catalogue.mjs` and
`notification_destinations.test.mts`.

Audited by running all 86 registered types through the resolver: **83 routed correctly.** So
"notifications are not an operational system" is not true of the map. What was true:

- **`club_join_request_submitted` went to `/admin/claims`** — the *Site Admin* claims queue. It shared
  a case with `club_claim_submitted`, and the two are different concepts: a **claim** is somebody asking
  Ovalball to let them set a club up; a **join request** is somebody asking an existing club to let them
  in, reviewed by the club on People & Access. So a Club Admin told "somebody wants to join your club"
  was sent to a surface about something else, which most of them cannot open at all — **this is the
  owner's observation 6, exactly.** It now routes to `/people?request=<id>`, using the request id the
  notification had been carrying all along, and the row is highlighted and scrolled to so the page says
  *which* request.
- **`impersonation_session_ended`** was registered by Slice 9 and never given a destination. Now
  `/account/security`.
- **`club_claim_approved` / `club_claim_rejected`** still go to `/dashboard`, deliberately: the outcome
  of a claim *is* what the dashboard then shows. There is no claim-outcome page, and inventing one to
  satisfy a coverage count would be the wrong way round.

**The guard was already in the gate** (`run-platform-tests.sh:166`) and would have caught the missing
type. It was red because sprint mode has been deferring the gate — the drift is a cost of that choice,
not a gap in the architecture.

**Not audited this pass:** read-vs-resolved semantics (§25/§46), staleness (§24), and whether clicking
switches context (§26). The bell's own header says it deliberately does not mark read on open, which is
the right instinct, but the distinction between READ and RESOLVED was not proven.

## 4. Fixtures — diagnosed, not fixed

The owner's observation 4 is correct and the code states it plainly. `build-nav-items.ts` documents
`/fixtures` as *"the inter-club negotiation register (requesting, accepting and rejecting fixtures
between clubs)"*, and deliberately keeps guardians away from it — they get `/agenda`, *"a parent-facing
list of that child's real fixtures and training"*.

So the useful overview §17 asks for **already exists**, and the family experience already has it.

Staff navigation labels `/fixtures/management` as "Fixtures", described as the master fixture register.
Whether that page reads as an overview or as a requests queue was **not established** this pass, and
redesigning it on a guess would be worse than reporting it. That is the next piece of work.

## 5. FUNCTIONS BEFORE / AFTER / LOST

**FUNCTIONS BEFORE 3 · FUNCTIONS AFTER 3 · FUNCTIONALITY LOST 0.**

Counted over what this pass touched: club identity presentation, person identity presentation,
notification routing. Nothing was added and nothing removed.

One behaviour was **deliberately withdrawn** and it is not a lost function: a club with no crest no
longer has a shirt substituted for its badge. That was never a capability anybody had — it was a
presentation decision the owner has reversed.

Preserved and untouched: Club Desk, Team, Parent/Guardian, Player, Governing Body, Fixture Operations,
Competition Creator, Match Centre, Rugby Hub, People & Access, Identity/Auth, GoCardless.

## 6. Owner decisions required

**D1 — Team finance visibility.** Not reached this pass. The existing capability model was not
recovered, so nothing was granted and nothing was changed. Per §30 this stays an explicit decision
rather than a silent grant.

**D2 — the empty crest plate.** A club with no logo now shows a two-letter initials tile. At hero size
it is plainly emptier than the shirt was. Options: (a) leave it — it is honest and prompts the club to
upload a crest; (b) prompt Club Admins to upload one where the club has none; (c) design a richer
neutral club mark. (a) ships today.

**D3 — review-world photos.** No persona has an avatar, so the person block cannot be judged visually.
Seeding real images means putting files in storage; it was not done rather than faked.

## 7. Not done — the honest list

Team Home hierarchy (§11), Team navigation including Rugby Hub (§12–13), the Fixtures IA fix (§14–15),
Team Calendar (§17), Availability (§18), Team People (§19), Subscriptions/GoCardless (§28–32), the
Team Manager scenario walkthrough (§33), Needs Attention (§45), and the notification read/resolved and
staleness audits (§24–25, §46).

These are not blocked. They were not started, because the three things this pass did fix were fixed at
their root and guarded, and that was the budget.
