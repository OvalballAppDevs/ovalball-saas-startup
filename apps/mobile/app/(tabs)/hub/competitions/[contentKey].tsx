import { useLocalSearchParams } from "expo-router"
import { competitionRugbyCodeLabel, findGuideByKey } from "@ovalball/contracts/rugby-hub/teams-competitions-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"

import { HubExploreNext, HubKeepExploring, useOpenHubEntity } from "../../../../src/hub/experience"
import { oneParam, useCompetitions } from "../../../../src/hub/bundles"
import { EditorialSource } from "../../../../src/hub/editorial-source"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubLoading, HubParagraph } from "../../../../src/hub/ui"

/**
 * A COMPETITION GUIDE is a plain explanatory article: title, summary, body,
 * and a restrained "Source: … · Retrieved …" line -- an ordinary editorial
 * fact about current competition structure, deliberately never phrased like
 * a regulatory citation.
 */
export default function CompetitionGuideScreen() {
  const { contentKey } = useLocalSearchParams<{ contentKey: string }>()
  const key = oneParam(contentKey)
  const { data, loading, error, refresh, refreshing } = useCompetitions()
  const guide = data && key ? findGuideByKey(data, key) : null
  const codeLabel = guide ? competitionRugbyCodeLabel(guide.rugbyCode) : null
  const { openEntity } = useOpenHubEntity()
  const related = data && guide ? relatedEntities({ domain: "competitions", bundle: data }, guide.id) : []
  const next = exploreNext(related)

  return (
    <HubScreen section="Teams & Competitions" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !guide && <HubEmpty title="This guide isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Teams & Competitions." />}
      {data && guide && (
        <>
          <HubHero title={guide.title} eyebrow="Teams & Competitions" badges={codeLabel ? <HubBadge label={codeLabel} /> : undefined} />
          <HubParagraph>{guide.summary}</HubParagraph>
          {guide.body && <HubParagraph quiet>{guide.body}</HubParagraph>}
          <EditorialSource note={guide.sourceNote} url={guide.sourceUrl} retrievedOn={guide.sourceRetrievedOn} />
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          <HubChips heading="Related Glossary" items={(data.glossaryByGuide.get(guide.id) ?? []).map((g) => ({ label: g.title, href: g.href }))} />
          <HubChips heading="Related Knowledge" items={(data.relatedByGuide.get(guide.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubChips heading="Related History" items={(data.heritageByGuide.get(guide.id) ?? []).map((h) => ({ label: h.title, href: h.href }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge about how the sport is organised, not a live table, fixture list or results service.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
