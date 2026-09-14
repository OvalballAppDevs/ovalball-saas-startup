import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClubBar, ClubFooter } from "@/components/club-home/club-chrome"
import { ArticleView } from "@/components/club-home/article-view"
import { NewsCard } from "@/components/club-home/news-cards"
import { BUTTON_QUIET, ClubThemeScope } from "@/components/club-home/primitives"
import { ShareActions } from "@/components/club-home/share-actions"
import { getPublishedArticle, relatedArticles } from "@/lib/club-public/articles"
import { loadPublicClub } from "@/lib/club-public/club"
import { articlePath, clubHomePath } from "@/lib/club-content/vocabulary"
import { hasCapability } from "@/lib/permissions/has-capability"
import { absoluteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

/**
 * One club article, at a stable URL a club can post anywhere.
 *
 * Only a PUBLISHED article resolves; a draft, an archived story or a members'
 * article viewed by someone who is not a member is simply not found -- the
 * same answer as a URL that never existed, so a link cannot confirm that a
 * private story exists.
 */

type Params = Promise<{ slug: string; articleSlug: string }>

async function load(slug: string, articleSlug: string) {
  const club = await loadPublicClub(slug)
  if (!club) return null
  const supabase = await createClient()
  const article = await getPublishedArticle(supabase, club, articleSlug)
  return article ? { club, article, supabase } : null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, articleSlug } = await params
  const data = await load(slug, articleSlug)
  if (!data) return { title: "Article Not Found", robots: { index: false } }
  const { club, article } = data
  const path = articlePath(club.slug, article.slug)
  const image = article.heroUrl ?? club.crestUrl
  return {
    title: `${article.title} | ${club.name}`,
    description: article.excerpt,
    alternates: { canonical: path },
    // Members' stories are never offered to search engines, even to a member.
    robots: article.membersOnly ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "article",
      url: path,
      title: article.title,
      description: article.excerpt,
      siteName: club.name,
      locale: "en_GB",
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      ...(image ? { images: [{ url: image, alt: article.heroUrl ? (article.heroAlt ?? article.title) : `${club.name} crest` }] } : {}),
    },
    twitter: {
      card: article.heroUrl ? "summary_large_image" : "summary",
      title: article.title,
      description: article.excerpt,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function ClubArticlePage({ params }: { params: Params }) {
  const { slug, articleSlug } = await params
  const data = await load(slug, articleSlug)
  if (!data) notFound()
  const { club, article, supabase } = data

  const [related, canManage] = await Promise.all([
    relatedArticles(supabase, club, article, 2),
    supabase.auth.getUser().then(({ data: { user } }) =>
      user ? hasCapability(supabase, "club.news.manage", "club", { clubId: club.id }) : false
    ),
  ])

  const url = absoluteUrl(articlePath(club.slug, article.slug))
  const pattern = club.theme.pattern

  return (
    <ClubThemeScope theme={club.theme}>
      <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold text-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2">
        Skip to content
      </a>
      <ClubBar club={club} onHome={false} manageHref={canManage ? "/club/settings/news" : null} />
      <main id="main" className="pb-20">
        <ArticleView
          club={club}
          article={article}
          pattern={pattern}
          footer={
            <div className="mt-12 max-w-[68ch] border-t border-ink/10 pt-6">
              <p className="text-sm font-semibold text-ink">Share This Article</p>
              <div className="mt-3">
                <ShareActions url={url} title={article.title} />
              </div>
              <div className="mt-8">
                <Link href={clubHomePath(club.slug)} className={BUTTON_QUIET}>
                  Back to {club.name}
                </Link>
              </div>
            </div>
          }
        />

        {related.length > 0 && (
          <section aria-labelledby="more-news" className="mx-auto mt-20 max-w-4xl px-4 md:px-8">
            <h2 id="more-news" className="font-display text-4xl leading-none tracking-wide text-ink md:text-5xl">
              More From {club.name}
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {related.map((a) => (
                <li key={a.id}>
                  <NewsCard article={a} clubSlug={club.slug} pattern={pattern} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <ClubFooter club={club} />
    </ClubThemeScope>
  )
}
