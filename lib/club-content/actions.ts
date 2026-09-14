"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import type { AnnouncementPriority, ArticleCategory, ContentStatus, ContentVisibility } from "./vocabulary"

/**
 * THE ONE PUBLISHING ACTION LAYER for club and team news and announcements.
 *
 * Club Settings and the team page both call these. Deliberately thin: the
 * database functions own every authority decision (save_club_article,
 * set_club_article_status, ... via internal.may_edit_club_content /
 * may_publish_club_content), so there is no permission check here to drift
 * out of step with them. These actions hand values over, keep article images
 * tidy, refresh the public pages and turn a refusal into a sentence.
 */

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// The extension comes from the verified type, never from the uploaded name.
const IMAGE_EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

const CONSTRAINT_MESSAGES: [RegExp, string][] = [
  [/title_length/, "Give it a headline between 3 and 140 characters."],
  [/excerpt_length/, "Keep the summary to 300 characters or fewer."],
  [/body_length/, "The article is too long. Keep it under 20,000 characters."],
  [/hero_needs_alt/, "Describe the image in a few words, so people who cannot see it know what it shows."],
  [/hero_in_club_folder/, "That image does not belong to this club. Upload it again."],
  [/announcements_title_length/, "Give the announcement a title between 3 and 100 characters."],
  [/announcements_body_length/, "Keep the announcement to 500 characters or fewer."],
  [/announcements_window/, "The end date must be after the start date."],
  [/link_together|link_label_length/, "A link needs both a label and an address."],
  [/link_safe/, "Links must start with https:// or be a page on Ovalball, such as /calendar."],
]

function explain(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "42501") return "You don't have permission to do that for this club or team."
  if (error.code === "P0002") return "That item no longer exists. Refresh the page."
  if (error.code === "23505") return "Something with that link already exists. Try saving again."
  for (const [pattern, sentence] of CONSTRAINT_MESSAGES) if (pattern.test(error.message)) return sentence
  // Our own functions raise complete sentences for business rules.
  if (error.code === "23514" || error.code === "22023") return error.message
  return fallback
}

async function signedIn() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? supabase : null
}

async function refreshPublicPages(supabase: Awaited<ReturnType<typeof createClient>>, clubId: string, teamId: string | null) {
  const { data } = await supabase.from("clubs").select("slug").eq("id", clubId).maybeSingle()
  if (data?.slug) revalidatePath(`/club/${data.slug}`, "layout")
  revalidatePath("/club/settings/news", "layout")
  if (teamId) revalidatePath(`/teams/${teamId}/news`, "layout")
}

// ----------------------------------------------------------------------------
// Articles
// ----------------------------------------------------------------------------

export interface ArticleInput {
  articleId: string | null
  clubId: string
  teamId: string | null
  title: string
  excerpt: string
  body: string
  category: ArticleCategory
  visibility: ContentVisibility
  heroImagePath: string | null
  heroImageAlt: string
}

export async function saveArticle(input: ArticleInput): Promise<Result<{ id: string; slug: string }>> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to write club news." }

  // The image this article used before, so a replaced image does not linger.
  const previous = input.articleId
    ? (await supabase.from("club_articles").select("hero_image_path").eq("id", input.articleId).maybeSingle()).data?.hero_image_path ?? null
    : null

  const { data, error } = await supabase.rpc("save_club_article", {
    p_article_id: input.articleId ?? undefined,
    p_club_id: input.clubId,
    p_team_id: input.teamId ?? undefined,
    p_title: input.title,
    p_excerpt: input.excerpt,
    p_body: input.body,
    p_category: input.category,
    p_visibility: input.visibility,
    p_hero_image_path: input.heroImagePath ?? undefined,
    p_hero_image_alt: input.heroImageAlt,
  })
  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) {
    if (error) console.error("save_club_article failed:", error.code, error.message)
    return { ok: false, error: error ? explain(error, "The article could not be saved. Try again.") : "The article could not be saved. Try again." }
  }

  if (previous && previous !== input.heroImagePath) {
    // Best effort: storage policy re-checks authority for this exact path.
    await supabase.storage.from("club-news-media").remove([previous])
  }

  await refreshPublicPages(supabase, input.clubId, input.teamId)
  return { ok: true, data: { id: row.article_id, slug: row.article_slug } }
}

