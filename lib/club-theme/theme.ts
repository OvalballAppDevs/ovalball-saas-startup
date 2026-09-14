import type { KitPattern } from "@/components/club/rugby-kit"

import { contrastRatio, lightness, mix, normaliseHex, readableOn, relativeLuminance, saturation, shiftUntilContrast } from "./colour"

/**
 * THE CLUB THEME ENGINE.
 *
 * One deterministic function from a club's HOME KIT to every colour its
 * digital home uses. There is no "website colour" setting: the home kit a
 * club already chose in Club Settings (club_kits, variant 'primary') is the
 * canonical source of its branding, and this is the only place that turns it
 * into a page.
 *
 * Raw kit colours are never painted straight onto text or controls. A club
 * in white and yellow, black and navy, or red and green must still get a page
 * anyone can read, so every foreground, button, link and focus ring below is
 * chosen by measuring WCAG contrast rather than by what a colour "looks like":
 *
 *   text on any branded surface      >= 4.5 : 1
 *   brand-coloured text on the page  >= 4.5 : 1
 *   buttons and focus rings          >= 3   : 1 against what they sit on
 *   branded bands                    the kit colour itself; text on it >= 4.5 : 1
 *   decorative kit graphics          visibly separated, never relied upon
 *
 * The club's hue is kept wherever it can be: a yellow that is too pale for a
 * button becomes a deeper yellow, not a grey. Only when a hue cannot reach the
 * target at all does the engine fall back to ink or white.
 *
 * State is never carried by colour alone anywhere this theme is used -- a
 * result says "Won", a notice says "Urgent" -- so a red-and-green club cannot
 * accidentally make a loss look like a win.
 */

export const INK = "#101512"
export const WHITE = "#ffffff"
/** The neutral page ground. Not Ovalball green: this is the club's page. */
export const PAGE = "#f6f6f4"
export const CARD = "#ffffff"

/** Ovalball's own colours, for a club that has not set its home kit yet. */
export const OVALBALL_DEFAULT_KIT = {
  pattern: "SOLID" as KitPattern,
  primaryColour: "#123d2c",
  secondaryColour: "#91e3ac",
  accentColour: null,
}

export interface ClubThemeInput {
  pattern?: string | null
  primaryColour?: string | null
  secondaryColour?: string | null
  accentColour?: string | null
}

export interface ClubTheme {
  /** Whether this theme came from the club's own home kit. */
  source: "home-kit" | "ovalball-default"
  pattern: KitPattern
  /** The kit as recorded, for drawing the shirt and its pattern. */
  kit: { primary: string; secondary: string; accent: string | null }
  hero: {
    background: string
    foreground: string
    mutedForeground: string
    /** A second kit colour, separated from the hero enough to see (>= 3:1). */
    accent: string
    onAccent: string
    /** The pattern stripes/hoops drawn behind the hero. */
    pattern: string
    /** Edge around the crest plate, visible when the hero itself is near-white. */
    plateBorder: string
  }
  brand: {
    /** Buttons, badges, the Rugby Hub band. >= 3:1 against the page. */
    solid: string
    onSolid: string
    solidHover: string
    /** Brand-coloured text and links on light surfaces. >= 4.5:1. */
    ink: string
    /** Full-width branded bands: the kit colour itself, with text >= 4.5:1. */
    band: string
    onBand: string
  }
  surface: { page: string; card: string; tint: string; tintStrong: string; border: string }
  focus: { onLight: string; onHero: string }
  /** The measured ratios behind every decision above, for tests and audits. */
  contrast: {
    heroText: number
    heroMuted: number
    heroAccent: number
    onAccent: number
    buttonText: number
    buttonEdge: number
    brandInkOnPage: number
    brandInkOnTintStrong: number
    focusOnLight: number
    focusOnHero: number
    bandText: number
  }
}

const KNOWN_PATTERNS: KitPattern[] = ["SOLID", "HOOPS", "HORIZONTAL_BANDS", "VERTICAL_STRIPES", "HALVES", "QUARTERS", "SASH", "CHEST_BAND", "CONTRAST_SLEEVES"]

