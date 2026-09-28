import { useLocalSearchParams } from "expo-router"

import { TeamDocumentsScreen } from "../../../../src/team/team-documents-screen"

/** The one canonical Team Documents destination (Section 7) -- reached from the Team Profile ellipsis
 * menu. Presents the SAME canonical Club Document Library rows Club Documents shows for this team. */
export default function TeamDocumentsRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamDocumentsScreen teamId={teamId} />
}
