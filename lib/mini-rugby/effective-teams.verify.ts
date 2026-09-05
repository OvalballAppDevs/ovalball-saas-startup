import { effectiveFixtureParticipants, effectiveTeamIdsForFixtureSide } from "./effective-teams"

/** Run with `npx tsx lib/mini-rugby/effective-teams.verify.ts`. Permanent regression coverage for the canonical effective-team resolver (Mini-Rugby Group / Team Administration / Season Handover pass, Section 5/6/25). */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

// 1. Ordinary team vs ordinary team -- no group at all.
check("1. Ordinary fixture resolves to its own single team_id", effectiveTeamIdsForFixtureSide("u12", null, new Map()), ["u12"])

// 2. Mini-Rugby Group side -- expands to every real component team_id.
{
  const members = new Map([["g1", ["u7", "u8b"]]])
  check("2. Group-owned fixture expands to all component team_ids", effectiveTeamIdsForFixtureSide("u7", "g1", members), ["u7", "u8b"])
}

// 3. Squad-specific group (Section 27) -- returns EXACTLY those two component teams, never every team sharing an age.
{
  const members = new Map([["g2", ["u6b", "u7c"]]])
  const result = effectiveTeamIdsForFixtureSide("u6b", "g2", members)
  check("3a. Squad-specific group returns exactly its own two components", result.sort(), ["u6b", "u7c"].sort())
  check("3b. Squad-specific group never widens to a same-age primary squad not in the group", result.includes("u6-primary"), false)
}

// 4. Defensive fallback -- a group_id set but genuinely no membership rows found (deleted/broken mid-flight) falls back to the owning team alone, never an empty commitment.
check("4. Missing group membership falls back to the owning team_id alone, never empty", effectiveTeamIdsForFixtureSide("u9", "ghost-group", new Map()), ["u9"])

// 5. Deterministic -- identical input produces identical output.
{
  const members = new Map([["g1", ["u7", "u8b"]]])
  const a = effectiveTeamIdsForFixtureSide("u7", "g1", members)
  const b = effectiveTeamIdsForFixtureSide("u7", "g1", members)
  check("5. Deterministic across repeated calls", a, b)
}

// ------------------------------------------------------------
// effectiveFixtureParticipants -- the side-preserving, whole-fixture
// resolver (group-vs-group Main Project pass, Section 6/14).
// ------------------------------------------------------------

// 6. TEAM vs TEAM, Home -- owning is home, opponent is away, both singletons.
check(
  "6. Team vs team (Home) splits correctly by side",
  effectiveFixtureParticipants({ homeAway: "Home", owningTeamId: "u12a", owningSchedulingGroupId: null, opponentTeamId: "u12b", opponentSchedulingGroupId: null }, new Map()),
  { homeTeamIds: ["u12a"], awayTeamIds: ["u12b"], allTeamIds: ["u12a", "u12b"] }
)

// 7. GROUP vs TEAM, Away -- owning (the group) ends up away, opponent (team) ends up home.
{
  const members = new Map([["gA", ["u6", "u7"]]])
  check(
    "7. Group vs team (Away) expands the owning group and puts it on the away side",
    effectiveFixtureParticipants({ homeAway: "Away", owningTeamId: "u6", owningSchedulingGroupId: "gA", opponentTeamId: "u8", opponentSchedulingGroupId: null }, members),
    { homeTeamIds: ["u8"], awayTeamIds: ["u6", "u7"], allTeamIds: ["u6", "u7", "u8"] }
  )
}

// 8. TEAM vs GROUP, Home -- opponent side is the group; proves the opponent side (added this pass) expands too, not just the owning side.
{
  const members = new Map([["gB", ["u7b", "u8c"]]])
  check(
    "8. Team vs group (Home) expands the OPPONENT group -- proves the opponent side is no longer collapsed to one team",
    effectiveFixtureParticipants({ homeAway: "Home", owningTeamId: "u7a", owningSchedulingGroupId: null, opponentTeamId: "u7b", opponentSchedulingGroupId: "gB" }, members),
    { homeTeamIds: ["u7a"], awayTeamIds: ["u7b", "u8c"], allTeamIds: ["u7a", "u7b", "u8c"] }
  )
}

// 9. GROUP vs GROUP -- both sides expand, still correctly split by home/away, and the dedup set covers all four real teams.
{
  const members = new Map([
    ["gHome", ["u6a", "u7a"]],
    ["gAway", ["u6b", "u7b"]],
  ])
  const result = effectiveFixtureParticipants({ homeAway: "Home", owningTeamId: "u6a", owningSchedulingGroupId: "gHome", opponentTeamId: "u6b", opponentSchedulingGroupId: "gAway" }, members)
  check("9a. Group vs group -- home side expands to its own two components", result.homeTeamIds.sort(), ["u6a", "u7a"].sort())
  check("9b. Group vs group -- away side expands to its own two components", result.awayTeamIds.sort(), ["u6b", "u7b"].sort())
  check("9c. Group vs group -- allTeamIds is the deduplicated union of all four real teams", result.allTeamIds.sort(), ["u6a", "u6b", "u7a", "u7b"].sort())
}

// 10. TBD fixture -- home/away genuinely undetermined must never be guessed, but allTeamIds still reflects real commitment for conflict-checking purposes.
check(
  "10. TBD fixture leaves home/away empty (never guessed) but still populates allTeamIds",
  effectiveFixtureParticipants({ homeAway: "TBD", owningTeamId: "u9", owningSchedulingGroupId: null, opponentTeamId: "u10", opponentSchedulingGroupId: null }, new Map()),
  { homeTeamIds: [], awayTeamIds: [], allTeamIds: ["u9", "u10"] }
)

// 11. No opponent yet (unclaimed/unresolved) -- allTeamIds is just the owning side, never fabricating an opponent.
check(
  "11. No opponent resolved yet -- allTeamIds is the owning side alone",
  effectiveFixtureParticipants({ homeAway: "Home", owningTeamId: "u11", owningSchedulingGroupId: null, opponentTeamId: null, opponentSchedulingGroupId: null }, new Map()),
  { homeTeamIds: ["u11"], awayTeamIds: [], allTeamIds: ["u11"] }
)

console.log(`\n${pass} PASS, ${fail} FAIL`)
