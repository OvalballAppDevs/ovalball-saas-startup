import { Text } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { findTermByKey, rugbyCodeLabel } from "@ovalball/contracts/rugby-hub/glossary-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"
import { glossaryQuickCheck } from "@ovalball/contracts/rugby-hub/quick-check"

import { HubExploreNext, HubKeepExploring, HubQuickCheck, useHubExplanations, useOpenHubEntity } from "../../../../src/hub/experience"
import { HubSeeIt } from "../../../../src/hub/visuals/see-it"
import { oneParam, useGlossary } from "../../../../src/hub/bundles"
import { openHubHref } from "../../../../src/hub/routes"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubChips, HubEmpty, HubFactList, HubFailed, HubFootnote, HubHero, HubLoading, HubParagraph, HubTextLink } from "../../../../src/hub/ui"
import { colour, type } from "../../../../src/design/tokens"

/** A GLOSSARY TERM: a definition, not an article. Compact, and only the sections its data supports. */
export default function GlossaryTermScreen() {
  const router = useRouter()
  const { termKey } = useLocalSearchParams<{ termKey: string }>()
  const key = oneParam(termKey)
  const { data, loading, error, refresh, refreshing } = useGlossary()
  const term = data && key ? findTermByKey(data, key) : null
  const { openEntity, openRef } = useOpenHubEntity()
  const explanations = useHubExplanations()
  const related = data && term ? relatedEntities({ domain: "glossary", bundle: data }, term.id) : []
  const next = exploreNext(related)
  const check = data && term ? glossaryQuickCheck(term, data.terms, next.slice(0, 3)) : null

  return (
    <HubScreen section="Glossary" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading rows={2} />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !term && <HubEmpty title="This term isn't published" body="It may have been renamed or withdrawn. Every published term is listed in the Glossary." />}
      {data && term && (
        <>
          <HubHero title={term.displayTerm} eyebrow="Glossary" badges={rugbyCodeLabel(term.rugbyCode) ? <HubBadge label={rugbyCodeLabel(term.rugbyCode)!} /> : undefined} />
          <HubParagraph>{term.plainLanguageDefinition}</HubParagraph>
          <HubSeeIt entity={{ type: "GLOSSARY_TERM", key: term.termKey }} explanations={explanations} onOpen={openRef} />
          {term.aliases.length > 0 && (
            <Text style={[type.small, { color: colour.inkMuted }]}>
              <Text style={{ fontFamily: "Inter_600SemiBold", color: "rgba(16,21,18,0.7)" }}>Also called: </Text>
              {term.aliases.join(", ")}
            </Text>
          )}
          {data.detailLinkByTerm.get(term.id) && <HubTextLink label="Read more" onPress={() => openHubHref(router, data.detailLinkByTerm.get(term.id)!.href)} />}
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          {check && <HubQuickCheck check={check} onOpen={openEntity} />}
          <HubChips heading="Related Knowledge" items={(data.contentLinksByTerm.get(term.id) ?? []).map((c) => ({ label: c.title, href: c.href }))} />
          <HubChips heading="Related Skills" items={(data.skillsByTerm.get(term.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />
          <HubChips
            heading="Related Positions"
            items={(data.positionsByTerm.get(term.id) ?? []).map((p) => ({ label: p.displayName, trailing: p.rugbyCode === "union" ? "Union" : "League", href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}` }))}
          />
          <HubChips heading="Related Terms" items={(data.relatedTermsByTerm.get(term.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubFactList heading="Related Rule" items={(data.regulatoryFactsByTerm.get(term.id) ?? []).map((f) => ({ key: f.factKey, text: f.valueText }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby terminology, not law or regulation.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
