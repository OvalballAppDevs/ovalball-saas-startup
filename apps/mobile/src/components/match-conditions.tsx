import { Alert, Linking, Platform, Pressable, Text, View } from "react-native"

import { UNAVAILABLE_BODY, UNAVAILABLE_HEADLINE, type WeatherCondition, type WeatherResult } from "@ovalball/contracts"

import { PitchDiagram } from "./pitch-diagram"
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Droplets,
  MapPin,
  Navigation,
  Sun,
  Wind,
} from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHERE IT IS, AND WHAT IT WILL BE LIKE THERE.
 *
 * The same section the website's Match Centre and Training Centre both render,
 * in the same order and with the same words: the ground, then the sky, then the
 * pitch. The heading changes for training ("Training Conditions") and so does
 * the moment the forecast is for ("At the Start" rather than "At Kick-off"),
 * which is the whole of the difference between the two surfaces -- exactly as on
 * the web, where it is one component with one prop rather than two copies that
 * would drift.
 *
 * THE FORECAST IS NEVER CARRIED BY AN ICON ALONE. The condition is stated in
 * words, always; the icon and the ground behind it are supplementary. That is
 * the same decision the web records, and it is what makes the panel survive a
 * greyscale screenshot in a WhatsApp group, which is where these pages actually
 * get shared.
 *
 * AN UNAVAILABLE FORECAST IS A STATE, NOT AN ERROR. For most fixtures it is the
 * NORMAL state -- a match three weeks out is simply beyond any provider's
 * horizon -- so it reads as a calm sentence rather than a failure. The two
 * sentences come from the shared weather contract so both clients say the same
 * thing.
 *
 * NO MAP. The web embeds OpenStreetMap, and only where the coordinates came from
 * the venue's own canonical postcode -- UAT found a venue pinned on a football
 * ground three kilometres from the rugby club, and a plausible wrong pin is
 * worse than no pin because somebody drives to it. On a phone the honest and more
 * useful answer is Directions, which hands the address to the device's own maps
 * app and its live traffic. Recorded as a deliberate native difference rather
 * than an omission.
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

/** The sky behind the figure. The web's Tailwind gradients, as the flat wash React Native can draw. */
const CONDITION_SKY: Record<WeatherCondition, string> = {
  CLEAR: "#fdf4e3",
  PARTLY_CLOUDY: "#eaf3fa",
  CLOUDY: "#eef1f3",
  MIST: "#eef1f3",
  FOG: "#eef1f3",
  LIGHT_RAIN: "#e8f1f8",
  RAIN: "#e4edf4",
  HEAVY_RAIN: "#dde7ef",
  SLEET: "#e8eef3",
  SNOW: "#f2f7fb",
  HAIL: "#e8eef3",
  THUNDER: "#e6e6ec",
  UNKNOWN: "#eef1f3",
}

