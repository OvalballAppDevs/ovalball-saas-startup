import { Redirect, useLocalSearchParams } from "expo-router"
import { STANDING_ORDER } from "@ovalball/contracts/membership/board"

/**
 * THE MEMBERSHIP BOARD BECAME MEMBERS (Club Memberships Part 2).
 *
 * Everything the board did lives on: each player's standing, grouped in working order with the settled groups folded
 * (Members); the team chips (the Team filter on Members, and Teams); the strip and its sentence (the standing bar on
 * the overview and on every team); Send Reminders and its "not included" line (Reminders, with the exact message
 * shown first); Tell the Team (Teams); and the month's money with what each line means (the overview's This Month's
 * Money). An old link to this screen lands on Members, with the team or standing it asked for still chosen.
 */
const STANDINGS = new Set<string>(STANDING_ORDER)

export default function MembershipBoardMoved() {
  const params = useLocalSearchParams<{ teamId?: string; filter?: string; standing?: string; segment?: string }>()
  const forward: Record<string, string> = {}
  if (params.teamId) forward.teamId = String(params.teamId)
  const standing = params.standing ?? params.filter
  if (standing && STANDINGS.has(String(standing))) forward.standing = String(standing)
  if (params.segment) forward.segment = String(params.segment)
  return <Redirect href={{ pathname: "/admin/subscriptions/members", params: forward } as never} />
}
