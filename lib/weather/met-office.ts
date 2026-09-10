import "server-only"

import type { WeatherCondition, WeatherLocation, WeatherProvider, WeatherResult } from "./types"

/**
 * Met Office Weather DataHub -- site-specific forecast adapter.
 *
 * THE ONLY FILE THAT KNOWS THE PROVIDER IS THE MET OFFICE. Everything above
 * this consumes the normalized contract in ./types, so replacing or adding a
 * provider never touches a Match Centre component.
 *
 * CREDENTIALS
 *
 * Read server-side only, from `process.env.MET_OFFICE_API_KEY`. This module
 * imports "server-only", so a client component importing it is a build
 * error rather than a leaked key. The variable is deliberately NOT prefixed
 * `NEXT_PUBLIC_`, which is what would inline it into the browser bundle.
 *
 * The key is never logged, never returned in a result, and never included in
 * a diagnostic string -- diagnostics carry a status code and nothing else,
 * because upstream error bodies can echo request details.
 *
 * Required environment variable NAMES (values belong in .env.local, which is
 * gitignored, or in the deployment platform's own secret store):
 *
 *   MET_OFFICE_API_KEY   -- DataHub API key. Absent => PROVIDER_UNAVAILABLE.
 *   MET_OFFICE_API_URL   -- optional base URL override for the site-specific
 *                           endpoint. Defaults to the documented DataHub host.
 *
 * HORIZON
 *
 * The site-specific service publishes hourly steps for the next two days and
 * three-hourly steps out to a week. Past that there is no forecast worth
 * showing a parent, so the adapter reports TOO_EARLY_FOR_FORECAST rather
 * than dressing a long-range guess as a real one.
 */

const DEFAULT_BASE_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point"

/** Hourly detail is only published for the first couple of days; three-hourly carries the rest of the week. */
const HOURLY_HORIZON_HOURS = 48
export const MET_OFFICE_HORIZON_DAYS = 7

const REQUEST_TIMEOUT_MS = 6000

/**
 * Met Office significant-weather codes -> our normalized vocabulary.
 * Anything unrecognised becomes UNKNOWN rather than being guessed at; the
 * card then shows temperature without inventing a condition.
 */
