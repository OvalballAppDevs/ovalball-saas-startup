# Ovalball — working rules

Read this before writing user-facing copy or touching a person's name.

## Content and presentation standard

Five rules. They apply to all current and future Ovalball work.

**1. Product navigation and page/section titles use Title Case.**

Navigation labels, page titles, routed-section titles, card and dialog
headings that name a region or a task, and metadata titles.

> Clubs & Teams · Team Management · Season Handover · Match Centre · Rugby Hub
> Site Admin · Club Admin · Team Admin · Needs Attention · Apply & Audit

Never `Clubs & teams`, `Season handover`, `Match centre`.

**2. Body copy uses UK English sentence case.**

Paragraphs, helper text, descriptions, form guidance, notifications, errors,
statuses and empty states.

> Nothing changes until you apply the handover.
> This club does not currently run Girls U12.

Not `Nothing Changes Until You Apply The Handover.` A sentence is not a title.

Buttons are actions, not destinations, so they are sentence case too — `Save
changes`, `Add player`, `Apply handover` — unless the button IS a named
destination, in which case it is that destination's name: `Match Centre`. Form
labels follow the same rule: `First name`, `Date of birth`, `Rugby code`.

UK spelling throughout: organisation, authorised, customise, centre, licence
(noun) / license (verb). Do **not** rewrite technical identifiers, import
paths, library names, database enum values, or quoted governing-body source
material — `team-authorization.ts` and `EXTERNAL_APPROVAL_REQUIRED` stay as
they are, because they are not prose.

**3. Person names are normalised server-side and stored professionally.**

`internal.normalise_person_name` is the one normaliser, applied by triggers on
every table holding a canonical person name. Never format a name in CSS, in a
React component, or in a second helper: the database value is what an export,
an email and a screen reader see.

It cleans obviously unformatted input (`callum krzysik` → `Callum Krzysik`) and
leaves deliberate spellings alone (`McDonald`, `O'Neill`, `de Silva`,
`van der Meer`), so a corrected name is never re-spelled. An authorised person
can always correct their own name by hand.

Club and team names are **not** person names. `teams.display_name`,
`club_pitches.display_name` and the Club Directory have their own canonical
authorities, and person-name rules would corrupt `Girls U12` and `Men's 1st`.

**4. Acronyms and rugby identifiers keep their official form.**

RFU, RFL, DOB, UK, ID, URL, API, CSV, U6…U19, GoCardless, Mini-Rugby.
Never `Rfu`, `Dob`, `u12`. `lib/content/title-case.ts` holds the protected
list; add to it rather than special-casing at a call site.

**5. Marketing typography may intentionally differ.**

The public marketing surfaces (`app/clubs`, `app/game-management`,
`app/payment-services`, `app/public-fixtures`, `components/site/*`) use
editorial sentence-case headlines and display typography on purpose. Do not
"correct" them. The standard governs product UI.

## Guardrails

`scripts/verify-content-standard.mjs` checks canonical navigation labels,
known product title constants, protected acronyms and duplicate labels for one
destination. It runs as part of `scripts/run-platform-tests.sh`. It is
deliberately not a lint rule over English prose — those reject legitimate
writing and get switched off.

Name normalisation has permanent SQL coverage in
`supabase/tests/person_name_normalisation.sql`.

## The canonical Team Directory

One directory of team identities, and one way of naming them.

**Structured identity, never editable free text.** A canonical identity is
`(rugby code, category, age grade, pathway, squad)`. Its name is *derived* from
that — `internal.canonical_team_presentation` in the database,
`compactTeamLabel` / `fullTeamLabel` in TypeScript. There is deliberately **no
rename control**: if wording needs to change, change that one rule and let it
propagate. Adding a free-text rename is an explicit product decision against,
and a test fails if one appears.

**Two forms, one source.**

| | | |
|---|---|---|
| compact | `U12`, `Girls U14`, `Men's 1st` | dense surfaces — Calendar lanes, filter chips |
| display | `Under 12 Boys`, `Under 14 Girls B`, `Men's Open Age` | **what a team is called everywhere else** |

The display form is the site-wide display name: team management, fixtures,
signup, handover, Match Centre. `Under 12` alone said nothing about whether a
side was boys, girls or mixed, so a club running both saw one described by what
it is and the other by what it is not. A team whose pathway was never recorded
gets **no** pathway word — Ovalball does not assume one.

**Union and League are strictly isolated.** A Rugby Union club is never shown
Rugby League catalogue data, and never the reverse — not as an option, a
disabled option, a filter, a fallback or a "not offered" warning. Telling a
union club that Men's Open Age is unavailable is telling it about a sport it
does not play.

Scope it in the **query**, not the browser: read
`canonical_team_types_by_code` filtered by `rugby_code` and `is_offered`.
Loading both catalogues and hiding one works right up until somebody renders
the unfiltered array. `supabase/tests/rugby_code_isolation.sql` guards this.

Site Admin is the one deliberate exception, and manages both codes by
*choosing between* them (`/admin/team-directory?code=union|league`), never by
mixing them into one list. Rugby Hub may carry cross-code educational content;
a player's own guidance stays in their code.

**Isolation is scoping, not deletion.** Never remove the other sport's
identities to keep a view clean.

**Internal keys never appear in normal UI.** `u12`, `girls_u14`, `mens_1st`
are stable identifiers. **B/C squads are operational**, an arrangement inside a
club, not part of the canonical identity — the directory shows identity first.
**Historical snapshots stay historical**: `team_season_identity` records what a
team was called in a season that has happened, and is not re-spelled because
presentation improved.

**Directory grouping** (`lib/teams/directory-taxonomy.ts`): Minis, Juniors,
Youth, Girls, Adult Men, Adult Women, Retired. Minis (mixed), Girls and the
adult groups are structural. The **Juniors/Youth split is PRESENTATION_ONLY** —
no governing body draws that line, and it must never decide eligibility or
progression.

## Protected identity information

A player's gender is recorded as `players.playing_pathway` (`MALE` / `FEMALE`)
and shown to people as **Gender**. Only an active guardian, the adult player
themselves, or a Full Site Admin may record it —
`internal.may_complete_player_profile`. Club and team staff may **ask**
(`request_player_playing_pathway`); they may not answer. Do not reach for
`internal.can_manage_player` here: that is a fixture-and-roster authority, and
using it would widen staff authority over a child's identity.
