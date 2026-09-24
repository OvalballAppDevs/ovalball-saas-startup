import type { ClubBundle } from "./clubs-types"
import type { CoachingBundle } from "./coaching-types"
import { parseHubHref, type HubDestination } from "./destinations"
import type { DevelopmentBundle } from "./development-types"
import type { GameKnowledgeBundle } from "./game-knowledge-types"
import type { GlossaryBundle } from "./glossary-types"
import type { HeritageTimeline } from "./heritage-data"
import type { InternationalBundle } from "./international-types"
import type { OfficiatingBundle } from "./officiating-types"
import type { ParentsBundle } from "./parents-types"
import type { PeopleBundle } from "./people-types"
import type { PositionExplorerBundle } from "./position-explorer-types"
import type { SkillsExplorerBundle } from "./skills-explorer-types"
import type { CompetitionBundle } from "./teams-competitions-types"

/**
 * ONE RELATED-CONTENT PROJECTION FOR THE WHOLE RUGBY HUB (CA-M6).
 *
 * Every Hub bundle already carries its canonical relationships -- "related knowledge" rows,
 * glossary links, connected skills and positions, the rules a concept cites, a person's teams,
 * a club's people. Each screen used to read its own maps and draw its own chips. This module turns
 * those SAME maps into one typed list, so the app's Explore Next rail and Keep Exploring foot (and,
 * later, the website) can render a relationship without knowing which table it came from.
 *
 * Nothing here manufactures a relationship. There is no text matching, no "you may also like":
 * a row appears only because a canonical relationship row exists. The entity TYPE is derived from
 * the canonical href through `parseHubHref`, never from a title, so an alias or a shared title
 * can never make one entity look like another.
 *
 * Compatibility: the web pages keep reading their bundle maps directly; this projection is
 * additive and may be consumed there later without changing any reader.
 */
export type HubEntityType =
  | "GAME_CONCEPT"
  | "GLOSSARY_TERM"
  | "OFFICIATING_CONCEPT"
  | "COACHING_CONCEPT"
  | "PARENT_GUIDE"
  | "PLAYER_DEVELOPMENT_CONCEPT"
  | "COMPETITION_GUIDE"
  | "RUGBY_TEAM"
  | "RUGBY_PERSON"
  | "RULE"
  | "SKILL"
  | "POSITION"
  | "STORY"
  | "CLUB"

export interface HubRelatedEntity {
  type: HubEntityType
  /** The canonical key of the entity (content key, term key, skill key, position key, entry key, fact key). */
  key: string
  title: string
  /** The canonical web href; the one route table turns it into a screen. */
  href: string
  summary?: string | null
  /** The canonical relationship kind this row came through, as the bundle names it. */
  via: string
}

/** The type a canonical href resolves to, or null when the href is not an entity destination. */
export function entityTypeOfHref(href: string): { type: HubEntityType; key: string } | null {
  const destination = parseHubHref(href)
  if (!destination) return null
  return entityOfDestination(destination)
}

function entityOfDestination(d: HubDestination): { type: HubEntityType; key: string } | null {
  switch (d.kind) {
    case "game":
      return d.conceptKey ? { type: "GAME_CONCEPT", key: d.conceptKey } : null
    case "glossary":
      return d.termKey ? { type: "GLOSSARY_TERM", key: d.termKey } : null
    case "officiating":
      return d.contentKey ? { type: "OFFICIATING_CONCEPT", key: d.contentKey } : null
    case "coaching":
      return d.conceptKey ? { type: "COACHING_CONCEPT", key: d.conceptKey } : null
    case "parents":
      return d.guideKey ? { type: "PARENT_GUIDE", key: d.guideKey } : null
    case "development":
      return d.conceptKey ? { type: "PLAYER_DEVELOPMENT_CONCEPT", key: d.conceptKey } : null
    case "competitions":
      return d.contentKey ? { type: "COMPETITION_GUIDE", key: d.contentKey } : null
    case "international":
      return d.teamKey ? { type: "RUGBY_TEAM", key: d.teamKey } : null
    case "people":
      return d.personKey ? { type: "RUGBY_PERSON", key: d.personKey } : null
    case "skills":
      return d.skillKey ? { type: "SKILL", key: d.skillKey } : null
    case "positions":
      return d.positionKey ? { type: "POSITION", key: d.positionKey } : null
    case "story":
      return d.entryKey ? { type: "STORY", key: d.entryKey } : null
    case "clubs":
      return d.clubKey ? { type: "CLUB", key: d.clubKey } : null
    case "rules":
      // A rule row is a browse destination plus its section; the fact key is the entity key.
      return d.section ? { type: "RULE", key: d.section } : null
    default:
      return null
  }
}

