# RFU Regulation 15 Appendices 1–9 — structured extraction

**Status: extracted, cross-checked, and POPULATED** (migration `20261119000000`).
The one ambiguity below was resolved by the RFU directly and is recorded here
for the reasoning trail.

## Provenance

Nine pages captured by the developer from englandrugby.com on **2026-09-07,
20:55–20:56**, printed to PDF from Chrome. Files in `research-ingestion/rfu/`
(gitignored). Each PDF footer carries its own correct appendix URL and capture
timestamp — verified individually. Unlike the master regulation capture, these
**have a full text layer**, so extraction is machine-readable rather than read
from page images.

| # | Scope | Pages | Chars | SHA-256 (first 16) |
|---|---|---|---|---|
| 1 | U7s Rules of Play (Tag Rugby) | 6 | 13,112 | `d5381291e786d86e` |
| 2 | U8s Rules of Play (Tag Rugby) | 7 | 14,099 | `7d7e8587b8c4b659` |
| 3 | U9s Rules of Play (Transitional Contact) | 6 | 11,785 | `a58a2ae2e691dbc1` |
| 4 | U10s Rules of Play | 8 | 15,689 | `fe93537d33431dd4` |
| 5 | U11s Rules of Play | 8 | 22,494 | `6fef64d8552cb04e` |
| 6 | U12s Rules of Play | 8 | 21,747 | `ecdb04d5ab56cd63` |
| 7 | U13s Rules of Play | 8 | 20,752 | `85c5610c300f72f5` |
| 8 | U14s Rules of Play | 8 | 21,755 | `d1303494d62a7922` |
| 9 | U15–U18 Variations to Laws of the Game | 3 | 4,376 | `da0e10e4eaaa8ce0` |

## Season status — read this first

**All nine read `Last Updated: 31 Jul 2025 / Effective from Friday 1st August
2025`.** The RFU has not reissued the Rules of Play for 2026/27.

They are used under an explicit developer authorisation recorded on each source
as `carries_forward = true` with a written reason. The justification: the
2026/27 master states at §15.2(2)(a) that play must accord with *"the Rules of
Play set out Appendix 1 to 9 of this Regulation"* — pointing at them without
dating them — and these are what the RFU publishes under that master today.

Corroboration: a separate developer paste of the same nine pages earlier the
same day matches these captures on 178 of 180 sampled body sentences; and that
same paste shows Regulations 3/5/6/7/8 already at *"Effective from Saturday 1st
August 2026"* while the appendices had not moved.

## Coverage matrix

| Field | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15–U18 |
|---|---|---|---|---|---|---|---|---|---|
| **Max players a side** | 4 | 6 | 7 | 8 | 9 | 12 | 13 | 15 | *not stated* |
| **Max pitch (m)** | 20×12 | 45×22 | 60×30 | 60×35 | 60×43 | 60×43 | 90×60 | 100×70 | World Rugby Law 1 |
| **In-goal** | +5m each | +5m each | +5m each | +5m each | +5m each | +5m each | +5m each | +5m each | *not stated* |
| **Ball size** | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 5 |
| **Max minutes per half** | 10 | 10 | 15 | 15 | 20 | 20 | 25 | 25 | *not stated* |
| **Contact** | none (tag) | none (tag) | tackle only | +ruck, +maul | ruck/maul | ruck/maul | full | full | full |
| **Scrum** | none | none | none | uncontested, 3 players | 3 players, contested strike | 5 players, contested strike | 6 players, fully contested | 8 players, contested | U15 boys: no turnover law |
| **Lineout** | none | none | none | none | none | none | none | uncontested | uncontested at U15; lifting permitted |
| **Kicking** | prohibited | prohibited | prohibited | prohibited | tactical kicking introduced; no fly-hack | no fly-hack; no box kicks/drop goals | fly-hack allowed; no box kicks/drop goals | fly-hack, box kicks, drop goals all permitted | World Rugby Laws |
| **Restart** | free pass from centre | free pass from centre | free pass from centre | free pass from centre | drop kick, opp 7m back | drop kick, opp 7m back | drop kick, opp 10m back | drop kick, opp 10m back | World Rugby Laws |
| **Substitutions** | rolling, unlimited | rolling, unlimited | rolling, unlimited | rolling, unlimited | rolling, unlimited | rolling, unlimited | rolling, unlimited | rolling, re-usable | rolling, re-usable, no limit |
| **Sin bin** | — | — | — | — | — | — | 5 min | 5 min | U15 6 min; U16–U18 7 min |
| **Gender stated** | *silent* | *silent* | *silent* | *silent* | *silent* | *silent* | *silent* | *silent* | **boys and girls** |

