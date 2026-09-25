import type { ReactNode } from "react"
import { Modal, Pressable, Text, View } from "react-native"

import { Button } from "./ui"
import { colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE ONE NATIVE BOTTOM SHEET, established once rather than redrawn per screen.
 *
 * Extracted from the Safeguarding screen's own local component (the only bottom sheet the app had
 * before Clubhouse V1) rather than adding a gesture-sheet library — a plain `Modal` slide-up already
 * matches this design system and needed no new native dependency, which mattered for a slice already
 * adding one (MapLibre). `cancelLabel` is customisable because "Cancel" is not always the right word
 * for a read-only detail sheet (e.g. a club's own detail sheet says "Close").
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  cancelLabel = "Cancel",
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: ReactNode
  cancelLabel?: string
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md }, elevation.sheet]}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        {children}
        <Button label={cancelLabel} variant="quiet" onPress={onClose} />
      </View>
    </Modal>
  )
}
