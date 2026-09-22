import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, WeatherResult } from "@ovalball/contracts"

import { webUrl } from "../config/environment"

/**
 * THE FORECAST, FROM THE ONE PLACE THAT HAS IT.
 *
 * A weather provider needs a credential and a cache. Shipping the credential to
 * a handset would publish it, and a per-device cache would multiply a free
 * tier's quota by the number of phones -- so the app asks the WEBSITE, which
 * already owns the single Met Office adapter, the single cache keyed on rounded
 * coordinates and kickoff hour, and the single honest unavailable state.
 *
 * That is the shared-product rule applied to something that looks like a mobile
 * concern and is not: a second forecast path would be a second weather
 * integration, and the two would disagree the first time a provider changed.
 *
 * THE TOKEN IS THE AUTHORITY. The route builds its Supabase client from the
 * caller's own access token, so the fixture read runs under the caller's RLS and
 * the endpoint can see no more than they can.
 *
 * NEVER THROWS. Every failure -- offline, a route that is not deployed, a
 * malformed payload -- resolves to `PROVIDER_UNAVAILABLE`, which is a real
 * canonical state with its own sentence. Weather is derived data and a fixture
 * is complete and correct without it, so a forecast must never be able to take
 * a Match Centre down.
 */

const UNAVAILABLE: WeatherResult = { state: "PROVIDER_UNAVAILABLE", forecast: null }

export async function loadFixtureForecast(supabase: SupabaseClient<Database>, fixtureId: string): Promise<WeatherResult> {
  if (!webUrl) return UNAVAILABLE
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return UNAVAILABLE

    const response = await fetch(`${webUrl}/api/fixtures/${fixtureId}/forecast`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return UNAVAILABLE
    const body = (await response.json()) as WeatherResult
    // A payload that is not one of the canonical states is treated as no
    // forecast at all rather than rendered as an unknown sixth state.
    return body && typeof body.state === "string" ? body : UNAVAILABLE
  } catch {
    return UNAVAILABLE
  }
}
