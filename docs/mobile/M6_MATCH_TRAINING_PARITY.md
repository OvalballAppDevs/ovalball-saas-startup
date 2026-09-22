# M6 — Match Centre, Training Centre and Availability: the parity map

One Ovalball Match Centre. One Ovalball Training Centre. One availability
question. This is the implementation checklist the slice was built against, and
the record of what is deliberately native, what is deliberately absent, and what
needs an owner decision.

Checkpoint before this slice: `5d615ca`.

---

## 1. What the web product actually is

Recovered from the repository and from the rendered pages at 390px, not from
notes. Evidence in `docs/mobile/evidence/`.

| | |
|---|---|
| Match Centre route | `app/(app)/fixtures/[fixtureId]/page.tsx` — the fixture page **is** the Match Centre |
| Match Centre view model | `lib/app-context/match-centre-data.ts` → `getMatchCentreContext` |
| Training Centre route | `app/(app)/training/[sessionId]/page.tsx` |
| Training Centre view model | `lib/app-context/training-centre-data.ts` → `getTrainingCentreContext` |
| Availability control | `components/shared/availability-choice.tsx` — one control, both surfaces |
| Register palette | `components/shared/attendance-groups.tsx` |
| Register words | `lib/attendance/vocabulary.ts` |

**Section order, Match Centre:** matchday card (with the viewer's own answer
inside it) → Match Conditions → Who's In → community (completed matches only) →
Message Opposition → Conversation (with the staff announce folded in).

**Section order, Training Centre:** session card (with the answer inside it) →
Training Conditions (the *same* component, one word changed) → Session Plan →
Who's Training → Tell The Squad.

**Capability gating, proved live at 390px against fixture
`38f11923…`:** a Club Admin sees hero · Match Conditions · Who's In (3 players) ·
Conversation (13 messages) · Communication. A guardian on the same fixture sees
hero · Match Conditions · Conversation — **no Who's In and no Communication**.
Same structure, different data and actions.

---

## 2. Parity map

`SAME` = same product experience, same words. `NATIVE` = same intent, different
device control, reason given. `ABSENT` = deliberately not built, reason given.

### Availability

| Web feature | Canonical source | Server / RPC | Capability | Mobile projection | Parity |
|---|---|---|---|---|---|
| Three answers | `player_fixture_attendance.status` | — | — | `AvailabilityChoice` (native) | SAME — order, words, icons and tones from `@ovalball/contracts/availability` |
| Answer a fixture | — | `respond_to_attendance` | `matchcentre.attendance.respond` | `respondToFixture` | SAME |
| Answer a session | — | `respond_to_training_attendance` | same key | `respondToTraining` | SAME |
| Whom may I answer for | — | `get_my_players_for_fixture` **(new)** / `get_my_players_for_training_session` | resolved inside | `loadMatchCentre` / `loadMyTrainingAvailability` | SAME |
| Refusal wording | `internal.resolve_attendance_response_source` | — | — | carried verbatim | SAME |
| No optimism on write | — | — | — | control moves only on the server's yes | SAME |
| "You haven't responded yet" | — | — | — | `NO_ANSWER_YET` | SAME (and **added to web Match Centre**, which lacked it) |
| Deadline | **none exists** | — | — | none invented | SAME — Ovalball has a 14-day *ask window* (`RESPONSE_HORIZON_DAYS`), not a lockout |

### Registers and summaries

| Web feature | Server / RPC | Capability | Mobile | Parity |
|---|---|---|---|---|
| Who's In (fixture) | RLS on `player_team_memberships` + `get_match_centre_capabilities` | `team.attendance.view` | `AvailabilityRegister` | SAME |
| Who's Training | `get_training_register` (refuses, not filters) | `team.attendance.view` or training management | same component | SAME |
| Four count tiles | — | — | same four, same order, same words | SAME |
| Grouped names | — | — | collapsible, AWAITING open by default | SAME (web uses `<details open>`) |
| "14 of 20 responded" | — | — | `summariseAvailability().progress` | SAME |
| Initials, never photos | — | — | initials disc | SAME |

### Match Centre

| Web feature | Mobile | Parity |
|---|---|---|
| Status pill | shared `matchCentreStatus` + `matchStatusPresentation` | SAME — including "Confirmed" rather than the database's "Booked" |
| Crest + kit at equal size | `ClubCrest` + `RugbyKit` (react-native-svg over shared geometry) | SAME |
| Kit placeholder for an unclaimed side | `KitPlaceholder` | SAME |
| "NOT YET ON OVALBALL" | from canonical club identity | SAME |
| VS / recorded score | same rule: `result_status <> 'none'` | SAME |
| HOME FIXTURE · VENUE | same | SAME |
| Date / Meet / Kick-off strip | same three, same order | SAME |
| Cancelled treatment | desaturated card + reason | SAME |
| Match Conditions: venue, address, Directions | `MatchConditions` | SAME |
| Match Conditions: **map** | Directions only | **NATIVE** — the web pins OpenStreetMap only where the coordinates came from the venue's own postcode; on a phone the device's maps app knows the traffic, and a wrong pin is worse than none |
| Match Conditions: weather | via `/api/fixtures/[id]/forecast` | SAME — the provider key and cache stay on the website; one Met Office adapter, one cache, one unavailable state |
| Pitch name + diagram | `PitchDiagram` (react-native-svg) | SAME |
| Message Opposition | same RPC, same placement | SAME |
| Conversation | opens the canonical thread | **NATIVE** — a composer inside a long ScrollView fights the keyboard; the thread is the canonical M4 surface |
| Announce to the Squad | `AnnounceSheet` | **NATIVE** — bottom sheet rather than an inline disclosure, same audiences, same RPC, same copy |
| Community layer (completed matches) | — | **ABSENT** — recorded as hardening debt; it is its own product with its own locked decisions |
| Manage Fixture link | Fixture Details → Fixture Console | SAME intent |

