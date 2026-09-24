import type { SupabaseClient } from "@supabase/supabase-js"

import type { ActiveContextKind, SwitchableContext } from "../active-context-rules"
import { resolveClubLogoPathFrom } from "../club-logo"
import type { Database } from "../database"
import type { SessionContext } from "../session-context"
import { articlePlainText, readingMinutes, summarise } from "./markup"
import { articleCategoryLabel, priorityLabel, type AnnouncementPriority, type ArticleCategory, type ContentStatus, type ContentVisibility } from "./vocabulary"

/**
 * NEWS & ANNOUNCEMENTS -- THE SHARED CONTRACT (CA-M5).
 *
 * One publishing domain, two clients. `club_articles` is the club's news; `club_announcements` are its
 * short, dated notices with a priority. Both are written through the same operations the website has
 * always used (`save_club_article`, `save_club_announcement`, `set_club_*_status`,
 * `set_club_article_featured`) and READ through row-level security, which is the whole audience model:
 *
 *   PUBLIC    a published item anyone can read, signed in or not;
 *   MEMBERS   a published item for people the club or team recognises
 *             (`internal.may_view_club_member_content`: club.profile.view at the club, or
 *             team.team.view on the team -- which is how a guardian sees their child's team notices);
 *   editors   see their own drafts and archive (`internal.may_edit_club_content`).
 *
 * Nothing here decides an audience. Every reader below asks for PUBLISHED rows explicitly (an editor's
 * home screen shows what everybody sees, not a half-written article) and leaves PUBLIC-versus-MEMBERS
 * entirely to the database. A draft is never returned by a reader; management reads are separate and
 * still RLS-bounded.
 */
type Client = SupabaseClient<Database>

const MEDIA_BUCKET = "club-news-media"

/** `club-news-media` is a PUBLIC bucket: the same URL the website renders, no signing, no second policy. */
export function articleImageUrl(supabase: Client, path: string | null): string | null {
  return path ? supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl : null
}

