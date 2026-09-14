import Link from "next/link"
import type { ReactNode } from "react"
import { BookOpen, ExternalLink, PenLine } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import type { ClubDesk, FamilyClub } from "@/lib/club-public/club-desk"
import { publishedDate } from "@/lib/club-public/format"
import { articlePath, clubHomePath } from "@/lib/club-content/vocabulary"
import { cn } from "@/lib/utils"

import { CrestPlate } from "./club-chrome"
import { AnnouncementItem } from "./home-sections"
import { KitField } from "./kit-field"
import { ArticleVisual } from "./news-cards"
import { FOCUS_LIGHT, TEXT_LINK } from "./primitives"

/**
 * THE CLUB DESK -- the club home inside the signed-in dashboard.
 *
 * The dashboard stays a place to get things done: the viewer's own work keeps
 * the main column, and the club's life (notices, news, the Rugby Hub, the
 * public page) sits in a quieter rail beside it. The club's identity lives in
 * one compact band at the top, drawn from the same home-kit theme as the
 * public page, so being signed in still feels like being at your club.
 */

/** The branded band: crest, club, who you are here, and your next match. */
export function ClubDeskHeader({
  club,
  greeting,
  contextLine,
  nextMatch,
}: {
  club: ClubDesk["club"]
  greeting: string
  /** e.g. "Under 12 Boys, Coach" or "Club Admin". */
  contextLine: string
  nextMatch: { label: string; when: string; href: string } | null
}) {
  return (
    <header className="relative isolate overflow-hidden rounded-3xl bg-(--club-hero) text-(--club-hero-fg) ring-1 ring-black/10">
      <KitField
        pattern={club.theme.pattern}
        className="absolute inset-y-0 right-0 -z-10 h-full w-[45%] [mask-image:linear-gradient(to_right,transparent,black_55%)] md:w-[34%]"
      />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 md:p-7">
        <CrestPlate club={club} size="md" />
        <div className="min-w-0 flex-1 sm:max-w-[62%]">
          <p className="text-sm font-medium text-(--club-hero-muted)">{greeting}</p>
          <h1 className="mt-0.5 font-display text-[clamp(2.25rem,1.8rem+2vw,3.5rem)] leading-[0.95] tracking-wide text-balance">{club.name}</h1>
          <p className="mt-1 text-sm text-(--club-hero-muted)">{contextLine}</p>
        </div>
        {nextMatch && (
          <Link
            href={nextMatch.href}
            className="block rounded-2xl bg-(--club-hero-accent) px-4 py-3 text-(--club-on-hero-accent) shadow-sm ring-1 ring-black/10 outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--club-focus-hero) sm:ml-auto sm:max-w-64"
          >
            <span className="block text-xs font-semibold">Your Next Match</span>
            <span className="mt-0.5 block text-sm font-semibold">{nextMatch.label}</span>
            <span className="block text-sm">{nextMatch.when}</span>
          </Link>
        )}
      </div>
    </header>
  )
}

function RailSection({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Urgent notices, pinned above the viewer's own work. */
export function PinnedNotices({ notices }: { notices: ClubDesk["notices"] }) {
  if (notices.length === 0) return null
  return (
    <section aria-label="Urgent club notices" className="grid gap-3">
      {notices.map((n) => (
        <AnnouncementItem key={n.id} announcement={n} />
      ))}
    </section>
  )
}

/** The club rail: notices, news, the Rugby Hub and the club's public page. */
export function ClubRail({ desk, notices }: { desk: ClubDesk; notices: ClubDesk["notices"] }) {
  const { club, news, manageHref } = desk
  return (
    <div className="grid gap-8">
      <RailSection id="desk-notices" title="Club Notices">
        {notices.length ? (
          <ul className="grid gap-3">
            {notices.map((n) => (
              <li key={n.id}>
                <AnnouncementItem announcement={n} compact />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink-muted">No notices from the club right now.</p>
        )}
      </RailSection>

      <RailSection
        id="desk-news"
        title="Club News"
        action={
          news.length > 0 ? (
            <Link href={`${clubHomePath(club.slug)}/news`} className={cn(TEXT_LINK, "text-sm")}>
              All News
            </Link>
          ) : undefined
        }
      >
        {news.length ? (
          <ul className="grid gap-3">
            {news.map((a, i) => (
              <li key={a.id}>
                <article className="group relative overflow-hidden rounded-2xl border border-ink/10 bg-white transition-shadow hover:shadow-[0_10px_24px_-18px_rgba(16,21,18,0.5)]">
                  {i === 0 && a.heroUrl && (
                    <div className="aspect-[16/8]">
                      <ArticleVisual article={a} pattern={club.theme.pattern} />
                    </div>
                  )}
                  <div className="px-4 py-3">
                    <h3 className="text-sm leading-snug font-semibold text-ink">
                      <Link href={articlePath(club.slug, a.slug)} className={cn(FOCUS_LIGHT, "rounded-sm after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4")}>
                        {a.title}
                      </Link>
                    </h3>
                    <p className="mt-1 text-xs text-ink-muted">
                      {[a.teamName ?? a.byline, publishedDate(a.publishedAt)].join(", ")}
                      {a.membersOnly ? ", members only" : ""}
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink-muted">The club has not published any news yet.</p>
        )}
        {manageHref && (
          <Link href={manageHref} className={cn(FOCUS_LIGHT, "mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:border-ink/35")}>
            <PenLine aria-hidden="true" className="size-4" />
            Manage News
          </Link>
        )}
      </RailSection>

      <section aria-labelledby="desk-hub" className="rounded-2xl border border-(--club-border) bg-(--club-tint) p-5">
        <div className="flex items-center gap-2">
          <BookOpen aria-hidden="true" className="size-5 text-(--club-ink)" />
          <h2 id="desk-hub" className="text-base font-semibold text-ink">
            Rugby Hub
          </h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink/75">The laws, positions and skills of the game, for players, parents, coaches and supporters.</p>
        <Link href="/rugby-hub" className={cn(TEXT_LINK, "mt-3 inline-flex min-h-11 items-center text-sm")}>
          Explore the Rugby Hub
        </Link>
      </section>

      <Link
        href={clubHomePath(club.slug)}
        className={cn(FOCUS_LIGHT, "flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink hover:border-ink/30")}
      >
        <span>
          View Club Page
          <span className="block text-xs font-normal text-ink-muted">What the public sees, with a link to share</span>
        </span>
        <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      </Link>
    </div>
  )
}

/** A family view spans clubs, so it lists them instead of wearing one club's colours. */
export function YourClubs({ clubs }: { clubs: FamilyClub[] }) {
  if (clubs.length === 0) return null
  return (
    <RailSection id="desk-your-clubs" title="Your Clubs">
      <ul className="grid gap-2">
        {clubs.map((c) => (
          <li key={c.id}>
            <Link
              href={clubHomePath(c.slug)}
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm font-semibold text-ink outline-none hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <ClubAvatar logoUrl={c.crestUrl} name={c.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">Open a club to see its notices, news and fixtures.</p>
    </RailSection>
  )
}
