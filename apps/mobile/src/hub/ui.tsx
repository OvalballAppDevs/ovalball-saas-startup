import { Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native"
import { useRouter } from "expo-router"

import { ArrowUpRight, ChevronRight, ExternalLink, Info, Search, TriangleAlert, X } from "../components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import type { FriendlyError } from "../errors/translate"
import { openExternal, openHubHref } from "./routes"

/**
 * THE RUGBY HUB'S FURNITURE — one set of parts, every domain built from it.
 *
 * The website's Hub is nineteen screens that share one visual grammar: a
 * display-face title with a small code badge beside it, overline section
 * headings, paragraphs of one idea each, chips for related things, a mint
 * callout for the governing body's own words, an amber one for a common
 * misunderstanding, a sources list with a tier and a retrieval date, and a
 * quiet footnote saying what the page is not. This file is that grammar in
 * React Native. A Game Knowledge concept and a Coaching concept look alike
 * because they ARE alike, and a redesign reaches every domain because every
 * domain is drawn from here.
 *
 * FOREST IS THE FEATURE COLOUR ON A CHALK READING SURFACE. Long reading wants a
 * light page and dark ink; the brand appears where something is actionable or
 * official, never as a wash behind prose.
 */

const overline = { ...type.overline, color: colour.inkMuted, textTransform: "uppercase" as const }
const prose = { ...type.body, color: "rgba(16,21,18,0.85)" }
const muted = { ...type.small, color: colour.inkMuted }

/** Section heading in the overline register the website uses for every "Related X". */
export function HubOverline({ children, tone = "muted" }: { children: string; tone?: "muted" | "forest" | "amber" }) {
  const c = tone === "forest" ? colour.forest800 : tone === "amber" ? colour.warning : colour.inkMuted
  return (
    <Text accessibilityRole="header" style={[overline, { color: c }]}>
      {children}
    </Text>
  )
}

/** A display-face heading: the Hub landing's group titles and a landing page's "Explore Any Concept". */
export function HubHeading({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text accessibilityRole="header" style={[type.displaySmall, { color: colour.ink }]}>
        {children}
      </Text>
    </View>
  )
}

/** A short lead paragraph under a heading. */
export function HubLead({ children }: { children: string }) {
  return <Text style={[type.small, { color: "rgba(16,21,18,0.7)", marginTop: 4 }]}>{children}</Text>
}

/** One idea, one heading: "Why It Matters", "What Happens", "With the ball". */
export function HubProse({ heading, children }: { heading: string; children: string }) {
  return (
    <View style={{ gap: 6 }}>
      <HubOverline>{heading}</HubOverline>
      <Text style={prose}>{children}</Text>
    </View>
  )
}

export function HubParagraph({ children, quiet = false }: { children: string; quiet?: boolean }) {
  return <Text style={quiet ? { ...type.body, color: "rgba(16,21,18,0.8)" } : prose}>{children}</Text>
}

/** The page's own title, the eyebrow above it and the intro beneath -- the shape every web Hub page opens with. */
export function HubHero({ title, intro, badges, eyebrow = "Rugby Hub" }: { title: string; intro?: string | null; badges?: React.ReactNode; eyebrow?: string | null }) {
  return (
    <View style={{ gap: space.sm }}>
      {eyebrow && <Text style={[overline, { color: colour.forest800 }]}>{eyebrow}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink, flexShrink: 1 }]}>
          {title}
        </Text>
        {badges}
      </View>
      {intro ? <Text style={{ ...type.body, color: "rgba(16,21,18,0.8)" }}>{intro}</Text> : null}
    </View>
  )
}

/** A text badge -- a code, a team type, a role, a certainty. Colour is never the only signal: the word is. */
export function HubBadge({ label, tone = "outline", small = false }: { label: string; tone?: "outline" | "forest" | "amber" | "pitch" | "quiet"; small?: boolean }) {
  const tones = {
    outline: { bg: colour.surface, fg: "rgba(16,21,18,0.7)", border: colour.lineStrong },
    forest: { bg: colour.forest900, fg: colour.onForest, border: colour.forest900 },
    amber: { bg: colour.warningSurface, fg: colour.warning, border: "rgba(138,90,0,0.4)" },
    pitch: { bg: colour.surface, fg: colour.forest800, border: "rgba(50,166,101,0.5)" },
    quiet: { bg: "transparent", fg: colour.inkMuted, border: "transparent" },
  }
  const t = tones[tone]
  return (
    <View style={{ backgroundColor: t.bg, borderColor: t.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: small ? 8 : 10, paddingVertical: small ? 2 : 3, alignSelf: "flex-start" }}>
      <Text style={[small ? type.caption : type.smallMedium, { color: t.fg, fontFamily: "Inter_500Medium", fontSize: small ? 11 : 12, lineHeight: small ? 14 : 16 }]}>{label}</Text>
    </View>
  )
}

