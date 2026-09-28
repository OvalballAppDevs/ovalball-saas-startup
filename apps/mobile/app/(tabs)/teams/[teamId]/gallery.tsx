import { useLocalSearchParams } from "expo-router"

import { TeamGalleryScreen } from "../../../../src/team/team-gallery-screen"

/** The full Team Gallery (Section 5) -- reached from Media's "Show all", or with `?add=1` from the tab's
 * own "Add Photos" CTA to open straight onto the Add Photos sheet. */
export default function TeamGalleryRoute() {
  const { teamId, add } = useLocalSearchParams<{ teamId: string; add?: string }>()
  if (!teamId) return null
  return <TeamGalleryScreen teamId={teamId} openAdd={add === "1"} />
}
