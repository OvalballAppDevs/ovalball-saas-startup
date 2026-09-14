import type { Metadata } from "next"

import { ArticleEditor } from "@/components/club-content/article-editor"
import { resolveTeamNewsConsole } from "@/lib/club-content/console"

export const metadata: Metadata = { title: "New Article", robots: { index: false } }

export default async function NewTeamArticlePage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const c = await resolveTeamNewsConsole(teamId)
  return <ArticleEditor club={c.club} article={null} teams={c.teams} lockedTeamId={teamId} canChooseLeadStory={c.canChooseLeadStory} basePath={c.basePath} publicOrigin={c.publicOrigin} />
}
