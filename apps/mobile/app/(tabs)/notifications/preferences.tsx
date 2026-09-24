import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Switch, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readNotificationPreferences, setNotificationPreference, type NotificationTopicPreference } from "@ovalball/contracts/notifications/preferences"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { ChevronRight } from "../../../src/components/icons"
import { Card, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * NOTIFICATION PREFERENCES, natively -- because every switch here controls something real (CA-M8).
 *
 * The rows are the website's own account section read through the shared contract: the in-app switch
 * gates `notifications_gate_delivery` for the topic, the email switch gates the optional emails, and a
 * mandatory topic has no switch because the server would refuse the write. There is no push switch:
 * push does not exist, and a control that changed nothing would be the first lie on the screen.
 */
export default function NotificationPreferences() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const [topics, setTopics] = useState<NotificationTopicPreference[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user) return
    setProblem(null)
    try {
      setTopics(await readNotificationPreferences(supabase, session.user.id))
    } catch (caught) {
      const failure = friendly(caught, "your notification preferences")
      logDetail("notification preferences", failure)
      setProblem(failure.message)
    }
  }, [session?.user])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(topic: NotificationTopicPreference, channel: "in_app" | "email", next: boolean) {
    setSaving(`${topic.key}:${channel}`)
    setSaveError(null)
    setTopics((prev) => (prev ?? []).map((t) => (t.key === topic.key ? { ...t, [channel === "in_app" ? "inAppEnabled" : "emailEnabled"]: next } : t)))
    try {
      await setNotificationPreference(supabase, topic.key, channel, next)
    } catch (caught) {
      // The server's answer wins -- including "this topic is mandatory".
      setTopics((prev) => (prev ?? []).map((t) => (t.key === topic.key ? topic : t)))
      setSaveError(friendly(caught, "that preference").message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Notification Preferences
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          Choose what Ovalball tells you about, and how. Important cancellations and safety updates are always delivered.
        </Text>
        {saveError && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {saveError}
          </Text>
        )}
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : topics === null ? (
          <CardSkeleton lines={4} />
        ) : (
          topics.map((topic) => (
            <Card key={topic.key} style={{ gap: space.sm }}>
              <View>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{topic.label}</Text>
                {!!topic.description && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{topic.description}</Text>}
              </View>
              {topic.mandatory ? (
                <View style={{ alignSelf: "flex-start", backgroundColor: colour.successSurface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
                  <Text style={[type.caption, { color: colour.forest800 }]}>Always on</Text>
                </View>
              ) : (
                <>
                  <ToggleRow
                    label="In the app"
                    value={topic.inAppEnabled}
                    busy={saving === `${topic.key}:in_app`}
                    onChange={(next) => void toggle(topic, "in_app", next)}
                  />
                  {topic.emailControllable && (
                    <ToggleRow
                      label="By email"
                      value={topic.emailEnabled}
                      busy={saving === `${topic.key}:email`}
                      onChange={(next) => void toggle(topic, "email", next)}
                    />
                  )}
                  {topic.hasMandatoryEvents && (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>Cancellations and safety updates in this category are always delivered.</Text>
                  )}
                </>
              )}
            </Card>
          ))
        )}
        <Text style={[type.caption, { color: colour.inkSubtle }]}>
          There is no switch for push because notifications are not sent to this device yet.
        </Text>
      </ScrollView>
    </View>
  )
}

function ToggleRow({ label, value, busy, onChange }: { label: string; value: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET }}>
      <Text style={[type.small, { color: colour.ink }]}>{label}</Text>
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
