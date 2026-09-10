# Big Product Programme — Resumption Checkpoint

**Date:** 8 September 2026
**Scope:** Fixtures ↔ Calendar ↔ Match Centre ↔ Rugby Hub
**Status:** READ-ONLY assessment. Nothing was implemented, migrated, pushed or merged.

---

## A. Baseline

| | |
|---|---|
| HEAD | `39c48a2` — *refactor: buttons and form labels are Title Case, site-wide* |
| Branch | `rugby-hub/phase-4b-regulatory-population` (no upstream configured) |
| Ahead of `origin/main` | 50 commits |
| Working tree | Clean at the start of this checkpoint |
| Migrations | 328 files ↔ 328 ledger rows (in step) |

The branch name is itself the most reliable statement of where the programme
stopped: it was cut for Phase 4B and never renamed, and 4B is the last Rugby
Hub phase in the log.

---

## B. Roadmap reconstructed from the commit history

| Phase | Commit | What it delivered |
|---|---|---|
| 1 | `a33674e` | Match Centre — real data integration |
| 2 | `653e11d` | Rugby Hub schema (tables only, no content) |
| 3 | `bd9c381` | Regulatory content import |
| **3A** | `d00b904` | **Match Centre core — meet time, weather, venue, premium hero** |
| — | `f00f3f9` | Staff communications |
| 4 | `a190ac1` | Accessibility audit |
| 4A | — | `docs/rugby-hub/content-architecture.md` written |
| **4B** | `bb71538` | **Regulatory population — last programme commit** |

Everything after `bb71538` on this branch is a different workstream: team
taxonomy, registration, adult self-registration, the Match Centre shared-surface
rule, mobile closure and the content standard. The four-surface programme has
been paused since 4B.

### The declared next step was never started

`docs/rugby-hub/content-architecture.md` §10 sets the Phase 4C build order:

> At-a-Glance cards → interactive pitch → positions → timeline → quiz

None of it exists. `app/(app)/rugby-hub/` contains exactly four routes —
`page.tsx`, `rules/`, `safeguarding/` (plus `safeguarding/contact/`) and
`player-welfare/`. There is no My Rugby, How We Play, Positions, History, Fun
Facts, Quiz or Union vs League.

---

## C. What was browsed

Signed in as **Priya Nair**, Player context, Ovalball UAT RUFC · Women's 1st
Team. The product owner's Site Admin account was not used.

The same fixture — `1f0c890d-514f-4340-9721-42c0ab88e13e`, Women's 1st Team v
Wharfedale Ladies RUFC, Sat 12 Sept 14:30 — was followed across all four
surfaces, so every observation below is about one real fixture rendered four
ways.

390px was measured by rendering each route in a same-origin 390px iframe;
Chrome's macOS window minimum is ~500 CSS px, so window resizing cannot reach
390 honestly.

---

## D. Match Centre — the finished surface

This is unambiguously the most complete surface in the product, at both widths.

Present and working: dark forest hero; "Awaiting opposition" pill; **club crest
and kit rendered at equal size side by side** either side of a VS divider;
opposition placeholder with ghost kit; HOME FIXTURE; a DATE / MEET / KICK-OFF
strip; four attendance count tiles; Your availability with three states; VENUE;
WEATHER; FIXTURE ADMIN (Meet Time + Save); COMMUNICATION (reminder, message
attendees, message team); WHO'S IN chips; MESSAGES.

At 390px it holds together completely — no horizontal overflow, no collapsed
text, and the hero's crest/kit pairing survives the narrow width intact.

**The shared-surface invariant holds.** Every capability section still renders
in Player context. Capability decides what appears, not active context, exactly
as the platform rule requires.

---

## E. Fixtures (`/agenda`) — structurally sound, visually empty

One flat card per event carrying: a **generic `CalendarDays` glyph, identical
for every fixture** (`app/(app)/agenda/page.tsx:252`), the title, `date · time`,
an availability pill and the team name.

Absent: crest, kit, home/away, venue, meet time, status.

