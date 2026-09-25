import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, Image, Linking, Pressable, Share, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
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
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { BottomSheet } from "../../../src/components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { Layers, LayoutGrid, MapPin, Search, Share2, X } from "../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"
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
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")
  // In Expo Go the map can't render at all (see the EXPO GO CANNOT RUN MAPLIBRE comment below) -- List
  // opens by default there so the screen is immediately useful rather than landing on a dead end.
  const [mode, setMode] = useState<"map" | "list">(isExpoGo ? "list" : "map")
  const [selected, setSelected] = useState<ClubMapMarker | null>(null)
  const [chromeExpanded, setChromeExpanded] = useState(false)

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

  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  const filtered = useMemo(() => {
    if (!markers) return []
    const byFilter = applyClubhouseFilter(markers, filter, null)
    const byDistance = applyClubhouseDistanceFilter(byFilter, distance, origin)
    return byDistance.filter((m) => matchesClubhouseQuery(m, query))
  }, [markers, filter, distance, origin, query])

  const withLocation = useMemo(() => filtered.filter((m) => m.hasLocation), [filtered])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      {/* THE MAP IS THE HERO (Section 2/11) -- no page-title header eating vertical space above it.
          Search and filters float as a card over the map/list instead of occupying a fixed chalk
          block. THIS WRAPPER, not the screen root, is what every `position: "absolute"` child below
          is measured against -- it starts right after AppHeader ends, so a `top: space.md` overlay
          floats just under the header instead of covering it (a real bug found live: the overlay used
          to be a sibling of AppHeader at the screen root, so it rendered on top of the header itself,
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
            <ClubhouseMap markers={withLocation} onSelect={setSelected} />
          )}
          {markers !== null && !error && filtered.length > 0 && mode === "list" && (
            <ClubhouseList markers={filtered} onSelect={setSelected} topInset={chromeExpanded ? 172 : 116} />
          )}
        </View>

        <View style={{ position: "absolute", top: space.md, left: space.lg, right: space.lg, gap: space.sm }}>
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, padding: space.sm, gap: space.sm, ...elevation.card }}>
            <SearchField value={query} onChange={setQuery} />
            <FilterChips filter={filter} onChange={setFilter} />
            {origin && (
              <>
                <Pressable accessibilityRole="button" onPress={() => setChromeExpanded((v) => !v)} style={{ alignSelf: "flex-start" }}>
                  <Text style={[type.caption, { color: colour.forest800 }]}>{chromeExpanded ? "Hide distance" : distance === "any" ? "Add distance filter" : `Within ${distance} miles`}</Text>
                </Pressable>
                {chromeExpanded && <DistanceChips distance={distance} onChange={setDistance} />}
              </>
            )}
          </View>
        </View>

        {/* MAP | LIST -- Section 20: the same search/filter query backs both, so switching never loses
            a non-geocoded club (the map alone cannot show one; the list always can). */}
        <View style={{ position: "absolute", bottom: insets.bottom + space.lg, alignSelf: "center", flexDirection: "row", borderRadius: radius.pill, backgroundColor: colour.forest950, padding: 4, gap: 4 }}>
          <ModeButton label="Map" icon={<Layers size={16} color={mode === "map" ? colour.forest950 : colour.onForest} />} active={mode === "map"} onPress={() => setMode("map")} />
          <ModeButton label="List" icon={<LayoutGrid size={16} color={mode === "list" ? colour.forest950 : colour.onForest} />} active={mode === "list"} onPress={() => setMode("list")} />
        </View>
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

const DISTANCES: { key: ClubhouseDistanceFilter; label: string }[] = [
  { key: 10, label: "10 mi" },
  { key: 25, label: "25 mi" },
  { key: 50, label: "50 mi" },
  { key: 100, label: "100 mi" },
  { key: "any", label: "Any" },
]

/**
 * Only ever rendered when `findDistanceOrigin` found a real, factual origin (the viewer's own club's
 * geocoded location) -- see the Clubhouse read model. There is no device-location fallback: Section 56
 * requires personal location permission to stay optional/unnecessary to use Clubhouse at all.
 */
function DistanceChips({ distance, onChange }: { distance: ClubhouseDistanceFilter; onChange: (d: ClubhouseDistanceFilter) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Filter by distance" style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
      {DISTANCES.map((d) => {
        const on = distance === d.key
        return (
          <Pressable
            key={d.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(d.key)}
            style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, justifyContent: "center" }}
          >
            <Text style={[type.caption, { color: on ? colour.forest800 : colour.ink }]}>{d.label}</Text>
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

function ClubhouseMap({ markers, onSelect }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void }) {
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
  return <NativeMap markers={markers} onSelect={onSelect} />
}

function ClubhouseList({ markers, onSelect, topInset }: { markers: ClubMapMarker[]; onSelect: (m: ClubMapMarker) => void; topInset: number }) {
  return (
    <FlatList
      data={markers}
      keyExtractor={(m) => m.directoryId}
      contentContainerStyle={{ padding: space.lg, paddingTop: topInset + space.md, gap: space.sm, paddingBottom: space.xxl * 2 }}
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
