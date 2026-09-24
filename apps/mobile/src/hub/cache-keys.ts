/**
 * THE CACHE KEY CARRIES EVERY DIMENSION THAT CHANGES THE ANSWER.
 *
 * Most Hub bundles are the same for every viewer -- the shared readers take no
 * identity, and the website renders the same rows to everybody -- so they are
 * keyed by domain alone. Two are not:
 *
 *   Positions   the pitch and the positions are per CODE; the age-stage banner
 *               is per REGULATORY IDENTITY (hub_position_age_stage)
 *   Skills      the technique steps and the contact gate are per REGULATORY
 *               IDENTITY (get_hub_regulatory_fact_applies)
 *
 * Their keys name the identity, so U8's bundle can never be served to U12.
 * Rules, Safeguarding and Player Welfare are not cached at all: each screen
 * reads its team's answer fresh and resets when the team changes.
 */
export function positionsCacheKey(code: "union" | "league", regulatoryIdentityId: string | null): string {
  return `positions:${code}:${regulatoryIdentityId ?? "none"}`
}

export function skillsCacheKey(regulatoryIdentityId: string | null): string {
  return `skills:${regulatoryIdentityId ?? "none"}`
}

/** The domains whose shared reader takes no identity: one bundle for everybody, exactly as on the web. */
export const UNIVERSAL_BUNDLES = ["game", "glossary", "officiating", "competitions", "international", "clubs", "people", "development", "coaching", "parents", "story"] as const
