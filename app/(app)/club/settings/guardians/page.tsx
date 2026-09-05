import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { resolvePlayerAgeState } from "@/lib/players/age-state"
import { createClient } from "@/lib/supabase/server"
import { compactTeamLabel } from "@/lib/teams/compact-label"

import { ClubSettingsNav } from "../club-settings-nav"
import { DuplicateReviewRow, type DuplicateReviewData } from "./duplicate-review-row"
import { PendingMembershipRow, type PendingMembershipData } from "./pending-membership-row"
import { PlayerGuardianCard, type PlayerGuardianData } from "./player-guardian-card"

/**
 * The Club Admin's own safeguarding surface (Side Project 1 integration) --
 * Guardian relationship management (remove/replace, Club Admin only) and
 * the staff-side duplicate-player review queue, plus the self-service
 * Add-a-Child pending-membership approval queue. Deliberately lives in
 * Club Settings, never on a per-team page -- Team staff (Coach/Manager/
 * Team Admin) can invite a Guardian and see their own team's roster, but
 * removing a Guardian or resolving a duplicate match is Club-Admin-only
 * authority, matching this page's own club.guardians.manage gate.
 */
export default async function ClubGuardiansPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const [canGuardians, canProfile, canVenues, canPitches, canRollover, canPitchAllocation, canPlayerMoves] = clubId
    ? await Promise.all([
        hasCapability(supabase, "club.guardians.manage", "club", { clubId }),
        hasCapability(supabase, "club.edit_profile", "club", { clubId }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId }),
        hasCapability(supabase, "fixture.edit", "club", { clubId }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId }),
      ])
    : [false, false, false, false, false, false, false]
  if (!clubId || !canGuardians) redirect("/club/settings")
  const canTeams = canProfile || canPitches

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  const { data: teams } = await supabase
    .from("teams")
    .select("id, display_name, category, age_group, gender, squad_designation")
    .eq("club_id", clubId)
    .eq("active", true)

  const teamIds = (teams ?? []).map((t) => t.id)
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]))

  const [{ data: aliasRows }, { data: memberships }, guardianDirectoryResults, { data: duplicateReviews }, { data: pendingMemberships }] = await Promise.all([
    teamIds.length > 0 ? supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds) : Promise.resolve({ data: [] }),
    teamIds.length > 0
      ? supabase.from("player_team_memberships").select("player_id, team_id, players(id, first_name, surname, date_of_birth)").in("team_id", teamIds).eq("status", "active")
      : Promise.resolve({ data: [] }),
    Promise.all(teamIds.map((teamId) => supabase.rpc("get_team_guardian_directory", { p_team_id: teamId }))),
    teamIds.length > 0
      ? supabase
          .from("player_duplicate_reviews")
          .select("id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, players!player_duplicate_reviews_matched_player_id_fkey(first_name, surname, date_of_birth)")
          .in("team_id", teamIds)
          .eq("status", "pending")
      : Promise.resolve({ data: [] }),
    // Self-service Add-a-Child joins awaiting roster approval -- a
    // genuinely separate queue from the duplicate-player review above
    // (this is "is this really a new roster member", not "is this an
    // existing player").
    teamIds.length > 0
      ? supabase.from("player_team_memberships").select("id, player_id, team_id, players(first_name, surname, date_of_birth)").in("team_id", teamIds).eq("status", "pending")
      : Promise.resolve({ data: [] }),
  ])

  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))
  const teamLabel = (teamId: string) => {
    const t = teamById.get(teamId)
    if (!t) return "Team"
    return compactTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, alias: aliasByTeamId.get(teamId) ?? null })
  }

  // Flatten the per-team directory RPC results into one guardian list per
  // player -- a player active on more than one team (rare, but the schema
  // allows it) shows their guardians once, deduped by guardian_id.
  const guardiansByPlayerId = new Map<string, { id: string; name: string; email: string }[]>()
  for (const result of guardianDirectoryResults) {
    for (const row of result.data ?? []) {
      const list = guardiansByPlayerId.get(row.player_id) ?? []
      if (!list.some((g) => g.id === row.guardian_id)) {
        list.push({ id: row.guardian_id, name: [row.guardian_first_name, row.guardian_surname].filter(Boolean).join(" ") || "Unknown", email: row.guardian_email ?? "" })
      }
      guardiansByPlayerId.set(row.player_id, list)
    }
  }

  const players: PlayerGuardianData[] = (memberships ?? [])
    .filter((m) => m.players)
    .map((m) => {
      const team = teamById.get(m.team_id)
      const ageState = resolvePlayerAgeState(m.players!.date_of_birth, team ? [{ category: team.category as "senior" | "youth" | "colts", ageGroup: team.age_group }] : [])
      return {
        playerId: m.players!.id,
        playerName: `${m.players!.first_name} ${m.players!.surname}`,
        teamId: m.team_id,
        teamLabel: teamLabel(m.team_id),
        guardians: guardiansByPlayerId.get(m.players!.id) ?? [],
        // "Orphaned minor -> fail closed, flag GUARDIAN REQUIRED" is
        // specifically about MINORS -- a confirmed adult (or a player on
        // a senior/Senior-Colts team with unknown DOB, never safety-
        // fallback-protected) having zero guardians is normal and
        // expected (an adult manages their own account, no Guardian
        // relationship needed at all), not a safeguarding gap.
        needsGuardian: ageState === "minor" || ageState === "unknown_youth_protected",
      }
    })
    .sort((a, b) => a.playerName.localeCompare(b.playerName))

  const duplicates: DuplicateReviewData[] = (duplicateReviews ?? []).map((r) => ({
    id: r.id,
    teamLabel: teamLabel(r.team_id),
    submittedName: `${r.submitted_first_name} ${r.submitted_surname}`,
    submittedDob: r.submitted_date_of_birth,
    matchedName: r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown",
    matchedDob: r.players?.date_of_birth ?? null,
  }))

  const pendingPlayerIds = (pendingMemberships ?? []).map((m) => m.player_id)
  const guardianNameByPlayerId = new Map<string, string>()
  if (pendingPlayerIds.length > 0) {
    const { data: pendingGuardianLinks } = await supabase.from("guardians").select("player_id, guardian_user_id").in("player_id", pendingPlayerIds).eq("status", "active")
    const guardianUserIds = (pendingGuardianLinks ?? []).map((g) => g.guardian_user_id)
    const { data: guardianProfiles } = guardianUserIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", guardianUserIds) : { data: [] }
    const profileById = new Map((guardianProfiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
    for (const g of pendingGuardianLinks ?? []) {
      guardianNameByPlayerId.set(g.player_id, profileById.get(g.guardian_user_id) || "A parent")
    }
  }

  const pendingRequests: PendingMembershipData[] = (pendingMemberships ?? [])
    .filter((m) => m.players)
    .map((m) => ({
      id: m.id,
      playerName: `${m.players!.first_name} ${m.players!.surname}`,
      playerDob: m.players!.date_of_birth,
      teamLabel: teamLabel(m.team_id),
      guardianName: guardianNameByPlayerId.get(m.player_id) ?? "A parent",
    }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Guardians &amp; Players</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">Guardian relationships and player-record safeguarding for {clubName}.</p>

      <ClubSettingsNav
        active="guardians"
        canProfile={canProfile}
        canTeams={canTeams}
        canVenues={canVenues}
        canRollover={canRollover}
        canPitchAllocation={canPitchAllocation}
        canPlayerMoves={canPlayerMoves}
        canGuardians
      />

      {pendingRequests.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Parent / Guardian requests</h2>
          <p className="mt-1 text-sm text-ink/55">A parent added a child directly and needs the club to confirm their team.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {pendingRequests.map((r) => (
              <PendingMembershipRow key={r.id} request={r} />
            ))}
          </ul>
        </section>
      )}

      {duplicates.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Possible duplicate players</h2>
          <p className="mt-1 text-sm text-ink/55">A parent tried to add a child whose name and date of birth match an existing player at this club. Confirm whether this is the same child.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {duplicates.map((d) => (
              <DuplicateReviewRow key={d.id} review={d} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Players &amp; guardians</h2>
        {players.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">No players yet</p>
            <p className="mt-1 text-sm text-ink/55">Players appear here once a parent accepts a team invitation and adds their child.</p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {players.map((p) => (
              <PlayerGuardianCard key={`${p.playerId}:${p.teamId}`} player={p} clubName={clubName} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
