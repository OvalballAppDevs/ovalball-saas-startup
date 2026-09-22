/**
 * A CLUB'S KIT, AS DATA.
 *
 * The TYPE only, lifted out of `components/club/rugby-kit.tsx` so that a reader can carry a club's kit
 * without the React component that draws it. The mobile agenda needs the four fields; it draws them
 * itself, because a web SVG is not a React Native one.
 *
 * The strings are the database's own `club_kits` values. Nothing here decides a colour.
 */

export type KitPattern =
  | "SOLID"
  | "HOOPS"
  | "HORIZONTAL_BANDS"
  | "VERTICAL_STRIPES"
  | "QUARTERS"
  | "HALVES"
  | "SASH"
  | "CHEST_BAND"
  | "CONTRAST_SLEEVES"

export interface KitConfig {
  pattern: KitPattern
  primaryColour: string
  secondaryColour: string | null
  accentColour: string | null
}
