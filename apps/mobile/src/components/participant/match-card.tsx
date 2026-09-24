import { Pressable, Text, View } from "react-native"

import type { FamilyMember } from "@ovalball/contracts"
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
import { ATTENDANCE_STATE_WORDS, attendanceStateShape } from "@ovalball/contracts/availability"

import { AVAILABILITY_ICONS } from "../../availability/presentation"
import { ClubCrest, PersonAvatar } from "../identity"
import { ChevronRight, Clock, MapPin, OvalIcon, Users } from "../icons"
import { TOUCH_TARGET, colour, eventTone, radius, space, surface, type } from "../../design/tokens"

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
  siblings,
}: {
  item: AgendaItem
  family: FamilyProjection
  density?: MatchCardDensity
  onPress: () => void
  /** Every child in this event, where a family reads it as one event (CA-M9): one strip per child. */
  siblings?: { member: FamilyMember; attendance: AgendaItem["attendance"] }[]
}) {
  const match = projectParticipantMatch(item, family)
  const expanded = density === "expanded"
  const crestSize = expanded ? 64 : 52

  return (
    <CardFrame spoken={match.spoken} cancelled={match.cancelled} accent={eventTone.match.accent} onPress={onPress}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Banner
          kind="MATCH"
          tone={eventTone.match}
          icon={<OvalIcon size={12} color={eventTone.match.text} />}
          trailing={match.matchType}
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

      {siblings && siblings.length > 1
        ? siblings.map((s) => <ChildStrip key={s.member.playerId} child={s.member} attendance={s.attendance} word={attendanceWordFor(s.attendance)} />)
        : <ChildStrip child={match.child} attendance={match.attendance} word={match.attendanceWord} />}
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
  siblings,
}: {
  item: AgendaItem
  family: FamilyProjection
  /** The session's end, where the canonical record has one. */
  endTime?: string | null
  onPress: () => void
  /** Every child in this event, where a family reads it as one event (CA-M9): one strip per child. */
  siblings?: { member: FamilyMember; attendance: AgendaItem["attendance"] }[]
}) {
  const training = projectParticipantTraining(item, family, endTime)

  return (
    <CardFrame spoken={training.spoken} cancelled={training.cancelled} accent={eventTone.training.accent} onPress={onPress}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Banner
          kind="TRAINING"
          tone={eventTone.training}
          icon={<Users size={12} color={eventTone.training.text} strokeWidth={2.2} />}
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

      {siblings && siblings.length > 1
        ? siblings.map((s) => <ChildStrip key={s.member.playerId} child={s.member} attendance={s.attendance} word={attendanceWordFor(s.attendance)} />)
        : <ChildStrip child={training.child} attendance={training.attendance} word={training.attendanceWord} />}
    </CardFrame>
  )
}

function attendanceWordFor(attendance: AgendaItem["attendance"]): string {
  return attendance ? ATTENDANCE_STATE_WORDS[attendance] : "Still to answer"
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
  accent,
  onPress,
  children,
}: {
  spoken: string
  cancelled: boolean
  /** The event-type accent down the left edge. Narrow on purpose: a marker, not a block. */
  accent: string
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
        flexDirection: "row",
        marginHorizontal: space.lg,
        borderRadius: radius.lg,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colour.line,
        overflow: "hidden",
        opacity: cancelled ? 0.72 : pressed ? 0.95 : 1,
      })}
    >
      {/* FOUR POINTS OF COLOUR, and that is the whole job. Enough that three cards
          on one day separate instantly; not so much that the card becomes a
          coloured block and stops belonging to the same design system. */}
      <View accessible={false} style={{ width: 4, alignSelf: "stretch", backgroundColor: accent }} />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </Pressable>
  )
}

/** The kind of thing this is, and its canonical classification on the other side. */
/**
 * WHAT KIND OF EVENT, IN WORDS, and the canonical classification opposite it.
 *
 * The word is the point. The accent down the card's edge and the tint behind this
 * label are both supplementary: somebody who cannot tell the two apart by colour
 * reads "MATCH" or "TRAINING" and loses nothing at all.
 */
function Banner({
  kind,
  tone,
  icon,
  trailing,
}: {
  kind: string
  tone: { surface: string; text: string }
  icon: React.ReactNode
  trailing?: string | null
}) {
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
          backgroundColor: tone.surface,
        }}
      >
        {icon}
        <Text style={[type.caption, { color: tone.text, fontSize: 10, letterSpacing: 0.8 }]}>{kind}</Text>
      </View>
      {!!trailing && (
        <View
          style={{
            paddingHorizontal: space.sm,
            paddingVertical: 4,
            borderRadius: radius.sm,
            backgroundColor: colour.chalk,
            flexShrink: 1,
          }}
        >
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {trailing}
          </Text>
        </View>
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
/**
 * ONE SIDE: THE CLUB, THEN THE SIDE.
 *
 * THE CLUB LEADS. "Under 12 Boys versus Under 12 Boys" is what two age-grade sides
 * are both called, and as the dominant line it identifies neither of them -- a
 * parent reads the crest and then wants the club's name under it. The team goes
 * beneath, quieter, where it answers "which of their sides" rather than "who".
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
        {side?.clubName ?? "To be confirmed"}
      </Text>
      {!!side?.teamName && side.teamName !== side.clubName && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, textAlign: "center" }]}>
          {side.teamName}
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
