export interface CompactLabelInput {
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  /** Club-specific display alias for a B/C squad (e.g. "Blacks") -- Overnight Master Pass Section 52. When present, replaces the squad LETTER in the label ("U12 Blacks", never "U12 B Blacks"); canonical identity (category/ageGroup/squadDesignation) is untouched, this only changes what's printed. */
  alias?: string | null
}

/**
 * The short, at-a-glance team label used on Calendar (lanes, filter
 * chips, quick-view) and anywhere else scanability matters more than the
 * full canonical name -- derived from the team's own structured fields
 * (category/age_group/gender/squad_designation), never from the stored
 * free-text display_name. Real data shows display_name is inconsistently
 * maintained (e.g. a genuine U12 Boys team whose display_name still reads
 * "U11 Mixed A" from before a rollover) -- deriving from the structured
 * fields is correct by construction and immune to that drift.
 *
 * "Boys" and "Mixed" are deliberately never shown -- they're real
 * classification metadata (visible on Team Management/Edit Team), not
 * clutter every calendar row needs to repeat. "Girls" is the one
 * exception: it's the identity-distinguishing case (a club can genuinely
 * have both "U12" and "Girls U12"), so it's always shown, and always
 * first -- "Girls U12", never "U12 Girls".
 */
/** "A" is never a real squad letter (the primary/unlettered squad IS "A" conceptually) -- always treated as no squad, whatever a legacy or test row happens to have stored. Exported so anything else reasoning about "is this the primary squad" (e.g. lib/teams/catalog.ts's Add Team availability) treats a legacy "A" row the same way. */
export function normalizedSquad(squadDesignation: string | null): string | null {
  return squadDesignation && squadDesignation.toUpperCase() !== "A" ? squadDesignation : null
}

export function compactTeamLabel(t: CompactLabelInput): string {
  const squadDesignation = normalizedSquad(t.squadDesignation)
  if (t.category === "senior") {
    const genderWord = t.gender === "womens" ? "Women's" : "Men's"
    return `${genderWord} ${squadDesignation ?? "1st"}`
  }
  if (t.category === "colts") {
    return t.ageGroup === "SeniorColts" ? "Senior Colts" : "Junior Colts"
  }

  const age = t.ageGroup ?? "Team"
  const suffix = t.alias ? ` ${t.alias}` : squadDesignation ? ` ${squadDesignation}` : ""
  return t.gender === "girls" ? `Girls ${age}${suffix}` : `${age}${suffix}`
}

/**
 * The full, readable team label -- for the "normal selector/filter
 * experience" (Calendar team filters, Create Fixture pickers, Opposition
 * Team display, Site Admin dropdowns), as opposed to compactTeamLabel's
 * tight-space chip/lane form. Deliberately co-located with
 * compactTeamLabel and built from the exact same structured fields
 * (category/ageGroup/gender/squadDesignation) and the exact same
 * branching shape, so the two can never disagree about which team an
 * input describes -- they differ only in word choice ("U12" vs
 * "Under 12", "Men's 1st" vs "Men's 1st Team"), never in identity.
 */
export function fullTeamLabel(t: CompactLabelInput): string {
  const squadDesignation = normalizedSquad(t.squadDesignation)
  if (t.category === "senior") {
    const genderWord = t.gender === "womens" ? "Women's" : "Men's"
    return `${genderWord} ${squadDesignation ?? "1st"} Team`
  }
  if (t.category === "colts") {
    return t.ageGroup === "SeniorColts" ? "Senior Colts" : "Junior Colts"
  }

  const age = t.ageGroup ? `Under ${t.ageGroup.replace(/^U/, "")}` : "Team"
  const suffix = t.alias ? ` ${t.alias}` : squadDesignation ? ` ${squadDesignation}` : ""
  return t.gender === "girls" ? `Girls ${age}${suffix}` : `${age}${suffix}`
}
