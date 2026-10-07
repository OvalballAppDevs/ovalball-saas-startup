import { useEffect, useRef, type ReactNode } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { OvalballDetailHeader } from "../components/app-header"
import { PhotoBottomShade } from "../components/photo-gradient"
import { Check, ChevronRight } from "../components/icons"
import { tabBarHeight } from "../navigation/tab-bar-height"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, font, radius, space, type } from "../design/tokens"

/**
 * THE PEOPLE KIT -- the few shapes every People & Invitations screen is built from, so Add to Club, Add
 * Players, Add Staff Members, the invitation, Access Control and Member Details read as one product.
 *
 *   FlowScreen   the forest detail header, a chalk canvas, keyboard-aware scrolling, an optional footer
 *   PhotoHero    a reviewed rugby photograph under the header, its words on the photograph's own shade
 *   ActionGroup  white rows sharing one card: a mint icon tile, a title, one line, a chevron
 *   Tabs         an underline tab strip (a tablist, each a tab with its selected state)
 *   ChoiceRow    a checkable or single-choice row with a description; the role and state are announced
 *   Steps        the invitation's real sequence, "Step 2 of 3" in words as well as marks
 */

export function FlowScreen({
  title,
  children,
  footer,
  onBack,
  scrollKey,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onBack?: () => void
  /** A flow whose steps share this screen passes its step: a new step starts at its top, not where the last one was left. */
  scrollKey?: string | number | null
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scroller = useRef<ScrollView>(null)
  useEffect(() => {
    if (scrollKey !== undefined) scroller.current?.scrollTo({ y: 0, animated: false })
  }, [scrollKey])
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.dismissTo("/")))
  // AT LARGE TEXT SIZES the footer joins the end of the page: pinned, its buttons alone took nearly half the
  // screen and left the page itself a strip to read through.
  const { fontScale } = useWindowDimensions()
  const inline = !!footer && fontScale > LARGE_TEXT_SCALE
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={title} onBack={back} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: (footer ? space.lg : tabBarHeight(insets.bottom) + space.lg) }}
        >
          {children}
          {inline && <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>{footer}</View>}
        </ScrollView>
        {footer && !inline && (
          // The bottom navigation sits below the screen here, not over it, so the footer needs no room for it.
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, backgroundColor: colour.chalk, borderTopWidth: 1, borderTopColor: colour.line }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}

/** The page's padded body, under a hero or straight under the header. */
export function Body({ children, gap = space.xl }: { children: ReactNode; gap?: number }) {
  return <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl, gap }}>{children}</View>
}

export function PhotoHero({ image, title, body, height = 210 }: { image: number; title: string; body: string; height?: number }) {
  return (
    <View style={{ minHeight: height, backgroundColor: colour.forest900, overflow: "hidden" }}>
      <Image source={image} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade strength={0.9} />
      <View style={{ flex: 1, minHeight: height, justifyContent: "flex-end", padding: space.lg, gap: space.xs }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 36, letterSpacing: 0.5, color: "#fff" }}>{title}</Text>
        <Text style={[type.body, { color: "rgba(255,255,255,0.88)" }]}>{body}</Text>
      </View>
    </View>
  )
}

/** The inset photographic card (Add to Club's "People make rugby happen."). */
export function PhotoCard({ image, title, body }: { image: number; title: string; body: string }) {
  return (
    <View accessible accessibilityLabel={`${title} ${body}`} style={{ minHeight: 220, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest900 }}>
      <Image source={image} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade strength={0.92} />
      <View style={{ flex: 1, minHeight: 220, justifyContent: "flex-end", padding: space.lg, gap: space.xs }}>
        <Text style={{ fontFamily: font.display, fontSize: 30, lineHeight: 32, letterSpacing: 0.4, color: "#fff" }}>{title}</Text>
        <Text style={[type.small, { color: "rgba(255,255,255,0.88)" }]}>{body}</Text>
      </View>
    </View>
  )
}

export function ActionGroup({ children }: { children: ReactNode }) {
  return <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>{children}</View>
}

export function IconTile({ children, tone = "mint" }: { children: ReactNode; tone?: "mint" | "forest" | "amber" }) {
  const bg = tone === "forest" ? colour.forest800 : tone === "amber" ? colour.warningSurface : colour.mint100
  return <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>{children}</View>
}

