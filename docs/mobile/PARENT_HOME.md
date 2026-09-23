# Parent/Guardian Home — visual rebuild

Banked locally. **No migration.** Every attractive thing on the screen traces to a
canonical Ovalball record.

## Audits first — what exists, and what does not

| Product | Canonical source | Review world |
|---|---|---|
| **Club colours** | `club_kits` (variant `primary`) → `resolveClubTheme` — already shared, already contrast-measured | present |
| **Announcements (notices)** | `club_announcements` → `listLiveClubNotices`; **audience enforced by the table's own SELECT policies** | **1 published**: "Car park closed for resurfacing" |
| **Messenger announcements** | `my_announcements()`, delivery-scoped on `recipient_user_id = auth.uid()` | **0 delivered** |
| **News** | `club_articles` → `listClubNews` | 2 rows, **0 published** |
| **Subscription** | `get_enrolment_eligibility` → `player_subscription_payers` → `gocardless_*` | **0 programmes, 0 payers, 0 mandates** |

So Home shows **one real announcement**, **no news section**, and **no membership
card** — because there is nothing canonical to show. The mock-up's "Club
Membership · Active · Valid until 31 August 2027", "A Great Start to the Season"
and "Training on Friday" are **not** in the app; a test fails the build if any of
them appears.

## Information architecture

```
HEADER            signed-in person · club context · Messages / Notifications / Support
CHILD CHIPS       only where there is a family to choose between
HERO              swipeable: next match, next training
ANNOUNCEMENTS     only if canonical
LATEST NEWS       only if canonical
SUBSCRIPTION      only if canonical, one card per child
```

**Removed:** the greeting line, `Next Up`, **`This Week`**, the Calendar shortcut,
the repeated agenda rows, quick actions, the promotional band. Home answers *what
do I need to know now*; Fixtures answers *what matches are coming*; the Calendar
answers *what is happening across my rugby life*. Three jobs, three screens.

## Hero

`projectHomeHero` reuses **`projectParticipantMatch`** and
**`projectParticipantTraining`** — the same projections behind the Calendar card.
A test asserts the hero and the card agree on home/away, both clubs, both crests,
kick-off, meet time, venue, classification and the child. *Presentation differs;
truth cannot.*

Ordered by **what is actually next**, not by alternating categories — and both
kinds earn a page even when three matches come first. Cancelled events never take
the hero. Swiped, never auto-rotated. Dots only where there is more than one page.
An outstanding answer is asked **where the event is** ("Availability needed"),
using the canonical `needsAttendanceResponse`, so it appears and disappears in step
with the Calendar row.

Whole card tappable → **View Match Centre** / **View Training Centre** through the
one destination table. No fixture console, ever.

## Club personalisation

`club_kits` → `resolveClubTheme` (existing, shared) → **new
`clubAccentsOnDark(theme, forest)`**, which projects the same canonical colours
onto the dark ground the app actually uses. It **adds no source and invents no
colour**: each kit colour is lightened only as far as it must be to clear 3:1 on
forest.

- Near-black kit → lifted until visible (tested).
- White/yellow kit → visible, and its ink still reads at 4.5:1 (tested).
- **Two shades of one blue** → pushed apart until distinguishable, using the club's
  own colour rather than an invented third (this test **found a real defect** —
  the first implementation returned two accents at 1.03:1).
- No kit at all → Ovalball's default, and `source` says so.

**Ovalball stays the application.** The accents are a ball, an edge, a chip and a
wash; the page is forest whatever the club wears. A Club Admin changing the home
kit on the web changes `club_kits`, and the next read projects it — no mobile
colour table, nothing to synchronise.

**The ball is drawn, not generated**: one app-owned shape taking the club's two
accents. A test forbids any image, URL or `require()` in it.

## Announcements, news, subscription

**Announcements** — `listLiveClubNotices` over `club_announcements`, whose SELECT
policies decide the audience; nothing is fetched broadly and filtered on the
device. One item, priority in words, the club's colour as an edge.

**News** — `club_articles`. An article with no picture gets a **branded surface in
the club's colours**, never stock photography.

