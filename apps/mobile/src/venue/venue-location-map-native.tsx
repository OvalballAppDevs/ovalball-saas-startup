import { View } from "react-native"
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from "@maplibre/maplibre-react-native"

import { colour, radius } from "../design/tokens"

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"

/**
 * REACHED ONLY THROUGH `venue-location-map.tsx`'s guarded `require()`, never imported directly: this
 * module's MapLibre import registers a native module Expo Go does not ship, so evaluating it there
 * crashes the whole app (see `app/(tabs)/clubhouse/map.tsx` for the same rule and why).
 *
 * ONE PIN, READ-ONLY -- confirmation, not an editor ("yes, this is the place"), same MapLibre setup
 * and free OpenFreeMap style Clubhouse's own directory map already uses (`clubhouse/native-map.tsx`),
 * simplified to a single un-clustered point since a wizard preview never has more than one.
 */
export function NativeVenueLocationMap({ latitude, longitude, height = 160 }: { latitude: number; longitude: number; height?: number }) {
  const geojson = {
    type: "FeatureCollection" as const,
    features: [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [longitude, latitude] }, properties: {} }],
  }
  return (
    <View style={{ height, borderRadius: radius.lg, overflow: "hidden" }} pointerEvents="none">
      <MapLibreMap mapStyle={MAP_STYLE} style={{ flex: 1 }}>
        <Camera initialViewState={{ center: [longitude, latitude], zoom: 14 }} />
        <GeoJSONSource id="venueLocation" data={geojson}>
          <Layer id="venueLocationRing" type="circle" paint={{ "circle-radius": 12, "circle-color": colour.pitch600, "circle-opacity": 0.25 }} />
          <Layer id="venueLocationPin" type="circle" paint={{ "circle-radius": 7, "circle-color": colour.forest800, "circle-stroke-width": 2.5, "circle-stroke-color": colour.chalk }} />
        </GeoJSONSource>
      </MapLibreMap>
    </View>
  )
}
