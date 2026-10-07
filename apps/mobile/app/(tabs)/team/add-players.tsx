import { useLocalSearchParams } from "expo-router"

import { AddPlayers } from "../../../src/people/add-players"

/**
 * Add Players from a team's Squad: the SAME screen as Add to Club's, with this team already chosen. The
 * team and its club arrive from the team profile as explicit ids; every action is re-checked by the server
 * against that team (team.join_code.manage), never against the switched context.
 */
export default function TeamAddPlayersRoute() {
  const { clubId, teamId, teamName } = useLocalSearchParams<{ clubId: string; teamId: string; teamName?: string }>()
  return <AddPlayers clubId={clubId} teamId={teamId} teamName={teamName || null} requestsRoute="/team/settings/requests" />
}
