import { fullTeamLabel } from "@/lib/teams/compact-label"

/**
 * Plain formatting helper -- deliberately NOT in fixture-actions.ts
 * (a "use server" file): every export of a "use server" module becomes a
 * server-action reference for client bundling purposes, and a synchronous
 * non-async helper like this one breaks that contract at build time.
 *
 * Delegates entirely to lib/teams/compact-label.ts's fullTeamLabel -- the
 * ONE canonical full-name formatter every team-identity/age display in
 * this app must share (Reconciliation complaint 2). This function
 * previously had its own divergent logic keyed off a `teamNumber` field
 * that was never actually populated by either caller
 * (app/(app)/calendar/fixture-actions.ts and app/(app)/admin/fixtures/
 * actions.ts both hardcoded or omitted it), which silently mislabelled
 * every senior opponent as a bare "Men's"/"Women's" with no squad number,
 * and every Colts opponent as "Senior" -- fixed by switching the callers
 * to select the real `squad_designation` column and routing through the
 * shared formatter instead of re-deriving the label here.
 */
export function teamCategoryLabel(t: { category: string; gender: string | null; ageGroup: string | null; squadDesignation: string | null }): string {
  return fullTeamLabel({ category: t.category, ageGroup: t.ageGroup, gender: t.gender, squadDesignation: t.squadDesignation })
}
