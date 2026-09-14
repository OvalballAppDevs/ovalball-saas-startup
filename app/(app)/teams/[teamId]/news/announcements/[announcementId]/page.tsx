import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AnnouncementEditor } from "@/components/club-content/announcement-editor"
import { resolveTeamNewsConsole } from "@/lib/club-content/console"
import { loadEditableAnnouncement } from "@/lib/club-content/manage"

export const metadata: Metadata = { title: "Edit Announcement", robots: { index: false } }

export default async function EditTeamAnnouncementPage({ params }: { params: Promise<{ teamId: string; announcementId: string }> }) {
  const { teamId, announcementId } = await params
  const c = await resolveTeamNewsConsole(teamId)
  const announcement = await loadEditableAnnouncement(c.supabase, c.scope, announcementId)
  if (!announcement) notFound()
  return <AnnouncementEditor key={announcement.id} clubId={c.scope.clubId} announcement={announcement} teams={c.teams} lockedTeamId={teamId} basePath={c.basePath} />
}
