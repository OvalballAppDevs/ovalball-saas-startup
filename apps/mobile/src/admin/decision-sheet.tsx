import { useEffect, useState } from "react"
import { Modal, Pressable, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  isRecentAuthRefusal,
  permissionReasonRule,
  roleDefaultSentence,
  stateOf,
  type PermissionRow,
  type PermissionScope,
  type PermissionState,
} from "@ovalball/contracts/club/permissions"

import { Button } from "../components/ui"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * ONE DECISION ABOUT ONE PERMISSION (CA-M4).
 *
 * Three states, never a switch: USE ROLE DEFAULT (no decision recorded -- the role answers),
 * ALLOW, WITHHOLD. Restoring the default REMOVES the decision; it never records the opposite one.
 * The sheet says, before anything is chosen, what the role supplies and what the current decision
 * is, so the reader can see default, decision and effect as three separate facts.
 *
 * The server decides everything: the authority, the ceiling, the reason a withhold needs, the
 * team relationship and the recent authenticator. A "code first" answer goes to the step-up flow
 * exactly as the reason sheet's does.
 */
export interface DecisionAsk {
  row: PermissionRow
  scope: PermissionScope
  /** The wording the screen used for the row (the team's or the club's), so the sheet says the same thing. */
  label?: string
  description?: string
  /** Re-opened after a step-up: the choice and reason put back, with a note. */
  initialChoice?: PermissionState
  initialReason?: string
  note?: string
  /** Called with the chosen state and reason; the caller performs the canonical operation. Throws to refuse. */
  onConfirm: (choice: PermissionState, reason: string) => Promise<void>
}

const CHOICE_LABEL: Record<PermissionState, string> = { inherit: "Use Role Default", allow: "Allow", withhold: "Withhold" }
const CURRENT_LABEL: Record<PermissionState, string> = { inherit: "None", allow: "Allowed explicitly", withhold: "Withheld" }

export function DecisionSheet({
  ask,
  onClose,
  onRefused,
  onStepUp,
  errorMessage,
}: {
  ask: DecisionAsk | null
  onClose: () => void
  onRefused?: () => void
  onStepUp?: (choice: PermissionState, pendingReason: string) => void
  errorMessage: (cause: unknown) => string
}) {
  const insets = useSafeAreaInsets()
  const [choice, setChoice] = useState<PermissionState>("inherit")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setChoice(ask ? (ask.initialChoice ?? stateOf(ask.row)) : "inherit")
    setReason(ask?.initialReason ?? "")
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null
  const { row, scope } = ask
  const current = stateOf(row)
  const reasonRule = permissionReasonRule(choice === "withhold" ? "withhold" : choice === "allow" ? "allow" : "restore")
  const needsReason = reasonRule === "required" && reason.trim().length === 0
  const unchanged = choice === current
  const scopeName = scope.kind === "team" ? scope.teamName : "Club"

  async function confirm() {
    if (!ask) return
    if (unchanged) {
      onClose()
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await ask.onConfirm(choice, reason.trim())
      onClose()
    } catch (cause) {
      if (isRecentAuthRefusal(cause) && onStepUp) {
        setBusy(false)
        onStepUp(choice, reason.trim())
        return
      }
      setProblem(errorMessage(cause))
      if ((cause as { code?: string }).code === "42501") onRefused?.()
    } finally {
      setBusy(false)
    }
  }

  const choices: PermissionState[] = row.editable ? ["inherit", "allow", "withhold"] : ["inherit"]

  return (
    <Modal visible transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <Pressable accessibilityLabel="Close" onPress={busy ? undefined : onClose} style={{ flex: 1, backgroundColor: "rgba(16,21,18,0.45)" }} />
      <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }, elevation.sheet]}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          {ask.label ?? row.label}
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{ask.description ?? row.description}</Text>
        <View style={{ gap: 4 }}>
          <Fact label="Scope" value={scopeName} />
          <Fact label="Role default" value={roleDefaultSentence(row)} />
          <Fact label="Current decision" value={CURRENT_LABEL[current]} />
        </View>
        {ask.note && (
          <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
            <Text style={[type.small, { color: colour.forest800 }]}>{ask.note}</Text>
          </View>
        )}

        <View accessibilityRole="radiogroup" accessibilityLabel="Decision" style={{ gap: space.sm }}>
          {choices.map((c) => {
            const on = choice === c
            const hint = c === "inherit" ? `Currently: ${row.roleDefault ? "allowed" : "not allowed"} by their role` : c === "allow" ? (scope.kind === "team" ? `Allowed for ${scope.teamName}, whatever the role says` : "Allowed at the club, whatever the role says") : scope.kind === "team" ? `Not allowed for ${scope.teamName}; other teams are unaffected` : "Not allowed at the club"
            return (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={CHOICE_LABEL[c]}
                accessibilityHint={hint}
                onPress={() => setChoice(c)}
                disabled={busy}
                style={{ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.successSurface : colour.surface }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>{on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800 }} />}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{CHOICE_LABEL[c]}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>

        {!unchanged && (
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{reasonRule === "required" ? "Reason" : "Reason (optional)"}</Text>
            <TextInput
              accessibilityLabel="Reason"
              value={reason}
              onChangeText={setReason}
              editable={!busy}
              multiline
              maxLength={500}
              placeholder={reasonRule === "required" ? "Recorded with the decision" : "Recorded with the decision, if given"}
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
          <Button label={unchanged ? "Done" : "Save Decision"} onPress={() => void confirm()} busy={busy} disabled={needsReason || !row.editable && !unchanged} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
