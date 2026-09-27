import { test } from "node:test"
import assert from "node:assert/strict"

import { sortTeamsInRugbyAgeOrder, summariseClubAgeGroups } from "../../../packages/contracts/src/club/teams"

/**
 * FIND A FIXTURE FF-1.1: "rugby-natural age order" pinned directly, because a plain lexical/alphabetical
 * sort of `age_group` text gets this wrong on every axis a rugby person reads a team list by --
 * "Under 10" sorts before "Under 16" before "Under 7" alphabetically, which is backwards. Derived
 * entirely from each team's own canonical `category`/`ageGroup`, never a hardcoded team name.
 */

type MinimalTeam = { category: "senior" | "youth" | "colts"; ageGroup: string | null; displayName: string }

function team(overrides: Partial<MinimalTeam> = {}): MinimalTeam {
  return { category: "youth", ageGroup: "U12", displayName: "Under 12", ...overrides }
}

test("sortTeamsInRugbyAgeOrder: senior teams sort before every age-grade team", () => {
  const teams = [team({ category: "youth", ageGroup: "U18", displayName: "Under 18 Boys" }), team({ category: "senior", ageGroup: null, displayName: "Men's 1st Team" })]
  const sorted = sortTeamsInRugbyAgeOrder(teams)
  assert.deepEqual(
    sorted.map((t) => t.displayName),
    ["Men's 1st Team", "Under 18 Boys"],
    "a senior side sorts first even against the oldest age grade"
  )
})

test("sortTeamsInRugbyAgeOrder: age grades sort numerically descending, never lexically -- U16 before U12 before U10 before U8 before U7", () => {
  const teams = [
    team({ ageGroup: "U10", displayName: "Under 10 Mixed" }),
    team({ ageGroup: "U16", displayName: "Under 16 Boys" }),
    team({ ageGroup: "U7", displayName: "Under 7 Mixed" }),
    team({ ageGroup: "U8", displayName: "Under 8 Mixed" }),
    team({ ageGroup: "U12", displayName: "Under 12 Boys" }),
  ]
  const sorted = sortTeamsInRugbyAgeOrder(teams)
  assert.deepEqual(
    sorted.map((t) => t.displayName),
    ["Under 16 Boys", "Under 12 Boys", "Under 10 Mixed", "Under 8 Mixed", "Under 7 Mixed"],
    "oldest age grade first, youngest last -- a lexical sort would wrongly put Under 10 before Under 16 and Under 7 before Under 8"
  )
})

test("sortTeamsInRugbyAgeOrder: colts sort between senior and every age grade", () => {
  const teams = [team({ category: "youth", ageGroup: "U18", displayName: "Under 18 Boys" }), team({ category: "colts", ageGroup: null, displayName: "Colts" }), team({ category: "senior", ageGroup: null, displayName: "Men's 1st Team" })]
  const sorted = sortTeamsInRugbyAgeOrder(teams)
  assert.deepEqual(
    sorted.map((t) => t.displayName),
    ["Men's 1st Team", "Colts", "Under 18 Boys"]
  )
})

test("sortTeamsInRugbyAgeOrder: two teams at the same rank fall back to their own team name, deterministically -- a Mixed side before its own Mixed B", () => {
  const teams = [team({ ageGroup: "U8", displayName: "Under 8 Mixed B" }), team({ ageGroup: "U8", displayName: "Under 8 Mixed" })]
  const sorted = sortTeamsInRugbyAgeOrder(teams)
  assert.deepEqual(
    sorted.map((t) => t.displayName),
    ["Under 8 Mixed", "Under 8 Mixed B"]
  )
})

