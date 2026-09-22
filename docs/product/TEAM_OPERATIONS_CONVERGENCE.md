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
| fixture requests | `fixture_requests` | `/fixtures` | see §4 | "Fixtures" must not mean requests | **FIXED IN PART 2** |
| fixture overview | `/agenda` for everybody | `/agenda` | see §4 | one truth, different authority | **FIXED IN PART 2** |
| calendar | `/calendar` | shared | reused unchanged | reuse family projection | REUSED |
| availability | `player_fixture_attendance` | Team Home / Next Up | outstanding count surfaced; reminders not built | staff see who has not replied | **PART 2, PARTLY** |
| team people | `player_team_memberships` + `team_permissions` | `/teams/[id]` Team People | already rich — tabs for coaches, guardians, players, requests | team-scoped, not Club People | **VERIFIED CORRECT** |
| subscriptions / GoCardless | `membership_obligations`, `player_subscription_payers`, `gocardless_subscriptions` | Team page section | team staff had to leave the team to answer a team question | club-capability gated | **FIXED IN PART 2** |
| Rugby Hub navigation | `/rugby-hub` | `buildNavItems` | present for parent/player/governing, **absent from team staff** | reachable from Team context | **FIXED IN PART 2** |
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


---

# Part 2 — the Team Operations overhaul

From `ef3ce99`. Part 1 above fixed identity presentation and one notification route; this is the Team
experience itself, which Part 1 deliberately did not start.

## What was actually wrong, and what it is now

### The Team context was a club dashboard with the club parts removed

A Team Manager opening Ovalball saw a giant **OVALBALL UAT RUFC** with "Under 12 Boys, Manager" beneath
it in small grey type, a "Requests" list, a club-news rail, and a section headed **THIS WEEK** reading
*"Nothing scheduled this week"* — while the team had a fixture arranged for January.

It now opens with the team.

| | before | after |
|---|---|---|
| hero | the club's name, enormous | **the team's name**, with the club and the role on the line below |
| first section | Requests (including ones we sent) | **Needs Attention**, derived from domain state |
| next thing | "Nothing scheduled this week" | **Next Up** — opponent, date, kick-off, venue, status, availability, Match Centre |
| team | absent | players and staff, linking to the full team |

`lib/teams/team-overview.ts` is the read, and it is a **domain read rather than a page**: the Team
product is a likely native-app surface and business meaning that lives inside a React server component
has to be rewritten to get there. Its fixtures come from `loadAgenda` through the **same `teams` scope
the guardian agenda uses**, so a parent and a manager cannot be told different things about one fixture.

**Needs Attention is derived, never stored.** A pending fixture request that is waiting on *us* (not one
we sent), and players who have not answered availability. It disappears when the work is done, not when
a notification is read — which is the whole READ / RESOLVED distinction, expressed as architecture
rather than as a rule somebody has to remember.

### "Fixtures" did not mean fixtures

Three pages answered to the word:

| route | its own title | what it is |
|---|---|---|
| `/agenda` | "Fixtures" | the canonical shared agenda — opponent, date, venue, status, result, training |
| `/fixtures/management` | "Fixture Control Centre" | club-authority CRUD: edit, delete, results |
| `/fixtures` | "Fixtures" | the inter-club negotiation register |

Navigation pointed staff at the **third**. `/agenda` already said of itself that it is *"ONE SHARED
ROLE-AWARE SURFACE"* and that it exists because *"a coach, a club admin and a site admin had no agenda
at all"* — `resolveAgendaScope` has had a `teams` branch the whole time. **The product was built; the
navigation never pointed at it**, so guardians got the overview and staff got the negotiation register.

Now: **Fixtures → `/agenda`** for everybody, and the two administrative surfaces keep their own honest
names — **Fixture Control Centre** and **Fixture Requests** — and appear only with club fixture
authority. Three names for three things.

### The two team surfaces disagreed about what was next