**Subscription** — `get_enrolment_eligibility` (the **family** authority) and the
GoCardless records behind it. **Deliberately not `finance.subscription.view`**,
which is a team-staff rule for a different question. Statuses are the provider's
own words — "Submitted to your bank, not yet active" is not collapsed to "Paid".
Only a genuine absence or failure is drawn as attention; a provider processing
state is not a task. Tapping hands off to the canonical parent subscription page;
**mandate entry stays on GoCardless's own pages** and a test forbids bank-detail
inputs on Home.

`programmeName` is **"Membership"** — the platform's own word throughout the
payments domain. `club_subscription_programmes` has **no `name` column**, so
"Club Membership" had no canonical source and is not used.

## Proof

**105 suites, 1124 assertions, 0 failing** — new `parent_home_experience` (28):
hero↔card consistency, hero ordering, four club-colour cases, the payment
projection, and the absence of every invented string. Guards pass. Both typechecks
clean, no new lint, iOS bundle builds. **No SQL and no migration.**

## Owner walkthrough

Sign in as `uat.manyhats` (Ava, Ovalball UAT RUFC).

1–4. Header identity is **Ffion Meredith's** avatar with Ava's parent context; the
accents are Ovalball UAT RUFC's own home kit.
5–7. Hero leads with the next thing; swipe for the other; dots track it.
8–9. **2 Oct** is a home fixture — our crest left — labelled **League Fixture**;
**25 Sep** is away, opposition crest left. **20 Jan** has no match type and shows
no chip.
10–12. Tap match → Match Centre; tap training → Training Centre.
13–16. Multi-child: use `uat.guardian.two`.
17–18. One announcement: "Car park closed for resurfacing".
19–20. **No news section** — nothing is published.
21–23. **No subscription card** — the club runs no programme.
24–30. Materially calmer: no This Week, no quick actions, no banner.

## Gaps reported, not invented

- **No published news** and **no delivered messenger announcements** in the review
  world; both sections are absent rather than filled.
- **No subscription programme** at this club — `get_enrolment_eligibility` returns
  no rows, so the card is absent. The component is real and will draw the moment a
  programme exists.
- `club_subscription_programmes` has **no name**; "Membership" is the platform's
  word, not the mock-up's.
- **Adult-player avatars**: the web lets an adult player use their own account
  picture as their player avatar; mobile does not. Carried over from the Calendar
  review — unchanged for any child, still recommended as its own pass.

## Remaining debt

Fixtures still uses the old row (the expanded match variant is modelled and
unimplemented). Match Centre keeps its older treatment. The hero's date formatter
is local to the component and could join the shared presentation module.

---

# Visual correction — why the device looked nothing like the reference

## Root cause of the pale-grey hero (and every grey card)

Two defects compounding:

1. **`mix(a, b, t)` weights `b` by `t`.** I wrote `mix(primary, ground, 0.08)`
   meaning "8 % club colour over forest". It meant **92 % club colour, 8 % forest**.
   Every card surface (`wash`) was therefore almost the raw accent.
2. **This club's canonical primary is `#14532d`** — a dark green almost identical
   to Ovalball forest. To make it *visible* on forest the projection lifts it toward
   white, landing on `#ecf1ee`. 92 % of that is a pale grey card.

Then chalk text was written on it → the "disabled / unloaded" look. The announcement,
news and subscription cards all used the same `wash`, so the whole page went grey.

## Canonical club colours resolved (Ovalball UAT RUFC, `club_kits` variant `primary`)

| Canonical | Value | Projected on forest | Used for |
|---|---|---|---|
| primary | `#14532d` (green) | lifted to `#ecf1ee` | ball body, edge tint, crest plate ground |
| secondary | `#ffffff` | `#ffffff` | ball seam ink |
| accent | `#f59e0b` (amber) | **`highlight` = `#f59e0b`** | kind chip, action pill, dots, ball hoops, announcement edge, news bars |
| hero ground | forest + 22 % raw primary, clamped | `#0a281a` → `#082217` | the hero gradient — **chalk reads at 15.0:1** |

The kit is **green / white / amber, not navy / gold** — the mock-up's palette was the
illustrator's, not the club's. The amber is what personalises the page; a new
`highlight` picks the more chromatic visible accent so a club whose primary
disappears into forest still reads as itself.

