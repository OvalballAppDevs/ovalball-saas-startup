"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import type { AnnouncementPriority, ArticleCategory, ContentStatus, ContentVisibility } from "./vocabulary"
import {
  contentErrorMessage,
  saveAnnouncement as saveAnnouncementOp,
  saveArticle as saveArticleOp,
  setAnnouncementStatus as setAnnouncementStatusOp,
  setArticleFeatured as setArticleFeaturedOp,
  setArticleStatus as setArticleStatusOp,
} from "@ovalball/contracts/club/content"

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

function explain(error: { code?: string; message: string }, fallback: string): string {
  return contentErrorMessage(error, fallback)
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

  let row: { id: string; slug: string }
  try {
    row = await saveArticleOp(supabase, input)
  } catch (error) {
    const e = error as { code?: string; message: string }
    console.error("save_club_article failed:", e.code, e.message)
    return { ok: false, error: explain(e, "The article could not be saved. Try again.") }
  }

  if (previous && previous !== input.heroImagePath) {
    // Best effort: storage policy re-checks authority for this exact path.
    await supabase.storage.from("club-news-media").remove([previous])
  }

  await refreshPublicPages(supabase, input.clubId, input.teamId)
  return { ok: true, data: { id: row.id, slug: row.slug } }
}

export async function setArticleStatus(articleId: string, status: ContentStatus): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to publish club news." }
  const { data: article } = await supabase.from("club_articles").select("club_id, team_id").eq("id", articleId).maybeSingle()
  try {
    await setArticleStatusOp(supabase, articleId, status)
  } catch (error) {
    return { ok: false, error: explain(error as { code?: string; message: string }, "That change could not be made. Try again.") }
  }
  if (article) await refreshPublicPages(supabase, article.club_id, article.team_id)
  return { ok: true, data: null }
}

export async function setArticleFeatured(articleId: string, featured: boolean): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to change the lead story." }
  const { data: article } = await supabase.from("club_articles").select("club_id, team_id").eq("id", articleId).maybeSingle()
  try {
    await setArticleFeaturedOp(supabase, articleId, featured)
  } catch (error) {
    return { ok: false, error: explain(error as { code?: string; message: string }, "The lead story could not be changed. Try again.") }
  }
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
  let saved: { id: string }
  try {
    saved = await saveAnnouncementOp(supabase, input)
  } catch (error) {
    const e = error as { code?: string; message: string }
    console.error("save_club_announcement failed:", e.code, e.message)
    return { ok: false, error: explain(e, "The announcement could not be saved. Try again.") }
  }
  await refreshPublicPages(supabase, input.clubId, input.teamId)
  return { ok: true, data: { id: saved.id } }
}

export async function setAnnouncementStatus(announcementId: string, status: ContentStatus): Promise<Result> {
  const supabase = await signedIn()
  if (!supabase) return { ok: false, error: "Sign in to publish announcements." }
  const { data: row } = await supabase.from("club_announcements").select("club_id, team_id").eq("id", announcementId).maybeSingle()
  try {
    await setAnnouncementStatusOp(supabase, announcementId, status)
  } catch (error) {
    return { ok: false, error: explain(error as { code?: string; message: string }, "That change could not be made. Try again.") }
  }
  if (row) await refreshPublicPages(supabase, row.club_id, row.team_id)
  return { ok: true, data: null }
}
