/**
 * The words club content uses, in one place.
 *
 * The database stores stable keys (club_articles.category, status,
 * visibility; club_announcements.priority). What a person reads lives here,
 * so rewording a label never needs a migration and no screen invents its own.
 */

export type ArticleCategory = "NEWS" | "MATCH_REPORT" | "EVENT" | "UPDATE" | "CELEBRATION" | "WELCOME"
export type ContentStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
export type ContentVisibility = "PUBLIC" | "MEMBERS"
export type AnnouncementPriority = "NORMAL" | "IMPORTANT" | "URGENT"

export const ARTICLE_CATEGORIES: { key: ArticleCategory; label: string }[] = [
  { key: "NEWS", label: "News" },
  { key: "MATCH_REPORT", label: "Match Report" },
  { key: "EVENT", label: "Event" },
  { key: "UPDATE", label: "Club Update" },
  { key: "CELEBRATION", label: "Celebration" },
]

export function articleCategoryLabel(key: string): string {
  if (key === "WELCOME") return "Welcome"
  return ARTICLE_CATEGORIES.find((c) => c.key === key)?.label ?? "News"
}

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
}

export const VISIBILITY_OPTIONS: { key: ContentVisibility; label: string; description: string }[] = [
  { key: "PUBLIC", label: "Everyone", description: "Anyone with the link can read it, and it appears on the club's public page." },
  { key: "MEMBERS", label: "Club Members", description: "Only people signed in to Ovalball with a place at the club (or the team) can read it." },
]

export const PRIORITY_OPTIONS: { key: AnnouncementPriority; label: string }[] = [
  { key: "NORMAL", label: "Notice" },
  { key: "IMPORTANT", label: "Important" },
  { key: "URGENT", label: "Urgent" },
]

export function priorityLabel(key: string): string {
  return PRIORITY_OPTIONS.find((p) => p.key === key)?.label ?? "Notice"
}

/** Public URL of an article, from the club's canonical slug. */
export function articlePath(clubSlug: string, articleSlug: string): string {
  return `/club/${clubSlug}/news/${articleSlug}`
}

export function clubHomePath(clubSlug: string): string {
  return `/club/${clubSlug}`
}