/** A row of badges after a title. */
export function HubBadges({ items }: { items: { label: string; tone?: "outline" | "forest" | "amber" | "pitch" }[] }) {
  if (items.length === 0) return null
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {items.map((b, i) => (
        <HubBadge key={`${b.label}-${i}`} label={b.label} tone={b.tone} />
      ))}
    </View>
  )
}

/**
 * A DESTINATION ROW: a title, a line of description, a chevron. The landing's
 * grouped destinations and every domain's list of things to open. `index`
 * draws a numbered marker for a journey that genuinely is a sequence.
 */
export function HubRow({
  title,
  description,
  onPress,
  badge,
  index,
  leading,
  emphasised = false,
  accessibilityHint,
}: {
  title: string
  description?: string | null
  onPress: () => void
  badge?: string | null
  index?: number
  leading?: React.ReactNode
  emphasised?: boolean
  accessibilityHint?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      accessibilityHint={accessibilityHint ?? (description ?? undefined)}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: emphasised ? "rgba(50,166,101,0.5)" : pressed ? "rgba(50,166,101,0.45)" : colour.line,
        backgroundColor: emphasised ? "rgba(220,247,229,0.6)" : pressed ? "rgba(220,247,229,0.5)" : colour.surface,
      })}
    >
      {typeof index === "number" && (
        <View
          accessibilityElementsHidden
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: emphasised ? colour.forest900 : colour.forest800, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{index}</Text>
        </View>
      )}
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Text style={[emphasised ? type.heading : type.smallMedium, { color: emphasised ? colour.forest900 : colour.ink, fontFamily: "Inter_600SemiBold" }]}>{title}</Text>
          {badge && <HubBadge label={badge} small />}
        </View>
        {description ? (
          <Text style={[type.small, { color: emphasised ? "rgba(11,43,30,0.85)" : "rgba(16,21,18,0.65)" }]} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={18} color="rgba(16,21,18,0.3)" />
    </Pressable>
  )
}

/** A vertical list of rows with the Hub's standard gap. */
export function HubList({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: space.sm }, style]}>{children}</View>
}

export interface HubChip {
  label: string
  /** A web Hub href, opened through the one route table. */
  href?: string
  onPress?: () => void
  /** A small trailing word: "Union", "Learn first", "#9". */
  trailing?: string | null
  leading?: string | null
}

/**
 * CHIPS: the Hub's related-things vocabulary. Every chip is a real button that
 * opens a real destination; a chip with neither an href nor a handler is not
 * drawn, because a chip that goes nowhere teaches somebody the chips are
 * decoration.
 */
