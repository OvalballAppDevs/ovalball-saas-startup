# Directory Research Review Queue — Overnight Enrichment Pass

Clubs where identity or a specific fact could not be confidently resolved during tonight's
research pass, and were deliberately left unproposed (or proposed at only medium
confidence with an explicit caveat) rather than guessed. Updated continuously as further
batches are researched — currently covers 428 of 1,408 canonical directory clubs (60 from
the first pass below, 350 from an alphabetical A–I sweep across all four nations).

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

## Batch 2 (alphabetical A–I sweep, waves 1–2, 350 clubs)

Identity ambiguities and not-found clubs surfaced by this sweep. Every case below reflects
genuine, careful research effort (official-site and Wikipedia checks, disambiguation
against similarly-named clubs, rugby-union-vs-league checks) that still couldn't clear the
confirmation bar — not a skipped attempt.

- **Bedford Swifts RFC** (ambiguous_needs_review) — Historical sources (Bedford Blues club history) show that Bedford Swifts (founded 1882) merged with Bedford Rovers in 1886 to form what is now Bedford RUFC/Bedford Blues, with the merged club adopting the Swifts' Goldington Road pitch and the badge's black taken from the Swifts' strip. No independent evidence was found of a currently active, separate club operating under the Bedford Swifts name today, distinct from Bedford Blues or Bedford Athletic (both already in the directory). Flagging for human review rather than producing facts about a club that may no longer exist independently.
- **Belper Rugby Club** (not_found) — No independent source (Wikipedia, Pitchero, a working official/RFU-hosted site, or an accessible Facebook page) could be located confirming an active rugby union club named 'Belper Rugby Club' in Belper, Derbyshire, despite multiple search approaches. Flagging for human review rather than guessing.
- **Bishop Auckland Rugby Club** (ambiguous_needs_review) — Only evidence found was a single passing entry for 'Bishop Auckland' in the RFU women's league structure (Championship North 2) on Wikipedia's list of English rugby union clubs, whose link resolves to the town's article rather than a dedicated club page; no official club website, Pitchero page, or independent second source could be located, and there is a genuine risk of confusion with the separate, unrelated Bishop Auckland F.C. (association football, Heritage Park). Needs human review to confirm this club still exists as described and to source real details.
- **Bishops Castle & Onny Valley RFC** (ambiguous_needs_review) — Could not reach any working official site, Wikipedia page, or other authoritative source within available tooling (DNS/connection failures on plausible domains, no Wikipedia article found, web search budget exhausted this session) to independently confirm identity/details beyond the given record.
- **Bishopston Rugby Football Club** (ambiguous_needs_review) — Could not reach any working official site, Wikipedia page, or other authoritative source within available tooling (DNS/connection/SSL failures on plausible domains, no Wikipedia article found, web search budget exhausted this session) to independently confirm identity/details beyond the given record.
- **Blackley Rugby Football Club** (not_found) — No official website, Pitchero page, Wikipedia article, or other independent source could be located for a rugby UNION club named Blackley RFC in the Manchester/Lancashire area. The well-known 'Blackley' rugby club in this area is Blackley ARLFC, a rugby LEAGUE club, which must not be conflated with this record; insufficient evidence to confirm a distinct rugby union club exists under this name.
- **Bletchley Rugby Club** (ambiguous_needs_review) — No working official website, Pitchero page, or Wikipedia article could be located for Bletchley Rugby Club in Milton Keynes despite multiple domain and directory guesses; insufficient evidence to confirm identity or produce proposals within available tooling (web search budget exhausted this session).
- **Bloxwich Rugby Club** (ambiguous_needs_review) — No working official website, Pitchero page, or Wikipedia article could be located for Bloxwich Rugby Club in Walsall despite multiple domain and directory guesses; insufficient evidence to confirm identity or produce proposals within available tooling (web search budget exhausted this session).
- **Bristol Aeroplane Company Rugby Football Club** (not_found) — Could not confirm current identity/details this session. A domain matching the club's abbreviation (bacrfc.co.uk) exists but could not be opened (expired SSL certificate blocks access), and no working official website, Pitchero page, or RFU-hosted site could be located via direct guesses. General web search was unavailable for this club (session search budget was exhausted before reaching it). Flagging for human review/re-attempt rather than asserting unverified facts.
- **Burnley RUFC** (ambiguous_needs_review) — No genuine official website could be confirmed. The only candidate 'official-looking' site (burnleyrufc.co.uk) is actually served from a burnley-rufc-demo.vercel.app deployment -- a naming pattern strongly indicating a demo/template site rather than a real club's production site, so its claimed facts are not trustworthy. Pitchero and rfu.club lookups for Burnley found no matching club page. Needs human verification of whether an active Burnley rugby union club exists and what its real official presence is.
- **De La Salle Rugby Union Football Club** (ambiguous_needs_review) — Discovery-only search results produced an unverified and internally inconsistent claim that 'De La Salle (Salford) withdrew in 2026 following a merger with a reborn Salford RLFC that established De La Salle as professional' -- this conflates an amateur rugby union club with a professional rugby league entity and could not be corroborated via a dedicated Wikipedia article, official website, or Pitchero page. Current status and identity could not be confidently confirmed; needs human review.
- **Ditchling Rugby Football Club** (ambiguous_needs_review) — Only a historical (1987) Sussex 3 league listing for a Ditchling team was found; no evidence located that this club is still active today, so current identity could not be confirmed.
- **East Leake RFC** (not_found) — No Wikipedia article, league-table mention, or working official website/social page confirming an active 'East Leake RFC' rugby union club was found within the available search budget (WebSearch was exhausted for this session, and general-web-engine results returned only generic/unrelated matches for the word 'East').
- **East London RFC** (not_found) — No source was found confirming a rugby union club literally named 'East London RFC' in London. The nearest similarly-described club found (Old Streetonians RFC, Hackney, East London) has a different name and was not treated as a match. Could not confirm identity within the available search budget.
- **East Manchester Rugby Football Club** (not_found) — No Wikipedia article, league-table mention, or working official website/social page confirming an active 'East Manchester Rugby Football Club' was found within the available search budget.
- **Economicals RFC** (ambiguous_needs_review) — Surrey rugby league pages reference several similarly-named entries ('Economicals', 'Reigate Economicals', 'London Economicals', 'Croydon Economicals') and it could not be confirmed which, if any, is specifically the New Malden 'Economicals RFC' in the directory. No official website, Pitchero page or rfu.club page could be found to disambiguate, so no proposals are made.
- **Edwardians RFC** (ambiguous_needs_review) — No town is given for this West Midlands entry, and multiple distinct, similarly-named clubs exist in the region's leagues (Aston Old Edwardians, Nuneaton Old Edwardians, and a plain 'Edwardians' in North Midlands 2). Without a town to disambiguate, identity cannot be confidently confirmed as one specific club, so no proposals are made.
- **Grasshoppers** (ambiguous_needs_review) — No county or town was supplied for this record, and at least two distinct rugby union clubs share this short name in England: Preston Grasshoppers RFC (Preston, Lancashire, National League 2 North) and a separate Grasshoppers RFC in the Middlesex/London area. Cannot confidently determine which club this directory entry refers to without additional location data.
- **Grove Rugby Football Club** (not_found) — Could not locate any official website, Pitchero page, or Wikipedia reference confirming a rugby union club named "Grove RFC" (or similar) in Grove, Oxfordshire this session. Multiple direct URL guesses and searches returned no matching club. Flagging for human review rather than guessing.
- **Guildfordians RFC** (not_found) — Guildfordians RFC merged with Guildford & Godalming RFC in 2003 to form the present-day Guildford Rugby Club (also in this directory, based at Broadwater, Farncombe). Guildfordians RFC no longer exists as an independent club, so no proposals are produced for this now-defunct/merged entity.
- **Hartlepool RFC** (ambiguous_needs_review) — Hartlepool has several distinct historic rugby union clubs (West Hartlepool RFC, Hartlepool Rovers RFC, Hartlepool Athletic RFC, Hartlepool B.B.O.B. RFC). A plain 'Hartlepool RFC' could not be confidently matched to one specific still-active entity distinct from these, so no facts are proposed.
- **Hatfield RFC** (not_found) — Could not independently verify a specific rugby union club named 'Hatfield RFC' in Hertfordshire; searches surfaced only general Hertfordshire RFU governance context and a player born in Hatfield, not a dedicated confirmation of this club's existence or details.
- **Hemel Hempstead** (not_found) — Could not verify a specific rugby UNION club named 'Hemel Hempstead RFC'. The only clearly confirmed rugby club in Hemel Hempstead found was the Hemel Stags, which play rugby LEAGUE, not union, so was not used to avoid code confusion.
