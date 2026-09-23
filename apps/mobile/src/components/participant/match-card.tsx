import { Pressable, Text, View } from "react-native"

import {
  projectParticipantMatch,
  projectParticipantTraining,
  sideLabel,
  type AgendaItem,
  type FamilyProjection,
  type MatchCardDensity,
  type MatchSide,
  type ParticipantMatch,
} from "@ovalball/contracts"
import { attendanceStateShape } from "@ovalball/contracts/availability"

import { AVAILABILITY_ICONS } from "../../availability/presentation"
import { ClubCrest, PersonAvatar } from "../identity"
import { ChevronRight, Clock, MapPin, OvalIcon, Users } from "../icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"

/**
 * A PARTICIPANT'S MATCH, AS A CARD.
 *
 * CREST AGAINST CREST IS THE IDENTITY. A fixture is two sides, and the first thing
 * a parent wants from a card is which two -- not a line of metadata beginning with
 * a time. The crests carry it, the names underneath say it in words, and everything
 * practical follows beneath.
 *
 * HOME IS ON THE LEFT, AND IT IS THE CANONICAL HOME. Not "our team first": the
 * projection reads the fixture's own orientation, so when a child is away their
 * side is on the right. A parent reads the left-hand crest as the side at their own
 * ground, and being shown the wrong one is how somebody drives to the wrong place.
 * Where the orientation is genuinely unsettled -- TBD, a festival -- no claim is
 * made at all.
 *
 * ONE MODEL, TWO DENSITIES. `projectParticipantMatch` resolves the truth once;
 * `density` chooses how much room to say it in. Compact is the Calendar's
 * selected-day sheet. Expanded is for the Fixtures pass, and exists here so that
 * screen inherits the same answer rather than working it out again.
 *
 * THE OPPOSITION IS INFORMATION, NOT A RELATIONSHIP. Their crest and their name are
 * drawn and nothing else: neither is independently tappable, there is no profile
 * behind them and no way to contact anybody. The card as a whole goes to the Match
 * Centre, which is the only place it goes.
 */
export function ParticipantMatchCard({
  item,
  family,
  density = "compact",
  onPress,
}: {
  item: AgendaItem
  family: FamilyProjection
  density?: MatchCardDensity
  onPress: () => void
}) {
  const match = projectParticipantMatch(item, family)
  const expanded = density === "expanded"
  const crestSize = expanded ? 64 : 52

  return (
    <CardFrame spoken={match.spoken} cancelled={match.cancelled} onPress={onPress}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Banner
          kind="MATCH"
          icon={<OvalIcon size={12} color={colour.forest800} />}
          trailing={match.classification}
        />

        {/* CREST — VS — CREST. The sides get the room; everything else is beneath. */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <SideColumn side={match.home} size={crestSize} expanded={expanded} />
          <View style={{ paddingTop: crestSize / 2 - 14, alignItems: "center" }}>
            <View
              accessible={false}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: colour.chalk,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10, letterSpacing: 0.4 }]}>VS</Text>
            </View>
          </View>
          <SideColumn side={match.away} size={crestSize} expanded={expanded} />
        </View>

        {/* THE THREE PRACTICAL THINGS. Each appears only where the club has set it:
            "Meet —" is worse than no meet row, and a fabricated venue is worse
            still. They wrap rather than crush on a narrow phone. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          {!!match.kickoff && (
            <Practical icon={<Clock size={13} color={colour.inkMuted} />} text={`KO ${match.kickoff}`} strong />
          )}
          {!!match.meetTime && (
            <Practical icon={<Users size={13} color={colour.inkMuted} />} text={`Meet ${match.meetTime}`} />
          )}
          {!!match.venue && <Practical icon={<MapPin size={13} color={colour.inkMuted} />} text={match.venue} />}
        </View>

        {/* CANCELLED IS SAID, not merely coloured -- and the kick-off above is
            struck through by the frame, so it is not left reading as confirmed. */}
        {!!match.status && match.status !== "Booked" && (
          <Text
            style={[
              type.caption,
              { color: match.cancelled ? colour.danger : colour.warning, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            {match.status}
          </Text>
        )}
      </View>

      <ChildStrip child={match.child} attendance={match.attendance} word={match.attendanceWord} />
    </CardFrame>
  )
}

/**
 * A PARTICIPANT'S TRAINING, AS THE SAME CARD WITHOUT AN OPPOSITION.
 *
 * No crest against crest, because a session has no opponent and must never be
 * given a fake one. The time leads instead -- which is what a parent is actually
 * asking about a Tuesday evening -- and the child strip beneath is identical, so
 * the two cards read as one product.
 */
export function ParticipantTrainingCard({
  item,
  family,
  endTime,
  onPress,
}: {
  item: AgendaItem
  family: FamilyProjection
  /** The session's end, where the canonical record has one. */
  endTime?: string | null
  onPress: () => void
}) {
  const training = projectParticipantTraining(item, family, endTime)

  return (
    <CardFrame spoken={training.spoken} cancelled={training.cancelled} onPress={onPress}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Banner
          kind="TRAINING"
          icon={<Users size={12} color={colour.forest800} strokeWidth={2.2} />}
          trailing={training.teamName}
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <View style={{ minWidth: 76 }}>
            <Text style={[type.title, { color: colour.ink, fontSize: 22 }]}>{training.start ?? "--:--"}</Text>
            {!!training.window && (
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{training.window}</Text>
            )}
          </View>
          <View style={{ width: 1, alignSelf: "stretch", backgroundColor: colour.line }} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 15 }]}>{training.title}</Text>
            {!!training.venue && (
              <Practical icon={<MapPin size={13} color={colour.inkMuted} />} text={training.venue} />
            )}
          </View>
        </View>

        {!!training.cancelled && (
          <Text style={[type.caption, { color: colour.danger, fontFamily: "Inter_600SemiBold" }]}>Cancelled</Text>
        )}
      </View>

      <ChildStrip child={training.child} attendance={training.attendance} word={training.attendanceWord} />
    </CardFrame>
  )
}

