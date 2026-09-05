/**
 * Age-grade (youth) rugby uses Boys/Girls/Mixed; senior/adult rugby uses
 * Men's/Women's -- two different vocabularies for two different rugby
 * contexts, never interchanged. This is the one place a raw teams.gender
 * value gets turned into display text, so every surface (teams list, team
 * detail, opponent resolver) reads the same way.
 */
export function formatGenderLabel(gender: string | null): string | null {
  switch (gender) {
    case "boys":
      return "Boys"
    case "girls":
      return "Girls"
    case "mixed":
      return "Mixed"
    case "mens":
      return "Men's"
    case "womens":
      return "Women's"
    default:
      return null
  }
}
