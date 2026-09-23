import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { articlePlainText, readingMinutes, summarise } from "./markup"
import { articleCategoryLabel, priorityLabel } from "./vocabulary"

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

/** Most urgent first, then most recent -- a club that has said something important should not have it third. */
const PRIORITY_RANK = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 } as const

export async function listLiveClubNotices(supabase: Client, clubId: string, limit = 6): Promise<ClubNotice[]> {
  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from("club_announcements")
    .select("id, title, body, priority, visibility, expires_at, link_label, link_url, teams(display_name)")
    .eq("club_id", clubId)
    .eq("status", "PUBLISHED")
    .lte("starts_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("starts_at", { ascending: false })
    .limit(limit)

  return (data ?? [])
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      priority: a.priority as ClubNotice["priority"],
      priorityLabel: priorityLabel(a.priority),
      teamName: (a.teams as { display_name: string } | null)?.display_name ?? null,
      expiresAt: a.expires_at,
      link:
        a.link_label && a.link_url
          ? { label: a.link_label, href: a.link_url, external: /^https:\/\//.test(a.link_url) }
          : null,
      membersOnly: a.visibility === "MEMBERS",
    }))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}

const NEWS_COLUMNS =
  "id, team_id, slug, title, excerpt, body, category, visibility, featured, hero_image_path, system_key, published_at, updated_at, teams(display_name)"

/**
 * The club's latest news, with its chosen lead story first where it has one.
 *
 * The lead is asked for separately rather than sorted for, because "featured" is
 * a club's editorial decision and not a date -- a story the club has chosen to
 * lead with should lead even when something newer exists.
 */
export async function listClubNews(supabase: Client, clubId: string, clubName: string, limit = 4): Promise<ClubNewsCard[]> {
  const [{ data: leadRows }, { data: latestRows }] = await Promise.all([
    supabase
      .from("club_articles")
      .select(NEWS_COLUMNS)
      .eq("club_id", clubId)
      .eq("status", "PUBLISHED")
      .eq("featured", true)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("club_articles")
      .select(NEWS_COLUMNS)
      .eq("club_id", clubId)
      .eq("status", "PUBLISHED")
      .order("published_at", { ascending: false })
      .limit(limit),
  ])

  const lead = (leadRows ?? [])[0] ?? null
  const rest = (latestRows ?? []).filter((r) => r.id !== lead?.id)
  return [...(lead ? [lead] : []), ...rest].slice(0, limit).map((r) => toCard(supabase, r, clubName))
}

function toCard(supabase: Client, row: Record<string, unknown>, clubName: string): ClubNewsCard {
  const body = (row.body as string) ?? ""
  const teamName = (row.teams as { display_name: string } | null)?.display_name ?? null
  const heroPath = (row.hero_image_path as string | null) ?? null
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    excerpt: ((row.excerpt as string | null) ?? "").trim() || summarise(articlePlainText(body), 180),
    categoryLabel: articleCategoryLabel(row.category as string),
    publishedAt: (row.published_at as string | null) ?? (row.updated_at as string),
    // Ovalball's own system articles say so; everything else is the team's
    // voice where it has one, and the club's otherwise. Never a person's name:
    // a club speaks, not an individual volunteer.
    byline: row.system_key ? "Ovalball" : (teamName ?? clubName),
    teamName,
    // `club-news-media` is a PUBLIC bucket -- the same public URL the website
    // renders, so an image needs no signing and no second policy.
    heroUrl: heroPath ? supabase.storage.from("club-news-media").getPublicUrl(heroPath).data.publicUrl : null,
    membersOnly: row.visibility === "MEMBERS",
    readingMinutes: readingMinutes(body),
  }
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
