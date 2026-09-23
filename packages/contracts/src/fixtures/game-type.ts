/**
 * THE MATCH-TYPE TAXONOMY — ONE LIST, ONE TRUTH, BOTH CLIENTS.
 *
 * `fixtures.game_type` is the canonical field and the database constrains it:
 *
 *   check (game_type in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match'))
 *
 * The list below is that constraint, and a value outside it cannot be written.
 *
 * WHY IT MOVED. It lived in `app/(app)/admin/fixtures/types.ts` -- a Next.js app
 * route -- so React Native could not reach it, and a phone showing a match type
 * would have had to keep its own copy of the four words. A second list is how a
 * taxonomy starts to drift, and this one is edited on the web by a Fixture
 * Secretary and read on a phone by a parent: the same record, and it must read the
 * same on both. The web keeps importing it from where it always did.
 *
 * A COMPETITION IS NOT A MATCH TYPE. `fixtures.competition_edition_id` records
 * membership of a canonical competition and is its own concept with its own
 * authority; nothing here derives one from the other, and nothing infers "League"
 * from the presence of an edition. That would be a second taxonomy wearing the
 * first one's clothes.
 *
 * AND A FIXTURE WITH NOTHING RECORDED IS NOT "FRIENDLY". It is a fixture with no
 * match type recorded, and inventing a default is exactly how a taxonomy acquires
 * a value nobody chose.
 */

export const GAME_TYPE_OPTIONS = ["Friendly", "League Fixture", "Cup Fixture", "Scheduled Match"] as const

export type GameType = (typeof GAME_TYPE_OPTIONS)[number]

/**
 * What a fixture's match type is CALLED.
 *
 * Presentation only, and deliberately the stored value itself: the canonical
 * values are already the words a person reads, so translating them here would be
 * a second vocabulary for the same four things. Null where nothing is recorded,
 * so a surface can show nothing rather than a guess.
 */
export function matchTypeLabel(gameType: string | null | undefined): string | null {
  const value = (gameType ?? "").trim()
  return value.length > 0 ? value : null
}

/** True where the stored value is one the canonical taxonomy actually contains. */
export function isCanonicalGameType(value: string | null | undefined): value is GameType {
  return GAME_TYPE_OPTIONS.includes((value ?? "").trim() as GameType)
}
