import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Animated, Easing, Modal, Pressable, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ThreadContactCard } from "@ovalball/contracts"

import type { ContactCardPreview } from "../messages/contact-card"
import { IdCard, Phone } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * A SHEET THAT ASKS SOMETHING, ON A PHONE.
 *
 * Three of these, and they share one frame because the frame is the pattern: it comes up from the bottom,
 * it can be dismissed by pressing away from it, and its primary action is a full-width target. A
 * system `Alert` would have been fewer lines and would have looked like an error every time -- these are
 * decisions, not warnings.
 */
function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
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

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
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
        {children}
      </Animated.View>
    </Modal>
  )
}

function Primary({
  label,
  onPress,
  busy,
  tone = "forest",
}: {
  label: string
  onPress: () => void
  busy?: boolean
  tone?: "forest" | "danger"
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        borderRadius: radius.md,
        backgroundColor: tone === "danger" ? colour.danger : colour.forest800,
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.7 : pressed ? 0.88 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colour.onForest} /> : <Text style={[type.smallMedium, { color: colour.onForest }]}>{label}</Text>}
    </Pressable>
  )
}

/**
 * WHAT IS ABOUT TO LEAVE, BEFORE IT LEAVES.
 *
 * The telephone number comes from the account rather than from the composer, so the one thing this screen
 * owes somebody is the chance to read it. The preview is the server's own snapshot of the card -- the same
 * function the share writes from -- rather than a guess assembled here from the profile.
 */
export function ContactCardSheet({
  visible,
  card,
  problem,
  sending,
  onSend,
  onClose,
}: {
  visible: boolean
  card: ContactCardPreview | null
  problem: string | null
  sending: boolean
  onSend: () => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Share Contact Card
        </Text>

        {!!problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {problem}
          </Text>
        )}

        {!card && !problem && (
          <View style={{ paddingVertical: space.lg, alignItems: "center" }}>
            <ActivityIndicator color={colour.forest800} />
          </View>
        )}

        {!!card && (
          <>
            <View
              accessible
              accessibilityLabel={`${card.displayName}, ${card.roleLabel}, ${card.clubName}${card.teamName ? `, ${card.teamName}` : ""}, telephone ${card.telephone}`}
              style={{
                padding: space.md,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colour.line,
                backgroundColor: colour.surface,
                flexDirection: "row",
                gap: space.md,
                alignItems: "flex-start",
              }}
            >
              <IdCard size={22} color={colour.forest800} strokeWidth={1.9} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{card.displayName}</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                  {[card.roleLabel, card.clubName, card.teamName].filter(Boolean).join(" · ")}
                </Text>
                <Text style={[type.smallMedium, { color: colour.forest800, marginTop: space.xs }]}>{card.telephone}</Text>
              </View>
            </View>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              Everyone in this conversation will be able to see your telephone number.
            </Text>
            <Primary label="Share Contact Card" onPress={onSend} busy={sending} />
          </>
        )}
      </View>
    </Sheet>
  )
}

/**
 * WHAT YOU CAN DO WITH ONE MESSAGE.
 *
 * Reached by pressing and holding the bubble, which is the gesture a phone already has for this. The two
 * actions are drawn from `canDelete` and `canReport` on the canonical message -- the SERVER's answer --
 * so this sheet never offers an action that is about to be refused, and never offers "delete" on somebody
 * else's words.
 */
export function MessageActionsSheet({
  visible,
  canDelete,
  canReport,
  busy,
  problem,
  onDelete,
  onReport,
  onClose,
}: {
  visible: boolean
  canDelete: boolean
  canReport: boolean
  busy: boolean
  problem: string | null
  onDelete: () => void
  onReport: () => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        {!!problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, marginBottom: space.xs }]}>
            {problem}
          </Text>
        )}

        {canDelete && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete this message"
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={onDelete}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 6,
              justifyContent: "center",
              paddingHorizontal: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
              opacity: busy ? 0.6 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: colour.danger }]}>Delete Message</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              It stays in the conversation marked as deleted, so nobody loses the reply to it.
            </Text>
          </Pressable>
        )}

        {canReport && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report this message"
            disabled={busy}
            onPress={onReport}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 6,
              justifyContent: "center",
              paddingHorizontal: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
              opacity: busy ? 0.6 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: colour.ink }]}>Report Message</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              A club moderator reviews it. The sender is not told who reported it.
            </Text>
          </Pressable>
        )}

        {!canDelete && !canReport && (
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", paddingVertical: space.md }]}>
            There's nothing you can do with this message.
          </Text>
        )}
      </View>
    </Sheet>
  )
}

