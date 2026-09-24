import { useLocalSearchParams } from "expo-router"
import { HONOUR_TYPE_LABEL, TEAM_GENDER_LABEL, TEAM_TYPE_LABEL, findTeamByKey, internationalRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/international-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"

import { HubExploreNext, HubKeepExploring, useOpenHubEntity } from "../../../../../src/hub/experience"
import { oneParam, useInternational } from "../../../../../src/hub/bundles"
import { EditorialSource } from "../../../../../src/hub/editorial-source"
import { HubScreen } from "../../../../../src/hub/screen"
import { HubBadges, HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubHonours, HubLoading, HubParagraph } from "../../../../../src/hub/ui"

/**
 * A TEAM: a plain-language introduction, its major competitions and a curated
 * honours list -- never a live squad, ranking, fixture list or statistics.
 * Team type and gender are text badges, never a flag or a colour.
 */
export default function InternationalTeamScreen() {
  const { teamKey } = useLocalSearchParams<{ teamKey: string }>()
  const key = oneParam(teamKey)
  const { data, loading, error, refresh, refreshing } = useInternational()
  const team = data && key ? findTeamByKey(data, key) : null
  const { openEntity } = useOpenHubEntity()
  const related = data && team ? relatedEntities({ domain: "international", bundle: data }, team.id) : []
  const next = exploreNext(related)

  return (
    <HubScreen section="International Rugby" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !team && <HubEmpty title="This team isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under International Rugby." />}
      {data && team && (
        <>
          <HubHero
            title={team.title}
            eyebrow="International Rugby"
            badges={
              <HubBadges
                items={[
                  ...(internationalRugbyCodeLabel(team.rugbyCode) ? [{ label: internationalRugbyCodeLabel(team.rugbyCode)! }] : []),
                  { label: TEAM_TYPE_LABEL[team.teamType] },
                  ...(team.teamGender ? [{ label: TEAM_GENDER_LABEL[team.teamGender] }] : []),
                ]}
              />
            }
          />
          <HubParagraph>{team.summary}</HubParagraph>
          {team.body && <HubParagraph quiet>{team.body}</HubParagraph>}
          <EditorialSource note={team.sourceNote} url={team.sourceUrl} retrievedOn={team.sourceRetrievedOn} />
          <HubHonours items={(data.honoursByTeam.get(team.id) ?? []).map((h) => ({ key: h.id, year: h.yearLabel, text: `${HONOUR_TYPE_LABEL[h.honourType] ?? h.honourType}, ${h.competitionTitle}`, notes: h.notes }))} />
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          <HubChips heading="Major Competitions" items={(data.relatedByTeam.get(team.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubChips heading="Related History" items={(data.heritageByContentItem.get(team.id) ?? []).map((h) => ({ label: h.title, href: h.href }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge, not a live squad, ranking or statistics service.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
