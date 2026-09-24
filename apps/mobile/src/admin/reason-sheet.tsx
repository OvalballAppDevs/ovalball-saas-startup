import { useEffect, useState } from "react"
import { Modal, Pressable, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"

import { Button } from "../components/ui"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * ONE SHEET FOR EVERY CONFIRMED, REASONED ACTION IN THE ADMIN CENTRE.
 *
 * A membership operation is explicit: it names what will happen, asks for the reason the server
 * will record when the shared list says the server requires one (`reasonRuleFor`), offers it when
 * the server may ask, and confirms. Nothing runs on a swipe or a single tap. The server judges the
 * call again -- a missing reason is refused there too -- and the sheet shows the server's own
 * sentence when it refuses. A 42501 also tells the caller so the screen can re-ask its authority.
 *
 * RECENT AUTHENTICATOR (CA-M4). When the server answers that a code must be entered first, that is
 * not a problem to display: the sheet hands the typed reason back through `onStepUp`, the screen
 * keeps the intent in memory, sends the person to the step-up screen, and re-opens this sheet on
 * return. The person confirms again and the SERVER authorises again -- passing the second factor
 * never runs the change by itself.
 */
export interface ReasonAsk {
  title: string
  body?: string
  /** A quiet line under the body, e.g. after a step-up: "Verified. Confirm to continue." */
  note?: string
  confirmLabel: string
  destructive?: boolean
  /** "required": cannot confirm without a reason. "optional": the field is offered. "none": no field. */
  reason: "required" | "optional" | "none"
  /** A reason typed before a step-up, put back so it is not typed twice. */
  initialReason?: string
  onConfirm: (reason: string) => Promise<void>
}

export function ReasonSheet({
  ask,
  onClose,
  onRefused,
  onStepUp,
  errorMessage,
}: {
  ask: ReasonAsk | null
  onClose: () => void
  onRefused?: () => void
  /** The server wants a recent authenticator: the screen holds the intent and sends the person to step up. */
  onStepUp?: (pendingReason: string) => void
  errorMessage: (cause: unknown) => string
}) {
  const insets = useSafeAreaInsets()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setReason(ask?.initialReason ?? "")
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null
  const needsReason = ask.reason === "required" && reason.trim().length === 0

  async function confirm() {
    if (!ask) return
    setBusy(true)
    setProblem(null)
    try {
      await ask.onConfirm(reason.trim())
      onClose()
    } catch (cause) {
      if (isRecentAuthRefusal(cause) && onStepUp) {
        setBusy(false)
        onStepUp(reason.trim())
        return
      }
      setProblem(errorMessage(cause))
      if ((cause as { code?: string }).code === "42501") onRefused?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <Pressable accessibilityLabel="Close" onPress={busy ? undefined : onClose} style={{ flex: 1, backgroundColor: "rgba(16,21,18,0.45)" }} />
      <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }, elevation.sheet]}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          {ask.title}
        </Text>
        {ask.body && <Text style={[type.small, { color: colour.inkMuted }]}>{ask.body}</Text>}
        {ask.note && (
          <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
            <Text style={[type.small, { color: colour.forest800 }]}>{ask.note}</Text>
          </View>
        )}
        {ask.reason !== "none" && (
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{ask.reason === "required" ? "Reason" : "Reason (optional)"}</Text>
            <TextInput
              accessibilityLabel="Reason"
              value={reason}
              onChangeText={setReason}
              editable={!busy}
              multiline
              maxLength={500}
              placeholder={ask.reason === "required" ? "Recorded with the change" : "Recorded with the change, if given"}
              placeholderTextColor={colour.inkSubtle}
              style={[type.body, { minHeight: 72, padding: space.md, textAlignVertical: "top", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
            />
          </View>
        )}
        {problem && (
          <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
            <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: space.sm, minHeight: TOUCH_TARGET }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
          <Button label={ask.confirmLabel} onPress={() => void confirm()} busy={busy} disabled={needsReason} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  )
}
