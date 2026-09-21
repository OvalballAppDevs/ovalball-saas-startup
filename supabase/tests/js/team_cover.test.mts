import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveTeamCover, teamCoverUrl } from "@/lib/teams/team-cover"

/**
 * ONE FALLBACK CHAIN FOR A TEAM'S PICTURE.
 *
 * The rule this file protects is the one Step 6 established for club logos and
 * paid for by removing ten hand-written chains: there is exactly one place that
 * decides, and "no picture" is a legitimate answer rather than a prompt to
 * invent one.
 */

const URL_BASE = "http://127.0.0.1:54321"

test("a team's own cover wins", () => {
  const cover = resolveTeamCover({ coverImagePath: "club-x/u12-cover.jpg", crestUrl: "https://crest", supabaseUrl: URL_BASE })
  assert.equal(cover.kind, "cover")
  assert.match(cover.kind === "cover" ? cover.url : "", /club-news-media\/club-x\/u12-cover\.jpg$/)
})

test("without one, the club's crest stands in, and is marked as a crest", () => {
  const cover = resolveTeamCover({ coverImagePath: null, crestUrl: "https://crest", supabaseUrl: URL_BASE })
  // The KIND matters as much as the url: a crest is an identity mark to be
  // centred, not a photograph to be stretched across a banner.
  assert.deepEqual(cover, { kind: "crest", url: "https://crest" })
})

test("with neither, the answer is nothing -- never a stock photograph of somebody else's rugby", () => {
  assert.deepEqual(resolveTeamCover({ coverImagePath: null, crestUrl: null, supabaseUrl: URL_BASE }), { kind: "none" })
  assert.deepEqual(resolveTeamCover({ coverImagePath: "   ", crestUrl: null, supabaseUrl: URL_BASE }), { kind: "none" })
})

test("an empty or whitespace path is not a cover", () => {
  assert.equal(teamCoverUrl("", URL_BASE), null)
  assert.equal(teamCoverUrl("   ", URL_BASE), null)
  assert.equal(teamCoverUrl(null, URL_BASE), null)
  assert.equal(teamCoverUrl(undefined, URL_BASE), null)
})

test("the bucket is the one club news already uses -- there is no second media architecture", () => {
  assert.match(teamCoverUrl("a/b.png", URL_BASE) ?? "", /\/storage\/v1\/object\/public\/club-news-media\/a\/b\.png$/)
})

test("a trailing slash on the project URL does not produce a double slash", () => {
  assert.equal(
    teamCoverUrl("a/b.png", "http://127.0.0.1:54321/"),
    "http://127.0.0.1:54321/storage/v1/object/public/club-news-media/a/b.png"
  )
})
