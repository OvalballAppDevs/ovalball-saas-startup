/**
 * P1 — THE PARENT SHELL, AND THE FAMILY IT IS BUILT ON.
 *
 * Two things are asserted here, and they are the two a browser cannot reach.
 *
 * THE SHELL IS A PROJECTION. Which five destinations the bar holds, and which
 * three the header holds, is a product decision made in one module so that it
 * can be changed in one place and asserted here. A literal route typed into a
 * layout would appear on a phone whether or not the projection granted it.
 *
 * THE FAMILY IS A CANONICAL SCOPE, not a list a screen assembled. Every rule
 * below is about what happens to an id the client supplies -- restored from
 * storage, arriving in a deep link, or simply wrong -- because that is the only
 * direction from which a child filter can become a player browser.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { HEADER_UTILITIES, projectTabs } from "../../../apps/mobile/src/context/tab-projection"
import { projectHeaderUtilities } from "../../../apps/mobile/src/context/header-projection"
import {
  EMPTY_FAMILY,
  isInScope,
  normaliseSelection,
  projectFamily,
  selectedMember,
  teamIdsForSelection,
} from "@ovalball/contracts/family/projection"
import { applyFilter, NO_FILTER, countActive, isFiltered } from "../../../apps/mobile/src/agenda/filter"
import type { AgendaItem } from "@ovalball/contracts/agenda/load"

// ---------------------------------------------------------------- the shell

test("the parent bottom bar is exactly Home, Fixtures, Calendar, Rugby Hub, More", () => {
  const tabs = projectTabs({ kind: "parent" })
  assert.deepEqual(
    tabs.map((t) => t.label),
    ["Home", "Fixtures", "Calendar", "Rugby Hub", "More"]
  )
})

test("a player gets the same five — identical navigation, different authority inside each", () => {
  assert.deepEqual(projectTabs({ kind: "player" }).map((t) => t.label), projectTabs({ kind: "parent" }).map((t) => t.label))
})

test("Messages is not a bottom-bar destination on any context", () => {
  for (const kind of ["parent", "family", "player", "team", "club", "site_admin", "governing"] as const) {
    const keys = projectTabs({ kind }).map((t) => t.key)
    assert.ok(!keys.includes("messages"), `${kind} still has Messages in the bar`)
  }
})

test("the header holds Messages, Notifications and Support — and none of them is also a bar cell", () => {
  assert.deepEqual(HEADER_UTILITIES, ["messages", "notifications", "support"])
  const bar = new Set(projectTabs({ kind: "parent" }).map((t) => t.key))
  for (const utility of HEADER_UTILITIES) {
    assert.ok(!bar.has(utility), `${utility} is in both the bar and the header`)
  }
})

test("the bar is five cells — the width a label stays readable in", () => {
  for (const kind of ["parent", "player", "team", "club"] as const) {
    assert.equal(projectTabs({ kind }).length, 5, `${kind} has the wrong number of cells`)
  }
})

// ------------------------------------------------------- the three badges

const counts = (messages: number, notifications: number, support: number) => ({
  messages,
  notifications,
  support,
  total: messages + notifications + support,
})

test("the cluster is Messages, Notifications, Support, in that order", () => {
  assert.deepEqual(projectHeaderUtilities(counts(0, 0, 0)).map((u) => u.label), [
    "Messages",
    "Notifications",
    "Support",
  ])
})

test("each badge carries its own canonical count and nobody else's", () => {
  const [messages, notifications, support] = projectHeaderUtilities(counts(3, 7, 1))
  assert.equal(messages.count, 3)
  assert.equal(notifications.count, 7)
  assert.equal(support.count, 1)
})

test("reading every message leaves the bell exactly where it was", () => {
  // The bug this projection exists to prevent: a notifications badge computed as
  // `total - messages` would fall from 7 to 0 here, and the parent would never
  // see the announcement that was waiting for them.
  const before = projectHeaderUtilities(counts(3, 7, 1))
  const after = projectHeaderUtilities(counts(0, 7, 1))
  assert.equal(before[1].count, 7)
  assert.equal(after[1].count, 7)
  assert.equal(after[0].showBadge, false)
})

test("a Support ticket reply does not appear on the bell, and the reverse", () => {
  const supportOnly = projectHeaderUtilities(counts(0, 0, 2))
  assert.deepEqual(supportOnly.map((u) => u.count), [0, 0, 2])
  const bellOnly = projectHeaderUtilities(counts(0, 2, 0))
  assert.deepEqual(bellOnly.map((u) => u.count), [0, 2, 0])
})

test("nothing unread means no badge at all, never a badge reading zero", () => {
  for (const utility of projectHeaderUtilities(counts(0, 0, 0))) {
    assert.equal(utility.showBadge, false)
    assert.equal(utility.accessibilityLabel, utility.label, "a quiet control should not announce a count")
  }
})

test("the count is spoken, not only drawn", () => {
  const [messages] = projectHeaderUtilities(counts(3, 0, 0))
  assert.equal(messages.accessibilityLabel, "Messages, 3 unread")
})

test("a very large count becomes 99+ rather than a layout problem", () => {
  const [messages] = projectHeaderUtilities(counts(1240, 0, 0))
  assert.equal(messages.badgeText, "99+")
  assert.equal(messages.count, 1240, "the spoken fact stays exact")
  assert.equal(messages.accessibilityLabel, "Messages, 1240 unread")
  assert.equal(projectHeaderUtilities(counts(99, 0, 0))[0].badgeText, "99")
})

test("the total is never one of the badges", () => {
  const projected = projectHeaderUtilities(counts(3, 7, 1))
  assert.equal(projected.some((u) => u.count === 11), false, "a badge is showing the combined total")
})

test("each utility opens its own destination", () => {
  assert.deepEqual(projectHeaderUtilities(counts(0, 0, 0)).map((u) => u.href), [
    "/messages",
    "/notifications",
    "/support",
  ])
})

// --------------------------------------------------------------- the family

const AVATARS = new Map([["players/pippa.jpg", "https://signed.example/pippa"]])

const child = (playerId: string, firstName: string, surname: string, teamId: string, avatar: string | null = null) => ({
  playerId,
  firstName,
  surname,
  // Built exactly as `resolveFamilyScope` builds it, trailing space and all,
  // so a surnameless child is the shape the projection really receives.
  fullName: `${firstName} ${surname}`.trim(),
  teamId,
  teamName: "Under 12 Boys",
  clubId: "club-1",
  clubName: "Ovalball UAT RUFC",
  avatarStoragePath: avatar,
})

const PIPPA = child("p-1", "Pippa", "Krzysik", "team-u12", "players/pippa.jpg")
const GEORGE = child("p-2", "George", "Krzysik", "team-u14")

test("no children is a family with no choice, not an error", () => {
  const projection = projectFamily([], AVATARS)
  assert.deepEqual(projection, EMPTY_FAMILY)
  assert.equal(projection.hasChoice, false)
  assert.equal(normaliseSelection(projection, "p-1"), null)
})

test("one child offers no chooser at all", () => {
  const projection = projectFamily([PIPPA], AVATARS)
  assert.equal(projection.members.length, 1)
  assert.equal(projection.hasChoice, false, "a parent of one must not be shown a selector")
})

test("one child on two teams is still one child, not a team selector wearing a name", () => {
  const projection = projectFamily([PIPPA, child("p-1", "Pippa", "Krzysik", "team-u13", "players/pippa.jpg")], AVATARS)
  assert.equal(projection.hasChoice, false)
  assert.deepEqual(teamIdsForSelection(projection, "p-1").sort(), ["team-u12", "team-u13"])
})

test("two children give a chooser, labelled by first name", () => {
  const projection = projectFamily([PIPPA, GEORGE], AVATARS)
  assert.equal(projection.hasChoice, true)
  assert.deepEqual(projection.members.map((m) => m.shortLabel), ["Pippa", "George"])
})

test("siblings sharing a first name get their full names, because two identical chips are not a filter", () => {
  const projection = projectFamily([PIPPA, child("p-3", "Pippa", "Doyle", "team-u14")], AVATARS)
  assert.deepEqual(projection.members.map((m) => m.shortLabel), ["Pippa Krzysik", "Pippa Doyle"])
})

test("a child's own picture is resolved, and its absence is initials rather than a gap", () => {
  const projection = projectFamily([PIPPA, GEORGE], AVATARS)
  assert.equal(projection.members[0].avatarUrl, "https://signed.example/pippa")
  assert.equal(projection.members[1].avatarUrl, null)
  assert.equal(projection.members[1].initials, "GK")
})

test("a picture the signing refused is null, never a broken URL", () => {
  // The bucket's policy IS the check: a caller who may not see a child's photo
  // simply gets no signed URL back for that path.
  const projection = projectFamily([PIPPA], new Map())
  assert.equal(projection.members[0].avatarUrl, null)
})

test("a missing surname does not produce a stray initial or an empty label", () => {
  const projection = projectFamily([child("p-4", "Rowan", "", "team-u16")], AVATARS)
  assert.equal(projection.members[0].initials, "R")
  assert.equal(projection.members[0].shortLabel, "Rowan")
  assert.equal(projection.members[0].fullName, "Rowan")
})

// ------------------------------------------------- the client-supplied id

test("an id outside the family is rejected, and normalises to all children", () => {
  const projection = projectFamily([PIPPA, GEORGE], AVATARS)
  for (const supplied of ["p-99", "00000000-0000-4000-8000-00000000dead", "", "   ", null, undefined]) {
    assert.equal(isInScope(projection, supplied as string), false, `${JSON.stringify(supplied)} was accepted`)
    assert.equal(normaliseSelection(projection, supplied as string), null)
    assert.equal(selectedMember(projection, normaliseSelection(projection, supplied as string)), null)
  }
})

test("a selection restored from storage that is no longer in scope becomes all children", () => {
  // A child's place ends; the parent returns to the app tomorrow. They should
  // see their family, not a failure about an id they never typed.
  const before = projectFamily([PIPPA, GEORGE], AVATARS)
  assert.equal(normaliseSelection(before, "p-2"), "p-2")
  const after = projectFamily([PIPPA], AVATARS)
  assert.equal(normaliseSelection(after, "p-2"), null)
})

test("teamIdsForSelection never returns a team outside the family", () => {
  const projection = projectFamily([PIPPA, GEORGE], AVATARS)
  assert.deepEqual(teamIdsForSelection(projection, "p-99"), [])
  assert.deepEqual(teamIdsForSelection(projection, null).sort(), ["team-u12", "team-u14"])
})

// ------------------------------------------------------- the narrowing itself

function row(key: string, playerId: string | null): AgendaItem {
  return {
    key,
    kind: "fixture",
    eventId: key,
    date: "2026-10-02",
    time: "10:30",
    meetTime: null,
    us: { directoryId: null, clubName: "Ovalball UAT RUFC", teamName: "Under 12 Boys", compactName: "U12", crestUrl: null, kit: null },
    them: null,
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    result: null,
    playerId,
    childFirstName: null,
    attendance: null,
    teamId: "team-u12",
    clubId: "club-1",
    href: null,
  } as AgendaItem
}

const ROWS = [row("pippa-match", "p-1"), row("george-match", "p-2"), row("staff-row", null)]

test("choosing a child removes the others, and nothing else", () => {
  const kept = applyFilter(ROWS, { ...NO_FILTER, playerId: "p-1" })
  assert.deepEqual(kept.map((r) => r.key), ["pippa-match"])
})

test("one child's rugby never leaks into the other's", () => {
  const pippa = applyFilter(ROWS, { ...NO_FILTER, playerId: "p-1" }).map((r) => r.key)
  const george = applyFilter(ROWS, { ...NO_FILTER, playerId: "p-2" }).map((r) => r.key)
  assert.deepEqual(pippa, ["pippa-match"])
  assert.deepEqual(george, ["george-match"])
  assert.equal(pippa.some((k) => george.includes(k)), false)
})

test("a child id nobody holds empties the list rather than widening it", () => {
  // Belt and braces: even if normalisation were bypassed, the filter can only
  // ever remove from rows the loader already returned.
  assert.deepEqual(applyFilter(ROWS, { ...NO_FILTER, playerId: "p-99" }), [])
})

test("no selection shows the whole family", () => {
  assert.equal(applyFilter(ROWS, NO_FILTER).length, 3)
  assert.equal(isFiltered(NO_FILTER), false)
})

test("a chosen child counts as an active filter, so the interface offers to clear it", () => {
  const filter = { ...NO_FILTER, playerId: "p-1" }
  assert.equal(isFiltered(filter), true)
  assert.equal(countActive(filter), 1)
})
