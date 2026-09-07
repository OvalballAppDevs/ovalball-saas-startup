"use server"

import { revalidatePath } from "next/cache"

import { findCategoryOption, loadTeamCategoryGroups, resolveStructuredFields } from "@/lib/teams/catalog"
import { createClient } from "@/lib/supabase/server"

export type CreateTeamResult = { ok: true } | { ok: false; error: string }

export interface CreateTeamInput {
  clubId: string
  /** Exact label from lib/teams/catalog.ts's TEAM_CATEGORY_GROUPS, e.g. "Under 12 Girls". */
  categoryLabel: string
  /** "B" or "C" for a genuine second/third team at that level; null for the base team. Ignored for senior options (fixed ordinal). */
  squadLetter: string | null
}

/**
 * teams.rugby_code must match the club's own club_directory.rugby_code
 * (enforced by a trigger regardless of what this sends), so it's read from
 * the club rather than accepted as free input here -- never a value a
 * client could get out of sync with the club's actual code.
 *
 * display_name/slug are placeholders: teams_set_display_name_trigger
 * (20260904100000) recomputes them from category/age_group/gender/
 * squad_designation on this same insert, unconditionally -- there is no
 * client-controlled team name anywhere in this path, matching the
 * catalog-only picker in create-team-form.tsx (no free-text field exists
 * to submit one from).
 */
export async function createTeam(input: CreateTeamInput): Promise<CreateTeamResult> {
  const supabase = await createClient()

  // The club's code is resolved FIRST, because it now decides which
  // identities are on the menu at all -- the codes do not regulate the same
  // age grades (RFU Regulation 15.6 gives girls' union rugby four dual age
  // bands, so Girls U13/U15 are not union identities, while league keeps
  // them because the RFL structure is unresearched). Loading the catalogue
  // before knowing the code would validate a submission against a list the
  // club can never legitimately pick from.
  const { data: club } = await supabase
    .from("clubs")
    .select("club_directory(rugby_code)")
    .eq("id", input.clubId)
    .maybeSingle()

  const rugbyCode = club?.club_directory?.rugby_code
  if (!rugbyCode) {
    return { ok: false, error: "Could not determine this club's rugby code." }
  }
  if (rugbyCode !== "union" && rugbyCode !== "league") {
    return { ok: false, error: "Could not determine this club's rugby code." }
  }

  const groups = await loadTeamCategoryGroups(supabase, { rugbyCode })
  const option = findCategoryOption(groups, input.categoryLabel)
  if (!option) {
    return { ok: false, error: "Unrecognised team. Pick one from the list." }
  }
  const fields = resolveStructuredFields(option, option.allowAdditionalSquads ? input.squadLetter : null)

  const { error } = await supabase.from("teams").insert({
    club_id: input.clubId,
    rugby_code: rugbyCode,
    category: fields.category,
    age_group: fields.ageGroup,
    squad_designation: fields.squadDesignation,
    gender: fields.gender,
    display_name: "pending",
    slug: "pending",
  })

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: `${input.categoryLabel} already exists for this club. Refreshing the page will show its current status.`,
      }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath("/teams")
  return { ok: true }
}
