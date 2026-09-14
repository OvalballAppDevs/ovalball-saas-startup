import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { ContentManager } from "@/components/club-content/content-manager"
import { resolveTeamNewsConsole } from "@/lib/club-content/console"
import { listManagedContent } from "@/lib/club-content/manage"
import { clubHomePath } from "@/lib/club-content/vocabulary"

export const metadata: Metadata = { title: "Team News" }

/**
 * A team's own News & Announcements. The same console as the club's, scoped
 * to one team: anyone who holds team news authority for this team -- today
 * its manager and coaches -- publishes here, and the club sees it too.
 */
export default async function TeamNewsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const c = await resolveTeamNewsConsole(teamId)
  const content = await listManagedContent(c.supabase, c.scope)
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href={`/teams/${teamId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {c.team?.name}
      </Link>
      <h1 className="mt-4 font-display text-display-l text-ink">Team News</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Match reports, updates and notices for {c.team?.name}. Published stories appear on{" "}
        <Link href={clubHomePath(c.club.slug)} className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          {c.club.name}&apos;s page
        </Link>{" "}
        under Team News.
      </p>
      <ContentManager
        clubSlug={c.club.slug}
        clubName={c.club.name}
        basePath={c.basePath}
        publicOrigin={c.publicOrigin}
        articles={content.articles}
        announcements={content.announcements}
        scopeLabel={c.team?.name ?? "this team"}
      />
    </div>
  )
}
