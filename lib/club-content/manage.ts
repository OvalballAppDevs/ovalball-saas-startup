import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

import type { EditableAnnouncement } from "@/components/club-content/announcement-editor"
import type { EditableArticle } from "@/components/club-content/article-editor"
import { articleImageUrl } from "@/lib/club-public/articles"

import type { AnnouncementPriority, ArticleCategory, ContentStatus, ContentVisibility } from "./vocabulary"

/**
 * What an editor sees in News & Announcements: every article and notice in
 * their scope, in any state. The scope is RLS -- club_articles and
 * club_announcements return a row to an editor only where
 * internal.may_edit_club_content admits them -- and this narrows further to
 * one team when the page is a team's.
 *
 * The one TypeScript question asked about authority is the same pair of
 * capabilities the database adapters resolve, and it only decides which
 * buttons to draw. Every write re-checks in the database.
 */

export interface ContentScope {
  clubId: string
  /** Null for the club's own console; a team id for a team's. */
  teamId: string | null
}

export async function mayManageContent(supabase: SupabaseClient<Database>, scope: ContentScope): Promise<{ club: boolean; team: boolean }> {
  const club = await hasCapability(supabase, "club.news.manage", "club", { clubId: scope.clubId })
  if (club) return { club: true, team: true }
  const team = scope.teamId ? await hasCapability(supabase, "team.news.manage", "team", { clubId: scope.clubId, teamId: scope.teamId }) : false
  return { club: false, team }
}

export interface ManagedArticleRow {
  id: string
  slug: string
  title: string
  status: ContentStatus
  featured: boolean
  teamName: string | null
  isSystem: boolean
  visibility: ContentVisibility
  publishedAt: string | null
  updatedAt: string
}

export interface ManagedAnnouncementRow {
  id: string
  title: string
  status: ContentStatus
  priority: AnnouncementPriority
  teamName: string | null
  startsAt: string
  expiresAt: string | null
  live: boolean
}

export async function listManagedContent(supabase: SupabaseClient<Database>, scope: ContentScope) {
  let articles = supabase
    .from("club_articles")
    .select("id, slug, title, status, featured, visibility, system_key, published_at, updated_at, team_id, teams(display_name)")
    .eq("club_id", scope.clubId)
  let announcements = supabase
    .from("club_announcements")
    .select("id, title, status, priority, starts_at, expires_at, team_id, teams(display_name)")
    .eq("club_id", scope.clubId)
  if (scope.teamId) {
    articles = articles.eq("team_id", scope.teamId)
    announcements = announcements.eq("team_id", scope.teamId)
  }
  const [{ data: articleRows }, { data: announcementRows }] = await Promise.all([
    articles.order("updated_at", { ascending: false }).limit(200),
    announcements.order("starts_at", { ascending: false }).limit(100),
  ])
  const now = Date.now()
  return {
    articles: (articleRows ?? []).map(
      (a): ManagedArticleRow => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        status: a.status as ContentStatus,
        featured: a.featured,
        teamName: a.teams?.display_name ?? null,
        isSystem: Boolean(a.system_key),
        visibility: a.visibility as ContentVisibility,
        publishedAt: a.published_at,
        updatedAt: a.updated_at,
      })
    ),
    announcements: (announcementRows ?? []).map(
      (a): ManagedAnnouncementRow => ({
        id: a.id,
        title: a.title,
        status: a.status as ContentStatus,
        priority: a.priority as AnnouncementPriority,
        teamName: a.teams?.display_name ?? null,
        startsAt: a.starts_at,
        expiresAt: a.expires_at,
        live:
          a.status === "PUBLISHED" && new Date(a.starts_at).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now),
      })
    ),
  }
}

export async function loadEditableArticle(supabase: SupabaseClient<Database>, scope: ContentScope, articleId: string): Promise<EditableArticle | null> {
  let query = supabase
    .from("club_articles")
    .select("id, slug, team_id, title, excerpt, body, category, visibility, status, featured, hero_image_path, hero_image_alt, system_key, published_at, updated_at")
    .eq("id", articleId)
    .eq("club_id", scope.clubId)
  if (scope.teamId) query = query.eq("team_id", scope.teamId)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    slug: data.slug,
    teamId: data.team_id,
    title: data.title,
    excerpt: data.excerpt ?? "",
    body: data.body,
    category: data.category as ArticleCategory,
    visibility: data.visibility as ContentVisibility,
    status: data.status as ContentStatus,
    featured: data.featured,
    heroImagePath: data.hero_image_path,
    heroImageUrl: articleImageUrl(supabase, data.hero_image_path),
    heroImageAlt: data.hero_image_alt ?? "",
    publishedAt: data.published_at,
    updatedAt: data.updated_at,
    isSystem: Boolean(data.system_key),
  }
}

export async function loadEditableAnnouncement(
  supabase: SupabaseClient<Database>,
  scope: ContentScope,
  announcementId: string
): Promise<EditableAnnouncement | null> {
  let query = supabase
    .from("club_announcements")
    .select("id, team_id, title, body, priority, visibility, status, starts_at, expires_at, link_label, link_url")
    .eq("id", announcementId)
    .eq("club_id", scope.clubId)
  if (scope.teamId) query = query.eq("team_id", scope.teamId)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    teamId: data.team_id,
    title: data.title,
    body: data.body ?? "",
    priority: data.priority as AnnouncementPriority,
    visibility: data.visibility as ContentVisibility,
    status: data.status as ContentStatus,
    startsAt: data.starts_at,
    expiresAt: data.expires_at,
    linkLabel: data.link_label ?? "",
    linkUrl: data.link_url ?? "",
  }
}
