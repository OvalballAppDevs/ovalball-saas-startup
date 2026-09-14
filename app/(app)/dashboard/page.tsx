import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { CalendarDays, Inbox } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { ClubDeskHeader, ClubRail, PinnedNotices, YourClubs } from "@/components/club-home/club-desk"
import { ClubThemeScope } from "@/components/club-home/primitives"
import { ACTIVE_CONTEXT_COOKIE, isFamilyFacingContext, resolveActiveContext, type SwitchableContext } from "@/lib/app-context/active-context"
import { buildNavItems } from "@/lib/app-context/build-nav-items"
import { getDashboardData, type FixtureRow, type PendingRequestRow } from "@/lib/app-context/dashboard-data"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getCommercialCardsData, getReferralIntelligenceData } from "@/lib/app-context/commercial-intelligence-data"
import { getSiteAdminDashboardData } from "@/lib/app-context/site-admin-dashboard-data"
import { loadClubDesk, loadFamilyClubs } from "@/lib/club-public/club-desk"
import { distinctClubIds, splitDeskNotices } from "@/lib/club-public/desk"
import { matchDateParts } from "@/lib/club-public/format"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { createClient } from "@/lib/supabase/server"

import { FamilyAvatar } from "@/components/profile/family-avatar"

import { FamilyPanel } from "./family-panel"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { PlayerMovementsLog } from "./player-movements-log"
import { SiteAdminDashboard } from "./site-admin-dashboard"

export const metadata = { title: "Dashboard" }

