import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { resolveClubLogoUrl } from "./club-logo"
import { resolvePlayerAgeState, type PlayerAgeState } from "@/lib/players/age-state"

export type ClubRole = Database["public"]["Tables"]["club_memberships"]["Row"]["role"]
export type TeamPermissionValue = Database["public"]["Tables"]["team_permissions"]["Row"]["permission"]

export interface ClubMembershipContext {
  clubId: string
  clubName: string
  clubSlug: string
  clubLogoUrl: string | null
  role: ClubRole
}

export interface TeamPermissionContext {
  teamId: string
  teamDisplayName: string
  clubId: string
  clubName: string
  permission: TeamPermissionValue
}

export type SiteAdminRole = "full" | "fixture_ops" | "club_data" | "user_access" | "message_moderator" | "read_only"

/**
 * One (guardian, player, active team) triple -- the canonical Parent
 * relationship (Master Architecture Pass), deliberately independent of
 * team_permissions. A guardian of a player with two active team
 * memberships produces two of these; a player with two guardians
 * produces two of these per team. Never collapsed into one row per
 * guardian -- each team the player is active on is its own legitimate
 * Parent context (Section 14 of the pass: access to one team must not
 * imply access to another).
 */
export interface GuardianTeamContext {
  playerId: string
  playerFirstName: string
  playerSurname: string
  ageState: PlayerAgeState
  teamId: string
  teamDisplayName: string
  clubId: string
  clubName: string
}

/** The current user's OWN linked player record (if any) and their active team memberships -- the source for a "player" active context, kept fully independent of any Guardian relationship (Section 15: Parent and Player are independent contexts on one account). */
export interface PlayerTeamContext {
  playerId: string
  teamId: string
  teamDisplayName: string
  clubId: string
  clubName: string
  ageState: PlayerAgeState
}

export interface SessionContext {
  user: User
  firstName: string | null
  isSiteAdmin: boolean
  /** The active Site Admin profile, or null when isSiteAdmin is false. Global authority, never inferred from club membership. */
  siteAdminRole: SiteAdminRole | null
  /** Whether this Site Admin has been granted the diagnostic club-viewing capability (see lib/app-context/diagnostic-access.ts). Always false when isSiteAdmin is false. */
  diagnosticClubAccess: boolean
  /** Whether this Site Admin has been granted the Team Directory management capability (manage_team_catalogue) -- a genuine per-person grant, never implied by any Site Admin profile including Full. Always false when isSiteAdmin is false. */
  manageTeamCatalogue: boolean
  /** Whether this Site Admin has been granted the Competition management capability (manage_competitions) -- same per-person-grant pattern as manageTeamCatalogue. Always false when isSiteAdmin is false. */
  manageCompetitions: boolean
  /** Whether this Site Admin has been granted fixture conversation support access (manage_fixture_support) -- same per-person-grant pattern; closes the prior blanket Site-Admin access to every fixture conversation. Always false when isSiteAdmin is false. */
  manageFixtureSupport: boolean
  /** Whether this Site Admin has been granted the global Lookup Administration capability (manage_global_lookups) -- lets them add/edit/deactivate any club's venues/pitches from the Site Admin parent view. Same per-person-grant pattern; every Site Admin can still SELECT this data regardless. Always false when isSiteAdmin is false. */
  manageGlobalLookups: boolean
  /** Every club this user has active club-wide authority at. Usually one. */
  clubMemberships: ClubMembershipContext[]
  /** Every team this user has an explicit team-scoped assignment for. */
  teamPermissions: TeamPermissionContext[]
  /** Every (player, active team) this user is a Guardian of -- the canonical Parent relationship, independent of teamPermissions view_only rows (which remain, unmigrated, as a separate legacy compatibility source -- see active-context.ts). */
  guardianRelationships: GuardianTeamContext[]
  /** This user's OWN linked player record's active team memberships, if any -- the canonical Player relationship, independent of Guardian/teamPermissions. Empty when this user has no linked player row. */
  linkedPlayerTeams: PlayerTeamContext[]
}

/**
 * The single query this entire authenticated app builds its nav, dashboard,
 * and every permission-gated screen from -- one place that turns "who is
 * this session" into the shape every page actually needs, rather than each
 * page re-deriving it from raw membership/permission rows. This is a
 * *read* convenience only: it never grants anything itself, and every
 * mutation still goes through its own RLS policy or SECURITY DEFINER
 * function regardless of what this returns -- a stale or even tampered
 * client render of this context can't bypass the database's own checks.
 */
