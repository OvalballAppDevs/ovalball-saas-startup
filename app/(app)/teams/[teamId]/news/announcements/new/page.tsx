import type { Metadata } from "next"

import { AnnouncementEditor } from "@/components/club-content/announcement-editor"
import { resolveTeamNewsConsole } from "@/lib/club-content/console"

export const metadata: Metadata = { title: "New Announcement", robots: { index: false } }

export default async function NewTeamAnnouncementPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const c = await resolveTeamNewsConsole(teamId)
  return <AnnouncementEditor clubId={c.scope.clubId} announcement={null} teams={c.teams} lockedTeamId={teamId} basePath={c.basePath} />
}
