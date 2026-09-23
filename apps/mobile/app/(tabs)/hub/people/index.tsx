import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { personYearRange } from "@ovalball/contracts/rugby-hub/people-data"

import { usePeople } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubFailed, HubHeading, HubHero, HubList, HubLoading, HubRow } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * PEOPLE & RUGBY LEGENDS — grouped by role, with a multi-role person in every
 * group they genuinely qualify for. No "Legend" heading anywhere: coverage is
 * the curation; the taxonomy stays factual.
 */
export default function PeopleLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = usePeople()
  const people = data?.people ?? []
  const groups = [
    { key: "players", label: "Players", items: people.filter((p) => p.roles.includes("PLAYER")) },
    { key: "coaches", label: "Coaches", items: people.filter((p) => p.roles.includes("COACH")) },
    { key: "referees", label: "Referees & Officials", items: people.filter((p) => p.roles.includes("REFEREE")) },
    { key: "pioneers", label: "Pioneers", items: people.filter((p) => p.roles.includes("PIONEER")) },
  ].filter((g) => g.items.length > 0)

  return (
    <HubScreen section="Explore Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="People & Rugby Legends" intro="Who some of rugby's most significant players, coaches, referees and pioneers are, what they achieved, and how their stories connect to the teams, competitions and history you can explore elsewhere in Rugby Hub." />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data &&
        groups.map((g) => (
          <View key={g.key} style={{ gap: space.md }}>
            <HubHeading>{g.label}</HubHeading>
            <HubList>
              {g.items.map((p) => (
                <HubRow key={`${g.key}-${p.contentKey}`} title={p.title} badge={personYearRange(p.birthYear, p.deathYear)} description={p.summary} onPress={() => router.push({ pathname: "/hub/people/[personKey]", params: { personKey: p.contentKey } })} />
              ))}
            </HubList>
          </View>
        ))}
      {data && <Text style={[type.caption, { color: colour.inkMuted }]}>This covers a small, deliberately curated first set of significant rugby figures — not every player, coach, referee or pioneer. More will follow.</Text>}
    </HubScreen>
  )
}
