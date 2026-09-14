import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { articlePlainText, readingMinutes, summarise } from "@/lib/club-content/markup"
import { articleCategoryLabel } from "@/lib/club-content/vocabulary"
import type { Database } from "@/types/database.types"

/**
 * THE PUBLIC NEWS QUERY LAYER.
 *
 * Every read of club news for a public surface goes through here. Two rules
 * hold in every query, whoever is looking:
 *
 *   - status = PUBLISHED, always, explicitly. RLS lets an editor read their
 *     own drafts, and an editor browsing their club's public page must see
 *     what the public sees rather than a half-written article.
 *   - visibility is left to RLS. A signed-out visitor is only ever handed
 *     PUBLIC rows; a member also gets MEMBERS rows. The query never widens it.
 *
 * Only the columns the page renders are selected, and never who wrote a row.
 */

const ARTICLE_COLUMNS =
  "id, club_id, team_id, slug, title, excerpt, body, category, visibility, featured, hero_image_path, hero_image_alt, system_key, published_at, updated_at, teams(display_name)"

export interface ArticleCard {
  id: string
  slug: string
  title: string
  excerpt: string
  category: string
  categoryLabel: string
  publishedAt: string
  updatedAt: string
  /** Who is speaking: Ovalball, the team, or the club. Never a person. */
  byline: string
  teamId: string | null
  teamName: string | null
  heroUrl: string | null
  heroAlt: string | null
  membersOnly: boolean
  featured: boolean
  isSystem: boolean
  readingMinutes: number
}

export interface Article extends ArticleCard {
  body: string
}

type Row = {
  id: string
  club_id: string
  team_id: string | null
  slug: string
  title: string
  excerpt: string | null
  body: string
  category: string
  visibility: string
  featured: boolean
  hero_image_path: string | null
  hero_image_alt: string | null
  system_key: string | null
  published_at: string | null
  updated_at: string
  teams: { display_name: string } | null
}

export function articleImageUrl(supabase: SupabaseClient<Database>, path: string | null): string | null {
  return path ? supabase.storage.from("club-news-media").getPublicUrl(path).data.publicUrl : null
}

function toArticle(supabase: SupabaseClient<Database>, row: Row, clubName: string): Article {
  const teamName = row.teams?.display_name ?? null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? summarise(articlePlainText(row.body), 180),
    category: row.category,
    categoryLabel: articleCategoryLabel(row.category),
    publishedAt: row.published_at ?? row.updated_at,
    updatedAt: row.updated_at,
    byline: row.system_key ? "Ovalball" : (teamName ?? clubName),
    teamId: row.team_id,
    teamName,
    heroUrl: articleImageUrl(supabase, row.hero_image_path),
    heroAlt: row.hero_image_alt,
    membersOnly: row.visibility === "MEMBERS",
    featured: row.featured,
    isSystem: Boolean(row.system_key),
    readingMinutes: readingMinutes(row.body),
    body: row.body,
  }
}

/** Strip the body from a card that is only ever a link. */
function card(article: Article): ArticleCard {
  const summary: ArticleCard & { body?: string } = { ...article }
  delete summary.body
  return summary
}

export async function listPublishedArticles(
  supabase: SupabaseClient<Database>,
  club: { id: string; name: string },
  options: { limit: number; offset?: number; scope?: "all" | "club" | "teams"; teamId?: string | null } = { limit: 6 }
): Promise<{ articles: ArticleCard[]; total: number }> {
  let query = supabase
    .from("club_articles")
    .select(ARTICLE_COLUMNS, { count: "exact" })
    .eq("club_id", club.id)
    .eq("status", "PUBLISHED")
  if (options.scope === "teams") query = query.not("team_id", "is", null)
  if (options.scope === "club") query = query.is("team_id", null)
  if (options.teamId) query = query.eq("team_id", options.teamId)
  const offset = options.offset ?? 0
  const { data, count } = await query
    .order("published_at", { ascending: false })
    .range(offset, offset + options.limit - 1)
  return {
    articles: ((data ?? []) as Row[]).map((r) => card(toArticle(supabase, r, club.name))),
    total: count ?? 0,
  }
}

/** The club's chosen lead story, if it has one and it is readable here. */
export async function getLeadArticle(supabase: SupabaseClient<Database>, club: { id: string; name: string }): Promise<ArticleCard | null> {
  const { data } = await supabase
    .from("club_articles")
    .select(ARTICLE_COLUMNS)
    .eq("club_id", club.id)
    .eq("status", "PUBLISHED")
    .eq("featured", true)
    .maybeSingle()
  return data ? card(toArticle(supabase, data as Row, club.name)) : null
}

export async function getPublishedArticle(
  supabase: SupabaseClient<Database>,
  club: { id: string; name: string },
  slug: string
): Promise<Article | null> {
  const { data } = await supabase
    .from("club_articles")
    .select(ARTICLE_COLUMNS)
    .eq("club_id", club.id)
    .eq("slug", slug)
    .eq("status", "PUBLISHED")
    .maybeSingle()
  return data ? toArticle(supabase, data as Row, club.name) : null
}

/** Same team first, then the rest of the club -- never the article itself. */
export async function relatedArticles(
  supabase: SupabaseClient<Database>,
  club: { id: string; name: string },
  article: Pick<Article, "id" | "teamId">,
  limit = 3
): Promise<ArticleCard[]> {
  const picked: ArticleCard[] = []
  if (article.teamId) {
    const { articles } = await listPublishedArticles(supabase, club, { limit: limit + 1, teamId: article.teamId })
    picked.push(...articles.filter((a) => a.id !== article.id))
  }
  if (picked.length < limit) {
    const { articles } = await listPublishedArticles(supabase, club, { limit: limit + picked.length + 1 })
    for (const a of articles) if (a.id !== article.id && !picked.some((p) => p.id === a.id)) picked.push(a)
  }
  return picked.slice(0, limit)
}
