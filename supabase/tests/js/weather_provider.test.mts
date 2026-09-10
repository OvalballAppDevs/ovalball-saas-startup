import { test } from "node:test"
import assert from "node:assert/strict"

import {
  compassFromDegrees,
  createMetOfficeProvider,
  extractTimeSeries,
  leadHours,
  msToMph,
  normalizeStep,
  pickClosestStep,
  stepFeelsLike,
  stepTemperature,
} from "@/lib/weather/met-office"
import { forecastCacheKey, forecastCacheSeconds, kickoffInstant, FORECAST_HORIZON_DAYS } from "@/lib/weather/forecast-window"

/**
 * The weather adapter, exercised entirely against a MOCKED provider.
 *
 * The regression suite must never depend on the live Met Office: it would
 * make the build fail when someone else's service has a bad afternoon, spend
 * quota on every CI run, and require a production credential to run tests at
 * all. Every case below drives a stubbed global fetch instead.
 *
 * The rule these tests exist to protect is simple and absolute: weather can
 * fail in any way at all, and a fixture page must still render. So the
 * adapter never throws -- every failure is a state.
 */

const LOCATION = { latitude: 53.789, longitude: -2.235 }

/** Stubs global fetch for one call, restoring it afterwards even on failure. */
async function withFetch<T>(impl: (url: string, init?: RequestInit) => Promise<Response> | Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = ((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))) as unknown as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** A DataHub-shaped payload with one timestep at the given time. */
function payload(timeIso: string, over: Record<string, unknown> = {}) {
  return {
    features: [
      {
        properties: {
          timeSeries: [
            {
              time: timeIso,
              screenTemperature: 12.4,
              feelsLikeTemperature: 9.6,
              probOfPrecipitation: 40,
              significantWeatherCode: 10,
              windSpeed10m: 4.9,
              windDirectionFrom10m: 315,
              ...over,
            },
          ],
        },
      },
    ],
  }
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

// ---------------------------------------------------------------------------
// Unit conversions and parsing
// ---------------------------------------------------------------------------

test("wind is converted to the unit a UK touchline uses", () => {
  assert.equal(msToMph(4.9), 11)
  assert.equal(msToMph(0), 0)
  assert.equal(msToMph(null), null)
  assert.equal(msToMph(undefined), null)
})

test("wind direction becomes a compass point", () => {
  assert.equal(compassFromDegrees(0), "N")
  assert.equal(compassFromDegrees(90), "E")
  assert.equal(compassFromDegrees(315), "NW")
  assert.equal(compassFromDegrees(360), "N")
  assert.equal(compassFromDegrees(-45), "NW", "negative bearings must still resolve")
  assert.equal(compassFromDegrees(null), null)
})

test("an unrecognised payload shape is rejected, not crashed on", () => {
  for (const bad of [null, undefined, {}, { features: [] }, { features: [{}] }, { features: [{ properties: {} }] }, "nonsense", 42]) {
    assert.equal(extractTimeSeries(bad), null)
  }
  assert.ok(Array.isArray(extractTimeSeries(payload(inHours(2)))))
})

test("the timestep closest to kickoff is chosen, and a distant one is refused", () => {
  const kickoff = "2026-09-20T10:30:00Z"
  const steps = [{ time: "2026-09-20T09:00:00Z" }, { time: "2026-09-20T12:00:00Z" }, { time: "2026-09-20T15:00:00Z" }]
  assert.equal(pickClosestStep(steps, kickoff)?.time, "2026-09-20T09:00:00Z")
  // Nothing within three hours: the series does not describe this match.
  assert.equal(pickClosestStep([{ time: "2026-09-20T20:00:00Z" }], kickoff), null)
  assert.equal(pickClosestStep([], kickoff), null)
})

test("a timestep with no temperature is FORECAST_NOT_AVAILABLE, not a fake zero", () => {
  const r = normalizeStep({ time: "2026-09-20T10:00:00Z" }, "2026-09-20T10:30:00Z", new Date().toISOString())
  assert.equal(r.state, "FORECAST_NOT_AVAILABLE")
  assert.equal(r.forecast, null)
})

// ---------------------------------------------------------------------------
// The provider contract
// ---------------------------------------------------------------------------

test("a successful forecast is normalized into the provider-agnostic shape", async () => {
  const when = inHours(6)
  const r = await withFetch(
    () => json(payload(when)),
    () => createMetOfficeProvider("test-key").getForecast(LOCATION, when)
  )
  assert.equal(r.state, "FORECAST_AVAILABLE")
  assert.ok(r.forecast)
  assert.equal(r.forecast.temperatureC, 12)
  assert.equal(r.forecast.feelsLikeC, 10)
  assert.equal(r.forecast.precipitationProbability, 40)
  assert.equal(r.forecast.condition, "LIGHT_RAIN")
  assert.equal(r.forecast.conditionLabel, "Light showers")
  assert.equal(r.forecast.windSpeedMph, 11)
  assert.equal(r.forecast.windDirection, "NW")
  assert.equal(r.forecast.provider, "Met Office")
  assert.match(r.forecast.attribution ?? "", /Met Office/, "Met Office data must carry its required attribution")
})

test("beyond the horizon we do not even ask", async () => {
  let called = false
  const when = inHours(24 * (FORECAST_HORIZON_DAYS + 3))
  const r = await withFetch(
    () => {
      called = true
      return json(payload(when))
    },
    () => createMetOfficeProvider("test-key").getForecast(LOCATION, when)
  )
  assert.equal(r.state, "TOO_EARLY_FOR_FORECAST")
  assert.equal(called, false, "a fixture beyond the horizon must not cost an upstream request")
})

test("a 429 is PROVIDER_UNAVAILABLE, never an exception", async () => {
  const when = inHours(6)
  const r = await withFetch(
    () => new Response("rate limited", { status: 429 }),
    () => createMetOfficeProvider("test-key").getForecast(LOCATION, when)
  )
  assert.equal(r.state, "PROVIDER_UNAVAILABLE")
  assert.equal(r.forecast, null)
})

test("a 500, a timeout and a thrown error all degrade to a state", async () => {
  const when = inHours(6)
  const five = await withFetch(
    () => new Response("boom", { status: 500 }),
    () => createMetOfficeProvider("k").getForecast(LOCATION, when)
  )
  assert.equal(five.state, "PROVIDER_UNAVAILABLE")

  const thrown = await withFetch(
    () => {
      throw new Error("socket hang up")
    },
    () => createMetOfficeProvider("k").getForecast(LOCATION, when)
  )
  assert.equal(thrown.state, "PROVIDER_UNAVAILABLE")

  const aborted = await withFetch(
    () => {
      const e = new Error("aborted")
      e.name = "AbortError"
      throw e
    },
    () => createMetOfficeProvider("k").getForecast(LOCATION, when)
  )
  assert.equal(aborted.state, "PROVIDER_UNAVAILABLE")
  assert.match(aborted.diagnostic ?? "", /timed out/)
})

test("a malformed payload does not crash the adapter", async () => {
  const when = inHours(6)
  for (const bad of [{}, { features: "no" }, { features: [{ properties: { timeSeries: "nope" } }] }]) {
    const r = await withFetch(
      () => json(bad),
      () => createMetOfficeProvider("k").getForecast(LOCATION, when)
    )
    assert.equal(r.state, "PROVIDER_UNAVAILABLE", `payload ${JSON.stringify(bad)} should degrade cleanly`)
  }
})

test("a body that is not JSON at all degrades cleanly", async () => {
  const when = inHours(6)
  const r = await withFetch(
    () => new Response("<html>gateway error</html>", { status: 200, headers: { "content-type": "text/html" } }),
    () => createMetOfficeProvider("k").getForecast(LOCATION, when)
  )
  assert.equal(r.state, "PROVIDER_UNAVAILABLE")
})

// ---------------------------------------------------------------------------
// The credential
// ---------------------------------------------------------------------------

test("the credential travels in a header and NEVER in the URL", async () => {
  const when = inHours(6)
  let seenUrl = ""
  let seenHeaders: Record<string, string> = {}
  await withFetch(
    (url, init) => {
      seenUrl = String(url)
      seenHeaders = (init?.headers ?? {}) as Record<string, string>
      return json(payload(when))
    },
    () => createMetOfficeProvider("SUPER-SECRET-KEY").getForecast(LOCATION, when)
  )
  // A key in a query string leaks into logs, proxies and referrer headers.
  assert.ok(!seenUrl.includes("SUPER-SECRET-KEY"), "the API key appeared in the request URL")
  assert.ok(!/apikey=/i.test(seenUrl), "the API key was passed as a query parameter")
  assert.equal(seenHeaders.apikey, "SUPER-SECRET-KEY")
})

test("no failure path ever echoes the credential back to the caller", async () => {
  const when = inHours(6)
  for (const impl of [
    () => new Response("error: apikey SUPER-SECRET-KEY rejected", { status: 401 }),
    () => new Response("rate limited", { status: 429 }),
    () => json({ nonsense: true }),
  ]) {
    const r = await withFetch(impl, () => createMetOfficeProvider("SUPER-SECRET-KEY").getForecast(LOCATION, when))
    const serialized = JSON.stringify(r)
    assert.ok(!serialized.includes("SUPER-SECRET-KEY"), `the credential leaked into a result: ${serialized}`)
  }
})

// ---------------------------------------------------------------------------
// Caching and time
// ---------------------------------------------------------------------------

test("cache lifetime follows how close the fixture is", () => {
  assert.equal(forecastCacheSeconds(2), 1800, "a fixture in two hours should refresh often")
  assert.equal(forecastCacheSeconds(24), 1800)
  assert.equal(forecastCacheSeconds(48), 10800)
  assert.equal(forecastCacheSeconds(24 * 6), 43200, "a fixture six days out barely changes")
  // Never unbounded and never zero: both would defeat the point.
  for (const lead of [0, 1, 12, 47, 100, 168]) {
    const s = forecastCacheSeconds(lead)
    assert.ok(s >= 1800 && s <= 43200, `lead ${lead}h produced ${s}s`)
  }
})

test("two fixtures at one ground and hour share ONE cache entry", () => {
  // Keyed on place and hour, deliberately not on fixture id: ten teams at
  // one club at 10:30 share one sky, and keying per fixture would multiply
  // identical upstream calls by the number of fixtures.
  const when = "2026-09-20T10:30:00.000Z"
  // Two pitches at one ground, comfortably inside one ~1km bucket.
  assert.equal(forecastCacheKey({ latitude: 53.7891, longitude: -2.2312 }, when), forecastCacheKey({ latitude: 53.7894, longitude: -2.2349 }, when))
  // Honest about the limit: buckets have edges, so two points a few metres
  // apart CAN straddle one and cost a second upstream call. That is the
  // acceptable worst case -- one extra request, never a wrong forecast.
  assert.notEqual(forecastCacheKey({ latitude: 53.7891, longitude: -2.2352 }, when), forecastCacheKey({ latitude: 53.7891, longitude: -2.2349 }, when))
  // Different hour, different entry.
  assert.notEqual(forecastCacheKey(LOCATION, when), forecastCacheKey(LOCATION, "2026-09-20T14:30:00.000Z"))
  // Genuinely different place, different entry.
  assert.notEqual(forecastCacheKey(LOCATION, when), forecastCacheKey({ latitude: 51.5, longitude: -0.12 }, when))
})

test("kickoff resolves to a real instant, honouring British Summer Time", () => {
  // A summer kickoff is BST (+01:00): 10:30 local is 09:30Z. Treating it as
  // UTC would fetch the wrong hour's weather.
  assert.equal(kickoffInstant("2026-07-12", "10:30"), "2026-07-12T09:30:00.000Z")
  // A winter kickoff is GMT: 10:30 local is 10:30Z.
  assert.equal(kickoffInstant("2026-12-13", "10:30"), "2026-12-13T10:30:00.000Z")
  // No kickoff time, no instant.
  assert.equal(kickoffInstant("2026-12-13", null), null)
})

test("lead time is measured from now, in hours", () => {
  const now = Date.parse("2026-09-07T12:00:00Z")
  assert.equal(Math.round(leadHours("2026-09-07T18:00:00Z", now)), 6)
  assert.equal(Math.round(leadHours("2026-09-06T12:00:00Z", now)), -24)
})


/**
 * THE THREE-HOURLY SERIES USES DIFFERENT FIELD NAMES.
 *
 * Found live, with a working Met Office credential, after the Match Centre had
 * shown "Weather not available" for a fixture four days out. The API returned
 * 200 and a full series; the adapter read only the HOURLY field names, so
 * every step past 48 hours carried no temperature it recognised and every one
 * of those fixtures rendered the unavailable card.
 *
 * That is the whole horizon a parent actually looks at a fixture in. It also
 * failed silently and looked exactly like a missing credential, which is why
 * it went unnoticed: nothing errored, there was simply never any weather.
 */
test("the three-hourly series carries a temperature under different field names", () => {
  // A real three-hourly step: no screenTemperature, bounds instead.
  const threeHourly = {
    time: "2026-09-12T12:00Z",
    maxScreenAirTemp: 16.2,
    minScreenAirTemp: 13.8,
    feelsLikeTemp: 14.6,
    probOfPrecipitation: 53,
    significantWeatherCode: 12,
    windSpeed10m: 4.95,
    windDirectionFrom10m: 212,
  }
  assert.equal(stepTemperature(threeHourly), 15, "the midpoint of the provider's own bounds is the block's temperature")
  assert.equal(stepFeelsLike(threeHourly), 14.6, "feelsLikeTemp is the three-hourly spelling of feelsLikeTemperature")

  const r = normalizeStep(threeHourly, "2026-09-12T13:30:00Z", new Date().toISOString())
  assert.equal(r.state, "FORECAST_AVAILABLE", "a three-hourly step must produce a forecast, not an unavailable card")
  assert.equal(r.forecast?.temperatureC, 15)
  assert.equal(r.forecast?.feelsLikeC, 15)
  assert.equal(r.forecast?.conditionLabel, "Light rain")
  assert.equal(r.forecast?.windSpeedMph, 11)
  assert.equal(r.forecast?.windDirection, "SSW")
})

test("the hourly series still reads its own point temperature, unchanged", () => {
  const hourly = { time: "2026-09-12T13:00Z", screenTemperature: 12.4, feelsLikeTemperature: 9.8, significantWeatherCode: 12 }
  assert.equal(stepTemperature(hourly), 12.4, "a direct reading is preferred over any derived one")
  assert.equal(stepFeelsLike(hourly), 9.8)
})

test("a single bound is used rather than refusing a forecast outright", () => {
  assert.equal(stepTemperature({ maxScreenAirTemp: 14 }), 14)
  assert.equal(stepTemperature({ minScreenAirTemp: 9 }), 9)
})

test("no temperature under ANY name is still FORECAST_NOT_AVAILABLE, never a fabricated number", () => {
  assert.equal(stepTemperature({ time: "2026-09-12T12:00Z", windSpeed10m: 4 }), null)
  const r = normalizeStep({ time: "2026-09-12T12:00Z" }, "2026-09-12T12:00Z", new Date().toISOString())
  assert.equal(r.state, "FORECAST_NOT_AVAILABLE")
  assert.equal(r.forecast, null)
})
