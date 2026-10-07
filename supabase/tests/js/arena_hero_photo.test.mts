import { test } from "node:test"
import assert from "node:assert/strict"

import { HERO_MINIMUM, arenaHeroCandidates, heroDescription, heroUnsuitable, primaryVenue, type HeroPitch, type HeroVenue } from "../../../apps/mobile/src/arena/hero-photo-choice"

const home: HeroVenue = { id: "v1", name: "Ovalball UAT Ground", isDefault: true, coverImagePath: null, coverStockKey: null }
const second: HeroVenue = { id: "v2", name: "Second Ground", isDefault: false, coverImagePath: "club/c/venues/v2/photo.jpg", coverStockKey: null }
const pitch = (over: Partial<HeroPitch>): HeroPitch => ({ id: "p1", venueId: "v1", name: "Pitch 1", active: true, sortOrder: 1, coverImagePath: null, ...over })

test("Arena opens on the primary venue's own photograph first", () => {
  const venues = [second, { ...home, coverImagePath: "club/c/venues/v1/photo.jpg", coverStockKey: null }]
  const order = arenaHeroCandidates({ venues, pitches: [] })
  assert.deepEqual(order.map((c) => c.origin), ["VENUE_PHOTO", "ARENA_LIBRARY"])
  assert.equal(order[0].ownership, "club", "a photograph the club uploaded is the club's own -- never labelled Illustrative")
  assert.equal(primaryVenue(venues)?.id, "v1", "the primary venue is the one marked as the home ground, not the first in the list")
})

test("a library picture the club chose for its primary venue comes next, and is Ovalball's (Illustrative)", () => {
  const order = arenaHeroCandidates({ venues: [{ ...home, coverStockKey: "venue-clubhouse-dusk-02" }], pitches: [] })
  assert.deepEqual(order.map((c) => [c.origin, c.ownership]), [["VENUE_LIBRARY", "ovalball"], ["ARENA_LIBRARY", "ovalball"]])
})

test("without a venue picture, the club's own photographs of that venue's pitches, in pitch order", () => {
  const pitches = [
    pitch({ id: "p3", name: "Pitch 3", sortOrder: 3, coverImagePath: "club/c/pitches/p3.jpg" }),
    pitch({ id: "p2", name: "Pitch 2", sortOrder: 2, coverImagePath: "club/c/pitches/p2.jpg" }),
    pitch({ id: "p9", name: "Old Pitch", sortOrder: 0, active: false, coverImagePath: "club/c/pitches/p9.jpg" }),
    pitch({ id: "pX", venueId: "v2", name: "Elsewhere", sortOrder: 0, coverImagePath: "club/c/pitches/px.jpg" }),
    pitch({ id: "p1", name: "Pitch 1", sortOrder: 1 }),
  ]
  const order = arenaHeroCandidates({ venues: [home, second], pitches })
  assert.deepEqual(order.map((c) => (c.origin === "PITCH_PHOTO" ? c.pitchId : c.origin)), ["p2", "p3", "ARENA_LIBRARY"], "an inactive pitch, another venue's pitch and a pitch with no photograph are passed over")
  assert.equal(heroDescription(order[0]), "Your photograph of Pitch 2 at Ovalball UAT Ground")
})

test("no venue at all, or nothing of the club's own: Ovalball's Arena picture, marked Illustrative", () => {
  for (const venues of [[], [home], [second]]) {
    const order = arenaHeroCandidates({ venues, pitches: [] })
    assert.deepEqual(order.map((c) => c.origin), ["ARENA_LIBRARY"])
    assert.equal(order[0].ownership, "ovalball")
  }
})

test("a picture too small or the wrong shape for the banner is passed over, never shown poorly", () => {
  assert.equal(heroUnsuitable({ width: 1600, height: 1200 }), null, "a club upload, saved 1,600 wide at 4:3, fits")
  assert.equal(heroUnsuitable({ width: 1200, height: 900 }), null, "the smallest size an upload is saved at still fits")
  assert.equal(heroUnsuitable({ width: 4032, height: 3024 }), null)
  assert.equal(heroUnsuitable({ width: 800, height: 600 }), "too small")
  assert.equal(heroUnsuitable({ width: 1200, height: 1500 }), "not landscape", "a portrait photograph would leave the words on a sliver of it")
  assert.equal(heroUnsuitable({ width: 1500, height: 1500 }), "not landscape")
  assert.equal(heroUnsuitable({ width: 0, height: 0 }), "too small", "a picture that could not be measured is not used")
  assert.ok(HERO_MINIMUM.width >= 1200 && HERO_MINIMUM.aspect > 1)
})