Every cell is what the document actually states. *not stated* means the
appendix is silent — **no value has been inferred from a neighbouring age
grade**, per the brief.

## Notable per-appendix detail

**U7 / U8 (tag).** Sanction for all infringements is a free pass. Tag belt
specified: two tags on Velcro over each hip, 38cm × 5cm, flexible plastic, must
contrast with the strip. Tagged ball carrier must pass within 3 seconds / ~3
strides. U7 forbids going to ground to score; U8 permits it. Both: no tackling,
no kicking, no scrums, no lineouts, no hand-off/fend-off. Play continues from a
knock-on at U7.

**U9 (transitional contact).** Tackle introduced — "held by one or more
opponents and brought to ground", must include the use of arms. Referee calls
"Tackle" then "Tackle-Release". No rucks, mauls, lineouts or scrums.

**U10.** Uncontested scrum introduced, nearest 3 players (prop–hooker–prop),
fourth nearest acts as scrum half. Maul and ruck introduced. Contest 1 v 1.
Tackle height: opponents must grip and hold **below the base of the sternum**.

**U11.** Contested strike introduced. Tactical kicking and kicking restarts
introduced. A 15-metre line serves the purpose of the 22. Contest 2 v 2.

**U12.** Scrum grows to 5 (front row + two locks), sixth acts as scrum half. No
limit on numbers contesting ruck/maul. **Hand-off introduced, below the
armpits.** Pitch still half-size (60×43).

**U13.** Six-player fully contested scrum, players must be "confident and
competent". Full-size pitch (90×60). Fly-hack becomes legal. Sin bin 5 min.

**U14.** Eight-player contested scrum; No.8 may pick up from the base.
Uncontested lineout introduced. Box kicks and drop goals become legal. 100×70
pitch. 15-a-side.

**U15–U18 (Appendix 9).** Ball size 5, World Rugby Law 1 pitch. Rolling
substitutions with no limit. **Squeezeball prohibited outright**, including from
coaching. Sin bin U15 6 min, U16–U18 7 min. Tackle height below the base of the
sternum, sanction penalty. Then a delimited section headed *"Additional Law
Variations applicable to U15 boys only"*: no turnover law at the scrum,
scrum-half restriction, uncontested lineout at U15, lifting permitted.

## Safety and welfare provisions extracted

- Tackle height at every contact grade: **below the base of the sternum**; ball
  carrier must not go in with shoulders below hips, dip late and low, or place
  their head into the opponent's head space.
- Support players must not stand either side of and close to the ball carrier
  to block the next tackle (U10 upward).
- **Squeezeball banned** at U15–U18, including teaching or coaching it.
- Coaches not permitted on the pitch during play (U7–U14).
- Adjacent pitches no closer than 5 metres (U7–U14).
- Referee and coaches may reduce pitch size by agreement where safe.
- U7: ball carrier must stay on their feet; no diving to score.

## Cross-check against the 2026/27 master

**Playing time — 8/8 agree.** Every appendix's "maximum minutes each half"
matches master §15.12 exactly, verified against the populated facts in the
database:

| | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 |
|---|---|---|---|---|---|---|---|---|
| Appendix | 10 | 10 | 15 | 15 | 20 | 20 | 25 | 25 |
| Master §15.12 | 10 | 10 | 15 | 15 | 20 | 20 | 25 | 25 |

