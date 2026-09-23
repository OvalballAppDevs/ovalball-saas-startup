import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { PARENT_AUTHORITY_LINKS, PARENT_FAMILY_BLURB, PARENT_FAMILY_LABEL, PARENT_INTENTS, groupParentGuidesByFamily, parentJourney } from "@ovalball/contracts/rugby-hub/parents-data"

import { useParents } from "../../../../src/hub/bundles"
import { openHubHref } from "../../../../src/hub/routes"
import { HubScreen } from "../../../../src/hub/screen"
import { HubChips, HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubOverline, HubRow } from "../../../../src/hub/ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PARENTS & GUARDIANS — question-led rather than alphabetical, because a
 * parent arrives with a worry, not a browsing intent. The newcomer path
 * first; Player Welfare and Safeguarding given a standing signpost, since
 * this domain is not the authority on either.
 */
export default function ParentsLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useParents()
  const journey = parentJourney(data?.guides ?? [])
  const groups = groupParentGuidesByFamily(data?.guides ?? [])
  const byKey = new Set((data?.guides ?? []).map((g) => g.contentKey))
  const intents = PARENT_INTENTS.filter((i) => byKey.has(i.guideKey))
  const open = (guideKey: string) => router.push({ pathname: "/hub/parents/[guideKey]", params: { guideKey } })

  return (
    <HubScreen section="Welfare & Support" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Parents & Guardians" intro="Rugby explained for the adult standing at the side of it. What happens first, what your player needs, what training and match day actually involve, and how to be useful — whether or not you have ever played." />
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && journey.length > 0 && (
        <View style={{ gap: space.md }}>
          <View>
            <HubOverline>New to Rugby</HubOverline>
            <HubLead>Seven things worth reading in roughly this order if rugby is new to your family. Nothing is tracked and there is nothing to complete.</HubLead>
          </View>
          <HubList>
            {journey.map((g, i) => (
              <HubRow key={g.id} index={i + 1} emphasised={i === 0} title={g.title} description={g.summary} onPress={() => open(g.contentKey)} />
            ))}
          </HubList>
        </View>
      )}

      {data && intents.length > 0 && <HubChips heading="I Need Help With…" note="Straight to the thing you came for. These are links — nothing is asked of you and nothing is remembered." items={intents.map((i) => ({ label: i.question, onPress: () => open(i.guideKey) }))} />}

      {data && (
        <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: "rgba(90,203,131,0.5)", backgroundColor: "rgba(220,247,229,0.6)", padding: space.lg, gap: space.md }}>
          <View>
            <Text accessibilityRole="header" style={[type.title, { color: colour.forest900 }]}>
              Where the Official Guidance Lives
            </Text>
            <Text style={[type.small, { color: "rgba(11,43,30,0.85)", marginTop: 4 }]}>These pages explain rugby to families. They are not the authority on welfare or safeguarding — that guidance comes from the governing bodies, and it lives here.</Text>
          </View>
          <HubList>
            {PARENT_AUTHORITY_LINKS.map((l) => (
              <HubRow key={l.href} title={l.label} description={l.description} onPress={() => openHubHref(router, l.href)} />
            ))}
          </HubList>
        </View>
      )}

      {data &&
        groups.map((g) => (
          <View key={g.family} style={{ gap: space.md }}>
            <View>
              <HubHeading>{PARENT_FAMILY_LABEL[g.family]}</HubHeading>
              <HubLead>{PARENT_FAMILY_BLURB[g.family]}</HubLead>
            </View>
            <HubList>
              {g.guides.map((guide) => (
                <HubRow key={guide.id} title={guide.title} description={guide.summary} onPress={() => open(guide.contentKey)} />
              ))}
            </HubList>
          </View>
        ))}

      {data && data.guides.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No parent guides are published yet.</Text>}
      {data && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          These pages explain rugby to the adults supporting a player. They are not medical advice, not safeguarding policy, and not a record of anything about you, your family or your club. Your club's own arrangements, and the governing bodies' own guidance, are always the authority.
        </Text>
      )}
    </HubScreen>
  )
}
