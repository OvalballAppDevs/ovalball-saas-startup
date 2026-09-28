import type { SupabaseClient } from "@supabase/supabase-js"
import { newsCardFromArticle, noticeFromAnnouncement, type ClubNewsCard, type ClubNotice, type Database, type SessionContext, type SwitchableContext } from "@ovalball/contracts"
import { clubCoverUrlFromPath } from "@ovalball/contracts/club-logo"
import { readFeed, readingScopeFor } from "@ovalball/contracts/club/content"
import { loadClubOverview, type ClubOverview } from "@ovalball/contracts/club/overview"

import { todayIso } from "../agenda/load"

type Client = SupabaseClient<Database>

export interface ClubHomeData {
  overview: ClubOverview
  notices: ClubNotice[]
  news: ClubNewsCard[]
  /** The club's own uploaded profile cover, or null -- there is no directory-level fallback (see `clubCoverUrlFromPath`), so Club Home draws its plain forest ground where a club hasn't set one rather than a stock photograph. */
  coverUrl: string | null
}

/** The club's overview and its own voice, in one pass; each half failing on its own. */
export async function loadClubHome(supabase: Client, ctx: SessionContext, context: SwitchableContext): Promise<ClubHomeData> {
  const clubId = context.clubId ?? context.id
  if (context.kind !== "club" || !clubId) throw new Error("Not a club context.")
  const [overview, feed, club] = await Promise.all([
    loadClubOverview(supabase, clubId, context.subjectClubName ?? context.label, todayIso()),
    readFeed(supabase, readingScopeFor(context, ctx), { announcements: 3, news: 3 }).catch(() => ({ announcements: [], news: [], moreAnnouncements: false, moreNews: false })),
    supabase.from("clubs").select("cover_storage_path").eq("id", clubId).maybeSingle(),
  ])
  return {
    overview,
    notices: feed.announcements.map(noticeFromAnnouncement),
    news: feed.news.map(newsCardFromArticle),
    coverUrl: clubCoverUrlFromPath(supabase, club.data?.cover_storage_path ?? null),
  }
}
