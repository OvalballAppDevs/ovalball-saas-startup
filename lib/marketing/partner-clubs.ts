/**
 * The canonical list of clubs Ovalball publicly claims a partnership with.
 *
 * This is a deliberately narrow, explicit list and it is the ONLY source
 * the public partner wall reads from. A club appearing in this file is a
 * public statement that a partnership exists.
 *
 * A club must NEVER be added here because:
 *   - it exists in `club_directory` (that is 1,300+ imported public clubs),
 *   - a logo happens to exist for it,
 *   - it has been claimed by an administrator,
 *   - or a fixture involved it.
 *
 * None of those is a partnership. Add an entry only when there is an
 * explicit, verified agreement with that club, and only with a logo the
 * club has given permission to display.
 *
 * The list is currently empty because no partnership has been verified.
 * The wall renders a truthful "more to be announced" state in that case
 * rather than inventing entries — see components/site/partner-wall.tsx.
 */
export interface PartnerClub {
  /** Stable identifier, never reused. */
  id: string
  /** The club's own name, exactly as the club writes it. */
  name: string
  /**
   * Path to the club's logo under /public. Required: a partner wall entry
   * without a logo would render as a stray text label among images.
   */
  logo: string
  /** Intrinsic logo dimensions, so Next/Image can reserve space (no layout shift). */
  logoWidth: number
  logoHeight: number
  /** Optional link to the club's own site. */
  website?: string
  /** Optional one-line description, used as supporting text where the design allows. */
  description?: string
  /** Ascending. Ties fall back to name order. */
  displayOrder: number
  /** Set false to retire an entry without deleting its history. */
  active: boolean
}

export const PARTNER_CLUBS: PartnerClub[] = [
  // Intentionally empty. See the file comment above before adding anything.
]

/** The partners actually shown, in display order. */
export function getActivePartnerClubs(): PartnerClub[] {
  return PARTNER_CLUBS.filter((club) => club.active).sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)
  )
}

export function hasVerifiedPartners(): boolean {
  return getActivePartnerClubs().length > 0
}
