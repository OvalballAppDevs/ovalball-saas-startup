/**
 * WHICH OF THEIR TEAMS DO WE MEAN?
 *
 * Our Team is Under 12 Boys; the opposition is Preston. Ovalball should offer
 * Preston's Under 12 Boys first -- and pick it outright when it is the one
 * clear match -- by comparing structured identity, never by comparing names:
 * rugby code, category, age band, pathway and squad.
 *
 * Only teams that could legally play us are ever offered (teamsCanPlayFixture,
 * the TypeScript mirror of the database's own eligibility trigger). Among them:
 *
 *   exact age grade  + same pathway + same squad   -> strong
 *   exact age grade  + same pathway, other squad   -> good
 *   same age band (U6-U8 tag, girls flexible age)  -> possible
 *
 * One strong match is preselected. Several equally good matches are ranked and
 * nothing is preselected -- picking one of them silently would be a guess. No
 * eligible team is an answer too: the opponent is recorded as an external club,
 * and no internal team is ever invented.
 */

import { teamsCanPlayFixture } from "./eligibility"

export interface MatchableTeam {
  id: string
  label: string
  rugbyCode: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
}

export type MatchStrength = "strong" | "good" | "possible"

export interface RankedOpposition {
  team: MatchableTeam
  strength: MatchStrength
  score: number
  reason: string
}

export interface OppositionSuggestion {
  ranked: RankedOpposition[]
  /** Set only when exactly one strong match exists. */
  preselect: MatchableTeam | null
}

function normalisedSquad(squad: string | null): string {
  return squad && squad.toUpperCase() !== "A" ? squad.toUpperCase() : ""
}

/** "boys" and "mixed" are the same ordinary youth pathway; "girls" is its own. */
function pathway(gender: string | null): string {
  if (gender === "girls") return "girls"
  if (gender === "womens") return "womens"
  if (gender === "mens") return "mens"
  return "open"
}

export function suggestOppositionTeam(ours: MatchableTeam, theirs: MatchableTeam[]): OppositionSuggestion {
  // Legal to play (the database trigger's own rule) AND the same pathway: a
  // picker never offers a girls' side to a boys'/mixed side or the reverse
  // (eligibleOppositionCanonicalTypes, strict mode), whatever the trigger allows.
  const eligible = theirs.filter((t) =>
    (ours.gender === "girls") === (t.gender === "girls") &&
    teamsCanPlayFixture(
      { rugbyCode: ours.rugbyCode, category: ours.category, ageGroup: ours.ageGroup, teamNumber: null, gender: ours.gender },
      { rugbyCode: t.rugbyCode, category: t.category, ageGroup: t.ageGroup, teamNumber: null, gender: t.gender },
    ),
  )

  const ranked: RankedOpposition[] = eligible.map((t) => {
    const sameAge = ours.ageGroup === t.ageGroup
    const samePathway = pathway(ours.gender) === pathway(t.gender)
    const sameSquad = normalisedSquad(ours.squadDesignation) === normalisedSquad(t.squadDesignation)
    let score = 0
    if (sameAge) score += 4
    if (samePathway) score += 2
    if (ours.gender !== null && ours.gender === t.gender) score += 1
    if (sameSquad) score += 2
    const strength: MatchStrength = sameAge && samePathway && sameSquad ? "strong" : sameAge && samePathway ? "good" : "possible"
    const reason =
      strength === "strong"
        ? "Same age grade, pathway and squad"
        : strength === "good"
          ? "Same age grade and pathway, a different squad"
          : "Eligible to play, but not the same age grade or pathway"
    return { team: t, strength, score, reason }
  })

  ranked.sort((a, b) => b.score - a.score || a.team.label.localeCompare(b.team.label))
  const strong = ranked.filter((r) => r.strength === "strong")
  return { ranked, preselect: strong.length === 1 ? strong[0].team : null }
}
