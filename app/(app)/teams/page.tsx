import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ChevronRight } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { computeTeamAvailability, loadTeamCategoryGroups, type ExistingClubTeam } from "@/lib/teams/catalog"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { resolveDefaultSeason, type SeasonRow } from "@/lib/calendar/season-window"
import { createClient } from "@/lib/supabase/server"

import type { SchedulingGroup } from "../club/actions"
import { ClubSettingsNav } from "../club/settings/club-settings-nav"
import { CreateTeamForm } from "./create-team-form"
import { MiniRugbyCalendarsSection } from "./mini-rugby-calendars-section"

export default async function TeamsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? ctx.clubMemberships[0]?.clubId` fallback -- see
  // app/(app)/documents/page.tsx for why (falls back only for Site Admin
  // context, and would otherwise show whichever club happens to be first
  // in the session's membership list).
  const clubId = activeClubId(ctx, activeContext)
  // Club Settings Consolidation pass (§4/§26): bound strictly to the
  // ACTIVE context's own club_memberships row for THIS club, never
  // canManageClubFixturesAnywhere() (session-wide -- would let a Club
  // Admin/Fixture Secretary at a DIFFERENT club reach this page while
  // their active context is a narrower view_only relationship at the
  // club actually being shown). RLS already backstops the underlying
  // `teams` select/update regardless, but the entry gate and data query
  // must agree on which club they're scoped to.
  // Canonical Scoped Capability Engine pass: derived from has_capability()
  // rather than a raw club_memberships.role comparison, so a Site Admin
  // grant/deny override on club.edit_profile/club.pitches.manage for this
  // specific person now correctly changes what this page shows (Section
  // 21: propagation) without this page needing its own re-derivation.
  const [canEditProfile, canPitches, canVenues, canRollover, canPlayerMoves, canGuardians, canSubscriptionConfigure, canSubscriptionViewFinance] = clubId
    ? await Promise.all([
        hasCapability(supabase, "club.edit_profile", "club", { clubId }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId }),
        hasCapability(supabase, "club.guardians.manage", "club", { clubId }),
        hasCapability(supabase, "club.subscription.configure", "club", { clubId }),
        hasCapability(supabase, "club.subscription.view_finance", "club", { clubId }),
      ])
    : [false, false, false, false, false, false, false, false]
  const isClubAdmin = canEditProfile
  const canTeams = isClubAdmin || canPitches
  const canSubscriptions = canSubscriptionConfigure || canSubscriptionViewFinance
  if (!canTeams) redirect("/dashboard")

  const { data: teams } = clubId
    ? await supabase
        .from("teams")
        .select("id, display_name, category, age_group, squad_designation, gender, active, canonical_team_type_id")
        .eq("club_id", clubId)
        .order("category")
        .order("age_group")
    : { data: [] }

  const canonicalTypeIds = Array.from(new Set((teams ?? []).map((t) => t.canonical_team_type_id).filter((id): id is string => Boolean(id))))
  const { data: canonicalTypeRows } = canonicalTypeIds.length > 0 ? await supabase.from("canonical_team_types").select("id, key").in("id", canonicalTypeIds) : { data: [] }
  const canonicalKeyById = new Map((canonicalTypeRows ?? []).map((r) => [r.id, r.key]))

  const teamIds = (teams ?? []).map((t) => t.id)
  const { data: aliasRows } = teamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds) : { data: [] }
  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))

  const groups = await loadTeamCategoryGroups(supabase)

  const existingForAvailability: ExistingClubTeam[] = (teams ?? []).map((t) => ({
    canonicalTypeKey: t.canonical_team_type_id ? (canonicalKeyById.get(t.canonical_team_type_id) ?? null) : null,
    squadDesignation: t.squad_designation,
    active: t.active,
    teamId: t.id,
  }))
  const availability = computeTeamAvailability(groups, existingForAvailability)

  const activeTeams = (teams ?? []).filter((t) => t.active)
  const inactiveTeams = (teams ?? []).filter((t) => !t.active)

  const { data: miniRugbyTeams } = clubId
    ? await supabase.from("teams").select("id, display_name, age_group").eq("club_id", clubId).in("age_group", ["U6", "U7", "U8"]).order("age_group")
    : { data: [] }

  // Section 65: Team Administration's live Mini-Rugby Groups list shows
  // only the CURRENT season's groups -- a past season's group is real
  // history, not clutter to hide, but it belongs under Season Handover's
  // own history view, never mixed into the active list a Club Admin
  // manages day to day. Current season resolved via the exact same
  // resolveDefaultSeason() Calendar itself uses -- never a second,
  // page-local guess at "which season is active".
  let currentSeason: SeasonRow | null = null
  if (clubId) {
    const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", clubId).maybeSingle()
    const { data: directory } = club ? await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle() : { data: null }
    const { data: seasonRows } = await supabase
      .from("seasons")
      .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
      .eq("is_regression_fixture", false)
      .order("starts_on", { ascending: true })
    const allSeasons: SeasonRow[] = (seasonRows ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      seasonRef: s.season_ref,
      rugbyCode: s.rugby_code,
      preSeasonStartsOn: s.pre_season_starts_on,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
    }))
    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    currentSeason = resolveDefaultSeason(allSeasons, directory?.rugby_code ?? null, todayIso)
  }

  const { data: schedulingGroupRows } = clubId && currentSeason
    ? await supabase
        .from("scheduling_groups")
        .select("id, display_tag, alias, active, season_id, scheduling_group_members(teams(id, display_name, age_group))")
        .eq("club_id", clubId)
        .eq("season_id", currentSeason.id)
        .order("created_at")
    : { data: [] }

  const schedulingGroups: SchedulingGroup[] = (schedulingGroupRows ?? []).map((g) => ({
    id: g.id,
    displayTag: g.display_tag,
    alias: g.alias,
    active: g.active,
    members: g.scheduling_group_members.flatMap((m) => (m.teams ? [{ id: m.teams.id, displayName: m.teams.display_name, ageGroup: m.teams.age_group }] : [])),
  }))

  // Section 26-30: ONE canonical display resolver used everywhere, not a
  // page-specific one -- fullTeamLabel/compactTeamLabel (lib/teams/
  // compact-label.ts) are the same functions Calendar/Fixtures/Pitch
  // Allocation already read a team through, so this list can never show a
  // name those surfaces wouldn't also show. Both build the label from the
  // team's own structured fields directly (never a catalogue-membership
  // lookup), which is exactly why they were never vulnerable to the
  // gender-mismatch "U12"/"U12" unmatched-fallback this pass found and
  // fixed live -- only findOptionForFields's strict matching had that
  // failure mode. A legacy row with no canonical_team_type_id at all
  // falls back to its own display_name, since there's no structured
  // identity to derive from.
  function teamFullLabel(t: { id: string; canonical_team_type_id: string | null; category: string; age_group: string | null; gender: string | null; squad_designation: string | null; display_name: string }): string {
    if (!t.canonical_team_type_id) return t.display_name
    return fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, alias: aliasByTeamId.get(t.id) ?? null })
  }

  function teamCompactLabel(t: { id: string; canonical_team_type_id: string | null; category: string; age_group: string | null; gender: string | null; squad_designation: string | null; display_name: string }): string {
    if (!t.canonical_team_type_id) return t.display_name
    return compactTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, alias: aliasByTeamId.get(t.id) ?? null })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Teams</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Every real playing side has its own calendar and its own team-scoped roles.
      </p>

      <ClubSettingsNav active="teams" canProfile={canEditProfile} canTeams={canTeams} canVenues={canVenues} canRollover={canRollover} canPlayerMoves={canPlayerMoves} canGuardians={canGuardians} canSubscriptions={canSubscriptions} />

      {activeTeams.length > 0 ? (
        <ul className="mt-8 flex flex-col gap-2">
          {activeTeams.map((t) => (
            <li key={t.id}>
              <Link
                href={`/teams/${t.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{teamFullLabel(t)}</p>
                  <p className="text-xs text-ink/50">{teamCompactLabel(t)}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink/30" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">No teams yet</p>
          <p className="mt-1 text-sm text-ink/55">Add your club&apos;s first team below.</p>
        </div>
      )}

      {isClubAdmin && clubId && (
        <div className="mt-6">
          <CreateTeamForm clubId={clubId} groups={groups} availability={availability} />
        </div>
      )}

      {inactiveTeams.length > 0 && (
        <div className="mt-10">
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Inactive teams</p>
          <ul className="mt-3 flex flex-col gap-2">
            {inactiveTeams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/teams/${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink/15 bg-ink/[0.02] px-4 py-3.5 outline-none transition-colors hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink/60">{teamFullLabel(t)}</p>
                    <p className="text-xs text-ink/40">{teamCompactLabel(t)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-ink/40">Inactive</span>
                    <ChevronRight className="size-4 text-ink/25" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {clubId && currentSeason && (
        <div className="mt-10 border-t border-ink/10 pt-8">
          <MiniRugbyCalendarsSection
            clubId={clubId}
            seasonId={currentSeason.id}
            seasonName={currentSeason.name}
            eligibleTeams={(miniRugbyTeams ?? []).map((t) => ({ id: t.id, displayName: t.display_name, ageGroup: t.age_group }))}
            initial={schedulingGroups}
          />
        </div>
      )}
    </div>
  )
}
