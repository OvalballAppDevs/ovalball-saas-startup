import type { ReactNode } from "react"

import type { KitPattern } from "@/components/club/rugby-kit"
import type { PublicClub } from "@/lib/club-public/club"
import { publishedDate } from "@/lib/club-public/format"
import { cn } from "@/lib/utils"

import { ArticleBody } from "./article-body"
import { CrestPlate } from "./club-chrome"
import { KitField } from "./kit-field"

export interface ArticleViewModel {
  title: string
  excerpt: string | null
  body: string
  categoryLabel: string
  byline: string
  teamName: string | null
  publishedAt: string | null
  updatedAt: string | null
  heroUrl: string | null
  heroAlt: string | null
  membersOnly: boolean
  readingMinutes: number
}

/**
 * A club publication. Used by the public article page and by the editor's
 * Preview, so a volunteer sees the real thing before pressing Publish.
 */
export function ArticleView({
  club,
  article,
  pattern,
  headingLevel = 1,
  footer,
}: {
  club: PublicClub
  article: ArticleViewModel
  pattern: KitPattern
  /** The preview sits inside the editor page, which already has an h1. */
  headingLevel?: 1 | 2
  footer?: ReactNode
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2"
  const edited =
    article.publishedAt && article.updatedAt && new Date(article.updatedAt).getTime() - new Date(article.publishedAt).getTime() > 60 * 60 * 1000
  return (
    <article>
      <header className="relative isolate overflow-hidden bg-(--club-hero) text-(--club-hero-fg)">
        <KitField pattern={pattern} className="absolute inset-x-0 top-0 -z-10 h-24 w-full [mask-image:linear-gradient(to_bottom,black,transparent)] md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[30%] md:[mask-image:linear-gradient(to_right,transparent,black_50%)]" />
        <div className="mx-auto max-w-4xl px-4 pt-16 pb-12 md:px-8 md:pt-14 md:pb-16">
          {/* As on the homepage: words stay on the plain shirt colour, clear of the pattern. */}
          <div className="md:max-w-[68%]">
          <div className="flex items-center gap-3">
            <CrestPlate club={club} size="sm" />
            <p className="text-sm font-medium text-(--club-hero-muted)">{club.name}</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="rounded-full bg-(--club-hero-accent) px-3 py-1 text-xs font-semibold text-(--club-on-hero-accent)">{article.categoryLabel}</span>
            {article.teamName && <span className="rounded-full border border-current px-3 py-1 text-xs font-semibold">{article.teamName}</span>}
            {article.membersOnly && <span className="rounded-full border border-current px-3 py-1 text-xs font-semibold">Members Only</span>}
          </div>
          <Heading className="mt-4 max-w-[22ch] text-[clamp(2rem,1.5rem+2.4vw,3.5rem)] leading-[1.05] font-semibold tracking-tight text-balance">
            {article.title || "Untitled article"}
          </Heading>
          {article.excerpt && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--club-hero-muted) md:text-xl">{article.excerpt}</p>}
          <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--club-hero-muted)">
            <span className="font-semibold text-(--club-hero-fg)">{article.byline}</span>
            <span aria-hidden="true">/</span>
            {article.publishedAt ? <time dateTime={article.publishedAt}>{publishedDate(article.publishedAt)}</time> : <span>Not published yet</span>}
            <span aria-hidden="true">/</span>
            <span>{article.readingMinutes} min read</span>
            {edited && article.updatedAt && (
              <>
                <span aria-hidden="true">/</span>
                <span>
                  Updated <time dateTime={article.updatedAt}>{publishedDate(article.updatedAt)}</time>
                </span>
              </>
            )}
          </p>
          </div>
        </div>
      </header>

      {article.heroUrl && (
        <figure className="mx-auto -mt-2 max-w-5xl px-4 pt-8 md:px-8">
          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-ink/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL inside a reserved 16:9 box */}
            <img src={article.heroUrl} alt={article.heroAlt ?? ""} className="size-full object-cover" fetchPriority="high" decoding="async" />
          </div>
        </figure>
      )}

      <div className={cn("mx-auto max-w-4xl px-4 md:px-8", article.heroUrl ? "pt-10" : "pt-12")}>
        {article.body.trim() ? (
          <ArticleBody body={article.body} />
        ) : (
          <p className="text-ink-muted">Nothing has been written yet.</p>
        )}
        {footer}
      </div>
    </article>
  )
}
