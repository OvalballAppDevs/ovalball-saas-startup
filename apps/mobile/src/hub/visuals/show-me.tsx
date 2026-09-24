import { useState } from "react"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "../../components/ui"
import { colour, radius, space, type } from "../../design/tokens"
import { HubVisualExplainer, type HubExplain } from "./explainer"
import { visualFor, type HubEntityRef } from "./manifest"

/**
 * READ IT / SHOW ME. A button that exists only when the manifest has a scene for this canonical
 * entity, and that mounts the explainer only when opened. Inline it sits in the page; otherwise it
 * opens as a sheet the person can close.
 */
export function HubShowMe({ entity, explanations, onOpen, label = "Show Me", inline = false }: { entity: HubEntityRef; explanations: HubExplain; onOpen: (ref: HubEntityRef) => void; label?: string; inline?: boolean }) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const visual = visualFor(entity)
  if (!visual) return null

  if (inline) {
    return (
      <View style={{ gap: space.md }}>
        {!open && <Button label={label} variant="secondary" onPress={() => setOpen(true)} accessibilityHint="Shows a picture with the parts you can tap" />}
        {open && (
          <>
            <HubVisualExplainer visual={visual} explanations={explanations} onOpen={onOpen} />
            <Button label="Hide" variant="quiet" onPress={() => setOpen(false)} />
          </>
        )}
      </View>
    )
  }

  return (
    <>
      <Button label={label} variant="secondary" onPress={() => setOpen(true)} accessibilityHint="Shows a picture with the parts you can tap" />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: colour.chalk }}>
          <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colour.line }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              {explanations(entity)?.title ?? label}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} hitSlop={8} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
            <HubVisualExplainer
              visual={visual}
              explanations={explanations}
              onOpen={(ref) => {
                setOpen(false)
                onOpen(ref)
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}
