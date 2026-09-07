import "server-only"

import { unstable_cache } from "next/cache"

import { forecastCacheKey, forecastCacheSeconds, kickoffInstant, FORECAST_HORIZON_DAYS } from "./forecast-window"
import { resolveWeatherProvider } from "./provider"
import type { WeatherLocation, WeatherResult } from "./types"

export { forecastCacheKey, forecastCacheSeconds, kickoffInstant, FORECAST_HORIZON_DAYS } from "./forecast-window"

/**
 * Getting a forecast for a fixture, without melting the provider's quota.
 *
 * WHY CACHING IS NOT OPTIONAL HERE
 *
 * The Match Centre is force-dynamic, so without this every page view -- every
 * parent, every refresh, every sibling switch -- would be one upstream call.
 * A single busy Sunday would be thousands of requests for a handful of
 * genuinely distinct forecasts, and a free DataHub tier would rate-limit
 * long before that. So the provider is called through unstable_cache, keyed
 * on the ROUNDED coordinates and the kickoff hour rather than on the fixture:
 * ten teams playing at one ground at 10:30 share one upstream call, which is
 * correct, because they share one sky.
 *
 * REVALIDATION FOLLOWS PROXIMITY
 *
 * A fixture six days out barely changes hour to hour and does not deserve
 * frequent refetching; one tomorrow morning does. So the cache lifetime is
 * derived from the lead time rather than being a single global number.
 */

/**
 * The one entry point a page uses.
 *
 * Never throws: every failure is a state. A provider outage, a timeout, a
 * 429 or a malformed payload all resolve to PROVIDER_UNAVAILABLE, and the
 * Match Centre renders its canonical fixture information regardless.
 */
export async function getFixtureForecast(input: {
  kickoffDate: string
  kickoffTime: string | null
  latitude: number | null
  longitude: number | null
  timeZone?: string
}): Promise<WeatherResult> {
  if (input.latitude === null || input.longitude === null) {
    return { state: "LOCATION_UNAVAILABLE", forecast: null, diagnostic: "venue has no coordinates" }
  }
  const whenIso = kickoffInstant(input.kickoffDate, input.kickoffTime, input.timeZone)
  if (!whenIso) {
    // No kickoff time means no moment to forecast. A venue is not the
    // problem here, the schedule is.
    return { state: "FORECAST_NOT_AVAILABLE", forecast: null, diagnostic: "fixture has no kickoff time" }
  }

  const lead = (Date.parse(whenIso) - Date.now()) / 3_600_000
  if (lead > FORECAST_HORIZON_DAYS * 24) {
    // Answered WITHOUT calling the provider: a fixture months away must not
    // cost a request, and this is the state most fixtures sit in.
    return { state: "TOO_EARLY_FOR_FORECAST", forecast: null }
  }

  const location: WeatherLocation = { latitude: input.latitude, longitude: input.longitude }
  const key = forecastCacheKey(location, whenIso)

  const cached = unstable_cache(
    async () => {
      const provider = resolveWeatherProvider()
      return provider.getForecast(location, whenIso)
    },
    [key],
    { revalidate: forecastCacheSeconds(lead), tags: ["weather"] }
  )

  try {
    return await cached()
  } catch {
    // unstable_cache itself failing must not surface either.
    return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: "cache layer failed" }
  }
}