At 390px it is clean — no overflow, no collapse — but it is the same flat list.
It reads as a calendar export, not as a rugby fixture list, and gives no visual
clue that the Match Centre behind it is rich.

---

## F. Calendar — the best responsive behaviour, the same identity gap

Desktop: season selector, Week/Month, Filter, an Agenda link, and a team-lane
week grid. The fixture appears as a single amber chip — "⚠ Wharfedale Ladies
RUFC / H · 14:30". Clicking opens a quick-view sheet with Planned, Date, Kick
Off, Home/Away and **Open Match Centre**.

At 390px the team-lane grid is correctly abandoned for a stacked day list. This
is the strongest responsive adaptation in the product and should be the model
for the others.

The quick-view sheet carries no venue, no meet time and no crest — so the
richest cross-surface entry point into Match Centre still under-sells it.

---

## G. Dashboard — one confirmed 390px defect

**THIS WEEK rows collapse the fixture title to a single character at 390px.**

Measured in the 390px frame: the fixture title
`<p class="truncate text-sm font-medium text-ink">` has `clientWidth` **6px**
against `scrollWidth` **315px**. On screen it renders as "V".

Cause — `app/(app)/dashboard/page.tsx:230`:

```
<li className="flex flex-wrap items-center gap-3 …">
  <div className="min-w-[7rem] shrink-0"> … date …
  <div className="min-w-0 flex-1">        … title …
  <span className="shrink-0 …">Planned</span>
  <span className="shrink-0 …">Action needed</span>
```

Every sibling is `shrink-0`; only the title lane can give way. `flex-wrap`
never triggers because the flexible child absorbs the deficit by shrinking to
near-zero instead of forcing a wrap. `RequestListRow` (line 259) has the same
shape and the same latent defect.

The accessible text is intact (`Women's 1st Team vs Wharfedale Ladies RUFC` is
in the DOM), so this is a visual defect, not a semantic one — but on the surface
a player opens first, the fixture is unreadable.

---

## H. Rugby Hub — a documentation index, not a rugby companion

Four tabs (Overview, Rules, Safeguarding, Player Welfare), a VIEWING team
switcher, a disclaimer paragraph and three plain link cards with pale mint icon
circles. No imagery, no fixture context, no player context beyond the switcher.

Three concrete observations:

1. **Adult teams get no regulatory content at all.** `/rugby-hub/rules` for
   Women's 1st Team returns: *"This age group hasn't been mapped to a
   regulatory identity yet — age-grade rules aren't available here for it."*
   Phase 4B populated age-grade regulation; adult sides were never covered, so
   for an adult player the Hub's primary tab is empty.
2. **Duplicate header chrome.** The dark app header is followed by a second
   white "OVALBALL … Rugby Hub" bar. Rugby Hub is the only surface that stacks
   two brand bars, and at 390px it costs a full band of vertical space. The
   eyebrow "RUGBY HUB" then repeats directly above the "Rugby Hub" H1.
3. **The team switcher offers all 15 club teams** to a single-team adult
   player — Under 8 Mixed, Under 9 Mixed B, Under 12 Girls and the rest. Not a
   privacy defect (team names are not sensitive), but the scoping is
   unconsidered.

At 390px the tab strip clips "Player Welfar…" at the right edge with no visible
scroll affordance.

---

## I. Cross-surface consistency

**What is consistent:** the fixture identity itself. One `fixture_id` flows
Dashboard → Fixtures → Calendar → Match Centre with the same team name, date and
kick-off throughout. The canonical team naming work has held — "Women's 1st
Team" is the same string on every surface.

**What is not:** visual identity. The same club renders a real crest in Match
Centre and grey initials everywhere else.

### The root cause, and it is narrow

`lib/app-context/active-context-rules.ts` builds every switchable context. Only
the **club-membership** context carries a crest:

- line 147 — club membership: `logoUrl: m.clubLogoUrl` ✅
- lines 162, 183, 214, 230, 247 — team, family, parent (×2) and **player**
  contexts: `logoUrl: null` ❌

