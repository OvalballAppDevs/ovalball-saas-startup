import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, Linking, Pressable, Share, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Constants from "expo-constants"

import {
  applyClubhouseDistanceFilter,
  applyClubhouseFilter,
  distanceMiles,
  findDistanceOrigin,
  inviteClubToOvalball,
  matchesClubhouseQuery,
  readClubDetail,
  readClubhouseMarkers,
  requestPartnership,
  respondToPartnership,
  revokePartnership,
  type ClubDetail,
  type ClubMapMarker,
  type ClubhouseDistanceFilter,
  type ClubhouseFilter,
} from "@ovalball/contracts/clubhouse"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { startClubConversation } from "../../../src/messages/club-conversations"
import { CLAIMABLE_ROLES, submitClubClaim, type ClaimableRole } from "../../../src/clubhouse/claims"
import { BottomSheet } from "../../../src/components/bottom-sheet"
import { ChoiceField, Field, TextField } from "../../../src/components/form"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { ChevronDown, ChevronRight, LayoutGrid, MapPin, Search, Share2, SlidersHorizontal, X } from "../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"
import { webUrl } from "../../../src/config/environment"
import { ClubCrest, DistanceChips, NetworkPill } from "../../../src/clubhouse/components"
import { resolveInitialMode, type ClubhouseMapMode } from "../../../src/clubhouse/entry-mode"

