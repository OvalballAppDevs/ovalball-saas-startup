import { useEffect, useState } from "react"
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg"
import * as Notifications from "expo-notifications"

import { useSession } from "../auth/session"
import { requestPermissionAndRegister } from "./push"
import { hasDecided, markDecided } from "./pre-prompt-storage"
import { BRAND_GREEN, OvalballMark, OvalballWordmark } from "../components/brand"
import { CalendarDays, ChevronRight, ListChecks, Bell as BellIcon, Trophy, Users } from "../components/icons"
import { editorial } from "../components/home/editorial"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * OVALBALL ASKS FIRST, THEN IOS ASKS. iOS's own permission dialog has no customisable text at all --
 * one line, decided by Apple, shown once, and showing it as somebody's very first encounter with "can
 * Ovalball notify me" means the only explanation they ever get is the OS's own generic sentence. So
 * this screen explains WHY first, in Ovalball's own words and chrome, and the OS prompt -- which
 * `requestPermissionAndRegister` triggers only from this screen's own button -- is the second ask,
 * not the first.
 *
 * FULL-BLEED, ON BRAND (physical design pass, mock-up "1. Notification Pre-Prompt") -- not a sheet
 * borrowed from a confirmation dialog. The same forest ground, the same action photograph the Home
 * hero already uses (`editorial.heroMatch`, approved Higgsfield artwork, never regenerated here), and
 * the canonical mark measured from the protected logo file (`components/brand.tsx`) -- never a
 * generic bell or a second drawing of the ring.
 *
 * SHOWN ONCE PER ACCOUNT, ON THIS DEVICE (`pre-prompt-storage.ts`), and never at all once the OS
 * already has an answer on file -- a account that has already granted or already refused is never
 * asked Ovalball's own question a second time; "Skip"/"Not Now" and a later in-app toggle in
 * Notification Preferences are the paths back to it, not a repeat of this screen.
 */
const BENEFITS = [
  { Icon: CalendarDays, title: "Fixture changes", description: "Kick-off, pitch and result updates" },
  { Icon: Trophy, title: "Tournament updates", description: "Draws, schedules and results" },
  { Icon: ListChecks, title: "Availability requests", description: "Team selection and attendance" },
  { Icon: Users, title: "Team updates", description: "Messages and announcements" },
  { Icon: BellIcon, title: "Important updates", description: "Safety information and cancellations" },
] as const

export function PushPrePrompt() {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { userId, status } = useSession()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (status !== "signed-in" || !userId) return
      const [decided, settings] = await Promise.all([hasDecided(userId), Notifications.getPermissionsAsync()])
      if (cancelled) return
      // UNDETERMINED ONLY. A device that already has an OS answer (granted elsewhere, or refused
      // through the OS's own settings) is not shown Ovalball's own question again -- the OS is the
      // one true record of whether permission exists, and this screen never second-guesses it.
      if (!decided && settings.status === "undetermined") setVisible(true)
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [status, userId])

  async function decide(enable: boolean) {
    if (!userId) return
    setBusy(true)
    if (enable) await requestPermissionAndRegister()
    await markDecided(userId)
    setBusy(false)
    setVisible(false)
  }

  const heroHeight = Math.round(height * 0.5)

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => void decide(false)}>
      <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
        <StatusBar style="light" />

        {/* THE PHOTOGRAPH. Decorative: the words over and below it carry the meaning. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: heroHeight, overflow: "hidden" }}
        >
          {editorial.heroMatch && (
            <Image source={editorial.heroMatch} style={{ width, height: heroHeight }} contentFit="cover" contentPosition="top" accessible={false} />
          )}
          <Svg width={width} height={heroHeight} style={{ position: "absolute", top: 0, left: 0 }}>
            <Defs>
              <LinearGradient id="preprompt-foot" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.15" />
                <Stop offset="0.55" stopColor={colour.forest950} stopOpacity="0.35" />
                <Stop offset="1" stopColor={colour.forest950} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={width} height={heroHeight} fill="url(#preprompt-foot)" />
          </Svg>
        </View>

        {/* TOP ROW: the mark and wordmark, and a way out that asks nothing. */}
        <View
          style={{
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.lg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <OvalballMark size={26} tint={colour.chalk} />
            <OvalballWordmark size={15} onDark />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip"
            disabled={busy}
            onPress={() => void decide(false)}
            hitSlop={8}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET - 8, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.smallMedium, { color: "rgba(248,250,247,0.78)" }]}>Skip</Text>
          </Pressable>
        </View>

        {/* THE COLUMN: headline, benefits, and the two actions, anchored to the foot. */}
        <View style={{ flex: 1, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.lg, justifyContent: "flex-end", gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={{ fontFamily: "Inter_600SemiBold", fontSize: 32, lineHeight: 38, letterSpacing: -0.4, color: colour.chalk }}>
              Stay up to date{"\n"}with <Text style={{ color: BRAND_GREEN }}>your rugby</Text>
            </Text>
            <Text style={[type.small, { color: "rgba(248,250,247,0.78)", marginTop: space.xs }]}>
              Get notified about the things that matter to you.
            </Text>
          </View>

          <View style={{ gap: space.md }}>
            {BENEFITS.map(({ Icon, title, description }) => (
              <View key={title} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
                <View style={{ width: 22, alignItems: "center", paddingTop: 1 }}>
                  <Icon size={19} color={colour.chalk} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.chalk }]}>{title}</Text>
                  <Text style={[type.caption, { color: "rgba(248,250,247,0.68)", marginTop: 1 }]}>{description}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: space.sm }}>
            <PrimaryAction label="Enable Notifications" busy={busy} onPress={() => void decide(true)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Not now"
              disabled={busy}
              onPress={() => void decide(false)}
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: "rgba(248,250,247,0.78)" }]}>Not Now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

/** The one loud control on this screen: a green pill with an arrow, matching the welcome screen's own. */
function PrimaryAction({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            minHeight: Math.max(TOUCH_TARGET, 56),
            borderRadius: radius.md,
            backgroundColor: pressed ? "#029457" : BRAND_GREEN,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Text style={[type.bodyMedium, { color: colour.chalk, fontFamily: "Inter_600SemiBold", fontSize: 17 }]}>{label}</Text>
          {!busy && <ChevronRight size={20} color={colour.chalk} strokeWidth={2.4} />}
        </View>
      )}
    </Pressable>
  )
}
