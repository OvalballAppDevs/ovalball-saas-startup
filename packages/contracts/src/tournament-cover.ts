import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHAT A TOURNAMENT LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * The same chain `venue-cover.ts` and `team-cover.ts` already established, applied to the same problem
 * for a third entity rather than a third mechanism invented alongside them:
 *
 *   1. the tournament's OWN uploaded photo, if the organiser set one (`tournaments.cover_image_path`);
 *   2. a DELIBERATE Ovalball Image Library selection (`tournaments.cover_stock_key`) -- still a choice
 *      the organiser made, just from curated stock rather than an upload;
 *   3. nothing chosen -- which, unlike a venue, is NOT an absence to render as a blank header. Every
 *      tournament is a day out with a photograph behind it, so the client falls back to the canonical
 *      Ovalball default rather than showing a hole.
 *
 * WHY `none` RATHER THAN RESOLVING THE DEFAULT HERE. This package is shared by the website and the
 * native app, and the default is a bundled local asset in one and a file on disk in the other. The
 * resolver's job is to say WHICH of the three answers is true; naming the default is the client's,
 * because only the client knows how to load it. `tournamentCoverPhotoSource` in the mobile app is that
 * last step.
 *
 * ONE SELECTION, EVERY SURFACE. There is no thumbnail cover and no hero cover: the list card, the
 * detail hero and anything built later all call this, so changing the photograph once changes it
 * everywhere by construction rather than by remembering to.
 */
export type TournamentCover = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }

/**
 * The public URL for a tournament cover, or null. Same bucket as team covers, venue covers and article
 * heroes (`club-news-media`) -- a tournament's photograph is published with the club, is not sensitive,
 * and reuses the storage and policy surface that already exists rather than a second bucket for one
 * more pair of columns.
 */
export function tournamentCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  const trimmed = (path ?? "").trim()
  if (!trimmed) return null
  return supabase.storage.from("club-news-media").getPublicUrl(trimmed).data.publicUrl
}

export function resolveTournamentCover(input: {
  supabase: SupabaseClient<Database>
  coverImagePath: string | null | undefined
  coverStockKey: string | null | undefined
}): TournamentCover {
  const cover = tournamentCoverUrlFromPath(input.supabase, input.coverImagePath)
  if (cover) return { kind: "cover", url: cover }
  if (input.coverStockKey) return { kind: "stock", key: input.coverStockKey }
  return { kind: "none" }
}