/** The object path an article image is stored under; the bucket's own policy decides who may write there. */
export function articleImagePath(clubId: string, teamId: string | null, fileId: string, ext: "jpg" | "png" | "webp"): string {
  return `${clubId}/${teamId ?? "club"}/${fileId}.${ext}`
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** The extension comes from the verified type, never from the uploaded name. */
export const IMAGE_EXTENSION: Record<string, "jpg" | "png" | "webp"> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

// ---------------------------------------------------------------------------
// What a reader sees
// ---------------------------------------------------------------------------

export interface ArticleCard {
  id: string
  slug: string
  clubId: string
  /** The club that published it -- so a family reading across clubs, or a deep link, always knows whose it is. */
  clubName: string
  clubSlug: string | null
  /** The club's crest through the canonical rule (its own upload, else the Directory's); a path, resolved to a URL at the render boundary. */
  clubCrestPath: string | null
  title: string
  excerpt: string
  category: ArticleCategory
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
  /** The club's own markup (`parseArticleBody`), never HTML. */
  body: string
}

export interface AnnouncementCard {
  id: string
  clubId: string
  clubName: string
  clubSlug: string | null
  clubCrestPath: string | null
  title: string
  body: string | null
  priority: AnnouncementPriority
  priorityLabel: string
  teamId: string | null
  teamName: string | null
  startsAt: string
  expiresAt: string | null
  publishedAt: string | null
  link: { label: string; href: string; external: boolean } | null
  membersOnly: boolean
}

const ARTICLE_COLUMNS =
  "id, club_id, team_id, slug, title, excerpt, body, category, visibility, featured, hero_image_path, hero_image_alt, system_key, published_at, updated_at, teams(display_name), clubs(slug, logo_storage_path, club_directory(name, logo_storage_path))"
const ANNOUNCEMENT_COLUMNS = "id, club_id, team_id, title, body, priority, visibility, starts_at, expires_at, published_at, link_label, link_url, teams(display_name), clubs(slug, logo_storage_path, club_directory(name, logo_storage_path))"

type ArticleRow = {
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
  clubs: { slug: string; logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null
}
type AnnouncementRow = {
  id: string
  club_id: string
  team_id: string | null
  title: string
  body: string | null
  priority: string
  visibility: string
  starts_at: string
  expires_at: string | null
  published_at: string | null
  link_label: string | null
  link_url: string | null
  teams: { display_name: string } | null
  clubs: { slug: string; logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null
}

function toArticleCard(supabase: Client, r: ArticleRow, clubName: string): ArticleCard {
  const ownClub = r.clubs?.club_directory?.name || clubName || "Club"
  return {
    id: r.id,
    slug: r.slug,
    clubId: r.club_id,
    clubName: ownClub,
    clubSlug: r.clubs?.slug ?? null,
    clubCrestPath: resolveClubLogoPathFrom(r.clubs?.logo_storage_path, r.clubs?.club_directory?.logo_storage_path),
    title: r.title,
    excerpt: (r.excerpt ?? "").trim() || summarise(articlePlainText(r.body), 180),
    category: r.category as ArticleCategory,
    categoryLabel: articleCategoryLabel(r.category),
    publishedAt: r.published_at ?? r.updated_at,
    updatedAt: r.updated_at,
    byline: r.system_key ? "Ovalball" : (r.teams?.display_name ?? ownClub),
    teamId: r.team_id,
    teamName: r.teams?.display_name ?? null,
    heroUrl: articleImageUrl(supabase, r.hero_image_path),
    heroAlt: r.hero_image_alt,
    membersOnly: r.visibility === "MEMBERS",
    featured: r.featured,
    isSystem: Boolean(r.system_key),
    readingMinutes: readingMinutes(r.body),
  }
}

function toAnnouncementCard(r: AnnouncementRow): AnnouncementCard {
  return {
    id: r.id,
    clubId: r.club_id,
    clubName: r.clubs?.club_directory?.name ?? "Club",
    clubSlug: r.clubs?.slug ?? null,
    clubCrestPath: resolveClubLogoPathFrom(r.clubs?.logo_storage_path, r.clubs?.club_directory?.logo_storage_path),
    title: r.title,
    body: r.body,
    priority: r.priority as AnnouncementPriority,
    priorityLabel: priorityLabel(r.priority),
    teamId: r.team_id,
    teamName: r.teams?.display_name ?? null,
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    publishedAt: r.published_at,
    link: r.link_label && r.link_url ? { label: r.link_label, href: r.link_url, external: /^https:\/\//.test(r.link_url) } : null,
    membersOnly: r.visibility === "MEMBERS",
  }
}

export interface Page<T> {
  items: T[]
  /** True when another page may exist (the page came back full). */
  more: boolean
}

/**
 * Published news at a club, newest first, one page at a time. `teamId` narrows to a team's own stories
 * PLUS the club-wide ones (a team context still hears the club) -- presentation, not authority: the rows
 * were already the caller's to read.
 */
export async function listPublishedArticles(supabase: Client, clubId: string, clubName = "", opts: { teamId?: string | null; limit?: number; offset?: number; leadFirst?: boolean } = {}): Promise<Page<ArticleCard>> {
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  let q = supabase.from("club_articles").select(ARTICLE_COLUMNS).eq("club_id", clubId).eq("status", "PUBLISHED")
  if (opts.teamId) q = q.or(`team_id.is.null,team_id.eq.${opts.teamId}`)
  // The lead story is the club's editorial decision, not a date: asked for separately so it leads even
  // when something newer exists (the domain's `featured` semantics, preserved on every surface).
  const [{ data, error }, lead] = await Promise.all([
    q.order("published_at", { ascending: false }).range(offset, offset + limit - 1),
    opts.leadFirst && offset === 0 ? supabase.from("club_articles").select(ARTICLE_COLUMNS).eq("club_id", clubId).eq("status", "PUBLISHED").eq("featured", true).order("published_at", { ascending: false }).limit(1) : Promise.resolve({ data: null as unknown as null }),
  ])
  if (error) throw error
  const rows = (data ?? []) as unknown as ArticleRow[]
  const leadRow = ((lead?.data ?? []) as unknown as ArticleRow[])[0] ?? null
  const ordered = leadRow ? [leadRow, ...rows.filter((r) => r.id !== leadRow.id)].slice(0, limit) : rows
  return { items: ordered.map((r) => toArticleCard(supabase, r, clubName)), more: rows.length === limit }
}

/** Live announcements: PUBLISHED, started, not yet expired -- a window, not a flag. Most urgent first, then newest. */
export async function listLiveAnnouncements(supabase: Client, clubId: string, opts: { teamId?: string | null; limit?: number; offset?: number } = {}): Promise<Page<AnnouncementCard>> {
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  const nowIso = new Date().toISOString()
  let q = supabase.from("club_announcements").select(ANNOUNCEMENT_COLUMNS).eq("club_id", clubId).eq("status", "PUBLISHED").lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${nowIso}`)
  if (opts.teamId) q = q.or(`team_id.is.null,team_id.eq.${opts.teamId}`)
  const { data, error } = await q.order("starts_at", { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw error
  const rows = (data ?? []) as unknown as AnnouncementRow[]
  const rank = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 } as const
  const items = rows.map(toAnnouncementCard).sort((a, b) => rank[a.priority] - rank[b.priority])
  return { items, more: rows.length === limit }
}

/** One published article by id. Null when it is not published or not the caller's to read. */
export async function readPublishedArticle(supabase: Client, articleId: string, clubName = ""): Promise<Article | null> {
  const { data, error } = await supabase.from("club_articles").select(ARTICLE_COLUMNS).eq("id", articleId).eq("status", "PUBLISHED").maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as unknown as ArticleRow
  return { ...toArticleCard(supabase, r, clubName), body: r.body }
}

/** The website's identity for an article is the club's slug plus the article's slug; a link from there resolves here. */
export async function readPublishedArticleBySlug(supabase: Client, clubSlug: string, articleSlug: string, clubName = ""): Promise<Article | null> {
  const { data: club } = await supabase.from("clubs").select("id").eq("slug", clubSlug).maybeSingle()
  if (!club) return null
  const { data, error } = await supabase.from("club_articles").select(ARTICLE_COLUMNS).eq("club_id", club.id).eq("slug", articleSlug).eq("status", "PUBLISHED").maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as unknown as ArticleRow
  return { ...toArticleCard(supabase, r, clubName), body: r.body }
}

/** One live announcement by id. Null when it is not live or not the caller's to read. */
export async function readLiveAnnouncement(supabase: Client, announcementId: string): Promise<AnnouncementCard | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase.from("club_announcements").select(ANNOUNCEMENT_COLUMNS).eq("id", announcementId).eq("status", "PUBLISHED").lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${nowIso}`).maybeSingle()
  if (error) throw error
  return data ? toAnnouncementCard(data as unknown as AnnouncementRow) : null
}

// ---------------------------------------------------------------------------
// Where a person may publish, and what they manage
// ---------------------------------------------------------------------------

export interface PublishingScope {
  kind: "club" | "team"
  teamId: string | null
  teamName: string | null
}

/** The scopes the caller may publish to at this club -- the server's answer, asked with the write's own rule. Empty when they may not publish. */
export async function readPublishingScopes(supabase: Client, clubId: string): Promise<PublishingScope[]> {
  const { data, error } = await supabase.rpc("club_publishing_scopes", { p_club_id: clubId })
  if (error) throw error
  return (data ?? []).map((r) => ({ kind: r.scope_type === "team" ? "team" : "club", teamId: r.team_id ?? null, teamName: r.team_display_name ?? null }))
}

export interface ContentScope {
  clubId: string
  /** Null for the club's own console; a team id for a team's. */
  teamId: string | null
}

export interface ManagedArticleRow {
  id: string
  slug: string
  title: string
  status: ContentStatus
  featured: boolean
  teamId: string | null
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
  teamId: string | null
  teamName: string | null
  startsAt: string
  expiresAt: string | null
  live: boolean
}

/** Every article and notice in the editor's scope, in any state -- bounded by RLS (an editor's own scope), narrowed to one team when the console is a team's. */
export async function listManagedContent(supabase: Client, scope: ContentScope): Promise<{ articles: ManagedArticleRow[]; announcements: ManagedAnnouncementRow[] }> {
  let articles = supabase.from("club_articles").select("id, slug, title, status, featured, visibility, system_key, published_at, updated_at, team_id, teams(display_name)").eq("club_id", scope.clubId)
  let announcements = supabase.from("club_announcements").select("id, title, status, priority, starts_at, expires_at, team_id, teams(display_name)").eq("club_id", scope.clubId)
  if (scope.teamId) {
    articles = articles.eq("team_id", scope.teamId)
    announcements = announcements.eq("team_id", scope.teamId)
  }
  const [{ data: articleRows }, { data: announcementRows }] = await Promise.all([articles.order("updated_at", { ascending: false }).limit(200), announcements.order("starts_at", { ascending: false }).limit(100)])
  const now = Date.now()
  return {
    articles: (articleRows ?? []).map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      status: a.status as ContentStatus,
      featured: a.featured,
      teamId: a.team_id,
      teamName: (a.teams as { display_name: string } | null)?.display_name ?? null,
      isSystem: Boolean(a.system_key),
      visibility: a.visibility as ContentVisibility,
      publishedAt: a.published_at,
      updatedAt: a.updated_at,
    })),
    announcements: (announcementRows ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status as ContentStatus,
      priority: a.priority as AnnouncementPriority,
      teamId: a.team_id,
      teamName: (a.teams as { display_name: string } | null)?.display_name ?? null,
      startsAt: a.starts_at,
      expiresAt: a.expires_at,
      live: a.status === "PUBLISHED" && new Date(a.starts_at).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now),
    })),
  }
}

