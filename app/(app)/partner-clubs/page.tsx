import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { getPartnerClubsMapData } from "./map-data"
import { PartnerClubCard, type ActivePartnerData } from "./partner-club-card"
import { PartnerClubsExplorer } from "./partner-clubs-explorer"
import { PartnershipRequestRow, type PendingPartnershipData } from "./partnership-request-row"

/**
 * Club-level only -- club_partnerships_select_scoped (can_manage_club_fixtures
 * on either side) means a team-only Team Admin/Coach has no read access to
 * this table at all, matching the "must not gain club-wide calendar-sharing
 * authority merely because they manage one team" requirement. Nav already
 * hides this link from them (build-nav-items.ts); this redirect is the
 * server-side half of the same boundary.
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
  // No `?? manageableClubId(ctx)` fallback -- would show a DIFFERENT
  // club's partner-club list/relationships while an unrelated context is
  // active.
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) redirect("/fixtures")

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

  const activePartners: ActivePartnerData[] = []
  const pendingRequests: PendingPartnershipData[] = []

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

  const mapClubs = await getPartnerClubsMapData(clubId)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Partner Clubs</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Calendar sharing</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">
        Agree calendar sharing with another club to see their team availability and request fixtures directly
        against an open date.
      </p>

      <div className="max-w-3xl">
        {pendingRequests.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Pending requests</h2>
            <ul className="mt-4 flex flex-col gap-2">
              {pendingRequests.map((r) => (
                <PartnershipRequestRow key={r.id} request={r} />
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">My partner clubs</h2>
          {activePartners.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
              <p className="text-sm font-medium text-ink">No partner clubs yet</p>
              <p className="mt-1 text-sm text-ink/55">Find a club below and request calendar sharing to get started.</p>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {activePartners.map((p) => (
                <PartnerClubCard key={p.partnershipId} partner={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Find a club</h2>
        <p className="mt-1 max-w-lg text-sm text-ink/55">
          Every recognised club, whether they&apos;ve joined Ovalball yet or not &mdash; search or filter to find one on the map.
        </p>
        <div className="mt-4">
          <PartnerClubsExplorer clubs={mapClubs} />
        </div>
      </section>
    </div>
  )
}
