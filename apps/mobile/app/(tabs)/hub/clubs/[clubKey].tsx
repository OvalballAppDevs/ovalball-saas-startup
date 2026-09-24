import { useLocalSearchParams } from "expo-router"
import { HONOUR_TYPE_LABEL, SOURCE_TIER_LABEL, TEAM_GENDER_LABEL, TEAM_ROLE_LABEL, findClubByKey, internationalRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/clubs-data"
import { afterExploreNext, exploreNext, relatedEntities } from "@ovalball/contracts/rugby-hub/related"

import { HubExploreNext, HubKeepExploring, useOpenHubEntity } from "../../../../src/hub/experience"
import { oneParam, useClubs } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadges, HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubHonours, HubLoading, HubParagraph, HubSources } from "../../../../src/hub/ui"

/**
 * A FAMOUS CLUB: introduction, curated honours, the famous people connected
 * to it, related knowledge and history, and sources -- never a live squad,
 * league position or fixture list, and never a crest that is not the club's
 * own registered one (none is shown here at all).
 */
export default function ClubScreen() {
  const { clubKey } = useLocalSearchParams<{ clubKey: string }>()
  const key = oneParam(clubKey)
  const { data, loading, error, refresh, refreshing } = useClubs()
  const club = data && key ? findClubByKey(data, key) : null
  const { openEntity } = useOpenHubEntity()
  const related = data && club ? relatedEntities({ domain: "clubs", bundle: data }, club.id) : []
  const next = exploreNext(related)

  return (
    <HubScreen section="Famous Clubs" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !club && <HubEmpty title="This club isn't published" body="It may have been renamed or withdrawn. Everything currently published is listed under Famous Clubs." />}
      {data && club && (
        <>
          <HubHero
            title={club.title}
            eyebrow="Famous Clubs"
            badges={<HubBadges items={[...(internationalRugbyCodeLabel(club.rugbyCode) ? [{ label: internationalRugbyCodeLabel(club.rugbyCode)! }] : []), ...(club.teamGender ? [{ label: TEAM_GENDER_LABEL[club.teamGender] }] : [])]} />}
          />
          <HubParagraph>{club.summary}</HubParagraph>
          {club.body && <HubParagraph quiet>{club.body}</HubParagraph>}
          <HubHonours items={(data.honoursByClub.get(club.id) ?? []).map((h) => ({ key: h.id, year: h.yearLabel, text: `${HONOUR_TYPE_LABEL[h.honourType] ?? h.honourType}, ${h.competitionTitle}`, notes: h.notes }))} />
          {related.length >= 2 && <HubExploreNext items={next} onOpen={openEntity} />}
          <HubChips heading="Famous People" items={(data.peopleByClub.get(club.id) ?? []).map((p) => ({ label: p.personTitle, trailing: TEAM_ROLE_LABEL[p.roleType], href: p.href }))} />
          <HubChips heading="Related Knowledge" items={(data.relatedByClub.get(club.id) ?? []).map((r) => ({ label: r.title, href: r.href }))} />
          <HubChips heading="Related History" items={(data.heritageByClub.get(club.id) ?? []).map((h) => ({ label: h.title, href: h.href }))} />
          <HubSources items={(data.sourcesByClub.get(club.id) ?? []).map((s) => ({ title: s.title, url: s.url, tierLabel: SOURCE_TIER_LABEL[s.tier] ?? s.tier, retrievedOn: s.retrievedOn }))} />
          <HubKeepExploring items={afterExploreNext(related, next)} onOpen={openEntity} />
          <HubFootnote>Ovalball educational guidance — general rugby knowledge and history, not a live squad, league position or fixture list.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
