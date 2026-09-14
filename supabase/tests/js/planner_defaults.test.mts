import { test } from "node:test"
import assert from "node:assert/strict"

import type { MatchableTeam } from "@/lib/fixtures/opposition-match"
import { applyPlannerDefaults, suggestTeamForRow, type PlannerDefaultsContext, type SuggestableField } from "@/lib/fixtures/planner-defaults"
import { blankRow, type PlannerDraftRow } from "@/lib/fixtures/planner-model"

/**
 * THE SEASON PLANNER'S SUGGESTIONS -- filled when they help, and never over
 * somebody's own answer unless a material change has made that answer wrong.
 */

const team = (id: string, label: string, ageGroup: string, gender: string | null, squad: string | null = null): MatchableTeam => ({
  id,
  label,
  rugbyCode: "union",
  category: "youth",
  ageGroup,
  gender,
  squadDesignation: squad,
})

const ours = team("ours", "Under 12 Boys", "U12", "boys")
const prestonTeams = [team("p12", "Under 12 Boys", "U12", "boys"), team("p12g", "Under 12 Girls", "U12", "girls"), team("p13", "Under 13 Boys", "U13", "boys")]

const ctx = (over: Partial<PlannerDefaultsContext> = {}): PlannerDefaultsContext => ({
  ourTeam: ours,
  opposition: { onOvalball: true, homeGround: "Preston Grasshoppers, Lightfoot Green", teams: prestonTeams },
  ourGround: { venue: "Hutton Road", pitch: "Pitch 1" },
  ...over,
})

const row = (over: Partial<PlannerDraftRow> = {}): PlannerDraftRow => ({ ...blankRow(), ourTeam: "Under 12 Boys", ...over })
const none = new Set<SuggestableField>()

test("an Ovalball opposition club fills the one strong team match, marked as a suggestion", () => {
  const before = row()
  const r = applyPlannerDefaults(before, { ...before, oppositionClub: "Preston Grasshoppers" }, none, ctx())
  assert.equal(r.row.oppositionTeam, "Under 12 Boys")
  assert.ok(r.suggested.has("oppositionTeam"))
})

test("never a girls side for a boys side, and nothing filled when no strong match exists", () => {
  const before = row()
  const r = applyPlannerDefaults(before, { ...before, oppositionClub: "Preston Grasshoppers" }, none, ctx({ opposition: { onOvalball: true, homeGround: null, teams: [prestonTeams[1], prestonTeams[2]] } }))
  assert.equal(r.row.oppositionTeam, "")
  assert.ok(!r.suggested.has("oppositionTeam"))
})

test("several strong matches leave the choice to the person", () => {
  const before = row()
  const twins = [team("a", "Under 12 Boys", "U12", "boys"), team("b", "Under 12 Mixed", "U12", "mixed")]
  const r = applyPlannerDefaults(before, { ...before, oppositionClub: "Preston Grasshoppers" }, none, ctx({ opposition: { onOvalball: true, homeGround: null, teams: twins } }))
  assert.equal(r.row.oppositionTeam, "")
})

test("an external club is never given a team, and waits for nothing", () => {
  const before = row()
  const r = applyPlannerDefaults(before, { ...before, oppositionClub: "Nowhere Vale RFC" }, none, ctx({ opposition: { onOvalball: false, homeGround: null, teams: null } }))
  assert.equal(r.row.oppositionTeam, "")
  assert.equal(r.awaitingTeams, false)
})

test("teams still loading are reported, then suggested when they arrive", () => {
  const before = row()
  const loading = ctx({ opposition: { onOvalball: true, homeGround: null, teams: null } })
  const r = applyPlannerDefaults(before, { ...before, oppositionClub: "Preston Grasshoppers" }, none, loading)
  assert.equal(r.awaitingTeams, true)
  const later = suggestTeamForRow(r.row, r.suggested, ctx())
  assert.equal(later.row.oppositionTeam, "Under 12 Boys")
})

test("a team somebody typed survives a change of our team, but not a change of club", () => {
  const typed = row({ oppositionClub: "Preston Grasshoppers", oppositionTeam: "Under 13 Boys" })
  const r1 = applyPlannerDefaults(typed, { ...typed, ourTeam: "Under 12 Boys B" }, none, ctx())
  assert.equal(r1.row.oppositionTeam, "Under 13 Boys")
  const r2 = applyPlannerDefaults(typed, { ...typed, oppositionClub: "Fylde RFC" }, none, ctx({ opposition: { onOvalball: false, homeGround: null, teams: null } }))
  assert.equal(r2.row.oppositionTeam, "")
})

