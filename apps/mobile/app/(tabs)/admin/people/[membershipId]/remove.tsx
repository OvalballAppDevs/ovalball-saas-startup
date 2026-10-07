import { useLocalSearchParams } from "expo-router"

import { MembershipChange } from "../../../../../src/people/membership-change"
import { WithClub } from "../../../../../src/people/club-gate"

/** Remove from Club -- read, then confirmed: the relationship ends, history and the account are kept. */
export default function RemoveRoute() {
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>()
  return <WithClub title="Remove from Club">{(clubId) => <MembershipChange clubId={clubId} membershipId={membershipId} kind="remove" />}</WithClub>
}
