import { test } from "node:test"
import assert from "node:assert/strict"

import { buildDirectionsUrl, formatVenueAddress } from "@/lib/fixtures/directions-url"

/**
 * The Directions action hands a user a URL and asks them to follow it, so
 * these tests are about one thing above all: nothing user-writable may
 * influence where that link goes.
 */

const ORIGIN = "https://www.google.com/maps/dir/"

test("coordinates are preferred, because they are unambiguous", () => {
  const url = buildDirectionsUrl({ name: "Holden Road", latitude: 53.789, longitude: -2.235 })!
  assert.ok(url.startsWith(ORIGIN))
  assert.match(url, /destination=53\.789%2C-2\.235/)
})

test("a venue with no coordinates falls back to its canonical postal address", () => {
  const url = buildDirectionsUrl({
    name: "Holden Road",
    addressLines: ["Holden Road", "Burnley"],
    postcode: "BB11 4RS",
  })!
  assert.ok(url.startsWith(ORIGIN))
  assert.equal(new URL(url).searchParams.get("destination"), "Holden Road, Holden Road, Burnley, BB11 4RS")
})

test("a venue with nothing to navigate to yields no link at all", () => {
  // The caller omits the button rather than rendering one that goes nowhere.
  assert.equal(buildDirectionsUrl({}), null)
  assert.equal(buildDirectionsUrl({ addressLines: [], postcode: null }), null)
  assert.equal(buildDirectionsUrl({ name: "   ", postcode: "  " }), null)
})

test("nonsense coordinates are refused rather than sent to the Atlantic", () => {
  // 0,0 is almost always an unset default, never a rugby pitch.
  assert.equal(buildDirectionsUrl({ latitude: 0, longitude: 0 }), null)
  // Out of range, and NaN, both fall through to the address path.
  assert.equal(buildDirectionsUrl({ latitude: 999, longitude: 5 }), null)
  assert.equal(buildDirectionsUrl({ latitude: Number.NaN, longitude: 1 }), null)
  const withAddress = buildDirectionsUrl({ latitude: 0, longitude: 0, postcode: "BB11 4RS" })!
  assert.equal(new URL(withAddress).searchParams.get("destination"), "BB11 4RS")
})

test("the destination host is a constant -- no open redirect", () => {
  // Every attempt below tries to steer the link somewhere else through the
  // only fields an importer or a club admin can write.
  const hostile = [
    { name: "https://evil.example.com" },
    { name: "Ground", postcode: "@evil.example.com" },
    { name: "Ground", addressLines: ["//evil.example.com"] },
    { name: "javascript:alert(1)" },
    { name: "Ground\r\nLocation: https://evil.example.com" },
  ]
  for (const target of hostile) {
    const url = buildDirectionsUrl(target)
    if (url === null) continue
    assert.ok(url.startsWith(ORIGIN), `link escaped the constant origin: ${url}`)
    assert.equal(new URL(url).host, "www.google.com", `host was steered to ${new URL(url).host}`)
  }
})

test("special characters are encoded, never left to escape the query", () => {
  const url = buildDirectionsUrl({ name: "A&B Ground #2", postcode: "BB1 1AA" })!
  const parsed = new URL(url)
  // Exactly two parameters -- an unencoded & would have produced more.
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ["api", "destination"])
  assert.equal(parsed.searchParams.get("destination"), "A&B Ground #2, BB1 1AA")
})

test("the rendered address drops blanks instead of leaving empty segments", () => {
  // "Holden Road, , , BB11 4RS" is the failure this prevents.
  assert.equal(
    formatVenueAddress({ addressLines: ["Holden Road", "", "  "], postcode: "BB11 4RS" }),
    "Holden Road, BB11 4RS"
  )
  assert.equal(formatVenueAddress({ addressLines: [], postcode: null }), null)
  assert.equal(formatVenueAddress({ addressLines: ["Holden Road"], postcode: null }), "Holden Road")
})
