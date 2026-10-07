import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  STOCK_MEDIA,
  isIllustrative,
  isStockKeyAllowed,
  resolveObjectMedia,
  stableStockIndex,
  stockCategoriesFor,
  stockFallbackKey,
  stockMedia,
  stockMediaFor,
  stockMediaForTeam,
  type StockDomain,
} from "../../../packages/contracts/src/media/stock-library"

/**
 * ONE STOCK MEDIA LIBRARY (integration audit, sections 14-19).
 *
 * Six catalogues became one categorised library; eleven server lists became one table; a dozen fixed fallback
 * constants became one deterministic, category-aware rule. These pin all three halves to each other -- the
 * library, the phone's bundle and the server's list -- and keep the fragments from growing back.
 */

const ROOT = process.cwd()
const MOBILE = join(ROOT, "apps/mobile")
const DOMAINS: StockDomain[] = ["VENUE", "PITCH", "CHANGING_ROOM", "TEAM", "EVENT", "TOURNAMENT"]

test("every library picture has a unique key, at least one kind of object, and a file in the bundle", () => {
  const keys = STOCK_MEDIA.map((m) => m.key)
  assert.equal(new Set(keys).size, keys.length, "two entries share a key")
  for (const m of STOCK_MEDIA) {
    assert.ok(m.domains.length > 0, `${m.key} stands for nothing`)
    assert.ok(existsSync(join(MOBILE, "assets", m.file)), `${m.key}: ${m.file} is not in the bundle`)
    assert.match(m.category, /^[A-Z]/, `${m.key}: a category is a Title Case chip`)
  }
  for (const d of DOMAINS) assert.ok(stockMediaFor(d).length > 0, `${d} has nothing to choose from`)
})

test("a person browses by category, and a category holds only pictures for that kind of object", () => {
  assert.ok(stockCategoriesFor("EVENT").includes("Christmas"))
  assert.deepEqual(stockMediaFor("EVENT").filter((m) => m.category === "Christmas").map((m) => m.key), ["event-christmas-01"])
  assert.deepEqual(stockCategoriesFor("PITCH"), ["Pitches", "Training"], "a pitch offers its training pictures too -- the server always allowed them")
  for (const d of DOMAINS) for (const m of stockMediaFor(d)) assert.ok(m.domains.includes(d) && m.pickable)
  assert.ok(!stockMediaFor("TOURNAMENT").some((m) => m.key === "tournament-default-01"), "the default is never offered as a choice")
})

test("a team sees its own kind of side first, and still every team picture", () => {
  const minis = stockMediaForTeam("minis")
  assert.equal(minis[0].key, "rugby-team-minis-01")
  assert.equal(minis.length, stockMediaFor("TEAM").length)
})

test("the fallback is deterministic: the same record always lands on the same picture", () => {
  for (const d of ["VENUE", "PITCH", "CHANGING_ROOM"] as const) {
    const a = stockFallbackKey(d, "5f868069-b6ca-4bcd-8306-f73d234031d9")
    assert.equal(stockFallbackKey(d, "5f868069-b6ca-4bcd-8306-f73d234031d9"), a, `${d} picked twice differently`)
  }
  // ...and it is the very rule the Match Centre arena already used, so no ground changed under anybody.
  // (The stand-in pool is the pickable pitches that may stand in -- a choice-only picture never joins it.)
  const pool = stockMediaFor("PITCH").filter((m) => m.category === "Pitches" && m.fallback !== false)
  assert.equal(stockFallbackKey("PITCH", "abc"), pool[stableStockIndex("pitch:abc", pool.length)].key)
})

test("the fallback is category-aware: a pitch never stands in as a changing room, nor a ground as a drill", () => {
  for (let i = 0; i < 200; i++) {
    const seed = `seed-${i}`
    assert.equal(stockMedia(stockFallbackKey("PITCH", seed))!.category, "Pitches")
    assert.equal(stockMedia(stockFallbackKey("CHANGING_ROOM", seed))!.category, "Changing Rooms")
    assert.ok(stockMedia(stockFallbackKey("VENUE", seed))!.domains.includes("VENUE"))
  }
  assert.equal(stockFallbackKey("EVENT", null, { eventType: "SOCIAL", startsOn: "2026-12-12" }), "event-christmas-01")
  assert.equal(stockFallbackKey("EVENT", null, { eventType: "SOCIAL", startsOn: "2026-08-01" }), "event-summer-bbq-01")
  assert.equal(stockFallbackKey("EVENT", null, { eventType: "AWARDS", startsOn: "2026-05-01" }), "event-awards-01")
  assert.equal(stockFallbackKey("TEAM", null, { teamGroup: "minis" }), "rugby-team-minis-01")
  assert.equal(stockFallbackKey("TOURNAMENT"), "tournament-default-01")
})

