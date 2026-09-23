import { Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { HeaderUtilities } from "../header-utilities"
import { ChevronLeft, ChevronRight } from "../icons"
import { useAppContexts } from "../../context/contexts"
import { TOUCH_TARGET, colour, onForest, radius, space, statusOnForest, surface, type } from "../../design/tokens"

/**
 * A PARTICIPANT EVENT, AT THE TOP OF ITS OWN SCREEN.
 *
 * "This is my child's session", not "this is the database record for it". A forest
 * hero carrying what the event IS -- whose side, what kind of thing, what state it
 * is in -- and then the facts a parent actually came for: when, when to arrive,
 * and where.
 *
 * NO STOCK PHOTOGRAPH. The reference design has one, and Ovalball has no
 * legitimate picture of a real club's training session to put there. A borrowed
 * photograph of somebody else's rugby on a page about your child is worse than no
 * photograph, so the hero is the brand's own ground with the event's mark on it --
 * which is also the treatment that works for every club, including the ones whose
 * pictures nobody has taken.
 *
 * THE SHELL IS THE SHELL. Back on the left, the surface's name in the middle, and
 * the same three utilities from the same canonical unread read on the right -- on
 * forest, so the screen is one surface from the status bar down to the sheet.
 */
export function EventHero({
  surfaceName,
  title,
  eyebrow,
  status,
  mark,
  facts,
  onBack,
}: {
  /** What this screen is -- "Training Centre". */
  surfaceName: string
  /** What this event is -- "Training Session". */
  title: string
  /** Whose it is: the side, and the child where a family is reading. */
  eyebrow: string
  /** The canonical state in the canonical words. Null where it is simply going ahead. */
  status?: { label: string; tone: "calm" | "warning" | "danger" } | null
  mark: React.ReactNode
  facts: { icon: React.ReactNode; label: string; detail?: string | null; onPress?: () => void }[]
  onBack: () => void
}) {
  const insets = useSafeAreaInsets()
  const { unread } = useAppContexts()

  // The shared state tones, measured against forest. Never colour alone: the
  // pill always carries the state's own canonical word.
  const statusPaint = statusOnForest[status?.tone ?? "calm"]

  return (
    <View style={{ backgroundColor: surface.forest, paddingTop: insets.top + space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.pill,
            backgroundColor: pressed ? "rgba(255,255,255,0.10)" : "transparent",
          })}
        >
          <ChevronLeft size={22} color={onForest.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={[type.smallMedium, { color: onForest.primary, flex: 1, fontSize: 15 }]} numberOfLines={1}>
          {surfaceName}
        </Text>
        <HeaderUtilities unread={unread} tone="forest" />
      </View>

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View
            accessible={false}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: "rgba(90,203,131,0.20)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {mark}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.small, { color: onForest.secondary }]} numberOfLines={1}>
              {eyebrow}
            </Text>
            <Text accessibilityRole="header" style={[type.title, { color: onForest.primary, fontSize: 25 }]}>
              {title}
            </Text>
          </View>
          {!!status && (
            <View
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 5,
                borderRadius: radius.pill,
                backgroundColor: statusPaint.ground,
              }}
            >
              <Text style={[type.caption, { color: statusPaint.ink }]}>{status.label}</Text>
            </View>
          )}
        </View>

        <View style={{ gap: space.sm }}>
          {facts.map((fact) => (
            <Fact key={fact.label} {...fact} />
          ))}
        </View>
      </View>
    </View>
  )
}

function Fact({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  detail?: string | null
  onPress?: () => void
}) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: onForest.primary, fontSize: 14 }]} numberOfLines={2}>
          {label}
        </Text>
        {!!detail && (
          <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {!!onPress && <ChevronRight size={16} color={onForest.secondary} />}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET - 8, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  )
}

/**
 * A FULL-WIDTH THING A PARTICIPANT CAN DO OR READ.
 *
 * An icon, what it is, one line saying why, and a chevron where it goes somewhere.
 * Deliberately uniform: a screen of cards that all look alike is one a person can
 * scan, and the moment one of them is a different shape it reads as the important
 * one whether or not it is.
 *
 * THERE IS NO ADMINISTRATIVE VARIANT. Nothing here edits, cancels, moves or
 * manages anybody -- those controls live in a component a participant's screen
 * never mounts at all.
 */
export function ParticipantActionCard({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: React.ReactNode
  title: string
  detail?: string
  onPress?: () => void
}) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View
        accessible={false}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colour.mint100,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>{title}</Text>
        {!!detail && (
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]} numberOfLines={2}>
            {detail}
          </Text>
        )}
      </View>
      {!!onPress && <ChevronRight size={18} color={colour.inkSubtle} />}
    </View>
  )

  const frame = {
    minHeight: TOUCH_TARGET + 18,
    justifyContent: "center" as const,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colour.line,
    backgroundColor: surface.card,
  }

  if (!onPress) return <View style={frame}>{body}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(". ")}
      onPress={onPress}
      style={({ pressed }) => ({ ...frame, backgroundColor: pressed ? colour.chalk : surface.card })}
    >
      {body}
    </Pressable>
  )
}

/**
 * The chalk sheet a participant event's content sits on — the same panel the
 * Calendar uses, so the two screens are visibly one product.
 */
export function ParticipantSheet({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: surface.chalk,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        marginTop: -14,
        paddingTop: space.sm,
      }}
    >
      <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colour.line }} />
      {children}
    </View>
  )
}
