import { useCallback, useEffect, useState } from "react"
import { AppState, Linking, Pressable, ScrollView, Text, View } from "react-native"
import * as Notifications from "expo-notifications"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readNotificationPreferences, type NotificationTopicPreference } from "@ovalball/contracts/notifications/preferences"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { ChevronRight } from "../../../../src/components/icons"
import { topicIcon } from "../../../../src/notifications/family"
import { Button, CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { requestPermissionAndRegister } from "../../../../src/notifications/push"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../src/design/tokens"
import { OvalballDetailHeader } from "../../../../src/components/app-header"

/**
 * NOTIFICATION PREFERENCES OVERVIEW -- one compact row per category (notifications platform programme
 * Phase I), replacing what used to be one long screen of giant, repeated toggle cards.
 *
 * Each row states the category, what it is for, and which delivery methods are currently on, in one
 * caption -- "In app, Push" -- read straight from the same preference rows the detail screen edits.
 * Nothing here is a switch; tapping a row is the only control, and it opens the one place the real
 * switches live.
 */

function deliverySummary(t: NotificationTopicPreference): string {
  if (t.mandatory) return "Always on"
  const parts: string[] = []
  if (t.inAppEnabled) parts.push("In app")
  if (t.pushEnabled) parts.push("Push")
  if (t.emailControllable && t.emailEnabled) parts.push("Email")
  return parts.length > 0 ? parts.join(", ") : "Off"
}

export default function NotificationPreferencesOverview() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const [topics, setTopics] = useState<NotificationTopicPreference[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [osPermission, setOsPermission] = useState<"granted" | "denied" | "undetermined" | null>(null)

  // THE PHONE'S OWN ANSWER, re-read whenever the app comes back -- so returning from iOS Settings
  // after switching notifications on shows the new state without a restart.
  const readPermission = useCallback(async () => {
    const settings = await Notifications.getPermissionsAsync()
    setOsPermission(settings.granted ? "granted" : settings.status === "undetermined" ? "undetermined" : "denied")
  }, [])
  useEffect(() => {
    void readPermission()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void readPermission()
    })
    return () => sub.remove()
  }, [readPermission])

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

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* LIGHT CHROME, DELIBERATELY (approved notifications mock-up): the shared detail header in its
          documented chalk tone, centred title, never a bespoke bar. */}
      <OvalballDetailHeader title="Notification Preferences" tone="chalk" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>Choose what Ovalball tells you about, and how.</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>You're in control. Important safety updates and critical cancellations are always delivered.</Text>
        </View>
        {osPermission === "denied" && (
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.warningSurface, padding: space.md, gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Push notifications are off on this phone</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Ovalball can't send push notifications until you allow them in iOS Settings. In-app notifications still arrive.
            </Text>
            <Button label="Open iOS Settings" variant="secondary" onPress={() => void Linking.openSettings()} />
          </View>
        )}
        {osPermission === "undetermined" && (
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, padding: space.md, gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Get push notifications</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>Turn on push so changes reach you even when Ovalball is closed.</Text>
            <Button
              label="Turn On Push Notifications"
              onPress={() => {
                void requestPermissionAndRegister().then(() => readPermission())
              }}
            />
          </View>
        )}
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : topics === null ? (
          <CardSkeleton lines={5} />
        ) : (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {topics.map((topic, index) => {
              const Icon = topicIcon(topic.key)
              return (
                <Pressable
                  key={topic.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${topic.label}. ${deliverySummary(topic)}.`}
                  onPress={() => router.push({ pathname: "/notifications/preferences/[topicKey]", params: { topicKey: topic.key } } as never)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    minHeight: 76,
                    paddingHorizontal: space.md,
                    paddingVertical: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? colour.chalk : colour.surface,
                  })}
                >
                  <View style={{ width: 28, alignItems: "center", alignSelf: "flex-start", paddingTop: 2 }}>
                    <Icon size={24} color={colour.ink} strokeWidth={1.7} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                      {topic.label}
                    </Text>
                    {!!topic.description && (
                      <Text style={[type.caption, { color: colour.inkMuted, fontSize: 13, lineHeight: 18 }]} numberOfLines={2}>
                        {topic.description}
                      </Text>
                    )}
                    {/* WHICH CHANNELS ARE ON, in the brand's own green -- read from the same rows the
                        detail screen edits. */}
                    <Text style={[type.caption, { color: colour.rugby700, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                      {deliverySummary(topic)}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
