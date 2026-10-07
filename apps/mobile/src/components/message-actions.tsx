import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Animated, Easing, Keyboard, Modal, Platform, Pressable, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { REACTION_EMOJI, REACTION_NAMES, receiptTime, type ThreadContactCard } from "@ovalball/contracts"

import type { ContactCardPreview } from "../messages/contact-card"
import { Check, CheckCheck, Copy, Flag, IdCard, Info, Phone, Reply, Trash2 } from "./icons"
import { TOUCH_TARGET, colour, elevation, messenger, radius, space, type } from "../design/tokens"

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
  // A SHEET WITH A TEXT FIELD (Report) RISES WITH THE KEYBOARD, so what is being typed and the button that sends it
  // are never behind it.
  const [keyboard, setKeyboard] = useState(0)
  useEffect(() => {
    if (!visible) return
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height))
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(0))
    return () => {
      show.remove()
      hide.remove()
      setKeyboard(0)
    }
  }, [visible])

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
      <Animated.View style={{ flex: 1, backgroundColor: messenger.scrim, opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: keyboard,
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl + 6,
          borderTopRightRadius: radius.xl + 6,
          paddingBottom: keyboard > 0 ? space.md : insets.bottom + space.lg,
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
  myReaction = null,
  onReact,
  onReply,
  onCopy,
  onInfo,
  preview,
}: {
  visible: boolean
  canDelete: boolean
  canReport: boolean
  busy: boolean
  problem: string | null
  onDelete: () => void
  onReport: () => void
  onClose: () => void
  /** The reader's own reaction on this message, filled in the strip so choosing it again takes it back. */
  myReaction?: string | null
  /** Present only where the reader may post in the conversation -- reacting is posting. */
  onReact?: (emoji: string) => void
  onReply?: () => void
  onCopy?: () => void
  /** My own message: when it was sent and read. */
  onInfo?: () => void
  /** The words being acted on, so the sheet says which message it is about. */
  preview?: string | null
}) {
  // DELETE ASKS ONCE, in the sheet itself: the message goes for everybody, so the second tap is the decision.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    if (!visible) setConfirmingDelete(false)
  }, [visible])
  const everyday = [
    onReply && { key: "reply", label: "Reply", icon: <Reply size={19} color={colour.forest800} strokeWidth={2} />, onPress: onReply },
    onCopy && { key: "copy", label: "Copy Text", icon: <Copy size={19} color={colour.forest800} strokeWidth={2} />, onPress: onCopy },
    onInfo && { key: "info", label: "Message Info", icon: <Info size={19} color={colour.forest800} strokeWidth={2} />, onPress: onInfo },
    canDelete && { key: "delete", label: "Delete Message", icon: <Trash2 size={19} color={colour.danger} strokeWidth={2} />, onPress: () => setConfirmingDelete(true), danger: true },
  ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; onPress: () => void; danger?: boolean }[]

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        {!!preview && (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.4} style={[type.small, { color: colour.inkMuted, paddingHorizontal: space.xs }]}>
            “{preview}”
          </Text>
        )}

        {!!problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {problem}
          </Text>
        )}

        {confirmingDelete ? (
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Delete this message for everyone?</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>It will show as deleted in the conversation.</Text>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                disabled={busy}
                onPress={() => setConfirmingDelete(false)}
                style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: pressed ? colour.chalk : colour.surface })}
              >
                <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 15 }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete"
                accessibilityState={{ busy }}
                disabled={busy}
                onPress={onDelete}
                style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colour.danger, opacity: pressed || busy ? 0.8 : 1 })}
              >
                <Text style={[type.bodyMedium, { color: colour.onForest, fontSize: 15 }]}>{busy ? "Deleting…" : "Delete"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* THE FIVE REACTIONS, in one strip the thumb reaches. The chosen one is filled, and choosing it
            again takes it back -- one reaction per person, the way every messenger already works. */}
        {!confirmingDelete && !!onReact && (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="React to this message"
            style={{ flexDirection: "row", justifyContent: "space-between", padding: 6, borderRadius: radius.pill, backgroundColor: colour.surface, ...elevation.card }}
          >
            {REACTION_EMOJI.map((emoji) => {
              const chosen = myReaction === emoji
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="radio"
                  accessibilityLabel={REACTION_NAMES[emoji] ?? emoji}
                  accessibilityState={{ checked: chosen, disabled: busy }}
                  accessibilityHint={chosen ? "Takes your reaction back" : undefined}
                  disabled={busy}
                  onPress={() => onReact(emoji)}
                  style={({ pressed }) => ({
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: chosen ? colour.mint100 : pressed ? colour.chalk : "transparent",
                    borderWidth: chosen ? 2 : 0,
                    borderColor: colour.pitch600,
                    transform: [{ scale: pressed ? 1.12 : 1 }],
                  })}
                >
                  <Text allowFontScaling={false} style={{ fontSize: 27, lineHeight: 33 }}>
                    {emoji}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}

        {!confirmingDelete && everyday.length > 0 && (
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, overflow: "hidden" }}>
            {everyday.map((action, index) => (
              <ActionRow key={action.key} label={action.label} icon={action.icon} danger={action.danger} first={index === 0} disabled={busy} onPress={action.onPress} />
            ))}
          </View>
        )}

        {/* REPORTING IS SET APART, so it is never the thing somebody taps on the way to Reply. */}
        {!confirmingDelete && canReport && (
          <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, overflow: "hidden" }}>
            <ActionRow
              label="Report Message"
              hint="A club moderator reviews it. The sender is not told who reported it."
              icon={<Flag size={19} color={colour.danger} strokeWidth={2} />}
              danger
              first
              disabled={busy}
              onPress={onReport}
            />
          </View>
        )}

        {!canDelete && !canReport && !onReact && everyday.length === 0 && (
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", paddingVertical: space.md }]}>
            There's nothing you can do with this message.
          </Text>
        )}
      </View>
    </Sheet>
  )
}