/** The reason, in the reporter's own words, because the platform requires one and a moderator needs it. */
export function ReportSheet({
  visible,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  visible: boolean
  busy: boolean
  problem: string | null
  onSubmit: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  useEffect(() => {
    if (visible) setReason("")
  }, [visible])

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Report Message
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          Say briefly what is wrong. A club moderator reviews it, and the sender is not told who reported it.
        </Text>
        {!!problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {problem}
          </Text>
        )}
        <TextInput
          accessibilityLabel="What is wrong with this message"
          value={reason}
          onChangeText={setReason}
          placeholder="What's wrong with it"
          placeholderTextColor={colour.inkSubtle}
          multiline
          selectionColor={colour.pitch600}
          style={[
            type.body,
            {
              minHeight: 88,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              backgroundColor: colour.surface,
              color: colour.ink,
              textAlignVertical: "top",
            },
          ]}
        />
        <Primary label="Send Report" onPress={() => onSubmit(reason)} busy={busy} tone="danger" />
      </View>
    </Sheet>
  )
}

/**
 * A CONTACT CARD SOMEBODY SENT, INSIDE THE BUBBLE.
 *
 * The telephone number is TAPPABLE, because a number you cannot ring is a number you have to copy out by
 * hand while standing in a car park. `tel:` is the phone's own dialler; nothing is dialled without the
 * person confirming it, which is the platform's behaviour rather than this app's choice.
 */
export function ContactCardBubble({ card, mine }: { card: ThreadContactCard; mine: boolean }) {
  return (
    <View
      style={{
        marginTop: space.xs,
        padding: space.sm + 2,
        borderRadius: radius.md,
        backgroundColor: mine ? "rgba(255,255,255,0.16)" : colour.chalk,
        borderWidth: 1,
        borderColor: mine ? "rgba(255,255,255,0.22)" : colour.line,
        gap: 2,
        maxWidth: 260,
      }}
    >
      <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.8)" : colour.inkMuted, fontSize: 10 }]}>
        Contact card
      </Text>
      <Text style={[type.smallMedium, { color: mine ? colour.onForest : colour.ink, fontSize: 13 }]}>
        {card.displayName}
      </Text>
      <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.8)" : colour.inkMuted, fontSize: 11 }]}>
        {[card.roleLabel, card.clubName, card.teamName].filter(Boolean).join(" · ")}
      </Text>
      <Dial telephone={card.telephone} mine={mine} />
    </View>
  )
}

function Dial({ telephone, mine }: { telephone: string; mine: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Call ${telephone}`}
        onPress={async () => {
          const { openURL, canOpenURL } = await import("expo-linking")
          const url = `tel:${telephone.replace(/[^\d+]/g, "")}`
          // A simulator and a tablet have no dialler, and a button that silently does nothing there is
          // indistinguishable from a broken one.
          if (!(await canOpenURL(url))) {
            setFailed(true)
            return
          }
          await openURL(url)
        }}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Phone size={15} color={mine ? colour.onForest : colour.forest800} strokeWidth={2} />
        <Text style={[type.smallMedium, { color: mine ? colour.onForest : colour.forest800, fontSize: 13 }]}>
          {telephone}
        </Text>
      </Pressable>
      {failed && (
        <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.85)" : colour.inkMuted, fontSize: 10 }]}>
          This device can't make calls. The number is above.
        </Text>
      )}
    </>
  )
}
