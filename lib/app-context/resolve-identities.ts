import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { resolvePersonalAvatarUrl } from "./personal-avatar"

export interface ParticipantIdentity {
  name: string
  roleLabel: string
  clubName: string
  clubId: string | null
  avatarUrl: string | null
}

const CLUB_ROLE_LABEL: Record<string, string> = { CLUB_ADMIN: "Club Admin", FIXTURE_SECRETARY: "Fixture Secretary" }
const TEAM_PERMISSION_LABEL: Record<string, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  manager: "Manager",
  view_only: "Parent/Player",
}

/**
 * "Sarah Jones, Fixture Secretary, Burnley RUFC" -- never an email address.
 * Scoped to exactly the club(s)/team(s) actually party to this
 * conversation, so a person's OTHER club/team roles never leak into a
 * conversation they aren't relevant to.
 */
export async function resolveParticipantIdentities(
  supabase: SupabaseClient<Database>,
  userIds: string[],
  clubIds: string[],
  teams: { id: string; displayName: string; clubName: string; clubId?: string }[]
): Promise<Map<string, ParticipantIdentity>> {
  const uniqueUserIds = Array.from(new Set(userIds))
  const uniqueClubIds = Array.from(new Set(clubIds))
  const teamIds = teams.map((t) => t.id)

  // profiles_select_self_or_admin restricts a direct table SELECT to "your
  // own row, or a Site Admin" -- an ordinary club user resolving OTHER
  // people's names needs the SECURITY DEFINER path instead, scoped to the
  // clubs actually party to this conversation (see the migration comment
  // on get_conversation_participant_names for the full story).
  const [{ data: profiles }, { data: memberships }, { data: teamPerms }] = await Promise.all([
    uniqueClubIds.length > 0 && uniqueUserIds.length > 0
      ? supabase.rpc("get_conversation_participant_names", { p_user_ids: uniqueUserIds, p_club_ids: uniqueClubIds })
      : Promise.resolve({
          data: [] as { user_id: string; first_name: string | null; surname: string | null; avatar_storage_path: string | null }[],
        }),
    uniqueClubIds.length > 0
      ? supabase
          .from("club_memberships")
          .select("user_id, club_id, role, clubs(club_directory(name))")
          .in("user_id", uniqueUserIds)
          .in("club_id", uniqueClubIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] as never[] }),
    teamIds.length > 0
      ? supabase
          .from("team_permissions")
          .select("team_id, permission, club_memberships!inner(user_id, status)")
          .in("team_id", teamIds)
          .eq("club_memberships.status", "active")
      : Promise.resolve({ data: [] as never[] }),
  ])

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user"])
  )
  const avatarUrlById = new Map((profiles ?? []).map((p) => [p.user_id, resolvePersonalAvatarUrl(supabase, p.avatar_storage_path)]))

  const result = new Map<string, ParticipantIdentity>()

  for (const userId of uniqueUserIds) {
    const name = nameById.get(userId) ?? "Ovalball user"
    const avatarUrl = avatarUrlById.get(userId) ?? null

    const clubMembership = (memberships ?? []).find((m) => m.user_id === userId)
    if (clubMembership) {
      result.set(userId, {
        name,
        roleLabel: CLUB_ROLE_LABEL[clubMembership.role] ?? clubMembership.role,
        clubName: clubMembership.clubs?.club_directory?.name ?? "Ovalball",
        clubId: clubMembership.club_id,
        avatarUrl,
      })
      continue
    }

    const teamPerm = (teamPerms ?? []).find((tp) => tp.club_memberships?.user_id === userId)
    if (teamPerm) {
      const team = teams.find((t) => t.id === teamPerm.team_id)
      result.set(userId, {
        name,
        roleLabel: TEAM_PERMISSION_LABEL[teamPerm.permission] ?? teamPerm.permission,
        clubName: team?.clubName ?? "Ovalball",
        clubId: team?.clubId ?? null,
        avatarUrl,
      })
      continue
    }

    result.set(userId, { name, roleLabel: "Member", clubName: "Ovalball", clubId: null, avatarUrl })
  }

  return result
}
