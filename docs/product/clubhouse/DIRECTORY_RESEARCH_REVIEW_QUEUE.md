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

## Batch 3 (North of England + Midlands regional pass, 235 clubs)

This pass specifically targeted North West, Yorkshire, North East and Midlands clubs not
yet covered by Batch 2's alphabetical sweep. 166 researched with real proposals, 57
confirmed-but-thin (genuine identity, no verifiable new facts — thin or unreachable web
presence), 12 flagged below.

**Duplicate-record candidates (two directory rows, likely one real club) — needs a human
merge decision, not something research can resolve:**
- **Leigh Rugby Union Football Club** vs the existing **Leigh RUFC** entry (postcode WN7
  3NA already on file) — only one real Leigh, Greater Manchester rugby union club (Round
  Ash Park) could be found.
- **Sileby RFC** vs **Sileby Town RFC** (founded 2006, Cossington) — evidence points to one
  active club under the "Town" name.
- **Upton-on-Severn Rugby Football Club** vs **Upton-upon-Severn RFC** — differ only by an
  "on"/"upon" spelling; a real club competes as "Upton-upon-Severn" but it could not be
  confirmed whether this is one club double-listed or two distinct entities.

**Possibly defunct / inactive:**
- **Withernsea RUFC** — joined Counties 4 Yorkshire 2024/25 then withdrew mid-season; no
  working site or ground found since.
- **Liverpool Collegiate Rugby Football Club** — only historical (up to 2017/18) league
  mentions; not on the current Lancashire RFU affiliated-clubs list.
- **New Brighton Rugby Club** (Wallasey) — similarly only historical mentions; not on the
  current Lancashire RFU list.

**Identity could not be confirmed at all:**
- **Typhoons Rugby Football Club** — only match found was an unrelated ice hockey club.
- **Lincoln** — no citable source distinguished a specific "Lincoln RFC" from an unrelated
  same-named New Zealand club.
- **Wortley RUFC** — real risk of confusion with rugby league heritage in the
  Wortley/Barnsley area and with Wortley, Leeds; no citable evidence of a distinct union
  club under this name.
