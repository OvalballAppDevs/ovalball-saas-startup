/**
 * WHAT A TEAM LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * ONE deterministic chain, in one place. Step 6 removed ten hand-written
 * fallback chains for club logos and replaced them with a single resolver
 * precisely so that a crest could never be right on one screen and missing on
 * the next; adding a second chain for team covers would undo that lesson on the
 * way past.
 *
 * The order, and why:
 *
 *   1. the team's OWN cover photo, if somebody at the club has set one;
 *   2. the club's crest, which every team at that club already shares and
 *      which Step 6's resolver owns;
 *   3. nothing -- and "nothing" is a real answer. A team with no imagery gets
 *      a plain header rather than a stock photograph of somebody else's rugby,
 *      because a fabricated picture of a team is worse than none.
 *
 * `kind` is returned so the caller can treat the cases differently without
 * re-deriving which one it got: a cover photo is decorative and fills the
 * banner, a crest is an identity mark and is centred rather than stretched.
 */
export type TeamCover =
  | { kind: "cover"; url: string }
  | { kind: "crest"; url: string }
  | { kind: "none" }

const COVER_BUCKET = "club-news-media"

/**
 * The public URL for a team cover, or null.
 *
 * Deliberately the same bucket and the same shape as a club article's hero
 * image: a team cover is identity imagery published with the club, exactly like
 * a crest, and it reuses the storage and policies that already exist for that
 * rather than introducing a second media architecture for one column.
 */
export function teamCoverUrl(coverImagePath: string | null | undefined, supabaseUrl: string): string | null {
  const path = (coverImagePath ?? "").trim()
  if (!path) return null
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${COVER_BUCKET}/${path}`
}

/**
 * The chain, resolved.
 *
 * `crestUrl` is passed in already resolved by Step 6's own club-logo resolver
 * (`lib/app-context/club-logo.ts`) rather than re-derived here: that file owns
 * the club-crest question, including the directory fallback, and asking it a
 * second way is the exact pattern Step 6 removed.
 */
export function resolveTeamCover(input: {
  coverImagePath: string | null | undefined
  crestUrl: string | null
  supabaseUrl: string
}): TeamCover {
  const cover = teamCoverUrl(input.coverImagePath, input.supabaseUrl)
  if (cover) return { kind: "cover", url: cover }
  if (input.crestUrl) return { kind: "crest", url: input.crestUrl }
  return { kind: "none" }
}
