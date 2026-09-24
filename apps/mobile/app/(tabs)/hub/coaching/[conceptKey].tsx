import { useLocalSearchParams } from "expo-router"
import { COACHING_FAMILY_LABEL, SOURCE_TIER_LABEL, coachingRugbyCodeLabel, findCoachingConceptByKey } from "@ovalball/contracts/rugby-hub/coaching-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"
import { conceptQuickCheck } from "@ovalball/contracts/rugby-hub/quick-check"

import { HubExploreNext, HubKeepExploring, HubQuickCheck, useHubExplanations, useOpenHubEntity } from "../../../../src/hub/experience"
import { HubShowMe } from "../../../../src/hub/visuals/show-me"
import { oneParam, useCoaching } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadges, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubParagraph, HubProse, HubSources } from "../../../../src/hub/ui"

/**
 * A COACHING CONCEPT explains how a coach creates learning -- never what a
 * player should do (Skills and Development own that), never what the Law
 * says (Rules owns that; the governing body's own wording is quoted instead),
 * and never anything about a real session, squad or player.
 */
export default function CoachingConceptScreen() {
  const { conceptKey } = useLocalSearchParams<{ conceptKey: string }>()
  const key = oneParam(conceptKey)
  const { data, loading, error, refresh, refreshing } = useCoaching()
  const concept = data && key ? findCoachingConceptByKey(data, key) : null
  const codeLabel = concept ? coachingRugbyCodeLabel(concept.rugbyCode) : null
  const related = data && concept ? (data.relatedByConcept.get(concept.id) ?? []) : []
  const byKind = (kind: string) => related.filter((r) => r.kindLabel === kind).map((r) => ({ label: r.title, href: r.href }))
  const { openEntity, openRef } = useOpenHubEntity()
  const explanations = useHubExplanations()
  const entities = data && concept ? relatedEntities({ domain: "coaching", bundle: data }, concept.id) : []
  const next = exploreNext(entities)
  const check = data && concept ? conceptQuickCheck(concept, data.concepts.filter((c) => c.family === concept.family), next.slice(0, 3)) : null

  return (
    <HubScreen section="Coaching Knowledge" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !concept && <HubEmpty title="This concept isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Coaching Knowledge." />}
      {data && concept && (
        <>
          <HubHero title={concept.title} eyebrow="Coaching Knowledge" badges={<HubBadges items={[{ label: COACHING_FAMILY_LABEL[concept.family] }, ...(codeLabel ? [{ label: codeLabel }] : [])]} />} />
          <HubShowMe entity={{ type: "COACHING_CONCEPT", key: concept.contentKey }} explanations={explanations} onOpen={openRef} />
          <HubParagraph>{concept.summary}</HubParagraph>
          {concept.whyItMatters && <HubProse heading="Why this matters">{concept.whyItMatters}</HubProse>}
          {concept.body && <HubProse heading="What this looks like in a session">{concept.body}</HubProse>}
          <HubFactList
            tone="mint"
            heading="What the Governing Body Actually Says"
            items={(data.regulatoryFactsByConcept.get(concept.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))}
            footnote="This is the governing body's own wording, not an Ovalball summary. Rules change between age groups and between the codes, so check what applies to your players rather than relying on memory."
          />
          {entities.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          {check && <HubQuickCheck check={check} onOpen={openEntity} />}
          <HubChips heading="Skills This Helps You Coach" items={(data.skillsByConcept.get(concept.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips heading="What the Player Is Developing" note="The player's own side of this, written for them." items={byKind("Development")} />
          <HubChips heading="How the Game Works" items={byKind("How the game works")} />
          <HubChips heading="How It Is Refereed" items={byKind("Officiating")} />
          <HubChips heading="Related Coaching" items={byKind("Coaching")} />
          <HubSources items={(data.sourcesByConcept.get(concept.id) ?? []).map((s) => ({ title: s.title, url: s.url, tierLabel: SOURCE_TIER_LABEL[s.tier] ?? s.tier, retrievedOn: s.retrievedOn }))} />
          <HubKeepExploring items={afterExploreNext(entities, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general coaching convention, not a coaching qualification, not law or regulation, and not a record of any session, squad or player.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