### Training Centre

| Web feature | Mobile | Parity |
|---|---|---|
| Session card + answer inside it | same | SAME |
| Training Conditions | shared component, "At the Start" | SAME |
| Session Plan (agenda + further notes) | Group "The Session" | SAME |
| Who's Training | same component as Who's In | SAME |
| Tell The Squad | — | **ABSENT** — `training_communication.send` composer not yet native; hardening debt |
| Editing date/time/venue/pitch/agenda | present, gated on `can_manage` | **OWNER-DIRECTED DIFFERENCE** — the web puts these in Training Management; the owner asked for them on the session in M5 ("same concept as the web where we can select venue and pitch") |

### Integration

| | | |
|---|---|---|
| Fixture Console → Match Centre | `/fixtures/<id>/match-centre` | one route, one id |
| Calendar → Training Centre | `/calendar/training/<id>` | never through Fixture Detail |
| Home / Agenda "needs a response" | shared `needsResponse` + `RESPONSE_HORIZON_DAYS` | one rule, both clients |
| Deep-link intents for M7 | `MATCH_CENTRE`, `TRAINING`, `FIXTURE`, `MESSAGE_THREAD` | already typed |

---

## 3. What does not exist, and is therefore not projected

**Team Sheet.** There is no selection model anywhere in the platform: no
starters, no replacements, no shirt numbers, no captain, no publication state.
The only occurrence of the phrase is one sentence of marketing copy in
`app/game-management/page.tsx`. Nothing was invented for the phone.

**Attendance after the event.** There is no `attended` column, no minutes
played, no participation record. `player_fixture_attendance` holds availability
only. The distinction the brief asks about is real and worth preserving — it is
simply that only one half of it exists today.

**Opposition availability.** No canonical cross-club player-response capability
exists. The nearest precedent, `get_partner_team_availability`, is a
busy/free CALENDAR read gated on an explicit `club_partnerships` agreement — not
player data, and not something a fixture creates. See OWNER DECISION below.

---

## 4. Canonical corrections this slice made

Three asymmetries where the fixture half of availability was weaker than the
training half. All three are fixed in the database, where both clients inherit
them. Migration `20270535000000`; permanent proof in
`supabase/tests/availability_one_product.sql` (38 assertions).

1. **A cancelled fixture accepted answers.** The rule lived only in the web
   resolver's `!f.cancelled_at`. Any other caller could record an answer to a
   match that is not happening.
2. **TBD and Not Applicable fixtures were unanswerable.** The writer located the
   fixture's teams through the generated `home_team_id`/`away_team_id` columns,
   which are NULL for both orientations — so a legitimate answer was refused as
   "this player is not associated with a team involved in this fixture" while the
   page offered three buttons.
3. **Mini-Rugby scheduling-group fixtures were unanswerable**, including for a
   child on a partner team inside the group.

Plus one structural correction: **`get_my_players_for_fixture`** now exists as
the twin of the training reader, both carrying `can_respond` and `denial_reason`
inline. The web resolver was assembling the same thing in TypeScript from four
tables plus one authority call per child.

And four vocabulary corrections, all on the web:

- the Agenda's inline control said **"Can Attend / Can't Attend / Maybe"** where
  the shared control said "I'm available / Not available / Unsure";
- the mobile agenda row said **"Going / Can't go"** — a fourth set;
- the Calendar filter and the public availability demo transcribed the register
  words rather than importing them;
- the answer labels were sentence case, which the content standard reversed.

All now come from `ATTENDANCE_ANSWER_WORDS` / `ATTENDANCE_STATE_WORDS`.

---

## 5. Shared contracts added

`packages/contracts/src/availability/` — states, canonical order, tones, both
vocabularies, the question builder, the summary model.
`packages/contracts/src/agenda/fixture-status.ts` — the Match Centre status
derivation and its six words.
`packages/contracts/src/agenda/kit.ts` — the shirt's geometry and its accessible
description.
`packages/contracts/src/weather/types.ts` — the normalised weather contract.

Guarded by `scripts/verify-availability-one-product.mjs` (1656 checks), which
also refuses a platform import inside the availability contract, a second mobile
Match Centre route, a role-named component, and a client that stops calling the
canonical mutations.

---

## 6. OWNER DECISIONS REQUIRED

1. **Opposition availability.** Nothing canonical supports it. Building it means
   a new cross-club capability over children's response data, whose nearest
   precedent is an explicit opt-in partnership rather than a fixture. Smallest
   safe shape if wanted: aggregate ATTENDING count only, both clubs on Ovalball,
   both fixture-managing staff only, no names, no reasons, no unavailable or
   awaiting counts. Not built.
2. **A completed fixture still offers the three buttons** on the web. Answering a
   match that has been played changes nothing. Refusing it server-side would
   change established behaviour rather than enforce it, so the cancelled guard
   was added and this was left alone.
3. **Answer labels are now Title Case** — "I'm Available" / "Not Available" —
   because the content standard says a button is Title Case. The screenshots
   supplied as the reference show the earlier sentence case. Say which wins.
