import { useState } from "react"
import { Text } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { internationalRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/clubs-data"

import { CODE_FILTERS, codeFilterParam, useClubs } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubEmpty, HubFailed, HubHero, HubList, HubLoading, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { colour, type } from "../../../../src/design/tokens"

/** FAMOUS CLUBS — the clubs that shaped rugby history, not simply today's biggest names. */
export default function ClubsLanding() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const [code, setCode] = useState(codeFilterParam(params.code))
  const { data, loading, error, refresh, refreshing } = useClubs()
  const clubs = (data?.clubs ?? []).filter((c) => code === "all" || c.rugbyCode === code)

  return (
    <HubScreen section="Explore Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Famous Clubs" intro="These are clubs that shaped rugby history — not simply today's biggest names. Who they are, why they matter, and what they've won, explained in plain language." />
      <HubSegmented label="Filter by rugby code" value={code} onChange={setCode} options={CODE_FILTERS} />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data &&
        (clubs.length > 0 ? (
          <HubList>
            {clubs.map((c) => (
              <HubRow key={c.id} title={c.title} badge={internationalRugbyCodeLabel(c.rugbyCode)} description={c.summary} onPress={() => router.push({ pathname: "/hub/clubs/[clubKey]", params: { clubKey: c.contentKey } })} />
            ))}
          </HubList>
        ) : (
          <HubEmpty title="No clubs match this filter yet" body="Try the other code, or view all." />
        ))}
      {data && <Text style={[type.caption, { color: colour.inkMuted }]}>These are clubs that shaped rugby history — not simply today's biggest names. A small, deliberately curated first set. More will follow.</Text>}
    </HubScreen>
  )
}
