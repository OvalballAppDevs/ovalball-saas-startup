import { contrastRatio, lightness, mix } from "./colour"
import type { ClubTheme } from "./theme"

/**
 * A CLUB'S COLOURS, MADE SAFE ON A DARK OVALBALL GROUND.
 *
 * `resolveClubTheme` already turns the canonical home kit (`club_kits`, variant
 * 'primary') into a measured palette -- but it measures everything against a LIGHT
 * page, because that is what a club's web home is. The app's Parent Home is deep
 * forest, and a kit colour that reads perfectly on white can be invisible on it: a
 * navy club on a forest ground is two dark blues nobody can tell apart.
 *
 * So this is the same canonical truth projected onto the other ground. It adds no
 * source and invents no colour: every value below is the club's own kit colour,
 * lightened only as far as it must be to be seen.
 *
 * OVALBALL REMAINS THE APPLICATION. These are ACCENTS -- an edge, a ball, a rule
 * beside an announcement -- never the page. A club in bright yellow does not get a
 * yellow app, and a club in near-black does not get an invisible one; both get a
 * legible highlight and the forest stays underneath. Accessibility wins over
 * literal kit reproduction, every time.
 *
 * AND IT IS ONE SOURCE. A Club Admin changing the home kit on the web changes
 * `club_kits`; the next canonical read projects the new colours here. There is no
 * mobile colour table, no per-club mapping and nothing to synchronise.
 */

/** How far a colour must stand off the forest ground to count as visible. */
const MINIMUM_ON_DARK = 3

/**
 * How far the two accents must stand off EACH OTHER.
 *
 * A club whose kit is two shades of one blue would otherwise get two accents
 * nobody can tell apart, and a ball drawn in them looks like one colour badly
 * printed. Modest on purpose: this is two colours being distinguishable, not text
 * being readable.
 */
const SEPARATION = 1.4

export interface ClubAccents {
  /** Whether these came from the club's own kit or from Ovalball's default. */
  source: ClubTheme["source"]
  /** The club's first colour, lightened only as far as it must be to be seen on forest. */
  primary: string
  /** Their second, kept distinct from the first so a two-colour club reads as two colours. */
  secondary: string
  /** Text that reads on `primary` when it is used as a small filled ground. */
  onPrimary: string
  /** A barely-there wash of the club's colour, for a card's own surface on forest. */
  wash: string
  /** A hairline of the club's colour, for an edge or a rule. */
  edge: string
  /** The measured ratios, so a test can assert them rather than trust them. */
  contrast: { primaryOnDark: number; secondaryOnDark: number; onPrimary: number; primaryVsSecondary: number }
}

/** Lighten toward white until the colour stands off the ground, or give up honestly. */
function liftOnto(colour: string, ground: string, minimum: number): string {
  if (contrastRatio(colour, ground) >= minimum) return colour
  for (let t = 0.08; t <= 1; t += 0.06) {
    const candidate = mix("#ffffff", colour, t)
    if (contrastRatio(candidate, ground) >= minimum) return candidate
  }
  return "#ffffff"
}

/** Text on a small filled patch of the club's colour: ink or white, whichever reads. */
function inkFor(background: string): string {
  return contrastRatio("#101512", background) >= contrastRatio("#ffffff", background) ? "#101512" : "#ffffff"
}

export function clubAccentsOnDark(theme: ClubTheme, ground: string): ClubAccents {
  const primary = liftOnto(theme.kit.primary, ground, MINIMUM_ON_DARK)

  /*
    THE SECOND COLOUR HAS TO BE A SECOND COLOUR.

    A club whose kit is two shades of the same blue, or whose accent is simply a
    darker primary, would otherwise get two accents nobody can tell apart -- and a
    ball drawn in them would look like one colour badly printed. Where the kit's
    own second colour does not separate, the club's third is tried, and failing
    that the first is pushed away from itself. Never a colour from outside the kit.
  */
  const candidates = [theme.kit.secondary, theme.kit.accent].filter((c): c is string => Boolean(c))
  let secondary: string | null = null
  for (const candidate of candidates) {
    const lifted = liftOnto(candidate, ground, MINIMUM_ON_DARK)
    if (contrastRatio(lifted, primary) >= SEPARATION) {
      secondary = lifted
      break
    }
  }
  if (!secondary) {
    /*
      PUSH THE CLUB'S OWN COLOUR AWAY FROM ITSELF rather than borrowing one from
      outside the kit. A club in two blues gets a light blue and a dark blue, which
      is what they actually wear; giving them an invented third colour would be the
      app deciding what their second colour is.

      Lifting the primary onto forest can land it close to a lifted secondary, so
      the step grows until the two genuinely separate.
    */
    const away = lightness(primary) > 0.5 ? "#000000" : "#ffffff"
    for (let t = 0.3; t <= 0.9; t += 0.1) {
      const candidate = liftOnto(mix(away, primary, t), ground, MINIMUM_ON_DARK)
      if (contrastRatio(candidate, primary) >= SEPARATION) {
        secondary = candidate
        break
      }
    }
    secondary = secondary ?? liftOnto(mix(away, primary, 0.9), ground, MINIMUM_ON_DARK)
  }

  const onPrimary = inkFor(primary)
  return {
    source: theme.source,
    primary,
    secondary,
    onPrimary,
    // A WASH, NOT A PAINT. Eight per cent of the club's colour over the forest --
    // enough that a card feels theirs, far too little to fight the text on it.
    wash: mix(primary, ground, 0.08),
    edge: mix(primary, ground, 0.35),
    contrast: {
      primaryOnDark: contrastRatio(primary, ground),
      secondaryOnDark: contrastRatio(secondary, ground),
      onPrimary: contrastRatio(onPrimary, primary),
      primaryVsSecondary: contrastRatio(primary, secondary),
    },
  }
}
