"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

import { requireSiteAdmin } from "../require-site-admin"
import type { Capability, PermissionGroup } from "./types"

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function getCapabilities(): Promise<Capability[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("capabilities").select("key, label, description, category").order("category").order("label")
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

export interface GroupFormInput {
  name: string
  description: string
  scopeType: "club" | "team"
  mapsToRole: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY" | null
  mapsToTeamPermission: "view_only" | "coach" | "manager" | "team_admin" | null
  capabilityKeys: string[]
}

/**
 * A group's mapping (maps_to_role / maps_to_team_permission) must always
 * be one of the small set of real, already-implemented enforcement
 * values -- there is deliberately no way to select anything else, by
 * construction (the form only ever offers these options; the DB check
 * constraint is the second, real backstop). The capability list is
 * accurate documentation of what that value actually grants, never a
 * second enforcement path.
 */
export async function createPermissionGroup(input: GroupFormInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!input.name.trim()) return { ok: false, error: "Name is required." }
  if (input.scopeType === "club" && !input.mapsToRole) return { ok: false, error: "Choose which real access level this group grants." }
  if (input.scopeType === "team" && !input.mapsToTeamPermission) return { ok: false, error: "Choose which real team permission this group grants." }

  const { data: group, error } = await supabase
    .from("permission_groups")
    .insert({
      name: input.name.trim(),
      description: input.description.trim() || null,
      scope_type: input.scopeType,
      maps_to_role: input.scopeType === "club" ? input.mapsToRole : null,
      maps_to_team_permission: input.scopeType === "team" ? input.mapsToTeamPermission : null,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select("id")
    .single()

  if (error || !group) {
    console.error("createPermissionGroup failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  if (input.capabilityKeys.length > 0) {
    const { error: capError } = await supabase
      .from("permission_group_capabilities")
      .insert(input.capabilityKeys.map((key) => ({ group_id: group.id, capability_key: key })))
    if (capError) {
      console.error("createPermissionGroup capabilities failed:", capError)
      return { ok: false, error: toPublicSubmissionError() }
    }
  }

  revalidatePath("/admin/permissions")
  return { ok: true }
}

export interface EditGroupInput {
  groupId: string
  name: string
  description: string
  capabilityKeys: string[]
}

/**
 * Deliberately narrower than create -- name/description/capability
 * documentation may change for ANY group (including system groups, so a
 * Site Admin can correct a label or clarify what it grants), but
 * scope_type/maps_to_role/maps_to_team_permission are never editable here
 * at all, for any group. Remapping what a group actually grants is exactly
 * the kind of change that should require deactivating the old group and
 * creating a new one, not silently changing meaning under existing
 * assignments.
 */
export async function updatePermissionGroup(input: EditGroupInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!input.name.trim()) return { ok: false, error: "Name is required." }

  const { error } = await supabase
    .from("permission_groups")
    .update({ name: input.name.trim(), description: input.description.trim() || null, updated_by: auth.user.id })
    .eq("id", input.groupId)

  if (error) {
    console.error("updatePermissionGroup failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  const { error: deleteError } = await supabase.from("permission_group_capabilities").delete().eq("group_id", input.groupId)
  if (deleteError) {
    console.error("updatePermissionGroup capability clear failed:", deleteError)
    return { ok: false, error: toPublicSubmissionError() }
  }
  if (input.capabilityKeys.length > 0) {
    const { error: insertError } = await supabase
      .from("permission_group_capabilities")
      .insert(input.capabilityKeys.map((key) => ({ group_id: input.groupId, capability_key: key })))
    if (insertError) {
      console.error("updatePermissionGroup capability insert failed:", insertError)
      return { ok: false, error: toPublicSubmissionError() }
    }
  }

  revalidatePath("/admin/permissions")
  return { ok: true }
}

export async function setGroupActive(groupId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from("permission_groups").update({ is_active: isActive, updated_by: auth.user.id }).eq("id", groupId)
  if (error) {
    console.error("setGroupActive failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/permissions")
  return { ok: true }
}

/** Wraps delete_permission_group() -- the only path that may permanently remove a group, blocking on is_system and on any assigned user. */
export async function deletePermissionGroup(groupId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("delete_permission_group", { p_group_id: groupId })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/permissions")
  return { ok: true }
}
