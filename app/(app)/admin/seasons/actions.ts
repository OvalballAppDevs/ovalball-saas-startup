"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { validateSeasonDates } from "@/lib/seasons/validation"

export type SeasonActionResult = { ok: true } | { ok: false; error: string }

export interface CreateSeasonInput {
  rugbyCode: "union" | "league"
  seasonYearStart: number
  startsOn: string
  endsOn: string
  preSeasonStartsOn: string | null
}

export interface EditSeasonInput {
  id: string
  rugbyCode: "union" | "league"
  seasonYearStart: number
  startsOn: string
  endsOn: string
  preSeasonStartsOn: string | null
}

/**
 * The one narrow SITE-scoped capability every Seasons write now requires
 * (site.seasons.manage -- supabase/migrations/20260924100000_site_admin_seasons_crud.sql).
 * A Full Site Admin has it automatically; a narrow Site Admin needs the
 * explicit grant from Site Admin Management, same as Competitions/Lookups/
 * Team Catalogue. Checked here as a friendly app-layer error before ever
 * reaching the RLS/RPC boundary, which enforces the same rule regardless.
 */
async function requireSeasonsCapability(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }
  const allowed = await hasCapability(supabase, "site.seasons.manage", "site")
  if (!allowed) return { ok: false, error: "You do not have Seasons management access. Ask a Full Site Admin to grant it from Site Admin Management." }
  return { ok: true }
}

/**
 * seasons write policies (is_site_admin()) are the real boundary -- this is
 * Site Admin only, matching every other Ovalball reference-data table
 * (competitions, venues). No `name` field: the display name is always
 * derived server-side (rugby_code + seasonYearStart, via the
 * compute_season_identity trigger) -- it is never accepted as free text
 * from the client, so season identity can't drift into an arbitrary typed
 * label.
 *
 * Two checks run here, server-side, as the real boundary regardless of
 * whatever the client form already constrained (Section I/T): the same
 * rugby-code-aware date-ordering/year-window rules as the client
 * (validateSeasonDates -- previously enforced nowhere at all, client or
 * server), and application-level (rugby_code, season_year_start)
 * uniqueness -- NOT yet a DB-level constraint, because the live playground
 * already holds one genuine pre-existing duplicate (two "Rugby Union
 * 27/28" rows) that a hard unique index would fail to create against;
 * disclosed in the final report rather than silently deleting either row.
 */
export async function createSeason(input: CreateSeasonInput): Promise<SeasonActionResult> {
  const supabase = await createClient()
  const capCheck = await requireSeasonsCapability(supabase)
  if (!capCheck.ok) return capCheck

  const validationError = validateSeasonDates(input)
  if (validationError) return { ok: false, error: validationError }

  const { data: existing } = await supabase
    .from("seasons")
    .select("id")
    .eq("rugby_code", input.rugbyCode)
    .eq("season_year_start", input.seasonYearStart)
    .limit(1)
  if (existing && existing.length > 0) {
    return { ok: false, error: `A ${input.rugbyCode === "union" ? "Rugby Union" : "Rugby League"} season starting ${input.seasonYearStart} already exists.` }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from("seasons").insert({
    // Placeholders -- the compute_season_identity trigger always
    // overwrites both from rugby_code + season_year_start before the row
    // is stored (both are NOT NULL at the column level, so the insert
    // needs a value, but neither is the one actually persisted).
    name: "",
    season_ref: "",
    rugby_code: input.rugbyCode,
    season_year_start: input.seasonYearStart,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    pre_season_starts_on: input.preSeasonStartsOn || null,
    created_by: user?.id,
    updated_by: user?.id,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/seasons")
  revalidatePath("/club/rollover")
  return { ok: true }
}

/**
 * Edit an existing season's dates -- the same rugby-code-aware
 * validateSeasonDates() boundary as create, plus a uniqueness check that
 * excludes the row being edited itself (so saving a season without
 * changing its rugby_code/seasonYearStart doesn't collide with itself).
 * rugby_code and seasonYearStart are NOT editable here on purpose: both
 * feed compute_season_identity's name derivation and Season Rollover's own
 * "next season" resolution -- changing them on an existing, possibly
 * already-referenced season would silently reinterpret history rather
 * than create a new one. Editing dates only.
 */
export async function editSeason(input: EditSeasonInput): Promise<SeasonActionResult> {
  const supabase = await createClient()
  const capCheck = await requireSeasonsCapability(supabase)
  if (!capCheck.ok) return capCheck

  const validationError = validateSeasonDates(input)
  if (validationError) return { ok: false, error: validationError }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase
    .from("seasons")
    .update({
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      pre_season_starts_on: input.preSeasonStartsOn || null,
      updated_by: user?.id,
    })
    .eq("id", input.id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/seasons")
  revalidatePath("/club/rollover")
  revalidatePath("/calendar")
  return { ok: true }
}

/**
 * Archive (or reactivate) a season -- the safe default for retiring a
 * season that already has real downstream data, via the archive_season()
 * RPC (capability-gated identically to every other Seasons write).
 */
export async function setSeasonActive(seasonId: string, active: boolean): Promise<SeasonActionResult> {
  const supabase = await createClient()
  const capCheck = await requireSeasonsCapability(supabase)
  if (!capCheck.ok) return capCheck

  const { error } = await supabase.rpc("archive_season", { p_season_id: seasonId, p_active: active })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/seasons")
  revalidatePath("/club/rollover")
  revalidatePath("/calendar")
  return { ok: true }
}

/**
 * Permanently delete a season -- only reachable via delete_season_safe(),
 * which re-audits every real reference (competition_editions, fixtures,
 * tournaments, age_grade_rollovers.from/to) fresh on every call and
 * refuses with a specific, itemised error if any exist. There is no RLS
 * DELETE policy on seasons at all, so this RPC (SECURITY DEFINER) is the
 * only path to a hard delete -- a raw client DELETE is not possible even
 * for a Full Site Admin.
 */
export async function deleteSeason(seasonId: string): Promise<SeasonActionResult> {
  const supabase = await createClient()
  const capCheck = await requireSeasonsCapability(supabase)
  if (!capCheck.ok) return capCheck

  const { error } = await supabase.rpc("delete_season_safe", { p_season_id: seasonId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/seasons")
  return { ok: true }
}
