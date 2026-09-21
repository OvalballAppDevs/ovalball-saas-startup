/**
 * CONVERGENCE STEP 15 — WHAT A GOVERNING BODY ROLE IS CALLED. One place, because Step 15 briefly had
 * two: the sidebar said "Organisation Administrator" while People & Access said "Administrator", for the
 * same row in the same table. One concept, one name — found in the Step 15 browser journey.
 *
 * DELIBERATELY ITS OWN DEPENDENCY-FREE MODULE. `lib/app-context/active-context-rules.ts` needs these
 * words and is kept importable by a plain `npx tsx` run with no Supabase client in the graph, so the
 * labels cannot live beside the read model that loads them.
 *
 * WHY NOT "ADMIN". "Club Admin" and "Site Admin" already name specific authorities in this product and a
 * county officer holds neither. The words say what somebody does for the organisation, and the
 * organisation is named beside them wherever they appear, because "Administrator" on its own does not
 * answer "of what".
 */
export type BodyRole = "BODY_ADMIN" | "BODY_COMPETITIONS" | "BODY_VIEWER"

export const BODY_ROLE_LABEL: Record<BodyRole, string> = {
  BODY_ADMIN: "Organisation Administrator",
  BODY_COMPETITIONS: "Competitions Officer",
  BODY_VIEWER: "Organisation Viewer",
}

/**
 * What each role may actually do, in the words of the jobs rather than of the capability keys.
 *
 * DESCRIPTIVE ONLY: the authority is `internal.can_manage_body`,
 * `internal.can_manage_body_competitions` and `internal.can_view_body`. Editing this text changes
 * nothing about what anybody is allowed to do — which is why People & Access can print it beside a role
 * without the page becoming a second, weaker statement of the rules.
 */
export const BODY_ROLE_ALLOWS: Record<BodyRole, string> = {
  BODY_ADMIN: "Can run this organisation's competitions, and give or remove other people's access here.",
  BODY_COMPETITIONS: "Can run this organisation's competitions. Cannot change who has access.",
  BODY_VIEWER: "Can see this organisation, its clubs and its competitions. Changes nothing.",
}

/** Every role, in the order they are offered — most authority last, so it is never the accidental pick. */
export const BODY_ROLES: BodyRole[] = ["BODY_VIEWER", "BODY_COMPETITIONS", "BODY_ADMIN"]
