import { useLocalSearchParams } from "expo-router"

import { TeamDocumentsScreen } from "../../../../../src/team/team-documents-screen"

/** A team's documents, opened from Club Documents' Teams list -- the one Team Documents screen, never a copy. */
export default function ClubDocumentsTeamRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamDocumentsScreen teamId={teamId} />
}
