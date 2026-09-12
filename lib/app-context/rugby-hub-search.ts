import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { Certainty } from "./heritage-data"
import { CERTAINTY_LABEL } from "./heritage-data"
import { RULES_SECTION_LABELS, SAFEGUARDING_SECTION_LABELS, WELFARE_SECTION_LABELS } from "./rugby-hub-format"
import type { PersonRole } from "./people-types"
import { personSearchLabel } from "./people-types"
import type { DevelopmentFamily } from "./development-types"
import { DEVELOPMENT_FAMILY_LABEL } from "./development-types"
import type { CoachingFamily } from "./coaching-types"
import { COACHING_FAMILY_LABEL } from "./coaching-types"
import type { ParentFamily } from "./parents-types"
import { PARENT_FAMILY_LABEL } from "./parents-types"

/**
 * Rugby Hub search. Wraps the existing search_hub_content RPC
 * (20270233000000_rugby_hub_search.sql, extended in place in
 * 20270249000000_rugby_hub_search_regulatory_and_story_coverage.sql) --
 * CONTENT_ITEM / POSITION / SKILL / GLOSSARY_TERM / RULE / STORY, ranked,
 * PUBLISHED/VERIFIED/currently-effective-only, one query. Never a second
 * search index: this file adds presentation (friendly type labels,
 * canonical routes, and the destination context RULE/STORY results need)
 * on top of that one RPC, nothing more. Every extra lookup below is one
 * small batched query per result TYPE actually present, never one query
 * per result.
 *
 * RULE results carry a raw section_key placeholder title from SQL --
 * get_regulatory_fact_search_context resolves the actual destination
 * (which skill, or which topic/identity/section), and the real title comes
 * from the same section-label vocabulary the Rules/Safeguarding/Player-
 * Welfare pages already use. Facts sharing the same (topic, rugby_code,
 * section) within one result page are collapsed into a single grouped
 * result -- see groupRuleRows -- because a broad query like "scrum" can
 * legitimately match five near-identical age-grade facts, and a wall of
 * otherwise-identical rows helps nobody. The exact facts behind the group
 * are never discarded: grouping only decides which single destination a
 * search result points at first, never which facts exist.
 */

export type HubSearchResultType = "CONTENT_ITEM" | "GAME_CONCEPT" | "OFFICIATING_CONCEPT" | "COMPETITION_GUIDE" | "RUGBY_TEAM" | "RUGBY_PERSON" | "PLAYER_DEVELOPMENT_CONCEPT" | "COACHING_CONCEPT" | "PARENT_GUIDE" | "POSITION" | "SKILL" | "GLOSSARY_TERM" | "RULE" | "STORY"

export interface HubSearchResult {
  type: HubSearchResultType
  id: string
  title: string
  snippet: string
  typeLabel: string
  href: string
}

const TYPE_LABEL: Record<"CONTENT_ITEM" | "GLOSSARY_TERM" | "GAME_CONCEPT" | "OFFICIATING_CONCEPT" | "COMPETITION_GUIDE" | "PLAYER_DEVELOPMENT_CONCEPT" | "COACHING_CONCEPT" | "PARENT_GUIDE", string> = {
  CONTENT_ITEM: "Rugby Hub Guide",
  GLOSSARY_TERM: "Glossary",
  GAME_CONCEPT: "Game Knowledge",
  OFFICIATING_CONCEPT: "Officiating",
  COMPETITION_GUIDE: "Competition",
  PLAYER_DEVELOPMENT_CONCEPT: "Development",
  COACHING_CONCEPT: "Coaching",
  PARENT_GUIDE: "For Parents",
}

/** Never "National Team" for a REPRESENTATIVE_TEAM (e.g. the Lions) -- the whole point of the type distinction is that a representative team is not a nation. */
const TEAM_TYPE_SEARCH_LABEL: Record<string, string> = {
  NATIONAL_TEAM: "International Team",
  REPRESENTATIVE_TEAM: "Representative Team",
  CLUB_TEAM: "Club",
}

const TOPIC_SECTION_LABELS: Record<string, Record<string, string>> = {
  RULES: RULES_SECTION_LABELS,
  SAFEGUARDING: SAFEGUARDING_SECTION_LABELS,
  PLAYER_WELFARE: WELFARE_SECTION_LABELS,
}

