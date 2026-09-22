import { useEffect, useRef } from "react"
import { Animated, Easing, Modal, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BookOpen, Camera, IdCard, Image as ImageIcon } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * WHAT YOU CAN ATTACH, AS A SHEET.
 *
 * Four permanent buttons beside a composer would leave no room to write, and most of them would be
 * wrong most of the time. A single control opens the choices, which is what a phone does.
 *
 * THE LIST IS DELIBERATELY SHORT, and the shortness is the product decision rather than an unfinished
 * state. An attachment in Ovalball is either something that just happened at the pitch -- a photo -- or
 * something the club has already published -- a library document with an owner, a category and a
 * revision. It is not a general file-transfer feature.
 *
 * SO TWO THINGS ARE ABSENT ON PURPOSE. There is no "Choose File" reaching into the phone's own
 * storage: a document in an Ovalball conversation comes from the club's library, not from whatever
 * happens to be on one person's handset. And there is no image generation, not even an entry point
 * that explains itself -- the owner does not want the idea present in the interface.
 *
 * EVERY ROW IS A REAL ACTION. Nothing here opens to explain why it cannot work.
 */

export type AttachmentAction = "documents" | "camera" | "library" | "contact"

export function AttachmentSheet({
  visible,
  onClose,
  onChoose,
  /** False in a conversation the canonical model cannot carry an attachment in. */
  canAttach,
  reason,
}: {
  visible: boolean
  onClose: () => void
  onChoose: (action: AttachmentAction) => void
  canAttach: boolean
  reason: string | null
}) {
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(500)).current
  const backdrop = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    translate.setValue(500)
    Animated.parallel([
      Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [visible, translate, backdrop])

  function dismiss(then?: () => void) {
    Animated.parallel([
      Animated.timing(translate, { toValue: 500, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return
      onClose()
      then?.()
    })
  }

  const actions: { key: AttachmentAction; label: string; caption: string; icon: React.ReactNode }[] = [
    {
      key: "documents",
      label: "Club Documents",
      caption: "Share something already in Ovalball",
      icon: <BookOpen size={20} color={colour.forest800} strokeWidth={1.9} />,
    },
    {
      key: "camera",
      label: "Take Photo",
      caption: "Use the camera",
      icon: <Camera size={20} color={colour.forest800} strokeWidth={1.9} />,
    },
    {
      key: "library",
      label: "Choose Photo",
      caption: "From your photo library",
      icon: <ImageIcon size={20} color={colour.forest800} strokeWidth={1.9} />,
    },
    {
      key: "contact",
      label: "Contact Card",
      caption: "Share your name, role and telephone number",
      icon: <IdCard size={20} color={colour.forest800} strokeWidth={1.9} />,
    },
  ]

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => dismiss()} style={{ flex: 1 }} />
      </Animated.View>

      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl + 6,
          borderTopRightRadius: radius.xl + 6,
          paddingBottom: insets.bottom + space.lg,
          transform: [{ translateY: translate }],
          ...elevation.sheet,
        }}
      >
        <View style={{ paddingTop: space.sm, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>

        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, paddingHorizontal: space.lg, paddingTop: space.lg }]}>
          Attach
        </Text>

        {!canAttach && !!reason && (
          <Text style={[type.small, { color: colour.inkMuted, paddingHorizontal: space.lg, paddingTop: space.xs }]}>
            {reason}
          </Text>
        )}

        <View style={{ padding: space.lg, gap: space.sm }}>
          {actions.map((action) => {
            const enabled = canAttach
            return (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={`${action.label}. ${action.caption}`}
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                onPress={() => dismiss(() => onChoose(action.key))}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET + 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.md,
                  borderRadius: radius.lg,
                  backgroundColor: colour.surface,
                  borderWidth: 1,
                  borderColor: colour.line,
                  opacity: !enabled ? 0.45 : pressed ? 0.88 : 1,
                })}
              >
                {action.icon}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{action.label}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{action.caption}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </Animated.View>
    </Modal>
  )
}
