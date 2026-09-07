import { CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Cloudy, Sun, CloudSun, Wind } from "lucide-react"

import type { WeatherCondition, WeatherResult } from "@/lib/weather/types"
import { UNAVAILABLE_BODY, UNAVAILABLE_HEADLINE } from "@/lib/weather/types"

/**
 * Weather on the Match Centre.
 *
 * Two rules shape this card.
 *
 * First, weather is an OPTIONAL enhancement. Every unavailable state renders
 * the same calm, honest card -- "Weather not available / Please check back
 * closer to the time" -- and never an error. TOO_EARLY_FOR_FORECAST is the
 * state most fixtures sit in for most of their life; presenting that as a
 * fault would make the majority of fixtures look broken.
 *
 * Second, nothing here is fabricated. If there is no forecast, the card says
 * so. A plausible invented temperature is worse than silence, because a
 * parent would dress a child for it.
 *
 * The condition is always carried by an ICON PLUS WORDS, never by colour or
 * icon alone, so it survives a colour-blind reader and a screen reader.
 */

const CONDITION_ICON: Record<WeatherCondition, typeof Sun> = {
  CLEAR: Sun,
  PARTLY_CLOUDY: CloudSun,
  CLOUDY: Cloudy,
  MIST: CloudFog,
  FOG: CloudFog,
  LIGHT_RAIN: CloudDrizzle,
  RAIN: CloudRain,
  HEAVY_RAIN: CloudRain,
  SLEET: CloudSnow,
  SNOW: CloudSnow,
  HAIL: CloudSnow,
  THUNDER: CloudLightning,
  UNKNOWN: Cloudy,
}

export function WeatherCard({ result }: { result: WeatherResult }) {
  if (result.state !== "FORECAST_AVAILABLE") {
    return (
      <section aria-labelledby="mc-weather-heading" className="rounded-lg border border-ink/10 bg-white px-5 py-4">
        <h2 id="mc-weather-heading" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          Weather
        </h2>
        <p className="mt-2 font-display text-base text-ink">{UNAVAILABLE_HEADLINE}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{UNAVAILABLE_BODY}</p>
      </section>
    )
  }

  const f = result.forecast
  const Icon = CONDITION_ICON[f.condition]

  return (
    <section aria-labelledby="mc-weather-heading" className="rounded-lg border border-ink/10 bg-white px-5 py-4">
      <h2 id="mc-weather-heading" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        Weather at kick-off
      </h2>

      <div className="mt-3 flex items-center gap-4">
        <Icon className="size-9 shrink-0 text-forest-800" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-2xl leading-none text-ink">
            {f.temperatureC}
            <span className="text-lg">°C</span>
          </p>
          <p className="mt-1 text-sm text-ink">{f.conditionLabel}</p>
        </div>
      </div>

      {/* Deliberately three facts, not a meteorological readout: what to wear,
          whether to bring a coat, and whether it will be blowing across the
          pitch. */}
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {f.feelsLikeC !== null && (
          <div className="flex gap-1.5">
            <dt className="text-ink-muted">Feels like</dt>
            <dd className="text-ink">{f.feelsLikeC}°C</dd>
          </div>
        )}
        {f.precipitationProbability !== null && (
          <div className="flex gap-1.5">
            <dt className="text-ink-muted">Rain</dt>
            <dd className="text-ink">{f.precipitationProbability}%</dd>
          </div>
        )}
        {f.windSpeedMph !== null && (
          <div className="flex items-center gap-1.5">
            <Wind className="size-3.5 text-ink-muted" aria-hidden="true" />
            <dt className="sr-only">Wind</dt>
            <dd className="text-ink">
              {f.windSpeedMph} mph{f.windDirection ? ` ${f.windDirection}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {/* Attribution appears ONLY where the provider's data is actually
          displayed -- an unavailable card has nothing to attribute. */}
      {f.attribution && <p className="mt-3 border-t border-ink/8 pt-2 text-xs text-ink-subtle">{f.attribution}</p>}
    </section>
  )
}
