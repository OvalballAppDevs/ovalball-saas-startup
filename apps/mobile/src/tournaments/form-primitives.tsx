import { Pressable, Switch, Text, View } from "react-native"

import { SWISS_ROUND_RANGE } from "@ovalball/contracts/club/tournaments"

import { Check, ChevronRight, Minus, Plus } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE TOURNAMENT FORM LANGUAGE -- built entirely from the canonical tokens, so a tournament screen
 * reads as the same product as Venues & Pitches rather than a second visual system.
 *
 * ONE ROW SHAPE FOR EVERYTHING THE ORGANISER SETS. Date, time, the multi-day switch, the venue and
 * the visibility choice previously each looked like a different kind of control -- a bare native
 * picker floating on the page next to a bordered field next to a naked switch. They are all the same
 * kind of thing (one decision about this tournament), so they now share one container: white surface,
 * hairline border, a leading icon in brand green, the label above the value.
 *
 * THE SELECTED STATE IS A BORDER AND A MARK, NOT A FILLED PASTEL BLOCK. A large mint rectangle reads
 * as a template; a 1.5px forest border with a small green check reads as Ovalball, and keeps the
 * white content surface clean.
 */

/** A row the organiser taps to change something -- venue, or anything else that opens a picker. */
export function FormRow({
  icon,
  label,
  value,
  placeholder,
  secondary,
  leading,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  value?: string | null
  placeholder?: string
  secondary?: string | null
  /** An image or crest shown in place of the icon once something real is chosen. */
  leading?: React.ReactNode
  onPress?: () => void
}) {
  const filled = !!value
  const body = (
    <>
      {leading ?? <View style={{ width: 22, alignItems: "center" }}>{icon}</View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
        <Text numberOfLines={1} style={[type.body, { color: filled ? colour.ink : colour.inkSubtle, marginTop: 1 }]}>
          {value ?? placeholder}
        </Text>
        {!!secondary && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {secondary}
          </Text>
        )}
      </View>
      {onPress && <ChevronRight size={17} color={colour.inkSubtle} strokeWidth={1.9} />}
    </>
  )

  const style = {
    minHeight: TOUCH_TARGET + 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.line,
    backgroundColor: colour.surface,
  }

  if (!onPress) return <View style={style}>{body}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${value ?? placeholder ?? ""}`} onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.9 : 1 }]}>
      {body}
    </Pressable>
  )
}

/** The same row, holding a control instead of a value -- so a switch sits in the form rather than
 * beside it. */
export function FormSwitchRow({
  icon,
  label,
  hint,
  value,
  onChange,
  flat = false,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
  /** Inside a card that is already a card: the row keeps its layout and drops its own border. */
  flat?: boolean
}) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET + 14,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: flat ? 0 : space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: flat ? 0 : 1,
        borderColor: colour.line,
        backgroundColor: flat ? "transparent" : colour.surface,
      }}
    >
      <View style={{ width: 22, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colour.ink }]}>{label}</Text>
        {!!hint && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{hint}</Text>}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} />
    </View>
  )
}

/** A row that holds a native picker. The picker keeps its own control; the row supplies the label,
 * the icon and the container so it stops looking like a system component dropped onto the page. */
export function FormPickerRow({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET + 14,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
      }}
    >
      {/* A date/time picker renders its OWN icon, so passing one here would show two side by side --
          found in the Simulator. When no icon is given the picker's own sits in the icon column. */}
      {icon ? <View style={{ width: 22, alignItems: "center" }}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
        <View style={{ marginTop: 1, alignItems: "flex-start" }}>{children}</View>
      </View>
    </View>
  )
}

/** A choice card: icon, title, one short line of what it means, and a check when it is the one. */
export function ChoiceCard({
  icon,
  title,
  blurb,
  selected,
  onPress,
  /** Side by side (format) or full width stacked (visibility). */
  wide,
}: {
  icon: React.ReactNode
  title: string
  blurb: string
  selected: boolean
  onPress: () => void
  wide?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${blurb}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: wide ? undefined : 1,
        flexDirection: wide ? "row" : "column",
        alignItems: wide ? "center" : "flex-start",
        gap: wide ? space.sm : 6,
        padding: space.md,
        minHeight: wide ? TOUCH_TARGET + 14 : 112,
        borderRadius: radius.lg,
        // The selected state: a brand-green border and a green mark. Never a filled pastel panel.
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colour.forest800 : colour.line,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ width: wide ? 22 : undefined, alignItems: wide ? "center" : "flex-start" }}>{icon}</View>
      <View style={{ flex: wide ? 1 : undefined, gap: 2, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 16 }]}>{blurb}</Text>
      </View>
      {selected && (
        <View style={{ position: wide ? "relative" : "absolute", top: wide ? undefined : space.md, right: wide ? undefined : space.md }}>
          <Check size={16} color={colour.pitch600} strokeWidth={2.6} />
        </View>
      )}
    </Pressable>
  )
}

/** The small uppercase group label the rest of the app already uses above a form section. */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={[type.overline, { color: colour.inkSubtle }]}>{children}</Text>
}

/**
 * HOW MANY ROUNDS A SWISS COMPETITION RUNS.
 *
 * Swiss is the one shape whose name does not finish the sentence: "Round Robin" says everybody plays
 * everybody, "Knockout" says you go out when you lose, but "Swiss System" is meaningless without a
 * number of rounds. The database says the same thing structurally -- `swiss_rounds` is required when
 * the format is swiss and forbidden otherwise -- so this control appears with the choice and
 * disappears with it, rather than sitting on the form permanently as a field that is usually wrong.
 *
 * A STEPPER, NOT A TEXT FIELD. The answer is a small whole number between 2 and 12, and a keyboard is
 * the wrong instrument for picking one.
 */
export function SwissRoundsField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const step = (delta: number) => {
    const next = value + delta
    if (next < SWISS_ROUND_RANGE.min || next > SWISS_ROUND_RANGE.max) return
    onChange(next)
  }
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: TOUCH_TARGET + 10,
        paddingHorizontal: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Rounds</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Teams are paired by standing each round.</Text>
      </View>
      <StepButton label="One fewer round" disabled={value <= SWISS_ROUND_RANGE.min} onPress={() => step(-1)}>
        <Minus size={18} color={value <= SWISS_ROUND_RANGE.min ? colour.inkSubtle : colour.forest800} strokeWidth={2.4} />
      </StepButton>
      <Text accessibilityLabel={`${value} rounds`} style={[type.heading, { color: colour.ink, minWidth: 24, textAlign: "center" }]}>
        {value}
      </Text>
      <StepButton label="One more round" disabled={value >= SWISS_ROUND_RANGE.max} onPress={() => step(1)}>
        <Plus size={18} color={value >= SWISS_ROUND_RANGE.max ? colour.inkSubtle : colour.forest800} strokeWidth={2.4} />
      </StepButton>
    </View>
  )
}

function StepButton({ label, disabled, onPress, children }: { label: string; disabled: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.chalk,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}
