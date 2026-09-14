import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClubBar, ClubFooter } from "@/components/club-home/club-chrome"
import { NewsCard } from "@/components/club-home/news-cards"
import { BUTTON_QUIET, ClubThemeScope, EmptyState } from "@/components/club-home/primitives"
import { listPublishedArticles } from "@/lib/club-public/articles"
import { loadPublicClub } from "@/lib/club-public/club"
import { clubHomePath } from "@/lib/club-content/vocabulary"
import { createClient } from "@/lib/supabase/server"

/** Every published story from one club, twelve at a time. */

const PAGE_SIZE = 12

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const club = await loadPublicClub(slug)
  if (!club) return { title: "Club Not Found", robots: { index: false } }
  return {
    title: `News | ${club.name}`,
    description: `Match reports, events and updates from ${club.name}.`,
    alternates: { canonical: `${clubHomePath(club.slug)}/news` },
  }
}

export default async function ClubNewsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const club = await loadPublicClub(slug)
  if (!club) notFound()
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const supabase = await createClient()
  const { articles, total } = await listPublishedArticles(supabase, club, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <ClubThemeScope theme={club.theme}>
      <ClubBar club={club} onHome={false} manageHref={null} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="font-display text-5xl leading-none tracking-wide text-ink md:text-6xl">News</h1>
        <p className="mt-2 text-ink-muted">Everything {club.name} has published.</p>
        <div className="mt-8">
          {articles.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((a) => (
                <li key={a.id}>
                  <NewsCard article={a} clubSlug={club.slug} pattern={club.theme.pattern} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No news yet">The club has not published any stories yet.</EmptyState>
          )}
        </div>
        {pages > 1 && (
          <nav aria-label="News pages" className="mt-10 flex flex-wrap items-center gap-3">
            {page > 1 && (
              <Link href={`?page=${page - 1}`} className={BUTTON_QUIET}>
                Newer Stories
              </Link>
            )}
            <p className="text-sm text-ink-muted">
              Page {page} of {pages}
            </p>
            {page < pages && (
              <Link href={`?page=${page + 1}`} className={BUTTON_QUIET}>
                Older Stories
              </Link>
            )}
          </nav>
        )}
      </main>
      <ClubFooter club={club} />
    </ClubThemeScope>
  )
}