## Corrections

- **Hero**: dark club-tinted SVG gradient (`heroBase` → `heroDeep`) with an amber glow
  in the ball's corner; crest on a chalk plate so its own colours survive; text never
  on a light ground. `darkTint` refuses to lighten the ground past 4.5:1 for chalk — tested
  for green, white, navy and near-black kits.
- **Training words**: `timeLine()` — a match says `KO 10:30 · Meet 09:45`; a session
  says `18:00–19:30`, or `Starts 18:00`. No KO on any training path (tested).
- **Duplicate U12**: training subtitle removed; each line carries one fact.
- **Ball**: rewritten in `react-native-svg` — ellipse, shaded lower half, hoops cut to
  the ball's edge, seam and laces — sitting whole at the card's inner corner.
- **Carousel**: capped at one match + one training. Four dots were four real events;
  the extra two were a list, and lists are Fixtures/Calendar.
- **Announcement / news / subscription**: `surface.forestRaised` (one step up from
  the page) with chalk text; club amber only as the edge, icon and bars. News
  fallback is now a designed dark tile with the club's two bars and the category,
  not a grey block with a megaphone.

## Avatar — traced again, live, as the signed-in guardian

| | Who | `avatar_storage_path` |
|---|---|---|
| Top-left header | **Ffion Meredith** (`uat.manyhats`, the guardian) | `…/avatar-1790149260277.jpg` (public `avatars`) |
| Participant "Ava" | **Ava Whitaker**, a child player, no login | **NULL** |
| `player-avatars` bucket | | **0 objects** |

**Different people.** The header title says "Ava Whitaker" because a parent context is
named after its child; the photograph is the adult beside it. Ava has no player
photo anywhere, so initials are correct on every player surface. Nothing was copied.

## Proof

105 suites, **1132 assertions, 0 failing** (`parent_home_experience` now 36, eight of
them pinning these corrections). Both typechecks clean; iOS bundle exports. **No SQL,
no migration**, no authority code touched — no RED re-run needed.

## Screens ready for the physical device

A Training hero (23 Sep) · B Match hero (25 Sep, away; 2 Oct, home) · C swipe between
them with two dots · D the car-park announcement · E news with image — **none
published, so not reproducible** · F news fallback — likewise not reproducible until an
article is published · G subscription — **no programme at this club, card absent** ·
H full scroll.

# Full visual recolour + Higgsfield asset pass

The all-dark Home was rejected. The structure stays (header → child filter → revolving
Match/Training hero → Announcements → Latest News → Subscription → bottom nav); the
visual system is rebuilt to the Calendar's: a light application frame, ONE strong forest
feature, white cards.

## Where forest was removed, and where it remains

| Surface | Was | Now |
|---|---|---|
| Page | `surface.forest` | **`surface.page` (chalk)** — new token |
| Header | forest tone | chalk tone (forest icons, ink text) |
| Child chips | on forest | on chalk |
| Hero | club-tinted forest + SVG ball | **photograph + controlled forest overlay** — the one forest feature |
| Announcement / News / Subscription | `surface.forestRaised` | **`surface.card` (white) + hairline**, ink text |
| Carousel dots | chalk | ink, active dot in the club's light-safe accent |
| Bottom nav | dark forest | **unchanged**, dark forest |

## The rugby ball

`club-ball.tsx` **deleted** (`git rm`). Not resized, recoloured or moved; nothing draws
another. `parent_home_experience` asserts the file is gone and that the hero contains
no `ClubBall`, `<Ellipse`, `hoopPath` or ball asset.

## Higgsfield — asset tool only

CLI, workspace `7e45…0755`, model `flux_2` (1 credit / image). **17 credits spent, 3
remain.** Every generation was reviewed by eye for: real rugby union (H posts, pitch),
no malformed ball, no lettering, no fake crest/brand/sponsor, no faces as subject,
negative space, portrait for heroes.