/** The product words for each type. Never a table or enum name on screen. */
export function hubEntityTypeLabel(type: HubEntityType): string {
  switch (type) {
    case "GAME_CONCEPT":
      return "Game Knowledge"
    case "GLOSSARY_TERM":
      return "Glossary"
    case "OFFICIATING_CONCEPT":
      return "Officiating"
    case "COACHING_CONCEPT":
      return "Coaching"
    case "PARENT_GUIDE":
      return "Parent Guide"
    case "PLAYER_DEVELOPMENT_CONCEPT":
      return "Player Development"
    case "COMPETITION_GUIDE":
      return "Competition"
    case "RUGBY_TEAM":
      return "Team"
    case "RUGBY_PERSON":
      return "Person"
    case "RULE":
      return "Rule"
    case "SKILL":
      return "Skill"
    case "POSITION":
      return "Position"
    case "STORY":
      return "Story"
    case "CLUB":
      return "Club"
  }
}

/** A row from a canonical link (title + href): typed by the href, dropped when the href is not an entity. */
function fromLink(link: { title: string; href: string }, via: string, summary?: string | null): HubRelatedEntity | null {
  const entity = entityTypeOfHref(link.href)
  if (!entity) return null
  return { type: entity.type, key: entity.key, title: link.title, href: link.href, summary: summary ?? null, via }
}

function skillEntity(skill: { skillKey: string; displayName: string }, via: string): HubRelatedEntity {
  return { type: "SKILL", key: skill.skillKey, title: skill.displayName, href: `/rugby-hub/skills/${skill.skillKey}`, via }
}

function positionEntity(position: { positionKey: string; displayName: string; rugbyCode: "union" | "league" }, via: string): HubRelatedEntity {
  return { type: "POSITION", key: position.positionKey, title: position.displayName, href: `/rugby-hub/positions/${position.rugbyCode}/${position.positionKey}`, via }
}

function ruleEntity(fact: { factKey: string; valueText: string | null }, via: string): HubRelatedEntity {
  return { type: "RULE", key: fact.factKey, title: fact.valueText ?? fact.factKey, href: `/rugby-hub/rules#section-${fact.factKey}`, via }
}

/** Deduplicated by href, canonical order kept: the first relationship that named an entity wins. */
export function dedupeByHref(entities: (HubRelatedEntity | null)[]): HubRelatedEntity[] {
  const seen = new Set<string>()
  const out: HubRelatedEntity[] = []
  for (const e of entities) {
    if (!e || seen.has(e.href)) continue
    seen.add(e.href)
    out.push(e)
  }
  return out
}

export type HubRelatedDomain =
  | { domain: "game"; bundle: GameKnowledgeBundle }
  | { domain: "glossary"; bundle: GlossaryBundle }
  | { domain: "officiating"; bundle: OfficiatingBundle }
  | { domain: "coaching"; bundle: CoachingBundle }
  | { domain: "development"; bundle: DevelopmentBundle }
  | { domain: "parents"; bundle: ParentsBundle }
  | { domain: "competitions"; bundle: CompetitionBundle }
  | { domain: "international"; bundle: InternationalBundle }
  | { domain: "clubs"; bundle: ClubBundle }
  | { domain: "people"; bundle: PeopleBundle }
  | { domain: "skills"; bundle: SkillsExplorerBundle }
  | { domain: "positions"; bundle: PositionExplorerBundle }
  | { domain: "story"; bundle: HeritageTimeline }

/**
 * Every canonical relationship of one entity (by its bundle id), as typed entities. The order is
 * the bundle's own: knowledge links first, then the glossary, skills, positions and rules where a
 * domain carries them.
 */