const TOPIC_PATH: Record<string, string> = {
  RULES: "rules",
  SAFEGUARDING: "safeguarding",
  PLAYER_WELFARE: "player-welfare",
}

function rugbyCodeLabel(code: string | null): string {
  return code === "league" ? "Rugby League" : "Rugby Union"
}

/** MYTH/LEGEND/CONTESTED are qualified on the result itself -- the same "questionable" set the Story detail page's own CertaintyBadge already treats specially -- so an uncertain match never reads as plain, settled fact before the click. */
function isQuestionableCertainty(certainty: Certainty): boolean {
  return certainty === "CONTESTED" || certainty === "LEGEND" || certainty === "MYTH"
}

interface RegulatoryFactContext {
  fact_id: string
  destination_kind: string | null
  skill_key: string | null
  topic: string | null
  identity_key: string | null
  regulatory_identity_id: string | null
  rugby_code: string | null
  section_key: string | null
  occurrence_count: number | null
}

/**
 * Groups RULE rows by (topic, rugby_code, section) -- their existing
 * canonical context -- and picks one primary occurrence per group:
 * the one matching the viewer's own regulatory identity if it's among the
 * group, otherwise whichever ranked highest (rows arrive pre-ranked from
 * search_hub_content, so "first seen" is "highest ranked"). Group size is
 * disclosed in the snippet rather than hidden -- provenance is never
 * discarded, only presented once instead of N near-identical times.
 */
function groupRuleRows(
  rows: { id: string; title: string; snippet: string }[],
  contextById: Map<string, RegulatoryFactContext>,
  viewerRegulatoryIdentityId: string | null | undefined,
  skillDisplayNameByKey: Map<string, string>
): HubSearchResult[] {
  const groups = new Map<string, { primaryId: string; snippet: string; count: number; ctx: RegulatoryFactContext }>()

  for (const row of rows) {
    const ctx = contextById.get(row.id)
    if (!ctx || !ctx.destination_kind) continue

    const groupKey = ctx.destination_kind === "SKILL" ? `SKILL:${ctx.skill_key}` : `RULES_PAGE:${ctx.topic}:${ctx.rugby_code}:${ctx.section_key}`
    const existing = groups.get(groupKey)
    if (!existing) {
      groups.set(groupKey, { primaryId: row.id, snippet: row.snippet, count: 1, ctx })
      continue
    }
    existing.count += 1
    const thisIsViewerIdentity = viewerRegulatoryIdentityId != null && ctx.regulatory_identity_id === viewerRegulatoryIdentityId
    if (thisIsViewerIdentity) {
      existing.primaryId = row.id
      existing.snippet = row.snippet
      existing.ctx = ctx
    }
  }

  const results: HubSearchResult[] = []
  for (const { snippet, count, ctx } of groups.values()) {
    const topic = ctx.topic ?? "RULES"
    const codeLabel = rugbyCodeLabel(ctx.rugby_code)
    const groupNote = count > 1 ? ` (applies across ${count} age grades)` : ""

    const title =
      ctx.destination_kind === "SKILL"
        ? (ctx.skill_key && skillDisplayNameByKey.get(ctx.skill_key)) || "Rule"
        : (ctx.section_key && TOPIC_SECTION_LABELS[topic]?.[ctx.section_key]) || ctx.section_key || "Rule"

    let href: string
    if (ctx.destination_kind === "SKILL" && ctx.skill_key) {
      href = `/rugby-hub/skills/${ctx.skill_key}`
    } else if (ctx.destination_kind === "RULES_PAGE" && ctx.topic && ctx.section_key && (ctx.topic !== "RULES" || ctx.identity_key)) {
      const path = TOPIC_PATH[ctx.topic] ?? "rules"
      // RULES has no code-only browse mode (age-grade rules are always
      // identity-scoped -- see get_rugby_hub_rules_by_identity). Safeguarding
      // and Player Welfare gate their browse mode on ?code=, so it must
      // always be present there; ?identity= narrows further when known,
      // never replaces ?code=.
      const scope =
        ctx.topic === "RULES"
          ? `identity=${encodeURIComponent(ctx.identity_key ?? "")}`
          : `code=${encodeURIComponent(ctx.rugby_code ?? "union")}${ctx.identity_key ? `&identity=${encodeURIComponent(ctx.identity_key)}` : ""}`
      href = `/rugby-hub/${path}?${scope}#section-${ctx.section_key}`
    } else {
      continue // no real destination -- excluded rather than linked somewhere generic
    }

    results.push({
      type: "RULE",
      id: ctx.destination_kind === "SKILL" ? `skill:${ctx.skill_key}` : `rule:${ctx.topic}:${ctx.rugby_code}:${ctx.section_key}`,
      title,
      snippet: snippet + groupNote,
      typeLabel: `Rule · ${codeLabel}`,
      href,
    })
  }
  return results
}

