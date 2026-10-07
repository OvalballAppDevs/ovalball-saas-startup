import type { ReactNode } from "react"
import { View } from "react-native"

import { useAdminCentreAccess } from "../admin/access"
import { EmptyState } from "../components/ui"
import { space } from "../design/tokens"
import { FlowScreen } from "./ui"

/**
 * THE CLUB A PEOPLE SCREEN IS ABOUT -- the club context the header shows, never a club named in a link.
 * Outside a club context these screens say so rather than guessing a club; every action they offer is
 * re-checked by the server against that club anyway.
 */
export function WithClub({ title, children }: { title: string; children: (clubId: string) => ReactNode }) {
  const { clubId } = useAdminCentreAccess()
  if (!clubId) {
    return (
      <FlowScreen title={title}>
        <View style={{ padding: space.lg }}>
          <EmptyState title="Choose your club first" body="People are managed from a club. Switch to your club from the header, then try again." />
        </View>
      </FlowScreen>
    )
  }
  return <>{children(clubId)}</>
}
