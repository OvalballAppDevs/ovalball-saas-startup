/**
 * Canonical fixture single-source-of-truth pass: the ONE shared definition
 * of "does this fixture's HOME side carry a Mini-Rugby Group, and does its
 * AWAY side" -- read directly from the row's own owning_scheduling_
 * group_id/opponent_scheduling_group_id, never re-derived from anything
 * else. Originally lived under lib/pitch-allocation as a feature-local
 * one-liner; promoted here once Fixture Management became a third
 * consumer (alongside Pitch Allocation's data.ts/actions.ts) needing the
 * exact same home/away-relative group resolution -- one function, not a
 * third re-derivation of the same rule.
 */
export function resolveHomeAwayGroupIds(f: {
  owning_team_id: string
  home_team_id: string | null
  owning_scheduling_group_id: string | null
  opponent_scheduling_group_id: string | null
}): { homeGroupId: string | null; awayGroupId: string | null; homeIsOwning: boolean } {
  const homeIsOwning = f.owning_team_id === f.home_team_id
  return {
    homeGroupId: homeIsOwning ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id,
    awayGroupId: homeIsOwning ? f.opponent_scheduling_group_id : f.owning_scheduling_group_id,
    homeIsOwning,
  }
}
