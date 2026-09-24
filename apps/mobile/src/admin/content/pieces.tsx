import { Pressable, Text, TextInput, View } from "react-native"
import type { PublishingScope } from "@ovalball/contracts/club/content"

import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"

/**
 * THE COMPOSER'S PARTS -- shared by the announcement and article editors (CA-M5).
 *
 * THE AUDIENCE PICKER IS THE SERVER'S LIST. `ScopePicker` draws one chip per scope that
 * `club_publishing_scopes` returned for this person at this club -- "Whole Club" only when the club
 * scope came back, one chip per team that did -- and nothing else can be chosen. The save re-decides on
 * the server anyway; this only stops a control being offered that the write would refuse.
 */
export function ScopePicker({ scopes, value, onChange, disabled = false }: { scopes: PublishingScope[]; value: string | null; onChange: (teamId: string | null) => void; disabled?: boolean }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Audience" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {scopes.map((s) => {
        const key = s.kind === "club" ? null : s.teamId
        const label = s.kind === "club" ? "Whole Club" : (s.teamName ?? "Team")
        const on = value === key
        return (
          <Chip key={key ?? "club"} label={label} on={on} onPress={() => onChange(key)} disabled={disabled} role="radio" />
        )
      })}
    </View>
  )
}

export function Chip({ label, on, onPress, disabled = false, role = "radio" }: { label: string; on: boolean; onPress: () => void; disabled?: boolean; role?: "radio" | "button" }) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: role === "radio" ? on : undefined, selected: role === "button" ? on : undefined, disabled }}
      accessibilityLabel={label}
      onPress={disabled ? undefined : onPress}
      style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center", opacity: disabled ? 0.55 : 1 }}
    >
      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

export function ChipRow<T extends string>({ label, options, value, onChange, disabled = false, hint }: { label: string; options: { key: T; label: string; description?: string }[]; value: T; onChange: (next: T) => void; disabled?: boolean; hint?: string }) {
  const chosen = options.find((o) => o.key === value)
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {options.map((o) => (
          <Chip key={o.key} label={o.label} on={o.key === value} onPress={() => onChange(o.key)} disabled={disabled} />
        ))}
      </View>
      {!!(chosen?.description ?? hint) && <Text style={[type.caption, { color: colour.inkMuted }]}>{chosen?.description ?? hint}</Text>}
    </View>
  )
}

/** A labelled text input with an optional character counter -- the limits are the tables' own constraints. */
export function TextBox({ label, value, onChange, max, multiline = false, tall = false, placeholder, hint, editable = true, autoCapitalize = "sentences", keyboardType, inputRef, onSelectionChange, mono = false }: { label: string; value: string; onChange: (v: string) => void; max?: number; multiline?: boolean; tall?: boolean; placeholder?: string; hint?: string; editable?: boolean; autoCapitalize?: "none" | "words" | "sentences" | "characters"; keyboardType?: "default" | "url"; inputRef?: React.RefObject<TextInput | null>; onSelectionChange?: (start: number, end: number) => void; mono?: boolean }) {
  const over = max !== undefined && value.length > max
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        {max !== undefined && (
          <Text accessibilityLabel={`${value.length} of ${max} characters`} style={[type.caption, { color: over ? colour.danger : colour.inkSubtle }]}>
            {value.length}/{max}
          </Text>
        )}
      </View>
      {!!hint && <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>}
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        selectionColor={colour.pitch600}
        onSelectionChange={onSelectionChange ? (e) => onSelectionChange(e.nativeEvent.selection.start, e.nativeEvent.selection.end) : undefined}
        style={[
          type.body,
          mono ? { fontFamily: undefined } : null,
          { minHeight: multiline ? (tall ? 260 : 100) : TOUCH_TARGET, paddingHorizontal: space.md, paddingVertical: multiline ? space.md : 0, textAlignVertical: multiline ? "top" : "center", borderRadius: radius.md, borderWidth: 1, borderColor: over ? colour.danger : colour.lineStrong, backgroundColor: editable ? colour.surface : "rgba(16,21,18,0.03)", color: editable ? colour.ink : colour.inkMuted },
        ]}
      />
    </View>
  )
}

/** A message under the form: what happened, in a sentence. */
export function Notice({ tone, text }: { tone: "ok" | "error" | "info"; text: string }) {
  const bg = tone === "error" ? colour.dangerSurface : tone === "ok" ? colour.successSurface : "rgba(16,21,18,0.04)"
  const fg = tone === "error" ? colour.danger : tone === "ok" ? colour.forest800 : colour.inkMuted
  return (
    <View accessibilityRole={tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: bg }}>
      <Text style={[type.small, { color: fg }]}>{text}</Text>
    </View>
  )
}

/** The lifecycle words, from the domain's three states and an announcement's window. */
export function statusTone(status: string): "positive" | "caution" | "neutral" {
  return status === "PUBLISHED" ? "positive" : status === "ARCHIVED" ? "caution" : "neutral"
}

/** "Live", "Scheduled" or "Expired" for a published announcement -- presentation over the server's window, never authority. */
export function announcementWindowLabel(status: string, startsAt: string, expiresAt: string | null, now = Date.now()): string | null {
  if (status !== "PUBLISHED") return null
  const starts = new Date(startsAt).getTime()
  const ends = expiresAt ? new Date(expiresAt).getTime() : null
  if (starts > now) return "Scheduled"
  if (ends !== null && ends <= now) return "Expired"
  return "Live"
}

/** ISO instant -> "YYYY-MM-DD" and "HH:MM" in the device's own zone, for the native pickers. */
export function splitLocal(iso: string | null): { date: string; time: string | null } {
  if (!iso) return { date: "", time: null }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: "", time: null }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return { date: `${y}-${m}-${day}`, time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }
}

/** "YYYY-MM-DD" + "HH:MM" in the device's zone -> ISO instant. Null when there is no date. */
export function joinLocal(date: string, time: string | null): string | null {
  if (!date) return null
  const [h, mi] = (time ?? "09:00").split(":").map(Number)
  const [y, m, d] = date.split("-").map(Number)
  const local = new Date(y, m - 1, d, h, mi, 0, 0)
  return Number.isNaN(local.getTime()) ? null : local.toISOString()
}

export function todayLocal(): string {
  return splitLocal(new Date().toISOString()).date
}
