import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"

import {
  ATTENDANCE_ANSWER_WORDS,
  AVAILABILITY_ANSWER_ORDER,
  SAVING_LABEL,
  answerControlLabel,
  attendanceStateShape,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"

import { ANSWER_ON_DARK, ANSWER_ON_LIGHT, AVAILABILITY_ICONS } from "../availability/presentation"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * "CAN YOU MAKE IT?" -- THE ONE AVAILABILITY CONTROL OVALBALL HAS, NATIVELY.
 *
 * This is the same control as `components/shared/availability-choice.tsx`, not a
 * lookalike. The three answers, their order, their words, their icons and their
 * semantic colours all come from `@ovalball/contracts/availability`; what this
 * file supplies is the React Native rendering of them. A matchday and a training
 * session ask a person exactly one thing, and it should not look like two
 * different products asking it -- nor like two different platforms.
 *
 * NO OPTIMISM. The displayed answer changes only after the server confirms it.
 * A failed write leaves the last true answer on screen and says why. Somebody
 * who believes they have said yes and has not is exactly the failure this
 * control exists to prevent, and on a phone -- carriage, tunnel, car park -- a
 * failed write is not a rare case. The one concession to speed is that the
 * button being written says "Saving…" while the other two stay readable, rather
 * than the whole group greying out and losing which answer was tapped.
 *
 * AUTHORITY IS NOT DECIDED HERE. `disabled` is the server's answer, resolved by
 * `get_my_players_for_fixture` / `get_my_players_for_training_session`, which
 * wrap the canonical safeguarding rule. An under-16 answering for themselves is
 * refused in the database whether or not this control was drawn.
 *
 * SELECTION IS NEVER CARRIED BY COLOUR ALONE. Each choice has its own icon, its
 * own words, a filled ground when chosen, and `accessibilityState.selected` for
 * anybody not looking at it at all.
 */

export function AvailabilityChoice({
  question,
  subject,
  what,
  committed,
  disabled,
  onChoose,
  ground = "dark",
}: {
  /** The sentence above the buttons, built by the shared `availabilityQuestion`. */
  question: string
  /** Whose answer -- "you", or a child's first name. Part of each button's accessible name. */
  subject: string
  /** What is being answered, so a screen with four children does not announce three identical buttons twelve times. */
  what: string
  committed: AvailabilityStatus | null
  disabled: boolean
  /** Resolves to true when the SERVER accepted the answer. Anything else leaves the previous one standing. */
  onChoose: (status: AvailabilityStatus) => Promise<boolean>
  /**
   * WHICH GROUND THE CONTROL IS STANDING ON.
   *
   * "dark" is inside a hero; "light" is on the chalk sheet, where the Training
   * Centre puts it. The same control, the same three answers, the same words and
   * the same order -- only the ink changes, so it stays readable on whichever
   * ground the screen chose.
   */
  ground?: "dark" | "light"
}) {
  const [pending, setPending] = useState<AvailabilityStatus | null>(null)
  const onLight = ground === "light"
  const palette = onLight ? ANSWER_ON_LIGHT : ANSWER_ON_DARK

  async function choose(status: AvailabilityStatus) {
    if (pending || disabled) return
    setPending(status)
    try {
      await onChoose(status)
    } finally {
      setPending(null)
    }
  }

  return (
    <View>
      <Text style={[type.smallMedium, { color: onLight ? colour.ink : colour.chalk }]}>{question}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={question}
        style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}
      >
        {AVAILABILITY_ANSWER_ORDER.map((status) => {
          const paint = palette[status]
          const Icon = AVAILABILITY_ICONS[attendanceStateShape(status).icon]
          const chosen = committed === status
          const saving = pending === status
          return (
            <Pressable
              key={status}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, disabled: disabled || pending !== null }}
              accessibilityLabel={answerControlLabel(status, subject, what)}
              disabled={disabled || pending !== null}
              onPress={() => void choose(status)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 72,
                alignItems: "center",
                justifyContent: "center",
                gap: space.xs + 2,
                paddingVertical: space.md,
                paddingHorizontal: space.xs,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: chosen ? paint.chosenEdge : onLight ? colour.line : "rgba(255,255,255,0.15)",
                backgroundColor: chosen ? paint.chosenWash : onLight ? colour.surface : "rgba(255,255,255,0.05)",
                opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: chosen ? paint.chosenEdge : `${paint.idle}66`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={onLight ? colour.forest800 : colour.chalk} />
                ) : (
                  <Icon size={16} color={chosen ? paint.chosenText : paint.idle} strokeWidth={chosen ? 3 : 2.25} />
                )}
              </View>
              {/* The label wraps rather than truncating: "Not Available" on a
                  320pt screen is three words of a sentence a parent is relying
                  on, not a chip. */}
              <Text
                style={[
                  type.caption,
                  {
                    textAlign: "center",
                    color: chosen ? paint.chosenText : onLight ? colour.inkMuted : "rgba(255,255,255,0.80)",
                    fontFamily: chosen ? "Inter_600SemiBold" : "Inter_500Medium",
                  },
                ]}
              >
                {saving ? SAVING_LABEL : ATTENDANCE_ANSWER_WORDS[status]}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Minimum touch target, asserted rather than assumed -- the buttons above are 72pt, comfortably over. */
export const AVAILABILITY_CHOICE_MIN_HEIGHT = Math.max(72, TOUCH_TARGET)
