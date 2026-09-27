import { useState } from "react"
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { choosePhoto, takePhoto, type PickedFile } from "../messages/pickers"
import { Camera, Image as ImageIcon, X } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * CHANGING A PICTURE, FROM THE PICTURE.
 *
 * Two sources and, where there is something to remove, a removal. Deliberately
 * NOT a Files picker and deliberately not an AI generator: the attachment scope
 * decision applies to every image this app accepts, not only to the ones in a
 * conversation, and `expo-document-picker` is not a dependency so the option
 * cannot be quietly restored by adding a row to this menu.
 *
 * THE CROP IS SQUARE, because both destinations are. A person's avatar is drawn
 * in a circle and a club's crest in a square tile, so an uncropped landscape
 * photo would be centre-cropped by the renderer with the person having no say in
 * which slice of their face survived.
 *
 * THE SHEET STAYS OPEN WHILE THE WRITE IS IN FLIGHT and closes only on the
 * server's success. A sheet that dismissed on tap would leave somebody looking at
 * the old picture with no way to know whether anything happened.
 */

export interface PictureAction {
  /** What is being changed, in the words the person will read: "your picture", "the club crest". */
  subject: string
  /** Called with the prepared, resized image. Resolves to an error sentence, or null on success. */
  onReplace: (file: PickedFile) => Promise<string | null>
  /** Offered only when there is an uploaded picture to remove. Same contract. */
  onRemove?: (() => Promise<string | null>) | null
  /** Crop framing for this subject -- omitted (the default) means the square identity crop every
   * existing caller (an avatar, a crest) already relies on. A wide profile cover photo passes an
   * explicit ratio, e.g. `[16, 9]`, instead. */
  aspect?: [number, number]
}

export function PictureSheet({ action, onClose }: { action: PictureAction | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (!action) return null

  async function run(pick: () => Promise<Awaited<ReturnType<typeof takePhoto>>>) {
    setProblem(null)
    const picked = await pick()
    if ("cancelled" in picked) return
    if (!picked.ok) {
      setProblem(picked.message)
      return
    }
    setBusy(true)
    const failure = await action!.onReplace(picked.file)
    setBusy(false)
    if (failure) setProblem(failure)
    else finish()
  }

  async function remove() {
    if (!action?.onRemove) return
    setProblem(null)
    setBusy(true)
    const failure = await action.onRemove()
    setBusy(false)
    if (failure) setProblem(failure)
    else finish()
  }

  function finish() {
    setProblem(null)
    onClose()
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={finish}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={busy ? undefined : finish}
        style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }}
      />
      <View
        style={[
          {
            backgroundColor: colour.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: space.lg,
            paddingBottom: insets.bottom + space.lg,
            paddingHorizontal: space.lg,
            gap: space.sm,
          },
          elevation.sheet,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
            Change {action.subject}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            disabled={busy}
            onPress={finish}
            hitSlop={8}
            style={({ pressed }) => ({
              width: TOUCH_TARGET,
              height: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed || busy ? 0.5 : 1,
            })}
          >
            <X size={20} color={colour.inkMuted} />
          </Pressable>
        </View>

        {problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {problem}
          </Text>
        )}

        <Row
          label="Take Photo"
          icon={<Camera size={19} color={colour.forest800} />}
          disabled={busy}
          onPress={() => void run(() => takePhoto(action.aspect ? { aspect: action.aspect } : { square: true }))}
        />
        <Row
          label="Choose Photo"
          icon={<ImageIcon size={19} color={colour.forest800} />}
          disabled={busy}
          onPress={() => void run(() => choosePhoto(action.aspect ? { aspect: action.aspect } : { square: true }))}
        />
        {action.onRemove && (
          <Row label={`Remove ${action.subject}`} icon={<X size={19} color={colour.danger} />} tone="danger" disabled={busy} onPress={() => void remove()} />
        )}

        {busy && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.sm }}>
            <ActivityIndicator size="small" color={colour.forest800} />
            <Text style={[type.small, { color: colour.inkMuted }]}>Saving…</Text>
          </View>
        )}
      </View>
    </Modal>
  )
}

function Row({
  label,
  icon,
  onPress,
  disabled,
  tone = "normal",
}: {
  label: string
  icon: React.ReactNode
  onPress: () => void
  disabled: boolean
  tone?: "normal" | "danger"
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 6,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: pressed ? colour.chalk : colour.surface,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {icon}
      <Text style={[type.bodyMedium, { color: tone === "danger" ? colour.danger : colour.ink, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  )
}
