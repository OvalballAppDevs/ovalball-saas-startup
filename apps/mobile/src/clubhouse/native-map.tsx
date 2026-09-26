import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image, type NativeSyntheticEvent } from "react-native"
import { Camera, GeoJSONSource, Images, Layer, Map as MapLibreMap, type CameraRef, type MapRef, type PressEventWithFeatures } from "@maplibre/maplibre-react-native"

import { buildClubMarkerFeatureCollection, type ClubMapMarker } from "@ovalball/contracts/clubhouse"

import { colour } from "../design/tokens"

/**
 * THE CREST-MARKER PIPELINE (owner correction pass, mock-up reconciliation): real crests ARE now
 * rendered on the map, not deferred. The earlier deferral reasoning assumed a resize step was
 * required because MapLibre's `icon-size` scales an image's own native resolution and crest uploads
 * have no consistent dimension -- true, but the fix does not need a resize at all: `Image.getSize`
 * (a lightweight header read, not a full download) reports each crest's real pixel dimensions, and a
 * per-feature `icon-size` expression compensates so every crest renders at approximately the same
 * on-screen diameter regardless of its source resolution. Confirmed live in the database this pass:
 * only ~105 clubs are geocoded at all (never the full ~1,400-row directory), so this is at most ~105
 * one-time, cached header reads for the life of the screen -- not a per-render or per-cluster cost.
 */
const CREST_TARGET_PX = 30

function useCrestScales(markers: ClubMapMarker[]): Map<string, number> {
  // Keyed by URL (not directoryId): two clubs sharing a storage path -- unlikely, but free to dedupe --
  // never re-measure the same image twice. Real React state, not a ref read during render: each
  // completed batch of measurements is merged into a NEW Map and set once, so this hook's return value
  // is always the actual rendered state, never a mutated ref peeked at mid-render.
  const [scaleByUrl, setScaleByUrl] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    const urls = new Set(markers.map((m) => m.logoUrl).filter((url): url is string => !!url && !scaleByUrl.has(url)))
    if (urls.size === 0) return
    let cancelled = false
    void Promise.all(
      Array.from(urls).map(
        (url) =>
          new Promise<[string, number] | null>((resolve) => {
            Image.getSize(
              url,
              (width, height) => resolve([url, CREST_TARGET_PX / Math.max(width, height, 1)]),
              // A crest that fails to load (broken storage path, offline) simply never gets a scale --
              // the symbol layer's own filter keeps it out, and the marker falls back to the ring alone.
              () => resolve(null)
            )
          })
      )
    ).then((results) => {
      if (cancelled) return
      const measured = results.filter((r): r is [string, number] => r !== null)
      if (measured.length === 0) return
      setScaleByUrl((prev) => new Map([...prev, ...measured]))
    })
    return () => {
      cancelled = true
    }
    // `scaleByUrl` IS a real dependency (it decides which URLs still need measuring), not an omission --
    // each re-run this causes lands on the `urls.size === 0` early return the moment nothing is left
    // unmeasured, so this never becomes a refetch loop.
  }, [markers, scaleByUrl])

  return scaleByUrl
}

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
 * STYLE SOURCE. `mapStyle` below points at OpenFreeMap's hosted "Liberty" style
 * (https://tiles.openfreemap.org/styles/liberty) -- a genuinely free, keyless, no-account vector style
 * (OpenFreeMap is a non-profit serving OpenStreetMap-derived tiles at no cost, with no request limit or
 * usage key), swapped in from MapLibre's own bare demo tiles (physical-device review: the demo style's
 * near-blank ocean/land polygons with no roads, labels or club-relevant detail read as broken on a real
 * screen). THIS IS STILL NOT NECESSARILY THE PRODUCTION CHOICE -- it costs nothing and needs no
 * provisioning, which is exactly why it is a safe interim pick rather than a commitment; a real release
 * may still want a paid commercial plan (Stadia Maps or MapTiler, see the Section 2 completion report
 * for researched pricing) for an SLA/support relationship a free non-profit service does not offer. That
 * remains the product owner's own decision, made once, and swapped in here as the one constant.
 */
const DEVELOPMENT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"

/**
 * MAPLIBRE MAP: clustered GeoJSON source, minimal marker payload (Section 62), REAL crests where one is
 * genuinely on file (owner mock-up reconciliation pass -- see `useCrestScales` above for why this no
 * longer needs a resize step). Individual clubs still carry a colour-coded ring (own-club/partner/on-
 * Ovalball/directory-only, never colour alone), now with the club's own crest inside it wherever one
 * exists and could be measured; a club with no crest keeps the ring-only "deliberate premium fallback"
 * treatment rather than an invented image.
 *
 * CAMERA INTENT (visual-review pass): opens on the viewer's own club when one is genuinely known --
 * the SAME `origin` the distance filter and the bottom sheet's own mileage already use, never a new
 * location source and never the device's own GPS (Clubhouse asks for no location permission at all).
 * Falls back to the UK-wide view exactly as before when no real origin exists (a team-context viewer,
 * or a club with no geocoded location yet).
 */
