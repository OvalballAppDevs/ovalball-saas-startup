"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type CreateTeamResult = { ok: true } | { ok: false; error: string }

export interface CreateTeamInput {
  clubId: string
  displayName: string
  category: "senior" | "youth"
  ageGroup: string | null
  squadDesignation: string | null
  gender: "mens" | "womens" | "mixed" | null
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

/**
 * teams.rugby_code must match the club's own club_directory.rugby_code
 * (enforced by a trigger regardless of what this sends), so it's read from
 * the club rather than accepted as free input here -- never a value a
 * client could get out of sync with the club's actual code.
 *
 * squadDesignation matters more than it looks: teams.identity_key is
 * generated from rugby_code:category:age_group:team_number:squad_
 * designation, and the unique(club_id, identity_key) constraint is what
 * stops a genuine duplicate. Two senior teams both left with a null
 * squad_designation (e.g. "Men's 1st" and "Men's 2nd" typed as different
 * display_names only) collide on that constraint and the second insert
 * fails -- squad_designation ("1st", "2nd", "A", "B", ...) is what actually
 * disambiguates them, matching the brief's own "do not assume one team per
 * age group" requirement.
 */
export async function createTeam(input: CreateTeamInput): Promise<CreateTeamResult> {
  const supabase = await createClient()

  const { data: club } = await supabase
    .from("clubs")
    .select("club_directory(rugby_code)")
    .eq("id", input.clubId)
    .maybeSingle()

  const rugbyCode = club?.club_directory?.rugby_code
  if (!rugbyCode) {
    return { ok: false, error: "Could not determine this club's rugby code." }
  }

  const { error } = await supabase.from("teams").insert({
    club_id: input.clubId,
    rugby_code: rugbyCode,
    category: input.category,
    age_group: input.ageGroup,
    squad_designation: input.squadDesignation,
    gender: input.gender,
    display_name: input.displayName,
    slug: slugify(input.displayName),
  })

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "A team with the same category, age group, and squad designation already exists. Add a squad designation (e.g. \"1st\", \"A\") to tell them apart.",
      }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath("/teams")
  return { ok: true }
}
