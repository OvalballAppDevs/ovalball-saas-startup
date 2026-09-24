import { useState } from "react"
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native"
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker"

import { CalendarDays, Check, ChevronRight, Clock } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE FORM PARTS A FIXTURE NEEDS, AND NO MORE.
 *
 * NATIVE CONTROLS, NOT WEB ONES. A date is picked with the operating system's own wheel or calendar,
 * which a person already knows how to use, which respects their locale and their accessibility
 * settings, and which cannot produce 31 February. A text field asking for "DD/MM/YYYY" is the thing
 * this exists to avoid.
 *
 * A LABEL IS ALWAYS VISIBLE. Placeholder-as-label disappears the moment somebody types, which is
 * exactly when they most want to check what they are filling in.
 *
 * A DISABLED FIELD SAYS WHY. `fixture_editable_fields` returns the database's own sentence for every
 * refusal -- "Only the owning club can change the opposition" -- and a greyed-out control that explains
 * nothing makes a person wonder whether the app is broken.
 */

export function Field({
  label,
  hint,
  disabledReason,
  children,
}: {
  label: string
  hint?: string
  disabledReason?: string | null
  children: React.ReactNode
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      {!!hint && <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>}
      <View style={{ opacity: disabledReason ? 0.55 : 1 }} pointerEvents={disabledReason ? "none" : "auto"}>
        {children}
      </View>
      {!!disabledReason && (
        <Text style={[type.caption, { color: colour.warning }]}>{disabledReason}</Text>
      )}
    </View>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  multiline,
  autoCapitalize = "sentences",
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  label: string
  multiline?: boolean
  autoCapitalize?: "none" | "sentences" | "words"
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colour.inkSubtle}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      selectionColor={colour.pitch600}
      style={[
        type.body,
        {
          minHeight: multiline ? 88 : TOUCH_TARGET,
          paddingHorizontal: space.md,
          paddingVertical: multiline ? space.md : 0,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colour.lineStrong,
          backgroundColor: colour.surface,
          color: colour.ink,
          textAlignVertical: multiline ? "top" : "center",
        },
      ]}
    />
  )
}

/**
 * A DATE, THROUGH THE SYSTEM PICKER.
 *
 * iOS shows it inline and reports every change; Android opens a dialog and reports once. Both are
 * handled rather than one being made to imitate the other, because imitating the other is how a
 * picker ends up feeling foreign on one of the two platforms.
 *
 * THE VALUE IS A CIVIL DATE, and it stays one. A fixture's date is a day at a ground, not an instant:
 * converting through UTC is what turns a Saturday evening kick-off into Sunday for anybody west of
 * Greenwich. So the ISO string is assembled from the picker's own local year, month and day.
 */
export function DateField({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) {
  const [open, setOpen] = useState(Platform.OS === "ios")
  const date = new Date(`${value}T12:00:00`)

  function handle(_event: DateTimePickerEvent, next?: Date) {
    if (Platform.OS !== "ios") setOpen(false)
    if (!next) return
    const y = next.getFullYear()
    const m = String(next.getMonth() + 1).padStart(2, "0")
    const d = String(next.getDate()).padStart(2, "0")
    onChange(`${y}-${m}-${d}`)
  }

  if (Platform.OS === "ios") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <CalendarDays size={18} color={colour.forest800} strokeWidth={1.9} />
        <DateTimePicker value={date} mode="date" display="compact" onChange={handle} accessibilityLabel={label} />
      </View>
    )
  }

  /*
    THE WEB EXPORT IS THE PROOF SURFACE, AND THE NATIVE PICKER DOES NOT RENDER THERE (CA-M7.1).

    `@react-native-community/datetimepicker` has no web implementation, so on Expo Web the trigger
    below opened nothing and a schedule could never be changed through the interface -- which is how a
    browser proof of the kick-off path could not be run. On web the field is typed instead, in the one
    shape the database stores; the native pickers above and below are untouched.
  */
  if (Platform.OS === "web") {
    return <TypedField icon={<CalendarDays size={18} color={colour.forest800} strokeWidth={1.9} />} label={label} value={value} placeholder="YYYY-MM-DD" pattern={/^\d{4}-\d{2}-\d{2}$/} onChange={(next) => next && onChange(next)} />
  }

  return (
    <>
      <Trigger
        icon={<CalendarDays size={18} color={colour.forest800} strokeWidth={1.9} />}
        label={label}
        value={date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
        onPress={() => setOpen(true)}
      />
      {open && <DateTimePicker value={date} mode="date" onChange={handle} />}
    </>
  )
}

