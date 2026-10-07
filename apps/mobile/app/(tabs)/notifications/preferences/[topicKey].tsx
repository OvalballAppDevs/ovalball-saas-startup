import { useCallback, useEffect, useState } from "react"
import type { ComponentType } from "react"
import { Pressable, ScrollView, Switch, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  readNotificationEventPreferences,
  readNotificationPreferences,
  setNotificationEventPreference,
  setNotificationPreference,
  type NotificationEventPreference,
  type NotificationTopicPreference,
} from "@ovalball/contracts/notifications/preferences"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import {
  Bell,
  CalendarDays,
  CalendarSync,
  ChevronRight,
  CircleCheck,
  FileText,
  Smartphone,
  ListChecks,
  Mail,
  MessageSquare,
  Trophy,
  UserPlus,
} from "../../../../src/components/icons"
import { CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { topicIcon } from "../../../../src/notifications/family"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ONE CATEGORY'S OWN PREFERENCES (notifications platform programme Phase I): a master "Enable
 * notifications" row, a DELIVERY METHODS section, and -- only where the server actually has
 * event-level granularity built for this topic -- a "NOTIFY ME ABOUT" section underneath. Today that
 * is Tournaments alone; every other topic shows delivery methods only, honestly, rather than a row of
 * switches that would control nothing.
 *
 * ONE SWITCH PER EVENT, matching the approved mock-up exactly rather than the in-app/push pair this
 * screen first shipped with. The server still carries both channels separately -- that is what makes
 * the event-level model real rather than cosmetic -- so one visual switch here writes both
 * `in_app` and `push` together for that event, and reads as ON when either already is. Email stays
 * out of event granularity, same as before: the topic's own Delivery Methods row is where email is
 * decided.
 */
const EVENT_ICON: Record<string, ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  applications: UserPlus,
  application_decisions: FileText,
  schedule_published: CalendarDays,
  schedule_changes: CalendarSync,
  draw_updates: CalendarSync,
  result_submissions: ListChecks,
  result_confirmations: CircleCheck,
  result_disputes: MessageSquare,
  knockout_progression: Trophy,
  attendance: ListChecks,
  announcements: Bell,
}
export default function NotificationPreferenceDetail() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { topicKey } = useLocalSearchParams<{ topicKey: string }>()
  const TopicIcon = topicIcon(topicKey ?? "")

  const [topic, setTopic] = useState<NotificationTopicPreference | null>(null)
  const [events, setEvents] = useState<NotificationEventPreference[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user || !topicKey) return
    setProblem(null)
    try {
      const [topics, eventRows] = await Promise.all([
        readNotificationPreferences(supabase, session.user.id),
        readNotificationEventPreferences(supabase, session.user.id, topicKey),
      ])
      const mine = topics.find((t) => t.key === topicKey) ?? null
      setTopic(mine)
      setEvents(eventRows.filter((e) => e.hasType))
    } catch (caught) {
      const failure = friendly(caught, "your notification preferences")
      logDetail("notification preference detail", failure)
      setProblem(failure.message)
    }
  }, [session?.user, topicKey])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleTopic(channel: "in_app" | "email" | "push", next: boolean) {
    if (!topic) return
    const field = channel === "in_app" ? "inAppEnabled" : channel === "email" ? "emailEnabled" : "pushEnabled"
    setSaving(`topic:${channel}`)
    setSaveError(null)
    const previous = topic
    setTopic((prev) => (prev ? { ...prev, [field]: next } : prev))
    try {
      await setNotificationPreference(supabase, topic.key, channel, next)
    } catch (caught) {
      setTopic(previous)
      setSaveError(friendly(caught, "that preference").message)
    } finally {
      setSaving(null)
    }
  }

  /** The master row: shorthand for setting every controllable channel on this topic together. */
  async function toggleAll(next: boolean) {
    if (!topic) return
    setSaving("topic:all")
    setSaveError(null)
    const previous = topic
    const channels: Array<"in_app" | "push" | "email"> = topic.emailControllable ? ["in_app", "push", "email"] : ["in_app", "push"]
    setTopic((prev) =>
      prev ? { ...prev, inAppEnabled: next, pushEnabled: next, emailEnabled: topic.emailControllable ? next : prev.emailEnabled } : prev
    )
    try {
      await Promise.all(channels.map((channel) => setNotificationPreference(supabase, topic.key, channel, next)))
    } catch (caught) {
      setTopic(previous)
      setSaveError(friendly(caught, "that preference").message)
    } finally {
      setSaving(null)
    }
  }

  /**
   * ONE VISIBLE SWITCH, TWO REAL CHANNELS. The server keeps `in_app` and `push` as separate columns
   * per event -- that is the real granularity the architecture pass built -- but the mock-up shows
   * one control per "Notify me about" row, and asking somebody to independently manage two switches
   * per event for a scope this narrow (email is deliberately not here) would be granularity nobody
   * asked for. Turning this on sets both channels on; turning it off sets both off. The row reads as
   * ON when either channel already is, so a state only reachable by a future, finer UI still shows
   * truthfully rather than looking off.
   */
  async function toggleEvent(event: NotificationEventPreference, next: boolean) {
    setSaving(`event:${event.key}`)
    setSaveError(null)
    const previous = event
    setEvents((prev) => (prev ?? []).map((e) => (e.key === event.key ? { ...e, inAppEnabled: next, pushEnabled: next } : e)))
    try {
      await Promise.all([
        setNotificationEventPreference(supabase, event.key, "in_app", next),
        setNotificationEventPreference(supabase, event.key, "push", next),
      ])
    } catch (caught) {
      setEvents((prev) => (prev ?? []).map((e) => (e.key === event.key ? previous : e)))
      setSaveError(friendly(caught, "that preference").message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={topic?.label ?? "Notifications"} tone="chalk" onBack={() => router.back()} />

      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : topic === null || events === null ? (
        <View style={{ padding: space.lg }}>
          <CardSkeleton lines={5} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
          {/* THE CATEGORY ITSELF, as the mock-up opens: its icon, name and what it covers. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: "rgba(16,21,18,0.04)", borderRadius: radius.lg, padding: space.md }}>
            <View style={{ width: 44, alignItems: "center" }}>
              <TopicIcon size={34} color={colour.ink} strokeWidth={1.6} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.heading, { color: colour.ink }]}>{topic.label}</Text>
              {!!topic.description && <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>{topic.description}</Text>}
            </View>
          </View>
          {saveError && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {saveError}
            </Text>
          )}

          {topic.mandatory ? (
            <View style={{ alignSelf: "flex-start", backgroundColor: colour.successSurface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
              <Text style={[type.caption, { color: colour.forest800 }]}>Always On</Text>
            </View>
          ) : (
            <>
              {/*
               * MASTER SWITCH, AS A CONVENIENCE OVER THE SAME THREE COLUMNS -- not a fourth stored
               * flag. There is no separate "topic enabled" column on the server: this row reads as ON
               * when any channel below is on, and turning it off/on is shorthand for setting every
               * controllable channel off/on together, exactly the three calls a person would otherwise
               * make one at a time. Matches the mock-up's "Enable notifications" row while keeping the
               * server's three independent channels as the one source of truth.
               */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colour.line,
                  backgroundColor: colour.surface,
                  padding: space.md,
                  gap: space.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Enable Notifications</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                    Receive these notifications based on your roles and teams.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Enable notifications"
                  value={topic.inAppEnabled || topic.pushEnabled || (topic.emailControllable && topic.emailEnabled)}
                  disabled={saving === "topic:all"}
                  onValueChange={(next) => void toggleAll(next)}
                  trackColor={{ true: colour.pitch600, false: colour.lineStrong }}
                  thumbColor={colour.surface}
                />
              </View>

              <Section title="Delivery Methods">
                <ToggleRow
                  icon={Smartphone}
                  label="In App Notifications"
                  value={topic.inAppEnabled}
                  busy={saving === "topic:in_app"}
                  onChange={(next) => void toggleTopic("in_app", next)}
                />
                <ToggleRow
                  icon={Bell}
                  label="Push Notifications"
                  value={topic.pushEnabled}
                  busy={saving === "topic:push"}
                  onChange={(next) => void toggleTopic("push", next)}
                />
                {topic.emailControllable && (
                  <ToggleRow
                    icon={Mail}
                    label="Email Notifications"
                    value={topic.emailEnabled}
                    busy={saving === "topic:email"}
                    onChange={(next) => void toggleTopic("email", next)}
                  />
                )}
              </Section>
            </>
          )}

          {topic.hasMandatoryEvents && (
            <Text style={[type.caption, { color: colour.inkSubtle }]}>Cancellations and safety updates in this category are always delivered.</Text>
          )}

          {events.length > 0 && (
            <Section title="Notify Me About">
              {events.map((event) => {
                const Icon = EVENT_ICON[event.key] ?? Bell
                const on = event.inAppEnabled || event.pushEnabled
                return (
                  <View key={event.key} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    <View style={{ width: 22, alignItems: "center" }}>
                      <Icon size={18} color={colour.inkMuted} strokeWidth={1.8} />
                    </View>
                    {/* COMPACT, AS THE MOCK-UP DRAWS IT: one line per event; what it covers is read out. */}
                    <Text style={[type.small, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
                      {event.label}
                    </Text>
                    <Switch
                      accessibilityLabel={event.label}
                      accessibilityHint={event.description || undefined}
                      value={on}
                      disabled={saving === `event:${event.key}`}
                      onValueChange={(next) => void toggleEvent(event, next)}
                      trackColor={{ true: colour.pitch600, false: colour.lineStrong }}
                      thumbColor={colour.surface}
                    />
                  </View>
                )
              })}
            </Section>
          )}
        </ScrollView>
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
        {children}
      </View>
    </View>
  )
}

function ToggleRow({
  icon: Icon,
  label,
  value,
  busy,
  onChange,
}: {
  icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  label: string
  value: boolean
  busy: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
      <View style={{ width: 22, alignItems: "center" }}>
        <Icon size={18} color={colour.inkMuted} strokeWidth={1.8} />
      </View>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={busy}
        onValueChange={onChange}
        trackColor={{ true: colour.pitch600, false: colour.lineStrong }}
        thumbColor={colour.surface}
      />
    </View>
  )
}