test("uploaded media beats a chosen picture, which beats the fallback; a foreign or unknown key falls back", () => {
  assert.equal(resolveObjectMedia({ domain: "PITCH", uploadedUrl: "https://x/p.jpg", stockKey: "pitch-4g-01" }).provenance, "UPLOADED")
  assert.deepEqual(resolveObjectMedia({ domain: "PITCH", stockKey: "pitch-4g-01" }), { provenance: "STOCK", url: null, stockKey: "pitch-4g-01" })
  assert.equal(resolveObjectMedia({ domain: "PITCH", stockKey: "event-christmas-01", seed: "p1" }).provenance, "FALLBACK", "an event picture is not a pitch")
  assert.equal(resolveObjectMedia({ domain: "EVENT", stockKey: "event-made-up-01", hint: { eventType: "AWARDS" } }).stockKey, "event-awards-01", "an unknown key is never drawn as Christmas")
  assert.equal(resolveObjectMedia({ domain: "TEAM", clubMediaUrl: "https://x/crest.png" }).provenance, "CLUB_MEDIA")
  assert.ok(!isStockKeyAllowed("tournament-default-01", "TOURNAMENT"))
})

test("a library picture of a place or of people is labelled illustrative; a real photo never is", () => {
  for (const d of ["VENUE", "PITCH", "CHANGING_ROOM", "TEAM"] as const) {
    assert.ok(isIllustrative(d, "STOCK") && isIllustrative(d, "FALLBACK"), `${d} library picture not labelled`)
    assert.ok(!isIllustrative(d, "UPLOADED") && !isIllustrative(d, "CLUB_MEDIA"), `${d} real photo labelled`)
  }
  assert.ok(!isIllustrative("EVENT", "STOCK") && !isIllustrative("TOURNAMENT", "FALLBACK"), "a mood picture is not presented as a record of the day")
})

