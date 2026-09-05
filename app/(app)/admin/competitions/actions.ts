"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export type CompetitionActionResult = { ok: true } | { ok: false; error: string }

export interface CompetitionInput {
  name: string
  description: string | null
  rugbyCode: "union" | "league"
  isNational: boolean
  areaIds: string[]
}

/** Site Admin route-family guard addendum, shared by every export below: internal.can_manage_competitions() (RLS) remains the real boundary for "does this account hold the manage_competitions capability at all"; this adds the active-context half, which RLS cannot see (a Next.js cookie, never written to the database). */
async function requireActiveSiteAdminOrError(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return "You must be signed in."
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return "Site Admin access is required, in an active Site Admin context."
  return null
}

/**
 * CREATES A GLOBAL COMPETITION -- the Competition Directory every club's
 * fixture competition dropdown reads from. create_competition is the real
 * boundary (internal.can_manage_competitions(): a Site Admin with the
 * manage_competitions capability specifically, not any Site Admin
 * profile). Duplicate names for the same rugby code are rejected by a
 * real unique index, not just this action's own check.
 */
export async function createCompetition(input: CompetitionInput): Promise<CompetitionActionResult> {
  const supabase = await createClient()
  const guardError = await requireActiveSiteAdminOrError(supabase)
  if (guardError) return { ok: false, error: guardError }

  const { error } = await supabase.rpc("create_competition", {
    p_name: input.name,
    p_description: input.description as unknown as string,
    p_rugby_code: input.rugbyCode,
    p_is_national: input.isNational,
    p_area_ids: input.areaIds,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/competitions")
  return { ok: true }
}

export async function updateCompetition(id: string, input: Omit<CompetitionInput, "rugbyCode">): Promise<CompetitionActionResult> {
  const supabase = await createClient()
  const guardError = await requireActiveSiteAdminOrError(supabase)
  if (guardError) return { ok: false, error: guardError }

  const { error } = await supabase.rpc("update_competition", {
    p_id: id,
    p_name: input.name,
    p_description: input.description as unknown as string,
    p_is_national: input.isNational,
    p_area_ids: input.areaIds,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/competitions")
  return { ok: true }
}

/**
 * "Deactivate", never "Delete" -- a fixture's existing competition
 * reference stays completely intact; the competition simply disappears
 * from new-fixture selection.
 */
export async function deactivateCompetition(id: string): Promise<CompetitionActionResult> {
  const supabase = await createClient()
  const guardError = await requireActiveSiteAdminOrError(supabase)
  if (guardError) return { ok: false, error: guardError }

  const { error } = await supabase.rpc("deactivate_competition", { p_id: id })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/competitions")
  return { ok: true }
}

/**
 * CREATES A COMPETITION EDITION -- the one and only way a competition
 * becomes selectable in any fixture-creation dropdown (Calendar, Site
 * Admin Fixture Management, CSV import). Creating a competition alone
 * (createCompetition above) never does this -- competition_editions is a
 * distinct per-season row every fixture actually references (see the
 * table's own comment: "Fixtures reference this, not competitions
 * directly"). create_competition_edition is the real boundary
 * (internal.can_manage_competitions()).
 */
export async function createCompetitionEdition(competitionId: string, seasonId: string): Promise<CompetitionActionResult> {
  const supabase = await createClient()
  const guardError = await requireActiveSiteAdminOrError(supabase)
  if (guardError) return { ok: false, error: guardError }

  const { error } = await supabase.rpc("create_competition_edition", { p_competition_id: competitionId, p_season_id: seasonId })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/competitions")
  return { ok: true }
}

export async function deactivateCompetitionEdition(id: string): Promise<CompetitionActionResult> {
  const supabase = await createClient()
  const guardError = await requireActiveSiteAdminOrError(supabase)
  if (guardError) return { ok: false, error: guardError }

  const { error } = await supabase.rpc("deactivate_competition_edition", { p_id: id })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/competitions")
  return { ok: true }
}
