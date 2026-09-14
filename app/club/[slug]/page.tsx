import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"

import { ClubBar, ClubFooter } from "@/components/club-home/club-chrome"
import { ClubHero, MatchdayStrip } from "@/components/club-home/club-hero"
import { FixtureRail } from "@/components/club-home/fixture-rail"
import { AnnouncementBoard, ClubInformation, ResultList, RugbyHubFeature, TeamsSection, WriteFirstArticle } from "@/components/club-home/home-sections"
import { LeadStory, NewsCard } from "@/components/club-home/news-cards"
import { ClubThemeScope, EmptyState, SectionHeading } from "@/components/club-home/primitives"
import { TeamNews } from "@/components/club-home/team-news"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { canManageClubFixturesAnywhere, getSessionContext } from "@/lib/app-context/session-context"
import { loadPublicClub, RUGBY_CODE_LABEL } from "@/lib/club-public/club"
import { londonTodayIso } from "@/lib/club-public/format"
import { loadClubHome } from "@/lib/club-public/load-club-home"
import { summarise } from "@/lib/club-content/markup"
import { clubHomePath } from "@/lib/club-content/vocabulary"
import { createClient } from "@/lib/supabase/server"

import { CalendarAccessAction } from "./calendar-access-action"

/**
 * A CLUB'S HOME ON OVALBALL.
 *
 * The public, shareable homepage at /club/{slug}. Every section is a
 * projection of canonical data, read as the visitor (never a service role):
 *
 *   identity    clubs + club_directory, crest via resolveClubLogoUrl
 *   branding    the HOME kit, through lib/club-theme (no second colour setting)
 *   news        lib/club-public/articles (PUBLISHED only; visibility by RLS)
 *   fixtures    public_club_fixtures, the one anonymous fixture projection
 *   results     public competition results, plus fixture results a signed-in
 *               viewer's own fixture policy already admits
 *
 * What it never shows, whatever its queries could reach: people and roles,
 * players, meet times, notes, venue instructions, fixture negotiation or
 * private messages. See lib/club-public/load-club-home.ts for the boundary.
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const club = await loadPublicClub(slug)
  if (!club) return { title: "Club Not Found", robots: { index: false } }
  const description =
    (club.bio && summarise(club.bio, 160)) ||
    `News, fixtures, results and teams from ${club.name}${club.place ? `, ${club.place}` : ""}${club.rugbyCode ? ` (${RUGBY_CODE_LABEL[club.rugbyCode]})` : ""}.`
  const path = clubHomePath(club.slug)
  return {
    title: club.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      title: club.name,
      description,
      siteName: "Ovalball",
      locale: "en_GB",
      ...(club.crestUrl ? { images: [{ url: club.crestUrl, alt: `${club.name} crest` }] } : {}),
    },
    twitter: { card: "summary", title: club.name, description, ...(club.crestUrl ? { images: [club.crestUrl] } : {}) },
  }
}

export default async function PublicClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const club = await loadPublicClub(slug)
  if (!club) notFound()

  const supabase = await createClient()
  const home = await loadClubHome(supabase, club, londonTodayIso())

  // Partner-club calendar access: authenticated fixture administrators of a
  // DIFFERENT club only, acting through the club they have switched into.
  // Unchanged from the page this replaced; it reuses club_partnerships.
  let calendarAccessStatus: "none" | "pending" | "active" | "revoked" | null = null
  let messagePartnerLink = false
  if (home.viewer.signedIn) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const ctx = await getSessionContext(supabase, user)
      if (canManageClubFixturesAnywhere(ctx)) {
        const cookieStore = await cookies()
        const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
        const viewerClubId = activeManageableClubId(ctx, activeContext)
        if (viewerClubId && viewerClubId !== club.id) {
          const { data: partnership } = await supabase
            .from("club_partnerships")
            .select("status")
            .or(
              `and(requesting_club_id.eq.${viewerClubId},partner_club_id.eq.${club.id}),and(requesting_club_id.eq.${club.id},partner_club_id.eq.${viewerClubId})`
            )
            .neq("status", "revoked")
            .order("requested_at", { ascending: false })
            .limit(1)
            .maybeSingle()
          calendarAccessStatus = (partnership?.status as "pending" | "active" | undefined) ?? "none"
          messagePartnerLink = partnership?.status === "active"
        }
      }
    }
  }

  const manageHref = home.viewer.canManageNews ? "/club/settings/news" : null
  const pattern = club.theme.pattern

  return (
    <ClubThemeScope theme={club.theme}>
      <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold text-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2">
        Skip to content
      </a>
      <ClubBar club={club} onHome manageHref={manageHref} />
      <main id="main">
        <ClubHero club={club} />
        <MatchdayStrip next={home.upcoming[0] ?? null} latest={home.results[0] ?? null} teamCount={home.teamCount} clubSlug={club.slug} />

        <AnnouncementBoard announcements={home.announcements} />

        <section aria-labelledby="news" className="mx-auto max-w-6xl px-4 pt-16 md:px-8 md:pt-20">
          <SectionHeading
            id="news"
            title="Latest News"
            action={home.totalArticles > 7 ? { href: `/club/${club.slug}/news`, label: "All News" } : undefined}
          />
          <div className="mt-6">
            {home.lead ? (
              <>
                <LeadStory article={home.lead} clubSlug={club.slug} pattern={pattern} />
                {home.latest.length > 0 && (
                  <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {home.latest.slice(0, 3).map((a) => (
                      <li key={a.id}>
                        <NewsCard article={a} clubSlug={club.slug} pattern={pattern} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <EmptyState title="News starts here" action={manageHref ? <WriteFirstArticle href="/club/settings/news/new" /> : undefined}>
                {manageHref
                  ? "Nothing has been published yet. Match reports, events and club updates you publish appear here, each with a link you can share."
                  : "The club has not published any news yet. Fixtures, results and teams below come straight from the club's own records."}
              </EmptyState>
            )}
          </div>
        </section>

        <section aria-labelledby="fixtures" className="mx-auto max-w-6xl px-4 pt-16 md:px-8 md:pt-20">
          <SectionHeading id="fixtures" title="Fixtures" description="Confirmed upcoming matches for every team at the club." />
          <div className="mt-6">
            {home.upcoming.length > 0 ? (
              <FixtureRail matches={home.upcoming} label={`Upcoming fixtures for ${club.name}`} />
            ) : (
              <EmptyState title="No upcoming fixtures published">
                When the club confirms a fixture it appears here automatically, with the date, the team and the opposition.
              </EmptyState>
            )}
          </div>
        </section>

        {home.results.length === 0 && home.teamNews.length === 0 ? (
          // A club early in its life gets one honest sentence here, not two empty boxes.
          <section aria-labelledby="results" className="mx-auto max-w-6xl px-4 pt-16 md:px-8 md:pt-20">
            <SectionHeading id="results" title="Results & Team News" />
            <div className="mt-6">
              <EmptyState title="The season starts here">
                Scores appear once matches are played and recorded, and match reports and updates from the club&apos;s teams appear alongside them.
              </EmptyState>
            </div>
          </section>
        ) : (
          <div className="mx-auto grid max-w-6xl gap-16 px-4 pt-16 md:px-8 md:pt-20 lg:grid-cols-2 lg:gap-10">
            <section aria-labelledby="results">
              <SectionHeading id="results" title="Results" />
              <div className="mt-6">
                <ResultList results={home.results} includesMemberView={home.resultsIncludeMemberView} />
              </div>
            </section>
            <section aria-labelledby="team-news">
              <SectionHeading id="team-news" title="Team News" />
              <div className="mt-6">
                <TeamNews articles={home.teamNews} clubSlug={club.slug} pattern={pattern} />
              </div>
            </section>
          </div>
        )}

        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <TeamsSection groups={home.teamGroups} />
        </div>

        <RugbyHubFeature clubName={club.name} signedIn={home.viewer.signedIn} />

        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <ClubInformation
            club={club}
            contacts={home.contacts}
            partnerAction={
              calendarAccessStatus ? (
                <div className="flex flex-wrap gap-3">
                  <CalendarAccessAction targetClubId={club.id} targetClubName={club.name} status={calendarAccessStatus} />
                  {messagePartnerLink && (
                    <a href={`/partner-clubs/${club.id}`} className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink/70 hover:border-ink/30 hover:text-ink">
                      Message Club
                    </a>
                  )}
                </div>
              ) : undefined
            }
          />
        </div>
      </main>
      <ClubFooter club={club} />
    </ClubThemeScope>
  )
}
