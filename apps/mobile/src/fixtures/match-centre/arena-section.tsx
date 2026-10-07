import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import { changingRoomLabel } from "@ovalball/contracts/match-centre/facilities"
import type { MatchCentreAttendance } from "@ovalball/contracts/match-centre/attendance"

import { openDirections } from "../../components/match-conditions"
import { ClubCrest } from "../../components/identity"
import { DoorOpen, MapPin, Navigation, Pencil, Users, Utensils } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import type { MatchCentreRoom, MatchCentreView } from "../../match-centre/load"
import { IllustrativeTag } from "../../media/media-picker"
import { hasOwnPicture, pitchPhoto, roomPhoto, venuePhoto, type PhotoSource } from "./facility-images"

/**
 * ARENA DETAILS -- where the match is, the pitch, who changes where, and the catering headcount, in that
 * order: catering sits directly under the changing rooms because it is the same arrival conversation.
 *
 * A HOST ON OVALBALL: every picture is the record's own canonical cover. A HOST THAT IS NOT: the ground,
 * pitch and rooms were written for this match, so their pictures are stock, chosen from the match's own
 * id so they never shuffle, and captioned as illustrative -- never passed off as the real place.
 *
 * CATERING IS DERIVED, NEVER TYPED. The headcount is the server's (`get_match_centre_attendance`): players
 * marked Attending on each Ovalball side. A side that is not on Ovalball is "not available", never zero.
 */
