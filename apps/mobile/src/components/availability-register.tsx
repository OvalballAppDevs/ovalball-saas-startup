import { memo, useState } from "react"
import { Pressable, Text, View } from "react-native"

import {
  countsFromResponses,
  groupKeyForStatus,
  summariseAvailability,
  type AttendanceGroupKey,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"

import { AVAILABILITY_GROUPS } from "../availability/presentation"
import { ChevronRight } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHO'S IN / WHO'S TRAINING -- the squad, grouped by what each person said.
 *
 * THE SAME SECTION THE WEB SHOWS, in the same order, with the same words and the
 * same meaning. Counts first, because "how many can I plan for" is the question
 * a coach has before any name matters; then each group answers "who". A flat
 * alphabetical list of everybody was the web's first attempt and the design
 * review was blunt about the cost: a coach arriving at "Awaiting 9" had to read
 * all 22 rows to find WHICH nine.
 *
 * THE PRIVACY RULE IS NOT IN THIS FILE. The rows arrive already filtered by the
 * canonical readers, which refuse outright without `team.attendance.view` or
 * training-management authority. A viewer without it is handed no rows and this
 * section is not rendered at all -- not a locked panel, not a "not available in
 * your view" placeholder. A parent is not missing a feature; they are simply not
 * staff, and saying so on every fixture is noise.
 *
 * INITIALS, NEVER PHOTOS. A player's photo lives in a private bucket and a
 * register is not a gallery of other people's children. The web's registers use
 * the same initials disc, for the same reason.
 *
 * AWAITING OPENS BY DEFAULT, exactly as the web's `<details open>` does: it is
 * the only group with something to do about it, and the settled answers stay
 * folded until asked for. That is also what keeps this cheap -- the mounted chip
 * count is bounded by the largest OPEN group rather than by the squad.
 *
 * WHY NOT A FlatList. This section sits inside the page's own ScrollView, and a
 * virtualised list nested in a scroll view of the same axis loses its windowing
 * and warns about it -- the recommendation would be honoured in name and broken
 * in fact. Each chip is instead `memo`ised on the values it draws, so one
 * person's answer changing re-renders that person, not the register.
 */

export interface RegisterEntry {
  playerId: string
  firstName: string
  surname: string
  status: AvailabilityStatus | null
}

export function AvailabilityRegister({
  title,
  entries,
  emptyBody,
}: {
  /** "Who's In" for a matchday, "Who's Training" for a session -- the web's own two headings. */
  title: string
  entries: RegisterEntry[]
  /** What to say when the team has nobody on it yet. A real product state, not an error. */
  emptyBody: string
}) {
  const summary = summariseAvailability(countsFromResponses(entries.map((e) => e.status)))

  const byGroup: Record<AttendanceGroupKey, RegisterEntry[]> = { ATTENDING: [], UNSURE: [], CANNOT_ATTEND: [], AWAITING: [] }
  for (const e of entries) byGroup[groupKeyForStatus(e.status)].push(e)

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          backgroundColor: colour.chalk,
        }}
      >
        <Text accessibilityRole="header" style={[type.overline, { color: colour.inkMuted }]}>
          {title.toUpperCase()}
        </Text>
        {summary && <Text style={[type.caption, { color: colour.inkMuted }]}>{summary.progress}</Text>}
      </View>

      {entries.length === 0 ? (
        <Text style={[type.small, { color: colour.inkMuted, padding: space.xl, textAlign: "center" }]}>{emptyBody}</Text>
      ) : (
        <>
          {/* THE COUNTS. Each figure is the count of the group below it, so
              nobody has to reconcile two renderings of the same number. */}
          <View style={{ flexDirection: "row", gap: space.sm, padding: space.md }}>
            {AVAILABILITY_GROUPS.map((g) => (
              <View
                key={g.key}
                accessible
                accessibilityLabel={`${byGroup[g.key].length} ${g.label}`}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: space.xs,
                  paddingVertical: space.md,
                  paddingHorizontal: space.xs,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: g.edge,
                  backgroundColor: g.wash,
                }}
              >
                <g.Icon size={14} color={g.text} strokeWidth={2.5} />
                <Text style={[type.displaySmall, { color: g.text, fontSize: 22, lineHeight: 24 }]}>{byGroup[g.key].length}</Text>
                <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10, textAlign: "center" }]}>{g.label}</Text>
              </View>
            ))}
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: colour.line }}>
            {AVAILABILITY_GROUPS.map((g) => (
              <Group key={g.key} group={g} people={byGroup[g.key]} openByDefault={g.key === "AWAITING"} />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

function Group({
  group,
  people,
  openByDefault,
}: {
  group: (typeof AVAILABILITY_GROUPS)[number]
  people: RegisterEntry[]
  openByDefault: boolean
}) {
  const [open, setOpen] = useState(openByDefault)
  if (people.length === 0) return null

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colour.line }}>
      {/* THE WHOLE ROW IS THE CONTROL. A coach opening this one-handed should
          not have to find a chevron. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${group.label}, ${people.length}`}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          backgroundColor: pressed ? colour.chalk : colour.surface,
        })}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: group.edge,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <group.Icon size={13} color={group.text} strokeWidth={2.5} />
        </View>
        <Text style={[type.smallMedium, { color: group.text, fontFamily: "Inter_600SemiBold" }]}>{group.label}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{people.length}</Text>
        <View style={{ marginLeft: "auto", transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </View>
      </Pressable>

      {open && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          {people.map((p) => (
            <PersonChip key={p.playerId} firstName={p.firstName} surname={p.surname} edge={group.edge} wash={group.wash} text={group.text} />
          ))}
        </View>
      )}
    </View>
  )
}

/**
 * One person in the register.
 *
 * `memo`'d on exactly the values it draws, so a response arriving for one player
 * re-renders that player rather than the whole squad.
 */
const PersonChip = memo(function PersonChip({
  firstName,
  surname,
  edge,
  wash,
  text,
}: {
  firstName: string
  surname: string
  edge: string
  wash: string
  text: string
}) {
  const initials = `${firstName[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() || "?"
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.xs,
        paddingRight: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: edge,
        backgroundColor: wash,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: edge,
          backgroundColor: colour.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={[type.caption, { color: text, fontSize: 10, fontFamily: "Inter_600SemiBold" }]}>{initials}</Text>
      </View>
      {/* Wraps rather than truncating: a long surname on a register is somebody's actual name. */}
      <Text style={[type.small, { color: colour.ink, flexShrink: 1 }]}>
        {firstName} {surname}
      </Text>
    </View>
  )
})
