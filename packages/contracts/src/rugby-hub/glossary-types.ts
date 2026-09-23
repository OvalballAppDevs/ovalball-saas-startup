/**
 * Client-safe Glossary types and pure helpers -- split from
 * glossary-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase: a client component importing a runtime
 * value from a server-only module pulls the whole module in.
 */

export type RugbyCode = "union" | "league"

export interface GlossaryRelatedLink {
  title: string
  href: string
}

export interface GlossaryPosition {
  positionId: string
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
}

export interface GlossarySkill {
  skillId: string
  skillKey: string
  displayName: string
}

export interface GlossaryRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface GlossaryTerm {
  id: string
  termKey: string
  displayTerm: string
  aliases: string[]
  rugbyCode: RugbyCode | null
  plainLanguageDefinition: string
  detailContentItemId: string | null
}

export interface GlossaryBundle {
  terms: GlossaryTerm[]
  relatedTermsByTerm: Map<string, GlossaryRelatedLink[]>
  contentLinksByTerm: Map<string, GlossaryRelatedLink[]>
  positionsByTerm: Map<string, GlossaryPosition[]>
  skillsByTerm: Map<string, GlossarySkill[]>
  regulatoryFactsByTerm: Map<string, GlossaryRegulatoryFact[]>
  detailLinkByTerm: Map<string, GlossaryRelatedLink>
}

export function findTermByKey(bundle: GlossaryBundle, termKey: string): GlossaryTerm | null {
  return bundle.terms.find((t) => t.termKey === termKey) ?? null
}

/** Real A-Z buckets derived from the actual published terms -- never a fixed 26-letter list. A letter with zero terms simply has no bucket, so the caller never renders a dead jump target. */
export function groupTermsByLetter(terms: GlossaryTerm[]): { letter: string; terms: GlossaryTerm[] }[] {
  const groups = new Map<string, GlossaryTerm[]>()
  for (const term of terms) {
    const letter = term.displayTerm.charAt(0).toUpperCase()
    const list = groups.get(letter) ?? []
    list.push(term)
    groups.set(letter, list)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, list]) => ({ letter, terms: list.sort((a, b) => a.displayTerm.localeCompare(b.displayTerm)) }))
}

export function rugbyCodeLabel(code: RugbyCode | null): string | null {
  if (code === "union") return "Rugby Union"
  if (code === "league") return "Rugby League"
  return null
}
