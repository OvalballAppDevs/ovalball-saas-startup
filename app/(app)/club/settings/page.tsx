import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { Building2, CalendarSync, ChevronRight, MapPin, Users, LayoutGrid } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "./club-settings-nav"

/**
 * Club Settings hub -- Master Architecture Pass "Club Admin Information
 * Architecture" §1: consolidates the formerly-separate top-level Club,
 * Teams, and Lookup Administration nav entries into one coherent
 * destination. This page holds NO canonical data of its own -- it is pure
 * navigation over the three existing pages (/club, /teams, /club/venues),
 * which keep their own data-fetching and mutations exactly as before.
 *
 * Resource scoping (§4, non-negotiable): bound strictly to the ACTIVE
 * context's own club_memberships row for that club, never
 * canManageClubFixturesAnywhere()/isClubAdminAnywhere() (session-wide) and
 * never `ctx.clubMemberships[0]`. A multi-club account's OTHER club
 * membership must never leak into this page merely because it exists
 * somewhere in the session.
 */
export default async function ClubSettingsHubPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  // Canonical Scoped Capability Engine pass (Section 19/20): section
  // visibility now derives from the SAME internal.has_capability()
  // primitive the underlying pages' RLS enforces, via the has_capability
  // RPC -- not a re-derived role check, and NOT a single combined
  // "isClubAdmin" flag either. Each card checks the EXACT capability its
  // own page's entry gate checks, independently -- a Site Admin deny
  // override on club.venues.manage alone must hide the Lookup
  // Administration card without touching Club Profile's visibility, and
  // vice versa (found by live-testing this: an earlier draft gated both
  // off one shared "isClubAdmin" boolean, which correctly reflected the
  // Club-Admin-only default bundle but silently ignored a narrower
  // per-capability deny). club.pitches.manage is the correct proxy for
  // Teams' broader visibility -- it is granted to exactly {Club Admin,
  // Fixture Secretary}, the identical set the historical Teams nav item
  // used, and nothing broader (unlike fixture.view/club.view, which
  // ordinary club members also hold).
  const [canProfile, canVenues, canPitches, canRollover, canPitchAllocation, canPlayerMoves] = clubId
    ? await Promise.all([
        hasCapability(supabase, "club.edit_profile", "club", { clubId }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId }),
        hasCapability(supabase, "fixture.edit", "club", { clubId }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId }),
      ])
    : [false, false, false, false, false, false]
  const canTeams = canProfile || canPitches

  if (!canProfile && !canTeams && !canVenues && !canRollover && !canPitchAllocation) redirect("/dashboard")

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  const sections = [
    canProfile && {
      href: "/club",
      icon: Building2,
      title: "Club Profile",
      description: "Bio, contacts, logo, and club-wide messaging policy.",
    },
    canTeams && {
      href: "/teams",
      icon: Users,
      title: "Teams",
      description: "Create teams, manage combined mini-rugby calendars, and open each team's own settings.",
    },
    canVenues && {
      href: "/club/venues",
      icon: MapPin,
      title: "Lookup Administration",
      description: "This club's venues and pitches -- used throughout fixture creation.",
    },
    canRollover && {
      href: "/club/rollover",
      icon: CalendarSync,
      title: "Season Rollover",
      description: "Review and confirm each team's age-grade progression into the new season.",
    },
    canPitchAllocation && {
      href: "/club/settings/pitch-allocation",
      icon: LayoutGrid,
      title: "Pitch Allocation",
      description: "Automatic allocation, and warm-up/pack-up buffer times around each fixture.",
    },
  ].filter((s): s is { href: string; icon: typeof Building2; title: string; description: string } => Boolean(s))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">{clubName}</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">Everything {clubName} owns and configures, in one place.</p>

      <ClubSettingsNav active="overview" canProfile={canProfile} canTeams={canTeams} canVenues={canVenues} canRollover={canRollover} canPitchAllocation={canPitchAllocation} canPlayerMoves={canPlayerMoves} />

      <ul className="mt-6 flex flex-col gap-2">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <s.icon className="size-5 shrink-0 text-forest-800" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <p className="text-xs text-ink/50">{s.description}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-ink/30" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
