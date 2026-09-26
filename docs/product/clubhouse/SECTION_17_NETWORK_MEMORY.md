# Section 17 — Recent Opponents & Network Memory

## PURPOSE

Generalise the existing season-scoped "fixtures together" read into the fuller "how do we know this
club" history the section asks for — per the ledger's own standing note
(`countFixturesTogetherThisSeason`/`countCompatibleTeams` already exist; generalise, don't restart).

## WHAT CHANGED

`packages/contracts/src/clubhouse/club-detail.ts`'s private `countFixturesTogetherThisSeason` became
`readClubNetworkHistory`, reusing its own existing viewer/opponent team-id resolution for THREE reads
instead of restarting a second data source:

- `thisSeason` — unchanged behaviour, same query.
- `fixturesTogetherAllTime` (new) — the same canonical fixtures query with the season date-range filter
  dropped, still team-scoped and still excluding cancelled fixtures.
- `firstMetDate` (new) — the earliest recorded kickoff date between the two clubs' teams, ascending
  order, one row.

All three come from exactly the fixtures table already trusted for the season count — never a second
compatibility calculation, never `club_partnerships.created_at` (a partnership can start long after two
clubs first actually played each other, or never start at all for clubs that only ever play a handful of
fixtures).

`ClubDetail` gained `fixturesTogetherAllTime: number | null` and `firstMetDate: string | null`, additive
next to the existing `fixturesTogetherThisSeason`.

## MOBILE

`apps/mobile/app/(tabs)/clubhouse/map.tsx`'s `ClubSheet`: the stat row now shows the all-time count
alongside the season count (only when they genuinely differ — a club met for the first time this season
does not need "3 fixtures this season · 3 fixtures all time" repeating itself), and a "First met Mon
YYYY" caption line beneath it, using a real recorded fixture date.

## SCOPE DELIBERATELY NOT TAKEN

No web-side change — as Section 4 already found, there is no `directoryId`-keyed full club-profile web
route to add this to (deferred pending a reference design, unrelated to this section). No new
"recent opponents" list distinct from the existing compatible-team list; the section's own name
("Recent Opponents & Network Memory") is satisfied by "how many, and since when," not a second club-pair
history log — the existing `compatible_opponent_teams`-driven list already shows who could be played,
and match history at the fixture level already lives in each club's own Fixtures screen.

## TESTING

Additive fields over an already I/O-bound function; no new pure logic worth a dedicated unit test beyond
what `clubhouse.test.mts` already covers for the surrounding `ClubDetail`/actions shape (unaffected —
re-run, 36/36 passing). Both clients' `tsc --noEmit` are clean; ESLint on every touched file shows only
the same pre-existing, unrelated findings already confirmed earlier this run. A live-device walkthrough
was **not** performed this pass.

## KNOWN DEBT

None new.