export function HubChips({ heading, note, items, tone = "muted" }: { heading?: string; note?: string; items: HubChip[]; tone?: "muted" | "forest" }) {
  const router = useRouter()
  const live = items.filter((c) => c.href || c.onPress)
  if (live.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      {heading && <HubOverline tone={tone}>{heading}</HubOverline>}
      {note && <Text style={muted}>{note}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {live.map((c, i) => (
          <Pressable
            key={`${c.label}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={[c.leading, c.label, c.trailing].filter(Boolean).join(" ")}
            onPress={c.onPress ?? (() => c.href && openHubHref(router, c.href))}
            style={({ pressed }) => ({
              minHeight: 40,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: space.md,
              paddingVertical: 8,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: pressed ? "rgba(50,166,101,0.6)" : colour.lineStrong,
              backgroundColor: pressed ? "rgba(220,247,229,0.6)" : colour.surface,
            })}
          >
            {c.leading ? <Text style={[type.smallMedium, { color: colour.inkMuted }]}>{c.leading}</Text> : null}
            <Text style={[type.smallMedium, { color: "rgba(16,21,18,0.85)" }]}>{c.label}</Text>
            {c.trailing ? <Text style={[type.caption, { color: colour.inkMuted }]}>{c.trailing}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/**
 * A CALLOUT. Mint for the governing body's own words and for a Union / League
 * difference; amber for a common misunderstanding or a story that is legend
 * rather than fact; chalk for a neutral aside like how a decision is signalled.
 */
export function HubCallout({ heading, children, tone = "mint", icon, footnote }: { heading?: string; children: React.ReactNode; tone?: "mint" | "amber" | "chalk"; icon?: React.ReactNode; footnote?: string }) {
  const shade = {
    mint: { bg: "rgba(220,247,229,0.6)", border: "rgba(90,203,131,0.5)", heading: colour.forest900, text: "rgba(11,43,30,0.88)" },
    amber: { bg: colour.warningSurface, border: "rgba(138,90,0,0.35)", heading: colour.warning, text: "rgba(80,52,0,0.9)" },
    chalk: { bg: colour.chalk, border: colour.line, heading: colour.inkMuted, text: "rgba(16,21,18,0.85)" },
  }[tone]
  return (
    <View style={{ backgroundColor: shade.bg, borderColor: shade.border, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, flexDirection: "row", gap: space.md }}>
      {icon ? <View style={{ paddingTop: 2 }}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 6 }}>
        {heading && <Text style={[overline, { color: shade.heading }]}>{heading}</Text>}
        {typeof children === "string" ? <Text style={{ ...type.body, color: shade.text }}>{children}</Text> : children}
        {footnote && <Text style={[type.caption, { color: shade.heading, marginTop: 2 }]}>{footnote}</Text>}
      </View>
    </View>
  )
}

/**
 * THE HUB'S ONLY "NOTHING TO SHOW". Three tones, told apart: content that is
 * being reviewed, an age grade with no separate regulation, and a read that
 * failed. The website draws the same three; a generic empty state would say
 * "you have no rules", which is never true.
 */
export function HubNotice({ tone, message }: { tone: "reviewing" | "no-mapping" | "unavailable"; message: string }) {
  const unavailable = tone === "unavailable"
  return (
    <View
      accessibilityRole={unavailable ? "alert" : undefined}
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: unavailable ? "rgba(138,90,0,0.4)" : colour.lineStrong,
        backgroundColor: unavailable ? colour.warningSurface : "rgba(220,247,229,0.4)",
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: "row",
        gap: space.md,
      }}
    >
      {unavailable ? <TriangleAlert size={18} color={colour.warning} /> : <Info size={18} color={colour.forest800} />}
      <Text style={{ ...type.body, color: "rgba(16,21,18,0.8)", flex: 1 }}>{message}</Text>
    </View>
  )
}

/** "Showing rules for Under 9 (Rugby Union) -- not necessarily your own team's rules." The browse-mode banner. */
export function HubContextStrip({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: "rgba(145,227,172,0.6)", backgroundColor: "rgba(220,247,229,0.5)", paddingHorizontal: space.lg, paddingVertical: space.md }}>
      {typeof children === "string" ? <Text style={[type.small, { color: colour.forest900 }]}>{children}</Text> : children}
    </View>
  )
}

export function Strong({ children }: { children: string }) {
  return <Text style={{ fontFamily: "Inter_600SemiBold" }}>{children}</Text>
}

/** An official source line: the authority, the source title as a link to the registered canonical URL, and a locator. */
export function HubOfficialSource({ authority, title, url, locator }: { authority: string; title: string; url: string; locator?: string | null }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Source: ${authority}, ${title}${locator ? `, ${locator}` : ""}. Opens in your browser`}
      onPress={() => openExternal(url)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 6, opacity: pressed ? 0.7 : 1, paddingVertical: 4 })}
    >
      <ExternalLink size={13} color={colour.forest800} style={{ marginTop: 2 }} />
      <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
        Source: {authority} — <Text style={{ color: colour.forest800, fontFamily: "Inter_500Medium", textDecorationLine: "underline" }}>{title}</Text>
        {locator ? ` (${locator})` : ""}
      </Text>
    </Pressable>
  )
}

export interface HubSourceItem {
  title: string
  url: string | null
  tierLabel: string
  retrievedOn?: string | null
  publisher?: string | null
  supports?: string | null
}

/** A sources list with tier and retrieval date -- People, Clubs, Development, Coaching, Parents and the Story of Rugby all end in one. */
export function HubSources({ heading = "Sources", items }: { heading?: string; items: HubSourceItem[] }) {
  if (items.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      <HubOverline>{heading}</HubOverline>
      <View style={{ gap: space.sm }}>
        {items.map((s, i) => {
          const meta = [s.tierLabel, s.publisher ?? null, s.retrievedOn ? `Retrieved ${formatDate(s.retrievedOn)}` : null].filter(Boolean).join(" · ")
          const body = (
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.smallMedium, { color: s.url ? colour.forest800 : "rgba(16,21,18,0.75)", textDecorationLine: s.url ? "underline" : "none" }]}>{s.title}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{meta}</Text>
              {s.supports ? <Text style={[type.caption, { color: colour.inkMuted, fontStyle: "italic" }]}>{s.supports}</Text> : null}
            </View>
          )
          return s.url ? (
            <Pressable
              key={`${s.title}-${i}`}
              accessibilityRole="link"
              accessibilityLabel={`${s.title}, ${meta}. Opens in your browser`}
              onPress={() => openExternal(s.url!)}
              style={({ pressed }) => ({ flexDirection: "row", gap: 6, alignItems: "flex-start", opacity: pressed ? 0.7 : 1 })}
            >
              <ExternalLink size={14} color={colour.forest800} style={{ marginTop: 3 }} />
              {body}
            </Pressable>
          ) : (
            <View key={`${s.title}-${i}`} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              <ExternalLink size={14} color={colour.inkMuted} style={{ marginTop: 3 }} />
              {body}
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** A short list of governing-body facts as the body's own words -- "Related Rules" on a concept, "What the Law Actually Says" in a callout. */
export function HubFactList({ heading, items, tone = "plain", footnote }: { heading: string; items: { key: string; text: string | null }[]; tone?: "plain" | "mint"; footnote?: string }) {
  if (items.length === 0) return null
  const rows = items.map((f) => (
    <View key={f.key} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", borderRadius: radius.md, borderWidth: tone === "plain" ? 1 : 0, borderColor: colour.line, backgroundColor: tone === "plain" ? colour.surface : "transparent", paddingHorizontal: tone === "plain" ? space.md : 0, paddingVertical: tone === "plain" ? space.sm : 2 }}>
      {tone === "plain" && <ExternalLink size={13} color={colour.inkMuted} style={{ marginTop: 3 }} />}
      <Text style={{ ...type.small, color: tone === "plain" ? "rgba(16,21,18,0.75)" : "rgba(11,43,30,0.88)", flex: 1, fontSize: 15, lineHeight: 22 }}>{f.text ?? "Governing-body regulation"}</Text>
    </View>
  ))
  if (tone === "mint") {
    return (
      <HubCallout heading={heading} footnote={footnote}>
        <View style={{ gap: 6 }}>{rows}</View>
      </HubCallout>
    )
  }
  return (
    <View style={{ gap: space.sm }}>
      <HubOverline>{heading}</HubOverline>
      <View style={{ gap: space.sm }}>{rows}</View>
    </View>
  )
}

/**
 * ONE REGULATORY FACT, presented the same on Rules, Safeguarding and Player
 * Welfare: an info mark, the title with its tier and obligation badges, the
 * value in the display face where there is one, the body where there is
 * one, and the official source beneath.
 */
export function HubFactCard({
  title,
  valueDisplay,
  body,
  tierLabel,
  isOverlay,
  obligation,
  source,
  highlighted = false,
}: {
  title: string
  valueDisplay?: string | null
  body?: string | null
  tierLabel?: string | null
  isOverlay?: boolean
  obligation?: { label: string; tone: "mandatory" | "recommended" | "informational" } | null
  source?: { authority: string; title: string; url: string; locator: string | null } | null
  /** The one card a deep link asked for. */
  highlighted?: boolean
}) {
  return (
    <Card style={{ padding: space.lg, borderColor: highlighted ? colour.pitch600 : colour.line, borderWidth: highlighted ? 1.5 : 1 }}>
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
          <Info size={18} color={colour.forest800} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>
            {title}
          </Text>
          <HubBadges
            items={[
              ...(tierLabel ? [{ label: tierLabel, tone: tierLabel === "Your Age Grade's Variation" ? ("forest" as const) : ("outline" as const) }] : []),
              ...(isOverlay ? [{ label: "Competition variation", tone: "pitch" as const }] : []),
              ...(obligation ? [{ label: obligation.label, tone: obligation.tone === "mandatory" ? ("forest" as const) : obligation.tone === "recommended" ? ("pitch" as const) : ("outline" as const) }] : []),
            ]}
          />
          {valueDisplay ? <Text style={[type.displaySmall, { color: colour.forest900, marginTop: 4 }]}>{valueDisplay}</Text> : null}
          {body ? <Text style={{ ...type.body, color: "rgba(16,21,18,0.8)", marginTop: 4 }}>{body}</Text> : null}
          {source && <HubOfficialSource authority={source.authority} title={source.title} url={source.url} locator={source.locator} />}
        </View>
      </View>
    </Card>
  )
}

/** A curated honours list: the year in bold, then what was won. Never a live table. */
export function HubHonours({ heading = "Selected Honours", items }: { heading?: string; items: { key: string; year: string; text: string; notes?: string | null }[] }) {
  if (items.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      <HubOverline>{heading}</HubOverline>
      <View style={{ gap: space.sm }}>
        {items.map((h) => (
          <View key={h.key} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingVertical: space.sm + 2 }}>
            <Text style={[type.small, { color: "rgba(16,21,18,0.8)" }]}>
              <Text style={{ fontFamily: "Inter_600SemiBold", color: colour.ink }}>{h.year}</Text> — {h.text}
            </Text>
            {h.notes ? <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>{h.notes}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

/** A segmented control for a code filter. Never inferred silently; always visible. */
export function HubSegmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, padding: 3, alignSelf: "flex-start" }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, selected: active }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: active ? colour.ink : "transparent", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={[type.smallMedium, { color: active ? colour.chalk : "rgba(16,21,18,0.65)" }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Numbered steps with a connecting line: a technique's Setup / Execution / Finish. Every step is always present. */
export function HubSteps({ steps }: { steps: { label: string; text: string }[] }) {
  return (
    <View style={{ gap: space.lg }}>
      {steps.map((s, i) => (
        <View key={`${s.label}-${i}`} style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ alignItems: "center" }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: colour.pitch600, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: type.display.fontFamily, fontSize: 16, color: colour.forest900 }}>{i + 1}</Text>
            </View>
            {i < steps.length - 1 && <View style={{ width: 1, flex: 1, backgroundColor: colour.lineStrong, marginTop: 4 }} />}
          </View>
          <View style={{ flex: 1, gap: 4, paddingBottom: 2 }}>
            <Text style={[overline, { color: colour.forest800 }]}>{s.label}</Text>
            <Text style={prose}>{s.text}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

/** The quiet last line of every article: what this page is, and what it is not. */
export function HubFootnote({ children }: { children: string }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.md }}>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{children}</Text>
    </View>
  )
}

/** A search field in the Hub's own shape: a pill, a glyph, a clear button. */
export function HubSearchField({ value, onChange, onSubmit, autoFocus = false, placeholder = "Search Rugby Hub" }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean; placeholder?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET + 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, paddingLeft: space.md, paddingRight: 6 }}>
      <Search size={18} color={colour.inkMuted} />
      <TextInput
        accessibilityLabel="Search Rugby Hub"
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        style={{ flex: 1, minHeight: TOUCH_TARGET, ...type.body, color: colour.ink, paddingVertical: 0 }}
      />
      {value.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange("")} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }}>
          <X size={16} color={colour.inkMuted} />
        </Pressable>
      )}
    </View>
  )
}

/** A quiet in-page link with an outward arrow: "Read more", "Learn more". */
export function HubTextLink({ label, onPress, external = false }: { label: string; onPress: () => void; external?: boolean }) {
  return (
    <Pressable accessibilityRole={external ? "link" : "button"} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, alignSelf: "flex-start", opacity: pressed ? 0.7 : 1 })}>
      <Text style={[type.smallMedium, { color: colour.forest800, textDecorationLine: "underline" }]}>{label}</Text>
      {external ? <ArrowUpRight size={14} color={colour.forest800} /> : <ChevronRight size={14} color={colour.forest800} />}
    </Pressable>
  )
}

/** What a domain shows while its bundle loads, when it failed, and when it is genuinely empty. */
export function HubLoading({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ gap: space.sm }}>
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} lines={i % 2 === 0 ? 2 : 1} />
      ))}
    </View>
  )
}

export function HubFailed({ error, onRetry }: { error: FriendlyError; onRetry: () => void }) {
  return <ErrorState message={error.message} onRetry={error.retryable ? onRetry : undefined} offline={/signal|offline|connection/i.test(error.message)} />
}

export function HubEmpty({ title, body }: { title: string; body: string }) {
  return <EmptyState title={title} body={body} />
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** `2026-03-12` -> `12 March 2026`, without depending on the device's Intl tables. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** The Rugby Hub's spacing between sections of one article. */
export const ARTICLE_GAP = space.xl