- **North Shields RFC** — no dedicated page, site, or league mention found.
- **Spartans (Midlands) Rugby Club** — "Spartans" is a common rugby-club name nationally;
  no page found and the shared WebSearch budget ran out before proper disambiguation
  could be attempted (a genuine tooling gap, not a claim the club doesn't exist).

**Worth a human's attention though not blocking (name/identity nuance, not ambiguity):**
- **Newcastle Falcons** rebranded to **Newcastle Red Bulls** in 2025 after a Red Bull GmbH
  takeover (confirmed on the live official site) — the directory still carries the old
  name; "name" isn't a proposable field in the current schema, so this needs a direct
  admin correction, not a proposal.
- **Leeds Tykes** has been renamed multiple times (→ Leeds Carnegie → Yorkshire Carnegie →
  reverted to Leeds Tykes in 2020) and now groundshares with a separate club, West Park
  Leeds RUFC — flagged for awareness given the churn.
- **Worcester** (directory's stored name is the bare town name) — the real current club is
  "Worcester Wanderers RFC," a distinct amateur/community club from the professional
  Worcester Warriors; the stored name doesn't reflect this and needs a human decision on
  what canonical name to use.

## Batch 4 — full club name verification (238 short-name clubs, directory-wide)

Prompted by a direct question about whether "York" and similarly short directory names
(town name only, no "RFC"/"Rugby"/"Club" etc.) reflect the clubs' real full names. `name`
became a proposable field in this batch (see `20260901170000`'s allowlist, already covered
`name` from day one — the note above about it not being proposable was stale by the time
this batch ran). 238 active clubs with a name containing none of
rugby/rfc/ruf?c/rlfc/club/athletic/hoppers/academicals/old boys/wanderers were researched
identity-first, per-club, exactly like the earlier field-enrichment batches. 147 produced a
sourced, verified fuller name; 91 were confirmed to already carry their genuine short name
(explicitly NOT "fixed" by mechanically appending a suffix) or had no confirmable fuller
name. Staged as pending `name` proposals on run `3762c626-b835-4b5f-a499-778274f38a2d`,
never auto-accepted.

**Two proposals worth extra scrutiny before accepting, because both DROP a word from the
current name rather than just extending it:**
- **Rotherham Titans → "Rotherham Rugby Union Football Club"** — medium confidence,
  sourced only from a Wikipedia infobox field with no independent corroboration against
  the official site. "Titans" is very plausibly the club's genuine current promotional
  name (the same pattern as Bristol Bears/Bedford Blues/Taunton Titans, all correctly left
  untouched elsewhere in this same batch) rather than an informal nickname layered on the
  real name. Recommend rejecting unless independently confirmed.
- **Worthing Raiders → "Worthing Rugby Football Club"** — high confidence; the researching
  agent specifically cited Wikipedia's infobox distinguishing "Raiders" as the first-XV's
  nickname field from "Worthing Rugby Football Club" as the stated full-name field (the
  same distinction that correctly preserved Worcester's "Wanderers" nickname while
  proposing "Worcester Rugby Football Club" as its real name). Better-evidenced than
  Rotherham, but still worth a human glance given the same drop-a-word shape.

**Identity could not be confirmed, no proposal made (12):**
Ayrshire Clan, Cockermouth, Consett, Keswick, Keynsham, Leatherhead, Leicester Forest,
Lincoln, Walsingham, The Glasgow Clan (real risk of confusion with the Elite Ice Hockey
League team of the same name), Wellington (multiple plausible English clubs, no town/county
on the directory row to disambiguate). "Ovalball UAT Borough RL" was correctly recognised
as a synthetic local test fixture and skipped rather than researched.
- **Walsingham** in particular may be a directory data-quality issue rather than a research
  gap — no rugby club by this name could be found anywhere; Walsingham, Norfolk is
  documented only as a pilgrimage/shrine village. Worth checking whether this row should
  exist at all.

**Now resolvable, previously blocked:** the Batch 3 notes above about Newcastle
Falcons→Red Bulls and Leeds Tykes' repeated renames said "name isn't a proposable field" —
that's no longer true. Neither was included in this batch's target list (both already
contain "Falcons"/"Tykes", not bare place names, so the short-name filter didn't select
them), but a human could now stage those as ordinary `name` proposals through the same
pipeline if the rebrand should be reflected canonically.

## Batch 5 — Cheshire, Lancashire and Yorkshire, applied directly rather than staged

Different mechanism from Batches 2–4: instead of researching a target list and staging
`pending` proposals for later review, the product owner drove this pass interactively —
naming specific gapped clubs (crest, bio, address, postcode, website), supplying links
they'd found themselves for most of them, with a research fork covering the rest. Every
fact was individually curl-verified (crest URLs: HTTP 200 + real image content-type) or
cross-checked against an independently-fetched source before being written straight to
`club_directory` (via direct `UPDATE`s and `scripts/ingestion/apply_logo_candidates.mjs`),
then geocoded via `scripts/ingestion/run_geocoding_backfill.mjs`. Nothing here went through
the `club_directory_research_proposals` pending/accept pipeline.

**Cheshire RFU cohort (37 clubs):** every active club now has a real, verified crest.
**Reaseheath College** was deactivated (`active = false`, not deleted — it has accepted
research proposals and a `directory_requests` row pointing at it) per the standing rule that
an entry which *is* an educational institution with no real club behind it gets removed from
the live directory, same treatment as any future "college is the club" case.

**Lancashire cohort (23 of the 23 originally gapped, Bay Horse RFC excluded per standing
instruction):** fully resolved. Notable items:
- **Blackley Rugby Football Club renamed to Blackley Rangers RUFC** — the placeholder name
  on file was incomplete; product-owner research found the club's real current name.
- **Lancaster Lionesses RFC — an address conflict was caught and resolved.** The product
  owner initially supplied "Powder House Ln, Lancaster LA1 2TT," which didn't match either
  the club's own bio ("Lancaster University Sports Centre") or the pre-existing DB postcode
  (LA1 4YQ). An independent source (fybrugby.com) confirmed the ground as Lancaster
  University Sports Centre, Bailrigg, postcode LA1 4YT, matching the bio — applied that
  instead, and the product owner confirmed this was correct rather than Powder House Lane.
- Four clubs (England Fire Service RFC, West Lancashire Freemasons RFC, British Police
  Womens RFC, Anti-Assassins RFC) are genuinely "No Fixed Address" representative/touring
  sides — left with no street address by design, not a gap.
- Four university-affiliated clubs (Edge Hill, University of Cumbria RFC Lancaster Campus,
  University of Lancashire, University of Salford) got club-level bios; their address/
  postcode/crest were already correct on file, so the university-fallback rule wasn't
  needed here.

**Yorkshire cohort (14 of 16 fully resolved):**
- 6 bio-only gaps filled (Bradford Salem, Dearne Valley, Garforth, Leeds Medics and
  Dentists, Old Grovians, Rossington Hornets).
- Guisborough RUFC and Wetherby RUFC got real crests + address/postcode + website. Note:
  the research fork's Guisborough crest URL had a transcription error (typed "GUISBOROUGH,"
  Pitchero's actual filename is "GUISBROUGH") that returned HTTP 403 until corrected —
  worth remembering that a subagent-supplied crest URL still needs re-verification by
  whoever applies it, filename typos don't always fail loudly.
- Four university clubs (Leeds Beckett, Hull, Leeds, York) had no reachable club-specific
  page (Students' Union activity pages 404'd or were JS-rendered with nothing fetchable), so
  each now carries its **university's own** official address and coat-of-arms crest as an
  explicit, labelled fallback — never presented as the club's own distinct identity — per
  the standing university-fallback rule. Revisit if a genuine club-specific source ever
  surfaces.
- **Still gapped, left honest rather than guessed:** Clayton Rugby Football Club (no
  address/postcode found anywhere, including its own site); York RI (Railway Institute)
  RUFC (bio and a street name were found, but no postcode and no working crest source — its
  only known Pitchero page is dead).

**Sitewide "College" scan, deliberately not touched:** the product owner's rule is "all
Colleges [that are institutions standing in for a club] get deleted from the record," per
the Reaseheath precedent. A sitewide name search also turned up King's College Hospital RFC
(Greater London), Stamford College Old Boys RFC (Lincolnshire) and Swindon College Old Boys
Rugby Football Club (Wiltshire) — none of these are institutions-as-clubs, they're genuine
standalone rugby clubs that merely reference a college in their name/heritage. Left active
and untouched; still open whether the product owner wants those gone too despite the name
match, which would need an explicit decision since deleting a real club would be
destructive.

Constraint discovered mid-pass: WebSearch draws from a single session-wide call budget
shared across all concurrently- or sequentially-running research (main thread and every
forked subagent draw from the same 200-call session cap). Once exhausted, only direct-URL
WebFetch and curl remain available for the rest of the session — which is why the Yorkshire
fork (lucky enough to find a Wikipedia list of Yorkshire RFU affiliated clubs to follow by
direct link) came back far more complete than the Lancashire fork (which had no such list
to walk and came back almost entirely unresolved) despite running the same instructions.
