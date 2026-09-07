/**
 * The normalized weather contract.
 *
 * Deliberately dependency-free and provider-agnostic: nothing above the
 * adapter layer knows that the current UK provider is the Met Office, so
 * swapping or adding a provider is an adapter change, never a Match Centre
 * change. Match Centre components import from here and from nowhere else in
 * lib/weather.
 *
 * Weather is DERIVED DATA, never fixture truth. It is computed from the
 * fixture's canonical kickoff and its venue's coordinates, it is never
 * stored against the fixture, and a fixture is complete and correct with no
 * forecast at all.
 */

/**
 * Every outcome, as a closed set -- so a caller cannot forget one and render
 * a blank card. Each state is a real, distinguishable product situation:
 *
 *   FORECAST_AVAILABLE     -- we have a forecast for this kickoff.
 *   TOO_EARLY_FOR_FORECAST -- beyond the provider's usable horizon. This is
 *                             the NORMAL state for most fixtures, not an
 *                             error, and must never be presented as one.
 *   PROVIDER_UNAVAILABLE   -- no credential configured, or the provider
 *                             failed (timeout, 429, bad payload, outage).
 *   LOCATION_UNAVAILABLE   -- the fixture has no venue coordinates to ask
 *                             about. A venue problem, not a weather problem.
 *   FORECAST_NOT_AVAILABLE -- the provider answered but had nothing for this
 *                             point in time. Rare, and honest about it.
 */
export type WeatherState =
  | "FORECAST_AVAILABLE"
  | "TOO_EARLY_FOR_FORECAST"
  | "PROVIDER_UNAVAILABLE"
  | "LOCATION_UNAVAILABLE"
  | "FORECAST_NOT_AVAILABLE"

/** Rugby-relevant conditions. Normalized from whatever vocabulary a provider uses, so the UI never switches on a provider's own codes. */
export type WeatherCondition =
  | "CLEAR"
  | "PARTLY_CLOUDY"
  | "CLOUDY"
  | "MIST"
  | "FOG"
  | "LIGHT_RAIN"
  | "RAIN"
  | "HEAVY_RAIN"
  | "SLEET"
  | "SNOW"
  | "HAIL"
  | "THUNDER"
  | "UNKNOWN"

export interface WeatherForecast {
  /** The moment this forecast describes -- the fixture's kickoff, not "now". ISO 8601. */
  forecastFor: string
  /** Degrees Celsius. */
  temperatureC: number
  /** "Feels like" / apparent temperature, when the provider supplies one. */
  feelsLikeC: number | null
  /** 0-100. Null when the provider does not express one for this timestep. */
  precipitationProbability: number | null
  condition: WeatherCondition
  /** Free-text label already normalized to plain English ("Light showers"), safe to render directly. */
  conditionLabel: string
  /** Miles per hour -- the unit a UK touchline actually uses. */
  windSpeedMph: number | null
  /** Compass point ("NW"), when useful. */
  windDirection: string | null
  /** Which provider produced this, for attribution. */
  provider: string
  /**
   * Attribution text a provider's licence REQUIRES to be displayed wherever
   * its data appears. Rendered only when real data is shown -- never on an
   * unavailable card, where there is nothing to attribute.
   */
  attribution: string | null
  /** When we actually fetched it, so a card can say how fresh it is. */
  fetchedAt: string
}

export type WeatherResult =
  | { state: "FORECAST_AVAILABLE"; forecast: WeatherForecast }
  | { state: Exclude<WeatherState, "FORECAST_AVAILABLE">; forecast: null; /** Operational detail for logs. NEVER rendered, and never carries provider internals or credentials. */ diagnostic?: string }

/**
 * The one thing a provider must be able to do.
 *
 * `getForecast` must NEVER throw: every failure is a WeatherResult state.
 * A weather provider going down cannot be allowed to take a fixture page
 * with it, and the simplest way to guarantee that is to make it impossible
 * to express at the type level.
 */
export interface WeatherProvider {
  readonly name: string
  /** How far ahead this provider produces a forecast worth showing. Beyond it, callers report TOO_EARLY_FOR_FORECAST rather than presenting a distant guess as trustworthy. */
  readonly horizonDays: number
  getForecast(location: WeatherLocation, whenIso: string): Promise<WeatherResult>
}

export interface WeatherLocation {
  latitude: number
  longitude: number
}

export const UNAVAILABLE_HEADLINE = "Weather not available"
export const UNAVAILABLE_BODY = "Please check back closer to the time."