export function ActionRow({
  icon,
  title,
  caption,
  onPress,
  first = false,
  trailing,
  detail,
  disabled = false,
  accessibilityHint,
}: {
  icon: ReactNode
  title: string
  caption?: string | null
  onPress?: () => void
  first?: boolean
  /** Replaces the chevron: an expander's own arrow, a switch. */
  trailing?: ReactNode
  /** A short value beside the chevron ("2 people"), read out with the row. */
  detail?: string | null
  disabled?: boolean
  accessibilityHint?: string
}) {
  const pressable = !!onPress && !disabled
  return (
    <Pressable
      accessibilityRole={pressable ? "button" : undefined}
      accessibilityLabel={[title, caption, detail].filter(Boolean).map((part) => String(part).replace(/\.$/, "")).join(". ")}
      accessibilityHint={accessibilityHint}
      accessibilityState={pressable ? undefined : { disabled: true }}
      disabled={!pressable}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <IconTile>{icon}</IconTile>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{title}</Text>
        {!!caption && <Text style={[type.small, { color: colour.inkMuted }]}>{caption}</Text>}
      </View>
      {!!detail && <Text style={[type.small, { color: colour.inkMuted }]}>{detail}</Text>}
      {trailing ?? (pressable ? <ChevronRight size={18} color={colour.inkSubtle} /> : null)}
    </Pressable>
  )
}

