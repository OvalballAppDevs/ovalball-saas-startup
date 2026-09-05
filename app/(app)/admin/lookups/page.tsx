import { redirect } from "next/navigation"
import { Search, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import type { ClubPitch, ClubVenue } from "../../club/actions"
import { VenuesSection } from "../../club/venues/venues-section"

/**
 * Site Admin's own parent view over the SAME public.venues/public.club_pitches
 * rows Club Admin's own Lookup Administration (/club/venues) manages -- never
 * a duplicate global copy. Reads are already open to every Site Admin
 * (venues_select/club_pitches_select are both `using (true)`); writes need
 * the manage_global_lookups capability (20260919000000), granted per-person
 * from /admin/site-admins and off by default even for a Full Site Admin.
 * VenuesSection itself is reused verbatim -- it only ever trusted the
 * clubId prop it was given, never re-derived one from the session.
 */
export default async function AdminLookupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; clubId?: string }>
}) {
  const { q, clubId } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx

  const trimmedQ = (q ?? "").trim()
  const { data: matchRows } = trimmedQ
    ? await supabase
        .from("club_directory")
        .select("name, clubs!inner(id, slug, status)")
        .ilike("name", `%${trimmedQ}%`)
        .order("name")
        .limit(20)
    : { data: [] as { name: string; clubs: { id: string; slug: string; status: string } | null }[] }

  const matches = (matchRows ?? []).filter((r) => r.clubs)

  let selectedClub: { id: string; name: string; slug: string; status: string } | null = null
  let venueRows: ClubVenue[] = []
  let pitchRows: (ClubPitch & { venueId: string | null })[] = []

  if (clubId) {
    const { data: directoryRow } = await supabase.from("clubs").select("id, slug, status, club_directory(name)").eq("id", clubId).maybeSingle()
    if (directoryRow) {
      selectedClub = {
        id: directoryRow.id,
        slug: directoryRow.slug,
        status: directoryRow.status,
        name: directoryRow.club_directory?.name ?? "Club",
      }

      const [{ data: venues }, { data: pitches }] = await Promise.all([
        supabase
          .from("venues")
          .select("id, name, address, postcode, directions, active, is_default_home")
          .eq("club_id", clubId)
          .order("name"),
        supabase
          .from("club_pitches")
          .select("id, display_name, description, active, sort_order, venue_id")
          .eq("club_id", clubId)
          .order("sort_order"),
      ])

      venueRows = (venues ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        address: v.address,
        postcode: v.postcode,
        directions: v.directions,
        active: v.active,
        isDefaultHome: v.is_default_home,
      }))

      pitchRows = (pitches ?? []).map((p) => ({
        id: p.id,
        displayName: p.display_name,
        description: p.description,
        active: p.active,
        sortOrder: p.sort_order,
        venueId: p.venue_id,
      }))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Lookup Administration</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        A parent view over every club&apos;s venues and pitches &mdash; the same records each club manages for
        itself under its own Lookup Administration.
        {!ctx.manageGlobalLookups && (
          <> You can search and inspect freely; adding, editing, or deactivating requires the Lookups capability, granted from Site Admin Management.</>
        )}
      </p>

      <form method="get" className="mt-6">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink/35" />
          <input
            type="search"
            name="q"
            defaultValue={trimmedQ}
            placeholder="Search for a club by name&hellip;"
            className="h-11 w-full rounded-lg border border-ink/15 bg-white pr-3.5 pl-10 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </label>
      </form>

      {trimmedQ && !selectedClub && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {matches.map((row) => (
            <li key={row.clubs!.id}>
              <a
                href={`/admin/lookups?clubId=${row.clubs!.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink hover:border-pitch-600/40"
              >
                <span className="truncate">{row.name}</span>
                {row.clubs!.status !== "active" && <span className="shrink-0 text-xs text-ink/40 capitalize">{row.clubs!.status}</span>}
              </a>
            </li>
          ))}
          {matches.length === 0 && <p className="text-sm text-ink/45">No claimed clubs match &ldquo;{trimmedQ}&rdquo;.</p>}
        </ul>
      )}

      {selectedClub && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-3">
            <div>
              <p className="text-sm font-medium text-ink">{selectedClub.name}</p>
              {selectedClub.status !== "active" && <p className="text-xs text-ink/40 capitalize">{selectedClub.status}</p>}
            </div>
            <a href="/admin/lookups" className="text-xs text-ink/45 underline underline-offset-2 hover:text-ink/70">
              Choose a different club
            </a>
          </div>
          <div className="mt-6">
            <VenuesSection
              clubId={selectedClub.id}
              initialVenues={venueRows}
              initialPitches={pitchRows}
              readOnly={!ctx.manageGlobalLookups}
            />
          </div>
        </div>
      )}
    </div>
  )
}
