import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { DateField, TextField, TimeField } from "./form"
import { Check, ChevronRight } from "./icons"
import { useReduceMotion } from "../a11y/reduce-motion"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * CHANGING ONE FACT ABOUT A FIXTURE.
 *
 * ONE SHEET, ONE FIELD, ONE EXPLICIT SAVE. That is the model, and it is chosen rather than inherited:
 * the alternative -- a form where some fields save on change and others wait for a global Save -- is
 * the one where a manager cannot tell whether the kick-off they just moved is actually moved.
 *
 * THE CONSOLE STAYS CLEAN BECAUSE THE EDITOR IS NOT ON IT. Permanent text fields everywhere would turn
 * a screen somebody reads in a car park into an admin form. The displayed value IS the control: tap the
 * kick-off, a sheet comes up with the system time picker in it, save, and the console shows the new
 * time.
 *
 * NOTHING IS SAVED OPTIMISTICALLY. The canonical mutation answers first, and only then does the console
 * re-read. A fixture that appeared to move and did not is worse than one that took a moment.
 */

/**
 * The sheet itself, for a screen whose one decision is not a fixture field (a membership's name, price and
 * teams): the same keyboard-aware rise, the same Cancel beside one explicit Save.
 */
export function Sheet({
  visible,
  title,
  hint,
  onClose,
  children,
  onSave,
  saving,
  problem,
  saveLabel = "Save",
  canSave = true,
  dismissLabel = "Cancel",
  destructive = false,
  brand = false,
}: {
  visible: boolean
  title: string
  hint?: string
  onClose: () => void
  children: React.ReactNode
  onSave: () => void
  saving: boolean
  problem: string | null
  saveLabel?: string
  canSave?: boolean
  /**
   * The words on the way out. "Cancel" beside "Cancel Event" asks a person to guess which one cancels the
   * event, so a destructive sheet names the safe choice for what it keeps ("Keep Event").
   */
  dismissLabel?: string
  /** A step that cannot be undone wears the restrained danger treatment, never the everyday forest fill. */
  destructive?: boolean
  /** The Club Memberships surfaces' primary green (Button's `brand`), so a membership sheet matches its screen. */
  brand?: boolean
}) {
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(500)).current
  const backdrop = useRef(new Animated.Value(0)).current
  // REDUCE MOTION is honoured here, once, for every sheet built on this: the sheet is simply there.
  const reduceMotion = useReduceMotion()

  useEffect(() => {
    if (!visible) return
    if (reduceMotion) {
      translate.setValue(0)
      backdrop.setValue(1)
      return
    }
    translate.setValue(500)
    Animated.parallel([
      Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [visible, translate, backdrop, reduceMotion])

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close without saving" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>

      {/* A SHEET WITH A FIELD RISES WITH THE KEYBOARD. Without this the keyboard covered the very field being
          typed into and the button that saves it -- a cancellation reason, a postponement note, a typed pitch. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end" }}
      >
      <Animated.View
        style={{
          maxHeight: "85%",
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

        <View style={{ padding: space.lg, gap: space.md }}>
          <View>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {title}
            </Text>
            {!!hint && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{hint}</Text>}
          </View>

          {!!problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {problem}
            </Text>
          )}

          {children}

          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dismissLabel}
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colour.lineStrong,
                backgroundColor: colour.surface,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: colour.ink }]}>{dismissLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saveLabel}
              accessibilityState={{ busy: saving, disabled: !canSave }}
              disabled={saving || !canSave}
              onPress={onSave}
              style={({ pressed }) => ({
                flex: 2,
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                borderWidth: destructive ? 1 : 0,
                borderColor: destructive ? colour.danger : "transparent",
                backgroundColor: !canSave ? colour.lineStrong : destructive ? colour.dangerSurface : brand ? colour.rugby700 : colour.forest800,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              {saving ? (
                <ActivityIndicator color={destructive ? colour.danger : colour.onForest} />
              ) : (
                <Text style={[type.smallMedium, { color: destructive && canSave ? colour.danger : colour.onForest }]}>{saveLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function DateSheet({
  visible,
  value,
  onClose,
  onSave,
  saving,
  problem,
}: {
  visible: boolean
  value: string
  onClose: () => void
  onSave: (iso: string) => void
  saving: boolean
  problem: string | null
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (visible) setDraft(value)
  }, [visible, value])

  return (
    <Sheet
      visible={visible}
      title="Date"
      hint="Moving a two-sided fixture tells the other club."
      onClose={onClose}
      onSave={() => onSave(draft)}
      saving={saving}
      problem={problem}
      canSave={draft !== value}
    >
      <DateField label="Fixture date" value={draft} onChange={setDraft} />
    </Sheet>
  )
}

export function TimeSheet({
  visible,
  title,
  hint,
  value,
  onClose,
  onSave,
  saving,
  problem,
}: {
  visible: boolean
  title: string
  hint?: string
  value: string | null
  onClose: () => void
  onSave: (time: string | null) => void
  saving: boolean
  problem: string | null
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (visible) setDraft(value)
  }, [visible, value])

  return (
    <Sheet
      visible={visible}
      title={title}
      hint={hint}
      onClose={onClose}
      onSave={() => onSave(draft)}
      saving={saving}
      problem={problem}
      canSave={draft !== value}
    >
      <TimeField label={title} value={draft} onChange={setDraft} />
    </Sheet>
  )
}

/**
 * A GROUND, OR A PITCH AT ONE.
 *
 * A LIST OF WHAT EXISTS, not a text box. The club's grounds and its playing areas are canonical
 * records; typing a ground name would create a second, private universe of venues that no other
 * surface knows about.
 *
 * "NOT SET" IS A REAL CHOICE and is offered, because a fixture whose ground is not agreed yet is a
 * normal state and forcing a guess would record something untrue.
 */
export function ChoiceSheet({
  visible,
  title,
  hint,
  options,
  value,
  emptyMessage,
  onClose,
  onSave,
  saving,
  problem,
  noneLabel = "Not set",
}: {
  visible: boolean
  title: string
  hint?: string
  options: { id: string; name: string; detail?: string | null }[]
  value: string | null
  emptyMessage: string
  onClose: () => void
  onSave: (id: string | null) => void
  saving: boolean
  problem: string | null
  /** What choosing nothing means here -- "Not set" unless the screen has a truer word for it ("Same as club default"). */
  noneLabel?: string
}) {
  const [draft, setDraft] = useState<string | null>(value)
  // The list scrolls inside the sheet, sized to the screen: a fixed height hid the last choices behind Save.
  const { height } = useWindowDimensions()
  useEffect(() => {
    if (visible) setDraft(value)
  }, [visible, value])

  return (
    <Sheet
      visible={visible}
      title={title}
      hint={hint}
      onClose={onClose}
      onSave={() => onSave(draft)}
      saving={saving}
      problem={problem}
      canSave={draft !== value}
    >
      {options.length === 0 ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>{emptyMessage}</Text>
      ) : (
        <ScrollView style={{ maxHeight: Math.max(280, Math.round(height * 0.5)) }} contentContainerStyle={{ gap: 0 }}>
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {[{ id: "", name: noneLabel, detail: null }, ...options].map((option, index) => {
              const id = option.id || null
              const selected = draft === id
              return (
                <Pressable
                  key={option.id || "none"}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.name}
                  onPress={() => setDraft(id)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET + 6,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? "rgba(16,21,18,0.03)" : selected ? colour.mint100 : "transparent",
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.smallMedium, { color: option.id ? colour.ink : colour.inkMuted }]}>
                      {option.name}
                    </Text>
                    {!!option.detail && (
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                        {option.detail}
                      </Text>
                    )}
                  </View>
                  {selected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      )}
    </Sheet>
  )
}

/** Free text, for the one field that legitimately is: a pitch at a ground Ovalball has no record of. */
export function TextSheet({
  visible,
  title,
  hint,
  placeholder,
  value,
  multiline,
  onClose,
  onSave,
  saving,
  problem,
}: {
  visible: boolean
  title: string
  hint?: string
  placeholder?: string
  value: string
  multiline?: boolean
  onClose: () => void
  onSave: (next: string) => void
  saving: boolean
  problem: string | null
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (visible) setDraft(value)
  }, [visible, value])

  return (
    <Sheet
      visible={visible}
      title={title}
      hint={hint}
      onClose={onClose}
      onSave={() => onSave(draft)}
      saving={saving}
      problem={problem}
      canSave={draft.trim() !== value.trim()}
    >
      <TextField label={title} value={draft} onChange={setDraft} placeholder={placeholder} multiline={multiline} />
    </Sheet>
  )
}

/**
 * CANCELLING, WHICH IS THE ONE ACTION THAT ASKS TWICE.
 *
 * The sheet names the fixture in full -- both sides, the date, the kick-off -- because the whole point
 * of a confirmation is to give somebody the chance to notice they are cancelling the wrong one. A
 * dialogue that says "Are you sure?" gives them nothing to check against.
 *
 * The reason is required by `cancel_fixture` itself, and it is the useful part: it reaches the other
 * club and the players, who otherwise learn only that something is off.
 */
/**
 * `kind` picks the copy: a FIXTURE cancellation involves another club and a result that never
 * happens, so it says so; a TRAINING SESSION cancellation is entirely this club's own, one-off
 * occurrence, and never touches the rest of that team's recurring plan -- confusing the two here
 * would tell a coach cancelling next Tuesday's training that "the other club" will see the reason,
 * which is simply untrue. Defaults to "fixture" so the existing fixture caller is unaffected.
 */
export function CancelSheet({
  visible,
  summary,
  kind = "fixture",
  onClose,
  onConfirm,
  saving,
  problem,
}: {
  visible: boolean
  summary: { teams: string; when: string }
  /**
   * An EVENT is cancelled or postponed through the same sheet: the same summary to check against, the same
   * action-named button. Its reason is optional, as `cancel_club_event` and `postpone_event` allow -- a
   * fixture's is required because `cancel_fixture` requires it.
   */
  kind?: "fixture" | "training" | "event" | "event_postpone"
  onClose: () => void
  onConfirm: (reason: string) => void
  saving: boolean
  problem: string | null
}) {
  const [reason, setReason] = useState("")
  useEffect(() => {
    if (visible) setReason("")
  }, [visible])

  const copy =
    kind === "training"
      ? {
          title: "Cancel this training session?",
          saveLabel: "Cancel Session",
          keepLabel: "Keep Session",
          body: "You are cancelling this training session only. The rest of the training plan will continue -- other sessions are not affected. The squad will see the reason, and this session stays in the calendar marked cancelled rather than being deleted.",
          field: "Why it is cancelled",
          placeholder: "Waterlogged pitch, failed inspection",
          required: true,
        }
      : kind === "event"
        ? {
            title: "Cancel this event?",
            saveLabel: "Cancel Event",
            keepLabel: "Keep Event",
            body: "Everybody invited is told it is not going ahead, with your reason if you give one. It stays in the calendar marked cancelled. This cannot be undone.",
            field: "Why it is cancelled",
            placeholder: "Not enough people could come",
            required: false,
          }
        : kind === "event_postpone"
          ? {
              title: "Postpone this event?",
              saveLabel: "Postpone Event",
              keepLabel: "Keep the Date",
              body: "Everybody invited is told it is postponed, with your note if you give one. Their answers are kept for the new date.",
              field: "Note for everybody invited",
              placeholder: "The venue is unavailable; a new date will follow",
              required: false,
            }
          : {
              title: "Cancel this fixture?",
              saveLabel: "Cancel Fixture",
              keepLabel: "Keep Fixture",
              body: "The other club and everyone who was going to play will see the reason. The fixture stays in the calendar marked cancelled, so nobody turns up — it is not deleted.",
              field: "Why it is cancelled",
              placeholder: "Waterlogged pitch, failed inspection",
              required: true,
            }

  return (
    <Sheet
      visible={visible}
      title={copy.title}
      onClose={onClose}
      onSave={() => onConfirm(reason)}
      saving={saving}
      problem={problem}
      saveLabel={copy.saveLabel}
      canSave={!copy.required || reason.trim().length > 0}
      dismissLabel={copy.keepLabel}
      destructive={kind !== "event_postpone"}
    >
      <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, gap: 2 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{summary.teams}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{summary.when}</Text>
      </View>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{copy.body}</Text>
      <TextField label={copy.field} value={reason} onChange={setReason} multiline placeholder={copy.placeholder} />
    </Sheet>
  )
}
