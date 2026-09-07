# Rugby Hub — content architecture and Phase 4B/4C plan

Phase 4A design output. Nothing here is built yet; this is the model Phase 4B
populates against and Phase 4C renders.

---

## 1. The one architectural decision everything else follows from

**Regulatory truth and editorial content are different kinds of thing, and
must not share a table.**

A regulatory fact ("U9 contact is not permitted above the base of the
sternum") is season-effective, provenance-bound, publication-gated and
supersedable. A fun fact about the origin of the word "try" is none of those.
Forcing the second into `regulatory_facts` would either weaken the controls
that make the first trustworthy, or bury editorial content under a
publication workflow it does not need.

So Rugby Hub needs **seven content types**, of which exactly one already
exists:

| Content type | Exists? | Controls it needs |
|---|---|---|
| `REGULATORY_FACT` | **Yes** — `regulatory_facts` + applicability + citations + content sets + conflicts | Effective dates, provenance, publication gate, supersession, conflict blocking |
| `COACHING_GUIDANCE` | No | Source-backed, age-banded, **explicitly not law** |
| `HISTORICAL_CONTENT` | No | Source-backed, dated, *not* season-effective |
| `PRACTICAL_GUIDE` (registration, process) | No | Change-aware, `last_verified_at`, external links |
| `FUN_FACT` | No | Source-backed, topic/age tagged |
| `QUIZ_ITEM` | No | **References** the above; never authors an answer |
| `VISUAL_DEFINITION` | No | Derived from verified facts only |

The existing regulatory schema is strong and should not be widened to carry
the other six. One source of truth per fact.

### Why quizzes must reference, never restate

A quiz whose answer is typed alongside the question is a second copy of a
regulatory claim, with no citation and no supersession. When the RFU changes
a rule, the rules page updates and the quiz silently starts teaching the old
one. `QUIZ_ITEM` therefore stores a **reference** to the fact, and renders the
answer from it.

---

## 2. Recommended information architecture

The brief's proposed sections are close to right. Two changes:

- **"HOW WE PLAY" and "MY RUGBY" merge.** A parent opening Rugby Hub for
  Pippa wants "what does Pippa play?" — not a dashboard that then links to the
  rules. One surface: **My Rugby**, personalised, leading with her age grade.
- **"GET BETTER" is renamed.** It implies the child is currently bad at it.
  **Skills & Training** says the same thing without the judgement.

```
Rugby Hub
├── My Rugby                 ← personalised; the landing surface
│     My rules · What changed this season · My position · Next up
├── Learn the Game           ← concepts, terminology, interactive diagrams
├── Positions                ← code-specific, structured, one model
├── Skills & Training        ← COACHING_GUIDANCE, age-banded
├── Player Welfare           ← calm; concussion, contact load, return to play
├── Safeguarding             ← governing guidance + this club's officer
├── Registration             ← PRACTICAL_GUIDE; links out to the governing body
├── Playing Up & Dispensation← renders the canonical eligibility outcome
├── The Story of Rugby       ← history, timeline, clubs that shaped it
├── Union vs League          ← comparison; never mixed into My Rules
└── Quiz                     ← generated from verified content
```

**"Explore Rugby" is a mode, not a section.** A U9 reading about the scrum
must never think it applies to her. Anything outside the player's own
regulatory identity renders with a persistent context strip: *"You're
exploring Under 15 rugby. Pippa plays Under 9."* Browsing never mutates the
resolved identity.

---

## 3. Registration (§30C)

Journeys established from first-party sources (see `research-manifest.json`):

**Union** — parent/guardian creates a GMS account, adds the child, actions the
Player Registration prompt, selects the club; the club approves. Annual
renewal. RFU Regulation 14 covers adults separately.

**League** — GameDay. New youth/junior registration requires proof of age
(birth certificate or passport) and a passport-style photo, both uploaded.
Transfers require clearance from the previous club and league approval —
**Union age grade has no direct equivalent**, so the two journeys must not
share one explanation.

### The external-resource model

Registration URLs change. They must not be literals in components.

```
governed_external_resources
  resource_key        -- stable internal identity, never the URL
  authority           -- RFU | RFL
  rugby_code
  purpose             -- REGISTRATION_ENTRY | RENEWAL | TRANSFER | HELP | ...
  title
  url
  effective_from / effective_to
  last_verified_at    -- the field that makes staleness visible
  source_key          -- provenance
```

Ovalball explains the journey in its own words. The governing body remains the
registration authority, and every outbound link is theirs.

---

## 4. Positions (§30D/§30E)

One structured model drives both codes and all positions — never fifteen
hand-built pages.

```
position_definitions
  position_key            -- 'union.openside_flanker'
  rugby_code              -- union | league   (NEVER shared)
  shirt_number
  name / short_name
  unit                    -- forwards | backs | (league) forwards | halves | backs
  purpose                 -- one sentence
  with_ball[] / without_ball[]
  key_skills[]
  adjacent_positions[]    -- drives prev/next navigation
  pitch_anchor {x, y}     -- normalised 0-1, drives the interactive pitch
  age_guidance_note       -- see below
  source_key
```

**Union and League position guidance is never reused across codes.** The
numbering, the unit names and the roles genuinely differ; a shared table with
a `rugby_code` column is fine, shared *rows* are not.

**Age-grade caution is a field, not an afterthought.** Where development
guidance favours broad exposure over early specialisation,
`age_guidance_note` carries it, and young age grades render positions as
"where players often start" rather than as an assignment. Rugby Hub teaches
positions; it does not pick teams.

---

## 5. History (§30G–30J) and the "first rugby club" question

**Phase 4A finding: the claim is genuinely contested, and Ovalball must not
pick a winner.**

What the research surfaced (all of it currently from *secondary* sources, so
none of it is publishable yet):

- **Guy's Hospital, 1843** — recognised by the RFU and Guinness World Records,
  but no contemporary documentation survives; the date rests on a later
  fixture card referring to a 40th season.
- **Dublin University FC, 1854** — the oldest *continuously documented*
  football club of any code.
- **Barnes RFC, 1839** — claimed, without contemporary documentation.

The nuance *is* the article. The honest framing is "why this is hard to
answer" — what counts as *first*, rugby football versus Rugby Union,
foundation versus continuous existence, recognition versus documentation.
That is a better story than a date, and it teaches a child something true
about historical evidence.

**Status: NOT_YET_RESEARCHED for publication.** Primary sourcing required —
RFU's own historical material, club archives, Guinness World Records' entry.
Wikipedia located the dispute; it cannot be the citation.

```
historical_entries              historical_clubs
  entry_key                       club_key, founded_year, founded_precision
  year | year_range               place, founders
  headline, teaser, body          why_it_mattered, key_moment, what_next
  rugby_code_relevance            present_day_status, location {lat,lng}
  evidence_strength  ← DOCUMENTED | RECOGNISED | CLAIMED | DISPUTED
  competing_claims[]              image_asset_key, rights_status
  source_keys[]                   source_keys[]
```

`evidence_strength` is the field that makes this content honest, and it should
render — "claimed" and "documented" must not look identical to a reader.

---

## 6. Interactive pitch and At-a-Glance (§19/§30M)

Both are **projections of verified facts**, and neither may render a value the
fact layer does not hold.

At-a-Glance needs exactly six facts per identity:

| Card | Fact key | Currently |
|---|---|---|
| Ball | `ball.size` | not extracted |
| Players | `team.players_on_pitch` | not extracted |
| Match | `match.duration` | not extracted |
| Pitch | `pitch.length` + `pitch.width` | not extracted |
| Contact | `contact.permitted_level` | not extracted |
| Restart | `restart.method` | not extracted |

**A missing fact renders as an absent card, never a guessed value and never a
zero** — the same rule Phase 2A established for attendance dials.

The pitch diagram additionally needs in-goal depth, markings, player count and
position anchors. All geometry comes from facts; no governing-body diagram is
ever copied. Ovalball draws its own from numbers it can cite.

---

## 7. Motion (§30Q)

Motion earns its place by aiding comprehension: players moving into formation,
pitch lines drawing, the timeline ball travelling between milestones, a
number revealing on a shirt. Everything else is decoration.

Two hard rules:

- **`prefers-reduced-motion` is respected, and every animation has a static
  equivalent.** No information may exist only in movement.
- **Player Welfare and Safeguarding do not animate.** No celebration, no
  bounce, no reveal around concussion, injury or a safeguarding concern. The
  quiz may celebrate a correct answer; a head-injury page may not.

---

## 8. Imagery (§30P)

Seven images exist in `public/images/`, six at 896×1200 (~2MB PNG) and
`team-huddle.png` at 216×288 — small enough that it will visibly degrade if
used at any size, and it should be replaced or reserved for a thumbnail.

| Asset | Semantic subject | Candidate role |
|---|---|---|
| `playing-rugby.png` | play in progress | Learn the Game, My Rugby hero |
| `team-huddle.png` | team, togetherness | Team/community — **low resolution** |
| `muddy-boots.png` | kit, preparation | Skills & Training, matchday prep |
| `club-house.png` | club, place | The Story of Rugby, clubs |
| `handshake.png` | respect, sportsmanship | Safeguarding, values |
| `arms-round.png` | support, care | Player Welfare (calm, non-celebratory) |
| `muddy-phone.png` | the app in real use | Registration, practical guides |

**Two genuine gaps.** There is **no licensing or rights metadata anywhere in
the repository** for any of these — no manifest, no per-file record, nothing
in `package.json`. Before any of them ships on a public-facing Hub page, their
licence terms need recording. And none is currently referenced by any
component, so nothing regresses if they are re-processed (they should be: 2MB
PNG is the wrong format, WebP/AVIF at delivery sizes is right).

Recommended: an `asset_roles` catalogue keyed by semantic role, so content
references `role: "welfare-support"` rather than `arms-round.png`. Filenames
should never be scattered through content.

---

## 9. Phase 4B population plan (exact)

In this order:

1. **Resolve the open RFU-U7 conflict.** One exists now and blocks
   publication for that identity. Nothing else should be published while an
   identity's conflict is open.
2. **Solve RFU access.** `englandrugby.com` returns **HTTP 403** to automated
   requests — every Regulation 15 appendix is unreachable from CI. This is the
   single biggest blocker to 4B and needs deciding first: a human extraction
   pass, or an agreed access route. RFL PDFs fetch normally.
3. **Extract Union age grades U7→U14**, one appendix at a time, six
   At-a-Glance facts each, each with a citation and an effective period.
   Appendix 9 (U15–U18) is extracted **once** and attached to both U15 and
   U16 through `regulatory_fact_applicability` — never copied.
4. **Extract RFL Primary (U6–U11)** from the 2026 rules.
5. **Research the four RESEARCH_REQUIRED groups**: Union girls age grades,
   Union adult (all three XVs of a gender resolving to *one* identity), Colts,
   and whether a national RFL youth layer exists above Primary.
6. **Only then** the editorial content types, starting with Registration
   (highest parent value, lowest regulatory risk).

Do not populate to turn the matrix green. A `SOURCE_FOUND_NEEDS_EXTRACTION`
that is honest is worth more than a `VERIFIED` that is guessed.

## 10. Phase 4C build recommendation

Build in this order, because each depends on the last: At-a-Glance cards →
interactive pitch → positions → timeline → quiz. Each is a projection of
content that must already exist; none should be built against placeholder
data, or it will be built against the wrong shape.
