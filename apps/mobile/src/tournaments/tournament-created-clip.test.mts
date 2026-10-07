import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"

/**
 * THE TOURNAMENT CREATED CONVERSION CLIP.
 *
 * The clip itself is a generated asset and its content is judged by eye. What is worth pinning is
 * everything AROUND it: that it plays once and silently, that it cannot strand somebody on a cream
 * screen if it fails to decode, that Reduce Motion skips it, and that it is small enough to ship.
 *
 * (An earlier code-drawn version of this animation existed with a geometry test that sampled the
 * ball's arc. The product owner chose the generated clip instead, so that component and its tests
 * were removed with it rather than left behind testing nothing.)
 */

const SRC = new URL(".", import.meta.url).pathname
const FILE = `${SRC}tournament-created-clip.tsx`
const SCREEN = `${SRC}../../app/(tabs)/admin/tournaments/new/created.tsx`
const ASSET = `${SRC}../../assets/tournaments/tournament-created.mp4`
const source = readFileSync(FILE, "utf8")

test("the clip ships with the app and is small enough to", () => {
  const bytes = statSync(ASSET).size
  assert.ok(bytes > 10_000, "the asset must actually be there")
  assert.ok(bytes < 2_000_000, `the clip is ${Math.round(bytes / 1024)}KB; a success moment must not be a download`)
})

test("it plays once, silently, with no controls", () => {
  assert.match(source, /p\.loop = false/)
  assert.match(source, /p\.muted = true/)
  assert.match(source, /nativeControls=\{false\}/)
  assert.match(source, /allowsPictureInPicture=\{false\}/)
  assert.match(source, /pointerEvents="none"/, "it must never swallow a tap")
})

test("it covers the screen, so there is no video rectangle with an edge", () => {
  assert.match(source, /contentFit="cover"/)
  assert.match(source, /StyleSheet\.absoluteFill/)
  // The clip's ground is warmer than Ovalball chalk, so the view behind it matches the clip exactly.
  assert.match(source, /export const CLIP_BACKGROUND = "#FFF9ED"/)
  assert.match(source, /backgroundColor: CLIP_BACKGROUND/)
})

test("it cross-fades into the success screen rather than cutting", () => {
  assert.match(source, /withTiming\(0, \{ duration: FADE/)
  assert.match(source, /const FADE = 260/)
})

test("it hands over before the clip's dead air, not at the end of the file", () => {
  // The tick and the words have settled by 3.25s of a 4s clip; the rest is a still frame.
  assert.match(source, /const HAND_OVER_AT = 3400/)
})

test("NOTHING can strand a person on the clip", () => {
  // Three independent ways out: the planned cut, a guard timer, and a decode failure.
  assert.match(source, /const cut = setTimeout\(finish, HAND_OVER_AT\)/)
  assert.match(source, /const guard = setTimeout\(finish, HAND_OVER_AT \+ 2000\)/)
  assert.match(source, /if \(status === "error"\) setFailed\(true\)/)
  assert.match(source, /if \(failed && !done\.current\)/)
  // And it can only hand over once, however many of those fire.
  assert.match(source, /if \(done\.current\) return/)
})

test("Reduce Motion skips the clip and shows the outcome at once", () => {
  assert.match(source, /if \(reduceMotion\) \{\s*\n\s*onDone\(\)/)
  assert.match(source, /if \(reduceMotion \|\| failed\) return null/)
})

test("every timer is cleared, so leaving mid-clip cannot fire a late hand-over", () => {
  const cleanup = source.slice(source.indexOf("return () => {"), source.indexOf("}, [reduceMotion, onDone, fade])"))
  for (const timer of ["cut", "tap", "guard"]) {
    assert.ok(cleanup.includes(`clearTimeout(${timer})`), `${timer} must be cleared`)
  }
  assert.match(cleanup, /cancelAnimation\(fade\)/)
})

test("the success screen plays it over itself, so the screen is ready underneath", () => {
  const screen = readFileSync(SCREEN, "utf8")
  assert.match(screen, /TournamentCreatedClip/)
  assert.match(screen, /\{celebrating && <TournamentCreatedClip/)
  // And the row already exists by then -- the clip is never a promise that something will be saved.
  assert.match(screen, /\.from\("tournaments"\)/)
})
