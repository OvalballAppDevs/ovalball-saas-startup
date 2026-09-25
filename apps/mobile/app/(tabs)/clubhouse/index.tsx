import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Image, Linking, Pressable, Share, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef, type MapRef } from "@maplibre/maplibre-react-native"
import type { NativeSyntheticEvent } from "react-native"
import type { PressEventWithFeatures } from "@maplibre/maplibre-react-native"

import {
  applyClubhouseFilter,
  inviteClubToOvalball,
  matchesClubhouseQuery,
  readClubDetail,
  readClubhouseMarkers,
  requestPartnership,
  respondToPartnership,
  revokePartnership,
  type ClubDetail,
  type ClubMapMarker,
  type ClubhouseFilter,
} from "@ovalball/contracts/clubhouse"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { BottomSheet } from "../../../src/components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { Layers, LayoutGrid, MapPin, Search, Share2, X } from "../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"
import { webUrl } from "../../../src/config/environment"

/**
 * CLUBHOUSE V1 — THE OVALBALL RUGBY NETWORK (owner product decision).
 *
 * The map is the hero (Section 11): a full-directory MapLibre view, clustered, searchable, filterable,
 * with a native bottom sheet on selection. This screen is deliberately the ONE place all of the
 * following converge, per the owner's consolidation instruction, rather than each staying a separate
 * destination:
 *
 *   - discovering clubs (the map/list itself, `readClubhouseMarkers`)
 *   - partner clubs (`club_partnerships`, via the shared `clubhouse/actions.ts` wrappers)
 *   - Find a Fixture (deep-links into the EXISTING `/fixtures/new` composer, never a second one)
 *   - Compare Calendars (same composer -- it already shows the availability panel once an opponent
 *     is chosen; there is no second calendar-comparison implementation)
 *   - Invite to Ovalball (the EXISTING `create_partner_invitation` RPC, shared via `clubhouse/actions.ts`)
 *
 * WHAT IS DELIBERATELY NOT HERE YET (Section 75): "Looking for Opposition" markers/filter (the domain
 * does not exist -- see the unapplied, uncommitted `20270554000000_looking_for_opposition.sql`), a
 * dedicated Activity/Partners sub-screen (V1 folds their content into this one screen's sheet/list
 * rather than adding two more routes before the foundation is proven), bulk directory geocoding, and
 * bounding-box server queries (today's ~1,400-row directory does not need them yet -- see
 * `clubhouse/map-read-model.ts`'s own comment).
 */
