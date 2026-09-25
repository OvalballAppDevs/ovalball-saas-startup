import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"

import { applyClubhouseFilter } from "@ovalball/contracts/clubhouse"

import { ClubAvatar } from "@/components/club/club-avatar"
import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { getPartnerClubsMapData } from "./map-data"
import { PartnerClubCard, type ActivePartnerData } from "./partner-club-card"
import { PartnerClubsExplorer } from "./partner-clubs-explorer"
import { PartnershipRequestRow, type PendingPartnershipData } from "./partnership-request-row"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Union", league: "League" }

/**
 * CLUBHOUSE PROGRAMME SECTION 5 CLOSES A REAL DEFECT: this page used to redirect anyone without
 * `club.partners.manage` straight to /fixtures -- including a legitimate team-context Coach or Team
 * Manager, even though the Section 2 web nav entry already promised them a working "Clubhouse" link
 * (`teamClubhouseAccess` in `lib/app-context/build-nav-items.ts`). That made the nav item a dead end in
 * practice. Only a genuine lack of ANY club affiliation (parent/player/site-admin-with-no-club) still
 * redirects away -- everyone else reaches this same page, with `canManagePartnerships` deciding what it
 * shows them, never a second route.
 */
export default async function PartnerClubsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) redirect("/fixtures")
  const teamId = activeContext.kind === "team" ? activeContext.id : null

  // Real club.partners.manage authority (not just "kind === club") -- re-checked here the same way
  // `activeManageableClubId` already does everywhere else, never widened for this page specifically.
  const canManagePartnerships = activeManageableClubId(ctx, activeContext) !== null

  const activePartners: ActivePartnerData[] = []
  const pendingRequests: PendingPartnershipData[] = []

  if (canManagePartnerships) {
    const { data: partnerships } = await supabase
      .from("club_partnerships")
      .select("id, requesting_club_id, partner_club_id, status, requested_at, responded_at, source_fixture_id")
      .or(`requesting_club_id.eq.${clubId},partner_club_id.eq.${clubId}`)
      .neq("status", "revoked")

    const otherClubIds = Array.from(
      new Set((partnerships ?? []).map((p) => (p.requesting_club_id === clubId ? p.partner_club_id : p.requesting_club_id)))
    )

    const { data: otherClubs } =
      otherClubIds.length > 0
        ? await supabase
            .from("clubs")
            .select("id, club_directory(name, town, county, rugby_code)")
            .in("id", otherClubIds)
        : { data: [] }

    const clubInfoById = new Map((otherClubs ?? []).map((c) => [c.id, c.club_directory]))

    for (const p of partnerships ?? []) {
      const otherClubId = p.requesting_club_id === clubId ? p.partner_club_id : p.requesting_club_id
      const info = clubInfoById.get(otherClubId)
      const clubName = info?.name ?? "Unknown club"

      if (p.status === "active") {
        activePartners.push({
          partnershipId: p.id,
          clubId: otherClubId,
          clubName,
          town: info?.town ?? null,
          county: info?.county ?? null,
          rugbyCode: info?.rugby_code ?? "union",
          activeSince: p.responded_at ?? p.requested_at,
        })
      } else if (p.status === "pending") {
        pendingRequests.push({
          id: p.id,
          clubName,
          town: info?.town ?? null,
          direction: p.requesting_club_id === clubId ? "outgoing" : "incoming",
          requestedAt: p.requested_at,
          fromFixture: p.source_fixture_id !== null,
        })
      }
    }

    activePartners.sort((a, b) => a.clubName.localeCompare(b.clubName))
    pendingRequests.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
  }

  const mapClubs = await getPartnerClubsMapData(clubId, teamId)
  // Section 5 TEAM UX: "Partners list may be useful read-only." Built from the SAME shared marker read
  // model club.partners.manage's own map already uses (`get_team_club_partnerships` resolves real
  // status for a team-context viewer -- see map-read-model.ts) -- never a second partnership query.
  const readOnlyPartners = canManagePartnerships ? [] : applyClubhouseFilter(mapClubs, "partners", null).filter((c) => !c.isOwnClub)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Clubhouse</p>
          <h1 className="mt-2 font-display text-display-l text-ink">The Ovalball Rugby Network</h1>
          <p className="mt-2 max-w-lg text-sm text-ink-muted">
            Discover clubs, agree partnerships to compare team availability, and find opposition for a date with
            no fixture yet.
          </p>
        </div>
        <a
          href="/clubhouse/find-fixture"
          className="inline-flex h-11 shrink-0 items-center rounded-lg bg-pitch-600 px-5 text-sm font-medium text-white hover:bg-pitch-700"
        >
          Find a Fixture
        </a>
      </div>

      <div className="max-w-3xl">
        {canManagePartnerships && pendingRequests.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Pending Requests</h2>
            <ul className="mt-4 flex flex-col gap-2">
              {pendingRequests.map((r) => (
                <PartnershipRequestRow key={r.id} request={r} />
              ))}
            </ul>
          </section>
        )}

        {canManagePartnerships ? (
          <section className="mt-10">
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">My Partner Clubs</h2>
            {activePartners.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
                <p className="text-sm font-medium text-ink">No partner clubs yet</p>
                <p className="mt-1 text-sm text-ink-muted">Find a club below and request calendar sharing to get started.</p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {activePartners.map((p) => (
                  <PartnerClubCard key={p.partnershipId} partner={p} />
                ))}
              </div>
            )}
          </section>
        ) : (
          // TEAM UX (Section 5): read-only -- no Request/Accept/Decline/Revoke, since a team-scoped
          // viewer never holds club.partners.manage. "Partner Club" state is real here (Section 5
          // closed the team-context read gap), never a guess.
          <section className="mt-10">
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Partner Clubs</h2>
            {readOnlyPartners.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
                <p className="text-sm font-medium text-ink">Build your rugby network</p>
                <p className="mt-1 text-sm text-ink-muted">Discover clubs in Clubhouse and connect with clubs you regularly play.</p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {readOnlyPartners.map((club) => (
                  <div key={club.directoryId} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-ink/10 bg-white px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <ClubAvatar logoUrl={club.logoUrl} name={club.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{club.name}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {[club.town, club.county].filter(Boolean).join(", ") || "Location unknown"} &middot; {RUGBY_CODE_LABEL[club.rugbyCode] ?? club.rugbyCode}
                        </p>
                      </div>
                    </div>
                    {club.slug && (
                      <Link
                        href={`/club/${club.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-sm font-medium text-forest-800 hover:underline"
                      >
                        View club
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Find a Club</h2>
        <p className="mt-1 max-w-lg text-sm text-ink-muted">
          Every recognised club, whether they&apos;ve joined Ovalball yet or not &mdash; search or filter to find one on the map.
        </p>
        <div className="mt-4">
          <PartnerClubsExplorer clubs={mapClubs} canManagePartnerships={canManagePartnerships} />
        </div>
      </section>
    </div>
  )
}