function isChromatic(hex: string): boolean {
  const l = lightness(hex)
  return saturation(hex) >= 0.25 && l >= 0.08 && l <= 0.92
}

/**
 * Text for a solid background. Ovalball ink first, because it is the brand's
 * black; but ink is not quite #000, and on a mid-grey neither ink nor white
 * reaches 4.5:1. Pure black or white always does (the worst case is ~4.58:1),
 * so that is the guaranteed fallback.
 */
function textOn(background: string): string {
  const preferred = readableOn(background, INK, WHITE)
  return contrastRatio(preferred, background) >= 4.5 ? preferred : readableOn(background, "#000000", WHITE)
}

/** Move text toward the foreground until it reads at 4.5:1 on the background. */
function mutedOn(background: string, foreground: string): string {
  for (let t = 0.3; t >= 0; t -= 0.02) {
    const candidate = mix(foreground, background, t)
    if (contrastRatio(candidate, background) >= 4.5) return candidate
  }
  return foreground
}

export function resolveClubTheme(input: ClubThemeInput | null | undefined): ClubTheme {
  const recordedPrimary = normaliseHex(input?.primaryColour)
  const source: ClubTheme["source"] = recordedPrimary ? "home-kit" : "ovalball-default"
  const base = recordedPrimary ? input! : OVALBALL_DEFAULT_KIT

  const primary = normaliseHex(base.primaryColour)!
  const accentRaw = normaliseHex(base.accentColour)
  const secondaryRaw = normaliseHex(base.secondaryColour) ?? accentRaw
  const pattern = (KNOWN_PATTERNS as string[]).includes(base.pattern ?? "") ? (base.pattern as KitPattern) : "SOLID"

  // ---------------------------------------------------------------- hero
  // The hero IS the home shirt: its main colour, whatever that is. A white
  // kit gets a white hero with dark text, which is exactly how the club looks.
  const heroBackground = primary
  const heroForeground = textOn(heroBackground)
  const awayFromHero: "darker" | "lighter" = relativeLuminance(heroBackground) > 0.18 ? "darker" : "lighter"

  // The hero's second tone -- its main button and chips -- is the kit's own
  // second colour when that colour already stands clear of the shirt (>= 3:1).
  // When it does not, the engine does NOT invent a new colour: it uses the
  // hero's text colour, so a pale-blue-and-white club gets an ink button and
  // a black-and-navy club a white one, both of which are in the kit's spirit.
  const secondary = secondaryRaw ?? heroForeground
  const heroAccent = contrastRatio(secondary, heroBackground) >= 3 ? secondary : heroForeground
  const onAccent = textOn(heroAccent)

  // The pattern is decoration. A kit's own second colour is drawn as it is
  // whenever it can be seen at all. Two near-identical HUED colours (black and
  // navy) keep their hue and are nudged apart. A near-invisible white or grey
  // trim is never turned into a different grey: the stripe becomes a deeper
  // shade of the shirt instead.
  const deeperShirt = mix(heroBackground, heroForeground, 0.28)
  const heroPattern = !secondaryRaw
    ? deeperShirt
    : contrastRatio(secondaryRaw, heroBackground) >= 1.6 || (!isChromatic(secondaryRaw) && contrastRatio(secondaryRaw, heroBackground) >= 1.15)
      ? secondaryRaw
      : isChromatic(secondaryRaw)
        ? (shiftUntilContrast(secondaryRaw, [heroBackground], 1.6, awayFromHero) ?? deeperShirt)
        : deeperShirt

  const heroMuted = mutedOn(heroBackground, heroForeground)
  const plateBorder = relativeLuminance(heroBackground) > 0.8 ? mix(heroBackground, INK, 0.14) : "transparent"

  // --------------------------------------------------------------- brand
  // Prefer the club's main colour, then its second, if they carry a hue;
  // a black-and-white club is allowed to be black and white.
  const candidates = [primary, secondaryRaw, accentRaw].filter((c): c is string => Boolean(c))
  const preferred =
    candidates.find(isChromatic) ?? [...candidates].sort((a, b) => contrastRatio(b, PAGE) - contrastRatio(a, PAGE))[0]
  const solid = shiftUntilContrast(preferred, [PAGE, CARD], 3, "darker") ?? INK
  const onSolid = textOn(solid)
  const hoverCandidate = mix(solid, onSolid === WHITE ? "#000000" : WHITE, 0.16)
  const solidHover = contrastRatio(onSolid, hoverCandidate) >= 4.5 ? hoverCandidate : solid

  const tint = mix(CARD, solid, 0.06)
  const tintStrong = mix(CARD, solid, 0.13)
  const border = mix(CARD, solid, 0.2)
  const brandInk = shiftUntilContrast(solid, [PAGE, CARD, tintStrong], 4.5, "darker") ?? INK

  // A full-width band is a surface, not a control: it does not need 3:1 against
  // the page, only readable text on it. So it keeps the kit colour exactly --
  // yellow stays yellow -- and textOn guarantees the words on it.
  const band = preferred
  const onBand = textOn(band)

  const focusOnLight = shiftUntilContrast(solid, [PAGE, CARD, tintStrong], 3, "darker") ?? INK
  const focusOnHero = heroForeground

  return {
    source,
    pattern,
    kit: { primary, secondary, accent: accentRaw },
    hero: {
      background: heroBackground,
      foreground: heroForeground,
      mutedForeground: heroMuted,
      accent: heroAccent,
      onAccent,
      pattern: heroPattern,
      plateBorder,
    },
    brand: { solid, onSolid, solidHover, ink: brandInk, band, onBand },
    surface: { page: PAGE, card: CARD, tint, tintStrong, border },
    focus: { onLight: focusOnLight, onHero: focusOnHero },
    contrast: {
      heroText: contrastRatio(heroForeground, heroBackground),
      heroMuted: contrastRatio(heroMuted, heroBackground),
      heroAccent: contrastRatio(heroAccent, heroBackground),
      onAccent: contrastRatio(onAccent, heroAccent),
      buttonText: contrastRatio(onSolid, solid),
      buttonEdge: Math.min(contrastRatio(solid, PAGE), contrastRatio(solid, CARD)),
      brandInkOnPage: Math.min(contrastRatio(brandInk, PAGE), contrastRatio(brandInk, CARD)),
      brandInkOnTintStrong: contrastRatio(brandInk, tintStrong),
      focusOnLight: Math.min(contrastRatio(focusOnLight, PAGE), contrastRatio(focusOnLight, CARD)),
      focusOnHero: contrastRatio(focusOnHero, heroBackground),
      bandText: contrastRatio(onBand, band),
    },
  }
}

