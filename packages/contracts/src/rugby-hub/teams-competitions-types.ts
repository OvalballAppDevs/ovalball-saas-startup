/**
 * Client-safe Teams & Competitions types and pure helpers -- split from
 * teams-competitions-data.ts ("server-only") for the same reason as every
 * other *-types.ts file in this codebase: a client component importing a
 * runtime value from a server-only module pulls the whole module in.
 */

export type RugbyCode = "union" | "league"

export interface CompetitionRelatedLink {
  title: string
  href: string
}

export interface CompetitionGuide {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  rugbyCode: RugbyCode | null
  sourceNote: string | null
  sourceUrl: string | null
  sourceRetrievedOn: string | null
}

export interface CompetitionBundle {
  guides: CompetitionGuide[]
  relatedByGuide: Map<string, CompetitionRelatedLink[]>
  glossaryByGuide: Map<string, CompetitionRelatedLink[]>
  heritageByGuide: Map<string, CompetitionRelatedLink[]>
}

export function findGuideByKey(bundle: CompetitionBundle, contentKey: string): CompetitionGuide | null {
  return bundle.guides.find((g) => g.contentKey === contentKey) ?? null
}

export function competitionRugbyCodeLabel(code: RugbyCode | null): string | null {
  if (code === "union") return "Rugby Union"
  if (code === "league") return "Rugby League"
  return null
}
