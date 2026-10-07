import { useEffect, useState } from "react"
import { Pressable, ScrollView, Switch, Text, View } from "react-native"
import { Image } from "expo-image"

import { eventHostLine, eventTypeLabel, type EventCentre } from "@ovalball/contracts/events/centre"
import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { CalendarDays, Clock, MapPin, Pencil } from "../components/icons"
import { TOUCH_TARGET, colour, eventTone, radius, space, type } from "../design/tokens"
import { coverPhotoSource } from "../media/stock-assets"

/**
 * THE EVENT CENTRE'S SHARED PIECES -- one hero, one section bar, one card and one row style, used by
 * every section and every viewer. An organiser and a parent read the same components; the server's
 * projection decides what is in them.
 */

export type EventSection = "overview" | "guests" | "catering" | "messages"

export const EVENT_SECTION_LABEL: Record<EventSection, string> = {
  overview: "Overview",
  guests: "Guests",
  catering: "Catering",
  messages: "Messages",
}

/** The sections this viewer has: guests are "Attendance" to an invitee, and catering appears only when the event has it. */
export function eventSections(e: EventCentre): { key: EventSection; label: string }[] {
  return [
    { key: "overview" as const, label: "Overview" },
    { key: "guests" as const, label: e.viewer.canManage ? "Guests" : "Attendance" },
    ...(e.catering.required ? [{ key: "catering" as const, label: "Catering" }] : []),
    { key: "messages" as const, label: "Messages" },
  ]
}

export function parseEventSection(value: string | string[] | undefined): EventSection {
  const v = Array.isArray(value) ? value[0] : value
  return v === "guests" || v === "catering" || v === "messages" || v === "overview" ? v : v === "attendance" ? "guests" : "overview"
}

const HERO_HEIGHT = 300

