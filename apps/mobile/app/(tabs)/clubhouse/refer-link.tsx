import { useLocalSearchParams } from "expo-router"

import { useAppContexts } from "../../../src/context/contexts"
import { ShareClubLink } from "../../../src/clubhouse/refer-link"
import { EmptyState } from "../../../src/components/ui"
import { FlowScreen } from "../../../src/people/ui"

/** Your club's referral link -- from Refer Clubs' "Share Your Club Link" (?view=poster opens the poster). */
export default function ReferLinkRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>()
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  if (!clubId) {
    return (
      <FlowScreen title="Share Your Club's Referral">
        <EmptyState title="Choose your club first" body="A referral link belongs to a club. Switch to your club from the header, then try again." />
      </FlowScreen>
    )
  }
  return <ShareClubLink clubId={clubId} startOn={view === "poster" ? "poster" : "link"} />
}