export function relatedEntities(source: HubRelatedDomain, id: string): HubRelatedEntity[] {
  switch (source.domain) {
    case "game": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByConcept.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.skillsByConcept.get(id) ?? []).map((s) => skillEntity(s, "SKILL")),
        ...(b.positionsByConcept.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.regulatoryFactsByConcept.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "glossary": {
      const b = source.bundle
      const detail = b.detailLinkByTerm.get(id)
      return dedupeByHref([
        detail ? fromLink(detail, "DETAIL") : null,
        ...(b.contentLinksByTerm.get(id) ?? []).map((l) => fromLink(l, "GLOSSARY_CONTENT")),
        ...(b.relatedTermsByTerm.get(id) ?? []).map((l) => fromLink(l, "RELATED_TERM")),
        ...(b.skillsByTerm.get(id) ?? []).map((s) => skillEntity(s, "SKILL")),
        ...(b.positionsByTerm.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.regulatoryFactsByTerm.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "officiating": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByConcept.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.glossaryByConcept.get(id) ?? []).map((l) => fromLink(l, "GLOSSARY")),
        ...(b.skillsByConcept.get(id) ?? []).map((s) => skillEntity(s, "SKILL")),
        ...(b.positionsByConcept.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.regulatoryFactsByConcept.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "coaching": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByConcept.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.skillsByConcept.get(id) ?? []).map((s) => skillEntity({ skillKey: s.skillKey, displayName: s.displayName }, "SKILL")),
        ...(b.regulatoryFactsByConcept.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "development": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByConcept.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.skillsByConcept.get(id) ?? []).map((s) => skillEntity({ skillKey: s.skillKey, displayName: s.displayName }, "SKILL")),
        ...(b.positionsByConcept.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.regulatoryFactsByConcept.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "parents": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByGuide.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.glossaryByGuide.get(id) ?? []).map((g) => ({ type: "GLOSSARY_TERM" as const, key: g.termKey, title: g.displayTerm, href: `/rugby-hub/glossary/${g.termKey}`, via: "GLOSSARY" })),
        ...(b.skillsByGuide.get(id) ?? []).map((s) => skillEntity({ skillKey: s.skillKey, displayName: s.displayName }, "SKILL")),
        ...(b.positionsByGuide.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.regulatoryFactsByGuide.get(id) ?? []).map((f) => ruleEntity(f, "RULE")),
      ])
    }
    case "competitions": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByGuide.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.glossaryByGuide.get(id) ?? []).map((l) => fromLink(l, "GLOSSARY")),
        ...(b.heritageByGuide.get(id) ?? []).map((l) => fromLink(l, "HERITAGE")),
      ])
    }
    case "international": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.relatedByTeam.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.relatedByCompetition.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.heritageByContentItem.get(id) ?? []).map((l) => fromLink(l, "HERITAGE")),
      ])
    }
    case "clubs": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.peopleByClub.get(id) ?? []).map((p) => fromLink({ title: p.personTitle, href: p.href }, "PERSON")),
        ...(b.relatedByClub.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.heritageByClub.get(id) ?? []).map((l) => fromLink(l, "HERITAGE")),
      ])
    }
    case "people": {
      const b = source.bundle
      return dedupeByHref([
        ...(b.teamLinksByPerson.get(id) ?? []).map((t) => ({ type: "RUGBY_TEAM" as const, key: t.teamKey, title: t.teamTitle, href: `/rugby-hub/international/teams/${t.teamKey}`, via: "TEAM" })),
        ...(b.relatedByPerson.get(id) ?? []).map((l) => fromLink(l, "RELATED_KNOWLEDGE")),
        ...(b.heritageByPerson.get(id) ?? []).map((l) => fromLink(l, "HERITAGE")),
      ])
    }
    case "skills": {
      const b = source.bundle
      const byId = new Map(b.skills.map((s) => [s.id, s]))
      return dedupeByHref([
        ...(b.relatedBySkill.get(id) ?? []).map((r) => {
          const s = byId.get(r.skillId)
          return s ? skillEntity(s, r.relationshipType) : null
        }),
        ...(b.positionsBySkill.get(id) ?? []).map((p) => positionEntity(p, "POSITION")),
        ...(b.trainingContentBySkill.get(id) ?? []).map((c) =>
          c.contentType === "COACHING_CONCEPT"
            ? fromLink({ title: c.title, href: `/rugby-hub/coaching/${c.contentKey}` }, "COACHING")
            : c.contentType === "PLAYER_DEVELOPMENT_CONCEPT"
              ? fromLink({ title: c.title, href: `/rugby-hub/development/${c.contentKey}` }, "DEVELOPMENT")
              : null
        ),
      ])
    }
    case "positions": {
      const b = source.bundle
      const byId = new Map(b.positions.map((p) => [p.id, p]))
      return dedupeByHref([
        ...(b.relatedByPosition.get(id) ?? []).map((relatedId) => {
          const p = byId.get(relatedId)
          return p ? positionEntity(p, "RELATED_POSITION") : null
        }),
        ...(b.skillsByPosition.get(id) ?? []).map((s) => skillEntity({ skillKey: s.skillKey, displayName: s.displayName }, "SKILL")),
      ])
    }
    case "story": {
      const b = source.bundle
      const entry = b.entries.find((e) => e.id === id)
      if (!entry) return []
      // The Story's own relationship is the era: entries of the same era, in chronological order.
      return dedupeByHref(
        b.entries
          .filter((e) => e.id !== entry.id && e.eraId !== null && e.eraId === entry.eraId)
          .sort((a, c) => a.happenedYear - c.happenedYear)
          .map((e) => ({ type: "STORY" as const, key: e.entryKey, title: e.title, href: `/rugby-hub/story/${e.entryKey}`, summary: e.summary, via: "ERA" }))
      )
    }
  }
}

/**
 * The short rail: a deterministic pick that shows the SPREAD of the graph first -- one entity of
 * each type in canonical order, then the rest in order -- so "Explore Next" after a concept offers
 * the glossary, the rule and the coaching angle before a second concept. Never random.
 */
export function exploreNext(entities: HubRelatedEntity[], limit = 4): HubRelatedEntity[] {
  const seenTypes = new Set<HubEntityType>()
  const first: HubRelatedEntity[] = []
  const rest: HubRelatedEntity[] = []
  for (const e of entities) {
    if (seenTypes.has(e.type)) rest.push(e)
    else {
      seenTypes.add(e.type)
      first.push(e)
    }
  }
  return [...first, ...rest].slice(0, Math.max(0, limit))
}

/**
 * What Keep Exploring shows once Explore Next has taken its spread: the remaining entities, in canonical
 * order, or the full list again when fewer than two would remain -- a foot of the page is never one row.
 */
export function afterExploreNext(entities: HubRelatedEntity[], next: HubRelatedEntity[]): HubRelatedEntity[] {
  const taken = new Set(next.map((e) => e.href))
  const rest = entities.filter((e) => !taken.has(e.href))
  return rest.length >= 2 ? rest : entities
}
