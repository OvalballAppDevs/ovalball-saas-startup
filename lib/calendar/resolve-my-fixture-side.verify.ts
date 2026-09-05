import { resolveMyFixtureSide } from "./resolve-my-fixture-side"

/** Run with `npx tsx lib/calendar/resolve-entry-participant.verify.ts`. Permanent regression coverage for the canonical "which side of this fixture is mine" resolver (Calendar component-team filtering pass). */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

const myTeamIds = ["me-a", "me-b"]

// 1. TEAM vs TEAM, I own it -- my side is the owning team, no group.
check(
  "1. TEAM vs TEAM, I am owning -- my side resolves to the owning team, no group",
  resolveMyFixtureSide({ owning_team_id: "me-a", opponent_team_id: "them-a", owning_scheduling_group_id: null, opponent_scheduling_group_id: null }, myTeamIds),
  { myTeamId: "me-a", myGroupId: null, iAmOpponent: false }
)

// 2. TEAM vs TEAM, I am the opponent -- my side is the opponent team.
check(
  "2. TEAM vs TEAM, I am opponent -- my side resolves to the opponent team",
  resolveMyFixtureSide({ owning_team_id: "them-a", opponent_team_id: "me-a", owning_scheduling_group_id: null, opponent_scheduling_group_id: null }, myTeamIds),
  { myTeamId: "me-a", myGroupId: null, iAmOpponent: true }
)

// 3. GROUP vs TEAM, I own the group side -- my group id comes from the OWNING column.
check(
  "3. GROUP vs TEAM, I am owning -- my group id is the owning group, never the opponent's (null)",
  resolveMyFixtureSide({ owning_team_id: "me-a", opponent_team_id: "them-a", owning_scheduling_group_id: "gMine", opponent_scheduling_group_id: null }, myTeamIds),
  { myTeamId: "me-a", myGroupId: "gMine", iAmOpponent: false }
)

// 4. TEAM vs GROUP, I am the OPPONENT side and MY side is the group -- this is the
// exact bug this pass fixes: previously the opponent side's group was
// hardcoded to null regardless of what the row actually stored.
check(
  "4. TEAM vs GROUP, I am opponent and my side IS the group -- my group id comes from the OPPONENT column, not hardcoded null",
  resolveMyFixtureSide({ owning_team_id: "them-a", opponent_team_id: "me-a", owning_scheduling_group_id: null, opponent_scheduling_group_id: "gMine" }, myTeamIds),
  { myTeamId: "me-a", myGroupId: "gMine", iAmOpponent: true }
)

// 5. GROUP vs GROUP, I am opponent -- my group is the opponent group; the
// owning side's group is never mistaken for mine.
check(
  "5. GROUP vs GROUP, I am opponent -- my group is my own side's group, not the owning side's",
  resolveMyFixtureSide({ owning_team_id: "them-a", opponent_team_id: "me-a", owning_scheduling_group_id: "gTheirs", opponent_scheduling_group_id: "gMine" }, myTeamIds),
  { myTeamId: "me-a", myGroupId: "gMine", iAmOpponent: true }
)

// 6. GROUP vs GROUP, I am owning -- symmetric case.
check(
  "6. GROUP vs GROUP, I am owning -- my group is the owning side's group",
  resolveMyFixtureSide({ owning_team_id: "me-a", opponent_team_id: "them-a", owning_scheduling_group_id: "gMine", opponent_scheduling_group_id: "gTheirs" }, myTeamIds),
  { myTeamId: "me-a", myGroupId: "gMine", iAmOpponent: false }
)

// 7. Neither side is mine (should not occur given the fetch query, but never assumed) -- myTeamId is null, never a guess.
check(
  "7. Neither side is mine -- myTeamId is null rather than guessed",
  resolveMyFixtureSide({ owning_team_id: "them-a", opponent_team_id: "them-b", owning_scheduling_group_id: null, opponent_scheduling_group_id: null }, myTeamIds),
  { myTeamId: null, myGroupId: null, iAmOpponent: false }
)

// 8. Unclaimed opponent (opponent_team_id null) -- I am always the owning side, never misclassified as opponent.
check(
  "8. Unclaimed opponent -- I am the owning side, iAmOpponent is false",
  resolveMyFixtureSide({ owning_team_id: "me-a", opponent_team_id: null, owning_scheduling_group_id: null, opponent_scheduling_group_id: null }, myTeamIds),
  { myTeamId: "me-a", myGroupId: null, iAmOpponent: false }
)

console.log(`\n${pass} PASS, ${fail} FAIL`)