export function MatchConditions({
  venueName,
  postcode,
  addressLines,
  pitchName,
  weather,
  heading = "Match Conditions",
  momentLabel = "At Kick-off",
}: {
  venueName: string | null
  postcode: string | null
  addressLines: string[]
  pitchName: string | null
  weather: WeatherResult
  heading?: string
  momentLabel?: string
}) {
  const forecast = weather.state === "FORECAST_AVAILABLE" ? weather.forecast : null
  const hasVenue = Boolean(venueName || postcode || addressLines.length > 0 || pitchName)
  const destination = [venueName, ...addressLines, postcode].filter(Boolean).join(", ")

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.chalk }}>
        <Text accessibilityRole="header" style={[type.overline, { color: colour.inkMuted }]}>
          {heading.toUpperCase()}
        </Text>
      </View>

      {/* THE GROUND. */}
      <View style={{ padding: space.lg, gap: space.sm }}>
        {!hasVenue ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <MapPin size={16} color={colour.inkSubtle} />
            <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>The venue hasn&rsquo;t been confirmed yet.</Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
              <MapPin size={16} color={colour.pitch600} style={{ marginTop: 3 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.displaySmall, { color: colour.ink, fontSize: 19, lineHeight: 23 }]}>
                  {venueName ?? "Venue to be confirmed"}
                </Text>
                {/* THE GROUND'S NAME, AND NOT ITS POSTAL ADDRESS.

                    "Where are we playing" is answered by a name. "How do I get
                    there" is a different question, and it belongs to Directions --
                    which still receives the whole address, including every line
                    that used to be printed here. A Match Centre that reads like an
                    envelope is one nobody scans. */}
                {/* Nothing beneath it. The pitch has its own section below and the
                    address belongs to Directions. */}
              </View>
            </View>

            {destination.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${venueName ?? "the venue"}`}
                onPress={() => void openDirections(destination)}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.lg,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: "rgba(18,61,44,0.20)",
                  backgroundColor: pressed ? "rgba(18,61,44,0.10)" : "rgba(18,61,44,0.05)",
                })}
              >
                <Navigation size={16} color={colour.forest800} />
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>Directions</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* THE SKY. */}
      <View style={{ borderTopWidth: 1, borderTopColor: colour.line }}>
        {forecast ? (
          <View style={{ padding: space.lg, backgroundColor: CONDITION_SKY[forecast.condition] }}>
            <Text style={[type.overline, { color: "rgba(16,21,18,0.60)" }]}>{momentLabel.toUpperCase()}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: space.sm }}>
              {(() => {
                const Icon = CONDITION_ICON[forecast.condition]
                return <Icon size={40} color={colour.forest800} strokeWidth={1.5} />
              })()}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 32 }]}>{forecast.temperatureC}°C</Text>
                {/* The condition in words, always. This is what carries the
                    meaning; the icon and the sky behind it are supplementary. */}
                <Text style={[type.smallMedium, { color: colour.ink, marginTop: 2 }]}>{forecast.conditionLabel}</Text>
              </View>
            </View>

            {/* Three facts a touchline actually uses: what to wear, whether to
                bring a coat, and whether it will be blowing across the pitch.
                Not a meteorological readout. */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: space.md }}>
              {forecast.feelsLikeC !== null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  <Text style={[type.small, { color: "rgba(16,21,18,0.70)" }]}>Feels like</Text>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{forecast.feelsLikeC}°C</Text>
                </View>
              )}
              {forecast.precipitationProbability !== null && (
                <View
                  accessible
                  accessibilityLabel={`Chance of rain ${forecast.precipitationProbability} percent`}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
                >
                  <Droplets size={14} color="rgba(16,21,18,0.60)" />
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{forecast.precipitationProbability}%</Text>
                </View>
              )}
              {forecast.windSpeedMph !== null && (
                <View
                  accessible
                  accessibilityLabel={`Wind ${forecast.windSpeedMph} miles per hour${forecast.windDirection ? ` ${forecast.windDirection}` : ""}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
                >
                  <Wind size={14} color="rgba(16,21,18,0.60)" />
                  <Text style={[type.smallMedium, { color: colour.ink }]}>
                    {forecast.windSpeedMph} mph{forecast.windDirection ? ` ${forecast.windDirection}` : ""}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.lg }}>
            <Cloud size={16} color={colour.inkSubtle} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{UNAVAILABLE_HEADLINE}</Text>
              <Text style={[type.small, { color: colour.inkMuted, marginTop: 1 }]}>{UNAVAILABLE_BODY}</Text>
            </View>
          </View>
        )}
      </View>

      {/* THE PITCH. The name at the size a name deserves, and the drawing beneath
          it -- which makes the pitch read as a place rather than a string. */}
      {pitchName && (
        <View style={{ borderTopWidth: 1, borderTopColor: colour.line, padding: space.lg, gap: space.md }}>
          <View>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCH</Text>
            <Text style={[type.displaySmall, { color: colour.ink, fontSize: 19, lineHeight: 23, marginTop: 2 }]}>{pitchName}</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <PitchDiagram width={300} height={188} />
          </View>
        </View>
      )}

      {/* Attribution appears ONLY where the provider's data is actually shown. An
          unavailable forecast has nothing to attribute, and printing a licence
          line under an empty panel would imply data that is not there. */}
      {forecast?.attribution && (
        <Text style={[type.caption, { color: colour.inkSubtle, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line }]}>
          {forecast.attribution}
        </Text>
      )}
    </View>
  )
}

/**
 * THE DEVICE'S OWN MAPS APP, which knows the traffic and the person's preferred
 * navigation. Apple Maps on iOS, whatever handles `geo:` on Android, and a
 * Google Maps web link as the last resort rather than a dead button.
 */
export async function openDirections(place: string): Promise<void> {
  const query = encodeURIComponent(place)
  const native = Platform.OS === "ios" ? `maps://?daddr=${query}` : `geo:0,0?q=${query}`
  try {
    if (await Linking.canOpenURL(native)) {
      await Linking.openURL(native)
      return
    }
    await Linking.openURL(`https://maps.google.com/?q=${query}`)
  } catch {
    Alert.alert("Directions", "This device can't open a map for that address.")
  }
}