The Team page asked for 60 days and the dashboard for 7. The review team's next fixture is in January,
so the Team page said *"Nothing scheduled yet"* and the dashboard said *"Nothing scheduled this week"* —
and neither mentioned it. A first attempt at the new read used the agenda's `year` mode, which spans the
whole **calendar** year and therefore includes the past: it offered a training session from four days
ago as the next thing coming up.

All three are the same bug — two places deciding separately how far a team can see. `teamAgendaWindows()`
is now the one answer, a season forward from today, used by both.

### Rugby Hub was under an ellipsis

Guardians, players and governing officers all had it in navigation; the people who actually coach did
not, and reached it through a promotional card. Ungrouped items fall into "More", which is where it was
landing. It is now its own named top-level destination in Team context.

## Subscriptions, and the authority that decides them

**Every finance capability in this product is club-scoped.** `finance.subscription.view`,
`finance.payment.act`, `finance.enrolment.manage`, `finance.subscription.export` — all
`valid_scopes = {club}`. There is no team-scoped finance authority.

So the Team page shows subscription state **only** to somebody holding `finance.subscription.view` at
the owning club, and `lib/teams/team-subscriptions.ts` is never called for anybody else. A Team Manager
who is not club finance staff sees nothing, and `/club/finance` refuses them directly — proven, not
merely hidden.

It reads the same canonical truth `/club/finance` does — `membership_obligations` for what is owed this
period, `player_subscription_payers` for who pays — narrowed to one team's players, with the problems
sorted to the top. **No bank detail, mandate reference or provider identifier is in the shape at all.**

**"Paid" is never invented.** A player with no obligation this period is `NOT_EXPECTED`, not "up to
date": being owed nothing and having paid are different facts, and a manager chasing money needs them
apart. An unrecognised obligation status falls to `DUE` rather than to paid — erring towards "somebody
still owes this", because the opposite would report a player settled on the strength of a word this
code had never seen.

## Notifications — the product audit Part 1 did not finish

86 registered types, run through the resolver by domain:

| domain | types | deep-linked |
|---|---|---|
| fixture | 23 | 19 |
| people/joining | 24 | 5 (+2 deliberately generic) |
| safeguarding | 9 | 0 — the club safeguarding page is the minimum-necessary destination |
| other | 12 | 2 |
| competition | 5 | 1 |
| training | 5 | 5 |
| messaging | 4 | 1 |
| identity/access | 3 | 0 — `/account/security`, which has no sub-object |
| finance | 1 | 0 |

The domains with low deep-linking are the ones where a canonical surface **is** the right answer. Two
types I first flagged as defects — `new_direct_message` landing on the message list, and
`training_staff_message` landing on the calendar — turned out to be correct: my probe had omitted
`direct_conversation_id` and `training_session_id` from its payload. Checking the source rather than
reporting the probe is the only reason those are not in this document as defects.

## Functions

**FUNCTIONS BEFORE 9 · FUNCTIONS AFTER 11 · FUNCTIONALITY LOST 0.**

Counted over the Team context: dashboard, team page, team people, fixtures, calendar, messages, team
news, player requests, join codes. The two added are **Needs Attention** and **team subscriptions**.

Nothing was removed. `/fixtures` and `/fixtures/management` are both still reachable, still do what they
did, and are now named for what they are rather than for what somebody hoped to find.

## Not done