export default function Clubhouse() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { userId } = useSession()
  const { active } = useAppContexts()
  const [sheetOpen, setSheetOpen] = useState(false)

  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<ClubhouseFilter>("all")
  const [mode, setMode] = useState<"map" | "list">("map")
  const [selected, setSelected] = useState<ClubMapMarker | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await readClubhouseMarkers(supabase, viewerClubId)
      setMarkers(rows)
    } catch {
      setError("Couldn't load the club network. Check your connection and try again.")
    }
  }, [viewerClubId])

  useEffect(() => {
    // Cleared FIRST: the previous context's markers (partnership/own-club state is context-specific)
    // must never be shown while the next context's answer is still loading.
    setMarkers(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const filtered = useMemo(() => {
    if (!markers) return []
    const byFilter = applyClubhouseFilter(markers, filter, null)
    return byFilter.filter((m) => matchesClubhouseQuery(m, query))
  }, [markers, filter, query])

  const withLocation = useMemo(() => filtered.filter((m) => m.hasLocation), [filtered])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm, backgroundColor: colour.chalk }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          Clubhouse
        </Text>
        <SearchField value={query} onChange={setQuery} />
        <FilterChips filter={filter} onChange={setFilter} />
      </View>

      <View style={{ flex: 1 }}>
        {markers === null && !error && (
          <View style={{ padding: space.lg, gap: space.md }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}
        {error && <ErrorState message={error} onRetry={() => void load()} />}
        {markers !== null && !error && filtered.length === 0 && (
          <EmptyState title="No clubs match" body="Try a different search or filter, or widen the map area." />
        )}
        {markers !== null && !error && filtered.length > 0 && mode === "map" && (
          <ClubhouseMap markers={withLocation} onSelect={setSelected} />
        )}
        {markers !== null && !error && filtered.length > 0 && mode === "list" && (
          <ClubhouseList markers={filtered} onSelect={setSelected} />
        )}
      </View>

      {/* MAP | LIST -- Section 20: the same search/filter query backs both, so switching never loses
          a non-geocoded club (the map alone cannot show one; the list always can). */}
      <View style={{ position: "absolute", bottom: insets.bottom + space.lg, alignSelf: "center", flexDirection: "row", borderRadius: radius.pill, backgroundColor: colour.forest950, padding: 4, gap: 4 }}>
        <ModeButton label="Map" icon={<Layers size={16} color={mode === "map" ? colour.forest950 : colour.onForest} />} active={mode === "map"} onPress={() => setMode("map")} />
        <ModeButton label="List" icon={<LayoutGrid size={16} color={mode === "list" ? colour.forest950 : colour.onForest} />} active={mode === "list"} onPress={() => setMode("list")} />
      </View>

      <ClubSheet
        marker={selected}
        onClose={() => setSelected(null)}
        viewerClubId={viewerClubId}
        viewerTeamId={viewerTeamId}
        userId={userId}
        onChanged={() => void load()}
      />

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
      <Search size={17} color={colour.inkSubtle} />
      <TextInput
        accessibilityLabel="Search clubs by name, town or postcode"
        value={value}
        onChangeText={onChange}
        placeholder="Search clubs, towns, postcodes"
        placeholderTextColor={colour.inkSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={[type.small, { flex: 1, color: colour.ink, paddingVertical: 0 }]}
      />
      {value.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange("")} hitSlop={8}>
          <X size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
    </View>
  )
}

const FILTERS: { key: ClubhouseFilter; label: string }[] = [
  { key: "all", label: "All Clubs" },
  { key: "on_ovalball", label: "On Ovalball" },
  { key: "partners", label: "Partners" },
]

function FilterChips({ filter, onChange }: { filter: ClubhouseFilter; onChange: (f: ClubhouseFilter) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Filter clubs" style={{ flexDirection: "row", gap: space.sm }}>
      {FILTERS.map((f) => {
        const on = filter === f.key
        return (
          <Pressable
            key={f.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(f.key)}
            style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}
          >
            <Text style={[type.caption, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function ModeButton({ label, icon, active, onPress }: { label: string; icon: React.ReactNode; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} view`}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: active ? colour.pitch400 : "transparent" }}
    >
      {icon}
      <Text style={[type.smallMedium, { color: active ? colour.forest950 : colour.onForest }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * UK-WIDE DEFAULT CAMERA. No device-location permission is requested to use Clubhouse at all
 * (Section 56) -- the map opens centred on Great Britain, which is where the whole current directory
 * sits, rather than asking for a permission the product does not need for its core job.
 */
const UK_CENTER: [number, number] = [-2.5, 54.0]
const UK_ZOOM = 5

/**
 * MAPLIBRE MAP: clustered GeoJSON source, minimal marker payload (Section 62). Individual clubs render
 * as a coloured circle (own-club/partner/on-Ovalball/directory-only told apart by paint expression,
 * never colour alone -- the bottom sheet carries the word); crest imagery renders in the sheet and the
 * list, not as a per-point raster on the map itself (a real MapLibre image-sprite integration for
 * ~100+ distinct remote crest URLs is deferred past V1 -- see the Clubhouse completion report).
 *
 * STYLE SOURCE. `mapStyle` below points at MapLibre's own demo tiles
 * (https://demotiles.maplibre.org/style.json) -- explicitly provided by the MapLibre project for
 * exactly this kind of development use, keyless and serverless. THIS IS NOT A PRODUCTION TILE SOURCE.
 * A real release needs a paid commercial tile/style plan (Stadia Maps or MapTiler both require one --
 * neither offers a free commercial tier; see the completion report for the researched pricing) chosen
 * and provisioned by the product owner before this ships, then swapped in here as the one constant.
 */
const DEVELOPMENT_MAP_STYLE = "https://demotiles.maplibre.org/style.json"

function ClubhouseMap({ markers, onSelect }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void }) {
  const cameraRef = useRef<CameraRef>(null)
  const mapRef = useRef<MapRef>(null)

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: markers.map((m) => ({
        type: "Feature" as const,
        id: m.directoryId,
        properties: {
          directoryId: m.directoryId,
          networkState: m.networkState,
          partnershipStatus: m.partnershipStatus,
          isOwnClub: m.isOwnClub,
        },
        geometry: { type: "Point" as const, coordinates: [m.longitude as number, m.latitude as number] },
      })),
    }),
    [markers]
  )

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
      <Camera ref={cameraRef} initialViewState={{ center: UK_CENTER, zoom: UK_ZOOM }} />
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

function ClubhouseList({ markers, onSelect }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void }) {
  return (
    <FlatList
      data={markers}
      keyExtractor={(m) => m.directoryId}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl * 2 }}
      renderItem={({ item }) => <ClubListRow marker={item} onPress={() => onSelect(item)} />}
    />
  )
}

function ClubListRow({ marker, onPress }: { marker: ClubMapMarker; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${marker.name}, ${marker.networkState === "on_ovalball" ? "on Ovalball" : "not yet on Ovalball"}${marker.hasLocation ? "" : ", map location not yet verified"}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: TOUCH_TARGET + 12,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : colour.surface,
      })}
    >
      <ClubCrest url={marker.logoUrl} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
          {marker.name}
        </Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
          {[marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "" : "Location unavailable")}
        </Text>
      </View>
      <NetworkPill marker={marker} />
    </Pressable>
  )
}

function NetworkPill({ marker }: { marker: ClubMapMarker }) {
  if (marker.partnershipStatus === "active") return <StatusPill label="Partner" tone="positive" />
  if (marker.networkState === "on_ovalball") return <StatusPill label="On Ovalball" tone="neutral" />
  return <StatusPill label="Not yet on Ovalball" tone="caution" />
}

function ClubCrest({ url, size }: { url: string | null; size: number }) {
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colour.chalk }} accessibilityIgnoresInvertColors />
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line, alignItems: "center", justifyContent: "center" }}>
      <MapPin size={size * 0.45} color={colour.inkSubtle} />
    </View>
  )
}

/**
 * THE CLUB BOTTOM SHEET (Section 26-28). Detail is fetched only once a marker is tapped -- never
 * bundled into the map payload. Truthful by construction: `ClubNetworkActions` decides what can be
 * shown, so there is no client-side "hide this button for an unclaimed club" special case to forget.
 */
function ClubSheet({
  marker,
  onClose,
  viewerClubId,
  viewerTeamId,
  userId,
  onChanged,
}: {
  marker: ClubMapMarker | null
  onClose: () => void
  viewerClubId: string | null
  viewerTeamId: string | null
  userId: string | null
  onChanged: () => void
}) {
  const router = useRouter()
  const [detail, setDetail] = useState<ClubDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setFeedback(null)
    setInvite(null)
    setInviteLink(null)
    if (!marker) return
    let live = true
    void readClubDetail(supabase, marker, viewerClubId, viewerTeamId).then((d) => {
      if (live) setDetail(d)
    })
    return () => {
      live = false
    }
  }, [marker, viewerClubId, viewerTeamId])

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await run()
      if (!result.ok) {
        setFeedback(result.error ?? "That didn't work. Try again.")
      } else {
        onChanged()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={!!marker} onClose={onClose} title={marker?.name ?? ""} cancelLabel="Close">
      {marker && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ClubCrest url={marker.logoUrl} size={56} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{marker.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}</Text>
              <Text numberOfLines={1} style={[type.small, { color: colour.inkMuted }]}>
                {[marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "" : "Location unavailable")}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: space.sm }}>
            <NetworkPill marker={marker} />
            {marker.partnershipStatus === "pending_incoming" && <StatusPill label="Wants to partner" tone="caution" />}
            {marker.partnershipStatus === "pending_outgoing" && <StatusPill label="Request sent" tone="neutral" />}
          </View>

          {!detail && <CardSkeleton lines={2} />}

          {detail && (detail.compatibleTeamCount !== null || detail.fixturesTogetherThisSeason !== null) && (
            <View style={{ flexDirection: "row", gap: space.xl }}>
              {detail.compatibleTeamCount !== null && <Stat value={detail.compatibleTeamCount} label={detail.compatibleTeamCount === 1 ? "compatible team" : "compatible teams"} />}
              {detail.fixturesTogetherThisSeason !== null && <Stat value={detail.fixturesTogetherThisSeason} label={detail.fixturesTogetherThisSeason === 1 ? "fixture this season" : "fixtures this season"} />}
            </View>
          )}

          {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}

          {invite && (
            <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <TextInput accessibilityLabel="Contact name" value={invite.name} onChangeText={(name) => setInvite({ ...invite, name })} placeholder="Contact name at this club" placeholderTextColor={colour.inkSubtle} style={sheetInput} />
              <TextInput accessibilityLabel="Contact email" value={invite.email} onChangeText={(email) => setInvite({ ...invite, email })} placeholder="Contact email" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" keyboardType="email-address" style={sheetInput} />
              <Button
                label="Send Invitation"
                busy={busy}
                disabled={!invite.name.trim() || !invite.email.trim()}
                onPress={() =>
                  void act(async () => {
                    if (!viewerClubId) return { ok: false, error: "You don't have fixture authority at a club." }
                    const result = await inviteClubToOvalball(supabase, webUrl, viewerClubId, marker.directoryId, invite.name.trim(), invite.email.trim())
                    if (!result.ok) return result
                    setInviteLink(result.inviteLink)
                    return { ok: true }
                  })
                }
              />
            </View>
          )}

          {inviteLink && (
            <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Invitation sent. Share the link yourself too, if useful:</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share invitation link"
                onPress={() => void Share.share({ message: inviteLink })}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, minHeight: TOUCH_TARGET, borderRadius: radius.md, backgroundColor: colour.forest800 }}
              >
                <Share2 size={16} color={colour.onForest} />
                <Text style={[type.smallMedium, { color: colour.onForest }]}>Share Invitation</Text>
              </Pressable>
            </View>
          )}

          {detail && (
            <View style={{ gap: space.sm }}>
              {detail.actions.canFindFixture && (
                <Button
                  label="Find a Fixture"
                  onPress={() => {
                    onClose()
                    router.push({ pathname: "/fixtures/new", params: viewerTeamId ? { teamId: viewerTeamId } : {} } as never)
                  }}
                />
              )}
              {detail.actions.canCompareCalendar && (
                <Button
                  variant="secondary"
                  label="Compare Calendars"
                  onPress={() => {
                    onClose()
                    router.push({ pathname: "/fixtures/new", params: viewerTeamId ? { teamId: viewerTeamId } : {} } as never)
                  }}
                />
              )}
              {detail.actions.canPartner && (
                <Button
                  variant="secondary"
                  label="Partner with Club"
                  busy={busy}
                  onPress={() =>
                    void act(async () => {
                      if (!viewerClubId || !userId || !marker.clubId) return { ok: false, error: "You don't have fixture authority at a club." }
                      return requestPartnership(supabase, viewerClubId, marker.clubId, userId)
                    })
                  }
                />
              )}
              {detail.actions.canCancelOutgoingPartnerRequest && marker.partnershipId && (
                <Button variant="quiet" label="Cancel Partner Request" busy={busy} onPress={() => void act(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
              {detail.actions.canRespondPartnerRequest && marker.partnershipId && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="secondary" label="Decline" busy={busy} onPress={() => void act(() => respondToPartnership(supabase, marker.partnershipId as string, false))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Accept" busy={busy} onPress={() => void act(() => respondToPartnership(supabase, marker.partnershipId as string, true))} />
                  </View>
                </View>
              )}
              {detail.actions.canRevokePartnership && marker.partnershipId && (
                <Button variant="quiet" label="End Partnership" busy={busy} onPress={() => void act(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
              {detail.actions.canInviteToOvalball && !invite && !inviteLink && <Button variant="secondary" label="Invite to Ovalball" onPress={() => setInvite({ name: "", email: "" })} />}
              {marker.slug && (
                <Button variant="quiet" label="View Club" onPress={() => void Linking.openURL(`${webUrl}/clubs/${marker.slug}`)} />
              )}
            </View>
          )}
        </View>
      )}
    </BottomSheet>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View>
      <Text style={[type.title, { color: colour.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}

const sheetInput = {
  minHeight: TOUCH_TARGET,
  paddingHorizontal: space.md,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colour.lineStrong,
  backgroundColor: colour.surface,
  color: colour.ink,
}
