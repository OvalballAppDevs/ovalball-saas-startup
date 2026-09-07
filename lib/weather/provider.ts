import "server-only"

import { createMetOfficeProvider, MET_OFFICE_HORIZON_DAYS } from "./met-office"
import type { WeatherProvider, WeatherResult } from "./types"

/**
 * Chooses the provider for this environment. The only place that decides
 * which adapter is live.
 *
 * Behaviour with no credential configured is deliberate and is the normal
 * local-development experience: a provider that reports PROVIDER_UNAVAILABLE
 * for everything. A developer must never need production credentials merely
 * to run the Match Centre, and the page is required to render completely
 * without a forecast anyway.
 *
 * Weather is NEVER fabricated. The unavailable provider returns a state, not
 * an invented temperature -- a plausible-looking fake forecast is worse than
 * no forecast, because a parent would dress a child for it.
 */

const UNAVAILABLE_PROVIDER: WeatherProvider = {
  name: "unconfigured",
  horizonDays: MET_OFFICE_HORIZON_DAYS,
  async getForecast(): Promise<WeatherResult> {
    return { state: "PROVIDER_UNAVAILABLE", forecast: null, diagnostic: "no weather provider configured" }
  },
}

export function resolveWeatherProvider(): WeatherProvider {
  const key = process.env.MET_OFFICE_API_KEY
  if (!key || key.trim().length === 0) return UNAVAILABLE_PROVIDER
  return createMetOfficeProvider(key.trim())
}

/** Whether a real provider credential is configured. Used only to decide whether a deliberate real-provider UAT can run -- never to change what a viewer sees. */
export function isWeatherProviderConfigured(): boolean {
  return Boolean(process.env.MET_OFFICE_API_KEY && process.env.MET_OFFICE_API_KEY.trim().length > 0)
}
