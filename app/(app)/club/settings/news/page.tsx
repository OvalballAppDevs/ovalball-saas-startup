import type { Metadata } from "next"
import Link from "next/link"

import { ContentManager } from "@/components/club-content/content-manager"
import { resolveClubNewsConsole } from "@/lib/club-content/console"
import { listManagedContent } from "@/lib/club-content/manage"
import { clubHomePath } from "@/lib/club-content/vocabulary"

import { ClubSettingsNav } from "../club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../resolve-nav-capabilities"

export const metadata: Metadata = { title: "News & Announcements" }

/**
 * Club Settings > News & Announcements: the club's own publishing console.
 * Team news written from a team's page appears here too, with its team.
 */
export default async function ClubNewsSettingsPage() {
  const console_ = await resolveClubNewsConsole()
  const [content, navCaps] = await Promise.all([
    listManagedContent(console_.supabase, console_.scope),
    resolveClubSettingsNavCapabilities(console_.supabase, console_.scope.clubId),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium text-forest-800">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">News &amp; Announcements</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Publish news and short notices on {console_.club.name}&apos;s public page. Every article gets its own link to share.{" "}
        <Link href={clubHomePath(console_.club.slug)} className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          View the club page
        </Link>
      </p>

      <ClubSettingsNav active="news" {...navCaps} />

      <ContentManager
        clubSlug={console_.club.slug}
        clubName={console_.club.name}
        basePath={console_.basePath}
        publicOrigin={console_.publicOrigin}
        articles={content.articles}
        announcements={content.announcements}
        scopeLabel="the club or any of its teams"
      />
    </div>
  )
}
