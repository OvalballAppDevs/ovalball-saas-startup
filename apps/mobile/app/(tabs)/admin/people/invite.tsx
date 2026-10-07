import { useLocalSearchParams } from "expo-router"

import { InviteFlow, startRoleFrom, type InvitePreset } from "../../../../src/people/invite-flow"
import { WithClub } from "../../../../src/people/club-gate"

/** The one invitation flow, from the club's side (Add to Club, People, Roles & Access). */
export default function InviteRoute() {
  const { preset, teamId, teamName, role, title } = useLocalSearchParams<{ preset?: string; teamId?: string; teamName?: string; role?: string; title?: string }>()
  const p: InvitePreset = preset === "admin" ? "admin" : preset === "member" ? "member" : "staff"
  return (
    <WithClub title="Invite Person">
      {(clubId) => <InviteFlow clubId={clubId} preset={p} teamId={teamId || null} teamName={teamName || null} startRole={startRoleFrom(role, title)} returnTo="/admin/people/invite" />}
    </WithClub>
  )
}
