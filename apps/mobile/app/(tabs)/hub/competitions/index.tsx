import { useState } from "react"
import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { competitionRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/teams-competitions-data"

import { CODE_FILTERS, codeFilterParam, useCompetitions } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubEmpty, HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/** TEAMS & COMPETITIONS — the generic "how competitions work" explainers before the named competitions themselves. */
export default function CompetitionsLanding() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const [code, setCode] = useState(codeFilterParam(params.code))
  const { data, loading, error, refresh, refreshing } = useCompetitions()
  const explainers = (data?.guides ?? []).filter((g) => g.rugbyCode === null)
  const named = (data?.guides ?? []).filter((g) => g.rugbyCode !== null && (code === "all" || g.rugbyCode === code))
  const open = (contentKey: string) => router.push({ pathname: "/hub/competitions/[contentKey]", params: { contentKey } })

  return (
    <HubScreen section="Explore Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Teams & Competitions" intro="What a club and a team actually are, how league tables and promotion work, and what competitions like Premiership Rugby, Super League and the Challenge Cup are — the sport's wider structure, explained in plain language." />
      <HubSegmented label="Filter by rugby code" value={code} onChange={setCode} options={CODE_FILTERS} />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && (
        <>
          <View style={{ gap: space.md }}>
            <View>
              <HubHeading>How Competitions Work</HubHeading>
              <HubLead>The shape of a competition, before meeting a specific one.</HubLead>
            </View>
            <HubList>
              {explainers.map((g) => (
                <HubRow key={g.id} title={g.title} description={g.summary} onPress={() => open(g.contentKey)} />
              ))}
            </HubList>
          </View>
          <View style={{ gap: space.md }}>
            <HubHeading>Named Competitions</HubHeading>
            {named.length > 0 ? (
              <HubList>
                {named.map((g) => (
                  <HubRow key={g.id} title={g.title} badge={competitionRugbyCodeLabel(g.rugbyCode)} description={g.summary} onPress={() => open(g.contentKey)} />
                ))}
              </HubList>
            ) : (
              <HubEmpty title="No competitions match this filter yet" body="Try the other code, or view all." />
            )}
          </View>
          <Text style={[type.caption, { color: colour.inkMuted }]}>This covers a small, deliberately incomplete first set of English domestic competitions — not a complete guide to every UK competition. Wales, Scotland and Ireland are not yet covered here.</Text>
        </>
      )}
    </HubScreen>
  )
}
