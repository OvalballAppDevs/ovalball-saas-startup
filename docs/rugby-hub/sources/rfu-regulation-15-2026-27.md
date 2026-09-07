# RFU Regulation 15 — Age Grade Rugby (2026/27)

**Structured extraction.** This is a working record of what the regulation
says, made so that Phase 4B population has something reviewable to draw on
without re-reading 25 page images every time. It is **not** the authority.
The authority is the RFU's own page:

<https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby>

## Provenance

| | |
|---|---|
| Source key | `RFU-REG15-MASTER-2026-27` |
| Edition | 2026/27 — "Effective from 1 August 2026" in the running footer of all 25 pages |
| Acquired | 2026-09-07, developer-supplied |
| Method | Browser print-to-PDF capture (Chrome / Skia PDF), made manually by the developer because englandrugby.com returns HTTP 403 to automated requests |
| SHA-256 | `e9f6f55a210fac85eb96a8f45fef17e2ff834bf330576efdc6192b8df12028ee` |
| Size | 10,354,078 bytes, 25 pages |

**Two caveats that matter for how this is used.** The capture has **no text
layer** — `pypdf` extracts zero characters — so everything below was read from
rendered page images, not machine-extracted. And it is a *rendering of a web
page*, not the RFU's published PDF bytes. That makes it byte-stable and
re-readable (better than pasted text) but not publisher-signed (worse than an
official PDF). Anything below that looks surprising should be checked against
the page itself before it is published to a parent.

Access controls were not circumvented at any point.

---

## What this document does and does not contain

Regulation 15 is the **parent** regulation. It sets the framework: who counts
as what age grade, who may play up or down, how long they may play, when the
season runs.

It does **not** contain the Rules of Play. Those are **Appendices 1 to 9**,
which are separate pages. Section 15.2(2)(a):

> players and Match Officials must always do so in accordance with the Rules of
> Play set out Appendix 1 to 9 of this Regulation.

That single sentence is what finally closed the long-running Appendix 10
question — the set is 1 to 9, and there is no Appendix 10.

---

## 15.2 — Key playing principles

**Age grade determination.** A player's age grade is fixed by their age at
**midnight on 1 September** at the start of the season, and applies for the
whole season. Players move to their new age grade from **1 July** before the
next season begins.

**Scope.** Regulation 15 covers all age groups up to and including U18, and
U19s playing down into U18 rugby. It applies to both boys' and girls' rugby
unless stated otherwise.

**Registration.** All Age Grade Club Players must be registered annually on the
RFU's Game Management System — new players within 45 days of joining the club,
existing players within 45 days of the start of a new season.

**Girls at U11 and below** (15.2(9)):

> Girls can play both mixed (with boys) and girls-only rugby at Under 11 and
> below

with the explanatory note that girls in a U12/U11 combined band cannot play
with boys — a U12 girl may not play with U11 boys.

**League rugby** is only permitted from **U15 upwards**, and league tables may
only be published from U15 upwards. Waterfall pools are the one exception,
permitted from U12 upwards but never published as full league tables.

**Adults must not join in any aspect of contact training with Age Grade
Players** — including holding contact shields or tackle bags, or demonstrating
tackling.

---

## 15.6 — Age grade structure

This is the section that reshaped Ovalball's canonical data.

### Male players — single years

| Age grade | School year |
|---|---|
| U6 | Yr 1 |
| U7 | Yr 2 |
| U8 | Yr 3 |
| U9 | Yr 4 |
| U10 | Yr 5 |
| U11 | Yr 6 |
| U12 | Yr 7 |
| U13 | Yr 8 |
| U14 | Yr 9 |
| U15 | Yr 10 |
| U16 | Yr 11 |
| U17 | Yr 12 |
| U18 | Yr 13 |

### Female players — four dual age bands

| Band | School years |
|---|---|
| U12/U11 Dual Age Band | Yr 7 / Yr 6 |
| U14/U13 Dual Age Band | Yr 8 / Yr 9 |
| U16/U15 Dual Age Band | Yr 11 / Yr 10 |
| U18s/U17s Dual Age Band | Yr 13 / Yr 12 |
| U19s | adult players |

**There is no girls U13, U15 or U17 age grade.** A U13 girl plays in the
U14/U13 band. This is corroborated twice more inside the same document: the
15.2 Competitive Menu carries female columns for "Under 12 Female", "Under 14
Female", "Under 16 Female" and "Under 18 Female" only, while its male columns
run every year U12–U18; and the 15.10 Summer Activity Plan refers to "U12, 14,
16, 18 GIRLS BANDS".

Bridging both tables:

> From U12s and above, mixed rugby is no longer permitted and different
> regulations apply to male and female players.

### Combining — maximum older players on the pitch

Combining is permitted **only** where a club, school or college does not have
enough players for a team in the single age grade. The team plays to the rules
of the **younger** age grade, and the opposition must be told at least 24 hours
in advance.

| Combination | Max older players on pitch |
|---|---|
| U9 with U10 | 3 U10s |
| U10 with U11 | 3 U11s |
| U11 with U12 (boys) | 3 U12s |
| U12 with U13 | 4 U13s |
| U13 with U14 | 4 U14s |
| U14 with U15 | 5 U15s |
| U15 with U16 | 5 U16s |
| U16 with U17 | 5 U17s |