test("Home fills our default ground and its only pitch; Away fills their ground", () => {
  const before = row()
  const home = applyPlannerDefaults(before, { ...before, homeAway: "Home" }, none, ctx())
  assert.equal(home.row.venue, "Hutton Road")
  assert.equal(home.row.pitch, "Pitch 1")
  const withClub = row({ oppositionClub: "Preston Grasshoppers" })
  const away = applyPlannerDefaults(withClub, { ...withClub, homeAway: "Away" }, none, ctx())
  assert.equal(away.row.venue, "Preston Grasshoppers, Lightfoot Green")
  assert.equal(away.row.pitch, "")
})

test("filling Home/Away never replaces a venue somebody already typed", () => {
  const typed = row({ venue: "County Ground" })
  const r = applyPlannerDefaults(typed, { ...typed, homeAway: "Home" }, none, ctx())
  assert.equal(r.row.venue, "County Ground")
})

test("swapping Home to Away is material: the ground is the other club's now", () => {
  const home = row({ homeAway: "Home", oppositionClub: "Preston Grasshoppers", venue: "County Ground", pitch: "Pitch 3" })
  const r = applyPlannerDefaults(home, { ...home, homeAway: "Away" }, none, ctx())
  assert.equal(r.row.venue, "Preston Grasshoppers, Lightfoot Green")
  assert.equal(r.row.pitch, "")
})

test("a suggested away ground follows a change of opposition club; a typed one does not", () => {
  const suggested = new Set<SuggestableField>(["venue"])
  const away = row({ homeAway: "Away", oppositionClub: "Preston Grasshoppers", venue: "Preston Grasshoppers, Lightfoot Green" })
  const fylde = ctx({ opposition: { onOvalball: false, homeGround: "Woodlands Memorial Ground", teams: null } })
  const r1 = applyPlannerDefaults(away, { ...away, oppositionClub: "Fylde RFC" }, suggested, fylde)
  assert.equal(r1.row.venue, "Woodlands Memorial Ground")
  const r2 = applyPlannerDefaults(away, { ...away, oppositionClub: "Fylde RFC" }, none, fylde)
  assert.equal(r2.row.venue, "Preston Grasshoppers, Lightfoot Green")
})

test("typing over a suggestion makes it the person's own", () => {
  const s = new Set<SuggestableField>(["venue", "oppositionTeam"])
  const r0 = row({ homeAway: "Home", venue: "Hutton Road", oppositionClub: "Preston Grasshoppers", oppositionTeam: "Under 12 Boys" })
  const r = applyPlannerDefaults(r0, { ...r0, venue: "County Ground" }, s, ctx())
  assert.ok(!r.suggested.has("venue"))
  assert.ok(r.suggested.has("oppositionTeam"))
})

test("no ground on record fills nothing -- a venue is never invented", () => {
  const before = row({ oppositionClub: "Nowhere Vale RFC" })
  const r = applyPlannerDefaults(before, { ...before, homeAway: "Away" }, none, ctx({ opposition: { onOvalball: false, homeGround: null, teams: null } }))
  assert.equal(r.row.venue, "")
})

test("Away at an Ovalball club fills their ground and, when it has exactly one, its pitch", () => {
  const before = row({ oppositionClub: "Preston Grasshoppers" })
  const one = applyPlannerDefaults(before, { ...before, homeAway: "A" }, none, ctx({ opposition: { onOvalball: true, homeGround: "Lightfoot Green", homePitch: "Pitch 1", teams: prestonTeams } }))
  assert.equal(one.row.venue, "Lightfoot Green")
  assert.equal(one.row.pitch, "Pitch 1")
  assert.ok(one.suggested.has("pitch"))
  // Several pitches (or an external club): the ground only, and the pitch left to choose.
  const several = applyPlannerDefaults(before, { ...before, homeAway: "A" }, none, ctx({ opposition: { onOvalball: true, homeGround: "Lightfoot Green", homePitch: null, teams: prestonTeams } }))
  assert.equal(several.row.venue, "Lightfoot Green")
  assert.equal(several.row.pitch, "")
})

test("an ambiguous opposition match stays editable: nothing is chosen, and a later choice is kept", () => {
  const twins = [team("a", "Under 12 Boys", "U12", "boys"), team("b", "Under 12 Mixed", "U12", "mixed")]
  const opposition = { onOvalball: true, homeGround: null, teams: twins }
  const before = row()
  const first = applyPlannerDefaults(before, { ...before, oppositionClub: "Preston Grasshoppers" }, none, ctx({ opposition }))
  assert.equal(first.row.oppositionTeam, "")
  const chosen = { ...first.row, oppositionTeam: "Under 12 Mixed" }
  const later = applyPlannerDefaults(first.row, { ...chosen, kickoff: "11:00" }, first.suggested, ctx({ opposition }))
  assert.equal(later.row.oppositionTeam, "Under 12 Mixed")
})
