import { useLocalSearchParams } from "expo-router"

import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { MemberDetails } from "../../../../../src/people/member-details"
import { WithClub } from "../../../../../src/people/club-gate"

/**
 * MEMBER DETAILS -- one person's relationship with this club. The screen is `src/people/member-details.tsx`,
 * which carries the canonical rules: the PERSON's avatar (`resolvePersonalAvatarUrl`, drawn by
 * `<PersonAvatar`), every change through the confirmed, reasoned `ReasonSheet`, re-read on focus
 * (`useFocusEffect`), and Deactivate Membership / Remove from Club as their own confirmation screens.
 */
export default function PersonScreen() {
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>()
  const { refresh } = useAdminCentreAccess()
  return <WithClub title="Member Details">{(clubId) => <MemberDetails clubId={clubId} membershipId={membershipId} onAccessChanged={() => void refresh()} />}</WithClub>
}
