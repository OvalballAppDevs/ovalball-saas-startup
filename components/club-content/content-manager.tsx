import Link from "next/link"
import { Megaphone, Newspaper, Plus } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import type { ManagedAnnouncementRow, ManagedArticleRow } from "@/lib/club-content/manage"
import { CONTENT_STATUS_LABEL, articlePath, priorityLabel } from "@/lib/club-content/vocabulary"
import { cn } from "@/lib/utils"

import { CopyLinkButton } from "./copy-link-button"

/**
 * News & Announcements, as a list an administrator can act on in one glance:
 * what is live, what is a draft, where each came from, and the link to share.
 * Shared by the club's console and every team's.
 */

function formatWhen(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
}

function StatusPill({ status, live }: { status: string; live?: boolean }) {
  const label = live === false && status === "PUBLISHED" ? "Not Showing" : CONTENT_STATUS_LABEL[status as keyof typeof CONTENT_STATUS_LABEL]
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        status === "PUBLISHED" && live !== false ? "bg-mint-100 text-forest-900" : status === "ARCHIVED" ? "bg-ink/[0.05] text-ink-muted" : "bg-amber-100 text-amber-900"
      )}
    >
      {label}
    </span>
  )
}

export function ContentManager({
  clubSlug,
  clubName,
  basePath,
  publicOrigin,
  articles,
  announcements,
  scopeLabel,
}: {
  clubSlug: string
  clubName: string
  basePath: string
  publicOrigin: string
  articles: ManagedArticleRow[]
  announcements: ManagedAnnouncementRow[]
  /** "the club" or a team's name, for empty states. */
  scopeLabel: string
}) {
  return (
    <div className="mt-8 grid gap-12">
      <section aria-labelledby="manage-articles">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="manage-articles" className="flex items-center gap-2 font-display text-2xl text-ink">
            <Newspaper aria-hidden="true" className="size-5 text-forest-800" /> Articles
          </h2>
          <Link href={`${basePath}/new`} className={buttonVariants({ className: "h-11 px-4" })}>
            <Plus aria-hidden="true" /> Write an Article
          </Link>
        </div>
        {articles.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-ink/15 bg-white p-6">
            <p className="font-semibold text-ink">No articles yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Write a match report, an event or an update for {scopeLabel}. It appears on {clubName}&apos;s public page as soon as you publish it.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10 bg-white">
            {articles.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={a.status} />
                    {a.featured && <span className="rounded-full bg-forest-900 px-2.5 py-0.5 text-xs font-semibold text-white">Lead Story</span>}
                    {a.visibility === "MEMBERS" && <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-xs font-semibold text-ink/75">Members</span>}
                  </div>
                  <p className="mt-1.5 font-semibold text-ink">
                    <Link href={`${basePath}/${a.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                      {a.title}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {a.isSystem ? "Written by Ovalball" : (a.teamName ?? "The whole club")}
                    {", "}
                    {a.status === "PUBLISHED" ? `published ${formatWhen(a.publishedAt)}` : `edited ${formatWhen(a.updatedAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === "PUBLISHED" && <CopyLinkButton url={`${publicOrigin}${articlePath(clubSlug, a.slug)}`} />}
                  <Link href={`${basePath}/${a.id}`} aria-label={`Edit ${a.title}`} className={buttonVariants({ variant: "outline" })}>
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="manage-announcements">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="manage-announcements" className="flex items-center gap-2 font-display text-2xl text-ink">
            <Megaphone aria-hidden="true" className="size-5 text-forest-800" /> Announcements
          </h2>
          <Link href={`${basePath}/announcements/new`} className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}>
            <Plus aria-hidden="true" /> New Announcement
          </Link>
        </div>
        {announcements.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-ink/15 bg-white p-6">
            <p className="font-semibold text-ink">No announcements</p>
            <p className="mt-1 text-sm text-ink-muted">Use an announcement for short notices, like a closed clubhouse or a change of kick-off, that should disappear on their own.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10 bg-white">
            {announcements.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={a.status} live={a.live} />
                    <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-xs font-semibold text-ink/75">{priorityLabel(a.priority)}</span>
                  </div>
                  <p className="mt-1.5 font-semibold text-ink">
                    <Link href={`${basePath}/announcements/${a.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                      {a.title}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {a.teamName ?? "The whole club"}, from {formatWhen(a.startsAt)}
                    {a.expiresAt ? ` until ${formatWhen(a.expiresAt)}` : ", no end date"}
                  </p>
                </div>
                <Link href={`${basePath}/announcements/${a.id}`} aria-label={`Edit ${a.title}`} className={buttonVariants({ variant: "outline" })}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
