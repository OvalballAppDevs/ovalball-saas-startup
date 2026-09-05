import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import type { ClubPitch, ClubVenue } from "../actions"
import { ClubSettingsNav } from "../settings/club-settings-nav"
import { VenuesSection } from "./venues-section"

/**
 * Club Lookup Administration -- one back-office place for club-specific
 * controlled lookup data (Section 2 of the Venue instruction). Venues
 * first, architecture left ready for future lookup types without
 * speculatively building them now. Club Admin only, matching /club's own
 * access boundary -- Fixtures Secretary reads venues/pitches freely via
 * their own RLS (venues_select/club_pitches_select are both open reads)
 * when creating fixtures, but does not reach this settings surface.
 */
export default async function ClubVenuesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)
  // Scoped to the ACTIVE context -- see app/(app)/people/page.tsx for the
  // identical leak this mirrors. Canonical Scoped Capability Engine pass:
  // entry gate now derives from has_capability() (club.venues.manage is
  // Club-Admin-only in the default bundle, matching this page's
  // historical Club-Admin-only boundary exactly -- see the module
  // doc-comment above for why Fixtures Secretary still doesn't reach this
  // settings surface even though club.pitches.manage would let them write).
  const [canManageVenues, canEditProfile, canPitches, canRollover, canPlayerMoves] = activeClub
    ? await Promise.all([
        hasCapability(supabase, "club.venues.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.edit_profile", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId: activeClub }),
      ])
    : [false, false, false, false, false]
  if (!canManageVenues || !activeClub) redirect("/dashboard")
  // profile/pitches/rollover only computed for the shared tab strip's accuracy -- see club-settings-nav.tsx.
  const canTeamsForNav = canEditProfile || canPitches

  const [{ data: venues }, { data: pitches }] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, address, postcode, directions, active, is_default_home")
      .eq("club_id", activeClub)
      .order("name"),
    supabase
      .from("club_pitches")
      .select("id, display_name, description, active, sort_order, venue_id")
      .eq("club_id", activeClub)
      .order("sort_order"),
  ])

  const venueRows: ClubVenue[] = (venues ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    postcode: v.postcode,
    directions: v.directions,
    active: v.active,
    isDefaultHome: v.is_default_home,
  }))

  const pitchRows: (ClubPitch & { venueId: string | null })[] = (pitches ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    description: p.description,
    active: p.active,
    sortOrder: p.sort_order,
    venueId: p.venue_id,
  }))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Lookup Administration</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Venues &amp; Pitches</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Venues are physical locations your club uses; pitches are their own records, each optionally assigned to a
        venue. Fixture Administration reads from this same list everywhere &mdash; deactivate a venue or pitch
        instead of removing it if a fixture already references it.
      </p>

      <ClubSettingsNav active="venues" canProfile={canEditProfile} canTeams={canTeamsForNav} canVenues={canManageVenues} canRollover={canRollover} canPlayerMoves={canPlayerMoves} />

      <div className="mt-8">
        <VenuesSection clubId={activeClub} initialVenues={venueRows} initialPitches={pitchRows} />
      </div>
    </div>
  )
}
