"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet.markercluster/dist/MarkerCluster.css"
import "leaflet.markercluster/dist/MarkerCluster.Default.css"
import "leaflet.markercluster"

import { ClubMapCard } from "./club-map-card"
import type { MapClub } from "./map-data"

export interface ClubMapHandle {
  flyTo: (latitude: number, longitude: number) => void
}

// Great Britain, roughly -- a sane default view before anything is
// searched or selected. Real club coordinates always come from the
// cached geocode columns; nothing here is a per-club default.
const DEFAULT_CENTER: [number, number] = [53.9, -2.5]
const DEFAULT_ZOOM = 6

// Solid filled dot ("on Ovalball") vs. a hollow ring ("not yet on
// Ovalball") -- shape carries the same distinction as color here, not
// just a different hue, so the two pin types are still tell-apart at a
// glance for a colorblind viewer scanning the raw map before opening any
// popup (the popups/list rows already pair color with text; the pins
// themselves needed their own non-color signal too).
function pinIcon(kind: "on-ovalball" | "not-on-ovalball"): L.DivIcon {
  const html =
    kind === "on-ovalball"
      ? `<span style="display:block;width:16px;height:16px;border-radius:50%;background:var(--color-pitch-600);border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></span>`
      : `<span style="display:block;width:16px;height:16px;border-radius:50%;background:white;border:3px solid var(--color-destructive);box-shadow:0 1px 3px rgba(0,0,0,0.4)"></span>`
  return L.divIcon({ className: "", html, iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] })
}

const ON_OVALBALL_ICON = pinIcon("on-ovalball")
const NOT_ON_OVALBALL_ICON = pinIcon("not-on-ovalball")

/**
 * Imperative Leaflet, not react-leaflet's declarative <Marker>/<Popup> --
 * leaflet.markercluster owns marker grouping directly through Leaflet's
 * own layer API, and there's no maintained react-leaflet wrapper for it
 * pinned to react-leaflet 5. Popup content is real React (ClubMapCard,
 * the same card the list panel uses) mounted into the popup's DOM node
 * via createRoot on open and unmounted on close, so the "Request
 * partnership"/"Accept"/"Decline" buttons stay fully interactive.
 */
export const ClubMap = forwardRef<ClubMapHandle, { clubs: MapClub[] }>(function ClubMap({ clubs }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const popupRootRef = useRef<Root | null>(null)

  useImperativeHandle(ref, () => ({
    flyTo(latitude, longitude) {
      mapRef.current?.flyTo([latitude, longitude], 13, { duration: 0.6 })
    },
  }))

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    mapRef.current = map

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)

    map.on("popupclose", () => {
      popupRootRef.current?.unmount()
      popupRootRef.current = null
    })

    return () => {
      popupRootRef.current?.unmount()
      popupRootRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 })

    for (const club of clubs) {
      if (!club.hasLocation || club.latitude === null || club.longitude === null) continue
      const marker = L.marker([club.latitude, club.longitude], {
        icon: club.clubId ? ON_OVALBALL_ICON : NOT_ON_OVALBALL_ICON,
        alt: `${club.name} -- ${club.clubId ? "on Ovalball" : "not yet on Ovalball"}`,
        keyboard: true,
      })

      const popupNode = document.createElement("div")
      popupNode.className = "w-72"
      marker.bindPopup(popupNode, { maxWidth: 300, minWidth: 260 })
      marker.on("popupopen", () => {
        popupRootRef.current?.unmount()
        const root = createRoot(popupNode)
        popupRootRef.current = root
        root.render(<ClubMapCard club={club} />)
      })

      clusterGroup.addLayer(marker)
    }

    map.addLayer(clusterGroup)
    return () => {
      map.removeLayer(clusterGroup)
    }
  }, [clubs])

  // role="region" (a landmark), not role="application" -- application
  // mode forces assistive tech into a separate navigation mode that's
  // easy to get stuck in without an explicit, documented escape gesture.
  // Leaflet's own keyboard handling (pan/zoom, marker `keyboard: true`)
  // already works fine inside normal document navigation.
  return <div ref={containerRef} className="h-full w-full" role="region" aria-label="Map of clubs" />
})
