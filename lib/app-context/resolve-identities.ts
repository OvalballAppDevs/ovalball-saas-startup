import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export interface ParticipantIdentity {
  name: string
  roleLabel: string
  clubName: string
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
  teams: { id: string; displayName: string; clubName: string }[]
): Promise<Map<string, ParticipantIdentity>> {
  const uniqueUserIds = Array.from(new Set(userIds))
  const uniqueClubIds = Array.from(new Set(clubIds))
  const teamIds = teams.map((t) => t.id)

  const [{ data: profiles }, { data: memberships }, { data: teamPerms }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, surname").in("id", uniqueUserIds),
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
    (profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user"])
  )

  const result = new Map<string, ParticipantIdentity>()

  for (const userId of uniqueUserIds) {
    const name = nameById.get(userId) ?? "Ovalball user"

    const clubMembership = (memberships ?? []).find((m) => m.user_id === userId)
    if (clubMembership) {
      result.set(userId, {
        name,
        roleLabel: CLUB_ROLE_LABEL[clubMembership.role] ?? clubMembership.role,
        clubName: clubMembership.clubs?.club_directory?.name ?? "Ovalball",
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
      })
      continue
    }

    result.set(userId, { name, roleLabel: "Member", clubName: "Ovalball" })
  }

  return result
}
