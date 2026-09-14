import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AnnouncementEditor } from "@/components/club-content/announcement-editor"
import { resolveClubNewsConsole } from "@/lib/club-content/console"
import { loadEditableAnnouncement } from "@/lib/club-content/manage"

export const metadata: Metadata = { title: "Edit Announcement", robots: { index: false } }

export default async function EditClubAnnouncementPage({ params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params
  const c = await resolveClubNewsConsole()
  const announcement = await loadEditableAnnouncement(c.supabase, c.scope, announcementId)
  if (!announcement) notFound()
  return <AnnouncementEditor key={announcement.id} clubId={c.scope.clubId} announcement={announcement} teams={c.teams} lockedTeamId={null} basePath={c.basePath} />
}
