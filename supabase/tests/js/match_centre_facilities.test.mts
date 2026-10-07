/**
 * MATCH CENTRE ARENA, CANONICAL FACILITIES & THE PUBLIC TEAM PAGE -- the client half.
 *
 * The server half (whose ground, what may be referenced, switching home and away, who is offered contact)
 * is proved in supabase/tests/match_centre_facilities.sql. This pins what no SQL can see:
 *
 *   - Arena Details reads Venue, Pitch, Changing Rooms, then Catering directly under the rooms
 *   - a side not on Ovalball is "not available", never a zero
 *   - the pictures for a host not on Ovalball are stable and marked illustrative
 *   - the editor re-reads the host the moment home or away changes, and writes through the one RPC
 *   - Message Staff and Call render from the server's contact block alone -- no role test in the client
 *   - every position the server accepts has words, and every public-page setting the server knows is offered
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { PROVISIONAL_ROOM_NUMBERS, changingRoomLabel, stableStockIndex } from "../../../packages/contracts/src/match-centre/facilities"
import { PUBLIC_PROFILE_SETTINGS, positionLabel } from "../../../packages/contracts/src/match-centre/public-profiles"

const MOBILE = "apps/mobile"
const MC = `${MOBILE}/src/fixtures/match-centre`
const MIGRATION = "supabase/migrations/20270728000000_a_match_is_played_at_the_hosts_ground.sql"
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

test("a stock picture for a host not on Ovalball is chosen from the match itself, so it never shuffles", () => {
  const seed = "8f913f56-cea5-4412-ac54-eb14cc5cd19e"
  for (const size of [1, 8, 10]) {
    const first = stableStockIndex(seed, size)
    assert.equal(stableStockIndex(seed, size), first)
    assert.ok(first >= 0 && first < size)
  }
  const spread = new Set(Array.from({ length: 40 }, (_, i) => stableStockIndex(`fixture-${i}`, 10)))
  assert.ok(spread.size > 4, "different matches are not all given the same picture")
})

test("numbered changing rooms run 1 to 20, and a canonical room keeps its own name", () => {
  assert.deepEqual([PROVISIONAL_ROOM_NUMBERS[0], PROVISIONAL_ROOM_NUMBERS.at(-1), PROVISIONAL_ROOM_NUMBERS.length], [1, 20, 20])
  assert.equal(changingRoomLabel({ name: "Officials Room" }, null), "Officials Room")
  assert.equal(changingRoomLabel(null, 4), "Room 4")
  assert.equal(changingRoomLabel(null, null), null)
})

test("Arena Details reads Venue, Pitch, Changing Rooms, then Catering directly under the rooms", () => {
  const arena = code(`${MC}/arena-section.tsx`)
  const at = (needle: string) => {
    const i = arena.indexOf(needle)
    assert.ok(i >= 0, `${needle} is missing`)
    return i
  }
  const venue = at('overline="Venue"')
  const pitch = at('overline="Pitch"')
  const rooms = at('title="Changing Rooms"')
  const catering = at("<CateringCard")
  assert.ok(venue < pitch && pitch < rooms && rooms < catering, "the order is Venue, Pitch, Changing Rooms, Catering")
  assert.match(arena, /No changing rooms are available at the ground for this match/, "'none' is its own state, not 'not set'")
})

test("catering is the server's headcount, and a side not on Ovalball is never shown as zero", () => {
  const arena = code(`${MC}/arena-section.tsx`)
  assert.match(arena, /Attendance not available through Ovalball/)
  assert.match(arena, /sidesNotCounted/)
  assert.doesNotMatch(arena, /from\("player_fixture_attendance"\)/, "no attendance rows are counted in the client")
  assert.match(arena, /catering\?\.total !== undefined/, "the figures are drawn only where the server sent them (staff)")
  const attendance = code(`${MC}/attendance-section.tsx`)
  assert.doesNotMatch(attendance, /cateringLine\(|Utensils/, "catering lives in one place -- Arena Details")
})

test("pictures for a host not on Ovalball are labelled illustrative", () => {
  const arena = code(`${MC}/arena-section.tsx`)
  assert.match(arena, /Illustrative/)
  assert.match(arena, /illustrative=\{provisional/)
})

test("the editor re-reads the host's grounds when home or away changes, and writes the ground through one RPC", () => {
  const editor = code(`${MC}/details-editor.tsx`)
  assert.match(editor, /readFixtureFacilityOptions\(supabase, id, next\)/)
  // The ground and pitch travel in the one Save (`save_match_details`, 20270734), whose `facilities` key is the
  // same host-aware `set_fixture_facilities` write -- one write for the ground, inside one transaction.
  assert.match(editor, /saveMatchDetails\(supabase, id, \{[\s\S]*facilities:/)
  assert.match(readFileSync("supabase/migrations/20270734000000_one_save_one_notice.sql", "utf8"), /public\.set_fixture_facilities\(p_fixture_id, p_patch -> 'facilities'\)/)
  assert.match(editor, /mode === "CANONICAL"\s*\?\s*\{ venue_id: venueId, pitch_id: pitchId \}\s*:\s*\{ venue_text:/)
  assert.doesNotMatch(editor, /from\("venues"\)|from\("club_pitches"\)/, "the host's catalogue is read through the server's answer, never queried directly")
  const rooms = code(`${MC}/arrangements-editor.tsx`)
  assert.match(rooms, /setFixtureFacilities\(supabase, view\.fixtureId, patch\)/)
  assert.doesNotMatch(rooms, /set_fixture_arrangements/, "one write for the rooms and catering")
  assert.match(rooms, /venueChangingRoomTypeLabel\(/, "a room's type is shown in words, never its stored key")
  assert.doesNotMatch(rooms, /detail: r\.roomType \}/)
})

test("Message Staff and Call come from the server's contact block alone -- no role test in the client", () => {
  const page = code(`${MOBILE}/src/clubhouse/public-team-page.tsx`)
  assert.match(page, /\{!!profile\.contact && <ContactBar/)
  assert.doesNotMatch(page, /role ===|PARENT|GUARDIAN|isStaff|viewerRole/, "nothing in the page decides who is staff")
  assert.match(page, /contact\.canCall && !!contact\.phone/)
  assert.match(page, /contact\.canMessage && !!contact\.fixtureId/)
})

test("every position the server accepts, in either code, has words -- never an internal key", () => {
  const sql = readFileSync(MIGRATION, "utf8")
  const fn = sql.slice(sql.indexOf("function internal.squad_position_keys"), sql.indexOf("$function$;", sql.indexOf("function internal.squad_position_keys")))
  const keys = Array.from(fn.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).filter((k) => k !== "league")
  assert.ok(keys.length > 20)
  for (const key of keys) {
    const label = positionLabel(key)
    assert.ok(label && label !== key && !label.includes("_"), `${key} has no words`)
  }
})

test("every public-page setting the server knows is offered, and none it does not", () => {
  const sql = readFileSync(MIGRATION, "utf8")
  const declared = sql.match(/v_keys text\[\] := array\[([^\]]+)\]/)
  assert.ok(declared)
  const serverKeys = Array.from(declared[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort()
  assert.deepEqual(PUBLIC_PROFILE_SETTINGS.map((s) => s.key).sort(), serverKeys)
  for (const s of PUBLIC_PROFILE_SETTINGS) assert.match(s.label, /^[A-Z][A-Za-z&]*( ([A-Z&][A-Za-z]*|to|on|of))*$/, `${s.label} is Title Case`)
})
