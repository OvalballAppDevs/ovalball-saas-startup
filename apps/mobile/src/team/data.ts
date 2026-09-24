import type { SupabaseClient } from "@supabase/supabase-js"
import {
  clubAccentsOnDark,
  loadClubKitTheme,
  newsCardFromArticle,
  noticeFromAnnouncement,
  resolveClubTheme,
  type ClubAccents,
  type ClubNewsCard,
  type ClubNotice,
  type ClubTheme,
  type Database,
  type SessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"
import { readFeed, readingScopeFor } from "@ovalball/contracts/club/content"
import { loadTeamOverview, type TeamOverview } from "@ovalball/contracts/team/overview"
import { readMyTeamRelationship, type TeamRelationship } from "@ovalball/contracts/team/people"

import { todayIso } from "../agenda/load"

type Client = SupabaseClient<Database>

/**
 * WHAT THE TEAM HOME NEEDS, FOR THE TEAM YOU ARE STANDING IN (CA-M7).
 *
 * The operational read is the SHARED `loadTeamOverview` -- the same function the website's dashboard
 * panel renders -- so the phone and the browser cannot disagree about what needs this person, what is
 * next or who has answered. Around it sit only presentation facts: the club's kit colours for the
 * hero, what the club and the team have said (through the CA-M5 reading scope), the team's own identity
 * fields, and what this viewer IS to the team (badges from `my_team_relationship`, never authority).
 *
 * Every read is the caller's own client under RLS; the overview's one capability read decides what is
 * drawn and nothing more.
 */
export interface TeamHomeData {
  overview: TeamOverview
  theme: ClubTheme
  accents: ClubAccents
  identity: { rugbyCode: string | null; ageGroup: string | null; gender: string | null; active: boolean }
  relationships: TeamRelationship[]
  notices: ClubNotice[]
  news: ClubNewsCard[]
}

/** The forest the Team Home stands on, so the club's accents are measured against it. */
const FOREST_GROUND = "#071c14"

export async function loadTeamHome(supabase: Client, ctx: SessionContext, context: SwitchableContext): Promise<TeamHomeData> {
  if (context.kind !== "team" || !context.id || !context.clubId) throw new Error("Not a team context.")
  const teamId = context.id
  const clubId = context.clubId
  const today = todayIso()

  const [overview, kit, team, relationships, feed] = await Promise.all([
    loadTeamOverview(supabase, clubId, teamId, today),
    loadClubKitTheme(supabase, clubId).catch(() => null),
    supabase.from("teams").select("rugby_code, age_group, gender, active").eq("id", teamId).maybeSingle(),
    readMyTeamRelationship(supabase, teamId),
    readFeed(supabase, readingScopeFor(context, ctx), { announcements: 3, news: 3 }).catch(() => ({ announcements: [], news: [], moreAnnouncements: false, moreNews: false })),
  ])

  const theme = resolveClubTheme(kit)
  return {
    overview,
    theme,
    accents: clubAccentsOnDark(theme, FOREST_GROUND),
    identity: {
      rugbyCode: team.data?.rugby_code ?? null,
      ageGroup: team.data?.age_group ?? null,
      gender: team.data?.gender ?? null,
      active: team.data?.active ?? true,
    },
    relationships,
    notices: feed.announcements.map(noticeFromAnnouncement),
    news: feed.news.map(newsCardFromArticle),
  }
}
