import { useLocalSearchParams, useRouter } from "expo-router"

import { AddStaff } from "../../../src/people/add-staff"

/**
 * Add Staff Members from a team's Staff tab: the SAME screen as Add to Club's, with this team chosen.
 * Explicit ids from the team profile -- never the switched active context -- as Staff management has
 * always required.
 */
export default function TeamAddStaffRoute() {
  const router = useRouter()
  const { clubId, teamId, teamName } = useLocalSearchParams<{ clubId: string; teamId: string; teamName?: string }>()
  return (
    <AddStaff
      clubId={clubId}
      teamId={teamId}
      teamName={teamName || null}
      inviteRoute={(t, n) => `/team/invite?clubId=${encodeURIComponent(clubId)}&teamId=${encodeURIComponent(t ?? teamId)}&teamName=${encodeURIComponent(n ?? teamName ?? "")}`}
      onFinished={() => router.back()}
    />
  )
}
