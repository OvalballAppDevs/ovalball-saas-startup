import { useLocalSearchParams } from "expo-router"

import { useAppContexts } from "../../../src/context/contexts"
import { ReferClub } from "../../../src/clubhouse/refer-flow"
import { EmptyState } from "../../../src/components/ui"
import { FlowScreen } from "../../../src/people/ui"

/** Refer a Club -- from Refer Clubs (choose the club) or a club's own directory page (the club is chosen). */
export default function ReferClubRoute() {
  const { directoryId, clubName } = useLocalSearchParams<{ directoryId?: string; clubName?: string }>()
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  if (!clubId) {
    return (
      <FlowScreen title="Refer a Club">
        <EmptyState title="Choose your club first" body="A referral is made by a club. Switch to your club from the header, then try again." />
      </FlowScreen>
    )
  }
  return <ReferClub clubId={clubId} directoryId={directoryId || null} directoryName={clubName || null} />
}