/**
 * EXPLORE THE MAP — the club-discovery view of Clubhouse, pushed from Clubhouse Home's own "Explore
 * the Map" card (or its "Partner Clubs" card, with the Partners filter pre-selected -- see
 * `initialFilter` below). This used to be the Clubhouse TAB'S OWN ROOT screen (Clubhouse V1); Home
 * (`index.tsx`) is now that root, introducing the wider network product before this, its signature
 * discovery mode. Nothing about the map/list/sheet itself changed in this move -- only its header
 * (a back arrow into Home, not the tab's own identity/context bar) and the route it now lives at.
 *
 * A full-directory MapLibre view, clustered, searchable, filterable, with a native bottom sheet on
 * selection. This screen is deliberately the ONE place all of the following converge, per the owner's
 * consolidation instruction, rather than each staying a separate destination:
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
export default function ExploreMap() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { userId } = useSession()
  const { active } = useAppContexts()
  // Clubhouse Home's own "Partner Clubs" card hands off here with the Partners filter already chosen
  // -- never a second partner-list implementation, just this same map/list pre-filtered. "Find a Club"
  // hands off with mode=search: the INTENT-LED job ("I know which club I want") wants the list, search
  // already focused, rather than the DISCOVERY-LED map "Explore the Map" itself opens on.
  const params = useLocalSearchParams<{ filter?: string; mode?: string }>()
  const initialFilter: ClubhouseFilter = params.filter === "partners" || params.filter === "on_ovalball" ? params.filter : "all"
  const searchLed = params.mode === "search"

  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<ClubhouseFilter>(initialFilter)
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")
  // ENTRY INTENT DECIDES THIS, NEVER THE ENVIRONMENT (physical-review correction: Expo Go used to force
  // List here with no way back to Map, making "Explore the Map" indistinguishable from "Find a Club" --
  // a real bug, not a deliberate degradation). Expo Go's genuine inability to RENDER MapLibre is handled
  // entirely inside `ClubhouseMap` below (an honest "needs a development build" message), never by
  // silently swapping which mode the screen opens in or hiding the way back to it.
  const [mode, setMode] = useState<ClubhouseMapMode>(() => resolveInitialMode(params))
  const [selected, setSelected] = useState<ClubMapMarker | null>(null)
  const [distanceSheetOpen, setDistanceSheetOpen] = useState(false)
  const [sort, setSort] = useState<"nearest" | "name">("nearest")
  // The floating search+filter chrome's own measured height (physical-review correction) -- see the
  // onLayout below; 0 until the first real measurement lands, so a one-time hardcoded fallback covers
  // that single frame only.
  const [chromeHeight, setChromeHeight] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await readClubhouseMarkers(supabase, viewerClubId, viewerTeamId)
      setMarkers(rows)
    } catch {
      setError("Couldn't load the club network. Check your connection and try again.")
    }
  }, [viewerClubId, viewerTeamId])

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

  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  const filtered = useMemo(() => {
    if (!markers) return []
    const byFilter = applyClubhouseFilter(markers, filter, null)
    const byDistance = applyClubhouseDistanceFilter(byFilter, distance, origin)
    return byDistance.filter((m) => matchesClubhouseQuery(m, query))
  }, [markers, filter, distance, origin, query])

  const withLocation = useMemo(() => filtered.filter((m) => m.hasLocation), [filtered])

  // NEAREST IS REAL, OR IT IS NOT OFFERED -- the same distance arithmetic the filter and the sheet's
  // own mileage already use (`distanceMiles`/`origin`), never a fabricated ordering. Without a real
  // origin (a team-context viewer, or a club with no geocoded location yet), "Nearest" has nothing to
  // sort by, so the control below falls back to Name and says so.
  const sorted = useMemo(() => {
    if (sort === "nearest" && origin) {
      return [...filtered].sort((a, b) => {
        const da = a.hasLocation ? (distanceMiles(origin, a) ?? Infinity) : Infinity
        const db = b.hasLocation ? (distanceMiles(origin, b) ?? Infinity) : Infinity
        return da - db
      })
    }
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered, sort, origin])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <MapBackHeader title={searchLed ? "Find a Club" : "Explore Clubs"} onBack={() => router.back()} insets={insets} />

      {/* THE MAP IS THE HERO (Section 2/11) -- no page-title header eating vertical space above it.
          Search and filters float directly over the map/list -- no enclosing white card behind them,
          matching the reference's own floating-pill chrome -- instead of occupying a fixed chalk
          block. THIS WRAPPER, not the screen root, is what every `position: "absolute"` child below
          is measured against -- it starts right after the header ends, so a `top: space.md` overlay
          floats just under the header instead of covering it (a real bug found live: the overlay used
          to be a sibling of the header at the screen root, so it rendered on top of the header itself,
          hiding the identity/context bar entirely). */}
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {markers === null && !error && (
            <View style={{ padding: space.lg, gap: space.md, paddingTop: space.xxl * 2 }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {markers !== null && !error && filtered.length === 0 && (
            <View style={{ flex: 1, paddingTop: space.xxl * 2 }}>
              <EmptyState title="No clubs match" body="Try a different search or filter, or widen the map area." />
            </View>
          )}
          {markers !== null && !error && filtered.length > 0 && mode === "map" && (
            <ClubhouseMap markers={withLocation} onSelect={setSelected} origin={origin} />
          )}
          {markers !== null && !error && filtered.length > 0 && mode === "list" && (
            <ClubhouseList
              markers={sorted}
              onSelect={setSelected}
              origin={origin}
              topInset={chromeHeight > 0 ? chromeHeight + space.sm : 124}
              count={filtered.length}
              sort={sort}
              onChangeSort={setSort}
              sortEnabled={!!origin}
              onSwitchToMap={() => setMode("map")}
            />
          )}
        </View>

        {/* FLOATING SEARCH + FILTERS, on both map and list (the reference keeps the identical chrome in
            either mode) -- a white pill for search, dark pills directly on the ground for filters, no
            card behind either. Measured via onLayout (physical-review correction) so the list's own
            top padding matches this chrome's REAL height exactly, rather than a guessed constant that
            drifted once the enclosing white card was removed and left a dead gap above the list. */}
        <View
          onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
          style={{ position: "absolute", top: space.md, left: space.lg, right: space.lg, gap: space.sm }}
        >
          <SearchField value={query} onChange={setQuery} autoFocus={searchLed} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <FilterChips filter={filter} onChange={setFilter} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={distance === "any" ? "Filter by distance" : `Filtering within ${distance} miles. Change distance filter`}
              onPress={() => setDistanceSheetOpen(true)}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: distance !== "any" ? colour.pitch600 : "rgba(16,21,18,0.55)",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <SlidersHorizontal size={15} color={colour.onForest} />
            </Pressable>
          </View>
        </View>

        {/* MAP MODE'S OWN TOGGLE. Physical-review correction: always visible (never hidden for Expo
            Go -- hiding it removed the only way back to Map, where the honest "needs a development
            build" message actually lives) and now carries visible wording, not just an icon, since an
            icon-only control for the single most important mode change on the screen was judged too
            easy to miss/misread. */}
        {mode === "map" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch to list view"
            onPress={() => setMode("list")}
            style={({ pressed }) => ({
              position: "absolute",
              top: chromeHeight > 0 ? chromeHeight + space.lg : 132,
              right: space.lg,
              minHeight: 40,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: colour.surface,
              opacity: pressed ? 0.85 : 1,
              ...elevation.card,
            })}
          >
            <LayoutGrid size={16} color={colour.forest800} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>List</Text>
          </Pressable>
        )}
      </View>

      <ClubSheet
        marker={selected}
        onClose={() => setSelected(null)}
        viewerClubId={viewerClubId}
        viewerTeamId={viewerTeamId}
        userId={userId}
        onChanged={() => void load()}
        origin={origin}
      />

      <DistanceFilterSheet visible={distanceSheetOpen} distance={distance} onChange={setDistance} onClose={() => setDistanceSheetOpen(false)} />
    </View>
  )
}

