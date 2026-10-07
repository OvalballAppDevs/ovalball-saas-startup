import { useRouter } from "expo-router"

import { AddStaff } from "../../../../src/people/add-staff"
import { WithClub } from "../../../../src/people/club-gate"

/** Add Staff Members from the club: the team is chosen on the screen. */
export default function AddStaffRoute() {
  const router = useRouter()
  return (
    <WithClub title="Add Staff Members">
      {(clubId) => (
        <AddStaff
          clubId={clubId}
          inviteRoute={(teamId, teamName) => (teamId ? `/admin/people/invite?preset=staff&teamId=${encodeURIComponent(teamId)}&teamName=${encodeURIComponent(teamName ?? "")}` : "/admin/people/invite?preset=staff")}
          onFinished={() => (router.canGoBack() ? router.back() : router.dismissTo("/admin/people" as never))}
        />
      )}
    </WithClub>
  )
}
