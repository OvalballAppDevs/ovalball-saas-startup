import { notFound } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"

import { ClubAvatar } from "@/components/club/club-avatar"
import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { canManageClubFixturesAnywhere, getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { CalendarAccessAction } from "./calendar-access-action"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Rugby Union", league: "Rugby League" }
const CONTACT_ROLE_LABEL: Record<string, string> = {
  fixture_secretary: "Fixture Secretary",
  minis_secretary: "Minis Secretary",
  general: "General enquiries",
}

/**
 * Public, unauthenticated-safe -- every field selected below is already
 * publicly readable per existing RLS (clubs_select_active /
 * club_contacts_select / teams_select_active / fixtures_select_all), never
 * a service-role bypass. Deliberately does NOT show people/roles, claims,
 * fixture negotiation detail, private fixture messages, or internal notes
 * -- those stay inside the authenticated app regardless of what this
 * page's own queries could technically reach. Visibility toggles
 * (clubs.show_website/show_home_ground/show_address/show_postcode) are
 * Site-Admin/Club-Admin-controlled opt-in/opt-out settings, defaulting to
 * privacy-conscious.
 */
export default async function PublicClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: club } = await supabase
    .from("clubs")
    .select(
      "id, bio, website, facebook_url, address_display, logo_storage_path, show_website, show_home_ground, show_address, show_postcode, club_directory(name, town, county, nation, home_ground, rugby_code, postcode, logo_storage_path)"
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle()

  if (!club) notFound()

  const today = new Date().toISOString().slice(0, 10)

  const [{ data: contacts }, { data: teams }, { data: fixtures }] = await Promise.all([
    supabase.from("club_contacts").select("role, name, phone, email").eq("club_id", club.id).eq("is_public", true),
    supabase.from("teams").select("id, display_name, category, age_group").eq("club_id", club.id).eq("active", true).order("category").order("age_group"),
    supabase
      .from("fixtures")
      .select("id, kickoff_date, kickoff_time, home_away, raw_opposition_text, owning_team_id, teams!fixtures_owning_team_id_fkey(club_id, display_name)")
      .eq("status", "Booked")
      .gte("kickoff_date", today)
      .order("kickoff_date")
      .limit(10),
  ])

  // fixtures_select_all grants anon SELECT on the whole table (no
  // club-scoping in RLS), so this club's own fixtures are filtered here,
  // app-side, from a safe field list only -- never notes/venue_address/
  // pitch_allocation/changing_room/confirmation flags.
  const clubFixtures = (fixtures ?? []).filter((f) => f.teams?.club_id === club.id)

  const logoUrl = resolveClubLogoUrl(supabase, club)

  const directory = club.club_directory

  // Authenticated-and-authorized-only actions -- never for an anonymous
  // visitor, a Parent/Player/Coach, or an unrelated Team Admin. Reuses the
  // same club_partnerships architecture the authenticated Partner Clubs
  // page already relies on.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let calendarAccessStatus: "none" | "pending" | "active" | "revoked" | null = null
  let viewerClubId: string | null = null
  let messagePartnerLink = false
  if (user) {
    const ctx = await getSessionContext(supabase, user)
    if (canManageClubFixturesAnywhere(ctx)) {
      const cookieStore = await cookies()
      const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
      // No `?? manageableClubId(ctx)` fallback -- the partnership-request
      // CTA below must reflect the club the viewer is actually acting
      // through, never whichever club-wide authority happens to be first
      // in their session.
      viewerClubId = activeManageableClubId(ctx, activeContext)
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

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-12 md:px-8 md:py-16">
        <div className="flex items-start gap-5">
          <ClubAvatar logoUrl={logoUrl} name={directory?.name ?? "Club"} size="lg" />
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
              {directory ? RUGBY_CODE_LABEL[directory.rugby_code] ?? directory.rugby_code : ""}
            </p>
            <h1 className="mt-1 font-display text-display-l text-ink">{directory?.name}</h1>
            <p className="mt-1 text-sm text-ink/50">
              {[directory?.town, directory?.county, directory?.nation].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>

        {club.bio && <p className="mt-8 max-w-xl text-base text-ink/70">{club.bio}</p>}

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          {club.show_website && club.website && (
            <a href={club.website} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Website
            </a>
          )}
          {club.facebook_url && (
            <a href={club.facebook_url} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Facebook
            </a>
          )}
        </div>

        {(viewerClubId || calendarAccessStatus) && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {calendarAccessStatus && (
              <CalendarAccessAction targetClubId={club.id} targetClubName={directory?.name ?? "this club"} status={calendarAccessStatus} />
            )}
            {messagePartnerLink && (
              <Link
                href={`/partner-clubs/${club.id}`}
                className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Message club
              </Link>
            )}
          </div>
        )}

        {(club.show_home_ground && directory?.home_ground) || (club.show_address && club.address_display) || (club.show_postcode && directory?.postcode) ? (
          <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Home ground</p>
            {club.show_home_ground && directory?.home_ground && <p className="mt-1.5 text-sm font-medium text-ink">{directory.home_ground}</p>}
            {club.show_address && club.address_display && <p className="mt-0.5 text-sm text-ink/60">{club.address_display}</p>}
            {club.show_postcode && directory?.postcode && <p className="mt-0.5 text-sm text-ink/60">{directory.postcode}</p>}
          </div>
        ) : null}

        {teams && teams.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Teams</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {teams.map((t) => (
                <li key={t.id} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/75">
                  {t.display_name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {clubFixtures.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Upcoming fixtures</p>
            <ul className="mt-3 flex flex-col gap-2">
              {clubFixtures.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {f.teams?.display_name} {f.home_away === "Home" ? "vs" : f.home_away === "Away" ? "at" : "v"} {f.raw_opposition_text}
                    </p>
                    <p className="text-xs text-ink/45">
                      {formatDate(f.kickoff_date)}
                      {f.kickoff_time ? ` · ${f.kickoff_time.slice(0, 5)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contacts && contacts.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Contact</p>
            <ul className="mt-3 flex flex-col gap-2">
              {contacts.map((c, i) => (
                <li key={i} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                  <p className="text-sm font-medium text-ink">
                    {c.name} <span className="text-ink/40">&middot; {CONTACT_ROLE_LABEL[c.role] ?? c.role}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink/60">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
