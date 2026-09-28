import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveTeamCover, teamCoverUrlFromPath } from "@ovalball/contracts/team-cover"

/**
 * ONE FALLBACK CHAIN FOR A TEAM'S PICTURE.
 *
 * The rule this file protects is the one Step 6 established for club logos and paid for by removing
 * ten hand-written chains: there is exactly one place that decides, and "no picture" is a legitimate
 * answer rather than a prompt to invent one. Moved here (Team Profiles + Club Admin Home) from
 * `lib/teams/team-cover.ts`, which now only re-exports this module so React Native can reach it too --
 * see `club-logo.ts`'s own `lib/app-context/club-logo.ts` re-export for the identical precedent.
 */

const URL_BASE = "http://127.0.0.1:54321"

/** A minimal stand-in for the one storage call this module makes -- the real SDK's own `getPublicUrl`. */
const supabaseStub = {
  storage: {
    from: (bucket: string) => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${URL_BASE}/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  },
} as unknown as Parameters<typeof teamCoverUrlFromPath>[0]

test("a team's own cover wins", () => {
  const cover = resolveTeamCover({ supabase: supabaseStub, coverImagePath: "club-x/u12-cover.jpg", crestUrl: "https://crest" })
  assert.equal(cover.kind, "cover")
  assert.match(cover.kind === "cover" ? cover.url : "", /club-news-media\/club-x\/u12-cover\.jpg$/)
})

test("without one, the club's crest stands in, and is marked as a crest", () => {
  const cover = resolveTeamCover({ supabase: supabaseStub, coverImagePath: null, crestUrl: "https://crest" })
  // The KIND matters as much as the url: a crest is an identity mark to be
  // centred, not a photograph to be stretched across a banner.
  assert.deepEqual(cover, { kind: "crest", url: "https://crest" })
})

test("with neither, the answer is nothing -- never a stock photograph of somebody else's rugby", () => {
  assert.deepEqual(resolveTeamCover({ supabase: supabaseStub, coverImagePath: null, crestUrl: null }), { kind: "none" })
  assert.deepEqual(resolveTeamCover({ supabase: supabaseStub, coverImagePath: "   ", crestUrl: null }), { kind: "none" })
})

test("an empty or whitespace path is not a cover", () => {
  assert.equal(teamCoverUrlFromPath(supabaseStub, ""), null)
  assert.equal(teamCoverUrlFromPath(supabaseStub, "   "), null)
  assert.equal(teamCoverUrlFromPath(supabaseStub, null), null)
  assert.equal(teamCoverUrlFromPath(supabaseStub, undefined), null)
})

test("the bucket is the one club news already uses -- there is no second media architecture", () => {
  assert.match(teamCoverUrlFromPath(supabaseStub, "a/b.png") ?? "", /\/storage\/v1\/object\/public\/club-news-media\/a\/b\.png$/)
})