export interface EditableArticle {
  id: string
  slug: string
  teamId: string | null
  title: string
  excerpt: string
  body: string
  category: ArticleCategory
  visibility: ContentVisibility
  status: ContentStatus
  featured: boolean
  heroImagePath: string | null
  heroImageUrl: string | null
  heroImageAlt: string
  publishedAt: string | null
  updatedAt: string | null
  isSystem: boolean
}

export interface EditableAnnouncement {
  id: string
  teamId: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  visibility: ContentVisibility
  status: ContentStatus
  startsAt: string
  expiresAt: string | null
  linkLabel: string
  linkUrl: string
}

export async function loadEditableArticle(supabase: Client, scope: ContentScope, articleId: string): Promise<EditableArticle | null> {
  let query = supabase.from("club_articles").select("id, slug, team_id, title, excerpt, body, category, visibility, status, featured, hero_image_path, hero_image_alt, system_key, published_at, updated_at").eq("id", articleId).eq("club_id", scope.clubId)
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

export async function loadEditableAnnouncement(supabase: Client, scope: ContentScope, announcementId: string): Promise<EditableAnnouncement | null> {
  let query = supabase.from("club_announcements").select("id, team_id, title, body, priority, visibility, status, starts_at, expires_at, link_label, link_url").eq("id", announcementId).eq("club_id", scope.clubId)
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

// ---------------------------------------------------------------------------
// The operations -- the website's own, and nothing else
// ---------------------------------------------------------------------------

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

export async function saveArticle(supabase: Client, input: ArticleInput): Promise<{ id: string; slug: string }> {
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
    p_hero_image_alt: input.heroImageAlt || undefined,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { id: String((row as { article_id: string }).article_id), slug: String((row as { article_slug: string }).article_slug) }
}

export async function setArticleStatus(supabase: Client, articleId: string, status: ContentStatus): Promise<void> {
  const { error } = await supabase.rpc("set_club_article_status", { p_article_id: articleId, p_status: status })
  if (error) throw error
}

export async function setArticleFeatured(supabase: Client, articleId: string, featured: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_club_article_featured", { p_article_id: articleId, p_featured: featured })
  if (error) throw error
}

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

export async function saveAnnouncement(supabase: Client, input: AnnouncementInput): Promise<{ id: string }> {
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
    p_link_label: input.linkLabel || undefined,
    p_link_url: input.linkUrl || undefined,
  })
  if (error) throw error
  return { id: String(data) }
}