Availability beyond the outstanding count on Next Up (§19's reminders), a dedicated Team Calendar
treatment (§18 — `/calendar` is reused as-is), notification read/resolved UI state and staleness
handling (§25/§26 — the *architecture* now expresses the distinction, the bell UI was not reworked), and
the notification panel visual pass (§27).

## Owner decisions

**D4 — team-level finance visibility.** A Team Manager cannot see their squad's subscription state
unless they also hold club finance authority. Options: (a) leave it — finance stays a club job;
(b) add a team-scoped `finance.subscription.view` so a manager sees **their own squad only**;
(c) let Club Admins grant it per person. This was not assumed either way: (a) ships today.


---

# Part 3 — the owner's IA correction

From `4729663`. Three owner decisions, implemented.

## 1. The generic "Team" group is gone

Navigation carried a group called **Team** containing the team's own name and Player Requests — inside
a context that already *was* that team. Opening Under 12 Boys took **Team → Under 12 Boys** from a
workspace called Under 12 Boys.

The team is the workspace's identity now, not an item in its own menu.

| before | after |
|---|---|
| Dashboard | **Overview** — the team's operational home |
| **Team** → Under 12 Boys, Player Requests | *(gone)* |
| Fixtures & Calendar | Fixtures & Calendar |
| Communications | **People** |
| Rugby Hub | **Subscriptions** *(only where the capability is held)* |
| | Communications · Rugby Hub |

Ordered by frequency: fixtures and the calendar most weeks, then who is in the squad, then — monthly
at most — whether anybody still needs to set a subscription up.

**A group of one is not a group.** People, Subscriptions and Rugby Hub are single destinations, and a
collapsible section wrapped around one identically-named child renders as "People › People" — a
disclosure triangle whose whole content is the thing you already read. A section whose single item says
what the section says now *is* the link.

## 2. Player Requests left primary navigation

Owner decision: occasional work does not hold a permanent slot beside Fixtures.

It has **not** gone. It lives on the team's administration page — what the context gear opens (§20) —
and a pending one still reaches the person through **Needs Attention** and through **its
notification**, both of which link to the decision itself. That is the READ / RESOLVED distinction
doing its job: exceptional work surfaces through attention and notification, recurring work through
navigation.

`People` also moved off that page into its own destination, and the roster read moved with it. Leaving
the query behind would have meant the administration page fetching a roster it no longer renders, on
every visit, which is the sort of thing that survives for years because nothing fails.

## 3. Bounded team-scoped subscription visibility

The previous pass established that every finance capability is club-scoped — which made the team
subscription surface real, correct and **invisible to the person it was for**.

`20270531000000` extends `finance.subscription.view` to `team` scope. **One capability, two scopes, not
a second key** — which is how this engine already expresses "the same question, a smaller boundary"
(`calendar.view`, `club.view`, `competition.match.respond` and others are `club,team`). The scope is
the boundary and `internal.capability_decision` enforces it:

| held at | means |
|---|---|
| **club** | `/club/finance` — the ledger, exports, payment actions |
| **team** | operational subscription state for players of that one team |

`/club/finance` asks at club scope and therefore still refuses a team holder, **without that page
changing at all**. A second key would have needed every consumer to remember which to ask for, and the
first to forget would have been the bug.

It is granted through the **TEAM_MANAGER bundle** (`bundle_capabilities`, bundle `TM`), so it is
reproducible from the migration rather than from a patched review database. A Club Admin can grant it
to anybody else through ordinary delegation — the capability is already `delegable` with a club grant
level. Not every coach: coaching is not chasing subscriptions.

**Measured against the engine:**

| question | answer |
|---|---|
| own team, team scope | **true** |
| another team, team scope | **false** |
| their club, club scope | **false** |
| `finance.payment.act` at team | **false** |
| `finance.subscription.export` at team | **false** |

The other finance capabilities are untouched and the migration's own guard fails if any of them gains
team scope.

## Functions

**FUNCTIONS BEFORE 11 · FUNCTIONS AFTER 13 · FUNCTIONALITY LOST 0.**

Added: the **People** destination and the **Subscriptions** destination. Nothing removed — Player
Requests, the roster and team administration all still exist and are all still reachable; two of them
moved to homes that match how often they are used.


---

# Part 4 — fixture authority, and keeping Team context team-scoped

From `4f54a92`.

## What already existed, and was not rebuilt

**The capabilities were already right.** `fixture.fixture.create`, `.edit`, `.cancel` and
`fixture.request.create` / `.respond` are all `club,team` scoped, delegable, with a team grant level.
Nothing needed adding. And the invariant §3 asks to preserve already holds by construction:
`fixture.planner.use`, `fixture.import.run`, `fixture.fixture.bulk_edit` and `fixture.fixture.delete`
are **club-only and not grantable at team scope at all**.

**The age rule already existed too.** `internal.teams_can_play_fixture` is the canonical predicate —
same rugby code, same category, senior sides matched on gender, youth girls matched to girls, and
otherwise an **exact `internal.age_fixture_band` match**. It reads the canonical team record; there is
no string matching anywhere near it. Measured: U12 v U12 true; U12 v U16, U12 v Men's, U12 v U13 all
false. And `suggestOppositionTeam` already **filters** the opponent picker to eligible teams before
ranking them, so §14's "only compatible candidates" was already true in the UI.

## What was wrong

**Club-wide fixture administration leaked into Team context.** A Club Admin who deliberately stepped
into Under 12 Boys was still shown the club's **Fixture Control Centre** and the inter-club
**Fixture Requests** register — because they happen to hold club fixture authority. Standing in one
team offered a console for every team at the club. Both are now `!inTeamContext`: unchanged, still
reachable from Club context, and no longer following somebody into a team.

**An ineligible fixture request could be sent.** The age rule was enforced by a trigger on `fixtures`
and inside `accept_fixture_request`, so an under-12 side could never end up with a fixture against a
senior XV. But nothing stopped the **request** being made — it simply could never be accepted, after
somebody had read it and worked out why. `20270532000000` refuses it at source, and does so by calling
`internal.teams_can_play_fixture` rather than restating the regulation. The migration's own guard fails
if that function is ever inlined or replaced by a second rule.

It deliberately only judges what it can see: a request may legitimately name no target team yet (a
scheduling group, or a directory identity for a club not on Ovalball). Those resolve later, where
`accept_fixture_request` applies the same rule.

**The team's fixture actions were in the wrong place.** Add and Request now sit on the team's own
fixtures page, gated on the capability at TEAM scope, opening the canonical surfaces. No second creator.

## D5 — OWNER DECISION REQUIRED: fixture authority by title

The handoff's §1 says a Coach or Team Manager receives no fixture mutation authority from their title.
**The shipped product does not work that way**, and this pass did not change it:

| bundle | already grants, at team scope |
|---|---|
| **CO** (Coach) | `fixture.fixture.create`, `.edit`, `.cancel`, `.view`, `fixture.request.create` |
| **TM** (Team Manager) | all of the above plus `.archive` and `fixture.request.respond` |

§22 says to preserve an existing bundle and let the Club Admin override it, which is what has been
done — and the override works: a scoped **deny** for one person on one team beats the bundle and takes
nothing else with it (`team_fixture_authority` A6/A7).

But §1 and the bundles genuinely disagree, and reconciling them means **removing** authority from every
coach in the product, which is not a tidy-up. Options:

- **(a)** leave it — a coach can manage their own team's fixtures by default, and a Club Admin denies
  where they want it withheld. Ships today.
- **(b)** strip create/edit/cancel from the **CO** bundle so a coach starts with view only and a Club
  Admin grants deliberately. Matches §1 exactly; changes what existing coaches can do.
- **(c)** strip from **CO** but leave **TM**, on the view that managing fixtures is a manager's job.

**What the Club Admin can actually reach today**, which narrows option (a). The permissions screen
(`app/(app)/club/permissions`) writes one shape only: `set_capability_override` at `scope_type = 'club'`
with no team. These fixture capabilities all carry `inherits_to_team`, so that deny **does** reach a
team-scope question — verified, `team_fixture_authority` A8 — but it reaches **every** team the person
coaches (A9). Withholding fixture creation from one coach on one team is a per-team override, which
the engine supports (A6/A7) and **no screen writes**. So option (a) is "deny across the club", not
"deny on this team", until a per-team control exists. That control is a UI of its own and was not
built here.

## D6 — The sidebar said where you were, twice

Every navigation renderer — the desktop sidebar, its grouped sections, the mobile drawer and the
bottom bar — decided active state per row with `pathname === href || pathname.startsWith(href + "/")`.
That is a prefix test rather than a matcher, and where destinations nest it answers true for the
ancestor as well as the page. On `/fixtures/management` both **Fixture Control Centre** and **Fixture
Requests** were highlighted; on `/club/settings/guardians` both **Guardians & Players** and **Club
Settings** were. Two active rows do not tell a person where they are, which is the only thing the
state exists to say.

`lib/app-context/active-nav.ts` is now the one resolver: the **longest** href that matches wins, so
exactly one row can be active. The behaviour the prefix test got right is kept — a deeper route that
no row names still lights its nearest ancestor, so reading one message is being in Messages.

Four copies of the predicate is why the defect was in four places, so the copies are what is banned:
`navigation_architecture` fails if any renderer carries its own prefix test, and the assertion that
the old predicate over-matches is computed from the real club navigation rather than an invented list.
Proved in a browser in `89-team-operations` (G series), because a highlight is what a person sees.


## D7 — A Club Admin could not actually grant fixture authority for one team

§2 of the correction requires that a Club Admin can let a team staff member run **their** team's
fixtures without making them Club Admin, Fixture Secretary, or club-wide fixture staff. The capability
engine has always been able to record that: `set_capability_override` accepts `p_scope_type = 'team'`,
and `internal.capability_decision` resolves a team-scoped decision. **No screen could ask for one.**
`app/(app)/club/permissions/actions.ts` sent `scope_type: 'club'` with no team, and
`club_member_capabilities` answers only at club scope — so the only decision a club could take was
club-wide, and withholding fixture creation from one coach on one team was not reachable through the
product at all.

**`public.club_team_capabilities(club, team, keys)`** is the team-scope twin of
`club_member_capabilities`: same authority check, same resolver, same editability rule. It differs
deliberately in two ways. It answers for the people who hold a role **on that team**, because a team
decision about somebody with no relationship to the team adjusts nothing. And it offers only
capabilities valid at team scope — which is what keeps `fixture.planner.use`, `fixture.import.run`,
`fixture.fixture.bulk_edit` and `fixture.fixture.delete` out of a team grant. They are club-scope
capabilities and **cannot be named on a team at all**, so §2's list of things a team grant must not
confer is enforced by the catalogue rather than by a screen remembering to hide them.

The screen itself was extended, not replaced (§21). `/club/permissions?team=<id>` renders the same
panel, the same rows, the same "where this answer came from" and the same Reset, and writes through the
same canonical RPC. **Scope lives in the URL**, so what the page shows and what the write targets are
one value rather than two that agree most of the time. One panel serves both scopes: two would drift,
and the parts people rely on to understand what they are changing are exactly the parts a copy loses
quietly.

## D8 — The opponent list did not exist, so the age rule could only ever refuse

D4 refused an ineligible request at source, which is correct and is also a poor experience: somebody
had to choose an opponent before anything told them it was illegal. §14 asks for the opposite — offer
only what is legal.

**There was no opponent-team step.** The flow asked which opposing **club**, and the only way a request
ever named a target team was arriving from a partner club's availability view with it in the URL.
Where the requester knew the other club had no such team, they could *name* an identity — from
`YOUTH_AGE_GROUPS`, the whole youth list, defaulting to a hardcoded `U12`. So an under-14 side opened
that picker already showing an age grade it could not play.

**One rule now answers both questions.** `internal.teams_can_play_fixture` could only ever answer "is
this pairing legal", because it takes two team IDs. It has always been a judgement about two
*identities* — code, category, age grade, gender — that happened to be read from two rows, so the rule
was lifted one level to `internal.identities_can_play_fixture`, and `teams_can_play_fixture` became the
lookup in front of it. Same answer, same regulation, one implementation; the migration's guard fails if
it ever stops delegating.

On that sit two readers: `compatible_opponent_teams(team, opponent_club)` and
`compatible_opponent_identities(team)`. Both refuse unless the caller holds fixture request or create
authority at TEAM scope for the asking team, so neither is a way to enumerate another club's teams.
Neither is a filter over a full list — the incompatible teams are never sent — and
`compatible_opponent_identities` is scoped in the query by the asking team's own `rugby_code`, so union
and league catalogues are never mixed.

**No new regulation was written** (§13). The canonical rule matches youth girls sides to youth girls
sides *across* age grades, and youth sides of the same `age_fixture_band` to each other regardless of
classification. A reader that compared age grades naively would look stricter and more sensible and
would be a second rule; `team_fixture_authority` H7 asserts the rule as it is, and H4 asserts the offer
and the trigger never disagree for any team at the opponent club. The narrower *named identity* path
keeps its own existing constraint — Boys or Girls only, never Mixed, Men's or Women's — which is the
request flow's rule about what a recipient may be asked to create, not a compatibility rule.

## D9 — Needs Attention never told a team a request had arrived

§17 puts exceptional work in Needs Attention rather than in navigation. That only holds if the panel
shows the work, and this item did not: the incoming-request count asked for `status = 'pending'`, which
is not a value `fixture_requests.status` can hold — the domain is
draft/sent/accepted/declined/counter_proposed/cancelled/expired. Nothing errored. The filter matched
nothing, the count was structurally always zero, and a team was **never** told a request was waiting.

It now reads `sent`, which is what `getIncomingFixtureRequestsSummary` uses for the club's own incoming
section, so there is one definition of "waiting for your answer". `counter_proposed` is deliberately
excluded: it says a counter-proposal exists, not whose it is, and guessing would put items in Needs
Attention that need none.

A single incoming request now links to **that request** (`/messages/request/<id>`) — the same precise
destination the notification for the same event already resolves to, where accepting and declining
happen (§18). Several is a list, and the register is the honest answer to a list.

The lesson is the shape, not the typo: a string literal compared against a checked column is a claim
about that column's domain, and neither TypeScript nor PostgREST checks it.
`supabase/tests/js/team_needs_attention.test.mts` reads the CHECK constraint out of the migration that
owns it and asserts every status literal the reader uses is in it.


## Functions

**FUNCTIONS BEFORE 13 · FUNCTIONS AFTER 17 · FUNCTIONALITY LOST 0.**

Nothing removed. Fixture Control Centre, Fixture Requests, the Planner, import and bulk edit are
unchanged and still reachable from Club context; what changed is which context offers them. The team's
Add and Request are the canonical surfaces reached from a better place.

Four gained: a Club Admin can decide fixture authority **for one team**; a team's request flow offers
the opponent club's compatible **teams**; the named-identity path offers only compatible identities; and
a team is told when a request is waiting for its answer — which it never was.

## Verification, and the one gap in it

tsc clean · production build exit 0 · lint 181 (5 errors, 176 warnings), the unchanged baseline ·
9 static guards ok · **827/827** JS tests across every suite in `supabase/tests/js` ·
`team_fixture_authority` **51/51** · `fixture_management_authority` **100/100** ·
`age_eligibility_matrix` 44/44 · `capability_precedence_truth_table` 50/50 ·
`capability_scope_isolation` 22/22 · `capability_override_ceilings` 37/37 ·
`step16_governing_closure` 91/91 · browser `89-team-operations` **39/39** and
`90-team-fixture-authority` **24/24**, run twice with zero residue.

**FROM-EMPTY INSTALLATION IS NOT PROVEN, and the blocker is not this step's.**
`scripts/isolated-clean-boot.sh` aborts while applying
`20270529000000_the_legacy_estate_stops_being_reachable.sql`, on its guard
`Step 17: a live pending legacy guardian invitation lost its token`. That guard requires a live pending
`guardian_invitations` row carrying a token. Nothing in the migration chain inserts one — the only
inserts are inside RPC bodies — and `supabase/seeds/*` are applied *after* migrations, so the guard
cannot be satisfied by an empty database. It passes locally only because this database holds such a row
(expiring 2026-10-02). This step's migrations sort after it and were therefore never reached, so no
from-empty claim is made for them. Left unfixed deliberately: the legacy-estate retirement slice owns
that migration, and rewriting another slice's guard is the owner's call.
