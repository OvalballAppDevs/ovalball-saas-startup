import { useCallback, useState } from "react"
import { useFocusEffect, useRouter } from "expo-router"

import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { TeamPlaceRequestsSection } from "../../../../src/team/place-requests"
import { EmptyState } from "../../../../src/components/ui"

/**
 * JOIN REQUESTS -- the players waiting to be let into this side (CA-M7).
 *
 * A request is a `player_team_memberships` row in its pending state. Approving and declining are the
 * canonical operations (`approve_pending_team_membership` / `reject_pending_team_membership`), each
 * asking `team.roster.manage` at the team or the club and telling the family the outcome. There is no
 * second approval system here, and no second card: the team's Squad tab draws the same
 * `TeamPlaceRequestsSection` (team codes place players, 20270741000000), and the website's team People
 * page runs the same two operations.
 */
export default function TeamJoinRequests() {
  const router = useRouter()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [refreshing, setRefreshing] = useState(false)
  // A new key re-reads the section: on focus, and on pull to refresh.
  const [generation, setGeneration] = useState(0)

  useFocusEffect(
    useCallback(() => {
      setGeneration((g) => g + 1)
    }, [])
  )
  const refresh = useCallback(async () => {
    setRefreshing(true)
    setGeneration((g) => g + 1)
    setRefreshing(false)
  }, [])

  return (
    <TeamScreen section="Join Requests" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && !authority.rosterManage && <NotForYou title="Deciding who joins is not your job here" body="Requests to join this side are approved by the people the club has given that job to." />}
      {teamId && authority.rosterManage && (
        <TeamPlaceRequestsSection
          key={`${teamId}:${generation}`}
          teamId={teamId}
          empty={<EmptyState title="No one is waiting for approval" body="Requests to join this side appear here, and in Needs Attention." />}
          onOpenPlayer={(membershipId) => router.push({ pathname: "/team/people/[kind]/[id]", params: { kind: "player", id: membershipId } } as never)}
        />
      )}
    </TeamScreen>
  )
}
