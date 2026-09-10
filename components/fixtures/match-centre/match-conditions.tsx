import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Cloudy,
  CloudSun,
  Droplets,
  MapPin,
  Navigation,
  Sun,
  Wind,
} from "lucide-react"

import type { MatchCentrePitch, MatchCentreVenue } from "@/lib/app-context/match-centre-data"
import { buildDirectionsUrl, formatVenueAddress } from "@/lib/fixtures/directions-url"
import { cn } from "@/lib/utils"
import type { WeatherCondition, WeatherResult } from "@/lib/weather/types"
import { UNAVAILABLE_BODY, UNAVAILABLE_HEADLINE } from "@/lib/weather/types"

import { PitchDiagram } from "./pitch-diagram"

/**
 * MATCH CONDITIONS -- where the game is, and what it will be like there.
 *
 * These were two separate cards, and being separate was the problem. A parent
 * checking a Saturday morning fixture is answering one question -- what am I
 * turning up to, and what do we need to bring -- and the ground, the pitch and
 * the forecast are all part of that one answer. Splitting them into a "Venue"
 * card and a "Weather" card made the page longer and the answer harder to
 * assemble.
 *
 * So: one section, one heading, three parts that describe the same place at
 * the same moment.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *
 * Everything here is canonical or absent. The venue comes from the fixture's
 * own venue row; the pitch from its own club_pitches row; the forecast from
 * the server-side provider adapter, never from the browser and never from a
 * second weather implementation. Nothing is guessed to fill a gap:
 *
 *   * no coordinates            -> no map, and no invented pin
 *   * no forecast               -> the calm "not available" line, never a
 *                                  plausible temperature somebody would
 *                                  dress a child for
 *   * no pitch                  -> no diagram
 *
 * THE MAP IS NEVER THE ONLY WAY TO GET THERE. The address is rendered as real
 * text and Directions is a real link, both present whether or not the map
 * renders. Somebody using a screen reader, on a slow connection, or with the
 * frame blocked gets the same information; the map is an enhancement on top of
 * a complete answer, which is the only way an embedded map is acceptable.
 */

/**
 * Condition -> icon. The normalized WeatherCondition, never a provider's own
 * vocabulary and never a substring match on the label -- "Light rain shower"
 * and "Heavy rain" are both "rain" to a naive matcher and are not the same
 * thing to somebody deciding whether the game is on.
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

/**
 * The sky behind the forecast.
 *
 * Deliberately a WASH, not a status colour. It gives the panel the feeling of
 * the day without ever being the thing that carries the meaning -- the
 * condition is always spelled out in words beside it, and the icon differs per
 * condition too, so the information survives greyscale, colour-blindness and a
 * screenshot in a WhatsApp group. If these tints were removed entirely the
 * panel would lose atmosphere and no information at all, which is the test for
 * whether colour is being used decoratively or load-bearingly.
 */
const CONDITION_SKY: Record<WeatherCondition, string> = {
  CLEAR: "from-amber-100 to-sky-100",
  PARTLY_CLOUDY: "from-sky-100 to-slate-100",
  CLOUDY: "from-slate-100 to-slate-200/70",
  MIST: "from-slate-100 to-slate-200/60",
  FOG: "from-slate-100 to-slate-200/60",
  LIGHT_RAIN: "from-sky-100 to-slate-200/80",
  RAIN: "from-slate-200/80 to-sky-200/60",
  HEAVY_RAIN: "from-slate-300/70 to-sky-200/70",
  SLEET: "from-slate-200/70 to-sky-100",
  SNOW: "from-sky-50 to-slate-200/60",
  HAIL: "from-slate-200/70 to-sky-100",
  THUNDER: "from-slate-300/80 to-amber-100/60",
  UNKNOWN: "from-slate-100 to-slate-200/60",
}

