import { useLocalSearchParams } from "expo-router"

import { TeamPhotoScreen } from "../../../../src/team/team-photo-screen"

/**
 * THE ONE CANONICAL TEAM PHOTO DESTINATION, reached from the Team Profile's own ellipsis menu.
 * Establishes the real shell Section 6's editor will fill in; see `TeamPhotoScreen` for why it shows
 * no working picker yet rather than a fake one.
 */
export default function TeamPhotoRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <TeamPhotoScreen teamId={teamId} />
}
