import { useState } from "react"
import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { COACHING_FAMILY_BLURB, COACHING_FAMILY_LABEL, COACHING_INTENTS, coachingJourney, filterCoachingByCode, groupCoachingByFamily } from "@ovalball/contracts/rugby-hub/coaching-data"

import { CODE_FILTERS, codeFilterParam, useCoaching } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubChips, HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubOverline, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * COACHING KNOWLEDGE — for the volunteer with a session on Tuesday. A short
 * newcomer path, then "I want to…" shortcuts (links, not a questionnaire),
 * then every concept by family.
 */
export default function CoachingLanding() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const [code, setCode] = useState(codeFilterParam(params.code))
  const { data, loading, error, refresh, refreshing } = useCoaching()
  const visible = data ? filterCoachingByCode(data.concepts, code) : []
  const journey = coachingJourney(visible)
  const groups = groupCoachingByFamily(visible)
  const byKey = new Set(visible.map((c) => c.contentKey))
  const intents = COACHING_INTENTS.filter((i) => byKey.has(i.conceptKey))
  const open = (contentKey: string) => router.push({ pathname: "/hub/coaching/[conceptKey]", params: { conceptKey: contentKey } })

  return (
    <HubScreen section="Coach Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Coaching Knowledge" intro="Skills explain what a player does. This explains what you do — how to design a session players learn from, how to say less and ask more, and how to run one evening that works for everybody in it." />
      <HubSegmented label="Filter by rugby code" value={code} onChange={setCode} options={CODE_FILTERS} />

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && journey.length > 0 && (
        <View style={{ gap: space.md }}>
          <View>
            <HubOverline>New to Coaching</HubOverline>
            <HubLead>Seven ideas in the order they tend to be useful. There is no course, no badge and nothing to complete — read one before Tuesday and see what changes.</HubLead>
          </View>
          <HubList>
            {journey.map((c, i) => (
              <HubRow key={c.id} index={i + 1} emphasised={i === 0} title={c.title} description={c.summary} onPress={() => open(c.contentKey)} />
            ))}
          </HubList>
        </View>
      )}

      {data && intents.length > 0 && (
        <HubChips heading="I Want To…" note="Shortcuts to the thing you came for. Nothing is asked of you and nothing is remembered — these are links, not a questionnaire." items={intents.map((i) => ({ label: i.question, onPress: () => open(i.conceptKey) }))} />
      )}

      {data &&
        groups.map((g) => (
          <View key={g.family} style={{ gap: space.md }}>
            <View>
              <HubHeading>{COACHING_FAMILY_LABEL[g.family]}</HubHeading>
              <HubLead>{COACHING_FAMILY_BLURB[g.family]}</HubLead>
            </View>
            <HubList>
              {g.concepts.map((c) => (
                <HubRow key={c.id} title={c.title} description={c.summary} onPress={() => open(c.contentKey)} />
              ))}
            </HubList>
          </View>
        ))}

      {data && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Coaching Knowledge is educational guidance about how coaching works. It is not a coaching qualification, does not replace the RFU's or RFL's own coach education, and records nothing about you, your sessions or your players. Your club's real sessions, registers and plans live in Training Management.
        </Text>
      )}
    </HubScreen>
  )
}
