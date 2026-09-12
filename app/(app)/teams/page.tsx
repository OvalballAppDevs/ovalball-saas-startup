import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ChevronRight } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { computeTeamAvailability, loadTeamCategoryGroups, type ExistingClubTeam } from "@/lib/teams/catalog"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { buildDirectory, type DirectoryIdentityRow } from "@/lib/teams/directory-taxonomy"
import { resolveDefaultSeason, type SeasonRow } from "@/lib/calendar/season-window"
import { createClient } from "@/lib/supabase/server"

import type { SchedulingGroup, SchedulingGroupMember } from "../club/actions"
import { ClubSettingsNav } from "../club/settings/club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../club/settings/resolve-nav-capabilities"
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
  const navCaps = await resolveClubSettingsNavCapabilities(supabase, clubId)
  const isClubAdmin = navCaps.canProfile
  if (!navCaps.canTeams) redirect("/dashboard")

  const { data: teams } = clubId
    ? await supabase
        .from("teams")
        .select("id, display_name, category, age_group, squad_designation, gender, active, canonical_team_type_id")
        .eq("club_id", clubId)
        .order("category")
        .order("age_group")
    : { data: [] }

  const canonicalTypeIds = Array.from(new Set((teams ?? []).map((t) => t.canonical_team_type_id).filter((id): id is string => Boolean(id))))
  const { data: canonicalTypeRows } =
    canonicalTypeIds.length > 0
      ? await supabase.from("canonical_team_types").select("id, key, sort_order").in("id", canonicalTypeIds)
      : { data: [] }
  const canonicalKeyById = new Map((canonicalTypeRows ?? []).map((r) => [r.id, r.key]))
  // The Team Directory's own ordering, borrowed rather than re-invented, so a
  // club's list runs in the same sequence Site Admin sees.
  const canonicalSortById = new Map((canonicalTypeRows ?? []).map((r) => [r.id, r.sort_order ?? 0]))

  const teamIds = (teams ?? []).map((t) => t.id)
  const { data: aliasRows } = teamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds) : { data: [] }
  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))

  // The club's rugby code, resolved ONCE and used for two different things
  // below: which team identities may be offered, and which season is current.
  // It gates the Add Team catalogue because the codes do not regulate the
  // same age grades -- RFU Regulation 15.6 defines girls' union rugby as four
  // dual age bands, so Girls U13/U15 are not union identities, while league
  // keeps them (the RFL structure has not been researched, and absence of
  // research is not evidence of absence).
  const { data: clubRow } = clubId ? await supabase.from("clubs").select("directory_id").eq("id", clubId).maybeSingle() : { data: null }
  const { data: clubDirectory } = clubRow ? await supabase.from("club_directory").select("rugby_code").eq("id", clubRow.directory_id).maybeSingle() : { data: null }
  const clubRugbyCode: "union" | "league" | undefined =
    clubDirectory?.rugby_code === "union" || clubDirectory?.rugby_code === "league" ? clubDirectory.rugby_code : undefined

  const groups = await loadTeamCategoryGroups(supabase, { rugbyCode: clubRugbyCode })

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
    currentSeason = resolveDefaultSeason(allSeasons, clubDirectory?.rugby_code ?? null, todayIso)
  }

  const { data: schedulingGroupRows } = clubId && currentSeason
    ? await supabase
        .from("scheduling_groups")
        .select("id, display_tag, alias, active, season_id")
        .eq("club_id", clubId)
        .eq("season_id", currentSeason.id)
        .order("created_at")
    : { data: [] }

  // Membership comes from scheduling_group_membership, which resolves each
  // team's identity IN THE GROUP'S OWN SEASON. Reading teams.display_name here
  // instead described a 26/27 arrangement with 27/28 names, so a valid
  // "U7/U8 Minis" started listing "Under 9 Mixed" the moment the club was
  // progressed and looked like a broken group.
  const groupIds = (schedulingGroupRows ?? []).map((g) => g.id)
  const { data: membershipRows } =
    groupIds.length > 0
      ? await supabase
          .from("scheduling_group_membership")
          .select("group_id, team_id, category, age_group, gender, squad_designation, rugby_code")
          .in("group_id", groupIds)
      : { data: [] }

  const membersByGroupId = new Map<string, SchedulingGroupMember[]>()
  for (const m of membershipRows ?? []) {
    if (!m.group_id || !m.team_id) continue
    const member: SchedulingGroupMember = {
      id: m.team_id,
      displayName: fullTeamLabel({
        category: m.category ?? "youth",
        ageGroup: m.age_group,
        gender: m.gender,
        squadDesignation: m.squad_designation,
        rugbyCode: m.rugby_code,
      }),
      ageGroup: m.age_group,
    }
    membersByGroupId.set(m.group_id, [...(membersByGroupId.get(m.group_id) ?? []), member])
  }

  const schedulingGroups: SchedulingGroup[] = (schedulingGroupRows ?? []).map((g) => ({
    id: g.id,
    displayTag: g.display_tag,
    alias: g.alias,
    active: g.active,
    members: membersByGroupId.get(g.id) ?? [],
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
  //
  // The rugby code is part of the name, not decoration around it: a league
  // club's senior side is Men's Open Age, a union club's is Men's 1st Team.
  // Omitting it here is how this page would quietly disagree with signup and
  // the Team Directory about what the same side is called.
  type TeamRow = {
    id: string
    canonical_team_type_id: string | null
    category: string
    age_group: string | null
    gender: string | null
    squad_designation: string | null
    display_name: string
  }

  function labelInput(t: TeamRow) {
    return {
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: clubRugbyCode ?? null,
      alias: aliasByTeamId.get(t.id) ?? null,
    }
  }

  function teamFullLabel(t: TeamRow): string {
    if (!t.canonical_team_type_id) return t.display_name
    return fullTeamLabel(labelInput(t))
  }

  function teamCompactLabel(t: TeamRow): string {
    if (!t.canonical_team_type_id) return t.display_name
    return compactTeamLabel(labelInput(t))
  }

  // Grouped by the SAME taxonomy Site Admin's Team Directory uses -- Minis,
  // Juniors, Youth, Men's, Women's, Girls -- because a club and the platform
  // are looking at one set of team identities, and two different arrangements
  // of it is two products. A legacy row with no canonical identity has nothing
  // structured to group by, so it is listed on its own below rather than
  // guessed into a section.
  // A primary side leads its own squads: U9, then U9 B, then U9 C. They share
  // one canonical identity, so the directory's sort order cannot separate them
  // and the squad letter has to.
  const groupableTeams = activeTeams
    .filter((t) => t.canonical_team_type_id)
    .sort((a, b) => (a.squad_designation ?? "").localeCompare(b.squad_designation ?? ""))
  const ungroupedTeams = activeTeams.filter((t) => !t.canonical_team_type_id)
  const teamById = new Map(activeTeams.map((t) => [t.id, t]))
  const teamSections = buildDirectory(
    groupableTeams.map<DirectoryIdentityRow>((t) => ({
      id: t.id,
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      isActive: true,
      sortOrder: t.canonical_team_type_id ? (canonicalSortById.get(t.canonical_team_type_id) ?? 0) : 0,
    })),
    clubRugbyCode ?? null,
    new Map(activeTeams.map((t) => [t.id, aliasByTeamId.get(t.id) ?? null]))
  )

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Teams</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        Every real playing side has its own calendar and its own team-scoped roles.
      </p>

      <ClubSettingsNav active="teams" {...navCaps} />

      {activeTeams.length > 0 ? (
        <div className="mt-8 flex flex-col gap-6">
          {teamSections.map(({ group, identities }) => (
            <section key={group.key} aria-labelledby={`teams-${group.key}`}>
              <h2 id={`teams-${group.key}`} className="font-display text-lg text-ink">
                {group.title}
              </h2>
              <ul className="mt-2.5 flex flex-col gap-2">
                {identities.map((identity) => {
                  const t = teamById.get(identity.id)
                  if (!t) return null
                  return (
                    <li key={identity.id}>
                      <Link
                        href={`/teams/${identity.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{identity.display}</p>
                          <p className="text-xs text-ink-muted">{identity.compact}</p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {ungroupedTeams.length > 0 && (
            <section aria-labelledby="teams-unrecognised">
              <h2 id="teams-unrecognised" className="font-display text-lg text-ink">
                Not yet recognised
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                These teams predate the Team Directory, so Ovalball does not know which age grade or pathway they
                belong to. Open one to set it.
              </p>
              <ul className="mt-2.5 flex flex-col gap-2">
                {ungroupedTeams.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/teams/${t.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <p className="min-w-0 truncate text-sm font-medium text-ink">{teamFullLabel(t)}</p>
                      <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">No teams yet</p>
          <p className="mt-1 text-sm text-ink-muted">Add your club&apos;s first team below.</p>
        </div>
      )}

      {isClubAdmin && clubId && (
        <div className="mt-6">
          <CreateTeamForm clubId={clubId} groups={groups} availability={availability} rugbyCode={clubRugbyCode ?? null} />
        </div>
      )}

      {inactiveTeams.length > 0 && (
        <div className="mt-10">
          <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Inactive teams</p>
          <ul className="mt-3 flex flex-col gap-2">
            {inactiveTeams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/teams/${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink/15 bg-ink/[0.02] px-4 py-3.5 outline-none transition-colors hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink/60">{teamFullLabel(t)}</p>
                    <p className="text-xs text-ink-muted">{teamCompactLabel(t)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-ink-muted">Inactive</span>
                    <ChevronRight className="size-4 text-ink-muted" />
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
