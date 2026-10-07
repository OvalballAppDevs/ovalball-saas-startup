import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Image } from "expo-image"
import { readClubVenues, readVenueCapabilities, venueAddressLine, type ClubVenue, type ClubVenues, type VenueCapabilities } from "@ovalball/contracts/club/venues"
import { resolveVenueCover } from "@ovalball/contracts/venue-cover"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, ExternalLink } from "../../../../src/components/icons"
import * as Linking from "expo-linking"
import { webUrl } from "../../../../src/config/environment"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"
import { coverPhotoSource, libraryAsset } from "../../../../src/media/stock-assets"
import { IllustrativeTag } from "../../../../src/media/media-picker"

const VENUE_HERO = libraryAsset("venue-dusk-01")

/**
 * VENUES -- the club's grounds, natively (CA-M2). The website's Lookup Administration, as a list:
 * the home ground first, each ground with its address line and how many pitches it has, deactivated
 * grounds in their own group. Reads are the tables under RLS; every action is on the venue's own
 * screen and asks the server. Add Venue appears only when the server says venue.venue.manage.
 */
export default function VenuesScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const [data, setData] = useState<ClubVenues | null>(null)
  const [caps, setCaps] = useState<VenueCapabilities>({ view: false, manageVenues: false, managePitches: false, allocate: false, viewAllocation: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setData(null)
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [next, allowed] = await Promise.all([readClubVenues(supabase, clubId), readVenueCapabilities(supabase, clubId)])
      setData(next)
      setCaps(allowed)
    } catch (cause) {
      const translated = friendly(cause, "the club's venues")
      logDetail("admin:venues", translated)
      setError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    setData(null)
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const active = data?.venues.filter((v) => v.active) ?? []
  const inactive = data?.venues.filter((v) => !v.active) ?? []
  const pitchCount = (venueId: string) => (data?.pitches ?? []).filter((p) => p.venueId === venueId && p.active).length

  return (
    <AdminScreen section="Venues & Pitches" onRefresh={() => void load()} refreshing={false}>
      {/*
        THE APPROVED MOCK-UP'S PHOTOGRAPHIC HERO, as content rather than as this screen's own top
        chrome: `AdminScreen`'s dark header bar (back button, club crest, section name) is shared by
        every Admin Centre section, and swapping it for a photo here alone would read as a different
        product on this one screen rather than matching the mock-up's intent within it. This banner is
        the deliberate reconciliation -- reuses `venue-dusk-01` (Venues stock library) rather than
        generating a dedicated Home hero.
      */}
      <View style={{ height: 160, borderRadius: radius.lg, overflow: "hidden" }}>
        <Image source={VENUE_HERO} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(7,28,20,0.5)" }} />
        <View style={{ flex: 1, justifyContent: "flex-end", padding: space.lg }}>
          <Text accessibilityRole="header" style={[type.title, { color: colour.chalk }]}>
            Venues & Pitches
          </Text>
          <Text style={[type.small, { color: "rgba(248,250,247,0.85)" }]}>Manage all your club venues and pitches.</Text>
        </View>
      </View>

      {loading && !data && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {data && (
        <>
          {caps.manageVenues && <Button label="Add Venue" variant="secondary" onPress={() => router.push("/admin/venues/new")} />}
          {/* PITCH ALLOCATION IS ITS OWN AUTHORITY (CA-M4, CA-M10), A NATIVE BOARD (CA-M11.1) AND NOW ARENA PLANNING:
              offered behind venue.pitch_allocation.view / .manage alone -- never fixture edit. */}
          {(caps.allocate || caps.viewAllocation) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Arena Planning. Which side is on which pitch and in which room, day by day"
              onPress={() => router.push("/admin/arena/planning" as never)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.92 : 1 })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Arena Planning</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Which side is on which pitch and in which room, day by day</Text>
              </View>
              <ChevronRight size={15} color={colour.inkSubtle} />
            </Pressable>
          )}
          {active.length === 0 && <EmptyState title="No venues yet" body={caps.manageVenues ? "Add the club's home ground to give fixtures and training somewhere to be." : "The club has not recorded a ground yet."} />}
          {active.length > 0 && (
            <Group title="Grounds">
              {active.map((v) => (
                <VenueRow key={v.id} venue={v} pitches={pitchCount(v.id)} onPress={() => router.push(`/admin/venues/${v.id}` as never)} />
              ))}
            </Group>
          )}
          {inactive.length > 0 && (
            <Group title="Deactivated">
              {inactive.map((v) => (
                <VenueRow key={v.id} venue={v} pitches={pitchCount(v.id)} muted onPress={() => router.push(`/admin/venues/${v.id}` as never)} />
              ))}
            </Group>
          )}
        </>
      )}
    </AdminScreen>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>{children}</View>
    </View>
  )
}

function VenueRow({ venue, pitches, muted = false, onPress }: { venue: ClubVenue; pitches: number; muted?: boolean; onPress: () => void }) {
  const cover = resolveVenueCover({ supabase, coverImagePath: venue.coverImagePath, coverStockKey: venue.coverStockKey })
  const photo = coverPhotoSource("VENUE", cover, venue.id)
  const line = venueAddressLine(venue) || "No address recorded"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}. ${line}. ${pitches} active ${pitches === 1 ? "pitch" : "pitches"}${venue.isDefaultHome ? ". Primary" : ""}${muted ? ". Deactivated" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent", opacity: muted ? 0.7 : 1 })}
    >
      {/* A library stand-in says so, as on every surface that shows a ground (Arena, Venue Detail, Match Centre). */}
      <View style={{ width: 56, height: 56, borderRadius: radius.md, overflow: "hidden" }}>
        <Image source={photo} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
        {!venue.coverImagePath && <IllustrativeTag size="small" />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]}>{venue.name}</Text>
          {venue.isDefaultHome && <StatusPill label="Primary" tone="positive" />}
        </View>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
          {line}
        </Text>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{pitches} active {pitches === 1 ? "pitch" : "pitches"}</Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