**Contact threshold — agrees.** Master §15.10(3) permits contact from U9. App 1
and 2 state "no tackling"; App 3 introduces the tackle. Consistent.

**Appendix range — agrees.** Master §15.2(2)(a) says "Appendix 1 to 9". Nine
appendices supplied, numbered 1 to 9, no gaps, no Appendix 10.

**U15–U18 gender scope — agrees.** App 9 covers "boys and girls rugby at U15 to
U18" with boys-only variations delimited inside it, exactly as the master's
dual-age-band structure implies.

**No contradictions found.** Sin bin, match-stop thresholds, the Half Game Rule
and the 35-match cap appear in only one document or the other, never in both
with different values.

## ✔ RESOLVED — the girls dual-age-band ambiguity

**Appendices 1–8 never mention gender at all.** They are written per single year
(U7 … U14). Only Appendix 9 names both genders.

But master §15.6 defines the girls' game as four **dual age bands**:
U12/U11, U14/U13, U16/U15, U18/U17.

For U15–U18 this resolves cleanly: Appendix 9 covers both genders, so the girls
U16/U15 and U18/U17 bands map to it directly.

**Below U15 it does not resolve.** Which appendix governs a U13 girl in the
U14/U13 band — Appendix 7 (U13) or Appendix 8 (U14)? The regulation does not
say. Master §15.3 states that a *combined* team plays to the rules of the
younger age grade, but a dual age band is a permanent structure, not a
combination, so that provision does not obviously transfer.

The candidate readings are:

1. **Band named by the older year → older appendix.** The U14/U13 band plays
   Appendix 8. Matches the band's name and the Competitive Menu's "Under 14
   Female".
2. **Younger-grade rule by analogy with §15.3.** The band plays Appendix 7.
   Safer for the younger players, and consistent with how combining works.

These give **different ball sizes, pitch sizes, scrum sizes and half lengths**
for the same child. This is exactly the class of value a parent acts on, so it
must not be guessed.

**RESOLUTION (2026-09-07).** The developer put the question to the RFU
directly. The RFU stated that **girls at U12 and U14 follow the same Rules of
Play as the boys, to ensure equality within the game** — confirming reading 1:
the band is governed by the appendix for the year it is named after. Girls U12
takes Appendix 6; Girls U14 takes Appendix 8.

That answer is recorded as source `RFU-CLARIFICATION-GIRLS-BANDS-2026`, and
deliberately classified as `OFFICIAL_EXPLANATORY_GUIDANCE` / `MEDIA_STATEMENT`
rather than primary regulation: it is a direct consultation reported by the
developer, with no URL, no effective date and no hash, and it cannot be
independently re-read. It is cited only as **SUPPORTING** evidence for the
*applicability* decision — never as the source of a rule value. Every value
still comes from the appendix text. A regression asserts it is never cited as
PRIMARY.

Equality is expressed structurally rather than by duplication: the same fact
row is attached to both identities through `regulatory_fact_applicability`, so
`RFU-U12` and `RFU-GIRLS-U12` share identical fact ids. Copies could drift
apart and quietly stop being equal; a shared row cannot.

## Population readiness

| Identity | Source | Ready? |
|---|---|---|
| RFU-U7 … RFU-U14 | Appendices 1–8 | **Yes** |
| RFU-U15, RFU-U16 | Appendix 9 | **Yes** |
| RFU-GIRLS-U16, RFU-GIRLS-U18 | Appendix 9 (states "boys and girls U15–U18") | **Yes** |
| RFU-GIRLS-U12 | Appendix 6 (same rows as RFU-U12) | **Yes** — RFU clarification |
| RFU-GIRLS-U14 | Appendix 8 (same rows as RFU-U14) | **Yes** — RFU clarification |
| RFU-U6 | none (Reg 15 starts at U7) | n/a — `NO_REGULATORY_EQUIVALENT` |