export function MatchConditions({
  venue,
  pitch,
  weather,
  heading = "Match Conditions",
  headingId = "mc-conditions-heading",
  momentLabel = "At Kick-off",
}: {
  venue: MatchCentreVenue
  pitch: MatchCentrePitch
  weather: WeatherResult
  /**
   * SHARED WITH TRAINING CENTRE.
   *
   * A ground, a pitch and a forecast are the same three facts whether the
   * thing happening there is a match or a session, so this is one component
   * with one heading prop rather than a second copy that would drift -- the
   * next fix to the map, the address or an unavailable forecast has to land
   * on both surfaces, and the only way to guarantee that is for there to be
   * one of them.
   */
  heading?: string
  /** Distinct per surface so two of these on one page could never share an id. */
  headingId?: string
  /**
   * WHICH MOMENT THE FORECAST IS FOR. A match has a kick-off and a session
   * does not, and labelling a training forecast "At Kick-off" was the one
   * place the shared component still spoke only matchday.
   */
  momentLabel?: string
}) {
  const address = formatVenueAddress(venue) ?? venue.address
  const directionsUrl = buildDirectionsUrl(venue)
  const hasVenue = Boolean(venue.name || address || pitch.label)
  // A map is shown ONLY where the coordinates were derived from this venue's
  // own canonical postcode. Coordinates with any other provenance are numbers
  // somebody typed, and UAT found a set that pointed at the wrong club's
  // ground entirely -- so they get an address and Directions, which are
  // correct, and no pin, which cannot be confidently wrong.
  const hasMap = venue.latitude !== null && venue.longitude !== null && venue.geocodeStatus === "success"
  const forecast = weather.state === "FORECAST_AVAILABLE" ? weather.forecast : null

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2 id={headingId} className="border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        {heading}
      </h2>

      {/* Ground on the left, sky on the right. On a phone they stack in that
          same order -- where, then what it will be like there. */}
      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-ink/8">
        <div className="px-5 py-4">
          {!hasVenue ? (
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <p className="text-sm text-ink-muted">The venue hasn&rsquo;t been confirmed yet.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-1 size-4 shrink-0 text-pitch-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-display text-lg leading-tight text-ink">{venue.name ?? "Venue to be confirmed"}</p>
                  {address && <p className="mt-1 text-sm text-ink-muted">{address}</p>}
                </div>
              </div>

              {directionsUrl && (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Self-sized and left-aligned rather than full width: the
                  // global "Ask Ovie" widget is fixed bottom-right, and a
                  // full-width primary action here sits underneath it at
                  // 390px -- confirmed by measurement, not assumed.
                  className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-forest-800/20 bg-forest-800/5 px-4 text-sm font-medium text-forest-900 transition-colors hover:bg-forest-800/10 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                >
                  <Navigation className="size-4 shrink-0" aria-hidden="true" />
                  Directions
                  <span className="sr-only"> to {venue.name ?? "the venue"}, opens in a new tab</span>
                </a>
              )}
            </>
          )}
        </div>

        <div className="border-t border-ink/8 md:border-t-0">
          <WeatherPanel weather={weather} momentLabel={momentLabel} />
        </div>
      </div>

      {(hasMap || pitch.label) && (
        /*
          TWO COLUMNS ONLY WHEN THERE ARE TWO THINGS.
          A fixture with no pitch allocation -- most of them -- left the map
          sitting in column one at 409px with 292px of empty grey beside it,
          because the row asked for a 1.4fr/1fr split whether or not anything
          was coming to fill the second track. Reported live as the page
          looking broken, and it was: a map cropped to 58% of the card next to
          a void reads as a rendering fault, not a layout.
        */
        <div
          className={cn(
            "grid grid-cols-1 gap-px border-t border-ink/8 bg-ink/8",
            hasMap && pitch.label && "sm:grid-cols-[1.4fr_1fr]"
          )}
        >
          {hasMap && <VenueMap venue={venue} />}
          {pitch.label && <PitchPanel label={pitch.label} />}
        </div>
      )}

      {/* Attribution appears ONLY where the provider's data is actually shown.
          An unavailable forecast has nothing to attribute, and printing a
          licence line under an empty panel would imply data that is not
          there. */}
      {forecast?.attribution && (
        <p className="border-t border-ink/8 px-5 py-2.5 text-xs text-ink-subtle">{forecast.attribution}</p>
      )}
    </section>
  )
}

