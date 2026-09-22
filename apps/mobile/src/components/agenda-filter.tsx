import { useEffect, useRef, useState } from "react"
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { AgendaItem } from "@ovalball/contracts"
import { clubOptions, oppositionOptions, teamOptions } from "@ovalball/contracts"

import { NO_FILTER, countActive, isFiltered, type AgendaFilter } from "../agenda/filter"
import { Check, ChevronDown, Users, X } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE FILTER, AS A SHEET.
 *
 * EVERYTHING IT OFFERS COMES FROM THE AUTHORISED ROWS. The options are `teamOptions`,
 * `oppositionOptions` and `clubOptions`, which read the items the server returned rather than a
 * catalogue -- so there is no entry here for a team, a club or an opposition this person cannot
 * already see. The narrowing itself lives in `src/agenda/filter.ts`, where it can be tested without a
 * renderer.
 *
 * AN EMPTY GROUP IS SIMPLY NOT SHOWN. A club running one team needs no team filter, and a season
 * with one opponent so far needs no opposition filter -- a control offering a single choice is a
 * control that cannot do anything.
 *
 * IT IS A SHEET, NOT A BAR. Filters are used occasionally and read constantly; a permanent row of
 * chips takes space from the fixtures every time so that it can be useful now and then. The sheet
 * comes up, does its job, and goes.
 */

export { NO_FILTER, countActive, isFiltered, applyFilter, type AgendaFilter } from "../agenda/filter"

