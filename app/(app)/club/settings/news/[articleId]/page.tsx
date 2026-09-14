import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ArticleEditor } from "@/components/club-content/article-editor"
import { resolveClubNewsConsole } from "@/lib/club-content/console"
import { loadEditableArticle } from "@/lib/club-content/manage"

export const metadata: Metadata = { title: "Edit Article", robots: { index: false } }

export default async function EditClubArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params
  const c = await resolveClubNewsConsole()
  const article = await loadEditableArticle(c.supabase, c.scope, articleId)
  if (!article) notFound()
  return <ArticleEditor key={article.id} club={c.club} article={article} teams={c.teams} lockedTeamId={null} canChooseLeadStory={c.canChooseLeadStory} basePath={c.basePath} publicOrigin={c.publicOrigin} />
}