function MapBackHeader({ title, onBack, insets }: { title: string; onBack: () => void; insets: { top: number } }) {
  return (
    <View
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        backgroundColor: colour.chalk,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Clubhouse"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        {title}
      </Text>
    </View>
  )
}

function SearchField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.surface, ...elevation.card }}>
      <Search size={17} color={colour.inkSubtle} />
      <TextInput
        accessibilityLabel="Search clubs by name, town or postcode"
        value={value}
        onChangeText={onChange}
        placeholder="Search clubs, town or postcode"
        placeholderTextColor={colour.inkSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
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

/**
 * FLOATING DIRECTLY ON THE GROUND (visual-review correction) -- dark, semi-transparent pills rather
 * than a white card behind them, so they read the same way over the map's own colours as they do over
 * the list's chalk background (the reference uses the identical chip style in both modes).
 */
function FilterChips({ filter, onChange }: { filter: ClubhouseFilter; onChange: (f: ClubhouseFilter) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Filter clubs" style={{ flexDirection: "row", gap: space.sm, flex: 1 }}>
      {FILTERS.map((f) => {
        const on = filter === f.key
        return (
          <Pressable
            key={f.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(f.key)}
            style={{
              minHeight: 34,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: on ? colour.pitch600 : "rgba(16,21,18,0.55)",
              justifyContent: "center",
            }}
          >
            <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{f.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The reference's own segmented rectangle, used only where there is no map to float a circular
 * button over -- List mode's own inline header, sitting with the club count and the sort control. */
function MapListSegment({ mode, onSwitchToMap }: { mode: "map" | "list"; onSwitchToMap: (() => void) | null }) {
  if (!onSwitchToMap) return null
  return (
    <View style={{ flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, overflow: "hidden", alignSelf: "flex-start" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: (mode as "map" | "list") === "map" }}
        accessibilityLabel="Map view"
        onPress={onSwitchToMap}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH_TARGET - 8, paddingHorizontal: space.md, backgroundColor: colour.surface }}
      >
        <MapPin size={14} color={colour.forest800} />
        <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>Map</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH_TARGET - 8, paddingHorizontal: space.md, backgroundColor: colour.pitch600 }}>
        <LayoutGrid size={14} color={colour.onForest} />
        <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>List</Text>
      </View>
    </View>
  )
}

/**
 * EXPO GO CANNOT RUN MAPLIBRE. Confirmed live on a real device: `TurboModuleRegistry.getEnforcing(...):
 * 'MLRNCameraModule' could not be found` -- Expo Go only ships the fixed native-module set built into
 * the Expo Go client itself, and MapLibre's native code was never part of it (this was flagged as a
 * real risk in every Clubhouse report; it could not be verified without a physical device until now).
 *
 * `Constants.appOwnership === "expo"` is the precise (if formally deprecated) signal for "this is
 * genuinely the Expo Go app," as opposed to a real development build, which DOES carry the native
 * module and works exactly as designed. The MapLibre-dependent code lives in
 * `src/clubhouse/native-map.tsx` -- DELIBERATELY NOT under `app/`, even though this file (its only
 * caller) is right next door. Expo Router scans every file under `app/` to build its route manifest and
 * bundles it eagerly as part of that scan, regardless of how -- or whether -- anything actually
 * `require()`s it; a first attempt at this fix put the file at `app/(tabs)/clubhouse/native-map.tsx`
 * and it crashed Expo Go identically, from `native-map.tsx:3`'s own top-level MapLibre import, proving
 * the router's own eager scan is what evaluates it, not this file's `require()` call. Only a module
 * genuinely outside `app/` is exempt from that scan and reached solely through ordinary JS module
 * resolution -- which is what makes the runtime `require()` below actually work: the module's top-level
 * code (including MapLibre's native-module registration) now only runs the moment this line executes,
 * and it is guarded so that line never runs inside Expo Go.
 */
const isExpoGo = Constants.appOwnership === "expo"
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: see the comment above.
const NativeMap = isExpoGo ? null : (require("../../../src/clubhouse/native-map") as typeof import("../../../src/clubhouse/native-map")).ClubhouseMap

function ClubhouseMap({ markers, onSelect, origin }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void; origin: ClubMapMarker | null }) {
  if (isExpoGo || !NativeMap) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm }}>
        <MapPin size={32} color={colour.inkSubtle} />
        <Text style={[type.small, { color: colour.ink, textAlign: "center" }]}>The map needs a development build</Text>
        <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
          Expo Go can&apos;t run the native map component. Switch to List below, or open this build from a development client.
        </Text>
      </View>
    )
  }
  return <NativeMap markers={markers} onSelect={onSelect} origin={origin} />
}

