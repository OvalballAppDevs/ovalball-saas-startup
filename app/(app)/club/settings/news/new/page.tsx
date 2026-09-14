import type { Metadata } from "next"

import { ArticleEditor } from "@/components/club-content/article-editor"
import { resolveClubNewsConsole } from "@/lib/club-content/console"

export const metadata: Metadata = { title: "New Article", robots: { index: false } }

export default async function NewClubArticlePage() {
  const c = await resolveClubNewsConsole()
  return <ArticleEditor club={c.club} article={null} teams={c.teams} lockedTeamId={null} canChooseLeadStory={c.canChooseLeadStory} basePath={c.basePath} publicOrigin={c.publicOrigin} />
}