export async function setArticleStatus(articleId: string, status: ContentStatus): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to publish club news." }
  const { data: article } = await supabase.from("club_articles").select("club_id, team_id").eq("id", articleId).maybeSingle()
  const { error } = await supabase.rpc("set_club_article_status", { p_article_id: articleId, p_status: status })
  if (error) return { ok: false, error: explain(error, "That change could not be made. Try again.") }
  if (article) await refreshPublicPages(supabase, article.club_id, article.team_id)
  return { ok: true, data: null }
}

export async function setArticleFeatured(articleId: string, featured: boolean): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to change the lead story." }
  const { data: article } = await supabase.from("club_articles").select("club_id, team_id").eq("id", articleId).maybeSingle()
  const { error } = await supabase.rpc("set_club_article_featured", { p_article_id: articleId, p_featured: featured })
  if (error) return { ok: false, error: explain(error, "The lead story could not be changed. Try again.") }
  if (article) await refreshPublicPages(supabase, article.club_id, article.team_id)
  return { ok: true, data: null }
}

/**
 * Stores an article image under {club}/{team or "club"}/{uuid}.{ext}. The
 * bucket's own policy decides whether this person may write to that folder,
 * so a tampered club or team id fails at storage rather than here.
 */
export async function uploadArticleImage(formData: FormData): Promise<Result<{ path: string; url: string }>> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to upload images." }

  const file = formData.get("file")
  const clubId = String(formData.get("clubId") ?? "")
  const teamId = String(formData.get("teamId") ?? "") || null
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." }
  if (!uuid.test(clubId) || (teamId && !uuid.test(teamId))) return { ok: false, error: "That club or team could not be found." }
  const ext = IMAGE_EXTENSION[file.type]
  if (!ext) return { ok: false, error: "Use a JPG, PNG or WebP image." }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "That image is larger than 5MB. Choose a smaller one." }

  const path = `${clubId}/${teamId ?? "club"}/${randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("club-news-media").upload(path, file, { contentType: file.type, upsert: false })
  if (error) {
    console.error("club-news-media upload failed:", error.message)
    return { ok: false, error: "The image could not be uploaded. Check you can write news here and try again." }
  }
  return { ok: true, data: { path, url: supabase.storage.from("club-news-media").getPublicUrl(path).data.publicUrl } }
}

/** Removes an image that was uploaded in the editor but never saved to an article. */
export async function discardArticleImage(path: string): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to manage images." }
  const { count } = await supabase.from("club_articles").select("id", { count: "exact", head: true }).eq("hero_image_path", path)
  if ((count ?? 0) > 0) return { ok: true, data: null }
  await supabase.storage.from("club-news-media").remove([path])
  return { ok: true, data: null }
}

// ----------------------------------------------------------------------------
// Announcements
// ----------------------------------------------------------------------------

export interface AnnouncementInput {
  announcementId: string | null
  clubId: string
  teamId: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  visibility: ContentVisibility
  startsAt: string | null
  expiresAt: string | null
  linkLabel: string
  linkUrl: string
}

export async function saveAnnouncement(input: AnnouncementInput): Promise<Result<{ id: string }>> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to write announcements." }
  const { data, error } = await supabase.rpc("save_club_announcement", {
    p_announcement_id: input.announcementId ?? undefined,
    p_club_id: input.clubId,
    p_team_id: input.teamId ?? undefined,
    p_title: input.title,
    p_body: input.body,
    p_priority: input.priority,
    p_visibility: input.visibility,
    p_starts_at: input.startsAt ?? undefined,
    p_expires_at: input.expiresAt ?? undefined,
    p_link_label: input.linkLabel,
    p_link_url: input.linkUrl,
  })
  if (error || !data) {
    if (error) console.error("save_club_announcement failed:", error.code, error.message)
    return { ok: false, error: error ? explain(error, "The announcement could not be saved. Try again.") : "The announcement could not be saved. Try again." }
  }
  await refreshPublicPages(supabase, input.clubId, input.teamId)
  return { ok: true, data: { id: data } }
}

export async function setAnnouncementStatus(announcementId: string, status: ContentStatus): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to publish announcements." }
  const { data: row } = await supabase.from("club_announcements").select("club_id, team_id").eq("id", announcementId).maybeSingle()
  const { error } = await supabase.rpc("set_club_announcement_status", { p_announcement_id: announcementId, p_status: status })
  if (error) return { ok: false, error: explain(error, "That change could not be made. Try again.") }
  if (row) await refreshPublicPages(supabase, row.club_id, row.team_id)
  return { ok: true, data: null }
}