export function ClubhouseMap({
  markers,
  onSelect,
  origin,
  selectedDirectoryId,
}: {
  markers: ClubMapMarker[]
  onSelect: (m: ClubMapMarker) => void
  origin?: ClubMapMarker | null
  /** The currently open sheet's own club, if any -- purely a paint signal (see `isSelected`'s own
   * doc comment in `buildClubMarkerFeatureCollection`), never an authority or a second selection store. */
  selectedDirectoryId?: string | null
}) {
  const cameraRef = useRef<CameraRef>(null)
  const mapRef = useRef<MapRef>(null)
  const initialCenter: [number, number] = origin?.hasLocation && origin.longitude !== null && origin.latitude !== null ? [origin.longitude, origin.latitude] : UK_CENTER
  const initialZoom = origin?.hasLocation ? 9 : UK_ZOOM

  const crestScaleByUrl = useCrestScales(markers)
  // Re-keyed from URL to directoryId only here, right before the geojson build -- `useCrestScales`
  // itself dedupes by URL (two clubs could theoretically share a storage path), the geojson properties
  // are keyed by directoryId (what the paint/filter expressions actually match on).
  const crestScaleByDirectoryId = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of markers) {
      if (m.logoUrl && crestScaleByUrl.has(m.logoUrl)) map.set(m.directoryId, crestScaleByUrl.get(m.logoUrl) as number)
    }
    return map
  }, [markers, crestScaleByUrl])

  // THE ACTUAL CREST REGISTRATION: MapLibre's `Images` component takes the remote URL directly (no
  // download/resize needed on this side at all -- see `useCrestScales`), keyed by directoryId so the
  // symbol layer's `icon-image: ["get", "directoryId"]` below can address it. Only markers that were
  // successfully measured are registered -- an unmeasured or failed crest is never handed to the
  // native layer at all, so it can only ever fall back to the ring, never render at a guessed size.
  const crestImages = useMemo(() => {
    const images: Record<string, string> = {}
    for (const m of markers) {
      if (m.logoUrl && crestScaleByDirectoryId.has(m.directoryId)) images[m.directoryId] = m.logoUrl
    }
    return images
  }, [markers, crestScaleByDirectoryId])

  const geojson = useMemo(() => buildClubMarkerFeatureCollection(markers, selectedDirectoryId, crestScaleByDirectoryId), [markers, selectedDirectoryId, crestScaleByDirectoryId])

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
      {/* Registered once per unique, successfully-measured crest URL -- never a name/keyword baked into
          the artwork, never a fabricated fallback image; a club with no real crest simply contributes
          no entry here at all. */}
      <Images images={crestImages} />
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
        {/*
          THE INDIVIDUAL MARKER'S BACKING BADGE: a white-contained circle with a colour-coded ring (the
          same forest/pitch/grey vocabulary the sheet and every other Clubhouse surface already use for
          status) -- replacing what used to be a flat, solid-coloured 8px dot identical for a partner
          and for any of the ~1,390 unclaimed directory clubs bar the colour. The selected marker is
          visibly bigger and heavier-ringed, never colour alone. This badge is the "deliberate premium
          fallback" for any club with no crest, and the CONTAINER for one that has a crest -- the
          `clubhouseClubCrests` symbol layer below draws directly on top of it.
        */}
        <Layer
          id="clubhouseClubPoints"
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-radius": ["case", ["get", "isSelected"], 20, 14],
            "circle-color": ["case", ["==", ["get", "networkState"], "on_ovalball"], colour.surface, "rgba(154,163,156,0.16)"],
            "circle-stroke-width": ["case", ["get", "isSelected"], 3.5, 2],
            "circle-stroke-color": [
              "case",
              ["get", "isOwnClub"], colour.pitch400,
              ["==", ["get", "partnershipStatus"], "active"], colour.pitch600,
              ["==", ["get", "networkState"], "on_ovalball"], colour.forest800,
              "#9aa39c",
            ],
          }}
        />
        {/* THE REAL CREST, drawn only for a feature whose `iconScale` is genuinely > 0 -- i.e. a real
            crest exists AND `useCrestScales` measured it successfully. `icon-size` is per-feature
            (`["get", "iconScale"]`) rather than one fixed number precisely so a tiny upload and a huge
            one both land at approximately `CREST_TARGET_PX` on screen. `icon-allow-overlap` because a
            crest inside its own badge, at a fixed small size, never needs collision detection with its
            neighbours the way a text label would. */}
        <Layer
          id="clubhouseClubCrests"
          type="symbol"
          filter={["all", ["!", ["has", "point_count"]], [">", ["get", "iconScale"], 0]]}
          layout={{
            "icon-image": ["get", "directoryId"],
            "icon-size": ["get", "iconScale"],
            "icon-allow-overlap": true,
          }}
        />
      </GeoJSONSource>
    </MapLibreMap>
  )
}
