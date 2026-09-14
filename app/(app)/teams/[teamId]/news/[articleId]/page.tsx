import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ArticleEditor } from "@/components/club-content/article-editor"
import { resolveTeamNewsConsole } from "@/lib/club-content/console"
import { loadEditableArticle } from "@/lib/club-content/manage"

export const metadata: Metadata = { title: "Edit Article", robots: { index: false } }

export default async function EditTeamArticlePage({ params }: { params: Promise<{ teamId: string; articleId: string }> }) {
  const { teamId, articleId } = await params
  const c = await resolveTeamNewsConsole(teamId)
  const article = await loadEditableArticle(c.supabase, c.scope, articleId)
  if (!article) notFound()
  return <ArticleEditor key={article.id} club={c.club} article={article} teams={c.teams} lockedTeamId={teamId} canChooseLeadStory={c.canChooseLeadStory} basePath={c.basePath} publicOrigin={c.publicOrigin} />
}