function ActionRow({
  label,
  hint,
  icon,
  danger = false,
  first,
  disabled,
  onPress,
}: {
  label: string
  hint?: string
  icon: React.ReactNode
  danger?: boolean
  first: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 8,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? colour.chalk : colour.surface,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: danger ? colour.dangerSurface : colour.mint100 }}>{icon}</View>
      {/* The hint is spoken, not printed: the Report sheet itself explains moderation, so this row stays as quiet as its neighbours. */}
      <Text style={[type.bodyMedium, { flex: 1, minWidth: 0, color: danger ? colour.danger : colour.ink, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * MESSAGE INFO -- when one of my messages was sent, and when (or by how many) it has been read.
 *
 * Only the server's own receipts, only for my own message. A group says how many have read it, never who:
 * the thread already shows who is in it, and a list of readers would be more than anybody needs to know.
 */
export function MessageInfoSheet({
  visible,
  sentAt,
  receipt,
  isGroup,
  preview,
  onClose,
}: {
  visible: boolean
  sentAt: string | null
  receipt: { readCount: number; firstReadAt: string | null } | null
  isGroup: boolean
  preview: string | null
  onClose: () => void
}) {
  const read = Boolean(receipt && receipt.readCount > 0)
  const rows = [
    { label: "Sent", value: receiptTime(sentAt) ?? "—", icon: <Check size={18} color={colour.inkSubtle} strokeWidth={2.4} /> },
    isGroup
      ? { label: "Read by", value: read ? `${receipt!.readCount} ${receipt!.readCount === 1 ? "person" : "people"}` : "Nobody yet", icon: <CheckCheck size={18} color={read ? messenger.read : colour.inkSubtle} strokeWidth={2.4} /> }
      : { label: "Read", value: read ? (receiptTime(receipt!.firstReadAt) ?? "Read") : "Not yet", icon: <CheckCheck size={18} color={read ? messenger.read : colour.inkSubtle} strokeWidth={2.4} /> },
  ]
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Message Info
        </Text>
        {!!preview && (
          <View style={{ alignSelf: "flex-end", maxWidth: "88%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: messenger.mine }}>
            <Text numberOfLines={4} style={[type.body, { color: colour.onForest, fontSize: 15 }]}>
              {preview}
            </Text>
          </View>
        )}
        <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, overflow: "hidden" }}>
          {rows.map((row, index) => (
            <View
              key={row.label}
              accessible
              accessibilityLabel={`${row.label}: ${row.value}`}
              style={{ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line }}
            >
              {row.icon}
              <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 15, flex: 1 }]}>{row.label}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{row.value}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.caption, { color: colour.inkSubtle, paddingHorizontal: space.xs }]}>
          {isGroup
            ? "Read counts the people in this conversation who have opened it since you sent this."
            : "Read means they opened the conversation after you sent this. Ovalball does not track anything else."}
        </Text>
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
  // A refusal ("say briefly what's wrong") stays only until the person starts putting it right.
  const [editedSinceProblem, setEditedSinceProblem] = useState(false)
  useEffect(() => {
    if (visible) setReason("")
  }, [visible])
  useEffect(() => {
    setEditedSinceProblem(false)
  }, [problem])

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Report Message
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          Say briefly what is wrong. A club moderator reviews it, and the sender is not told who reported it.
        </Text>
        {!!problem && !editedSinceProblem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
            {problem}
          </Text>
        )}
        <TextInput
          accessibilityLabel="What is wrong with this message"
          value={reason}
          onChangeText={(text) => {
            setReason(text)
            setEditedSinceProblem(true)
          }}
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
        backgroundColor: mine ? messenger.onMineFaint : colour.chalk,
        borderWidth: 1,
        borderColor: mine ? messenger.onMineLine : colour.line,
        gap: 2,
        maxWidth: 260,
      }}
    >
      <Text style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontSize: 10 }]}>
        Contact card
      </Text>
      <Text style={[type.smallMedium, { color: mine ? colour.onForest : colour.ink, fontSize: 13 }]}>
        {card.displayName}
      </Text>
      <Text style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontSize: 11 }]}>
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
        <Text style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontSize: 10 }]}>
          This device can't make calls. The number is above.
        </Text>
      )}
    </>
  )
}

/**
 * "REPORT SENT" -- the reporter's confirmation, quiet and brief. It says what happens next and nothing about who
 * else can see it, because nobody else is told.
 */
export function ReportedNotice({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [visible, onDone])
  if (!visible) return null
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: colour.successSurface }}>
      <Check size={15} color={colour.rugby700} strokeWidth={2.4} />
      <Text style={[type.caption, { color: colour.forest800, flex: 1 }]}>Report sent. A club moderator will review it.</Text>
    </View>
  )
}
