import { Text, View } from "react-native"

import {
  ATTENDANCE_STATE_WORDS,
  availabilityQuestion,
  memberFor,
  type AgendaItem,
  type FamilyProjection,
  type ParentDay,
} from "@ovalball/contracts"

import { AgendaRow } from "./agenda-row"
import { ChildMark } from "./child-mark"
import { Skeleton } from "./ui"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THIS WEEK — a family's rugby, in the order it happens.
 *
 * WHY DAYS AND NOT A FLAT LIST. A parent's week is a sequence of mornings and
 * evenings, and the thing they are working out is which of them they have to be
 * somewhere. A list of eight rows each carrying its own date makes them read the
 * date eight times; a day heading says it once and the rows underneath answer
 * "what time" and "who".
 *
 * TODAY AND TOMORROW ARE NAMED. Those are the two days somebody is deciding
 * about right now, and "Today" is faster to read than a weekday they then have to
 * compare against today's.
 *
 * THE ROWS ARE THE SHARED `AgendaRow`. The same component as Fixtures and
 * Calendar, so a cancelled match is struck through here exactly as it is there,
 * and a redesign reaches all three. This file arranges; it does not re-draw.
 */
export function ThisWeek({
  days,
  today,
  family,
  nextKey,
  onOpen,
}: {
  days: ParentDay[]
  today: string
  /** The projection, so each row's child identity comes from the one authority. */
  family: FamilyProjection
  /**
   * The event already shown as Next Up, if it falls inside the week.
   *
   * It stays in its chronological place -- removing it would leave a gap on the
   * day it happens, and "Saturday" with nothing under it is worse than a repeat.
   * Instead it is marked as the one above, so the eye skips it rather than
   * reading the same match twice and wondering which is which.
   */
  nextKey: string | null
  onOpen: (item: AgendaItem) => void
}) {
  return (
    <View style={{ gap: space.lg }}>
      {days.map((day) => (
        <View key={day.key}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs }}>
            <Text accessibilityRole="header" style={[type.overline, { color: colour.inkMuted }]}>
              {day.label.toUpperCase()}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colour.line }} />
          </View>
          <View
            style={{
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
              overflow: "hidden",
            }}
          >
            {day.items.map((item, index) => (
              <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                <AgendaRow
                  item={item}
                  today={today}
                  child={memberFor(family, item.playerId)}
                  onPress={() => onOpen(item)}
                />
                {item.key === nextKey && (
                  <Text
                    style={[
                      type.caption,
                      { color: colour.inkSubtle, paddingHorizontal: space.md, paddingBottom: space.sm, marginTop: -space.xs },
                    ]}
                  >
                    Shown above
                  </Text>
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * THE CHILD'S OWN ANSWER, on the card that matters most.
 *
 * A guardian looking at Saturday's match wants two things: the details, and
 * whether they have answered. So the state is stated in the card's own words --
 * the canonical register word when there is an answer, and the canonical QUESTION
 * when there is not, which is the same sentence the Match Centre will ask when
 * they tap through.
 *
 * NOT A CONTROL. Answering happens in the Match Centre and the Training Centre,
 * where the server decides who may answer for whom; a second set of buttons on
 * Home would be a second place for that decision to be got wrong.
 */
export function NextUpAnswer({
  item,
  family,
  viewerIsThePlayer,
}: {
  item: AgendaItem
  family: FamilyProjection
  viewerIsThePlayer: boolean
}) {
  // No player on the row means this is not somebody's own rugby -- a staff view of
  // a team's week -- and there is no personal answer to state.
  if (!item.playerId) return null
  const member = memberFor(family, item.playerId)
  const answered = item.attendance !== null
  const label = answered
    ? ATTENDANCE_STATE_WORDS[item.attendance!]
    : availabilityQuestion(item.kind, viewerIsThePlayer, member?.firstName ?? item.childFirstName ?? "")
  const tone = !answered
    ? { ground: colour.warningSurface, ink: colour.warning }
    : item.attendance === "ATTENDING"
      ? { ground: colour.successSurface, ink: colour.forest800 }
      : item.attendance === "CANNOT_ATTEND"
        ? { ground: colour.dangerSurface, ink: colour.danger }
        : { ground: colour.warningSurface, ink: colour.warning }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: tone.ground,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
      }}
    >
      {!!member && <ChildMark member={member} size={20} />}
      <Text style={[type.smallMedium, { color: tone.ink, flex: 1, textAlign: member ? "right" : "left" }]}>{label}</Text>
    </View>
  )
}

/**
 * WHAT HOME LOOKS LIKE WHILE IT IS STILL READING.
 *
 * The SHAPE of the answer, held in place, so nothing shoves the page down when
 * the data lands and nobody reads an empty state that is about to be contradicted.
 * Deliberately not a spinner: a spinner says "wait" and a skeleton says "this is
 * where your next match will be", which is the more useful of the two.
 */
export function HomeSkeleton() {
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <Skeleton height={11} width={72} />
        <View style={{ borderRadius: radius.lg, backgroundColor: colour.forest800, padding: space.lg, gap: space.sm, opacity: 0.16 }}>
          <Skeleton height={13} width={90} />
          <Skeleton height={24} width="72%" />
          <Skeleton height={13} width="52%" />
          <Skeleton height={13} width="38%" />
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <Skeleton height={11} width={64} />
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
          {[0, 1].map((row) => (
            <View
              key={row}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.md,
                borderTopWidth: row === 0 ? 0 : 1,
                borderTopColor: colour.line,
              }}
            >
              <Skeleton height={38} width={38} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton height={13} width="64%" />
                <Skeleton height={11} width="40%" />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}