const SIGNIFICANT_WEATHER: Record<number, { condition: WeatherCondition; label: string }> = {
  0: { condition: "CLEAR", label: "Clear night" },
  1: { condition: "CLEAR", label: "Sunny" },
  2: { condition: "PARTLY_CLOUDY", label: "Partly cloudy" },
  3: { condition: "PARTLY_CLOUDY", label: "Partly cloudy" },
  5: { condition: "MIST", label: "Mist" },
  6: { condition: "FOG", label: "Fog" },
  7: { condition: "CLOUDY", label: "Cloudy" },
  8: { condition: "CLOUDY", label: "Overcast" },
  9: { condition: "LIGHT_RAIN", label: "Light showers" },
  10: { condition: "LIGHT_RAIN", label: "Light showers" },
  11: { condition: "LIGHT_RAIN", label: "Drizzle" },
  12: { condition: "LIGHT_RAIN", label: "Light rain" },
  13: { condition: "RAIN", label: "Heavy showers" },
  14: { condition: "RAIN", label: "Heavy showers" },
  15: { condition: "HEAVY_RAIN", label: "Heavy rain" },
  16: { condition: "SLEET", label: "Sleet showers" },
  17: { condition: "SLEET", label: "Sleet showers" },
  18: { condition: "SLEET", label: "Sleet" },
  19: { condition: "HAIL", label: "Hail showers" },
  20: { condition: "HAIL", label: "Hail showers" },
  21: { condition: "HAIL", label: "Hail" },
  22: { condition: "SNOW", label: "Light snow showers" },
  23: { condition: "SNOW", label: "Light snow showers" },
  24: { condition: "SNOW", label: "Light snow" },
  25: { condition: "SNOW", label: "Heavy snow showers" },
  26: { condition: "SNOW", label: "Heavy snow showers" },
  27: { condition: "SNOW", label: "Heavy snow" },
  28: { condition: "THUNDER", label: "Thundery showers" },
  29: { condition: "THUNDER", label: "Thundery showers" },
  30: { condition: "THUNDER", label: "Thunder" },
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

export function compassFromDegrees(deg: number | null | undefined): string | null {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return null
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

/** Metres per second -> miles per hour, the unit a UK touchline uses. */
export function msToMph(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return null
  return Math.round(ms * 2.236936)
}

/**
 * A timestep, in EITHER resolution.
 *
 * The two DataHub series do not use the same field names, and that difference
 * is not cosmetic -- it silently disabled the forecast for most fixtures:
 *
 *              hourly                      three-hourly
 *   temp       screenTemperature           (absent -- max/minScreenAirTemp)
 *   feels      feelsLikeTemperature        feelsLikeTemp
 *
 * The adapter read only the hourly names, so every fixture beyond 48 hours --
 * which is nearly all of them, and every fixture at the moment a parent first
 * looks -- resolved to "timestep carried no temperature" and rendered the
 * unavailable card. It looked exactly like a missing credential, which is how
 * it survived: nothing was broken, there was just never any weather.
 */
interface TimeStep {
  time?: string
  /** Hourly series. */
  screenTemperature?: number
  /** Three-hourly series publishes the interval's bounds rather than a point reading. */
  maxScreenAirTemp?: number
  minScreenAirTemp?: number
  /** Hourly spells it out; three-hourly abbreviates it. */
  feelsLikeTemperature?: number
  feelsLikeTemp?: number
  probOfPrecipitation?: number
  significantWeatherCode?: number
  windSpeed10m?: number
  windDirectionFrom10m?: number
  [k: string]: unknown
}

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null)

/**
 * The temperature this step describes.
 *
 * Hourly gives a point reading. Three-hourly gives the interval's own max and
 * min, so the midpoint is used -- both bounds are the provider's, and the
 * midpoint of a three-hour block is what that block is describing. It is a
 * reading of published data, never a guess: with neither field present this
 * returns null and the card says there is no forecast.
 */
export function stepTemperature(step: TimeStep): number | null {
  const direct = num(step.screenTemperature)
  if (direct !== null) return direct
  const max = num(step.maxScreenAirTemp)
  const min = num(step.minScreenAirTemp)
  if (max !== null && min !== null) return (max + min) / 2
  return max ?? min
}

/** "Feels like", under whichever name this series uses for it. */
export function stepFeelsLike(step: TimeStep): number | null {
  return num(step.feelsLikeTemperature) ?? num(step.feelsLikeTemp)
}

/**
 * Picks the timestep closest to kickoff.
 *
 * Deliberately "closest" rather than "the step containing kickoff": a
 * three-hourly series has no step containing 10:30, and rejecting the
 * forecast because the grid does not line up with the whistle would be
 * pedantic. A step more than 3 hours away from kickoff is not used, because
 * at that distance it stops describing the match.
 */
export function pickClosestStep(steps: TimeStep[], targetIso: string): TimeStep | null {
  const target = Date.parse(targetIso)
  if (Number.isNaN(target)) return null
  let best: TimeStep | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const s of steps) {
    if (!s?.time) continue
    const t = Date.parse(s.time)
    if (Number.isNaN(t)) continue
    const delta = Math.abs(t - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = s
    }
  }
  return bestDelta <= 3 * 60 * 60 * 1000 ? best : null
}

