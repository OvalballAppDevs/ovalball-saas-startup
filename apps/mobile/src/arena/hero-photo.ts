import { useEffect, useMemo, useState } from "react"
import { Image, type ImageProps } from "expo-image"

import { pitchPhoto, venuePhoto } from "../fixtures/match-centre/facility-images"
import { libraryAsset, stockAsset } from "../media/stock-assets"
import { arenaHeroCandidates, heroUnsuitable, type HeroCandidate, type HeroPitch, type HeroUnsuitable, type HeroVenue } from "./hero-photo-choice"

/** Ovalball's Arena picture: an approved library aerial of a whole community rugby ground -- several pitches,
 * H-shaped posts, a modest clubhouse -- for a club with no picture of its own estate yet. */
const ARENA_LIBRARY_PICTURE = libraryAsset("arena-estate-01")

export type ArenaHeroPhoto = {
  candidate: HeroCandidate
  source: ImageProps["source"]
  /** Ovalball's picture rather than the club's own -- marked Illustrative wherever it is shown. */
  illustrative: boolean
  /** Ovalball's aerial is framed for its clubhouse and posts; a club's photograph is centred. */
  contentPosition: ImageProps["contentPosition"]
  /** The club's own pictures passed over for this one, and why -- Arena Settings says so. */
  passedOver: { candidate: HeroCandidate; reason: HeroUnsuitable | "could not be loaded" }[]
}

function sourceFor(c: HeroCandidate): ImageProps["source"] | null {
  switch (c.origin) {
    case "VENUE_PHOTO":
      return venuePhoto({ coverImagePath: c.path, coverStockKey: null }, c.venueId)
    case "VENUE_LIBRARY":
      return stockAsset(c.stockKey) ?? null
    case "PITCH_PHOTO":
      return pitchPhoto({ coverImagePath: c.path, coverStockKey: null }, c.pitchId)
    case "ARENA_LIBRARY":
      return ARENA_LIBRARY_PICTURE
  }
}

/**
 * THE ARENA PICTURE, CHOSEN (see `hero-photo-choice.ts` for the order). Each of the club's own candidates is
 * loaded and measured BEFORE it is shown, so a photograph too small or the wrong shape for the banner is passed
 * over without ever flashing up; the first that fits is handed back already in memory, ready to draw. Until the
 * Arena data arrives there is no answer (null) and the banner stays its forest ground rather than showing
 * Ovalball's picture only to swap it for the club's a moment later.
 */
export function useArenaHeroPhoto(estate: { venues: readonly HeroVenue[]; pitches: readonly HeroPitch[] } | null): ArenaHeroPhoto | null {
  const candidates = useMemo(() => (estate ? arenaHeroCandidates(estate) : null), [estate])
  // What the candidates ARE decides, not which object carried them: a refresh with the same pictures changes nothing.
  const key = candidates ? JSON.stringify(candidates) : null
  const [photo, setPhoto] = useState<ArenaHeroPhoto | null>(null)

  useEffect(() => {
    if (!candidates) return
    let alive = true
    void (async () => {
      const passedOver: ArenaHeroPhoto["passedOver"] = []
      for (const candidate of candidates) {
        const source = sourceFor(candidate)
        if (source === null) continue
        if (candidate.origin === "ARENA_LIBRARY") {
          if (alive) setPhoto({ candidate, source, illustrative: true, contentPosition: { top: "38%" }, passedOver })
          return
        }
        try {
          // Measured once, then drawn from its own address like every other picture in the app (the load has
          // already put it in the image cache, so nothing is fetched twice).
          const image = await Image.loadAsync(source as Parameters<typeof Image.loadAsync>[0])
          const reason = heroUnsuitable({ width: image.width * image.scale, height: image.height * image.scale })
          if (!reason) {
            if (alive) setPhoto({ candidate, source, illustrative: candidate.ownership === "ovalball", contentPosition: "center", passedOver })
            return
          }
          passedOver.push({ candidate, reason })
        } catch {
          passedOver.push({ candidate, reason: "could not be loaded" })
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the candidates' content
  }, [key])

  return photo
}
