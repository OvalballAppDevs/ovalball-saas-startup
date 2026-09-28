import { useLocalSearchParams } from "expo-router"

import { CoverLibraryScreen } from "../../../../src/team/cover-library-screen"

/** The Ovalball Image Library (Section 5), reached from Edit Team Photo's "Use Ovalball Image Library". */
export default function CoverLibraryRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  if (!teamId) return null
  return <CoverLibraryScreen teamId={teamId} />
}
