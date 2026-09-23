import { useState } from "react"
import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { internationalRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/international-data"

import { CODE_FILTERS, codeFilterParam, useInternational } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * INTERNATIONAL RUGBY — national teams, then representative teams, then the
 * competitions, so a beginner meets "what kind of team is this" before "which
 * team". Women's teams sit among men's within each group, never beneath.
 */
export default function InternationalLanding() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const [code, setCode] = useState(codeFilterParam(params.code))
  const { data, loading, error, refresh, refreshing } = useInternational()
  const teams = (data?.teams ?? []).filter((t) => code === "all" || t.rugbyCode === code)
  const national = teams.filter((t) => t.teamType === "NATIONAL_TEAM")
  const representative = teams.filter((t) => t.teamType === "REPRESENTATIVE_TEAM")
  const competitions = (data?.competitions ?? []).filter((c) => code === "all" || c.rugbyCode === code)

  return (
    <HubScreen section="Explore Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="International Rugby" intro="Who the major international teams are, what the Rugby World Cup and the Six Nations are, who the British & Irish Lions are, and what teams have actually won — the game's biggest stage, explained in plain language." />
      <HubSegmented label="Filter by rugby code" value={code} onChange={setCode} options={CODE_FILTERS} />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && (
        <>
          <Group title="National Teams" empty="No national teams match this filter yet.">
            {national.map((t) => (
              <HubRow key={t.id} title={t.title} badge={internationalRugbyCodeLabel(t.rugbyCode)} description={t.summary} onPress={() => router.push({ pathname: "/hub/international/teams/[teamKey]", params: { teamKey: t.contentKey } })} />
            ))}
          </Group>
          <Group title="Representative Teams" lead="A representative team is drawn from several nations rather than being a nation in its own right." empty="No representative teams match this filter yet.">
            {representative.map((t) => (
              <HubRow key={t.id} title={t.title} badge={internationalRugbyCodeLabel(t.rugbyCode)} description={t.summary} onPress={() => router.push({ pathname: "/hub/international/teams/[teamKey]", params: { teamKey: t.contentKey } })} />
            ))}
          </Group>
          <Group title="International Competitions" empty="No competitions match this filter yet.">
            {competitions.map((c) => (
              <HubRow key={c.id} title={c.title} badge={internationalRugbyCodeLabel(c.rugbyCode)} description={c.summary} onPress={() => router.push({ pathname: "/hub/competitions/[contentKey]", params: { contentKey: c.contentKey } })} />
            ))}
          </Group>
          <Text style={[type.caption, { color: colour.inkMuted }]}>This covers a small, deliberately curated first set of major international teams and competitions — not every rugby-playing nation. More will follow.</Text>
        </>
      )}
    </HubScreen>
  )
}

function Group({ title, lead, empty, children }: { title: string; lead?: string; empty: string; children: React.ReactNode[] }) {
  return (
    <View style={{ gap: space.md }}>
      <View>
        <HubHeading>{title}</HubHeading>
        {lead && <HubLead>{lead}</HubLead>}
      </View>
      {children.length > 0 ? <HubList>{children}</HubList> : <Text style={[type.small, { color: colour.inkMuted }]}>{empty}</Text>}
    </View>
  )
}