export async function getSessionContext(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<SessionContext> {
  const [{ data: profile }, { data: siteAdminRow }, { data: memberships }, { data: teamPerms }, { data: guardianRows }, { data: ownPlayerRow }] =
    await Promise.all([
      supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
      supabase.from("site_admins").select("id, admin_role, diagnostic_club_access, manage_team_catalogue, manage_competitions, manage_fixture_support, manage_global_lookups").eq("user_id", user.id).eq("status", "active").maybeSingle(),
      supabase
        .from("club_memberships")
        .select("club_id, role, clubs(slug, logo_storage_path, club_directory(name, logo_storage_path))")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase
        .from("team_permissions")
        .select(
          "team_id, permission, teams(display_name, club_id, clubs(club_directory(name))), club_memberships!inner(user_id, status)"
        )
        .eq("club_memberships.user_id", user.id)
        .eq("club_memberships.status", "active"),
      // Guardian relationships are Guardian -> Player, never Guardian ->
      // Team (Relationship Registry §12) -- team scope is resolved below,
      // one query per player set, purely from player_team_memberships.
      supabase
        .from("guardians")
        .select("player_id, players(id, first_name, surname, date_of_birth)")
        .eq("guardian_user_id", user.id)
        .eq("status", "active"),
      // This user's OWN linked player record, if any -- fully independent
      // of the guardian query above (Section 15: Parent and Player are
      // independent relationships on one account).
      supabase.from("players").select("id, date_of_birth").eq("user_id", user.id).eq("active", true).maybeSingle(),
    ])

  const guardianPlayerIds = (guardianRows ?? []).map((g) => g.player_id)
  const ownPlayerId = ownPlayerRow?.id ?? null
  const allPlayerIdsForTeamLookup = Array.from(new Set([...guardianPlayerIds, ...(ownPlayerId ? [ownPlayerId] : [])]))

  const { data: activeMemberships } =
    allPlayerIdsForTeamLookup.length > 0
      ? await supabase
          .from("player_team_memberships")
          .select("player_id, team_id, teams(display_name, club_id, category, age_group, clubs(club_directory(name)))")
          .in("player_id", allPlayerIdsForTeamLookup)
          .eq("status", "active")
      : { data: [] }

  const guardianRelationships: GuardianTeamContext[] = []
  for (const g of guardianRows ?? []) {
    const player = g.players
    if (!player) continue
    const playerMemberships = (activeMemberships ?? []).filter((m) => m.player_id === g.player_id)
    for (const m of playerMemberships) {
      if (!m.teams) continue
      guardianRelationships.push({
        playerId: g.player_id,
        playerFirstName: player.first_name,
        playerSurname: player.surname,
        ageState: resolvePlayerAgeState(player.date_of_birth, [{ category: m.teams.category as "senior" | "youth" | "colts", ageGroup: m.teams.age_group }]),
        teamId: m.team_id,
        teamDisplayName: m.teams.display_name,
        clubId: m.teams.club_id,
        clubName: m.teams.clubs?.club_directory?.name ?? "Club",
      })
    }
  }

  const linkedPlayerTeams: PlayerTeamContext[] = ownPlayerId
    ? (activeMemberships ?? [])
        .filter((m) => m.player_id === ownPlayerId && m.teams)
        .map((m) => ({
          playerId: ownPlayerId,
          teamId: m.team_id,
          teamDisplayName: m.teams!.display_name,
          clubId: m.teams!.club_id,
          clubName: m.teams!.clubs?.club_directory?.name ?? "Club",
          ageState: resolvePlayerAgeState(ownPlayerRow?.date_of_birth ?? null, [{ category: m.teams!.category as "senior" | "youth" | "colts", ageGroup: m.teams!.age_group }]),
        }))
    : []

  const clubMemberships: ClubMembershipContext[] = (memberships ?? []).map((m) => ({
    clubId: m.club_id,
    clubName: m.clubs?.club_directory?.name ?? "Club",
    clubSlug: m.clubs?.slug ?? "",
    clubLogoUrl: resolveClubLogoUrl(supabase, m.clubs),
    role: m.role,
  }))

  const teamPermissions: TeamPermissionContext[] = (teamPerms ?? []).map((tp) => ({
    teamId: tp.team_id,
    teamDisplayName: tp.teams?.display_name ?? "Team",
    clubId: tp.teams?.club_id ?? "",
    clubName: tp.teams?.clubs?.club_directory?.name ?? "Club",
    permission: tp.permission,
  }))

  return {
    user,
    firstName: profile?.first_name ?? null,
    isSiteAdmin: Boolean(siteAdminRow),
    siteAdminRole: (siteAdminRow?.admin_role as SiteAdminRole | undefined) ?? null,
    diagnosticClubAccess: siteAdminRow?.diagnostic_club_access ?? false,
    manageTeamCatalogue: siteAdminRow?.manage_team_catalogue ?? false,
    manageCompetitions: siteAdminRow?.manage_competitions ?? false,
    manageFixtureSupport: siteAdminRow?.manage_fixture_support ?? false,
    manageGlobalLookups: siteAdminRow?.manage_global_lookups ?? false,
    clubMemberships,
    teamPermissions,
    guardianRelationships,
    linkedPlayerTeams,
  }
}

export function isClubAdminAnywhere(ctx: SessionContext): boolean {
  return ctx.clubMemberships.some((m) => m.role === "CLUB_ADMIN")
}

export function canManageClubFixturesAnywhere(ctx: SessionContext): boolean {
  return ctx.clubMemberships.some((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
}

/**
 * The one club this session has club-wide fixture authority (Club Admin or
 * Fixture Secretary) at, if any. Partner-club relationships, like fixture
 * request groups, are initiated at this level -- never by a team-only
 * Team Admin/Coach, matching club_partnerships_insert_scoped's
 * can_manage_club_fixtures check.
 */
export function manageableClubId(ctx: SessionContext): string | null {
  return ctx.clubMemberships.find((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")?.clubId ?? null
}

/** Teams this user has any explicit write authority over (not view_only). */
export function manageableTeams(ctx: SessionContext): TeamPermissionContext[] {
  return ctx.teamPermissions.filter((tp) => tp.permission !== "view_only")
}

/** Has no club-wide or team-scoped authority anywhere -- a pure viewer. */
export function isViewOnlyEverywhere(ctx: SessionContext): boolean {
  return (
    !ctx.isSiteAdmin &&
    ctx.clubMemberships.every((m) => m.role === "BASIC_USER") &&
    ctx.teamPermissions.length > 0 &&
    ctx.teamPermissions.every((tp) => tp.permission === "view_only")
  )
}