function greeting(): string {
  // The club's time, not the server's: a UTC server says "Good morning" at 12:30 in a British summer.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(new Date()))
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // One route, two dashboards, composed by context -- never a second route.
  //
  // The active context decides PRESENTATION only. Authority comes from
  // requireActiveSiteAdmin, which re-derives Site Admin status from the
  // real site_admins table on this request, and every RPC behind
  // getSiteAdminDashboardData authorizes again in the database. A tampered
  // context cookie therefore changes nothing: resolveActiveContext only
  // ever returns contexts the session genuinely holds, and even if it
  // somehow did not, this check and then the database would both refuse.
  //
  // A Site Admin running a diagnostic session is deliberately NOT caught
  // here: resolveDiagnosticClub gives them a synthetic *club* context
  // below, which is the whole point of diagnostic mode.
  if (activeContext.kind === "site_admin") {
    const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
    if (!activeSiteAdmin.ok || !activeSiteAdmin.ctx.siteAdminRole) {
      redirect("/dashboard?context=cleared")
    }

    const canViewCommercial = await hasCapability(supabase, "site.commercial.view", "site")

    const [data, badgeState, commercialCards, referralIntelligence] = await Promise.all([
      getSiteAdminDashboardData(supabase),
      getBetaBadgeState(supabase),
      canViewCommercial ? getCommercialCardsData(supabase) : Promise.resolve(null),
      canViewCommercial ? getReferralIntelligenceData(supabase) : Promise.resolve(null),
    ])

    return (
      <SiteAdminDashboard
        firstName={ctx.firstName ?? null}
        data={data}
        badgeState={badgeState}
        commercialCards={commercialCards}
        referralIntelligence={referralIntelligence}
      />
    )
  }

  const { roleLabel } = buildNavItems(ctx, activeContext)

  // A diagnostic session (see diagnostic-access.ts) overrides the
  // dashboard's own scope with a synthetic club context -- never the real
  // activeContext used for nav/permissions, which stays the Site Admin's
  // own. This is what makes the body show the diagnostic club's read-only
  // "This week"/"Requests" instead of the Site Admin's real (usually
  // absent) club data, while the sidebar keeps showing their real
  // identity and the admin console nav untouched.
  const diagnosticClub = ctx.isSiteAdmin
    ? await resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null)
    : null
  const dashboardContext: SwitchableContext = diagnosticClub
    ? {
        key: `diagnostic:${diagnosticClub.clubId}`,
        kind: "club",
        id: diagnosticClub.clubId,
        playerId: null,
        label: diagnosticClub.clubName,
        switcherLabel: diagnosticClub.clubName,
        roleLabel: "Site Admin (Diagnostic)",
        logoUrl: diagnosticClub.clubLogoUrl,
        clubId: diagnosticClub.clubId,
      }
    : activeContext
  const displayRoleLabel = diagnosticClub ? dashboardContext.roleLabel : roleLabel
  // The club desk: this club's home, inside the dashboard. Loaded beside the
  // dashboard's own data, never instead of it. A family view spans clubs and
  // is deliberately not scoped to one (see active-context-rules), so it lists
  // its clubs rather than wearing one club's colours.
  const deskTeamId = dashboardContext.kind === "team" ? dashboardContext.id : null
  // A plain club membership has no "operate as" context (active-context-rules),
  // so such a member lands on the context-less fallback. The club home is
  // ambient -- reading, not operating -- so a member of exactly one club still
  // sees that club's desk, and a member of several gets the list of clubs.
  // Presentation only: every read below is still decided by RLS.
  const ambientClubIds = dashboardContext.key === "none" ? distinctClubIds(ctx.clubMemberships) : []
  const deskClubId = dashboardContext.clubId ?? (ambientClubIds.length === 1 ? ambientClubIds[0] : null)
  const listedClubIds = dashboardContext.kind === "family" ? distinctClubIds(ctx.guardianRelationships) : ambientClubIds.length > 1 ? ambientClubIds : []
  const [data, desk, familyClubs] = await Promise.all([
    getDashboardData(supabase, ctx, dashboardContext),
    deskClubId ? loadClubDesk(supabase, deskClubId, deskTeamId) : Promise.resolve(null),
    loadFamilyClubs(supabase, listedClubIds),
  ])
  const notices = desk ? splitDeskNotices(desk.notices) : { pinned: [], rail: [] }

  // A cancelled fixture or a holiday block is on the week's list, but it is not a match anyone is playing.
  const next = data.thisWeekFixtures.find((f) => f.status !== "Cancelled" && f.status !== "Annual Holiday") ?? null
  const nextParts = next ? matchDateParts(next.kickoffDate) : null
  const nextMatch =
    next && nextParts
      ? {
          label: `${next.teamDisplayName} v ${next.opposition}`,
          when: `${nextParts.weekday} ${nextParts.day} ${nextParts.month}${next.kickoffTime ? `, ${next.kickoffTime.slice(0, 5)}` : ""}${next.homeAway ? `, ${next.homeAway}` : ""}`,
          href: `/fixtures/${next.id}`,
        }
      : null
  // Who the viewer is at this club: the team (when it is not the club itself) and their role.
  const contextLine = [dashboardContext.key !== "none" && dashboardContext.label !== desk?.club.name ? dashboardContext.label : null, displayRoleLabel].filter(Boolean).join(", ")

  const work = (
    <>
      <PinnedNotices notices={notices.pinned} />

      {/* One coherent family section for Guardian/Player contexts, reading
          the same canonical loader the agenda uses so the two can never
          disagree about what is outstanding. */}
      {isFamilyFacingContext(dashboardContext.kind) && (
        <FamilyPanel
          supabase={supabase}
          ctx={ctx}
          activeContext={dashboardContext}
          // Passed explicitly rather than inferred from the route or the
          // context kind, so a shared component is never left guessing whose
          // dashboard it is on.
          isGuardian={ctx.guardianRelationships.length > 0}
        />
      )}

      {dashboardContext.kind === "parent" && dashboardContext.playerId && (
        <Link href={`/parent/players/${dashboardContext.playerId}/access`} className="mt-2 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Manage what {dashboardContext.label} can see and do
        </Link>
      )}
      {/*
        Only for somebody who actually guardians a child. It used to render for
        every context that was not Site Admin, which meant an adult managing
        their OWN player profile was offered "Your children" -- an adult who
        has none is being told they have some, and an adult who does have some
        is being shown a parent control inside a player context. Guardianship
        is a real relationship, so the condition is that relationship rather
        than "not an administrator".
      */}
      {ctx.guardianRelationships.length > 0 && dashboardContext.kind !== "player" && (
        <Link href="/parent/children" className="mt-2 block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Your children
        </Link>
      )}

      {/* Requests come before the week: they are the part that is waiting on this person. */}
      {data.outstandingRequests.length > 0 && (
        <section className="mt-10 first:mt-0">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Requests</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {data.outstandingRequests.map((r) => (
              <RequestListRow key={r.id} request={r} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">This Week</h2>
          <Link href="/calendar" className="inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            View Calendar
          </Link>
        </div>

        {data.thisWeekFixtures.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5 text-ink-muted" />}
            title="Nothing scheduled this week"
            body="Fixtures for your team(s) in the next 7 days will show up here."
          />
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {data.thisWeekFixtures.map((f) => (
              <FixtureListRow key={f.id} fixture={f} />
            ))}
          </ul>
        )}
      </section>

      {data.recentPlayerMovements.length > 0 && dashboardContext.clubId && (
        <PlayerMovementsLog clubId={dashboardContext.clubId} rows={data.recentPlayerMovements} />
      )}

      {data.outstandingRequests.length === 0 && data.myTeamCount === 0 && (
        <section className="mt-10">
          <EmptyState
            icon={<Inbox className="size-5 text-ink-muted" />}
            title="No team assigned yet"
            body="Once you have a team or club role, its fixtures and requests will appear here."
          />
        </section>
      )}
    </>
  )

  if (desk) {
    return (
      <ClubThemeScope theme={desk.club.theme} className="min-h-0 bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
          <ClubDeskHeader club={desk.club} greeting={`${greeting()}, ${ctx.firstName ?? "there"}`} contextLine={contextLine} nextMatch={nextMatch} />
          <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
            <div className="min-w-0 [&>section:first-child]:mt-0">{work}</div>
            <aside aria-label="Club news and notices" className="min-w-0">
              <ClubRail desk={desk} notices={notices.rail} />
            </aside>
          </div>
        </div>
      </ClubThemeScope>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
        {greeting()}, {ctx.firstName ?? "there"}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {/* All Children is not a club, so it must not wear a club crest.
            Rendered through ClubAvatar it came out as a crest-shaped tile
            reading "AL" -- the initials of the words "All Children" -- which
            reads as an organisation the family belongs to. */}
        {dashboardContext.kind === "family" ? (
          <FamilyAvatar className="size-12" />
        ) : (
          dashboardContext.kind !== "site_admin" && <ClubAvatar logoUrl={dashboardContext.logoUrl} name={data.clubDisplayName} size="md" />
        )}
        <h1 className="font-display text-display-l text-ink">{data.clubDisplayName}</h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{displayRoleLabel}</p>
      <div className={familyClubs.length ? "mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10" : "mt-8"}>
        <div className="min-w-0 max-w-4xl [&>section:first-child]:mt-0">{work}</div>
        {familyClubs.length > 0 && (
          <aside aria-label="Your clubs" className="min-w-0">
            <YourClubs clubs={familyClubs} />
          </aside>
        )}
      </div>
    </div>
  )
}

function FixtureListRow({ fixture }: { fixture: FixtureRow }) {
  const statusClass = FIXTURE_STATUS_BADGE_CLASS[fixture.status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/5 text-ink/60"
  const parts = matchDateParts(fixture.kickoffDate)
  const dateLabel = `${parts.weekday} ${parts.day} ${parts.month}`

  // A holiday block sits on the week's list but is not a match, so it has no
  // Match Centre to open. Every real fixture -- a cancelled one included, which
  // Match Centre explains -- opens it.
  const opensMatchCentre = fixture.status !== "Annual Holiday"
  const rowClass = "flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5"
  const content = (
    <>
      <div className="min-w-[6rem] shrink-0">
        <p className="text-sm font-medium text-ink">{dateLabel}</p>
        {fixture.kickoffTime && <p className="text-xs text-ink-muted">{fixture.kickoffTime.slice(0, 5)}</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {fixture.teamDisplayName} <span className="text-ink-muted">v</span> {fixture.opposition}
        </p>
        <p className="text-xs text-ink-muted">
          {fixture.homeAway}
          {fixture.venueAddress ? `, ${fixture.venueAddress}` : ""}
        </p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>{fixture.status}</span>
      {fixture.needsAction && (
        <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive-text">
          Action needed
        </span>
      )}
    </>
  )

  return (
    <li>
      {opensMatchCentre ? (
        <Link href={`/fixtures/${fixture.id}`} className={`${rowClass} outline-none transition-colors hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400`}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  )
}

function RequestListRow({ request }: { request: PendingRequestRow }) {
  const date = request.proposedDate ? new Date(request.proposedDate + "T00:00:00") : null
  const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          request.direction === "incoming" ? "bg-pitch-600/15 text-forest-900" : "bg-ink/5 text-ink/60"
        }`}
      >
        {request.direction === "incoming" ? "Received" : "Sent"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {request.teamDisplayName} <span className="text-ink-muted">v</span> {request.opponentText}
        </p>
        <p className="text-xs text-ink-muted">
          {dateLabel} · {request.venuePreference}
        </p>
      </div>
      <Link
        href="/fixtures"
        className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
      >
        Review
      </Link>
    </li>
  )
}

function EmptyState({
  icon,
  title,
  body,
  actionHref,
  actionLabel,
}: {
  icon: React.ReactNode
  title: string
  body: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6">
      {icon}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{body}</p>
      </div>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
