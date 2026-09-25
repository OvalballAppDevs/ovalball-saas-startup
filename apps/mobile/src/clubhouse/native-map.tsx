import { useCallback, useMemo, useRef } from "react"
import type { NativeSyntheticEvent } from "react-native"
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef, type MapRef, type PressEventWithFeatures } from "@maplibre/maplibre-react-native"

import { buildClubMarkerFeatureCollection, type ClubMapMarker } from "@ovalball/contracts/clubhouse"

import { colour } from "../design/tokens"

/**
 * THE ONLY FILE IN THE APP THAT IMPORTS `@maplibre/maplibre-react-native`, DELIBERATELY.
 *
 * MapLibre is native code -- it has no JS-only fallback and cannot run inside Expo Go, because Expo Go
 * only ships the fixed set of native modules built into the Expo Go client itself (confirmed live: a
 * real device crashed with `TurboModuleRegistry.getEnforcing(...): 'MLRNCameraModule' could not be
 * found`, exactly the risk every Clubhouse report already flagged before it could be device-tested).
 *
 * Isolating the import in its OWN module, required only via a runtime `require()` inside an `if`
 * block in `index.tsx` -- never a static top-level `import` -- is what actually prevents the crash: a
 * static import is hoisted and evaluated the moment Metro includes the file in the bundle graph,
 * regardless of whether the component ever renders; a conditional `require()` call only executes the
 * module's top-level code (including MapLibre's own native-module registration check) the first time
 * that line actually runs. `index.tsx` only reaches that line when it has already confirmed the app is
 * NOT running inside Expo Go.
 */

/**
 * UK-WIDE DEFAULT CAMERA. No device-location permission is requested to use Clubhouse at all
 * (Section 56) -- the map opens centred on Great Britain, which is where the whole current directory
 * sits, rather than asking for a permission the product does not need for its core job.
 */
const UK_CENTER: [number, number] = [-2.5, 54.0]
const UK_ZOOM = 5

/**
 * STYLE SOURCE. `mapStyle` below points at MapLibre's own demo tiles
 * (https://demotiles.maplibre.org/style.json) -- explicitly provided by the MapLibre project for
 * exactly this kind of development use, keyless and serverless. THIS IS NOT A PRODUCTION TILE SOURCE.
 * A real release needs a paid commercial tile/style plan (Stadia Maps or MapTiler both require one --
 * neither offers a free commercial tier; see the Section 2 completion report for the researched
 * pricing) chosen and provisioned by the product owner before this ships, then swapped in here as the
 * one constant.
 */
const DEVELOPMENT_MAP_STYLE = "https://demotiles.maplibre.org/style.json"

/**
 * MAPLIBRE MAP: clustered GeoJSON source, minimal marker payload (Section 62). Individual clubs render
 * as a coloured circle (own-club/partner/on-Ovalball/directory-only told apart by paint expression,
 * never colour alone -- the bottom sheet carries the word); crest imagery renders in the sheet and the
 * list, not as a per-point raster on the map itself (a real MapLibre image-sprite integration for
 * ~100+ distinct remote crest URLs is deferred past V1 -- see the Clubhouse completion report).
 *
 * CAMERA INTENT (visual-review pass): opens on the viewer's own club when one is genuinely known --
 * the SAME `origin` the distance filter and the bottom sheet's own mileage already use, never a new
 * location source and never the device's own GPS (Clubhouse asks for no location permission at all).
 * Falls back to the UK-wide view exactly as before when no real origin exists (a team-context viewer,
 * or a club with no geocoded location yet).
 */
export function ClubhouseMap({ markers, onSelect, origin }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void; origin?: ClubMapMarker | null }) {
  const cameraRef = useRef<CameraRef>(null)
  const mapRef = useRef<MapRef>(null)
  const initialCenter: [number, number] = origin?.hasLocation && origin.longitude !== null && origin.latitude !== null ? [origin.longitude, origin.latitude] : UK_CENTER
  const initialZoom = origin?.hasLocation ? 9 : UK_ZOOM

  const geojson = useMemo(() => buildClubMarkerFeatureCollection(markers), [markers])

  const markerById = useMemo(() => new Map(markers.map((m) => [m.directoryId, m])), [markers])

  const onSourcePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features?.[0]
      if (!feature) return
      const props = feature.properties as { directoryId?: string; cluster?: boolean } | null
      if (!props) return
      if (props.cluster) {
        // Cluster expansion: MapLibre's own getClusterExpansionZoom would need the source ref and a
        // round trip; the simpler, reliable V1 behaviour is to step the camera in on the tapped
        // cluster's own coordinate, which is what every point-cluster map does on a first tap anyway.
        const coords = (feature.geometry as GeoJSON.Point | undefined)?.coordinates
        if (coords) {
          cameraRef.current?.easeTo({ center: [coords[0], coords[1]], zoom: 9, duration: 350 })
        }
        return
      }
      const directoryId = props.directoryId
      const marker = directoryId ? markerById.get(directoryId) : undefined
      if (marker) onSelect(marker)
    },
    [markerById, onSelect]
  )

  return (
    <MapLibreMap ref={mapRef} mapStyle={DEVELOPMENT_MAP_STYLE} style={{ flex: 1 }}>
      <Camera ref={cameraRef} initialViewState={{ center: initialCenter, zoom: initialZoom }} />
      <GeoJSONSource id="clubhouseClubs" data={geojson} cluster clusterRadius={45} clusterMaxZoom={11} onPress={onSourcePress}>
        <Layer
          id="clubhouseClusterCircles"
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": colour.forest800,
            "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
            "circle-stroke-width": 2,
            "circle-stroke-color": colour.chalk,
          }}
        />
        <Layer
          id="clubhouseClusterCount"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
            "text-font": ["Noto Sans Bold"],
          }}
          paint={{ "text-color": colour.onForest }}
        />
        <Layer
          id="clubhouseClubPoints"
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-radius": 8,
            "circle-color": [
              "case",
              ["get", "isOwnClub"], colour.pitch400,
              ["==", ["get", "partnershipStatus"], "active"], colour.pitch600,
              ["==", ["get", "networkState"], "on_ovalball"], colour.forest800,
              "#9aa39c",
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": colour.chalk,
          }}
        />
      </GeoJSONSource>
    </MapLibreMap>
  )
}
