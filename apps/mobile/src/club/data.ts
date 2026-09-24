import type { SupabaseClient } from "@supabase/supabase-js"
import { newsCardFromArticle, noticeFromAnnouncement, type ClubNewsCard, type ClubNotice, type Database, type SessionContext, type SwitchableContext } from "@ovalball/contracts"
import { readFeed, readingScopeFor } from "@ovalball/contracts/club/content"
import { loadClubOverview, type ClubOverview } from "@ovalball/contracts/club/overview"

import { todayIso } from "../agenda/load"

type Client = SupabaseClient<Database>

export interface ClubHomeData {
  overview: ClubOverview
  notices: ClubNotice[]
  news: ClubNewsCard[]
}

/** The club's overview and its own voice, in one pass; each half failing on its own. */
export async function loadClubHome(supabase: Client, ctx: SessionContext, context: SwitchableContext): Promise<ClubHomeData> {
  const clubId = context.clubId ?? context.id
  if (context.kind !== "club" || !clubId) throw new Error("Not a club context.")
  const [overview, feed] = await Promise.all([
    loadClubOverview(supabase, clubId, context.subjectClubName ?? context.label, todayIso()),
    readFeed(supabase, readingScopeFor(context, ctx), { announcements: 3, news: 3 }).catch(() => ({ announcements: [], news: [], moreAnnouncements: false, moreNews: false })),
  ])
  return { overview, notices: feed.announcements.map(noticeFromAnnouncement), news: feed.news.map(newsCardFromArticle) }
}
