import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_RETURN,
  RETURN_SURFACES,
  buildFixtureReturn,
  fixtureHrefWithReturn,
  resolveFixtureReturn,
} from "@/lib/fixtures/return-context"

/**
 * WHERE "BACK" GOES FROM A FIXTURE.
 *
 * Match Centre's back link carries the surface it was opened from, which is
 * the shape open redirects are written in -- so the property that matters is
 * not "the happy path works" but "nothing else does". These assert the whole
 * refusal family, not one string trick: a foreign origin, a scheme, a
 * network-path reference, a backslash, an unknown internal path, a prefix
 * near-miss, a fragment, a control character, an over-long value, a foreign
 * query parameter, and a stale target.
 *
 * Every one of them has the same answer, and it is not an error: /fixtures,
 * which every viewer can reach and which is exactly where this link went
 * before any of this existed.
 */

const CONTROL_CENTRE = "/fixtures/management"

test("a recognised surface with its own filters survives the round trip", () => {
  const carried = buildFixtureReturn(CONTROL_CENTRE, "date=all&team=abc&ha=Away&sort=date-desc")
  assert.ok(carried)
  const back = resolveFixtureReturn(carried)
  assert.equal(back.label, "Fixture Control Centre")
  assert.ok(back.href.startsWith(`${CONTROL_CENTRE}?`))
  for (const part of ["date=all", "team=abc", "ha=Away", "sort=date-desc"]) {
    assert.ok(back.href.includes(part), `${part} missing from ${back.href}`)
  }
})

test("an explicit date window is carried, because it is what the person is looking at", () => {
  const carried = buildFixtureReturn(CONTROL_CENTRE, "from_date=2026-09-14&to_date=2026-09-20")
  const back = resolveFixtureReturn(carried)
  assert.ok(back.href.includes("from_date=2026-09-14"))
  assert.ok(back.href.includes("to_date=2026-09-20"))
})

test("Calendar's repeatable status parameter keeps every value", () => {
  const carried = buildFixtureReturn("/calendar", "week=2026-W38&status=Booked&status=Planned")
  const back = resolveFixtureReturn(carried)
  assert.equal(back.label, "Calendar")
  assert.equal((back.href.match(/status=/g) ?? []).length, 2)
})

test("nothing is carried from a surface that is not a fixture's origin", () => {
  assert.equal(buildFixtureReturn("/admin/users", "q=x"), null)
  assert.equal(buildFixtureReturn("/", ""), null)
})

test("the default destination with no filters is not worth carrying", () => {
  assert.equal(buildFixtureReturn("/fixtures", ""), null)
})

test("a parameter the destination does not parse is dropped, not passed on", () => {
  const carried = buildFixtureReturn(CONTROL_CENTRE, "date=all&evil=%3Cscript%3E&redirect=https://evil.example")
  assert.ok(!carried!.includes("evil"))
  assert.ok(!carried!.includes("redirect"))
  // And again on the way back in, for a value that did not come from us.
  const back = resolveFixtureReturn(`${CONTROL_CENTRE}?date=all&redirect=https://evil.example`)
  assert.equal(back.href, `${CONTROL_CENTRE}?date=all`)
})

test("every foreign or malformed target resolves to the default, never to itself", () => {
  const refused = [
    "https://evil.example/fixtures/management",
    "//evil.example/fixtures/management",
    "/\\evil.example",
    "https://user@evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "  /fixtures/management",
    "fixtures/management",
    "/fixtures/management#frag",
    "/admin/users",
    // A prefix near-miss: the allowlist is exact paths, so this is not
    // "/admin/fixtures" with something after it.
    "/admin/fixtures-evil",
    "/fixtures/management/../../admin/users",
    "/fixtures/management\u0000",
    "/fixtures/management\n/admin/users",
    "",
    null,
    undefined,
  ]
  for (const value of refused) {
    const back = resolveFixtureReturn(value as string)
    assert.equal(back.href, DEFAULT_RETURN.href, `expected the default for ${JSON.stringify(value)}, got ${back.href}`)
  }
})

test("an over-long filter value is dropped while the surface itself survives", () => {
  const back = resolveFixtureReturn(`${CONTROL_CENTRE}?date=all&q=${"x".repeat(200)}`)
  assert.equal(back.href, `${CONTROL_CENTRE}?date=all`)
})

test("a whole target longer than the cap is refused outright", () => {
  const back = resolveFixtureReturn(`${CONTROL_CENTRE}?${"a=1&".repeat(400)}`)
  assert.equal(back.href, DEFAULT_RETURN.href)
})

test("an array value -- a repeated query parameter -- takes the first, and is still validated", () => {
  assert.equal(resolveFixtureReturn(["/calendar", "https://evil.example"]).href, "/calendar")
  assert.equal(resolveFixtureReturn(["https://evil.example", "/calendar"]).href, DEFAULT_RETURN.href)
})

test("a stale target that is still a known surface is honoured; the filters it names may simply match nothing", () => {
  // A team that has since been deleted is not a security question and must not
  // send somebody to an error: the Control Centre renders its own empty state.
  const back = resolveFixtureReturn(`${CONTROL_CENTRE}?team=00000000-0000-0000-0000-000000000000`)
  assert.equal(back.href, `${CONTROL_CENTRE}?team=00000000-0000-0000-0000-000000000000`)
})

const A_TEAM = "11111111-2222-4333-8444-555555555555"

test("every surface on the allowlist resolves to itself", () => {
  for (const surface of RETURN_SURFACES) {
    // Convergence Step 10 added a surface whose path carries one canonical id.
    // Its bare path is not a destination -- `/teams` is a list, not the team a
    // fixture was opened from -- so it is exercised with an id, and the bare
    // form is asserted to fall back rather than resolve.
    if (surface.idSegment) {
      const withId = `${surface.path}/${A_TEAM}`
      assert.equal(resolveFixtureReturn(withId).href, withId)
      assert.equal(resolveFixtureReturn(surface.path).href, "/fixtures")
      continue
    }
    assert.equal(resolveFixtureReturn(surface.path).href, surface.path)
  }
})

test("an id-carrying surface is exact, not a prefix", () => {
  // The lesson `/admin/fixtures` vs `/admin/fixtures-evil` taught, applied to
  // the one surface whose path is not fully literal.
  for (const hostile of [
    "/teams-evil/11111111-2222-4333-8444-555555555555",
    `/teams/${A_TEAM}/settings`,
    `/teams/${A_TEAM}/../admin`,
    "/teams/not-a-uuid",
    "/teams/11111111-2222-4333-8444",
    `/teams/${A_TEAM}%2Fadmin`,
  ]) {
    assert.equal(resolveFixtureReturn(hostile).href, "/fixtures", `${hostile} resolved somewhere it should not`)
  }
})

test("a team return carries no query parameters, because a team page parses none", () => {
  assert.equal(resolveFixtureReturn(`/teams/${A_TEAM}?tab=secrets&x=1`).href, `/teams/${A_TEAM}`)
})

test("the fixture link carries the value encoded, and omits it when there is none", () => {
  assert.equal(fixtureHrefWithReturn("abc", null), "/fixtures/abc")
  const href = fixtureHrefWithReturn("abc", "/fixtures/management?date=all")
  assert.equal(href, "/fixtures/abc?from=%2Ffixtures%2Fmanagement%3Fdate%3Dall")
  // And what the page will read back out of it is the surface, not the string.
  const decoded = decodeURIComponent(href.split("from=")[1])
  assert.equal(resolveFixtureReturn(decoded).href, "/fixtures/management?date=all")
})
