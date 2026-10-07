import { useLocalSearchParams } from "expo-router"

import { MembershipChange } from "../../../../../src/people/membership-change"
import { WithClub } from "../../../../../src/people/club-gate"

/** Deactivate Membership -- read, then confirmed: access paused, roles paused, history and account kept. */
export default function DeactivateRoute() {
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>()
  return <WithClub title="Deactivate Membership">{(clubId) => <MembershipChange clubId={clubId} membershipId={membershipId} kind="deactivate" />}</WithClub>
}
