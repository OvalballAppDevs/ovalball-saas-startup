import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export interface MessageFilters {
  dateFrom: string | null
  dateTo: string | null
  clubId: string | null
  teamId: string | null
  conversationType: "fixture" | "request" | null
}

export async function getGlobalMessagePolicy(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.rpc("get_effective_message_policy", { p_club_id: undefined }).single()
  return data
}

export async function getMessageAnalytics(supabase: SupabaseClient<Database>, filters: MessageFilters) {
  const { data } = await supabase
    .rpc("admin_message_analytics", {
      p_date_from: filters.dateFrom ?? undefined,
      p_date_to: filters.dateTo ?? undefined,
      p_club_id: filters.clubId ?? undefined,
      p_team_id: filters.teamId ?? undefined,
      p_conversation_type: filters.conversationType ?? undefined,
    })
    .single()
  return data
}

/**
 * admin_message_overview is already metadata-only (never selects body) --
 * this filters and paginates it client-side of the RPC boundary (plain
 * PostgREST filters on the view), matching the same "reuse the existing
 * safe view" reasoning as the RPC's own comment.
 */
export async function getConversationLog(supabase: SupabaseClient<Database>, filters: MessageFilters, page: number, pageSize: number) {
  let q = supabase.from("admin_message_overview").select("*", { count: "exact" })

  if (filters.dateFrom) q = q.gte("last_activity_at", filters.dateFrom)
  if (filters.dateTo) q = q.lte("last_activity_at", filters.dateTo)
  if (filters.conversationType) q = q.eq("kind", filters.conversationType)
  if (filters.clubId) {
    q = q.or(
      `fixture_owning_club_id.eq.${filters.clubId},fixture_opponent_club_id.eq.${filters.clubId},request_requesting_club_id.eq.${filters.clubId},request_opponent_club_id.eq.${filters.clubId}`
    )
  }
  if (filters.teamId) {
    q = q.or(
      `fixture_owning_team_id.eq.${filters.teamId},fixture_opponent_team_id.eq.${filters.teamId},request_requesting_team_id.eq.${filters.teamId},request_target_team_id.eq.${filters.teamId}`
    )
  }

  q = q.order("last_activity_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
  const { data, count } = await q
  return { rows: data ?? [], count: count ?? 0 }
}

export async function getClubDirectoryOptions(supabase: SupabaseClient<Database>) {
  const { data } = await supabase
    .from("clubs")
    .select("id, club_directory(name)")
    .eq("status", "active")
    .order("id")
  return (data ?? [])
    .map((c) => ({ id: c.id, name: c.club_directory?.name ?? "Unnamed club" }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getTeamOptions(supabase: SupabaseClient<Database>, clubId: string | null) {
  if (!clubId) return []
  const { data } = await supabase.from("teams").select("id, display_name").eq("club_id", clubId).order("display_name")
  return (data ?? []).map((t) => ({ id: t.id, name: t.display_name }))
}
