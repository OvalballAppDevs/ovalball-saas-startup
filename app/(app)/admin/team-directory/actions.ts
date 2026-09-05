"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export type TeamDirectoryActionResult = { ok: true } | { ok: false; error: string }

export interface CreateTeamTypeInput {
  category: "youth" | "colts" | "senior"
  ageGroup: string | null
  gender: "boys" | "girls" | "mixed" | "mens" | "womens" | null
  fixedSquadDesignation: string | null
  allowsSquads: boolean
}

/**
 * CREATES A GLOBAL CANONICAL TEAM TYPE -- never activates it for any club.
 * create_canonical_team_type is the real boundary (internal.can_manage_
 * team_catalogue(): a Site Admin with the manage_team_catalogue capability
 * specifically, not any Site Admin profile). No free-text name is ever
 * accepted here -- the label is always generated server-side (in the RPC)
 * from these structured fields.
 *
 * Site Admin route-family guard addendum: RLS/the RPC's own can_manage_
 * team_catalogue() check remains the boundary for real authority; this
 * adds the active-context half, which RLS cannot see.
 */
export async function createTeamType(input: CreateTeamTypeInput): Promise<TeamDirectoryActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("create_canonical_team_type", {
    p_category: input.category,
    p_age_group: input.ageGroup as unknown as string,
    p_gender: input.gender as unknown as string,
    p_fixed_squad_designation: input.fixedSquadDesignation as unknown as string,
    p_allows_squads: input.allowsSquads,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/team-directory")
  return { ok: true }
}

export interface TeamTypeImpact {
  clubsAffected: number
  activeTeams: number
  players: number
  guardians: number
  futureFixtures: number
  historicalFixtures: number
}

/**
 * Real impact preview before global deactivation (Section 49) -- fetched
 * fresh every time the confirmation dialog opens, never cached or
 * estimated client-side.
 */
export async function getTeamTypeImpact(id: string): Promise<{ ok: true; impact: TeamTypeImpact } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { data, error } = await supabase.rpc("get_canonical_team_type_impact", { p_id: id }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not load impact." }
  return {
    ok: true,
    impact: {
      clubsAffected: data.clubs_affected,
      activeTeams: data.active_teams,
      players: data.players,
      guardians: data.guardians,
      futureFixtures: data.future_fixtures,
      historicalFixtures: data.historical_fixtures,
    },
  }
}

/**
 * "Deactivate Team Type", never "Delete" -- existing club-team rows and
 * their full history stay completely intact; the type simply disappears
 * from every catalogue-driven picker and can never be newly activated
 * (enforced at the database level, not just here).
 */
export async function deactivateTeamType(id: string): Promise<TeamDirectoryActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("deactivate_canonical_team_type", { p_id: id })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/team-directory")
  return { ok: true }
}
