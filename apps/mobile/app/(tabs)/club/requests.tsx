import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { withdrawFixtureRequest } from "@ovalball/contracts/team/requests"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { readClubAuthority } from "@ovalball/contracts/club/overview"
import { buildFixtureRequestGroupSummaries, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { friendly, logDetail } from "../../../src/errors/translate"
import { ChevronRight } from "../../../src/components/icons"
import { MyRequestsView } from "../../../src/requests/my-requests-view"
import { TOUCH_TARGET, colour, space, type } from "../../../src/design/tokens"

/**
 * FIXTURE REQUESTS ACROSS THE CLUB (CA-M10): what other clubs have asked any of our sides, and what
 * our sides have asked. A thin data-loading wrapper around the ONE shared `MyRequestsView`, reading
 * every active team's rows and grouping them exactly the way the Team workspace does -- Accept, Suggest
 * Changes and Decline live on the Fixture Request detail screen a card opens into.
 */
export default function ClubRequests() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
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
      await Promise.all(group.withdrawableRequestIds.map((id) => withdrawFixtureRequest(supabase, id, session?.user.id ?? "")))
      invalidateAttention()
      await load()
    } finally {
      setWithdrawingGroupId(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Fixture Requests
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
      >
        <MyRequestsView
          groups={groups}
          problem={problem}
          onRetry={load}
          canCreate={canCreate}
          onOpenGroup={(group) => router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: group.groupId } } as never)}
          onWithdraw={withdraw}
          withdrawingGroupId={withdrawingGroupId}
          teamLabel={(r) => r.ourTeam}
        />
      </ScrollView>
    </View>
  )
}
