import { Pressable, Text, View } from "react-native"

import { memberFor, type AgendaItem, type FamilyProjection } from "@ovalball/contracts"

import { ChildMark } from "../child-mark"
import { ClubCrest } from "../identity"
import { CalendarDays, MapPin, OvalIcon, Users } from "../icons"
import { HomeAwayBadge } from "../agenda-row"
import { homeAwayLabel, kickoffLabel, opponentLine, shortVenue, spokenAgendaItem, statusTone } from "../../agenda/presentation"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"

/**
 * THE CHALK SHEET — the day's rugby, risen over the month.
 *
 * Large rounded top corners and a grab handle, pulled up over the forest so it
 * reads as a panel drawn out of the calendar rather than as the next section down
 * the page. It is deliberately NOT draggable: the visual language is what the
 * design needs, and a gesture that fights the scroll view underneath it would cost
 * more in jitter than it buys in delight.
 */
export function EventSheet({
  children,
  heading,
  count,
}: {
  children: React.ReactNode
  /** The day, or the range, in words. */
  heading: string
  /** "2 events", where saying so helps. Omitted for a list that names its own days. */
  count?: number
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: surface.chalk,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        paddingTop: space.sm,
        // Lifted over the forest rather than butted against it.
        marginTop: -12,
      }}
    >
      <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colour.line }} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: space.sm,
          gap: space.sm,
        }}
      >
        <Text accessibilityRole="header" numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15, flexShrink: 1 }]}>
          {heading}
        </Text>
        {typeof count === "number" && count > 0 && (
          <Text style={[type.caption, { color: colour.inkSubtle }]}>
            {count === 1 ? "1 event" : `${count} events`}
          </Text>
        )}
      </View>
      {children}
    </View>
  )
}

/**
 * ONE PIECE OF RUGBY, AS A CARD.
 *
 * The reference's shape: the time down the left with the arrival time under it,
 * a round mark for what kind of thing it is, then what it is, whose it is and
 * where -- and a chevron, because the whole card goes somewhere.
 *
 * IT IS INFORMATIONAL AND NAVIGATIONAL, NEVER ADMINISTRATIVE. There is no Edit,
 * no Manage, no Fixture Details: a parent's card is an entrance to the Match
 * Centre or the Training Centre, and those are the only two places it goes.
 *
 * THE CHILD COMES FROM `FamilyProjection`. In a family of one the card says the
 * side; in a family of two it says the child, with their own face -- because
 * "whose is this" outranks every other fact on a family's calendar and must never
 * be inferred from an age grade.
 *
 * CANCELLED SURVIVES GREYSCALE. The title is struck through, the card is dimmed,
 * and the state is written in words. Colour is the last of the three signals.
 */
export function EventCard({
  item,
  today,
  family,
  onPress,
}: {
  item: AgendaItem
  today: string
  family: FamilyProjection
  onPress: () => void
}) {
  const status = statusTone(item.status)
  const struck = status?.struck ?? false
  const training = item.kind === "training"
  const child = memberFor(family, item.playerId)
  const time = kickoffLabel(item.time)
  const home = homeAwayLabel(item.homeAway)

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={spokenAgendaItem(item, today)}
      accessibilityHint="Opens the details"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: TOUCH_TARGET + 22,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        marginHorizontal: space.lg,
        borderRadius: radius.lg,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colour.line,
        opacity: struck ? 0.66 : pressed ? 0.94 : 1,
      })}
    >
      {/* THE TIME, AND THE TIME TO BE THERE. Meet time is the one a parent plans
          the morning around, so it is under the kick-off rather than buried in a
          line of metadata -- and only where the club has actually set one. */}
      <View style={{ width: 54, alignItems: "flex-start" }}>
        <Text style={[type.smallMedium, { color: struck ? colour.inkMuted : colour.ink, fontSize: 15 }]}>
          {time ?? "--:--"}
        </Text>
        {!!item.meetTime && (
          <>
            <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10 }]}>meet</Text>
            <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>{item.meetTime}</Text>
          </>
        )}
      </View>

      <EventMark item={item} />

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        {!!child && <ChildMark member={child} size={18} />}
        <Text
          numberOfLines={2}
          style={[
            type.bodyMedium,
            { color: colour.ink, fontSize: 15, textDecorationLine: struck ? "line-through" : "none" },
          ]}
        >
          {training ? "Training Session" : opponentLine(item)}
        </Text>
        {!!item.us.teamName && (
          <Meta icon={<OvalIcon size={11} color={colour.inkSubtle} />} text={item.us.teamName} />
        )}
        {!!shortVenue(item.venue) && (
          <Meta icon={<MapPin size={11} color={colour.inkSubtle} />} text={shortVenue(item.venue)!} />
        )}
        {/* THE STATE IN WORDS, where it is not simply going ahead. */}
        {!!status && status.tone !== "confirmed" && (
          <Text style={[type.caption, { color: struck ? colour.danger : colour.warning }]}>{status.label}</Text>
        )}
      </View>

      <View style={{ alignItems: "flex-end", gap: space.xs }}>
        {/* HOME OR AWAY AS THE CANONICAL MARK -- forest H, blue A -- because it
            decides whether anybody is travelling, which is one of the first things
            a parent needs. TBD and Neutral are real states and take their own mark
            rather than being quietly drawn as home. */}
        {!training && !!home && <HomeAwayBadge home={home} size={24} />}
        <ChevronRightMark />
      </View>
    </Pressable>
  )
}

/**
 * WHAT KIND OF THING THIS IS, as one restrained round mark.
 *
 * A rugby ball for a match, a squad glyph for a session -- the app's established
 * icons on a soft mint disc. Never an emoji, and never a kit: a kit is what a side
 * wears, not what an event is. The opposition's CREST is used where there is one,
 * because that is a real identity and the strongest signal on a match card.
 */
function EventMark({ item }: { item: AgendaItem }) {
  if (item.kind === "training") {
    return (
      <View
        accessible={false}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colour.mint100,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Users size={19} color={colour.forest800} strokeWidth={1.9} />
      </View>
    )
  }
  if (item.them?.crestUrl) {
    return <ClubCrest clubName={item.them.clubName} url={item.them.crestUrl} size={40} />
  }
  return (
    <View
      accessible={false}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colour.mint100,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <OvalIcon size={19} color={colour.forest800} />
    </View>
  )
}

function Meta({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {icon}
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flexShrink: 1 }]}>
        {text}
      </Text>
    </View>
  )
}

function ChevronRightMark() {
  return (
    <View accessible={false}>
      <Text style={{ color: colour.inkSubtle, fontSize: 18, lineHeight: 20 }}>›</Text>
    </View>
  )
}

/**
 * A DAY WITH NOTHING ON IT IS AN ANSWER, not a blank.
 *
 * The sheet stays, because collapsing it would make the screen jump every time
 * somebody tapped a quiet Wednesday. No error illustration: an empty day is
 * completely ordinary, and drawing it as a failure teaches people to distrust the
 * calendar.
 */
export function CalendarEmptyDay({ body, action }: { body: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.md }}>
      <CalendarDays size={26} color={colour.inkSubtle} />
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>{body}</Text>
      {action}
    </View>
  )
}

/** A day's heading inside the List view, where the sheet names a range rather than a day. */
export function ListDayHeading({ label }: { label: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={[type.smallMedium, { color: colour.ink, fontSize: 14, paddingHorizontal: space.lg, paddingTop: space.md }]}
    >
      {label}
    </Text>
  )
}