function WeatherPanel({ weather, momentLabel }: { weather: WeatherResult; momentLabel: string }) {
  if (weather.state !== "FORECAST_AVAILABLE") {
    return (
      <div className="flex h-full flex-col justify-center px-5 py-4">
        <div className="flex items-start gap-2.5">
          <Cloudy className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">{UNAVAILABLE_HEADLINE}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{UNAVAILABLE_BODY}</p>
          </div>
        </div>
      </div>
    )
  }

  const f = weather.forecast
  const Icon = CONDITION_ICON[f.condition]

  return (
    <div className={`h-full bg-gradient-to-br px-5 py-4 ${CONDITION_SKY[f.condition]}`}>
      <p className="text-xs font-medium tracking-[0.08em] text-ink/60 uppercase">{momentLabel}</p>
      <div className="mt-2 flex items-center gap-4">
        <Icon className="size-11 shrink-0 text-forest-800" aria-hidden="true" strokeWidth={1.5} />
        <div className="min-w-0">
          <p className="font-display text-3xl leading-none text-ink">
            {f.temperatureC}
            <span className="text-xl">°C</span>
          </p>
          {/* The condition in words, always. This is what carries the meaning;
              the icon and the sky behind it are both supplementary. */}
          <p className="mt-1 text-sm font-medium text-ink">{f.conditionLabel}</p>
        </div>
      </div>

      {/* Three facts a touchline actually uses: what to wear, whether to bring
          a coat, and whether it will be blowing across the pitch. Not a
          meteorological readout. */}
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {f.feelsLikeC !== null && (
          <div className="flex items-center gap-1.5">
            <dt className="text-ink/70">Feels like</dt>
            <dd className="font-medium text-ink">{f.feelsLikeC}°C</dd>
          </div>
        )}
        {f.precipitationProbability !== null && (
          <div className="flex items-center gap-1.5">
            <Droplets className="size-3.5 text-ink/60" aria-hidden="true" />
            <dt className="sr-only">Chance of rain</dt>
            <dd className="font-medium text-ink">{f.precipitationProbability}%</dd>
          </div>
        )}
        {f.windSpeedMph !== null && (
          <div className="flex items-center gap-1.5">
            <Wind className="size-3.5 text-ink/60" aria-hidden="true" />
            <dt className="sr-only">Wind</dt>
            <dd className="font-medium text-ink">
              {f.windSpeedMph} mph{f.windDirection ? ` ${f.windDirection}` : ""}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

/**
 * The map.
 *
 * OpenStreetMap's own embed, from canonical coordinates only. No API key, no
 * third-party script, no map library, and nothing user-writable contributing
 * to the URL -- the two numbers are read from the venue row and formatted as
 * numbers.
 *
 * It is an enhancement, never the route: the address and Directions above are
 * complete without it, so a blocked frame, a slow connection or a screen
 * reader loses decoration rather than information. The iframe carries a real
 * title for the same reason.
 */
function VenueMap({ venue }: { venue: MatchCentreVenue }) {
  const lat = Number(venue.latitude)
  const lon = Number(venue.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  // A tight box around the ground -- close enough to see the entrance roads,
  // wide enough to place it in its village.
  const d = 0.006
  const bbox = [lon - d, lat - d / 1.7, lon + d, lat + d / 1.7].map((n) => n.toFixed(5)).join(",")
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lon.toFixed(5)}`

  return (
    <div className="overflow-hidden bg-white">
      {/*
        h-56 is not arbitrary. OpenStreetMap renders its own required
        attribution inside the frame, and below about 200px that line wraps to
        two rows and collides with the map itself -- measured at 390px, where
        this panel is narrowest and the wrap is worst.
      */}
      <iframe
        src={src}
        title={`Map showing ${venue.name ?? "the venue"}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="block h-56 w-full border-0"
      />
    </div>
  )
}

/**
 * The pitch, as a place.
 *
 * The diagram is decorative and the NAME is the information, so the name is
 * real text at a real size and the drawing sits behind it. See
 * pitch-diagram.tsx for why this is a generic pitch and never a plan of the
 * club's grounds.
 */
function PitchPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col bg-white">
      {/* Caption above, drawing below. An earlier draft laid the name over the
          diagram and the two collided at every width -- a pitch is mostly
          horizontal lines, so there is no quiet corner to put text in. */}
      <div className="px-5 pt-4">
        <p className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">Pitch</p>
        <p className="mt-0.5 font-display text-lg leading-tight text-ink">{label}</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-5 pt-3 pb-4 text-forest-800">
        <PitchDiagram className="h-auto w-full max-w-[13rem]" />
      </div>
    </div>
  )
}