export function ArenaSection({
  view,
  attendance,
  canEdit,
  onEditVenue,
  onEditArrangements,
}: {
  view: MatchCentreView
  attendance: MatchCentreAttendance | null
  canEdit: boolean
  onEditVenue: () => void
  onEditArrangements: () => void
}) {
  // The address lines often end with the postcode already; it is said once.
  const addressLine = dedupe([...view.venue.addressLines, view.venue.postcode]).join(", ")
  const place = dedupe([view.venue.name, ...view.venue.addressLines, view.venue.postcode]).join(", ")
  const provisional = view.facilityMode === "PROVISIONAL"
  // Seeded by the record where there is one, so a ground keeps its illustration across matches; by the
  // match for a ground or pitch written for this match alone.
  const venueSource = venuePhoto(provisional ? null : view.venue, (!provisional && view.venue.id) || view.fixtureId)
  const pitchSource = pitchPhoto(provisional || !view.pitch.id ? null : view.pitch, (!provisional && view.pitch.id) || view.fixtureId)
  const editable = canEdit && !view.cancelled

  const homeRoomName = changingRoomLabel(view.homeRoom, view.homeRoomNumber)
  const awayRoomName = changingRoomLabel(view.awayRoom, view.awayRoomNumber)
  const gallery: { key: string; source: PhotoSource; label: string }[] = provisional
    ? []
    : [
        // The gallery is the ground's own pictures only -- never a strip of illustrations.
        view.pitch.id && view.pitch.name && hasOwnPicture(view.pitch) ? { key: "pitch", source: pitchSource, label: view.pitch.name } : null,
        view.homeRoom && hasOwnPicture(view.homeRoom) ? { key: "home", source: roomPhoto(view.homeRoom, view.homeRoom.id), label: view.homeRoom.name } : null,
        view.awayRoom && view.awayRoom.id !== view.homeRoom?.id && hasOwnPicture(view.awayRoom) ? { key: "away", source: roomPhoto(view.awayRoom, view.awayRoom.id), label: view.awayRoom.name } : null,
      ].filter((g): g is { key: string; source: PhotoSource; label: string } => g !== null)

  return (
    <View style={{ gap: space.lg }}>
      {/* THE VENUE */}
      <Card>
        <Header
          icon={<MapPin size={20} color={colour.forest800} />}
          overline="Venue"
          title={view.venue.name ?? (view.facilityMode === "UNDECIDED" ? "Agree home or away first" : "Venue to be confirmed")}
          subtitle={view.venue.addressLines.length > 0 ? addressLine : null}
          onEdit={editable ? onEditVenue : undefined}
          editLabel="Change the venue"
        />
        {!!view.venue.name && <Photo source={venueSource} label={view.venue.name} illustrative={provisional || !hasOwnPicture(view.venue)} />}
        {gallery.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
            {gallery.map((g) => (
              <Image key={g.key} source={g.source} style={{ width: 96, height: 60, borderRadius: radius.sm }} contentFit="cover" accessibilityLabel={`Photo of ${g.label}`} />
            ))}
          </ScrollView>
        )}
        {!!view.venue.directions && (
          <View style={{ paddingHorizontal: space.lg, gap: 2 }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>ARRIVAL</Text>
            <Text style={[type.small, { color: colour.ink }]}>{view.venue.directions}</Text>
          </View>
        )}
        {!!place && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to ${view.venue.name ?? "the ground"}`}
            onPress={() => void openDirections(place)}
            style={({ pressed }) => ({ marginHorizontal: space.lg, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.forest800, opacity: pressed ? 0.7 : 1 })}
          >
            <Navigation size={17} color={colour.forest800} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Directions</Text>
          </Pressable>
        )}
        {!view.venue.name && <Body muted>The ground hasn't been confirmed yet.</Body>}
        <View style={{ height: space.sm }} />
      </Card>

      {/* THE PITCH */}
      <Card>
        <Header
          icon={<MapPin size={20} color={colour.forest800} />}
          overline="Pitch"
          title={view.pitch.name ?? "Not set"}
          subtitle={view.pitch.description}
          onEdit={editable ? onEditVenue : undefined}
          editLabel="Change the pitch"
        />
        {!!view.pitch.name && <Photo source={pitchSource} label={view.pitch.name} illustrative={provisional || !view.pitch.id || !hasOwnPicture(view.pitch)} />}
        {!view.pitch.name && <Body muted>The pitch will be shown here once it is set.</Body>}
        <View style={{ height: space.sm }} />
      </Card>

      {/* CHANGING ROOMS */}
      <Card>
        <Header icon={<DoorOpen size={20} color={colour.forest800} />} overline={null} title="Changing Rooms" onEdit={editable ? onEditArrangements : undefined} editLabel="Edit changing rooms" />
        {view.noChangingRooms ? (
          <Body>No changing rooms are available at the ground for this match. Arrive changed.</Body>
        ) : (
          <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg }}>
            <RoomColumn label="Home Changing Room" club={view.home.clubName} name={homeRoomName} room={view.homeRoom} seed={`${view.fixtureId}:home`} />
            <RoomColumn label="Away Changing Room" club={view.away.clubName} name={awayRoomName} room={view.awayRoom} seed={`${view.fixtureId}:away`} />
          </View>
        )}
        {!view.noChangingRooms && view.officialsRoom && (
          <Body>{`Officials Room: ${view.officialsRoom.name}`}</Body>
        )}
        {!!view.changingRoomNotes && <Body>{view.changingRoomNotes}</Body>}
                <View style={{ height: space.sm }} />
      </Card>

      {/* CATERING, directly under the changing rooms */}
      <CateringCard view={view} attendance={attendance} onEdit={editable ? onEditArrangements : undefined} />
    </View>
  )
}

function CateringCard({ view, attendance, onEdit }: { view: MatchCentreView; attendance: MatchCentreAttendance | null; onEdit?: () => void }) {
  const catering = attendance?.catering
  const required = catering?.required ?? view.cateringRequired
  const staffFigures = catering?.total !== undefined
  // A family is told whether food is provided; the numbers are an operational figure for staff.
  if (!required && !staffFigures && !onEdit) return null

  const sideCount = (side: "home" | "away") => catering?.parts?.find((p) => p.side === side)?.attending ?? null
  const notCounted = (side: "home" | "away") => (catering?.sidesNotCounted ?? []).includes(side)

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Utensils size={20} color={colour.forest800} />
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Catering Required</Text>
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: required ? colour.mint100 : colour.chalk }}>
          <Text style={[type.smallMedium, { color: required ? colour.forest800 : colour.inkMuted }]}>{required ? "Yes" : "No"}</Text>
        </View>
        {onEdit && <EditButton label="Edit catering" onPress={onEdit} />}
      </View>

      {staffFigures && required && (
        <>
          <View style={{ flexDirection: "row", paddingHorizontal: space.lg, gap: space.md }}>
            {(["home", "away"] as const).map((side) => {
              const s = side === "home" ? view.home : view.away
              const count = sideCount(side)
              return (
                <View key={side} style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <ClubCrest clubName={s.clubName} url={s.crestUrl} size={22} />
                    <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>{s.clubName}</Text>
                  </View>
                  {count !== null && !notCounted(side) ? (
                    <View accessible accessibilityLabel={`${count} ${count === 1 ? "player" : "players"} attending`}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                        <Users size={16} color={colour.ink} />
                        <Text style={[type.title, { color: colour.ink }]}>{count}</Text>
                      </View>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{count === 1 ? "player attending" : "players attending"}</Text>
                    </View>
                  ) : (
                    <Text style={[type.small, { color: colour.inkMuted }]}>Attendance not available through Ovalball</Text>
                  )}
                </View>
              )
            })}
          </View>
          <View style={{ marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", gap: 2 }}>
            <Text style={[type.bodyMedium, { color: colour.forest800 }]}>
              Total for catering: {catering?.total ?? 0}
              {(catering?.sidesNotCounted ?? []).length > 0 ? "+" : ""}
            </Text>
            <Text style={[type.caption, { color: colour.forest800, textAlign: "center" }]}>
              {(catering?.sidesNotCounted ?? []).length > 0
                ? "Based on players marked as Attending. Players from a side not on Ovalball are not included."
                : "Based on players marked as Attending."}
            </Text>
          </View>
        </>
      )}
      {!required && <Body muted>No catering has been arranged for this match.</Body>}
      {required && !staffFigures && <Body>Food is being provided after the match.</Body>}
      <View style={{ height: space.sm }} />
    </Card>
  )
}

function RoomColumn({ label, club, name, room, seed }: { label: string; club: string; name: string | null; room: MatchCentreRoom | null; seed: string }) {
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: name ? colour.ink : colour.inkSubtle }]}>{name ?? "Not set"}</Text>
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>{club}</Text>
      {!!name && (
        <View>
          <Image source={roomPhoto(room, room?.id ?? seed)} style={{ height: 72, borderRadius: radius.sm }} contentFit="cover" accessibilityLabel={hasOwnPicture(room) ? `Photo of ${name}` : `Illustrative picture for ${name}`} />
          {!hasOwnPicture(room) && <IllustrativeTag />}
        </View>
      )}
    </View>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden", gap: space.sm }}>{children}</View>
}

function Body({ children, muted, caption }: { children: React.ReactNode; muted?: boolean; caption?: boolean }) {
  return <Text style={[caption ? type.caption : type.small, { color: muted ? colour.inkMuted : colour.ink, paddingHorizontal: space.lg }]}>{children}</Text>
}

function EditButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, opacity: pressed ? 0.6 : 1 })}
    >
      <Pencil size={14} color={colour.forest800} />
      <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
    </Pressable>
  )
}

function Header({ icon, overline, title, subtitle, onEdit, editLabel }: { icon: React.ReactNode; overline: string | null; title: string; subtitle?: string | null; onEdit?: () => void; editLabel: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1 }}>
        {!!overline && <Text style={[type.smallMedium, { color: colour.ink }]}>{overline}</Text>}
        <Text accessibilityRole="header" style={[overline ? type.small : type.heading, { color: colour.ink }]}>{title}</Text>
        {!!subtitle && <Text style={[type.caption, { color: colour.inkMuted }]}>{subtitle}</Text>}
      </View>
      {onEdit && <EditButton label={editLabel} onPress={onEdit} />}
    </View>
  )
}

function Photo({ source, label, illustrative }: { source: PhotoSource; label: string; illustrative?: boolean }) {
  return (
    <View style={{ marginHorizontal: space.lg }}>
      <Image source={source} style={{ height: 150, borderRadius: radius.md }} contentFit="cover" accessibilityLabel={illustrative ? `Illustrative picture for ${label}` : `Photo of ${label}`} />
      {illustrative && <IllustrativeTag />}
    </View>
  )
}


function dedupe(parts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  return parts.filter((p): p is string => {
    const key = (p ?? "").trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
