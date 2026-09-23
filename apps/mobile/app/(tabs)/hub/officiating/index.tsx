import { View } from "react-native"
import { useRouter } from "expo-router"
import { OFFICIATING_FAMILY_LABEL, groupConceptsByFamily, officiatingRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/officiating-data"

import { useOfficiating } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubFailed, HubHeading, HubHero, HubList, HubLoading, HubRow } from "../../../../src/hub/ui"
import { space } from "../../../../src/design/tokens"

/**
 * OFFICIATING — one domain, six labelled families, and Respect the Referee
 * drawn with the same weight as every other family rather than buried.
 */
export default function OfficiatingLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useOfficiating()
  return (
    <HubScreen section="Learn the Game" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Officiating & Respect the Referee" intro="Who match officials are, what they're looking for when they make a decision, and how players, captains, coaches, parents and spectators should treat them." />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data &&
        groupConceptsByFamily(data.concepts).map((group) => (
          <View key={group.family} style={{ gap: space.md }}>
            <HubHeading>{OFFICIATING_FAMILY_LABEL[group.family] ?? group.family}</HubHeading>
            <HubList>
              {group.concepts.map((c) => (
                <HubRow key={c.id} title={c.title} badge={officiatingRugbyCodeLabel(c.rugbyCode)} description={c.summary} onPress={() => router.push({ pathname: "/hub/officiating/[contentKey]", params: { contentKey: c.contentKey } })} />
              ))}
            </HubList>
          </View>
        ))}
    </HubScreen>
  )
}
