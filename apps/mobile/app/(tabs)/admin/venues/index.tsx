import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { readClubVenues, readVenueCapabilities, venueAddressLine, type ClubVenues, type VenueCapabilities } from "@ovalball/contracts/club/venues"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight } from "../../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

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
  const [caps, setCaps] = useState<VenueCapabilities>({ view: false, manageVenues: false, managePitches: false })
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
    <AdminScreen section="Venues" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Venues
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Where the club plays and trains. A ground is deactivated, never deleted, so every fixture that was played there keeps its place.</Text>
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
          {active.length === 0 && <EmptyState title="No venues yet" body={caps.manageVenues ? "Add the club's home ground to give fixtures and training somewhere to be." : "The club has not recorded a ground yet."} />}
          {active.length > 0 && (
            <Group title="Grounds">
              {active.map((v) => (
                <VenueRow key={v.id} name={v.name} line={venueAddressLine(v) || "No address recorded"} pitches={pitchCount(v.id)} isDefault={v.isDefaultHome} onPress={() => router.push(`/admin/venues/${v.id}` as never)} />
              ))}
            </Group>
          )}
          {inactive.length > 0 && (
            <Group title="Deactivated">
              {inactive.map((v) => (
                <VenueRow key={v.id} name={v.name} line={venueAddressLine(v) || "No address recorded"} pitches={pitchCount(v.id)} isDefault={false} muted onPress={() => router.push(`/admin/venues/${v.id}` as never)} />
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

function VenueRow({ name, line, pitches, isDefault, muted = false, onPress }: { name: string; line: string; pitches: number; isDefault: boolean; muted?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${line}. ${pitches} active ${pitches === 1 ? "pitch" : "pitches"}${isDefault ? ". Home ground" : ""}${muted ? ". Deactivated" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent", opacity: muted ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]}>{name}</Text>
          {isDefault && <StatusPill label="Home Ground" tone="positive" />}
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

