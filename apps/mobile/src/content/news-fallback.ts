import type { ImageSourcePropType } from "react-native"

import { editorial } from "../components/home/editorial"

/**
 * THE ONE NEWS FALLBACK, by the story's category: Home's rail, the club's own rail and every story card ask
 * this rather than each keeping a copy of the rule. A story's own picture always wins; this is decorative,
 * drawn only from the app's own editorial photographs (`editorial.news`).
 */
export function newsFallbackImage(categoryLabel: string): ImageSourcePropType | null {
  const c = categoryLabel.toLowerCase()
  if (/match|fixture|result/.test(c)) return editorial.news.matchday
  if (/train/.test(c)) return editorial.news.training
  if (/club|community|social|event/.test(c)) return editorial.news.community
  return editorial.news.general
}
