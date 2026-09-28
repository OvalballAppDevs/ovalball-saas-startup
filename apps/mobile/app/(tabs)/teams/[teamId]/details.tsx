import { useLocalSearchParams } from "expo-router"

import { TeamDetailsScreen } from "../../../../src/team/team-details-screen"

/** The one canonical Team Details destination (Section 6) -- reached from the Team Profile ellipsis
 * menu and from Overview's own "Team Details" row. */
export default function TeamDetailsRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamDetailsScreen teamId={teamId} />
}
