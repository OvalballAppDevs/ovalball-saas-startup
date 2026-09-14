import Link from "next/link"

import type { KitPattern } from "@/components/club/rugby-kit"
import type { ArticleCard } from "@/lib/club-public/articles"
import { publishedDate } from "@/lib/club-public/format"
import { articlePath } from "@/lib/club-content/vocabulary"
import { cn } from "@/lib/utils"

import { KitField } from "./kit-field"
import { FOCUS_LIGHT, Tag } from "./primitives"

/**
 * The picture at the top of a story. A real photo when the club gave one,
 * with its alt text. Otherwise the club's own shirt pattern in its colours
 * with the story's category -- so an imageless article still looks like it
 * belongs to this club rather than like a missing image.
 */
export function ArticleVisual({
  article,
  pattern,
  className,
  priority = false,
}: {
  article: Pick<ArticleCard, "heroUrl" | "heroAlt" | "categoryLabel">
  pattern: KitPattern
  className?: string
  priority?: boolean
}) {
  if (article.heroUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL; the box reserves its space so nothing shifts while it loads
      <img
        src={article.heroUrl}
        alt={article.heroAlt ?? ""}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={cn("size-full object-cover", className)}
      />
    )
  }
  return (
    <div className={cn("relative isolate flex size-full items-end overflow-hidden bg-(--club-hero) p-4 text-(--club-hero-fg)", className)}>
      <KitField pattern={pattern} className="absolute inset-0 -z-10 size-full opacity-90" />
      {/* Stands in for the category tag, which is only drawn separately under a real photo. */}
      <span className="rounded-md bg-(--club-hero) px-2 py-1 font-display text-2xl leading-none tracking-wide">{article.categoryLabel}</span>
    </div>
  )
}

function Meta({ article }: { article: ArticleCard }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
      <span className="font-medium text-ink/80">{article.byline}</span>
      <span aria-hidden="true">/</span>
      <time dateTime={article.publishedAt}>{publishedDate(article.publishedAt)}</time>
      {article.membersOnly && <Tag>Members</Tag>}
    </p>
  )
}

/** The club's lead story. */
export function LeadStory({ article, clubSlug, pattern }: { article: ArticleCard; clubSlug: string; pattern: KitPattern }) {
  return (
    <article className="group relative grid overflow-hidden rounded-2xl border border-ink/10 bg-white md:grid-cols-[1.15fr_1fr]">
      <div className="aspect-[16/10] md:aspect-auto md:min-h-80">
        <ArticleVisual article={article} pattern={pattern} priority />
      </div>
      <div className="flex flex-col p-6 md:p-8">
        <div className="flex flex-wrap gap-2">
          {article.heroUrl && <Tag tone="brand">{article.categoryLabel}</Tag>}
          {article.teamName && <Tag>{article.teamName}</Tag>}
        </div>
        <h3 className="mt-4 text-2xl leading-tight font-semibold text-balance text-ink md:text-3xl">
          <Link href={articlePath(clubSlug, article.slug)} className={cn(FOCUS_LIGHT, "rounded-sm after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4")}>
            {article.title}
          </Link>
        </h3>
        <p className="mt-3 text-base leading-relaxed text-ink/75">{article.excerpt}</p>
        <div className="mt-auto pt-6">
          <Meta article={article} />
        </div>
      </div>
    </article>
  )
}

/** A story in a grid or list. The whole card is one link, named by its headline. */
export function NewsCard({ article, clubSlug, pattern, showTeam = true }: { article: ArticleCard; clubSlug: string; pattern: KitPattern; showTeam?: boolean }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white transition-shadow hover:shadow-[0_12px_30px_-20px_rgba(16,21,18,0.5)]">
      <div className="aspect-[16/9]">
        <ArticleVisual article={article} pattern={pattern} />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap gap-2">
          {article.heroUrl && <Tag tone="brand">{article.categoryLabel}</Tag>}
          {showTeam && article.teamName && <Tag>{article.teamName}</Tag>}
        </div>
        <h3 className="mt-3 text-lg leading-snug font-semibold text-ink">
          <Link href={articlePath(clubSlug, article.slug)} className={cn(FOCUS_LIGHT, "rounded-sm after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4")}>
            {article.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink/70">{article.excerpt}</p>
        <div className="mt-auto pt-4">
          <Meta article={article} />
        </div>
      </div>
    </article>
  )
}
