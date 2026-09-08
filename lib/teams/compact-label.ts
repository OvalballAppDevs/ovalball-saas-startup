export interface CompactLabelInput {
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  /** Union senior sides are numbered ("Men's 1st Team"); league runs Open Age. Defaults to union when a caller genuinely has no code to hand. */
  rugbyCode?: "union" | "league" | null
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

/**
 * The pathway word in a display name -- Boys, Girls or Mixed.
 *
 * A team whose pathway has never been recorded gets no word at all ("Under
 * 14", not "Under 14 Boys"). Ovalball does not assume a pathway anywhere else
 * and a display name is not the place to start.
 */
function pathwayWord(gender: string | null): string {
  if (gender === "girls") return " Girls"
  if (gender === "boys") return " Boys"
  if (gender === "mixed") return " Mixed"
  return ""
}

export function compactTeamLabel(t: CompactLabelInput): string {
  const squadDesignation = normalizedSquad(t.squadDesignation)
  if (t.category === "senior") {
    const genderWord = t.gender === "womens" ? "Women's" : "Men's"
    // League runs Open Age rather than numbered sides, so there is no shorter
    // honest form -- compact and display are the same words here.
    return t.rugbyCode === "league"
      ? `${genderWord} Open Age${squadDesignation ? ` ${squadDesignation}` : ""}`
      : `${genderWord} ${squadDesignation ?? "1st"}`
  }
  if (t.category === "colts") {
    return t.ageGroup === "SeniorColts" ? "Senior Colts" : "Junior Colts"
  }

  const age = t.ageGroup ?? "Team"
  const suffix = t.alias ? ` ${t.alias}` : squadDesignation ? ` ${squadDesignation}` : ""
  return t.gender === "girls" ? `Girls ${age}${suffix}` : `${age}${suffix}`
}

/**
 * WHAT A TEAM IS CALLED.
 *
 * This is the display name, everywhere a team is named: team management,
 * fixtures, signup, handover, Match Centre. compactTeamLabel is the same
 * identity in the rugby identifier form ("U12"), kept for surfaces whose
 * design deliberately calls for density -- Calendar lanes and filter chips.
 * Two forms, one structured source; never two naming rules.
 *
 * It mirrors internal.canonical_team_presentation in the database exactly, and
 * a permanent regression pins them together for every active youth identity.
 *
 * "Under 12" alone said nothing about whether a side was boys, girls or mixed,
 * so a club running both U12 and Girls U12 saw one described by what it is and
 * the other by what it is not. The pathway word fixes that.
 */
export function fullTeamLabel(t: CompactLabelInput): string {
  const squadDesignation = normalizedSquad(t.squadDesignation)
  if (t.category === "senior") {
    const genderWord = t.gender === "womens" ? "Women's" : "Men's"
    return t.rugbyCode === "league"
      ? `${genderWord} Open Age${squadDesignation ? ` ${squadDesignation}` : ""}`
      : `${genderWord} ${squadDesignation ?? "1st"} Team`
  }
  if (t.category === "colts") {
    return t.ageGroup === "SeniorColts" ? "Senior Colts" : "Junior Colts"
  }

  const age = t.ageGroup ? `Under ${t.ageGroup.replace(/^U/, "")}` : "Team"
  const suffix = t.alias ? ` ${t.alias}` : squadDesignation ? ` ${squadDesignation}` : ""
  return `${age}${pathwayWord(t.gender)}${suffix}`
}
