import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { RugbyCode } from "./rugby-hub-data"
import type { AgeStage, PositionExplorerBundle, PositionSkill } from "./position-explorer-types"

export type { AgeStage, PositionSummary, PositionSkill, PositionExplorerBundle } from "./position-explorer-types"
export { findPositionByKey, relatedPositionsOf, groupByFamily, POSITION_FAMILY_LABEL } from "./position-explorer-types"

/**
 * Position Explorer server data layer. Reads hub_positions /
 * hub_position_skills / hub_position_relationships / hub_position_age_stage
 * / hub_skills -- schema built and verified in the prior Rugby Hub
 * General-Knowledge slice. Adds no new position model, no second Rugby
 * Code resolver, and no second age resolver: rugby code and regulatory
 * identity both come from getRugbyHubIdentityContext (rugby-hub-data.ts),
 * exactly as Rules/Safeguarding/Player Welfare already use it.
 *
 * One call (getPositionExplorerBundle) fetches everything a code's worth of
 * Position Explorer needs -- positions, their skills, their relationships,
 * and (when a regulatory identity resolved) their age-stage facts -- in a
 * fixed 4 queries regardless of how many positions/skills/relationships
 * exist. Selecting a position on the client is then a pure lookup into this
 * already-fetched bundle (see position-explorer-types.ts, which is safe for
 * a client component to import -- this file, carrying "server-only", is
 * not, even for just a type or a pure function: the bundler pulls in the
 * whole module including that guard the moment anything is imported from
 * it, so shared client-safe pieces live in their own module instead).
 */

type PositionRow = Database["public"]["Tables"]["hub_positions"]["Row"]

function mapPosition(row: PositionRow, ageStage: AgeStage, ageStageNote: string | null) {
  return {
    id: row.id,
    positionKey: row.position_key,
    rugbyCode: row.rugby_code as RugbyCode,
    displayName: row.display_name,
    alternativeNames: row.alternative_names ?? [],
    shirtNumber: row.shirt_number,
    positionFamily: row.position_family,
    purpose: row.purpose,
    roleWithBall: row.role_with_ball,
    roleWithoutBall: row.role_without_ball,
    attackResponsibilities: row.attack_responsibilities,
    defenceResponsibilities: row.defence_responsibilities,
    setPieceResponsibilities: row.set_piece_responsibilities,
    keySkillsSummary: row.key_skills_summary,
    decisionMaking: row.decision_making,
    communication: row.communication,
    developmentPriorities: row.development_priorities,
    commonMistakes: row.common_mistakes,
    strongPerformanceLooksLike: row.strong_performance_looks_like,
    ageGuidanceNote: row.age_guidance_note,
    pitchAnchorX: row.pitch_anchor_x !== null ? Number(row.pitch_anchor_x) : null,
    pitchAnchorY: row.pitch_anchor_y !== null ? Number(row.pitch_anchor_y) : null,
    ageStage,
    ageStageNote,
  }
}

/**
 * regulatoryIdentityId is optional -- explore mode (no resolved team
 * context, or a viewer just browsing the other code) passes null, and
 * every position resolves to UNASSESSED age-stage, which the UI renders as
 * ordinary full exploration (see the migration header for why "unassessed"
 * defaults to normal display rather than a blocked state).
 */
export async function getPositionExplorerBundle(
  supabase: SupabaseClient<Database>,
  rugbyCode: RugbyCode,
  regulatoryIdentityId: string | null
): Promise<PositionExplorerBundle> {
  const { data: positionRows } = await supabase
    .from("hub_positions")
    .select("*")
    .eq("rugby_code", rugbyCode)
    .eq("status", "PUBLISHED")
    .order("pitch_anchor_y", { ascending: true })

  const positionIds = (positionRows ?? []).map((p) => p.id)

  const [{ data: ageStageRows }, { data: skillLinkRows }, { data: relationshipRows }] = await Promise.all([
    regulatoryIdentityId && positionIds.length > 0
      ? supabase
          .from("hub_position_age_stage")
          .select("position_id, stage, stage_note")
          .in("position_id", positionIds)
          .eq("regulatory_identity_id", regulatoryIdentityId)
      : Promise.resolve({ data: [] as { position_id: string; stage: string; stage_note: string | null }[] }),
    positionIds.length > 0
      ? supabase
          .from("hub_position_skills")
          .select("position_id, note, hub_skills(id, skill_key, display_name, summary, detail_content_item_id)")
          .in("position_id", positionIds)
      : Promise.resolve({ data: [] as never[] }),
    positionIds.length > 0
      ? supabase.from("hub_position_relationships").select("position_id, related_position_id").in("position_id", positionIds)
      : Promise.resolve({ data: [] as { position_id: string; related_position_id: string }[] }),
  ])

  const ageStageByPosition = new Map<string, { stage: AgeStage; note: string | null }>()
  for (const row of ageStageRows ?? []) {
    ageStageByPosition.set(row.position_id, { stage: row.stage as AgeStage, note: row.stage_note })
  }

  const positions = (positionRows ?? []).map((row) => {
    const resolved = ageStageByPosition.get(row.id)
    return mapPosition(row, resolved?.stage ?? "UNASSESSED", resolved?.note ?? null)
  })

  const skillsByPosition = new Map<string, PositionSkill[]>()
  for (const row of (skillLinkRows ?? []) as unknown as {
    position_id: string
    note: string | null
    hub_skills: { id: string; skill_key: string; display_name: string; summary: string; detail_content_item_id: string | null } | null
  }[]) {
    if (!row.hub_skills) continue
    const list = skillsByPosition.get(row.position_id) ?? []
    list.push({
      positionId: row.position_id,
      skillId: row.hub_skills.id,
      skillKey: row.hub_skills.skill_key,
      displayName: row.hub_skills.display_name,
      summary: row.hub_skills.summary,
      note: row.note,
      hasDetailContent: row.hub_skills.detail_content_item_id !== null,
    })
    skillsByPosition.set(row.position_id, list)
  }

  const relatedByPosition = new Map<string, string[]>()
  for (const row of relationshipRows ?? []) {
    const list = relatedByPosition.get(row.position_id) ?? []
    list.push(row.related_position_id)
    relatedByPosition.set(row.position_id, list)
  }

  return { rugbyCode, positions, skillsByPosition, relatedByPosition }
}