test("sortTeamsInRugbyAgeOrder: reproduces the reported UAT roster's shape end to end -- both senior sides ahead of every age grade, age grades oldest-to-youngest, Mixed ahead of its own Mixed B", () => {
  // The owner's own report named an exact illustrative order but hedged it as "approximately" -- the
  // hard requirement is the RULE (senior group first, then descending age, deterministic ties), not one
  // specific tie-break between two senior sides the spec never actually pinned down. This asserts
  // everything the rule DOES guarantee, without asserting the one relative order it never specified.
  const teams = [
    team({ category: "senior", ageGroup: null, displayName: "Women's 1st Team" }),
    team({ category: "senior", ageGroup: null, displayName: "Men's 1st Team" }),
    team({ ageGroup: "U16", displayName: "Under 16 Boys" }),
    team({ ageGroup: "U12", displayName: "Under 12 Boys" }),
    team({ ageGroup: "U10", displayName: "Under 10 Mixed" }),
    team({ ageGroup: "U8", displayName: "Under 8 Mixed" }),
    team({ ageGroup: "U8", displayName: "Under 8 Mixed B" }),
    team({ ageGroup: "U7", displayName: "Under 7 Mixed" }),
  ]
  // Deliberately shuffled input -- the sort must not depend on the array already being close to sorted.
  const shuffled = [teams[4]!, teams[7]!, teams[1]!, teams[6]!, teams[0]!, teams[2]!, teams[5]!, teams[3]!]
  const sorted = sortTeamsInRugbyAgeOrder(shuffled).map((t) => t.displayName)
  assert.deepEqual(
    new Set(sorted.slice(0, 2)),
    new Set(["Men's 1st Team", "Women's 1st Team"]),
    "both senior sides occupy the first two places, ahead of every age grade"
  )
  assert.deepEqual(sorted.slice(2), ["Under 16 Boys", "Under 12 Boys", "Under 10 Mixed", "Under 8 Mixed", "Under 8 Mixed B", "Under 7 Mixed"], "age grades oldest-to-youngest, Mixed ahead of its own Mixed B")
})

// ---------------------------------------------------------------------------------------------
// summariseClubAgeGroups -- the Public Club Profile's own age-range metric (visual-lock, Section 9)
// ---------------------------------------------------------------------------------------------

test("summariseClubAgeGroups: a full run from U7 to U16 reads 'U7 – U16'", () => {
  const teams = [{ ageGroup: "U7" }, { ageGroup: "U8" }, { ageGroup: "U10" }, { ageGroup: "U12" }, { ageGroup: "U16" }]
  assert.equal(summariseClubAgeGroups(teams), "U7 – U16")
})

test("summariseClubAgeGroups: exactly one age grade reads just that grade, not a degenerate range", () => {
  assert.equal(summariseClubAgeGroups([{ ageGroup: "U16" }]), "U16")
})

test("summariseClubAgeGroups: a senior-only roster (no ageGroup at all) is null, never a fabricated range", () => {
  assert.equal(summariseClubAgeGroups([{ ageGroup: null }, { ageGroup: null }]), null)
})

test("summariseClubAgeGroups: senior sides alongside one age grade still reads just that age grade -- senior rows never enter the range", () => {
  assert.equal(summariseClubAgeGroups([{ ageGroup: null }, { ageGroup: null }, { ageGroup: "U16" }]), "U16")
})

test("summariseClubAgeGroups: unordered input gives the same answer as sorted input", () => {
  const teams = [{ ageGroup: "U12" }, { ageGroup: "U7" }, { ageGroup: "U16" }, { ageGroup: "U10" }]
  assert.equal(summariseClubAgeGroups(teams), "U7 – U16")
})

test("summariseClubAgeGroups: duplicate age grades (a Boys and a Girls side at the same age) don't widen the range", () => {
  const teams = [{ ageGroup: "U12" }, { ageGroup: "U12" }, { ageGroup: "U14" }, { ageGroup: "U14" }]
  assert.equal(summariseClubAgeGroups(teams), "U12 – U14")
})

test("summariseClubAgeGroups: an empty roster is null", () => {
  assert.equal(summariseClubAgeGroups([]), null)
})