test("the phone binds exactly the library's keys, each to its own file", () => {
  const binding = readFileSync(join(MOBILE, "src/media/stock-assets.ts"), "utf8")
  const bound = new Map([...binding.matchAll(/"([a-z0-9-]+)": require\("\.\.\/\.\.\/assets\/([^"]+)"\)/g)].map((m) => [m[1], m[2]]))
  assert.deepEqual([...bound.keys()].sort(), STOCK_MEDIA.map((m) => m.key).sort())
  for (const m of STOCK_MEDIA) assert.equal(bound.get(m.key), m.file, `${m.key} is bound to the wrong file`)
})

test("the server's list holds exactly the pickable library keys, for exactly the same kinds of object", () => {
  // The list began in 20270732 and grows in later migrations (the Arena pass added its pictures in 20270738), each
  // row upserted; read every migration in order, so a later row for a key is the one that stands.
  const dir = join(ROOT, "supabase/migrations")
  const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8"))
  const rows = new Map<string, string[]>()
  for (const migration of migrations) {
    for (const block of migration.matchAll(/insert into internal\.stock_media \(key, domains, category\) values([\s\S]*?);/g)) {
      for (const m of block[1].matchAll(/\('([a-z0-9-]+)', array\[([^\]]*)\]::text\[\], '[^']*'\)/g)) rows.set(m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort())
    }
  }
  const pickable = STOCK_MEDIA.filter((m) => m.pickable)
  assert.deepEqual([...rows.keys()].sort(), pickable.map((m) => m.key).sort())
  for (const m of pickable) assert.deepEqual(rows.get(m.key), [...m.domains].sort(), `${m.key}: the server allows it for different objects`)
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === "node_modules") continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

test("no standalone stock collection can grow back", () => {
  const files = new Set(STOCK_MEDIA.map((m) => m.file))
  // The binding is the only place a library picture is required. The Rugby Hub's teaching illustrations and the
  // editorial news pictures are documented content sets with files of their own -- but a picture that is ALSO a
  // library picture is taken from the library by its key there too (Arena pass, section 49), never required twice.
  const binding = "src/media/stock-assets.ts"
  for (const file of [...walk(join(MOBILE, "src")), ...walk(join(MOBILE, "app"))]) {
    const rel = file.slice(MOBILE.length + 1)
    const src = readFileSync(file, "utf8")
    assert.doesNotMatch(src, /\b[A-Z_]*STOCK[A-Z_]*CATALOGUE\b|\b\w+StockAssetForKey\b|\bdemoTeamCoverAsset\b/, `${rel} keeps a catalogue of its own`)
    if (rel === binding) continue
    for (const m of src.matchAll(/require\("[^"]*assets\/([^"]+)"\)/g)) {
      assert.ok(!files.has(m[1]), `${rel} requires the library picture ${m[1]} directly -- ask the binding (stockAsset / libraryAsset)`)
    }
  }
  for (const retired of ["src/team/cover-library.ts", "src/venue/cover-library.ts", "src/pitch/cover-library.ts", "src/venue/changing-room-cover-library.ts", "src/tournaments/cover-library.ts", "src/events/cover-library.ts", "src/team/team-cover-demo.ts", "src/venue/cover-library-screen.tsx", "src/venue/changing-room-photo-picker.tsx"]) {
    assert.ok(!existsSync(join(MOBILE, retired)), `${retired} is back`)
  }
})

test("the same ground, pitch or changing room is the same picture on every surface (section 72)", () => {
  const code = (rel: string) => readFileSync(join(MOBILE, rel), "utf8")
  // The picture standing in for a record is seeded by that record's id everywhere it is drawn: the editors...
  assert.match(code("app/(tabs)/admin/venues/[venueId]/edit.tsx"), /<PhotoPicker[^>]*domain="VENUE"[^>]*seed=\{String\(venueId/)
  assert.match(code("app/(tabs)/admin/venues/[venueId]/pitches/[pitchId].tsx"), /<PhotoPicker[^>]*domain="PITCH"[^>]*seed=\{String\(pitchId/)
  assert.match(code("app/(tabs)/admin/venues/[venueId]/changing-rooms/[roomId].tsx"), /<PhotoPicker[^>]*domain="CHANGING_ROOM"[^>]*seed=\{String\(roomId/)
  // ...the venue screens, Arena and the Match Centre.
  assert.match(code("app/(tabs)/admin/venues/[venueId].tsx"), /coverPhotoSource\("PITCH", resolvePitchCover\([^)]*\), p\.id\)/)
  assert.match(code("src/arena/hub-screen.tsx"), /venuePhoto\(cover, v\.id\)/)
  assert.match(code("src/fixtures/match-centre/arena-section.tsx"), /pitchPhoto\([\s\S]{0,80}view\.pitch\.id\)/)
  // A real photo always wins over the library, and a chosen picture over the stand-in -- one resolver for every surface.
  const real = resolveObjectMedia({ domain: "PITCH", uploadedUrl: "https://x/real.jpg", stockKey: "pitch-4g-01", seed: "p1" })
  assert.equal(real.provenance, "UPLOADED")
  assert.equal(isIllustrative("PITCH", real.provenance), false, "a real pitch photo is never labelled illustrative")
  const chosen = resolveObjectMedia({ domain: "CHANGING_ROOM", stockKey: "changing-tiled-01", seed: "r1" })
  assert.deepEqual([chosen.provenance, chosen.stockKey], ["STOCK", "changing-tiled-01"])
  assert.equal(resolveObjectMedia({ domain: "VENUE", seed: "v1" }).stockKey, resolveObjectMedia({ domain: "VENUE", seed: "v1" }).stockKey, "the stand-in is stable")
})

test("a picture added to the library is a choice, never a new stand-in: no existing ground, pitch or room changes picture", () => {
  // The stand-in pool is what it was before the Arena pass; the new pictures are choices only.
  for (const key of ["arena-estate-01", "venue-pavilion-posts-01", "venue-timber-pavilion-01", "venue-clubhouse-dusk-02", "pitch-touchline-01", "pitch-through-posts-01", "event-family-fun-day-02", "training-equipment-01", "event-awards-02", "event-winter-social-01", "changing-oak-hooks-01", "tournament-festival-aerial-01"]) {
    const m = stockMedia(key)!
    assert.ok(m && m.pickable && m.fallback === false, `${key} is a choice and not a stand-in`)
    for (const d of m.domains) {
      for (let i = 0; i < 200; i++) assert.notEqual(stockFallbackKey(d, `seed-${i}`), key, `${key} stood in for a ${d}`)
    }
  }
})

test("every picture picker is the one media picker", () => {
  for (const host of ["src/tournaments/cover-control.tsx", "src/events/editor.tsx", "src/venue/photo-picker.tsx"]) {
    assert.match(readFileSync(join(MOBILE, host), "utf8"), /MediaPickerSheet/, `${host} has its own picker`)
  }
  assert.match(readFileSync(join(MOBILE, "src/team/cover-library-screen.tsx"), "utf8"), /StockLibraryBrowser/)
})