/**
 * The theme as CSS custom properties, scoped to one club's page. Components
 * read `var(--club-…)`; nothing outside lib/club-theme knows a hex value.
 */
export function clubThemeVariables(theme: ClubTheme): Record<`--club-${string}`, string> {
  return {
    "--club-hero": theme.hero.background,
    "--club-hero-fg": theme.hero.foreground,
    "--club-hero-muted": theme.hero.mutedForeground,
    "--club-hero-accent": theme.hero.accent,
    "--club-on-hero-accent": theme.hero.onAccent,
    "--club-hero-pattern": theme.hero.pattern,
    "--club-plate-border": theme.hero.plateBorder,
    "--club-solid": theme.brand.solid,
    "--club-on-solid": theme.brand.onSolid,
    "--club-solid-hover": theme.brand.solidHover,
    "--club-ink": theme.brand.ink,
    "--club-band": theme.brand.band,
    "--club-on-band": theme.brand.onBand,
    "--club-page": theme.surface.page,
    "--club-card": theme.surface.card,
    "--club-tint": theme.surface.tint,
    "--club-tint-strong": theme.surface.tintStrong,
    "--club-border": theme.surface.border,
    "--club-focus": theme.focus.onLight,
    "--club-focus-hero": theme.focus.onHero,
  }
}