/** A kick-off time. Null is legitimate: a fixture whose time is not yet agreed has none. */
export function TimeField({
  value,
  onChange,
  label,
}: {
  value: string | null
  onChange: (time: string | null) => void
  label: string
}) {
  const [open, setOpen] = useState(Platform.OS === "ios")
  const base = new Date()
  if (value) {
    const [h, m] = value.split(":").map(Number)
    base.setHours(h ?? 12, m ?? 0, 0, 0)
  } else {
    base.setHours(12, 0, 0, 0)
  }

  function handle(_event: DateTimePickerEvent, next?: Date) {
    if (Platform.OS !== "ios") setOpen(false)
    if (!next) return
    onChange(`${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`)
  }

  return (
    <View style={{ gap: space.xs }}>
      {/* THE CLOCK FORMAT IS THE DEVICE'S, not this app's. A phone set to a 12-hour clock shows a
          12-hour picker; forcing 24-hour would be Ovalball overruling a preference somebody set
          deliberately. The VALUE is always 24-hour, because that is what the database stores. */}
      {Platform.OS === "ios" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Clock size={18} color={colour.forest800} strokeWidth={1.9} />
          <DateTimePicker value={base} mode="time" display="compact" onChange={handle} accessibilityLabel={label} />
          {!!value && <Clear onPress={() => onChange(null)} label={`Clear ${label}`} />}
        </View>
      ) : Platform.OS === "web" ? (
        /* Typed on web (see DateField): the native picker has no web implementation. */
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <TypedField icon={<Clock size={18} color={colour.forest800} strokeWidth={1.9} />} label={label} value={value ?? ""} placeholder="HH:MM" pattern={/^([01]\d|2[0-3]):[0-5]\d$/} onChange={(next) => onChange(next)} />
          </View>
          {!!value && <Clear onPress={() => onChange(null)} label={`Clear ${label}`} />}
        </View>
      ) : (
        <>
          <Trigger
            icon={<Clock size={18} color={colour.forest800} strokeWidth={1.9} />}
            label={label}
            value={value ?? "Not set"}
            onPress={() => setOpen(true)}
          />
          {open && <DateTimePicker value={base} mode="time" onChange={handle} />}
        </>
      )}
    </View>
  )
}

/**
 * A date or a time typed rather than picked -- web only. The value reaches the caller only once it is
 * in the stored shape, so a half-typed "10:" never becomes a kick-off; clearing the field hands back
 * null so a time can be un-set the same way the native control allows.
 */
function TypedField({ icon, label, value, placeholder, pattern, onChange }: { icon: React.ReactNode; label: string; value: string; placeholder: string; pattern: RegExp; onChange: (next: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <View style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
      {icon}
      <TextInput
        accessibilityLabel={label}
        value={draft}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(text) => {
          const trimmed = text.trim()
          setDraft(text)
          if (trimmed.length === 0) onChange(null)
          else if (pattern.test(trimmed)) onChange(trimmed)
        }}
        style={[type.body, { color: colour.ink, flex: 1, minHeight: TOUCH_TARGET }]}
      />
    </View>
  )
}

function Clear({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[type.caption, { color: colour.inkMuted }]}>Clear</Text>
    </Pressable>
  )
}

function Trigger({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.lineStrong,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon}
      <Text style={[type.body, { color: colour.ink, flex: 1 }]}>{value}</Text>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

/**
 * A SHORT LIST OF MUTUALLY EXCLUSIVE CHOICES, AS BUTTONS.
 *
 * Home or Away is two words and a tap; a dropdown for it would be a menu covering the form to choose
 * between two things. Four is the point where this stops being the right control, which is exactly
 * where the fixture statuses sit -- so they get it too, and nothing longer does.
 */
export function ChoiceField<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 92,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.xs,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: selected ? colour.forest800 : colour.lineStrong,
              backgroundColor: selected ? colour.mint100 : colour.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {selected && <Check size={15} color={colour.forest800} strokeWidth={2.6} />}
            <Text numberOfLines={1} style={[type.smallMedium, { color: selected ? colour.forest800 : colour.ink }]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function SubmitButton({
  label,
  onPress,
  busy,
  disabled,
  tone = "forest",
}: {
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
  tone?: "forest" | "danger"
}) {
  const ready = !disabled && !busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !ready, busy }}
      disabled={!ready}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        backgroundColor: ready ? (tone === "danger" ? colour.danger : colour.forest800) : colour.lineStrong,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colour.onForest} /> : <Text style={[type.smallMedium, { color: colour.onForest }]}>{label}</Text>}
    </Pressable>
  )
}