U7s and U8s may play and train together. **U6s may not play matches,
competitions, tournaments or festivals with any older age grade.**

### Playing up

Permitted one age grade for U12 upwards (boys). U16s may play up two age
grades, but not in the front row of contested scrums in 15-a-side. Not
permitted at U8, U9 or U10 in the boys' game.

For girls, 15.4 is explicit:

> This does not apply to Girls' Age bands where the only playing up allowed is
> within the two-year age band (e.g. a girl in the U14 age band cannot play up
> in the U16s).

The one girls exception at the bottom: U11 girls may play with U12 girls in the
U12/U11 band.

### Playing down

Permitted in limited, exceptional circumstances at every age grade, and only
where the player is in a younger academic year than their birth year, or their
safety may be compromised by small stature or a developmental or behavioural
issue. Requires a risk assessment, parental approval, the club's Age Grade
Chair and the Constituent Body. Approval lasts one season and the player must
stay in that lower grade for the whole season. Playing down **two** age grades
additionally needs written approval from the RFU Legal & Governance Director.

---

## 15.7 / 15.8 — Playing adult rugby

Players may play and train in contact rugby with adults from their **17th
birthday**, provided:

- they do **not** train or play in the front row of the contested scrum until
  they are 18 (after which any position is open);
- the RFU Safeguarding Policy and Regulation 21 are complied with in full;
- the club has an appointed Safeguarding Officer;
- the club has Constituent Body approval to play 17-year-olds in adult rugby
  for the season, in place *before* any individual application; and
- the player has been individually assessed and approved.

Approval runs only to the player's 18th birthday.

U18s and below may **not** play in CB Adult Representative Rugby, Men's Prem
Rugby League or Cup, Men's Champ Rugby, or Premiership Women's Rugby or Cup,
except in exceptional circumstances with the approvals set out in 15.8.

---

## 15.10 — Season and out-of-season activity

> Season 2026-27 will run from Saturday 5 September 2026 until Monday 3 May 2027.
>
> Season 2027-28 will run from Saturday 4 September 2027 until Monday 1 May 2028.

### In-season activity

| Age grade | Non-contact training | Non-contact matches | Contact training | Contact matches | Tours |
|---|---|---|---|---|---|
| U5s & U6s | Yes | No | No | No | Yes |
| U7s & U8s | Yes | Yes | No | No | Yes |
| U9s to U18s | Yes | Yes | Yes | Yes | Yes |

**Contact rugby begins at U9.** U7s and U8s are non-contact only.

Out-of-season activity is governed by the RFU Summer Activity Framework, which
is mandatory and forms part of Regulation 15. Its April 2026 plan ramps from
1–2 low-intensity sessions a week in May to 1–3 medium-high sessions in August,
with contact training capped at 20 minutes/week in June, 30 in July and 40 in
August, and no contact at all for U13 and below in May.

---

## 15.12 — Playing time

**No player may play more than 35 matches per season.**

| Age group | Max minutes per match half | Max minutes of rugby per day |
|---|---|---|
| U7s & U8s | 10 | 50 |
| U9s & U10s | 15 | 60 |
| U11s & U12s | 20 | 70 |
| U13s & U14s | 25 | 80 |
| U15s | 30 | 90 |
| U16s and above (incl. girls dual U16/15 band) | 35 | 90 |

An extra 15 minutes per day is allowed for "Activate", the RFU's injury
prevention programme.

No extra time is allowed in any match except referee injury time. No
place-kicking contests to resolve a tie.

### When a match must be stopped

- **U7 to U13**: if one team leads by more than **6 tries**.
- **U14 to U18** (including the girls' dual U14/13 band): if one team leads by
  more than **50 points**.

Coaches may then agree an alternative format; any further play is not
officially recorded.

---

## 15.13 — Half Game Rule

Every player in a match day squad must play at least **half of the Available
Playing Time**. This applies to all contact and non-contact age grade matches,
including 7-a-side and festivals.

Time off the pitch counts toward the threshold only for a temporary injury or
enforced absence (max 10 minutes), or time off for a yellow card. The rule does
not apply where a player is permanently removed through injury, genuine risk of
injury, a red card, or an abandoned match.

The U18 Prem Rugby Academy Competition is the one exception: a 20% minimum
rather than 50%.

---

## Sections not summarised in detail

- **15.11** — approval routes for competitions, festivals, camps and tours (CB,
  County Schools Body, England Rugby Colleges/Schools, or RFU depending on
  scope).
- **15.14** — Clusters: two or more clubs combining temporarily, requiring a
  named lead, safeguarding officer and discipline lead with current DBS checks.
- **15.15** — Competitions Regulations and the list of RFU National
  Competitions, which take priority over any fixture clash without exception.

---

## What this unblocks, and what it does not

**Clear to publish in Phase 4B** — everything above, because this document is
verified as the current 2026/27 edition.

**Still blocked** — any Rules of Play fact (ball size, pitch dimensions, number
of players, scrum and lineout laws, tackle height). Those live in Appendices 1
to 9, and the appendix text on record is the **2025/26** edition while this
master regulation is 2026/27. See the `RFU-REG15-APPENDIX-SEASON-SPLIT`
conflict. Getting the 2026/27 appendix pages is the single remaining
acquisition needed to complete union coverage.
