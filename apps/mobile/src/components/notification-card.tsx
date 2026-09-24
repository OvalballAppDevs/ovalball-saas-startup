import { Pressable, Text, View } from "react-native"

import type { AttentionPriority } from "@ovalball/contracts/attention"
import { verdictWording, type AttentionVerdict, type FeedNotification } from "@ovalball/contracts/notifications/feed"

import { ChevronRight, CircleAlert, CircleCheck, Clock } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * ONE NOTIFICATION, AS A CARD (CA-M8).
 *
 * WHAT happened is the title; WHERE and WHEN it concerns is the body the emitter wrote; WHEN it
 * arrived is the time on the right. Unread is a mark AND a word -- the accessible sentence says
 * "Unread" outright -- never a colour alone.
 *
 * WHETHER THE JOB IS STILL OPEN is a separate line, and it is only drawn when the domain has been
 * asked. "Still needs your answer" comes from the attention projection finding the record open;
 * "Answered" from the projection being able to hold it and not holding it. When the projection cannot
 * say -- the wrong context for this ask, a kind nothing pairs -- the line is simply absent. Reading
 * the card never changes that line, because reading changes nothing about the fixture.
 *
 * WHO IT CONCERNS is a quiet chip: the topic's own label, and the context the notification names where
 * the person holds it. A crest is a crest and a kit is a kit; nothing here borrows either.
 */
export function NotificationCard({
  item,
  priority,
  verdict,
  contextLabel,
  topicLabel,
  now,
  onOpen,
  onLongPress,
}: {
  item: FeedNotification
  priority: AttentionPriority
  verdict: AttentionVerdict
  contextLabel: string | null
  topicLabel: string | null
  now: Date
  onOpen: () => void
  onLongPress: () => void
}) {
  const unread = item.readAt === null
  const when = whenLabel(item.createdAt, now)
  const words = verdictWording(item.type)
  const stateSentence = verdict === "open" ? `${words.open}.` : verdict === "done" ? `${words.done}.` : ""
  const label = `${unread ? "Unread. " : ""}${item.title}. ${item.body} ${stateSentence} ${when}${contextLabel ? `. ${contextLabel}` : ""}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens it. Press and hold for more"
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 16,
        flexDirection: "row",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? colour.chalk : unread ? "rgba(50,166,101,0.045)" : colour.surface,
      })}
    >
      {/* The rule: priority as a 3pt line, quiet enough that a screen of them is a list, not a siren. */}
      <View
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          backgroundColor: priority === "urgent" ? colour.warning : priority === "needs_action" ? colour.pitch600 : "transparent",
        }}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: unread ? colour.pitch600 : "transparent" }} />
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1, fontFamily: unread ? "Inter_600SemiBold" : "Inter_500Medium" }]}>{item.title}</Text>
          <Text style={[type.caption, { color: colour.inkSubtle, marginTop: 2 }]}>{when}</Text>
        </View>
        <Text style={[type.small, { color: colour.inkMuted, paddingLeft: 16 }]}>{item.body}</Text>
        {(verdict !== "unknown" || contextLabel || topicLabel) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, paddingLeft: 16, marginTop: 2 }}>
            {verdict === "open" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colour.warningSurface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <CircleAlert size={12} color={colour.warning} strokeWidth={2.2} />
                <Text style={[type.caption, { color: colour.warning, fontFamily: "Inter_500Medium" }]}>{words.open}</Text>
              </View>
            )}
            {verdict === "done" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colour.successSurface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <CircleCheck size={12} color={colour.forest800} strokeWidth={2.2} />
                <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_500Medium" }]}>{words.done}</Text>
              </View>
            )}
            {!!contextLabel && <Text style={[type.caption, { color: colour.inkSubtle }]}>{contextLabel}</Text>}
            {!!topicLabel && !contextLabel && <Text style={[type.caption, { color: colour.inkSubtle }]}>{topicLabel}</Text>}
          </View>
        )}
      </View>
      <View style={{ alignSelf: "center" }}>
        <ChevronRight size={17} color={colour.inkSubtle} />
      </View>
    </Pressable>
  )
}

/** "Just now", "12m", "3h", "Yesterday", then the date -- the arrival time, never the event's. */
export function whenLabel(iso: string, now: Date): string {
  const then = new Date(iso)
  const minutes = Math.round((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours}h`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const days = Math.round((startOfToday - startOfThen) / 86400000)
  if (days <= 1) return "Yesterday"
  if (days < 7) return then.toLocaleDateString("en-GB", { weekday: "short" })
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** A quiet clock for the empty state. */
export function QuietClock() {
  return <Clock size={26} color={colour.forest800} strokeWidth={1.8} />
}
