import { useState } from "react"
import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { DEVELOPMENT_FAMILY_BLURB, DEVELOPMENT_FAMILY_LABEL, developmentJourney, filterConceptsByCode, groupConceptsByFamily } from "@ovalball/contracts/rugby-hub/development-data"

import { CODE_FILTERS, codeFilterParam, useDevelopment } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubCallout, HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubOverline, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * PLAYER DEVELOPMENT — the layer above the skills. A newcomer path first, then
 * the five kinds of thing there are to work on. Nothing scores, ranks or tracks
 * anybody; the "governing-body guidance" line is only said because those rows
 * genuinely carry a GOVERNING_BODY source.
 */
export default function DevelopmentLanding() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const [code, setCode] = useState(codeFilterParam(params.code))
  const { data, loading, error, refresh, refreshing } = useDevelopment()
  const visible = data ? filterConceptsByCode(data.concepts, code) : []
  const journey = developmentJourney(visible)
  const groups = groupConceptsByFamily(visible)
  const physical = visible.filter((c) => c.family === "PHYSICAL")
  const physicalSourced = data ? physical.filter((c) => (data.sourcesByConcept.get(c.id) ?? []).some((s) => s.tier === "GOVERNING_BODY")).length : 0
  const open = (contentKey: string) => router.push({ pathname: "/hub/development/[conceptKey]", params: { conceptKey: contentKey } })

  return (
    <HubScreen section="Play & Develop" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Player Development" intro="Skills teach you how to do a thing. This is the layer above: what you are actually learning, why rugby is taught in stages, and how getting better tends to work. Nothing here scores, ranks or tracks anybody." />
      <HubSegmented label="Filter by rugby code" value={code} onChange={setCode} options={CODE_FILTERS} />

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && journey.length > 0 && (
        <View style={{ gap: space.md }}>
          <View>
            <HubOverline>New to Rugby</HubOverline>
            <HubLead>A path through the ideas in the order they tend to make sense. It is not a syllabus and there is no finish line — read one, play some rugby, come back.</HubLead>
          </View>
          <HubList>
            {journey.map((c, i) => (
              <HubRow key={c.id} index={i + 1} emphasised={i === 0} title={c.title} description={c.summary} onPress={() => open(c.contentKey)} />
            ))}
          </HubList>
        </View>
      )}

      {data && groups.length > 0 && (
        <HubCallout tone="mint" heading="What Should I Work On?">
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: "rgba(11,43,30,0.88)" }]}>Ovalball does not answer that for you, and nothing here scores or ranks a player. Your coach knows your rugby; these are the five kinds of thing there are to work on, so you can find the one you came for.</Text>
            {groups.map((g) => (
              <Text key={g.family} style={[type.small, { color: "rgba(11,43,30,0.88)" }]}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{DEVELOPMENT_FAMILY_LABEL[g.family]}</Text> — {DEVELOPMENT_FAMILY_BLURB[g.family]}
              </Text>
            ))}
          </View>
        </HubCallout>
      )}

      {data &&
        groups.map((g) => (
          <View key={g.family} style={{ gap: space.md }}>
            <HubHeading>{DEVELOPMENT_FAMILY_LABEL[g.family]}</HubHeading>
            {g.family === "PHYSICAL" && physicalSourced > 0 && (
              <Text style={[type.small, { color: colour.inkMuted }]}>
                These explain how young players develop and why rugby is taught in stages. They are general principles, sourced to governing-body guidance — {physicalSourced} of {physical.length} carry a governing-body source. They are never a training plan, a target, or medical advice, and Ovalball does not set an individual player's physical work. That is for your coach, and where health is involved, a qualified professional.
              </Text>
            )}
            <HubList>
              {g.concepts.map((c) => (
                <HubRow key={c.id} title={c.title} description={c.summary} onPress={() => open(c.contentKey)} />
              ))}
            </HubList>
          </View>
        ))}

      {data && <Text style={[type.caption, { color: colour.inkMuted }]}>Player Development explains how learning rugby works. It is not an assessment, a rating, a selection tool or a talent programme, and it records nothing about any individual player.</Text>}
    </HubScreen>
  )
}
