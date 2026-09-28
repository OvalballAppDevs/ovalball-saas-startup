import { useLocalSearchParams } from "expo-router"

import { TeamProfileScreen } from "../../../src/team/profile-screen"

/**
 * THE ONE CANONICAL TEAM PROFILE ROUTE. Club Admin Home's Your Teams rail, the club Teams list,
 * Clubhouse's cross-club Club Profile and Fixtures all converge here rather than each carrying a
 * role-shaped copy -- see `TeamProfileScreen` for why that convergence is safe per viewer.
 */
export default function TeamProfileRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamProfileScreen teamId={teamId} />
}
