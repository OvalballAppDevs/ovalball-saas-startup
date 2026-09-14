import { test } from "node:test"
import assert from "node:assert/strict"

import { contrastRatio, normaliseHex } from "@/lib/club-theme/colour"
import { clubThemeVariables, OVALBALL_DEFAULT_KIT, resolveClubTheme, type ClubTheme } from "@/lib/club-theme/theme"

/**
 * THE CLUB THEME ENGINE: HOME KIT IN, READABLE PAGE OUT.
 *
 * A club never has to understand accessibility. Whatever it chose for its
 * home shirt, every foreground the page uses must clear WCAG AA against what
 * it sits on, and the club's own hue should survive wherever it can.
 */

function assertAccessible(theme: ClubTheme, label: string) {
  assert.ok(theme.contrast.heroText >= 4.5, `${label}: hero text ${theme.contrast.heroText.toFixed(2)}`)
  assert.ok(theme.contrast.heroMuted >= 4.5, `${label}: hero muted text ${theme.contrast.heroMuted.toFixed(2)}`)
  assert.ok(theme.contrast.heroAccent >= 3, `${label}: hero accent separation ${theme.contrast.heroAccent.toFixed(2)}`)
  assert.ok(theme.contrast.onAccent >= 4.5, `${label}: text on hero accent ${theme.contrast.onAccent.toFixed(2)}`)
  assert.ok(theme.contrast.buttonText >= 4.5, `${label}: button text ${theme.contrast.buttonText.toFixed(2)}`)
  assert.ok(theme.contrast.buttonEdge >= 3, `${label}: button against page ${theme.contrast.buttonEdge.toFixed(2)}`)
  assert.ok(theme.contrast.brandInkOnPage >= 4.5, `${label}: brand text on page ${theme.contrast.brandInkOnPage.toFixed(2)}`)
  assert.ok(theme.contrast.brandInkOnTintStrong >= 4.5, `${label}: brand text on tinted card ${theme.contrast.brandInkOnTintStrong.toFixed(2)}`)
  assert.ok(theme.contrast.focusOnLight >= 3, `${label}: focus ring on light ${theme.contrast.focusOnLight.toFixed(2)}`)
  assert.ok(theme.contrast.focusOnHero >= 3, `${label}: focus ring on hero ${theme.contrast.focusOnHero.toFixed(2)}`)
  assert.ok(theme.contrast.bandText >= 4.5, `${label}: text on branded band ${theme.contrast.bandText.toFixed(2)}`)
  // And the reported ratios are the real ones, not a claim.
  assert.equal(theme.contrast.heroText, contrastRatio(theme.hero.foreground, theme.hero.background))
  assert.equal(theme.contrast.buttonText, contrastRatio(theme.brand.onSolid, theme.brand.solid))
}

test("the home kit is the source: its primary colour becomes the hero", () => {
  const theme = resolveClubTheme({ pattern: "HOOPS", primaryColour: "#7A1F3D", secondaryColour: "#FFFFFF", accentColour: null })
  assert.equal(theme.source, "home-kit")
  assert.equal(theme.pattern, "HOOPS")
  assert.equal(theme.hero.background, "#7a1f3d")
  assert.equal(theme.kit.secondary, "#ffffff")
  assert.equal(theme.hero.foreground, "#ffffff")
  assertAccessible(theme, "claret and white")
})

test("dark primary and light secondary: white text on the shirt, the club colour on buttons", () => {
  const theme = resolveClubTheme({ pattern: "HALVES", primaryColour: "#0b3d91", secondaryColour: "#ffffff" })
  assert.equal(theme.brand.solid, "#0b3d91")
  assert.equal(theme.brand.onSolid, "#ffffff")
  assertAccessible(theme, "navy and white")
})

test("white and yellow: the hero stays white with dark text, and the yellow deepens until it can be a button", () => {
  const theme = resolveClubTheme({ pattern: "HOOPS", primaryColour: "#ffffff", secondaryColour: "#ffe600" })
  assert.equal(theme.hero.background, "#ffffff")
  assert.equal(theme.hero.foreground, "#101512")
  // Still a yellow hue, not a grey: red and green channels both well above blue.
  const solid = theme.brand.solid
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(solid.slice(i, i + 2), 16))
  assert.ok(r > b + 40 && g > b + 40, `expected a deepened yellow, got ${solid}`)
  assert.notEqual(theme.hero.plateBorder, "transparent", "a white hero gives the crest plate an edge")
  assert.equal(theme.brand.band, "#ffe600")
  assertAccessible(theme, "white and yellow")
})

