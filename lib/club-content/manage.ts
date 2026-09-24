import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

/**
 * What an editor sees in News & Announcements. The reads moved to the shared
 * contract in CA-M5 (`@ovalball/contracts/club/content`) so the app and the
 * website list, load and save the same rows through the same operations; this
 * file keeps the web's own capability question, which only decides which
 * buttons to draw. Every write re-checks in the database.
 */
export {
  listManagedContent,
  loadEditableArticle,
  loadEditableAnnouncement,
  type ContentScope,
  type ManagedArticleRow,
  type ManagedAnnouncementRow,
} from "@ovalball/contracts/club/content"

import type { ContentScope } from "@ovalball/contracts/club/content"

export async function mayManageContent(supabase: SupabaseClient<Database>, scope: ContentScope): Promise<{ club: boolean; team: boolean }> {
  const club = await hasCapability(supabase, "club.news.manage", "club", { clubId: scope.clubId })
  if (club) return { club: true, team: true }
  const team = scope.teamId ? await hasCapability(supabase, "team.news.manage", "team", { clubId: scope.clubId, teamId: scope.teamId }) : false
  return { club: false, team }
}