/**
 * The white card itself, and the one thing it does: go to its own centre.
 *
 * ONE TAP TARGET FOR THE WHOLE CARD. Nothing inside it is separately pressable --
 * not a crest, not a name, not the availability chip. That is what keeps the
 * opposition informational, and it is what makes the card a card rather than a
 * small screen.
 */
function CardFrame({
  spoken,
  cancelled,
  onPress,
  children,
}: {
  spoken: string
  cancelled: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the details"
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: space.lg,
        borderRadius: radius.lg,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colour.line,
        overflow: "hidden",
        opacity: cancelled ? 0.72 : pressed ? 0.95 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

/** The kind of thing this is, and its canonical classification on the other side. */
function Banner({ kind, icon, trailing }: { kind: string; icon: React.ReactNode; trailing?: string | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingHorizontal: space.sm,
          paddingVertical: 4,
          borderRadius: radius.sm,
          backgroundColor: colour.mint100,
        }}
      >
        {icon}
        <Text style={[type.caption, { color: colour.forest800, fontSize: 10, letterSpacing: 0.8 }]}>{kind}</Text>
      </View>
      {!!trailing && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, flexShrink: 1 }]}>
          {trailing}
        </Text>
      )}
    </View>
  )
}

/**
 * One side: the crest, then who they are.
 *
 * THE CREST COMES FROM THE CANONICAL RESOLVER -- the club's own upload, else the
 * Club Directory's branding logo, else initials on a neutral ground. There is no
 * third source and no `fallback` prop, so a kit cannot be passed where a crest
 * belongs and a missing crest looks deliberate rather than broken.
 */
function SideColumn({ side, size, expanded }: { side: MatchSide | null; size: number; expanded: boolean }) {
  return (
    <View accessible={false} style={{ flex: 1, alignItems: "center", gap: space.xs }}>
      <ClubCrest clubName={side?.clubName ?? null} url={side?.crestUrl ?? null} size={size} />
      <Text
        numberOfLines={2}
        style={[
          type.smallMedium,
          { color: colour.ink, textAlign: "center", fontSize: expanded ? 14 : 13, lineHeight: expanded ? 18 : 16 },
        ]}
      >
        {sideLabel(side)}
      </Text>
      {/* The club under the team, where a team name is what the line above says --
          a club running three Under 12 sides needs both, and only then. */}
      {!!side?.teamName && side.teamName !== side.clubName && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, textAlign: "center" }]}>
          {side.clubName}
        </Text>
      )}
    </View>
  )
}

function Practical({ icon, text, strong = false }: { icon: React.ReactNode; text: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      {icon}
      <Text
        numberOfLines={1}
        style={[
          strong ? type.smallMedium : type.caption,
          { color: strong ? colour.ink : colour.inkMuted, flexShrink: 1 },
        ]}
      >
        {text}
      </Text>
    </View>
  )
}

/**
 * WHOSE MATCH THIS IS, AND WHAT THEY SAID.
 *
 * The strip that matters most in a family of two: the child's own face and name
 * from `FamilyProjection`, and their canonical answer beside it. Absent entirely
 * for a row that belongs to no child -- a staff view of a team's week -- rather
 * than showing an empty strip.
 *
 * THE WORD IS THE CANONICAL REGISTER WORD. "Attending", "Unsure", "Can't attend":
 * the vocabulary the shared contract holds and the same one the register and the
 * website use. The chip carries an ICON and the WORD as well as a tone, so the
 * state never rests on colour.
 */
function ChildStrip({
  child,
  attendance,
  word,
}: {
  child: ParticipantMatch["child"]
  attendance: AgendaItem["attendance"]
  word: string
}) {
  if (!child) return null
  const shape = attendanceStateShape(attendance ?? "AWAITING")
  const Icon = AVAILABILITY_ICONS[shape.icon]
  const paint =
    attendance === "ATTENDING"
      ? { ground: colour.successSurface, ink: colour.forest800 }
      : attendance === "CANNOT_ATTEND"
        ? { ground: colour.dangerSurface, ink: colour.danger }
        : attendance === "UNSURE"
          ? { ground: colour.warningSurface, ink: colour.warning }
          : { ground: colour.chalk, ink: colour.inkMuted }

  return (
    <View
      accessible={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: TOUCH_TARGET,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderTopWidth: 1,
        borderTopColor: colour.line,
        backgroundColor: colour.chalk,
      }}
    >
      <PersonAvatar name={child.fullName} url={child.avatarUrl} initials={child.initials} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 14 }]}>
          {child.shortLabel}
        </Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>
          {child.teamName}
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: space.md,
          paddingVertical: 7,
          borderRadius: radius.pill,
          backgroundColor: paint.ground,
        }}
      >
        <Icon size={14} color={paint.ink} strokeWidth={2.4} />
        <Text numberOfLines={1} style={[type.caption, { color: paint.ink, fontFamily: "Inter_600SemiBold" }]}>
          {word}
        </Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </View>
  )
}
