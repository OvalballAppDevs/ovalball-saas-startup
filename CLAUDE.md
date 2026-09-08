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

## Protected identity information

A player's gender is recorded as `players.playing_pathway` (`MALE` / `FEMALE`)
and shown to people as **Gender**. Only an active guardian, the adult player
themselves, or a Full Site Admin may record it —
`internal.may_complete_player_profile`. Club and team staff may **ask**
(`request_player_playing_pathway`); they may not answer. Do not reach for
`internal.can_manage_player` here: that is a fixture-and-roster authority, and
using it would widen staff authority over a child's identity.
