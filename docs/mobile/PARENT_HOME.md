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
