/**
 * Pure rules for the club desk -- the club home as it appears inside the
 * signed-in dashboard. No queries here, so the rules can be tested alone.
 */

import type { ClubAnnouncement } from "./announcements"

/**
 * Urgent notices interrupt the viewer's own work at the top of the dashboard;
 * everything else waits in the club rail. A notice appears in exactly one
 * place, never both.
 */
export function splitDeskNotices(notices: ClubAnnouncement[]): { pinned: ClubAnnouncement[]; rail: ClubAnnouncement[] } {
  return {
    pinned: notices.filter((n) => n.priority === "URGENT"),
    rail: notices.filter((n) => n.priority !== "URGENT"),
  }
}

/**
 * The clubs a family view spans, in the order its children first appear.
 * A family view is never narrowed to one club (see active-context-rules), so
 * the dashboard lists every club rather than picking one to brand the page.
 */
export function distinctClubIds(relationships: { clubId: string | null | undefined }[]): string[] {
  const seen: string[] = []
  for (const r of relationships) if (r.clubId && !seen.includes(r.clubId)) seen.push(r.clubId)
  return seen
}

/** Where this viewer manages news for the club desk they are looking at, if anywhere. */
export function deskManageHref(authority: { club: boolean; team: boolean }, teamId: string | null): string | null {
  if (authority.club) return "/club/settings/news"
  if (authority.team && teamId) return `/teams/${teamId}/news`
  return null
}
