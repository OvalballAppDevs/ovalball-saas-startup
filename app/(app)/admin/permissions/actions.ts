"use server"

import { createClient } from "@/lib/supabase/server"

import type { Capability, PermissionGroup } from "./types"

export async function getCapabilities(): Promise<Capability[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("capabilities")
    .select("key, label, description, category")
    .eq("status", "ACTIVE")
    .order("category")
    .order("label")
  return (data ?? []).map((c) => ({ key: c.key, label: c.label, description: c.description, category: c.category }))
}

/**
 * One query per group's capability list and assigned-user count would be
 * N+1 at any real scale -- fetched here in two batched follow-up queries
 * instead, matching the same reasoning as admin_user_overview's own
 * LATERAL aggregation (just done in application code since this table set
 * is small enough that a view wasn't worth the added migration surface).
 */
export async function getPermissionGroups(): Promise<PermissionGroup[]> {
  const supabase = await createClient()
  const { data: groups } = await supabase
    .from("permission_groups")
    .select("id, name, description, scope_type, is_system, is_active, maps_to_role, maps_to_team_permission, created_at, updated_at")
    .order("scope_type")
    .order("name")

  if (!groups || groups.length === 0) return []

  const groupIds = groups.map((g) => g.id)
  const [{ data: caps }, { data: clubCounts }, { data: teamCounts }] = await Promise.all([
    supabase.from("permission_group_capabilities").select("group_id, capability_key").in("group_id", groupIds),
    supabase.from("club_memberships").select("assigned_group_id").in("assigned_group_id", groupIds).eq("status", "active"),
    supabase.from("team_permissions").select("assigned_group_id").in("assigned_group_id", groupIds),
  ])

  const capsByGroup = new Map<string, string[]>()
  for (const c of caps ?? []) {
    if (!c.group_id || !c.capability_key) continue
    const list = capsByGroup.get(c.group_id) ?? []
    list.push(c.capability_key)
    capsByGroup.set(c.group_id, list)
  }
  const countByGroup = new Map<string, number>()
  for (const row of [...(clubCounts ?? []), ...(teamCounts ?? [])]) {
    if (!row.assigned_group_id) continue
    countByGroup.set(row.assigned_group_id, (countByGroup.get(row.assigned_group_id) ?? 0) + 1)
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    scopeType: g.scope_type as PermissionGroup["scopeType"],
    isSystem: g.is_system,
    isActive: g.is_active,
    mapsToRole: g.maps_to_role as PermissionGroup["mapsToRole"],
    mapsToTeamPermission: g.maps_to_team_permission as PermissionGroup["mapsToTeamPermission"],
    capabilityKeys: capsByGroup.get(g.id) ?? [],
    assignedCount: countByGroup.get(g.id) ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
  }))
}