Every one of those contexts carries a real `clubId`; the crest is simply never
resolved for them. Match Centre escapes this because
`lib/app-context/match-centre-data.ts` resolves the crest from the *fixture's*
club rather than from the active context.

So the Dashboard tile rendered "WO" — the first two letters of "Women's 1st
Team" via `ClubAvatar`'s initials fallback — for a club that demonstrably has a
crest, because a Player context is built with `logoUrl: null`. The same null
flows into the sidebar and mobile nav through `build-nav-items.ts:195,311`.

One fix point; four surfaces improve.

### No shared fixture component exists

`components/fixtures/` contains only `csv-upload-form.tsx`,
`import-review-panel.tsx` and the `match-centre/` set. Agenda, Calendar and
Dashboard each hand-roll their own fixture row markup. That is why the
Match Centre's treatment has no route out to the other surfaces, and why the
Dashboard's flex bug exists in one place and not the others.

---

## J. Recommended next phase — ONE

### Phase 4C: The Fixture Identity Card

**Bring the Match Centre's fixture identity out of Match Centre and make it the
shared way Ovalball draws a fixture.**

This is deliberately *not* the Rugby Hub 4C in the content architecture doc.
That build order — At-a-Glance cards, interactive pitch, positions, timeline,
quiz — is a large greenfield content programme on the weakest surface, and its
first tab is currently empty for adult players. It is the right work eventually;
it is not the highest-value next slice.

**Why this one:**

- It honours the standing rule the product owner set: when one surface is
  richer, the others **inherit** it — the answer is never to level the rich one
  down. That rule was set about Match Centre specifically, and this is the phase
  that acts on it.
- It has a genuine before/after: every fixture on Dashboard, Fixtures and
  Calendar goes from a grey generic calendar glyph to the crest, kit, home/away,
  venue and meet time that Match Centre already renders.
- The data already exists and is already resolved — this is composition and one
  null, not new schema and not a migration.
- It fixes the confirmed 390px Dashboard collapse as a consequence of replacing
  the hand-rolled row, rather than as a separate patch.
- It is bounded: one new shared component, one context field, three consumers.

**Shape of the work:**

1. `components/fixtures/fixture-card.tsx` — one shared card owning fixture
   identity: crest, kit, opponent, home/away, date, kick-off, meet time, venue,
   availability. Derived from the Match Centre hero's existing treatment, sized
   for a list rather than a hero.
2. Resolve `logoUrl` for team, parent and player contexts in
   `active-context-rules.ts` — each already holds the `clubId` needed.
3. Consume the card in `agenda/page.tsx`, the Calendar quick-view sheet and the
   Dashboard's `FixtureListRow`, retiring the three hand-rolled row markups.
4. Re-measure all three at 390px.

**Explicitly out of scope for this phase:** any Rugby Hub content build, the
adult regulatory-content gap, the duplicate Rugby Hub header, and the Rugby Hub
team-switcher scoping. Those are recorded in §H and should be their own phase.

---

## K. Open items recorded but not actioned

| Item | Where | Severity |
|---|---|---|
| Dashboard THIS WEEK title collapses to 6px at 390px | `dashboard/page.tsx:230`, same shape at `:259` | Visual defect, confirmed |
| Adult teams have no Rugby Hub regulatory content | `/rugby-hub/rules` | Product gap |
| Rugby Hub stacks two brand headers | `rugby-hub/` layout | Visual inconsistency |
| Rugby Hub tab strip clips at 390px | `rugby-hub/section-nav.tsx` | Minor |
| Rugby Hub switcher offers all 15 club teams to one player | `rugby-hub/` | Scoping question |
| Non-club contexts carry `logoUrl: null` | `active-context-rules.ts:162,183,214,230,247` | Root cause of §I |
| Header icon buttons are 40px, support bubble 32px | app shell | Below the 44px standard |

---

*Produced as a read-only checkpoint. No product code, schema or configuration
was changed; this document is the only file created.*
