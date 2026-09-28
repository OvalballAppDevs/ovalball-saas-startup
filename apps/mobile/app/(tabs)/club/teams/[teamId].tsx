import { useLocalSearchParams } from "expo-router"

import { TeamProfileScreen } from "../../../../src/team/profile-screen"

/**
 * CONVERGES ON THE CANONICAL TEAM PROFILE (owner brief: Team Profiles + Club Admin Home). This used to
 * carry its own club-scoped identity/fixtures/people-count rendering; that duplicated exactly what
 * `TeamProfileScreen` now does for every viewer, including Enter Team Context (still shown here as
 * anywhere else, gated the same way -- see `teamContextKeyFor` inside the shared screen). The route
 * stays so existing links into `/club/teams/[teamId]` keep resolving.
 */
export default function ClubTeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamProfileScreen teamId={teamId} />
}
