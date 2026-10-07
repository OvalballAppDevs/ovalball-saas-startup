import { useLocalSearchParams } from "expo-router"

import { ConfirmTeamRequest } from "../../../src/family/team-request"

/** A parent's answer to their child's own team request -- from its notification or Action Required row. */
export default function TeamRequestRoute() {
  const { membershipId } = useLocalSearchParams<{ membershipId?: string }>()
  return <ConfirmTeamRequest membershipId={typeof membershipId === "string" && membershipId.length > 0 ? membershipId : null} />
}
