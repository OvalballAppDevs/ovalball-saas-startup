import { useLocalSearchParams } from "expo-router"
import { DEVELOPMENT_FAMILY_LABEL, SOURCE_TIER_LABEL, developmentRugbyCodeLabel, findDevelopmentConceptByKey } from "@ovalball/contracts/rugby-hub/development-data"

import { oneParam, useDevelopment } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadges, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubParagraph, HubProse, HubSources } from "../../../../src/hub/ui"

/**
 * A DEVELOPMENT CONCEPT explains an idea about learning rugby. It never says
 * what THIS reader should do next or how far along they are -- there is no
 * player record behind it. The governing body's own wording sits in a mint
 * callout, never paraphrased.
 */
export default function DevelopmentConceptScreen() {
  const { conceptKey } = useLocalSearchParams<{ conceptKey: string }>()
  const key = oneParam(conceptKey)
  const { data, loading, error, refresh, refreshing } = useDevelopment()
  const concept = data && key ? findDevelopmentConceptByKey(data, key) : null
  const codeLabel = concept ? developmentRugbyCodeLabel(concept.rugbyCode) : null

  return (
    <HubScreen section="Player Development" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !concept && <HubEmpty title="This concept isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Player Development." />}
      {data && concept && (
        <>
          <HubHero title={concept.title} eyebrow="Player Development" badges={<HubBadges items={[{ label: DEVELOPMENT_FAMILY_LABEL[concept.family] }, ...(codeLabel ? [{ label: codeLabel }] : [])]} />} />
          <HubParagraph>{concept.summary}</HubParagraph>
          {concept.whyItMatters && <HubProse heading="Why it matters">{concept.whyItMatters}</HubProse>}
          {concept.body && <HubProse heading="What this looks like">{concept.body}</HubProse>}
          <HubFactList
            tone="mint"
            heading="What the Law Actually Says"
            items={(data.regulatoryFactsByConcept.get(concept.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))}
            footnote="This is the governing body's own wording, not an Ovalball summary. Rules change between age groups and between the codes, so check what applies to you rather than relying on memory."
          />
          <HubChips heading="Skills This Applies To" items={(data.skillsByConcept.get(concept.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips
            heading="Where You See This Most"
            items={(data.positionsByConcept.get(concept.id) ?? []).map((p) => ({ label: p.displayName, trailing: p.rugbyCode === "union" ? "Union" : "League", href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}` }))}
          />
          <HubChips heading="Related Knowledge" items={(data.relatedByConcept.get(concept.id) ?? []).map((r) => ({ label: r.title, trailing: r.kindLabel, href: r.href }))} />
          <HubSources items={(data.sourcesByConcept.get(concept.id) ?? []).map((s) => ({ title: s.title, url: s.url, tierLabel: SOURCE_TIER_LABEL[s.tier] ?? s.tier, retrievedOn: s.retrievedOn }))} />
          <HubFootnote>Ovalball educational guidance — general coaching convention, not law, regulation, an assessment of any player, or medical advice.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
