import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHAT A TEAM LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * ONE deterministic chain, in one place -- the same reasoning `club-logo.ts` already applies to a
 * club's crest: ten hand-written fallback chains became one resolver precisely so a crest could never
 * be right on one screen and missing on the next, and a team cover gets the same treatment rather than
 * a second one invented alongside it.
 *
 * The order, and why:
 *
 *   1. the team's OWN cover photo, if somebody at the club has set one (`teams.cover_image_path`);
 *   2. a DELIBERATE Ovalball Image Library selection (`teams.cover_stock_key`, Section 5) -- still a
 *      choice somebody at the club made, just from curated stock rather than an upload;
 *   3. the club's crest, which every team at that club already shares and which `club-logo.ts` owns;
 *   4. nothing -- and "nothing" is a real answer. A team with no imagery gets a plain header rather
 *      than a stock photograph of somebody else's rugby, because a fabricated picture of a team is
 *      worse than none.
 *
 * `kind` is returned so the caller can treat the cases differently without re-deriving which one it
 * got: a cover photo is decorative and fills the banner, a crest is an identity mark and is centred
 * rather than stretched. A `stock` result carries the key rather than a URL -- the actual bundled asset
 * is a platform concern (`apps/mobile/src/team/cover-library.ts`) this package-agnostic module does not
 * resolve.
 */
export type TeamCover = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "crest"; url: string } | { kind: "none" }

/**
 * The public URL for a team cover, or null.
 *
 * Deliberately the same bucket as a club article's hero image (`club-news-media`): a team cover is
 * identity imagery published with the club, exactly like a crest, and it reuses the storage and
 * policies that already exist for that rather than introducing a second media architecture for one
 * column. Uses the storage SDK's own public-URL lookup, the same call `clubLogoUrlFromPath` and
 * `clubCoverUrlFromPath` make, rather than hand-building the URL string.
 */
export function teamCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  const trimmed = (path ?? "").trim()
  if (!trimmed) return null
  return supabase.storage.from("club-news-media").getPublicUrl(trimmed).data.publicUrl
}

/**
 * The chain, resolved.
 *
 * `crestUrl` is passed in already resolved by `club-logo.ts`'s own resolver rather than re-derived
 * here: that file owns the club-crest question, including the directory fallback, and asking it a
 * second way is the exact pattern this file exists to avoid repeating.
 */
export function resolveTeamCover(input: {
  supabase: SupabaseClient<Database>
  coverImagePath: string | null | undefined
  coverStockKey: string | null | undefined
  crestUrl: string | null
}): TeamCover {
  const cover = teamCoverUrlFromPath(input.supabase, input.coverImagePath)
  if (cover) return { kind: "cover", url: cover }
  if (input.coverStockKey) return { kind: "stock", key: input.coverStockKey }
  if (input.crestUrl) return { kind: "crest", url: input.crestUrl }
  return { kind: "none" }
}