export async function setAnnouncementStatus(supabase: Client, announcementId: string, status: ContentStatus): Promise<void> {
  const { error } = await supabase.rpc("set_club_announcement_status", { p_announcement_id: announcementId, p_status: status })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// The words for a refusal -- one rule, both clients
// ---------------------------------------------------------------------------

const CONSTRAINT_MESSAGES: [RegExp, string][] = [
  [/announcements_title_length/, "Give the announcement a title between 3 and 100 characters."],
  [/announcements_body_length/, "Keep the announcement to 500 characters or fewer."],
  [/announcements_window/, "The end date must be after the start date."],
  [/link_together|link_label_length/, "A link needs both a label and an address."],
  [/link_safe/, "Links must start with https:// or be a page on Ovalball, such as /calendar."],
  [/title_length/, "Give it a headline between 3 and 140 characters."],
  [/excerpt_length/, "Keep the summary to 300 characters or fewer."],
  [/body_length/, "The article is too long. Keep it under 20,000 characters."],
  [/hero_needs_alt/, "Describe the image in a few words, so people who cannot see it know what it shows."],
  [/hero_in_club_folder/, "That image does not belong to this club. Upload it again."],
]

export function contentErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  const message = e.message ?? ""
  if (e.code === "42501") return "You don't have permission to do that for this club or team."
  if (e.code === "P0002") return "That item no longer exists. Refresh and try again."
  if (e.code === "23505") return "Something with that link already exists. Try saving again."
  for (const [pattern, sentence] of CONSTRAINT_MESSAGES) if (pattern.test(message)) return sentence
  // Our own functions raise complete sentences for business rules.
  if (e.code === "23514" || e.code === "22023") return message || fallback
  return fallback
}

// ---------------------------------------------------------------------------
// Media housekeeping (CA-M5, shared by both editors)
// ---------------------------------------------------------------------------

