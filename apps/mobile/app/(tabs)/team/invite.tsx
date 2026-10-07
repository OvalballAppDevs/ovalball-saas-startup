import { useLocalSearchParams } from "expo-router"

import { InviteFlow, startRoleFrom } from "../../../src/people/invite-flow"

/** The one invitation flow, opened from a team: the team is chosen, so it is Details, Role, Review, Send. */
export default function TeamInviteRoute() {
  const { clubId, teamId, teamName, role, title } = useLocalSearchParams<{ clubId: string; teamId: string; teamName?: string; role?: string; title?: string }>()
  return <InviteFlow clubId={clubId} preset="staff" teamId={teamId} teamName={teamName || null} startRole={startRoleFrom(role, title)} returnTo={`/team/invite?clubId=${encodeURIComponent(clubId)}&teamId=${encodeURIComponent(teamId)}&teamName=${encodeURIComponent(teamName ?? "")}`} />
}
