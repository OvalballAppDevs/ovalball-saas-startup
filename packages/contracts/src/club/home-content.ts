import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { listLiveAnnouncements, listPublishedArticles, type AnnouncementCard, type ArticleCard } from "./content"

/**
 * WHAT THE CLUB IS SAYING -- notices and news, for whichever client is asking.
 *
 * THE OWNER'S POINT, IN ONE SENTENCE: a home screen that shows the week's rugby
 * and nothing the club has said is only half a home screen. The website's club
 * desk has carried Club Notices and Club News since the Club Digital Home
 * landed; the app showed neither, so a parent opening it could not be told
 * anything.
 *
 * ONE SOURCE, NOT A MOBILE COPY. These are the same two tables, the same two
 * rules and the same words the web reads:
 *
 *   * `club_announcements` -- short, dated notices with a priority, written in
 *     Club or Team Management. What is LIVE is a window, not a flag: PUBLISHED,
 *     started, and not yet expired.
 *   * `club_articles` -- the club's news, written in the same place and
 *     published to the club's own page.
 *
 * TWO RULES HOLD IN EVERY QUERY, WHOEVER IS LOOKING.
 *
 *   1. `status = 'PUBLISHED'`, always and explicitly. An editor's RLS lets them
 *      read their own drafts, and an editor opening their own home screen must
 *      see what everybody else sees rather than a half-written article.
 *   2. PUBLIC vs MEMBERS is left entirely to RLS. A member is handed the club's
 *      members-only notices because the database says so; nothing here widens
 *      it, and nothing here could.
 *
 * WHAT THIS IS NOT. It is not a second notification system. A notice is
 * something a person reads when they come and look; an ANNOUNCEMENT delivered
 * through the safeguarding-aware recipient model is something that reaches a
 * guardian who never opens the app. Those stay separate, as they do on
 * matchday, for the same reason.
 */

type Client = SupabaseClient<Database>

export interface ClubNotice {
  id: string
  /** Who published it, so a family reading across clubs knows whose notice this is. */
  clubName: string
  title: string
  body: string | null
  priority: "NORMAL" | "IMPORTANT" | "URGENT"
  priorityLabel: string
  /** The team it is about, when it is about one. Null for a club-wide notice. */
  teamName: string | null
  expiresAt: string | null
  link: { label: string; href: string; external: boolean } | null
  membersOnly: boolean
}

export interface ClubNewsCard {
  id: string
  clubName: string
  slug: string
  title: string
  excerpt: string
  categoryLabel: string
  publishedAt: string
  /** Who is speaking: Ovalball, the team, or the club. Never a person. */
  byline: string
  teamName: string | null
  heroUrl: string | null
  membersOnly: boolean
  readingMinutes: number
}

/** A notice for the Home screen: the same row, the same window, from the shared reader. */
export function noticeFromAnnouncement(a: AnnouncementCard): ClubNotice {
  return { id: a.id, clubName: a.clubName, title: a.title, body: a.body, priority: a.priority, priorityLabel: a.priorityLabel, teamName: a.teamName, expiresAt: a.expiresAt, link: a.link, membersOnly: a.membersOnly }
}

/** A news card for the Home screen: the same row from the shared reader. */
export function newsCardFromArticle(a: ArticleCard): ClubNewsCard {
  return { id: a.id, clubName: a.clubName, slug: a.slug, title: a.title, excerpt: a.excerpt, categoryLabel: a.categoryLabel, publishedAt: a.publishedAt, byline: a.byline, teamName: a.teamName, heroUrl: a.heroUrl, membersOnly: a.membersOnly, readingMinutes: a.readingMinutes }
}

/** Live notices for one club -- delegates to the shared reader so Home and the index cannot drift. */
export async function listLiveClubNotices(supabase: Client, clubId: string, limit = 6): Promise<ClubNotice[]> {
  const page = await listLiveAnnouncements(supabase, clubId, { limit })
  return page.items.map(noticeFromAnnouncement)
}

/** The club's latest news with its lead story first -- delegates to the shared reader. */
export async function listClubNews(supabase: Client, clubId: string, clubName: string, limit = 4): Promise<ClubNewsCard[]> {
  const page = await listPublishedArticles(supabase, clubId, clubName, { limit, leadFirst: true })
  return page.items.map(newsCardFromArticle)
}

/**
 * The club's home-kit colours, as a theme input.
 *
 * Read here rather than derived, so a club that changes its kit changes its home
 * screen -- on both clients, at once. `resolveClubTheme` turns it into the
 * measured palette; a club with no recorded kit gets Ovalball's own, which is
 * what `source: "ovalball-default"` says.
 */
export async function loadClubKitTheme(
  supabase: Client,
  clubId: string
): Promise<{ pattern: string | null; primaryColour: string | null; secondaryColour: string | null; accentColour: string | null } | null> {
  const { data } = await supabase
    .from("club_kits")
    .select("pattern, primary_colour, secondary_colour, accent_colour")
    .eq("club_id", clubId)
    .eq("variant", "primary")
    .maybeSingle()
  if (!data) return null
  return {
    pattern: data.pattern,
    primaryColour: data.primary_colour,
    secondaryColour: data.secondary_colour,
    accentColour: data.accent_colour,
  }
}
