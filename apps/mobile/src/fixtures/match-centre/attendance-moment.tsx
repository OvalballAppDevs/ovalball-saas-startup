import { useEffect, useState } from "react"
import { Modal, Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import { VideoView, useVideoPlayer } from "expo-video"
import * as Haptics from "expo-haptics"

import type { AttendanceAnswer } from "@ovalball/contracts/match-centre/attendance"

import { useReduceMotion } from "../../a11y/reduce-motion"
import { CircleAlert, CircleCheck, CircleHelp } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"

/**
 * THE ATTENDANCE MOMENT -- a short branded confirmation after an answer has been SAVED.
 *
 * It never stands between a family and their answer: the server has already accepted it before this
 * appears, and a tap anywhere dismisses it. Three clips, generated on Higgsfield and checked by eye:
 *
 *   Attending     -- a young player celebrating in green and gold confetti
 *   Can't Attend  -- a teenage girl in rugby kit giving a confident thumbs-down under red light:
 *                    "not this time", never a sad child (owner correction)
 *   Unsure        -- a light-hearted shrug in amber
 *
 * Somebody who asked their phone for less movement gets the still frame and the same words. A clip that
 * fails to load falls back to the same still. The words are always real text over the picture.
 */
const MOMENT: Record<AttendanceAnswer, { video: number; still: number; tint: string; edge: string; button: string; buttonInk: string; Icon: typeof CircleCheck }> = {
  ATTENDING: {
    video: require("../../../assets/match-centre/attending.mp4"),
    still: require("../../../assets/match-centre/attending.jpg"),
    tint: "rgba(11,43,30,0.10)",
    edge: colour.pitch600,
    button: colour.pitch600,
    buttonInk: colour.forest950,
    Icon: CircleCheck,
  },
  CANNOT_ATTEND: {
    video: require("../../../assets/match-centre/cannot-attend.mp4"),
    still: require("../../../assets/match-centre/cannot-attend.jpg"),
    tint: "rgba(80,10,10,0.18)",
    edge: "#e5484d",
    button: "#e5484d",
    buttonInk: "#ffffff",
    Icon: CircleAlert,
  },
  UNSURE: {
    video: require("../../../assets/match-centre/unsure.mp4"),
    still: require("../../../assets/match-centre/unsure.jpg"),
    tint: "rgba(70,45,0,0.16)",
    edge: "#f5b83d",
    button: "#f5b83d",
    buttonInk: colour.forest950,
    Icon: CircleHelp,
  },
}

const BUTTON_LABEL: Record<AttendanceAnswer, string> = { ATTENDING: "Great", CANNOT_ATTEND: "Okay", UNSURE: "Got It" }

export function AttendanceMoment({
  status,
  title,
  body,
  onClose,
}: {
  status: AttendanceAnswer
  title: string
  body: string
  onClose: () => void
}) {
  const reduceMotion = useReduceMotion()
  const look = MOMENT[status]
  const [failed, setFailed] = useState(false)
  const player = useVideoPlayer(reduceMotion ? null : look.video, (p) => {
    p.loop = false
    p.muted = true
    p.play()
  })

  useEffect(() => {
    void Haptics.notificationAsync(
      status === "ATTENDING" ? Haptics.NotificationFeedbackType.Success : status === "CANNOT_ATTEND" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Warning
    ).catch(() => undefined)
    // SHORT, NOT A FILM: it leaves on its own after the clip (or a moment, without one).
    const timer = setTimeout(onClose, reduceMotion ? 2600 : 4300)
    const sub = player?.addListener?.("statusChange", ({ status: s }: { status: string }) => {
      if (s === "error") setFailed(true)
    })
    return () => {
      clearTimeout(timer)
      sub?.remove?.()
    }
  }, [onClose, player, reduceMotion, status])

  const Icon = look.Icon
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} ${body}. Dismiss`}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.72)", alignItems: "center", justifyContent: "center", padding: space.lg }}
      >
        <View
          accessibilityLiveRegion="polite"
          style={{ width: "100%", maxWidth: 380, aspectRatio: 0.62, borderRadius: radius.xl, overflow: "hidden", borderWidth: 2, borderColor: look.edge, backgroundColor: colour.forest950 }}
        >
          {reduceMotion || failed ? (
            <Image source={look.still} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" accessible={false} />
          ) : (
            <VideoView player={player} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" nativeControls={false} />
          )}
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: look.tint }} />
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "46%", backgroundColor: "rgba(7,28,20,0.72)" }} />
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.sm, alignItems: "center" }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: look.edge, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,28,20,0.6)" }}>
              <Icon size={30} color={look.edge} strokeWidth={2.6} />
            </View>
            <Text style={[type.display, { color: colour.chalk, textAlign: "center", fontSize: 30, lineHeight: 34 }]}>{title}</Text>
            <Text style={[type.body, { color: colour.chalk, textAlign: "center" }]}>{body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={BUTTON_LABEL[status]}
              onPress={onClose}
              style={({ pressed }) => ({
                marginTop: space.sm,
                minHeight: TOUCH_TARGET + 4,
                alignSelf: "stretch",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: look.button,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.bodyMedium, { color: look.buttonInk }]}>{BUTTON_LABEL[status]}</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  )
}
