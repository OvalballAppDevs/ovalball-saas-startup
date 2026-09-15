import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { resolvePlayerAgeState, type PlayerAgeState, type PlayerTeamCategory } from "@/lib/players/age-state"
import type { Database } from "@/types/database.types"

/**
 * Players as club and team staff see them (Identity/Auth Slice 4a, Phase 2 J.6).
 *
 * Staff never read a player's row from `players`: that table answers only the player, their ACTIVE guardians
 * and Ovalball. Staff read `player_staff_view`, which the database fills for exactly the players this person may
 * see at their club or team, with names and an age grade but no date of birth, login id, recorded gender or
 * family details. A surface lists the rows it is about first (team places, call-ups, obligations) and then asks
 * here for the names, so an id the viewer may not see simply has no name.
 */
export interface StaffPlayer {
  id: string
  firstName: string
  surname: string
  displayName: string
  ageGrade: string | null
  isAdult: boolean
  hasDateOfBirth: boolean
  hasPlayingPathway: boolean
  hasLogin: boolean
  avatarStoragePath: string | null
  accountAvatarPath: string | null
}

export async function loadStaffPlayers(supabase: SupabaseClient<Database>, playerIds: Iterable<string | null | undefined>): Promise<Map<string, StaffPlayer>> {
  const ids = Array.from(new Set(Array.from(playerIds).filter((id): id is string => Boolean(id))))
  const players = new Map<string, StaffPlayer>()
  if (ids.length === 0) return players
  const { data, error } = await supabase
    .from("player_staff_view")
    .select("id, first_name, surname, age_grade, is_adult, has_date_of_birth, has_playing_pathway, has_login, avatar_storage_path, account_avatar_path")
    .in("id", ids)
  if (error) {
    console.error("player_staff_view read failed:", error)
    return players
  }
  for (const row of data ?? []) {
    if (!row.id) continue
    players.set(row.id, {
      id: row.id,
      firstName: row.first_name ?? "",
      surname: row.surname ?? "",
      displayName: `${row.first_name ?? ""} ${row.surname ?? ""}`.trim(),
      ageGrade: row.age_grade ?? null,
      isAdult: row.is_adult === true,
      hasDateOfBirth: row.has_date_of_birth === true,
      hasPlayingPathway: row.has_playing_pathway === true,
      hasLogin: row.has_login === true,
      avatarStoragePath: row.avatar_storage_path ?? null,
      accountAvatarPath: row.account_avatar_path ?? null,
    })
  }
  return players
}

/**
 * The canonical minor/adult rule for a player seen through the staff projection: the database has already
 * applied the date of birth; without one, the team fallback in resolvePlayerAgeState still protects youth.
 */
export function staffPlayerAgeState(player: StaffPlayer | undefined, teams: PlayerTeamCategory[]): PlayerAgeState {
  if (player?.hasDateOfBirth) return player.isAdult ? "adult" : "minor"
  return resolvePlayerAgeState(null, teams)
}
