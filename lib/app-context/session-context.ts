import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export type ClubRole = Database["public"]["Tables"]["club_memberships"]["Row"]["role"]
export type TeamPermissionValue = Database["public"]["Tables"]["team_permissions"]["Row"]["permission"]

export interface ClubMembershipContext {
  clubId: string
  clubName: string
  clubSlug: string
  role: ClubRole
}

export interface TeamPermissionContext {
  teamId: string
  teamDisplayName: string
  clubId: string
  clubName: string
  permission: TeamPermissionValue
}

export interface SessionContext {
  user: User
  firstName: string | null
  isSiteAdmin: boolean
  /** Every club this user has active club-wide authority at. Usually one. */
  clubMemberships: ClubMembershipContext[]
  /** Every team this user has an explicit team-scoped assignment for. */
  teamPermissions: TeamPermissionContext[]
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
  const [{ data: profile }, { data: siteAdminRow }, { data: memberships }, { data: teamPerms }] =
    await Promise.all([
      supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
      supabase.from("site_admins").select("id").eq("user_id", user.id).eq("status", "active").maybeSingle(),
      supabase
        .from("club_memberships")
        .select("club_id, role, clubs(slug, club_directory(name))")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase
        .from("team_permissions")
        .select(
          "team_id, permission, teams(display_name, club_id, clubs(club_directory(name))), club_memberships!inner(user_id, status)"
        )
        .eq("club_memberships.user_id", user.id)
        .eq("club_memberships.status", "active"),
    ])

  const clubMemberships: ClubMembershipContext[] = (memberships ?? []).map((m) => ({
    clubId: m.club_id,
    clubName: m.clubs?.club_directory?.name ?? "Club",
    clubSlug: m.clubs?.slug ?? "",
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
    clubMemberships,
    teamPermissions,
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