test("two light colours: pale blue and white still produce readable text and visible controls", () => {
  const theme = resolveClubTheme({ pattern: "VERTICAL_STRIPES", primaryColour: "#cfe8ff", secondaryColour: "#ffffff" })
  assertAccessible(theme, "pale blue and white")
  assert.equal(theme.hero.accent, theme.hero.foreground, "a trim too close to the shirt becomes the hero's text colour, not an invented grey")
  assert.equal(theme.hero.pattern, "#ffffff", "a visible white stripe is drawn white")
  assert.equal(theme.brand.band, "#cfe8ff", "the band is the kit colour itself")
})

test("no fallback invents a colour the kit does not have", () => {
  const blackNavy = resolveClubTheme({ primaryColour: "#000000", secondaryColour: "#0a1a3a" })
  assert.ok([blackNavy.kit.primary, blackNavy.kit.secondary, blackNavy.hero.foreground].includes(blackNavy.hero.accent), blackNavy.hero.accent)
  const whiteYellow = resolveClubTheme({ primaryColour: "#ffffff", secondaryColour: "#ffe600" })
  assert.equal(whiteYellow.brand.band, "#ffe600", "yellow stays yellow on the Rugby Hub band")
})

test("two dark colours: black and navy are pulled far enough apart to see", () => {
  const theme = resolveClubTheme({ pattern: "HOOPS", primaryColour: "#000000", secondaryColour: "#0a1a3a" })
  assert.ok(contrastRatio("#0a1a3a", "#000000") < 1.6, "the raw kit really is near-invisible")
  assert.ok(contrastRatio(theme.hero.pattern, theme.hero.background) >= 1.6, "the drawn hoops are separated")
  assertAccessible(theme, "black and navy")
})

test("red and green: both colours usable, and neither is the only carrier of meaning", () => {
  const theme = resolveClubTheme({ pattern: "QUARTERS", primaryColour: "#c8102e", secondaryColour: "#046a38" })
  assert.equal(theme.brand.solid, "#c8102e", "the club's main colour leads when it carries a hue")
  assertAccessible(theme, "red and green")
})

test("a missing home kit falls back to Ovalball's colours, not to nothing", () => {
  for (const input of [null, undefined, {}, { primaryColour: null }, { primaryColour: "not-a-colour", secondaryColour: "#ffffff" }]) {
    const theme = resolveClubTheme(input as never)
    assert.equal(theme.source, "ovalball-default")
    assert.equal(theme.hero.background, OVALBALL_DEFAULT_KIT.primaryColour)
    assertAccessible(theme, `fallback ${JSON.stringify(input)}`)
  }
})

test("a solid kit with no second colour still gets a separated accent", () => {
  const theme = resolveClubTheme({ pattern: "SOLID", primaryColour: "#f2a900", secondaryColour: null, accentColour: null })
  assert.equal(theme.pattern, "SOLID")
  assertAccessible(theme, "solid amber")
})

test("an unknown pattern key is drawn as solid rather than guessed", () => {
  assert.equal(resolveClubTheme({ pattern: "STRIPEY", primaryColour: "#046a38" }).pattern, "SOLID")
})

test("extreme and random kits all clear the contrast floor", () => {
  // Deterministic pseudo-random sweep: the property must hold for any kit a
  // club can save, not just the ones a test author thought of.
  let seed = 20270340
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed
  }
  const hex = () => `#${(next() % 0x1000000).toString(16).padStart(6, "0")}`
  const fixed = ["#000000", "#ffffff", "#ffff00", "#00ff00", "#0000ff", "#ff0000", "#808080", "#777777", "#767676", "#595959"]
  const kits: [string, string][] = []
  for (const a of fixed) for (const b of fixed) kits.push([a, b])
  for (let i = 0; i < 400; i++) kits.push([hex(), hex()])
  for (const [primaryColour, secondaryColour] of kits) {
    assertAccessible(resolveClubTheme({ pattern: "HOOPS", primaryColour, secondaryColour }), `${primaryColour}/${secondaryColour}`)
  }
})

test("the theme is exposed only as scoped --club-* variables with valid colours", () => {
  const vars = clubThemeVariables(resolveClubTheme({ primaryColour: "#4b2e83", secondaryColour: "#f2a900" }))
  for (const [key, value] of Object.entries(vars)) {
    assert.match(key, /^--club-[a-z-]+$/)
    assert.ok(value === "transparent" || normaliseHex(value) === value, `${key} = ${value}`)
  }
})

test("the same kit always produces the same theme", () => {
  const input = { pattern: "SASH", primaryColour: "#00594c", secondaryColour: "#ffffff", accentColour: "#f2a900" }
  assert.deepEqual(resolveClubTheme(input), resolveClubTheme({ ...input }))
})