export async function searchRugbyHub(supabase: SupabaseClient<Database>, query: string, limit = 12, viewerRegulatoryIdentityId?: string | null): Promise<HubSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const { data, error } = await supabase.rpc("search_hub_content", { p_query: trimmed, p_limit: limit })
  if (error || !data) return []

  const positionIds = data.filter((r) => r.result_type === "POSITION").map((r) => r.result_id)
  const skillIds = data.filter((r) => r.result_type === "SKILL").map((r) => r.result_id)
  const contentItemIds = data.filter((r) => r.result_type === "CONTENT_ITEM").map((r) => r.result_id)
  const ruleIds = data.filter((r) => r.result_type === "RULE").map((r) => r.result_id)
  const storyIds = data.filter((r) => r.result_type === "STORY").map((r) => r.result_id)
  const glossaryTermIds = data.filter((r) => r.result_type === "GLOSSARY_TERM").map((r) => r.result_id)

  const [{ data: positionRows }, { data: skillRows }, { data: skillLinkRows }, { data: contentItemRows }, { data: ruleContexts }, { data: storyRows }, { data: glossaryTermRows }] = await Promise.all([
    positionIds.length > 0
      ? supabase.from("hub_positions").select("id, position_key, rugby_code").in("id", positionIds)
      : Promise.resolve({ data: [] as { id: string; position_key: string; rugby_code: string }[] }),
    skillIds.length > 0
      ? supabase.from("hub_skills").select("id, skill_key, rugby_code").in("id", skillIds)
      : Promise.resolve({ data: [] as { id: string; skill_key: string; rugby_code: string | null }[] }),
    // A generic hub_content_items row has no page of its own -- the only
    // real ones today (the tackling/scrum safety notes) are reachable
    // through the skill that links them. Resolve that reverse link rather
    // than sending a search result to a generic landing page. GAME_CONCEPT
    // rows are the exception -- they have their own canonical route, see
    // contentItemRows below.
    contentItemIds.length > 0
      ? supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key)").in("content_item_id", contentItemIds)
      : Promise.resolve({ data: [] as { content_item_id: string; hub_skills: { skill_key: string } | null }[] }),
    contentItemIds.length > 0
      ? supabase.from("hub_content_items").select("id, content_type, content_key, rugby_code, team_type, roles, development_family, coaching_family, parent_family").in("id", contentItemIds)
      : Promise.resolve({ data: [] as { id: string; content_type: string; content_key: string; rugby_code: string | null; team_type: string | null; roles: string[] | null; development_family: string | null; coaching_family: string | null; parent_family: string | null }[] }),
    ruleIds.length > 0 ? supabase.rpc("get_regulatory_fact_search_context", { p_fact_ids: ruleIds }) : Promise.resolve({ data: [] as RegulatoryFactContext[] }),
    storyIds.length > 0
      ? supabase.from("heritage_entries").select("id, entry_key, certainty, code_scope").in("id", storyIds)
      : Promise.resolve({ data: [] as { id: string; entry_key: string; certainty: string; code_scope: string }[] }),
    glossaryTermIds.length > 0
      ? supabase.from("hub_glossary_terms").select("id, term_key, rugby_code").in("id", glossaryTermIds)
      : Promise.resolve({ data: [] as { id: string; term_key: string; rugby_code: string | null }[] }),
  ])

  const positionById = new Map((positionRows ?? []).map((p) => [p.id, p]))
  const skillById = new Map((skillRows ?? []).map((s) => [s.id, s]))
  const skillKeyByContentItemId = new Map<string, string>()
  for (const row of (skillLinkRows ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string } | null }[]) {
    if (row.hub_skills && !skillKeyByContentItemId.has(row.content_item_id)) skillKeyByContentItemId.set(row.content_item_id, row.hub_skills.skill_key)
  }
  const contentItemById = new Map((contentItemRows ?? []).map((c) => [c.id, c]))
  const ruleContextById = new Map((ruleContexts ?? []).map((c) => [c.fact_id, c as RegulatoryFactContext]))
  const storyById = new Map((storyRows ?? []).map((s) => [s.id, s]))
  const glossaryTermById = new Map((glossaryTermRows ?? []).map((g) => [g.id, g]))

  // A RULE result that resolves to the skill-content path needs that
  // skill's own display name for its title (there is no fact-level title
  // otherwise) -- a second small batched lookup by skill_key, distinct
  // from skillById above (which is keyed by id, for genuine SKILL results).
  const ruleSkillKeys = Array.from(new Set((ruleContexts ?? []).filter((c) => c.destination_kind === "SKILL" && c.skill_key).map((c) => c.skill_key as string)))
  const { data: ruleSkillRows } =
    ruleSkillKeys.length > 0
      ? await supabase.from("hub_skills").select("skill_key, display_name").in("skill_key", ruleSkillKeys)
      : { data: [] as { skill_key: string; display_name: string }[] }
  const skillDisplayNameByKey = new Map((ruleSkillRows ?? []).map((s) => [s.skill_key, s.display_name]))

  const nonRuleResults = data
    .filter((row) => row.result_type !== "RULE")
    .map((row): { rawKey: string; result: HubSearchResult } | null => {
      const type = row.result_type as Exclude<HubSearchResultType, "RULE">
      const rawKey = `${row.result_type}:${row.result_id}`
      if (type === "POSITION") {
        const p = positionById.get(row.result_id)
        if (!p) return null
        return {
          rawKey,
          result: {
            type,
            id: row.result_id,
            title: row.title,
            snippet: row.snippet,
            typeLabel: `Position · ${rugbyCodeLabel(p.rugby_code)}`,
            href: `/rugby-hub/positions/${p.rugby_code}/${p.position_key}`,
          },
        }
      }
      if (type === "SKILL") {
        const skill = skillById.get(row.result_id)
        if (!skill) return null
        const typeLabel = skill.rugby_code ? `Skill · ${rugbyCodeLabel(skill.rugby_code)}` : "Skill"
        return { rawKey, result: { type, id: row.result_id, title: row.title, snippet: row.snippet, typeLabel, href: `/rugby-hub/skills/${skill.skill_key}` } }
      }
      if (type === "CONTENT_ITEM") {
        const item = contentItemById.get(row.result_id)
        if (item?.content_type === "GAME_CONCEPT") {
          const codeLabel = item.rugby_code ? ` · ${rugbyCodeLabel(item.rugby_code)}` : ""
          return {
            rawKey,
            result: {
              type: "GAME_CONCEPT",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.GAME_CONCEPT}${codeLabel}`,
              href: `/rugby-hub/game/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "OFFICIATING_CONCEPT") {
          const codeLabel = item.rugby_code ? ` · ${rugbyCodeLabel(item.rugby_code)}` : ""
          return {
            rawKey,
            result: {
              type: "OFFICIATING_CONCEPT",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.OFFICIATING_CONCEPT}${codeLabel}`,
              href: `/rugby-hub/officiating/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "COMPETITION_GUIDE") {
          const codeLabel = item.rugby_code ? ` · ${rugbyCodeLabel(item.rugby_code)}` : ""
          return {
            rawKey,
            result: {
              type: "COMPETITION_GUIDE",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.COMPETITION_GUIDE}${codeLabel}`,
              href: `/rugby-hub/competitions/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "RUGBY_TEAM") {
          const codeLabel = item.rugby_code ? ` · ${rugbyCodeLabel(item.rugby_code)}` : ""
          const teamLabel = TEAM_TYPE_SEARCH_LABEL[item.team_type ?? ""] ?? "Team"
          const href = item.team_type === "CLUB_TEAM" ? `/rugby-hub/clubs/${item.content_key}` : `/rugby-hub/international/teams/${item.content_key}`
          return {
            rawKey,
            result: {
              type: "RUGBY_TEAM",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${teamLabel}${codeLabel}`,
              href,
            },
          }
        }
        if (item?.content_type === "PARENT_GUIDE") {
          const familyLabel = item.parent_family ? ` · ${PARENT_FAMILY_LABEL[item.parent_family as ParentFamily] ?? item.parent_family}` : ""
          return {
            rawKey,
            result: {
              type: "PARENT_GUIDE",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.PARENT_GUIDE}${familyLabel}`,
              href: `/rugby-hub/parents/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "COACHING_CONCEPT") {
          const familyLabel = item.coaching_family ? ` · ${COACHING_FAMILY_LABEL[item.coaching_family as CoachingFamily] ?? item.coaching_family}` : ""
          return {
            rawKey,
            result: {
              type: "COACHING_CONCEPT",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.COACHING_CONCEPT}${familyLabel}`,
              href: `/rugby-hub/coaching/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "PLAYER_DEVELOPMENT_CONCEPT") {
          const familyLabel = item.development_family ? ` · ${DEVELOPMENT_FAMILY_LABEL[item.development_family as DevelopmentFamily] ?? item.development_family}` : ""
          return {
            rawKey,
            result: {
              type: "PLAYER_DEVELOPMENT_CONCEPT",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: `${TYPE_LABEL.PLAYER_DEVELOPMENT_CONCEPT}${familyLabel}`,
              href: `/rugby-hub/development/${item.content_key}`,
            },
          }
        }
        if (item?.content_type === "RUGBY_PERSON") {
          const roleLabel = personSearchLabel((item.roles ?? []) as PersonRole[])
          return {
            rawKey,
            result: {
              type: "RUGBY_PERSON",
              id: row.result_id,
              title: row.title,
              snippet: row.snippet,
              typeLabel: roleLabel,
              href: `/rugby-hub/people/${item.content_key}`,
            },
          }
        }
        const skillKey = skillKeyByContentItemId.get(row.result_id)
        if (!skillKey) return null // no real destination -- excluded rather than linked to a generic page
        return { rawKey, result: { type, id: row.result_id, title: row.title, snippet: row.snippet, typeLabel: TYPE_LABEL.CONTENT_ITEM, href: `/rugby-hub/skills/${skillKey}` } }
      }
      if (type === "STORY") {
        const entry = storyById.get(row.result_id)
        if (!entry) return null
        const certainty = entry.certainty as Certainty
        const typeLabel = isQuestionableCertainty(certainty) ? `Story · ${CERTAINTY_LABEL[certainty]}` : "Story"
        return { rawKey, result: { type, id: row.result_id, title: row.title, snippet: row.snippet, typeLabel, href: `/rugby-hub/story/${entry.entry_key}` } }
      }
      if (type === "GLOSSARY_TERM") {
        const term = glossaryTermById.get(row.result_id)
        if (!term) return null
        const codeLabel = term.rugby_code ? ` · ${rugbyCodeLabel(term.rugby_code)}` : ""
        return { rawKey, result: { type, id: row.result_id, title: row.title, snippet: row.snippet, typeLabel: `${TYPE_LABEL.GLOSSARY_TERM}${codeLabel}`, href: `/rugby-hub/glossary/${term.term_key}` } }
      }
      return null
    })
    .filter((r): r is { rawKey: string; result: HubSearchResult } => r !== null)

  const ruleRows = data.filter((row) => row.result_type === "RULE").map((row) => ({ id: row.result_id, title: row.title, snippet: row.snippet }))
  const ruleResults = groupRuleRows(ruleRows, ruleContextById, viewerRegulatoryIdentityId, skillDisplayNameByKey)

  // Re-merge in original rank order: walk the raw ranked rows once more,
  // emitting each non-RULE result as-is and each RULE group exactly once,
  // the first time any of its member facts is encountered.
  const emittedRuleGroupIds = new Set<string>()
  const ruleResultById = new Map(ruleResults.map((r) => [r.id, r]))
  const nonRuleById = new Map(nonRuleResults.map((r) => [r.rawKey, r.result]))
  const merged: HubSearchResult[] = []
  for (const row of data) {
    if (row.result_type === "RULE") {
      const ctx = ruleContextById.get(row.result_id)
      if (!ctx || !ctx.destination_kind) continue
      const groupId = ctx.destination_kind === "SKILL" ? `skill:${ctx.skill_key}` : `rule:${ctx.topic}:${ctx.rugby_code}:${ctx.section_key}`
      if (emittedRuleGroupIds.has(groupId)) continue
      emittedRuleGroupIds.add(groupId)
      const result = ruleResultById.get(groupId)
      if (result) merged.push(result)
    } else {
      const result = nonRuleById.get(`${row.result_type}:${row.result_id}`)
      if (result) merged.push(result)
    }
  }
  return merged
}
