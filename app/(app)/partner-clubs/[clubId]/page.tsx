import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ChevronLeft } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { PartnerAvailability } from "./partner-availability"

export default async function PartnerClubAvailabilityPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId: partnerClubId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- see app/(app)/partner-clubs/page.tsx.
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) redirect("/fixtures")

  // Re-derive "are we actually active partners" server-side rather than
  // trusting the route param -- get_partner_team_availability enforces this
  // itself too, but checking here lets the page show a clear message
  // instead of a silent empty calendar.
  const { data: partnership } = await supabase
    .from("club_partnerships")
    .select("id")
    .eq("status", "active")
    .or(
      `and(requesting_club_id.eq.${clubId},partner_club_id.eq.${partnerClubId}),and(requesting_club_id.eq.${partnerClubId},partner_club_id.eq.${clubId})`
    )
    .maybeSingle()

  const { data: partnerClub } = await supabase
    .from("clubs")
    .select("id, directory_id, club_directory(name)")
    .eq("id", partnerClubId)
    .maybeSingle()

  if (!partnerClub) notFound()

  const { data: partnerTeams } = await supabase
    .from("teams")
    .select("id, display_name")
    .eq("club_id", partnerClubId)
    .eq("active", true)
    .order("display_name")

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/partner-clubs" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Partner clubs
      </Link>
      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Availability</p>
      <h1 className="mt-2 font-display text-display-l text-ink">{partnerClub.club_directory?.name ?? "Partner club"}</h1>

      {!partnership ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">Not an active partner</p>
          <p className="mt-1 text-sm text-ink/55">
            You need an active calendar-sharing agreement with this club before you can see their availability.
          </p>
        </div>
      ) : (partnerTeams ?? []).length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">No teams listed</p>
          <p className="mt-1 text-sm text-ink/55">This club hasn&rsquo;t added any teams yet.</p>
        </div>
      ) : (
        <div className="mt-8">
          <PartnerAvailability
            partnerClubId={partnerClubId}
            partnerClubDirectoryId={partnerClub.directory_id}
            teams={partnerTeams ?? []}
          />
        </div>
      )}
    </div>
  )
}
