/**
 * Colour arithmetic for the club theme engine.
 *
 * Deliberately small and dependency-free: sRGB hex in, sRGB hex out, with
 * WCAG 2.x relative luminance and contrast ratio as the only measure of
 * "readable". Every decision the theme engine makes about text or controls is
 * a contrast calculation here, never a judgement about what a colour looks
 * like.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX = /^#?([0-9a-f]{6})$/i

/** A six-digit hex colour, lower-cased with a leading #, or null if it is not one. */
export function normaliseHex(value: string | null | undefined): string | null {
  if (!value) return null
  const m = HEX.exec(value.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim())
  if (!m) throw new Error(`Not a hex colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Linear mix in sRGB: t = 0 is `a`, t = 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

interface Hsl {
  h: number
  s: number
  l: number
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const hue = (p: number, q: number, t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 }
}

export function lightness(hex: string): number {
  return rgbToHsl(hexToRgb(hex)).l
}

export function saturation(hex: string): number {
  return rgbToHsl(hexToRgb(hex)).s
}

/**
 * The same hue, moved lighter or darker in small steps until it reaches
 * `target` contrast against every colour in `against`. Keeps the club's hue
 * and saturation, so "a darker version of our yellow" is still recognisably
 * theirs. Returns null if the target cannot be reached in that direction.
 */
export function shiftUntilContrast(
  hex: string,
  against: string[],
  target: number,
  direction: "darker" | "lighter"
): string | null {
  const hsl = rgbToHsl(hexToRgb(hex))
  const meets = (candidate: string) => against.every((bg) => contrastRatio(candidate, bg) >= target)
  if (meets(hex)) return hex
  for (let step = 1; step <= 100; step++) {
    const l = direction === "darker" ? hsl.l - step * 0.01 : hsl.l + step * 0.01
    if (l < 0 || l > 1) break
    const candidate = rgbToHex(hslToRgb({ ...hsl, l }))
    if (meets(candidate)) return candidate
  }
  return null
}

/** Whichever of the two text colours reads better on `background`. */
export function readableOn(background: string, dark: string, light: string): string {
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light
}