export function normalizeStep(step: TimeStep, targetIso: string, fetchedAt: string): WeatherResult {
  const temp = stepTemperature(step)
  if (temp === null) {
    return { state: "FORECAST_NOT_AVAILABLE", forecast: null, diagnostic: "timestep carried no temperature" }
  }
  const code = typeof step.significantWeatherCode === "number" ? SIGNIFICANT_WEATHER[step.significantWeatherCode] : undefined
  const prob = typeof step.probOfPrecipitation === "number" ? Math.max(0, Math.min(100, Math.round(step.probOfPrecipitation))) : null

  return {
    state: "FORECAST_AVAILABLE",
    forecast: {
      forecastFor: step.time ?? targetIso,
      temperatureC: Math.round(temp),
      feelsLikeC: stepFeelsLike(step) !== null ? Math.round(stepFeelsLike(step)!) : null,
      precipitationProbability: prob,
      condition: code?.condition ?? "UNKNOWN",
      conditionLabel: code?.label ?? "Forecast",
      windSpeedMph: msToMph(step.windSpeed10m),
      windDirection: compassFromDegrees(step.windDirectionFrom10m),
      provider: "Met Office",
      // Required wherever Met Office data is displayed.
      attribution: "Contains public sector information licensed under the Open Government Licence. Source: Met Office.",
      fetchedAt,
    },
  }
}

/** Hours between now and the target, used to choose the timestep resolution and to decide whether to ask at all. */
export function leadHours(whenIso: string, nowMs: number = Date.now()): number {
  return (Date.parse(whenIso) - nowMs) / 3_600_000
}

export function createMetOfficeProvider(apiKey: string, baseUrl: string = process.env.MET_OFFICE_API_URL || DEFAULT_BASE_URL): WeatherProvider {
  return {
    name: "Met Office",
    horizonDays: MET_OFFICE_HORIZON_DAYS,

    async getForecast(location: WeatherLocation, whenIso: string): Promise<WeatherResult> {
      const lead = leadHours(whenIso)
      if (lead > MET_OFFICE_HORIZON_DAYS * 24) {
        return { state: "TOO_EARLY_FOR_FORECAST", forecast: null }
      }
      // A kickoff comfortably in the past has no forecast to offer, and
      // asking for one would burn quota on a fixture already played.
      if (lead < -6) {
        return { state: "FORECAST_NOT_AVAILABLE", forecast: null, diagnostic: "kickoff is in the past" }
      }

      const resolution = lead <= HOURLY_HORIZON_HOURS ? "hourly" : "three-hourly"
      const url = `${baseUrl}/${resolution}?latitude=${encodeURIComponent(String(location.latitude))}&longitude=${encodeURIComponent(
        String(location.longitude)
      )}&excludeParameterMetadata=true&includeLocationName=false`

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        let res: Response
        try {
          res = await fetch(url, {
            // The credential travels in a request header, server-side only.
            // It is never placed in the URL, which would put it in logs,
            // proxies and referrers.
            headers: { apikey: apiKey, accept: "application/json" },
            signal: controller.signal,
            // Caching is decided by the caller, which knows how close the
            // fixture is; this layer must not impose its own.
            cache: "no-store",
          })
        } finally {
          clearTimeout(timer)
        }

        if (res.status === 429) {
          return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: "rate limited (429)" }
        }
        if (!res.ok) {
          // Status only. An upstream error body can echo the request,
          // including headers, so it never reaches a diagnostic string.
          return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: `upstream status ${res.status}` }
        }

        const body: unknown = await res.json()
        const steps = extractTimeSeries(body)
        if (!steps) {
          return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: "unrecognised payload shape" }
        }

        const step = pickClosestStep(steps, whenIso)
        if (!step) {
          return { state: "FORECAST_NOT_AVAILABLE", forecast: null, diagnostic: "no timestep near kickoff" }
        }
        return normalizeStep(step, whenIso, new Date().toISOString())
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError"
        return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: aborted ? "request timed out" : "request failed" }
      }
    },
  }
}

/** GeoJSON-shaped DataHub response: features[0].properties.timeSeries. Tolerant of shape drift -- an unrecognised body is PROVIDER_UNAVAILABLE, never a crash. */
export function extractTimeSeries(body: unknown): TimeStep[] | null {
  if (!body || typeof body !== "object") return null
  const features = (body as { features?: unknown }).features
  if (!Array.isArray(features) || features.length === 0) return null
  const props = (features[0] as { properties?: unknown } | undefined)?.properties
  if (!props || typeof props !== "object") return null
  const series = (props as { timeSeries?: unknown }).timeSeries
  return Array.isArray(series) ? (series as TimeStep[]) : null
}
