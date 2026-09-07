import type { WeatherLocation } from "./types"

/**
 * The forecast window's PURE logic -- horizon, cache lifetime, cache key and
 * kickoff-instant resolution.
 *
 * Deliberately its own dependency-free module (no "server-only", no
 * next/cache), exactly like active-context-rules.ts and
 * fixture-authority-rule.ts before it. These are the rules that decide how
 * often a paid API is called and which hour's weather a parent is shown, so
 * they need standalone regression coverage rather than being reachable only
 * through a rendered page.
 */

/** Beyond this, no forecast is worth showing and none is requested. */
export const FORECAST_HORIZON_DAYS = 7

/** Coordinate precision for the cache key: ~1km, which is the same weather. Prevents two pitches at one club minting two upstream calls. */
const COORD_PRECISION = 2

export function forecastCacheSeconds(leadHours: number): number {
  if (leadHours <= 24) return 30 * 60 // half-hourly near kickoff
  if (leadHours <= 72) return 3 * 60 * 60
  return 12 * 60 * 60
}

/**
 * The cache key deliberately does NOT include the fixture id. Two fixtures at
 * the same place and hour want the same answer, and keying on the fixture
 * would multiply identical upstream calls by the number of fixtures.
 */
export function forecastCacheKey(location: WeatherLocation, whenIso: string): string {
  const lat = location.latitude.toFixed(COORD_PRECISION)
  const lon = location.longitude.toFixed(COORD_PRECISION)
  // Hour granularity: forecasts are not published per minute.
  const hour = whenIso.slice(0, 13)
  return `weather:${lat}:${lon}:${hour}`
}

/**
 * Kickoff as an absolute instant.
 *
 * The fixture stores a local date and a local time; the forecast needs a
 * moment. UK fixtures are Europe/London, where the offset is +00:00 or
 * +01:00 depending on the date -- so this resolves the real offset for that
 * specific date rather than assuming UTC, which would shift a summer kickoff
 * by an hour and fetch the wrong hour's weather.
 */
export function kickoffInstant(kickoffDate: string, kickoffTime: string | null, timeZone = "Europe/London"): string | null {
  if (!kickoffTime) return null
  const [h, m] = kickoffTime.split(":").map(Number)
  if (Number.isNaN(h)) return null
  const [y, mo, d] = kickoffDate.split("-").map(Number)
  if (Number.isNaN(y)) return null

  // Start from the naive UTC reading, then measure how that instant is
  // rendered in the target zone and correct by the difference. Two passes
  // settle it either side of a DST boundary.
  let guess = Date.UTC(y, mo - 1, d, h, m || 0, 0)
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(guess, timeZone)
    const corrected = Date.UTC(y, mo - 1, d, h, m || 0, 0) - offset
    if (corrected === guess) break
    guess = corrected
  }
  return new Date(guess).toISOString()
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - utcMs
}
