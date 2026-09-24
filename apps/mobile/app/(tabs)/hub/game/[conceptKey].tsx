import { useLocalSearchParams } from "expo-router"
import { conceptRugbyCodeLabel, findConceptByKey } from "@ovalball/contracts/rugby-hub/game-knowledge-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"
import { conceptQuickCheck } from "@ovalball/contracts/rugby-hub/quick-check"

import { HubExploreNext, HubKeepExploring, HubQuickCheck, useHubExplanations, useOpenHubEntity } from "../../../../src/hub/experience"
import { HubShowMe } from "../../../../src/hub/visuals/show-me"
import { HubPitchExplainer } from "../../../../src/hub/pitch-explainer"
import { oneParam, useGameKnowledge } from "../../../../src/hub/bundles"
import { GameFlow } from "../../../../src/hub/game-flow"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubCallout, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubProse } from "../../../../src/hub/ui"

/**
 * A GAME KNOWLEDGE CONCEPT. Only the sections this concept's data supports
 * are drawn -- no empty headings -- and the flagship "how a game flows"
 * concept additionally carries the interactive flow diagram, exactly as on
 * the web. Positions, skills, related knowledge and the governing-body facts
 * behind it are the bundle's own relationships.
 */
export default function GameConceptScreen() {
  const { conceptKey } = useLocalSearchParams<{ conceptKey: string }>()
  const key = oneParam(conceptKey)
  const { data, loading, error, refresh, refreshing } = useGameKnowledge()
  const concept = data && key ? findConceptByKey(data, key) : null
  const { openEntity, openRef } = useOpenHubEntity()
  const explanations = useHubExplanations()
  const related = data && concept ? relatedEntities({ domain: "game", bundle: data }, concept.id) : []
  const next = exploreNext(related)
  const check = data && concept ? conceptQuickCheck(concept, data.concepts, next.slice(0, 3)) : null

  return (
    <HubScreen section="Game Knowledge" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !concept && <HubEmpty title="This concept isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Game Knowledge." />}
      {data && concept && (
        <>
          <HubHero title={concept.title} badges={conceptRugbyCodeLabel(concept.rugbyCode) ? <HubBadge label={conceptRugbyCodeLabel(concept.rugbyCode)!} /> : undefined} eyebrow="Game Knowledge" />
          <HubShowMe entity={{ type: "GAME_CONCEPT", key: concept.contentKey }} explanations={explanations} onOpen={openRef} />
          <HubProse heading="What It Is">{concept.summary}</HubProse>
          {concept.contentKey === "how-a-game-flows" && <GameFlow defaultCode={concept.rugbyCode ?? "union"} />}
          {concept.contentKey === "the-pitch-and-direction-of-play" && <HubPitchExplainer onOpenTerm={(termKey) => openRef({ type: "GLOSSARY_TERM", key: termKey })} />}
          {concept.whyItMatters && <HubProse heading="Why It Matters">{concept.whyItMatters}</HubProse>}
          {concept.whatHappens && <HubProse heading="What Happens">{concept.whatHappens}</HubProse>}
          {concept.unionLeagueDifference && <HubCallout heading="Union / League Difference">{concept.unionLeagueDifference}</HubCallout>}
          {concept.whatToWatchFor && <HubProse heading="What to Watch For">{concept.whatToWatchFor}</HubProse>}
          {concept.whatHappensNext && <HubProse heading="What Usually Happens Next">{concept.whatHappensNext}</HubProse>}
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          {check && <HubQuickCheck check={check} onOpen={openEntity} />}
          <HubChips
            heading="Connected Positions"
            items={(data.positionsByConcept.get(concept.id) ?? []).map((p) => ({
              label: p.displayName,
              leading: p.shirtNumber ? `#${p.shirtNumber}` : null,
              trailing: p.rugbyCode === "union" ? "Union" : "League",
              href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`,
            }))}
          />
          <HubChips heading="Connected Skills" items={(data.skillsByConcept.get(concept.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips heading="Related Knowledge" items={(data.relatedByConcept.get(concept.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubFactList heading="Related Rules" items={(data.regulatoryFactsByConcept.get(concept.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge, not law or regulation.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
