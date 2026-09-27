import { useCallback, useEffect, useState } from "react"
import { useFocusEffect, useRouter } from "expo-router"

import { withdrawFixtureRequest, readTeamFixtureRequests, type TeamFixtureRequest } from "@ovalball/contracts/team/requests"
import { buildFixtureRequestGroupSummaries, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"
import { teamErrorMessage } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useTeamAuthority } from "../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../src/team/screen"
import { MyRequestsView } from "../../../src/requests/my-requests-view"
import { Button } from "../../../src/components/ui"

/**
 * FIXTURE REQUESTS -- what other clubs have asked this team, and what it has asked them (CA-M7).
 *
 * A thin data-loading wrapper around the ONE shared `MyRequestsView` (owner correction pass, Sections
 * 4-8): this screen's job is only to read this team's rows, group them and hand them to the shared
 * card/tab UI. Accept, Suggest Changes and Decline live on the Fixture Request detail screen a card
 * opens into -- never duplicated here.
 */
export default function TeamFixtureRequests() {
  const router = useRouter()
  const { session } = useSession()
  const { authority, loading: authorityLoading, teamId, teamName } = useTeamAuthority()
  const [data, setData] = useState<{ incoming: TeamFixtureRequest[]; outgoing: TeamFixtureRequest[] } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [withdrawingGroupId, setWithdrawingGroupId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setData(await readTeamFixtureRequests(supabase, teamId))
    } catch (caught) {
      setProblem(teamErrorMessage(caught, "Couldn't load fixture requests. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const groups: FixtureRequestGroupSummary<TeamFixtureRequest>[] | null = data ? buildFixtureRequestGroupSummaries([...data.incoming, ...data.outgoing]) : null

  async function withdraw(group: FixtureRequestGroupSummary<TeamFixtureRequest>) {
    setWithdrawingGroupId(group.groupId)
    try {
      await Promise.all(group.withdrawableRequestIds.map((id) => withdrawFixtureRequest(supabase, id, session?.user.id ?? "")))
      await load()
    } finally {
      setWithdrawingGroupId(null)
    }
  }

  return (
    <TeamScreen section="Fixture Requests" refreshing={refreshing} onRefresh={refresh}>
      {authority.requestCreate && (
        <Button label="Request a Fixture" onPress={() => router.push({ pathname: "/fixtures/new", params: { teamId: teamId ?? "" } } as never)} />
      )}
      {!authorityLoading && !authority.requestRespond && !authority.requestCreate && (
        <NotForYou title="Fixture requests are not part of your job here" body="Asking other clubs for a match, and answering them, is done by the people the club has given that job to." />
      )}
      <MyRequestsView
        groups={groups}
        problem={problem}
        onRetry={load}
        canCreate={authority.requestCreate}
        onOpenGroup={(group) => router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: group.groupId } } as never)}
        onWithdraw={withdraw}
        withdrawingGroupId={withdrawingGroupId}
        teamLabel={() => teamName ?? "This team"}
      />
    </TeamScreen>
  )
}
