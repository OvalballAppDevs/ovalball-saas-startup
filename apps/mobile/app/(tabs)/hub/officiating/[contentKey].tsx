import { useLocalSearchParams } from "expo-router"
import { findConceptByKey, officiatingRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/officiating-data"

import { Radio } from "../../../../src/components/icons"
import { oneParam, useOfficiating } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubCallout, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubProse } from "../../../../src/hub/ui"
import { colour } from "../../../../src/design/tokens"

/**
 * AN OFFICIATING CONCEPT. "How it's signalled" and "common misunderstanding"
 * get their own text-first callouts, drawn only when the concept has one.
 */
export default function OfficiatingConceptScreen() {
  const { contentKey } = useLocalSearchParams<{ contentKey: string }>()
  const key = oneParam(contentKey)
  const { data, loading, error, refresh, refreshing } = useOfficiating()
  const concept = data && key ? findConceptByKey(data, key) : null

  return (
    <HubScreen section="Officiating" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !concept && <HubEmpty title="This concept isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Officiating." />}
      {data && concept && (
        <>
          <HubHero title={concept.title} eyebrow="Officiating" badges={officiatingRugbyCodeLabel(concept.rugbyCode) ? <HubBadge label={officiatingRugbyCodeLabel(concept.rugbyCode)!} /> : undefined} />
          <HubProse heading="What It Is">{concept.summary}</HubProse>
          {concept.whyItMatters && <HubProse heading="Why It Matters">{concept.whyItMatters}</HubProse>}
          {concept.whatHappens && <HubProse heading="What Happens">{concept.whatHappens}</HubProse>}
          {concept.whatToWatchFor && <HubProse heading="What the Official Is Watching">{concept.whatToWatchFor}</HubProse>}
          {concept.howItIsSignalled && (
            <HubCallout tone="chalk" heading="How It's Signalled" icon={<Radio size={16} color={colour.forest800} />}>
              {concept.howItIsSignalled}
            </HubCallout>
          )}
          {concept.unionLeagueDifference && <HubCallout heading="Union / League Difference">{concept.unionLeagueDifference}</HubCallout>}
          {concept.whatHappensNext && <HubProse heading="What Happens Next">{concept.whatHappensNext}</HubProse>}
          {concept.commonMisunderstanding && (
            <HubCallout tone="amber" heading="Common Misunderstanding">
              {concept.commonMisunderstanding}
            </HubCallout>
          )}
          <HubChips
            heading="Connected Positions"
            items={(data.positionsByConcept.get(concept.id) ?? []).map((p) => ({ label: p.displayName, trailing: p.rugbyCode === "union" ? "Union" : "League", href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}` }))}
          />
          <HubChips heading="Connected Skills" items={(data.skillsByConcept.get(concept.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips heading="Related Glossary" items={(data.glossaryByConcept.get(concept.id) ?? []).map((g) => ({ label: g.title, href: g.href }))} />
          <HubChips heading="Related Knowledge" items={(data.relatedByConcept.get(concept.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubFactList heading="Related Rules" items={(data.regulatoryFactsByConcept.get(concept.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge, not law or regulation.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
