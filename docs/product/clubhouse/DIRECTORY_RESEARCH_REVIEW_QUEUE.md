# Directory Research Review Queue — Overnight Enrichment Pass

Clubs where identity or a specific fact could not be confidently resolved during tonight's
research pass, and were deliberately left unproposed (or proposed at only medium
confidence with an explicit caveat) rather than guessed. This covers only the 60 clubs
researched tonight — the rest of the directory has not yet been looked at.

Every accepted proposal still goes through the existing one-at-a-time Data Quality review
(`/admin/clubs/data-quality`) regardless of what's listed here; these are simply the cases
that need extra attention or a decision beyond "does this look right."

## Left entirely unproposed — identity genuinely unresolved

**Aberdeen University Women** (Scotland, directory id `2afa5380-81e4-4e35-91d8-e311ef217226`)
— strong evidence this is the women's section of Aberdeen University RFC rather than an
independently constituted club (contact address is an Aberdeen University Students'
Association domain, Wikipedia describes it as that club's own women's team), but it also
has its own Scottish Rugby fixtures listing as a separate entry. No proposals were made.
**Decision needed:** does Ovalball's directory want a university club's gendered
section listed as its own directory row at all, or should sections eventually fold under
one parent club record? This is a product/data-model question, not something research can
resolve — left exactly as-is either way.

## Confirmed, but flagged for a human sanity check before accepting

**Cardiff Rugby** (`a42227b7-845d-41be-ae98-85b20b4e07a6`) and **Cardiff Rugby Football
Club** (`4e559587-3626-4a27-b8d3-4dd3082be12c`) — both genuinely exist and are currently
operating, but they share the same parent company (Cardiff Rugby Ltd), the same ground and
the same address: Cardiff Rugby is the professional regional side, Cardiff RFC is the
older senior amateur/semi-pro club it grew out of. The research fork judged this cleanly
resolved (not a duplicate) and proposed real facts for both with the relationship spelled
out in each bio — but flagged, unprompted, that "some secondary sources blur the two
together" and recommended a quick human look before accepting either. Do that look before
clicking Accept on either row.

## Proposed at reduced/medium confidence, with the conflict named in the proposal itself

- **Ashfield Rugby Union Football Club** (England, `b118cbd6-...`) — the club's own official
  site consistently calls itself "Kirkby in Ashfield," not the directory's current
  "Sutton-in-Ashfield" (same NG17 postcode area covers both towns). Proposed as a
  medium-confidence town correction rather than auto-resolved.
- **Askean Rugby Football Club** (England, `0bb24ac1-...`) — sources disagree between two
  postcodes for The Rectory Field (SE3 8SR vs SE7 7EY). No postcode was proposed at all;
  every other field was.
- Several clubs across all five completed batches had a kit-colour description that was
  real but not confidently hex-mappable (e.g. Aylesbury's informal "pink/black", Banbury's
  and Barkers Butts's partially-described hoop colours) — colour fields were simply omitted
  for these rather than guessed, no separate flag needed beyond "colours were left blank."

## Logo candidates deliberately withheld even where the club itself is fine

- **Avon Rugby Football Club** (England) — the only "logo" found was an auto-generated
  Pitchero placeholder crest built from a colour code, not real club artwork. No candidate
  proposed.
- **Amber Valley RFC** (England) — the club's real official site only exposes lazy-loaded
  SVG placeholders in its markup; no crest could be verified.
- **Cardiff Rugby, Neath RFC, Ospreys, Scarlets** (Wales) — JS/CDN-rendered official sites
  made a directly-fetched, verifiably-official crest URL unreliable to obtain; skipped
  rather than risk a wrong or broken image.
- **Alford Youth RFC** (Scotland) — no dedicated club website, social presence or crest of
  any kind could be found at all; only a bare Scottish Rugby directory listing and a
  community sports-hub address.

## One in-transition fact deliberately left out of a structured field

**Ospreys** — the region's home ground is genuinely mid-change (Swansea.com Stadium →
Brewery Field, Bridgend for 2025/26 → St Helen's, Swansea from 2026/27). No `home_ground`
field was proposed to avoid asserting a value that would be wrong within months; the
transition is described in prose in the proposed bio instead.

## Minor pre-existing data-quality noise found, not part of this research pass

Six `club_directory` rows were sitting at `geocode_status = 'pending'` going into tonight;
on inspection none had a real postcode — three are synthetic automated-test fixtures
("Auto Partner Test *** RUFC") and three are UAT/test-suite fixtures ("Ovalball UAT United
RFC", "Crace Org/Part ea6c7f99 RUFC") with an empty-string (not null) postcode, which is
why `geocode_status='no_postcode'`'s own null-check never caught them. Not touched — this
is pre-existing test-fixture noise, unrelated to tonight's programme, and is exactly the
kind of out-of-scope defect this project's own standing practice is to record rather than
fix inside an unrelated slice.
