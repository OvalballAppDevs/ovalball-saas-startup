import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { HONOUR_ROLE_LABEL, ROLE_LABEL, SOURCE_TIER_LABEL, TEAM_ROLE_LABEL, findPersonByKey, personYearRange } from "@ovalball/contracts/rugby-hub/people-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"

import { HubExploreNext, HubKeepExploring, useOpenHubEntity } from "../../../../src/hub/experience"
import { oneParam, usePeople } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadges, HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubHonours, HubLoading, HubOverline, HubParagraph, HubSources, HubTextLink } from "../../../../src/hub/ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * A PERSON: a plain-language introduction, real team, honour and history
 * relationships, and full source provenance -- never live stats, caps, a
 * current club or a squad list. Every role they held is its own text badge.
 */
export default function PersonScreen() {
  const router = useRouter()
  const { personKey } = useLocalSearchParams<{ personKey: string }>()
  const key = oneParam(personKey)
  const { data, loading, error, refresh, refreshing } = usePeople()
  const person = data && key ? findPersonByKey(data, key) : null
  const years = person ? personYearRange(person.birthYear, person.deathYear) : null
  const { openEntity } = useOpenHubEntity()
  const related = data && person ? relatedEntities({ domain: "people", bundle: data }, person.id) : []
  const next = exploreNext(related)

  return (
    <HubScreen section="People & Rugby Legends" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !person && <HubEmpty title="This person isn't published" body="They may have been renamed or withdrawn. Everyone currently published is listed under People & Rugby Legends." />}
      {data && person && (
        <>
          <View style={{ gap: space.sm }}>
            <HubHero title={person.title} eyebrow="People & Rugby Legends" badges={years ? <Text style={[type.small, { color: colour.inkMuted }]}>{years}</Text> : undefined} />
            <HubBadges items={person.roles.map((r) => ({ label: ROLE_LABEL[r] }))} />
          </View>
          <HubParagraph>{person.summary}</HubParagraph>
          {person.body && <HubParagraph quiet>{person.body}</HubParagraph>}

          {(data.teamLinksByPerson.get(person.id) ?? []).length > 0 && (
            <View style={{ gap: space.sm }}>
              <HubOverline>Teams Represented</HubOverline>
              {(data.teamLinksByPerson.get(person.id) ?? []).map((t) => (
                <View key={`${t.teamKey}-${t.roleType}`} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    <HubTextLink label={t.teamTitle} onPress={() => router.push({ pathname: "/hub/international/teams/[teamKey]", params: { teamKey: t.teamKey } })} />
                    <Text style={[type.small, { color: "rgba(16,21,18,0.6)" }]}>— {TEAM_ROLE_LABEL[t.roleType]}</Text>
                  </View>
                  {t.notes ? <Text style={[type.small, { color: "rgba(16,21,18,0.6)" }]}>{t.notes}</Text> : null}
                </View>
              ))}
            </View>
          )}

          <HubHonours
            items={(data.honoursByPerson.get(person.id) ?? []).map((h) => ({ key: `${h.competitionKey}-${h.yearLabel}-${h.roleType}`, year: h.yearLabel, text: `${HONOUR_ROLE_LABEL[h.roleType]}, ${h.teamTitle} (${h.competitionTitle})`, notes: h.notes }))}
          />
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          <HubChips heading="Related Rugby Hub Knowledge" items={(data.relatedByPerson.get(person.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubChips heading="Related History" items={(data.heritageByPerson.get(person.id) ?? []).map((h) => ({ label: h.title, href: h.href }))} />
          <HubSources items={(data.sourcesByPerson.get(person.id) ?? []).map((s) => ({ title: s.title, url: s.url, tierLabel: SOURCE_TIER_LABEL[s.tier], retrievedOn: s.retrievedOn }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge and history, not live statistics, rankings or a current-squad record.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