export function AgendaFilterSheet({
  visible,
  items,
  filter,
  showTraining,
  onChange,
  onClose,
}: {
  visible: boolean
  /** The UNFILTERED rows, so the options never shrink to whatever the last choice left. */
  items: AgendaItem[]
  filter: AgendaFilter
  /** False on Fixtures, which never shows training, so the toggle would be a control over nothing. */
  showTraining: boolean
  onChange: (next: AgendaFilter) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  // Which list is expanded, if any. One at a time, so the sheet never becomes two long lists at once.
  const [picker, setPicker] = useState<null | "opposition" | "club">(null)
  const translate = useRef(new Animated.Value(600)).current
  const backdrop = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    setPicker(null)
    translate.setValue(600)
    Animated.parallel([
      Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [visible, translate, backdrop])

  const teams = teamOptions(items)
  const oppositions = oppositionOptions(items)
  const clubs = clubOptions(items)
  const hasFixtures = items.some((item) => item.kind === "fixture")

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>

      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "82%",
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl + 6,
          borderTopRightRadius: radius.xl + 6,
          paddingBottom: insets.bottom + space.md,
          transform: [{ translateY: translate }],
          ...elevation.sheet,
        }}
      >
        <View style={{ paddingTop: space.sm, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: space.sm,
          }}
        >
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
            Filter
          </Text>
          {isFiltered(filter) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
              onPress={() => onChange(NO_FILTER)}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Clear</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "flex-end", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <X size={22} color={colour.ink} strokeWidth={2.2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg }}>
          {/* OUR OWN SIDES. Absent for somebody who only has one, because a filter between one thing
              and itself is not a filter. */}
          {teams.length > 1 && (
            <Group title="Our Team">
              <Chips
                options={[{ id: null, name: "All teams" }, ...teams.map((t) => ({ id: t.id as string | null, name: t.name }))]}
                value={filter.teamId}
                onPick={(teamId) => onChange({ ...filter, teamId })}
              />
            </Group>
          )}

          {/* A LIST, NOT CHIPS. A club with a season's fixtures plays a dozen opponents, and a dozen
              club names as wrapping pills is a wall -- every one a different width, three to a row, and
              the one you want wherever it happens to land. A row that opens an alphabetical list is
              scannable however many there are. Teams and home/away stay as chips because they are few
              and short, and comparing them at a glance is the point. */}
          {oppositions.length > 1 && (
            <Group title="Opposition">
              <Select
                label="Opposition"
                placeholder="Any opposition"
                options={oppositions}
                value={filter.oppositionId}
                open={picker === "opposition"}
                onOpen={() => setPicker(picker === "opposition" ? null : "opposition")}
                onPick={(oppositionId) => {
                  onChange({ ...filter, oppositionId })
                  setPicker(null)
                }}
              />
            </Group>
          )}

          {/* SITE ADMIN ONLY IN PRACTICE -- a club scope returns one club, so this never appears for it. */}
          {clubs.length > 1 && (
            <Group title="Club">
              <Select
                label="Club"
                placeholder="All clubs"
                options={clubs}
                value={filter.clubId}
                open={picker === "club"}
                onOpen={() => setPicker(picker === "club" ? null : "club")}
                onPick={(clubId) => {
                  onChange({ ...filter, clubId })
                  setPicker(null)
                }}
              />
            </Group>
          )}

          {hasFixtures && (
            <Group title="Home or Away">
              <Chips
                options={[
                  { id: "all", name: "Both" },
                  { id: "Home", name: "Home" },
                  { id: "Away", name: "Away" },
                ]}
                value={filter.homeAway}
                onPick={(homeAway) => onChange({ ...filter, homeAway: (homeAway ?? "all") as AgendaFilter["homeAway"] })}
              />
            </Group>
          )}

          {showTraining && (
            <Group title="Show">
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: filter.includeTraining }}
                accessibilityLabel="Show training as well as matches"
                onPress={() => onChange({ ...filter, includeTraining: !filter.includeTraining })}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: filter.includeTraining ? colour.forest800 : colour.lineStrong,
                  backgroundColor: filter.includeTraining ? colour.mint100 : colour.surface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Users size={18} color={colour.forest800} strokeWidth={1.9} />
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>Training</Text>
                {filter.includeTraining && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
              </Pressable>
              {/* MATCHES ARE THE FLOOR. There is deliberately no way to hide them: a fixture list with
                  the fixtures switched off is not a state anybody wants to reach by accident. */}
              <Text style={[type.caption, { color: colour.inkMuted }]}>Matches are always shown.</Text>
            </Group>
          )}

          {teams.length <= 1 && oppositions.length <= 1 && clubs.length <= 1 && !hasFixtures && (
            <Text style={[type.small, { color: colour.inkMuted }]}>
              There is nothing to narrow down yet. Filters appear once there is more than one team or
              opponent in view.
            </Text>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

/**
 * ONE CHOICE OUT OF MANY.
 *
 * A row showing the current value, which opens an alphabetical list in place. In place rather than in
 * another modal: a filter sheet that opens a second sheet to choose one value is two dismissals for one
 * decision, and the thing being filtered is already behind both of them.
 *
 * "ANY" IS ALWAYS THE FIRST OPTION, because clearing one filter should not mean hunting for a Clear
 * that resets all of them.
 */
function Select({
  label,
  placeholder,
  options,
  value,
  open,
  onOpen,
  onPick,
}: {
  label: string
  placeholder: string
  options: { id: string; name: string }[]
  value: string | null
  open: boolean
  onOpen: () => void
  onPick: (id: string | null) => void
}) {
  const selected = options.find((option) => option.id === value)

  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${selected?.name ?? placeholder}. Choose`}
        onPress={onOpen}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: selected ? colour.forest800 : colour.lineStrong,
          backgroundColor: selected ? colour.mint100 : colour.surface,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text numberOfLines={1} style={[type.smallMedium, { color: selected ? colour.forest800 : colour.inkMuted, flex: 1 }]}>
          {selected?.name ?? placeholder}
        </Text>
        <View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
          <ChevronDown size={17} color={selected ? colour.forest800 : colour.inkSubtle} strokeWidth={2.2} />
        </View>
      </Pressable>

      {open && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden", maxHeight: 260 }}>
          <ScrollView>
            {[{ id: null as string | null, name: placeholder }, ...options].map((option, index) => {
              const isSelected = value === option.id
              return (
                <Pressable
                  key={option.id ?? "any"}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={option.name}
                  onPress={() => onPick(option.id)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={[type.smallMedium, { color: option.id ? colour.ink : colour.inkMuted, flex: 1 }]}
                  >
                    {option.name}
                  </Text>
                  {isSelected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  )
}

/**
 * One row of choices, wrapping.
 *
 * Chips rather than a list, because these are short labels and a person choosing a filter is comparing
 * them against each other -- which a wrapped row lets them do at a glance and a vertical list does not.
 */
function Chips({
  options,
  value,
  onPick,
}: {
  options: { id: string | null; name: string }[]
  value: string | null
  onPick: (id: string | null) => void
}) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((option) => {
        const selected = value === option.id
        return (
          <Pressable
            key={option.id ?? "any"}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.name}
            onPress={() => onPick(option.id)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET - 8,
              justifyContent: "center",
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colour.forest800 : colour.lineStrong,
              backgroundColor: selected ? colour.forest800 : colour.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text numberOfLines={1} style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink, fontSize: 13 }]}>
              {option.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