export function EventHero({ event }: { event: EventCentre }) {
  const crest = clubLogoUrlFromPath(supabase, event.host.logoPath)
  const badge = event.phase === "CANCELLED" ? "CANCELLED" : event.phase === "POSTPONED" ? "POSTPONED" : event.phase === "DRAFT" ? "DRAFT" : event.phase === "COMPLETED" ? "COMPLETED" : event.host.teamName ? "TEAM EVENT" : "CLUB EVENT"
  return (
    <View style={{ height: HERO_HEIGHT, backgroundColor: colour.forest950 }}>
      {event.cover.path ? (
        <SignedCover path={event.cover.path} />
      ) : (
        <Image
          source={coverPhotoSource("EVENT", event.cover.stockKey ? { kind: "stock", key: event.cover.stockKey } : { kind: "none" }, event.id, { eventType: event.eventType, startsOn: event.startsOn })}
          style={{ position: "absolute", inset: 0 }}
          contentFit="cover"
          accessible={false}
        />
      )}
      {/* The image is atmosphere; the words sit on a forest scrim so they read on any picture. */}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: "40%", backgroundColor: colour.forest950, opacity: 0.25 }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "62%", backgroundColor: colour.forest950, opacity: 0.62 }} />
      <View style={{ position: "absolute", left: space.lg, right: space.lg, top: space.xl, bottom: space.lg, alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
        <View style={{ width: 82, height: 82, borderRadius: radius.lg, backgroundColor: colour.surface, alignItems: "center", justifyContent: "center", marginBottom: space.sm, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
          <ClubCrest clubName={event.host.clubName} url={crest} size={66} />
        </View>
        <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.onForest, textAlign: "center" }]}>{eventHostLine(event)}</Text>
        <Text accessibilityRole="header" numberOfLines={2} style={{ fontFamily: type.display.fontFamily, fontSize: 30, lineHeight: 34, color: colour.onForest, textAlign: "center" }}>{event.name}</Text>
        <View style={{ marginTop: space.xs, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: event.phase === "CANCELLED" ? colour.danger : eventTone.event.accent }}>
          <Text style={[type.caption, { color: colour.onForest, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" }]}>{badge}</Text>
        </View>
      </View>
    </View>
  )
}

/** The organiser's own picture, from the private bucket, signed for the people who may see the event. */
function SignedCover({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void supabase.storage.from("event-covers").createSignedUrl(path, 3600).then(({ data }) => live && setUrl(data?.signedUrl ?? null))
    return () => {
      live = false
    }
  }, [path])
  return url ? <Image source={{ uri: url }} style={{ position: "absolute", inset: 0 }} contentFit="cover" accessible={false} /> : null
}

/** When and where, under the hero: the facts a person checks first. */
export function EventFacts({ event }: { event: EventCentre }) {
  return (
    <View style={{ backgroundColor: colour.surface, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colour.line }}>
      <Fact icon={<CalendarDays size={17} color={colour.forest800} />} text={eventDateLine(event)} />
      <Fact icon={<Clock size={17} color={colour.forest800} />} text={eventTimeLine(event)} />
      <Fact icon={<MapPin size={17} color={colour.forest800} />} text={placeTitle(event)} sub={placeSub(event)} />
    </View>
  )
}

function Fact({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string | null }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{text}</Text>
        {!!sub && <Text style={[type.caption, { color: colour.inkMuted }]}>{sub}</Text>}
      </View>
    </View>
  )
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
export function eventDateLine(e: Pick<EventCentre, "startsOn" | "endsOn">): string {
  const d = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`))
  return e.endsOn !== e.startsOn ? `${d(e.startsOn)} – ${d(e.endsOn)}` : d(e.startsOn)
}
export function eventTimeLine(e: Pick<EventCentre, "startTime" | "endTime" | "meetTime">): string {
  if (!e.startTime) return "All day"
  return `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ""}${e.meetTime ? ` · Arrive by ${e.meetTime}` : ""}`
}
function placeTitle(e: EventCentre): string {
  const l = e.location
  if (l.kind === "ONLINE") return "Online"
  if (l.kind === "VENUE") return [l.venue?.name, l.detail].filter(Boolean).join(" · ") || "Venue to be confirmed"
  return l.external?.name ?? "Place to be confirmed"
}
function placeSub(e: EventCentre): string | null {
  const l = e.location
  if (l.kind === "VENUE") return [l.venue?.address, l.venue?.postcode].filter(Boolean).join(", ") || null
  if (l.kind === "EXTERNAL") return [l.external?.address, l.external?.postcode].filter(Boolean).join(", ") || null
  return l.onlineUrl ? "The link is in the event details." : null
}

export function EventTabs({ tabs, section, onSelect }: { tabs: { key: EventSection; label: string }[]; section: EventSection; onSelect: (s: EventSection) => void }) {
  return (
    <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.sm, flexGrow: 1 }} accessibilityRole="tablist">
        {tabs.map((t) => {
          const selected = t.key === section
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onSelect(t.key)}
              style={({ pressed }) => ({ flexGrow: 1, minHeight: 48, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: selected ? colour.forest800 : "transparent", opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.smallMedium, { color: selected ? colour.forest800 : colour.inkMuted, fontFamily: selected ? "Inter_600SemiBold" : "Inter_500Medium" }]}>{t.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

export function SectionCard({ title, onEdit, editLabel, children, padded = true }: { title?: string; onEdit?: () => void; editLabel?: string; children: React.ReactNode; padded?: boolean }) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: padded ? space.lg : 0, gap: space.md, overflow: "hidden" }}>
      {(!!title || onEdit) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: padded ? 0 : space.lg, paddingTop: padded ? 0 : space.lg }}>
          {!!title && <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>{title}</Text>}
          {onEdit && (
            <Pressable accessibilityRole="button" accessibilityLabel={editLabel ?? "Edit"} onPress={onEdit} hitSlop={6} style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.forest800, opacity: pressed ? 0.6 : 1 })}>
              <Pencil size={14} color={colour.forest800} />
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  )
}

export function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: 2 }}>
      <Text style={[type.small, { color: colour.inkMuted, width: 104 }]}>{label}</Text>
      <View style={{ flex: 1, flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
        {icon}
        <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{value}</Text>
      </View>
    </View>
  )
}

export function ToggleRow({ title, detail, value, onChange, disabled }: { title: string; detail?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        {!!detail && <Text style={[type.caption, { color: colour.inkMuted }]}>{detail}</Text>}
      </View>
      <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} />
    </View>
  )
}

/** The Event Centre's audience chips are the shared filter chip. */
export { FilterChip as Chip } from "../components/filter-chip"

export function Stat({ label, value, strong, icon }: { label: string; value: number | string; strong?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: strong ? colour.mint100 : "transparent" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {icon}
        <Text numberOfLines={1} style={[type.caption, { color: strong ? colour.forest800 : colour.inkMuted }]}>{label}</Text>
      </View>
      <Text style={[type.title, { color: strong ? colour.forest800 : colour.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}

export { eventTypeLabel }