/** Whether an uploaded image is referenced by any article the caller can see -- so an abandoned upload can be removed and a saved one never is. */
export async function isArticleImageInUse(supabase: Client, path: string): Promise<boolean> {
  const { count } = await supabase.from("club_articles").select("id", { count: "exact", head: true }).eq("hero_image_path", path)
  return (count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// WHERE TO ASK, per context -- and one feed for every reading surface
// ---------------------------------------------------------------------------

/**
 * The clubs a reading surface asks about, and the team it narrows to for presentation. THE CLIENT
 * DECIDES WHERE TO ASK; THE SERVER DECIDES WHAT MAY BE SEEN (row-level security answers every query
 * below row by row). Each context kind has its own deliberate rule:
 *
 *   club     the selected club
 *   team     the owning club, narrowed to team-targeted plus club-wide
 *   parent   the child's club, narrowed to the child's team plus club-wide
 *   player   the player's club, narrowed to their team plus club-wide
 *   family   every club a child (or the person's own player record) plays at, not narrowed --
 *            the family hears each of its clubs, and the server keeps sibling-team content private
 *   site_admin / governing   nothing: there is no canonical all-content feed to invent
 */
export interface ReadingScope {
  kind: ActiveContextKind | "none"
  clubs: { id: string; name: string }[]
  teamId: string | null
}

export function readingScopeFor(active: SwitchableContext | null, ctx: SessionContext | null): ReadingScope {
  if (!active) return { kind: "none", clubs: [], teamId: null }
  const named = (id: string | null, fallback: string) => (id ? [{ id, name: fallback }] : [])
  switch (active.kind) {
    case "club":
      return { kind: "club", clubs: named(active.clubId ?? active.id, active.subjectClubName ?? active.label), teamId: null }
    case "team":
      return { kind: "team", clubs: named(active.clubId, active.subjectClubName ?? "Club"), teamId: active.id }
    case "parent":
      return { kind: "parent", clubs: named(active.clubId, active.subjectClubName ?? "Club"), teamId: active.id }
    case "player":
      return { kind: "player", clubs: named(active.clubId, active.subjectClubName ?? "Club"), teamId: active.id }
    case "family": {
      const clubs = new Map<string, string>()
      for (const g of ctx?.guardianRelationships ?? []) if (g.clubId && !clubs.has(g.clubId)) clubs.set(g.clubId, g.clubName)
      for (const t of ctx?.linkedPlayerTeams ?? []) if (t.clubId && !clubs.has(t.clubId)) clubs.set(t.clubId, t.clubName)
      return { kind: "family", clubs: [...clubs].map(([id, name]) => ({ id, name })), teamId: null }
    }
    default:
      return { kind: active.kind, clubs: [], teamId: null }
  }
}

export interface Feed {
  announcements: AnnouncementCard[]
  news: ArticleCard[]
  /** Another page may exist (only offered when one club is being read). */
  moreAnnouncements: boolean
  moreNews: boolean
}

const PRIORITY_RANK = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 } as const

/** Deduplicated by publication id, ordered by the domain's own semantics: priority then newest for notices; lead story then newest for news. */
export function mergeFeed(pages: { announcements: Page<AnnouncementCard>; news: Page<ArticleCard> }[], single: boolean): Feed {
  const seenA = new Set<string>()
  const seenN = new Set<string>()
  const announcements = pages.flatMap((p) => p.announcements.items).filter((a) => !seenA.has(a.id) && seenA.add(a.id)).sort((x, y) => PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] || y.startsAt.localeCompare(x.startsAt))
  const news = pages.flatMap((p) => p.news.items).filter((n) => !seenN.has(n.id) && seenN.add(n.id)).sort((x, y) => Number(y.featured) - Number(x.featured) || y.publishedAt.localeCompare(x.publishedAt))
  return { announcements, news, moreAnnouncements: single && (pages[0]?.announcements.more ?? false), moreNews: single && (pages[0]?.news.more ?? false) }
}

/** THE ONE READING PROJECTION: Home asks with small limits, the index with pages; both get the same truth. */
export async function readFeed(supabase: Client, scope: ReadingScope, opts: { announcements?: number; news?: number; offsetAnnouncements?: number; offsetNews?: number } = {}): Promise<Feed> {
  if (scope.clubs.length === 0) return { announcements: [], news: [], moreAnnouncements: false, moreNews: false }
  const pages = await Promise.all(
    scope.clubs.map(async (c) => ({
      announcements: await listLiveAnnouncements(supabase, c.id, { teamId: scope.teamId, limit: opts.announcements ?? 20, offset: opts.offsetAnnouncements ?? 0 }),
      news: await listPublishedArticles(supabase, c.id, c.name, { teamId: scope.teamId, limit: opts.news ?? 20, offset: opts.offsetNews ?? 0, leadFirst: true }),
    }))
  )
  return mergeFeed(pages, scope.clubs.length === 1)
}
