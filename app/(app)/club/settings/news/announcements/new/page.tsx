import type { Metadata } from "next"

import { AnnouncementEditor } from "@/components/club-content/announcement-editor"
import { resolveClubNewsConsole } from "@/lib/club-content/console"

export const metadata: Metadata = { title: "New Announcement", robots: { index: false } }

export default async function NewClubAnnouncementPage() {
  const c = await resolveClubNewsConsole()
  return <AnnouncementEditor clubId={c.scope.clubId} announcement={null} teams={c.teams} lockedTeamId={null} basePath={c.basePath} />
}