function ClubhouseList({
  markers,
  onSelect,
  origin,
  topInset,
  count,
  sort,
  onChangeSort,
  sortEnabled,
  onSwitchToMap,
}: {
  markers: ClubMapMarker[]
  onSelect: (m: ClubMapMarker) => void
  /** Real only when the viewer's own club is geocoded -- see `findDistanceOrigin`. Threaded down to
   * each row so a genuinely calculable distance renders as tertiary metadata (physical-review
   * correction: "Nearest" was previously offered/sortable with no distance ever shown per row). */
  origin: ClubMapMarker | null
  topInset: number
  /** The real, already-filtered count -- "N clubs available," never the unfiltered directory size. */
  count: number
  sort: "nearest" | "name"
  onChangeSort: (s: "nearest" | "name") => void
  /** Real only when a genuine origin (the viewer's own geocoded club) exists -- see `sorted` above. */
  sortEnabled: boolean
  onSwitchToMap: () => void
}) {
  return (
    <FlatList
      data={markers}
      keyExtractor={(m) => m.directoryId}
      contentContainerStyle={{ padding: space.lg, paddingTop: topInset + space.md, gap: space.sm, paddingBottom: space.xxl * 2 }}
      ListHeaderComponent={
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
          <MapListSegment mode="list" onSwitchToMap={onSwitchToMap} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {count} {count === 1 ? "club" : "clubs"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sorted by ${sort === "nearest" && sortEnabled ? "nearest" : "name"}. Change sort order`}
              disabled={!sortEnabled}
              onPress={() => onChangeSort(sort === "nearest" ? "name" : "nearest")}
              style={{ flexDirection: "row", alignItems: "center", gap: 2, opacity: sortEnabled ? 1 : 0.4 }}
            >
              <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>{sort === "nearest" && sortEnabled ? "Nearest" : "Name"}</Text>
              <ChevronDown size={12} color={colour.forest800} />
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item }) => <ClubListRow marker={item} origin={origin} onPress={() => onSelect(item)} />}
    />
  )
}

function ClubListRow({ marker, origin, onPress }: { marker: ClubMapMarker; origin: ClubMapMarker | null; onPress: () => void }) {
  // Tertiary metadata, only when genuinely calculable -- the same rule the bottom sheet's own mileage
  // already follows: never fabricated for a club with no factual coordinate, and never for the
  // viewer's own club.
  const miles = origin && marker.hasLocation && !marker.isOwnClub ? distanceMiles(origin, marker) : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${marker.name}, ${marker.networkState === "on_ovalball" ? "on Ovalball" : "not yet on Ovalball"}${marker.hasLocation ? "" : ", map location not yet verified"}${miles !== null ? `, ${Math.round(miles)} miles away` : ""}`}
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
        {miles !== null && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>
            {Math.round(miles)} miles away
          </Text>
        )}
      </View>
      <NetworkPill marker={marker} />
    </Pressable>
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
  origin,
}: {
  marker: ClubMapMarker | null
  onClose: () => void
  viewerClubId: string | null
  viewerTeamId: string | null
  userId: string | null
  onChanged: () => void
  /** The viewer's own club, for a factual distance -- null whenever there is no real origin to measure from. */
  origin: ClubMapMarker | null
}) {
  const router = useRouter()
  const [detail, setDetail] = useState<ClubDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [claimForm, setClaimForm] = useState<{ role: ClaimableRole; declaration: string } | null>(null)
  const [claimSubmitting, setClaimSubmitting] = useState(false)
  const [claimSubmitted, setClaimSubmitted] = useState(false)

  useEffect(() => {
    setDetail(null)
    setFeedback(null)
    setInvite(null)
    setInviteLink(null)
    setMessageDraft(null)
    setClaimForm(null)
    setClaimSubmitted(false)
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
            <ClubCrest url={marker.logoUrl} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{marker.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}</Text>
              <Text numberOfLines={1} style={[type.small, { color: colour.inkMuted }]}>
                {[marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "" : "Location unavailable")}
                {/* Distance is only ever shown when both the origin (the viewer's own real, geocoded
                    club) and this club's own location are known -- never a fabricated number. */}
                {origin && marker.hasLocation && !marker.isOwnClub
                  ? (() => {
                      const miles = distanceMiles(origin, marker)
                      return miles !== null ? ` · ${Math.round(miles)} mi` : ""
                    })()
                  : ""}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <NetworkPill marker={marker} />
            {marker.partnershipStatus === "pending_incoming" && <StatusPill label="Wants to partner" tone="caution" />}
            {marker.partnershipStatus === "pending_outgoing" && <StatusPill label="Request sent" tone="neutral" />}
            {/* Section 3: plain, non-technical wording -- never "postcode centroid" or "geocode
                confidence" to an ordinary user. Only shown when the pin is genuinely the less-precise
                kind; a venue-precedence location says nothing extra, because it is the trustworthy case. */}
            {marker.locationPrecision === "postcode" && <StatusPill label="Approximate location" tone="neutral" />}
          </View>

          {!detail && <CardSkeleton lines={2} />}

          {/* SECTION 17 (NETWORK MEMORY): the season count generalised, never restarted -- both counts
              share the same canonical team-id resolution (readClubNetworkHistory), only the date range
              differs. All-time is only shown once it says something the season count doesn't. */}
          {detail && (detail.fixturesTogetherThisSeason !== null || detail.fixturesTogetherAllTime !== null) && (
            <View style={{ flexDirection: "row", gap: space.xl }}>
              {detail.fixturesTogetherThisSeason !== null && (
                <Stat value={detail.fixturesTogetherThisSeason} label={detail.fixturesTogetherThisSeason === 1 ? "fixture this season" : "fixtures this season"} />
              )}
              {detail.fixturesTogetherAllTime !== null && detail.fixturesTogetherAllTime !== detail.fixturesTogetherThisSeason && (
                <Stat value={detail.fixturesTogetherAllTime} label={detail.fixturesTogetherAllTime === 1 ? "fixture all time" : "fixtures all time"} />
              )}
            </View>
          )}
          {detail?.firstMetDate && (
            <Text style={[type.caption, { color: colour.inkSubtle }]}>First met {monthYearLabel(detail.firstMetDate)}</Text>
          )}

          {/* Section 4: the compatible-team list itself, from the same canonical `compatible_opponent_teams`
              RPC Find a Fixture uses -- never a bare count, and never shown for a club with no viewer team
              context or no compatible sides. */}
          {detail && detail.compatibleTeams && detail.compatibleTeams.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Compatible Teams</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {detail.compatibleTeams.map((team) => (
                  <View key={team.teamId} style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, justifyContent: "center" }}>
                    <Text style={[type.caption, { color: colour.ink }]}>{team.displayName}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {detail?.website && (
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>About</Text>
              <Pressable accessibilityRole="link" accessibilityLabel="Open club website" onPress={() => void Linking.openURL(detail.website as string)}>
                <Text style={[type.small, { color: colour.pitch600 }]} numberOfLines={1}>
                  {detail.website}
                </Text>
              </Pressable>
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

          {/* SECTION 10 (CLUBHOUSE): start_or_get_club_conversation straight from the club already on
              screen -- never a second search for a club the viewer is already looking at. */}
          {messageDraft !== null && (
            <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <TextInput
                accessibilityLabel="First message"
                value={messageDraft}
                onChangeText={setMessageDraft}
                placeholder="Write your message…"
                placeholderTextColor={colour.inkSubtle}
                multiline
                style={[sheetInput, { minHeight: 88, paddingVertical: space.sm, textAlignVertical: "top" }]}
              />
              <Button
                label="Send"
                busy={sendingMessage}
                disabled={!messageDraft.trim()}
                onPress={async () => {
                  if (!viewerClubId || !marker.clubId) {
                    setFeedback("You don't have fixture authority at a club.")
                    return
                  }
                  setSendingMessage(true)
                  setFeedback(null)
                  const result = await startClubConversation(supabase, viewerClubId, marker.clubId, messageDraft.trim())
                  setSendingMessage(false)
                  if (!result.ok || !result.conversationId) {
                    setFeedback(result.error ?? "That didn't work. Try again.")
                    return
                  }
                  onClose()
                  router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "club", id: result.conversationId } } as never)
                }}
              />
            </View>
          )}

          {/* SECTION 14 (CLUBHOUSE): claiming is how someone GETS authority over a club, so this form
              is offered to any signed-in viewer who reaches this sheet at all -- never gated on
              detail.actions, which all describe authority the viewer would already need to hold. A
              Site Admin reviews every claim by hand; a claimed role is only ever a suggestion. */}
          {claimForm !== null && !claimSubmitted && (
            <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <Field label="Your Role at This Club">
                <ChoiceField
                  label="Your role at this club"
                  value={claimForm.role}
                  onChange={(role) => setClaimForm({ ...claimForm, role })}
                  options={CLAIMABLE_ROLES.map((r) => ({ value: r, label: r }))}
                />
              </Field>
              <Field label={`Why You Can Act for ${marker.name}`}>
                <TextField
                  label="Why can you act for this club"
                  value={claimForm.declaration}
                  onChange={(declaration) => setClaimForm({ ...claimForm, declaration })}
                  placeholder="e.g. I was elected Club Secretary at the AGM and I'm the point of contact for fixtures."
                  multiline
                />
              </Field>
              <Button
                label="Submit Claim"
                busy={claimSubmitting}
                disabled={claimForm.declaration.trim().length < 20}
                onPress={async () => {
                  setClaimSubmitting(true)
                  setFeedback(null)
                  const result = await submitClubClaim(supabase, marker.directoryId, claimForm.role, claimForm.declaration)
                  setClaimSubmitting(false)
                  if (!result.ok) {
                    setFeedback(result.error)
                    return
                  }
                  setClaimSubmitted(true)
                }}
              />
            </View>
          )}

          {claimSubmitted && (
            <View style={{ gap: space.xs, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Claim sent</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                A Site Admin reviews every claim by hand -- this is not an automatic sign-up. Ovalball will contact you once it has been reviewed.
              </Text>
            </View>
          )}

          {detail && (
            <View style={{ gap: space.sm }}>
              {detail.actions.canFindFixture && (
                <Button
                  label="Find a Fixture"
                  onPress={() => {
                    onClose()
                    // Section 6: this club preselected/filtered, per SELECTED CLUB ENTRY -- the
                    // discovery screen shows compatible teams here rather than sending the viewer
                    // straight into the raw composer to search again.
                    router.push({
                      pathname: "/clubhouse/find-fixture",
                      params: { opponentDirectoryId: marker.directoryId, opponentClubId: marker.clubId ?? "" },
                    } as never)
                  }}
                />
              )}
              {detail.actions.canMessage && messageDraft === null && (
                <Button variant="secondary" label="Message This Club" onPress={() => setMessageDraft("")} />
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
              {marker.networkState === "not_on_ovalball" && claimForm === null && !claimSubmitted && (
                <Button variant="secondary" label="Claim This Club" onPress={() => setClaimForm({ role: "Committee Member", declaration: "" })} />
              )}
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

/**
 * DISTANCE, BEHIND A CONTROL -- not exposed permanently across the signature surface (the reference's
 * own instruction: 10/25/50/100 miles is a real, useful filter, but not one that deserves a fixed row
 * over the map at all times). Reuses `DistanceChips` exactly as the old inline row did -- same filter,
 * same values, only relocated into a sheet reached by the slider icon beside the filter chips.
 */
function DistanceFilterSheet({ visible, distance, onChange, onClose }: { visible: boolean; distance: ClubhouseDistanceFilter; onChange: (d: ClubhouseDistanceFilter) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Distance" cancelLabel="Close">
      <DistanceChips distance={distance} onChange={onChange} />
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

/** "Mar 2024" -- a real recorded fixture date, never a guess. */
function monthYearLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
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
