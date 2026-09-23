import { useLocalSearchParams } from "expo-router"
import { PARENT_AUTHORITY_LINKS, PARENT_FAMILY_LABEL, SOURCE_TIER_LABEL, findParentGuideByKey } from "@ovalball/contracts/rugby-hub/parents-data"

import { oneParam, useParents } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubCallout, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubParagraph, HubProse, HubSources } from "../../../../src/hub/ui"

const SOURCE_TIER_DISPLAY: Record<string, string> = { ...SOURCE_TIER_LABEL, SAFEGUARDING_AUTHORITY: "Safeguarding authority" }

/**
 * A PARENT GUIDE answers the adult's question and then hands over: every
 * section below the prose sends the reader to whichever Hub domain actually
 * owns the answer. Nothing here is medical advice, safeguarding policy, or a
 * record of any real family.
 */
export default function ParentGuideScreen() {
  const { guideKey } = useLocalSearchParams<{ guideKey: string }>()
  const key = oneParam(guideKey)
  const { data, loading, error, refresh, refreshing } = useParents()
  const guide = data && key ? findParentGuideByKey(data, key) : null
  const related = data && guide ? (data.relatedByGuide.get(guide.id) ?? []) : []
  const byKind = (kind: string) => related.filter((r) => r.kindLabel === kind).map((r) => ({ label: r.title, href: r.href }))

  return (
    <HubScreen section="Parents & Guardians" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !guide && <HubEmpty title="This guide isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Parents & Guardians." />}
      {data && guide && (
        <>
          <HubHero title={guide.title} eyebrow="Parents & Guardians" badges={<HubBadge label={PARENT_FAMILY_LABEL[guide.family]} />} />
          <HubParagraph>{guide.summary}</HubParagraph>
          {guide.whyItMatters && <HubProse heading="Why this matters">{guide.whyItMatters}</HubProse>}
          {guide.body && <HubProse heading="What parents should know">{guide.body}</HubProse>}
          <HubFactList
            tone="mint"
            heading="What the Governing Body Actually Says"
            items={(data.regulatoryFactsByGuide.get(guide.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))}
            footnote="This is the governing body's own wording, not an Ovalball summary. Rules change between age groups and between the codes, so check what applies to your player rather than relying on memory."
          />
          <HubChips heading="Words You Might Not Know" note="Plain-English definitions, in the Glossary." items={(data.glossaryByGuide.get(guide.id) ?? []).map((g) => ({ label: g.displayTerm, href: `/rugby-hub/glossary/${g.termKey}` }))} />
          <HubChips heading="How the Game Works" items={byKind("How the game works")} />
          <HubChips heading="What Your Player Is Learning" note="The player's own side of this, written for them." items={byKind("Player Development")} />
          <HubChips heading="What the Coach Is Doing" items={byKind("Coaching")} />
          <HubChips heading="Match Officials" items={byKind("Officiating")} />
          <HubChips heading="The Skills Behind This" items={(data.skillsByGuide.get(guide.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips heading="Positions" items={(data.positionsByGuide.get(guide.id) ?? []).map((p) => ({ label: p.displayName, href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}` }))} />
          <HubChips heading="More for Parents" items={byKind("For Parents")} />
          {guide.family === "WELFARE_AND_SAFETY" && (
            <HubCallout heading="Where the Official Guidance Lives">
              <HubChips tone="forest" note="This page explains the subject to a family. It is not the authority on it — these are." items={PARENT_AUTHORITY_LINKS.map((l) => ({ label: l.label, href: l.href }))} />
            </HubCallout>
          )}
          <HubSources items={(data.sourcesByGuide.get(guide.id) ?? []).map((s) => ({ title: s.title, url: s.url, tierLabel: SOURCE_TIER_DISPLAY[s.tier] ?? s.tier, retrievedOn: s.retrievedOn }))} />
          <HubFootnote>
            Ovalball educational guidance for families — not medical advice, not safeguarding policy, not law or regulation, and not a record of any player. Anything involving a player's health belongs with qualified medical people, and any safeguarding concern belongs with your club's welfare officer or the routes in the Safeguarding section.
          </HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