export function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink, flexShrink: 1 }]}>{title}</Text>
        {action}
      </View>
      {!!detail && <Text style={[type.small, { color: colour.inkMuted }]}>{detail}</Text>}
    </View>
  )
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colour.line }}>
      {tabs.map((t) => {
        const on = t.key === value
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            onPress={() => onChange(t.key)}
            style={{ flex: 1, minHeight: TOUCH_TARGET, paddingHorizontal: space.xs, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: on ? colour.pitch600 : "transparent", marginBottom: -1 }}
          >
            <Text style={[type.smallMedium, { color: on ? colour.forest800 : colour.inkMuted, fontFamily: on ? font.bodySemi : font.bodyMedium, textAlign: "center" }]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * A ROW THAT IS CHOSEN: a checkbox for a list where several may be chosen, a radio where exactly one is.
 * The label and the description are read together; the state is announced, never only drawn.
 */
export function ChoiceRow({
  kind,
  checked,
  label,
  description,
  onPress,
  disabled = false,
  suffix,
  describeInLabel = false,
  children,
}: {
  /** "link": a row that takes the person on (choosing a club to refer), not a choice that stays ticked. */
  kind: "checkbox" | "radio" | "link"
  checked: boolean
  label: string
  description?: string | null
  onPress: () => void
  disabled?: boolean
  suffix?: string
  /**
   * Read the description as part of the label, not as a hint. For a choice whose consequence IS the choice (who
   * pays a fee, what a family is charged): VoiceOver users who turn hints off still hear it.
   */
  describeInLabel?: boolean
  children?: ReactNode
}) {
  const named = `${label}${suffix ? `, ${suffix}` : ""}`
  return (
    <View>
      <Pressable
        accessibilityRole={kind === "link" ? "button" : kind}
        accessibilityState={kind === "link" ? { disabled } : { checked, disabled }}
        accessibilityLabel={describeInLabel && description ? `${named}. ${description}` : named}
        accessibilityHint={describeInLabel ? undefined : (description ?? undefined)}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET + 12,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.md,
          paddingVertical: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: checked ? colour.forest800 : colour.line,
          backgroundColor: checked ? "rgba(18,61,44,0.06)" : colour.surface,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        })}
      >
        {kind === "link" ? null : kind === "checkbox" ? (
          <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? colour.forest800 : colour.lineStrong, backgroundColor: checked ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
            {checked && <Check size={15} color={colour.onForest} strokeWidth={3} />}
          </View>
        ) : (
          <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: 11, borderWidth: 1.5, borderColor: checked ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
            {checked && <View style={{ width: 11, height: 11, borderRadius: 5.5, backgroundColor: colour.forest800 }} />}
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.bodyMedium, { color: disabled ? colour.inkSubtle : colour.ink }]}>{label}{suffix ? <Text style={{ color: colour.inkMuted }}>{`  ${suffix}`}</Text> : null}</Text>
          {!!description && <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>{description}</Text>}
        </View>
        {kind === "link" && <View style={{ alignSelf: "center" }}><ChevronRight size={18} color={colour.inkSubtle} /></View>}
      </Pressable>
      {children}
    </View>
  )
}

/** The invitation's sequence, in marks and in words. Only steps that actually apply are counted. */
/**
 * `done`, when given, is each step's REAL completion (the server's readiness), so a step the person has passed but
 * not finished keeps its number instead of a tick. Without it, every step before the current one counts as done.
 */
export function Steps({ labels, current, done: completed }: { labels: string[]; current: number; done?: boolean[] }) {
  // AT LARGE TEXT SIZES four labels cannot sit side by side on a phone, so the row keeps its dots and says
  // the one step that matters in a single line beneath them.
  const { fontScale } = useWindowDimensions()
  const oneLine = fontScale > LARGE_TEXT_SCALE
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${labels.length}: ${labels[current]}`} style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {labels.map((label, i) => {
          const done = completed ? completed[i] === true && i !== current : i < current
          const on = i === current
          return (
            <View key={label} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch" }}>
                <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : i <= current ? colour.forest800 : colour.line }} />
                <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: on || done ? colour.forest800 : colour.surface, borderWidth: 1.5, borderColor: on || done ? colour.forest800 : colour.lineStrong }}>
                  {/* The numeral is sized to its circle, which does not grow. */}
                  {done ? <Check size={15} color={colour.onForest} strokeWidth={3} /> : <Text allowFontScaling={false} style={[type.smallMedium, { color: on ? colour.onForest : colour.inkMuted }]}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1, height: 2, backgroundColor: i === labels.length - 1 ? "transparent" : i < current ? colour.forest800 : colour.line }} />
              </View>
              {/* A LONG LABEL SHRINKS A LITTLE RATHER THAN LOSING ITS END: five steps on a phone leave "Memberships"
                  a few points short of its column, and "Membershi…" names nothing. */}
              {!oneLine && <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[type.caption, { color: on ? colour.forest800 : colour.inkMuted, fontFamily: on ? font.bodySemi : font.body }]}>{label}</Text>}
            </View>
          )
        })}
      </View>
      {oneLine && <Text style={[type.small, { color: colour.forest800, fontFamily: font.bodySemi }]}>{`Step ${current + 1} of ${labels.length}: ${labels[current]}`}</Text>}
    </View>
  )
}

/**
 * TWO OR MORE BUTTONS SIDE BY SIDE -- secondary first, primary last -- that STACK at large text sizes,
 * primary on top, rather than splitting "More Actions" into "Actio / ns". `weights` sizes them in a row.
 */
export function ButtonRow({ children, weights }: { children: ReactNode[]; weights?: number[] }) {
  const { fontScale } = useWindowDimensions()
  const items = children.filter(Boolean)
  if (fontScale > LARGE_TEXT_SCALE) {
    return <View style={{ gap: space.sm }}>{[...items].reverse().map((child, i) => <View key={i}>{child}</View>)}</View>
  }
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {items.map((child, i) => (
        <View key={i} style={{ flex: weights?.[i] ?? 1 }}>
          {child}
        </View>
      ))}
    </View>
  )
}

/** A quiet line of guidance -- the one sentence a screen needs, never a paragraph. */
export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "danger" | "positive" }) {
  // Mint is for positive states (an approval in place), never for an action.
  const bg = tone === "warning" ? colour.warningSurface : tone === "danger" ? colour.dangerSurface : tone === "positive" ? colour.successSurface : colour.chalk
  const border = tone === "warning" ? "rgba(138,90,0,0.18)" : tone === "danger" ? "rgba(193,34,27,0.18)" : tone === "positive" ? "rgba(18,61,44,0.16)" : colour.line
  return (
    <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      {isText(children) ? <Text style={[type.small, { color: tone === "danger" ? colour.danger : colour.ink }]}>{children}</Text> : children}
    </View>
  )
}

/** Words, however JSX split them ("It works only for {email}…" arrives as an array): they need a Text. */
function isText(node: ReactNode): boolean {
  return typeof node === "string" || typeof node === "number" || (Array.isArray(node) && node.every(isText))
}

/** The words for a count: "1 person", "3 people". */
export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`
}
