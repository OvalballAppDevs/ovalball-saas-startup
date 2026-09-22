import { useState } from "react"
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../auth/supabase"
import { announceToSquad, type AnnounceAudience, type AudienceCounts } from "../match-centre/announce"
import { Megaphone, X } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * ANNOUNCING TO THE SQUAD.
 *
 * NOT THE SAME AS POSTING IN THE THREAD, and deliberately not merged with it.
 * A message in the conversation reaches whoever comes and reads it; an
 * announcement is a NOTIFICATION delivered through the safeguarding-aware
 * recipient model, so it reaches a guardian who never opens the app. That
 * distinction is the whole reason this control exists, and the sheet says so in
 * the same words the website uses.
 *
 * ONE COMPOSER, AUDIENCE AS A CHOICE INSIDE IT -- the shape the web settled on
 * after a second audience needed a second card. Adding an audience later is a
 * row in a list rather than another surface.
 *
 * THE COUNTS ARE THE SERVER'S, AND NULL IS NOT ZERO. An audience whose count is
 * null is one this viewer is not entitled to a figure for, so the option is not
 * offered at all rather than being offered with a confident zero beside it.
 *
 * A BOTTOM SHEET RATHER THAN A DISCLOSURE, which is the one native difference
 * from the web's inline `<details>`: a multi-line text field inside a long
 * ScrollView fights the keyboard and the scroll position on a phone. The sheet
 * lifts above the keyboard and has one job.
 */

const MAX = 2000

export function AnnounceSheet({
  fixtureId,
  counts,
  onClose,
}: {
  fixtureId: string
  counts: AudienceCounts
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const options: { action: AnnounceAudience; label: string; describe: string }[] = [
    counts.team !== null
      ? { action: "MESSAGE_TEAM" as const, label: "Whole team", describe: `${counts.team} ${counts.team === 1 ? "player" : "players"} in this fixture` }
      : null,
    counts.attending !== null
      ? {
          action: "MESSAGE_ATTENDEES" as const,
          label: "Attending",
          describe: `${counts.attending} attending ${counts.attending === 1 ? "player" : "players"}`,
        }
      : null,
  ].filter((o): o is { action: AnnounceAudience; label: string; describe: string } => o !== null)

  const [audience, setAudience] = useState<AnnounceAudience>(options[0]?.action ?? "MESSAGE_TEAM")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  async function send() {
    setProblem(null)
    setSending(true)
    const result = await announceToSquad(supabase, fixtureId, audience, body)
    setSending(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    // The confirmation names WHO was reached, because "sent" on its own leaves
    // somebody wondering whether it went to the people they meant.
    setSent(result.reached === null ? "Announcement sent." : `Announcement sent to ${result.reached} ${result.reached === 1 ? "person" : "people"}.`)
    setBody("")
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={sending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          style={[
            {
              backgroundColor: colour.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: space.lg,
              paddingBottom: insets.bottom + space.lg,
              paddingHorizontal: space.lg,
              gap: space.md,
              maxHeight: "88%",
            },
            elevation.sheet,
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Megaphone size={18} color={colour.forest800} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Announce to the Squad
              </Text>
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Notifies families, not just this thread</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              disabled={sending}
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => ({
                width: TOUCH_TARGET,
                height: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed || sending ? 0.5 : 1,
              })}
            >
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
            {sent ? (
              <Text accessibilityRole="alert" style={[type.small, { color: colour.forest800 }]}>
                {sent}
              </Text>
            ) : null}
            {problem ? (
              <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
                {problem}
              </Text>
            ) : null}

            <View accessibilityRole="radiogroup" accessibilityLabel="Who to send this to" style={{ gap: space.sm }}>
              {options.map((option) => {
                const selected = audience === option.action
                return (
                  <Pressable
                    key={option.action}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label}, ${option.describe}`}
                    onPress={() => setAudience(option.action)}
                    style={({ pressed }) => ({
                      minHeight: TOUCH_TARGET,
                      justifyContent: "center",
                      paddingHorizontal: space.lg,
                      paddingVertical: space.sm,
                      borderRadius: radius.md,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? colour.forest800 : colour.line,
                      backgroundColor: pressed ? colour.chalk : selected ? "rgba(18,61,44,0.05)" : colour.surface,
                    })}
                  >
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{option.label}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{option.describe}</Text>
                  </Pressable>
                )
              })}
            </View>

            <View>
              <TextInput
                accessibilityLabel="Your announcement"
                multiline
                editable={!sending}
                value={body}
                onChangeText={(next) => setBody(next.slice(0, MAX))}
                placeholder="What do they need to know?"
                placeholderTextColor={colour.inkSubtle}
                style={[
                  type.body,
                  {
                    minHeight: 110,
                    color: colour.ink,
                    padding: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colour.line,
                    backgroundColor: colour.chalk,
                    textAlignVertical: "top",
                  },
                ]}
              />
              <Text style={[type.caption, { color: colour.inkSubtle, marginTop: space.xs, textAlign: "right" }]}>
                {body.trim().length}/{MAX}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send announcement"
              accessibilityState={{ disabled: sending || body.trim().length === 0 }}
              disabled={sending || body.trim().length === 0}
              onPress={() => void send()}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET + 4,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: space.sm,
                borderRadius: radius.md,
                backgroundColor: colour.forest800,
                opacity: sending || body.trim().length === 0 ? 0.5 : pressed ? 0.88 : 1,
              })}
            >
              {sending && <ActivityIndicator size="small" color={colour.onForest} />}
              <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Send Announcement</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