| Generation | Verdict | Reason |
|---|---|---|
| hero-match-1 | rejected | readable sponsor boards, brand mark on post protectors, numbered shirts, faces |
| hero-match-2 | rejected | clubhouse sponsor lettering, numbered shirts |
| **hero-match-3** | **approved → `hero-match.jpg`** | posts sharp, everything human/textual blurred beyond reading, sky as negative space |
| hero-training-1/2/3 | rejected | fake lettering / pseudo-brand on the ball; -2 malformed lacing |
| hero-training-4 | rejected | emblem on the tackle bag |
| hero-training-5 | rejected | mark on the sled pad; half a person cut at the frame edge |
| **hero-training-6** | **approved → `hero-training.jpg`** | dusk, posts, clubhouse silhouette, drill cones, nothing legible |
| news-matchday/-training/-community/-general (first set) | 4 × rejected | 3:2 not offered; re-run at 4:3 — protector/sponsor lettering, badges on pads, marked balls |
| news-matchday-2 | rejected | faces toward camera, badge on post protector |
| **news-community-2** | **approved → `rugby-community.jpg`** | golden-hour clubhouse, supporters from behind, plain railing |
| **news-general-2** | **approved → `rugby-general.jpg`** | frost line, posts in mist; distant boards illegible |
| **news-training-2** | **approved → `rugby-training.jpg`** | players from behind through floodlit mist |
| **news-matchday-3** | **approved → `rugby-matchday.jpg`** | posts framing a huddle from behind, plain protectors |

Stored under `apps/mobile/assets/editorial/` as JPEG (1.2 MB for six; each 127–266 KB),
referenced ONLY from `src/components/home/editorial.ts` via `require()`, so they ship in
the bundle (verified byte-for-byte in `expo export --platform ios`). Rejected files stay in
the session scratchpad and are not in the repo. The Ovalball logo and every club crest
were never requested from Higgsfield; the two protected root logo files are untouched.

## Hero

Photograph (`contentFit="cover"`, `contentPosition="top"`, `accessible={false}`) on a
`heroBase` ground → vertical forest overlay (0.42 → 0.18 → 0.62 → 0.94 opacity, so the
picture lives at the top and the words at the bottom) → a faint club-accent breath at
the foot → native content: kind chip in `accents.highlight`, canonical `game_type` chip,
crest on a chalk plate, `sideLabel` title / `vs` / team line, date, `timeLine()`, venue,
`ChildMark`, "Availability needed" chip, and a **refined CTA**: chalk pill with forest
ink (always safe on every club's photograph), not a painted club block. A kind with no
artwork falls back to the tinted forest gradient rather than a broken image.

## Cards

`AnnouncementPreview`: white card, 4 px club rule (danger red for URGENT), priority + team
in ink-muted, title/body in ink. `NewsCard`: image first (article's own → editorial
fallback by category → forest tile), category dot in the club accent, title in ink.
`SubscriptionStatusCard`: white; colour is the **state** (green / amber / red disc + chip),
never the club. `SectionHeading` in ink, "View all" in forest.

## Canonical club colours, and a new light-safe projection

Still `club_kits` variant `primary` → `resolveClubTheme` → `clubAccentsOnDark`. New
field **`highlightOnLight`**: the most chromatic kit colour darkened toward black until it
stands ≥ 3:1 off white; a white kit gets forest. Tested for green/white/amber, white/yellow,
navy/gold and sky-blue kits. Review club (`#14532d / #ffffff / #f59e0b`) → accent rule and
dots in a darkened amber; highlight chip stays `#f59e0b`.

## Domain unchanged

No SQL, no migration, no loader change, no new read. `loadHomeSummary`, the projections,
`listLiveClubNotices`, `listClubNews`, the subscription domain and `routeForAgendaItem`
are exactly as banked in `93823cd`.

## Proof

`parent_home_experience` **39** (rewritten: chalk page, no ball, bundled artwork, light
cards, refined CTA, light-safe accent); `parent_home` 42, `mobile_parent_shell` 30,
`family_calendar` 54, `participant_match_card` 37, `match_centre_parent` 17,
`participant_routing` 20 — **239 assertions, 0 failing**. Content-standard and
availability guards pass. Both typechecks clean. `expo export --platform ios` succeeds
with all six assets in the bundle. Not done: an on-device screenshot — the physical
iPhone review is the owner's.
