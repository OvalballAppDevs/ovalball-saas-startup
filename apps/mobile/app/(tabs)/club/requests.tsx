import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { withdrawFixtureRequest } from "@ovalball/contracts/team/requests"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { readClubAuthority } from "@ovalball/contracts/club/overview"
import { buildFixtureRequestGroupSummaries, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { friendly, logDetail } from "../../../src/errors/translate"
import { MyRequestsView } from "../../../src/requests/my-requests-view"
import { colour, space, type } from "../../../src/design/tokens"
import { OvalballDetailHeader } from "../../../src/components/app-header"
import { useOriginBack } from "../../../src/links/origin"

/**
 * FIXTURE REQUESTS ACROSS THE CLUB (CA-M10): what other clubs have asked any of our sides, and what
 * our sides have asked. A thin data-loading wrapper around the ONE shared `MyRequestsView`, reading
 * every active team's rows and grouping them exactly the way the Team workspace does -- Accept, Suggest
 * Changes and Decline live on the Fixture Request detail screen a card opens into.
 */
export default function ClubRequests() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Back to Fixtures or More -- wherever the inbox was opened -- not Home (this is the club stack's root).
  const back = useOriginBack("/fixtures")
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [data, setData] = useState<{ incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] } | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [withdrawingGroupId, setWithdrawingGroupId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const [teams, authority] = await Promise.all([readClubTeams(supabase, clubId), readClubAuthority(supabase, clubId)])
      setCanCreate(authority.requestCreate)
      setData(await readClubFixtureRequests(supabase, teams.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.displayName }))))
    } catch (caught) {
      const failure = friendly(caught, "the club's fixture requests")
      logDetail("club requests", failure)
      setProblem(failure.message)
    }
  }, [clubId])
  useEffect(() => {
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

  const groups: FixtureRequestGroupSummary<ClubFixtureRequest>[] | null = data ? buildFixtureRequestGroupSummaries([...data.incoming, ...data.outgoing]) : null

  async function withdraw(group: FixtureRequestGroupSummary<ClubFixtureRequest>) {
    setWithdrawingGroupId(group.groupId)
    try {
      await Promise.all(group.withdrawableRequestIds.map((id) => withdrawFixtureRequest(supabase, id)))
      invalidateAttention()
      await load()
    } finally {
      setWithdrawingGroupId(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Fixture Requests" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
      >
        <MyRequestsView
          groups={groups}
          problem={problem}
          onRetry={load}
          canCreate={canCreate}
          onOpenGroup={(group) => router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: group.groupId, returnTo: "/club/requests" } } as never)}
          onWithdraw={withdraw}
          withdrawingGroupId={withdrawingGroupId}
          teamLabel={(r) => r.ourTeam}
        />
      </ScrollView>
    </View>
  )
}
