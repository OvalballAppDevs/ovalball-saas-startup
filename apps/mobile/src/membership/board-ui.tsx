import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { STANDING_LABEL, STANDING_TONE, formatMoneyMinor, type MembershipRow, type MembershipStanding, type StandingTone } from "@ovalball/contracts/membership/board"

import { TOUCH_TARGET, colour, font, radius, space, type } from "../design/tokens"

/**
 * THE MEMBERSHIP STANDING'S SMALLEST PIECES (20270746000000) -- one look for the club's screens and a team's.
 *
 * A standing is a WORD with a tint behind it, never the tint alone. The tints follow meaning: forest and pitch for
 * settled, mint for money on its way, plain for an ordinary month not yet paid, amber where somebody should look,
 * red only where something has actually gone wrong. The larger running pieces built from these -- the standing
 * bar, a member's row, the status card -- live in `running-ui.tsx`.
 */

const PILL: Record<StandingTone, { bg: string; fg: string; border: string }> = {
  settled: { bg: colour.mint100, fg: colour.forest800, border: colour.mint100 },
  moving: { bg: colour.surface, fg: colour.rugby700, border: colour.mint300 },
  neutral: { bg: colour.chalk, fg: colour.inkMuted, border: colour.lineStrong },
  attention: { bg: colour.warningSurface, fg: colour.warning, border: colour.warningSurface },
  problem: { bg: colour.dangerSurface, fg: colour.danger, border: colour.dangerSurface },
  quiet: { bg: colour.surface, fg: colour.inkSubtle, border: colour.lineStrong },
}

export function StandingPill({ standing }: { standing: MembershipStanding }) {
  const shade = PILL[STANDING_TONE[standing]]
  return (
    <View style={{ backgroundColor: shade.bg, borderColor: shade.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={[type.caption, { color: shade.fg, fontFamily: font.bodySemi }]}>{STANDING_LABEL[standing]}</Text>
    </View>
  )
}

/** "Reminded by Tom Hale, 3 Oct" -- who asked last, so nobody asks again without knowing. */
export function remindedLine(row: Pick<MembershipRow, "lastRemindedAt" | "lastRemindedBy">): string | null {
  if (!row.lastRemindedAt) return null
  const when = new Date(row.lastRemindedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return row.lastRemindedBy ? `Reminded by ${row.lastRemindedBy}, ${when}` : `Reminded ${when}`
}

/** A quiet definition list for the month's money: a term, its figure, and (on request) what it means. */
export function MoneyList({ items, currency }: { items: { term: string; minor: number; meaning: string }[]; currency: string }) {
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
        {items.map((item, i) => (
          <View
            key={item.term}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${item.term}, ${formatMoneyMinor(item.minor, currency)}${open ? `. ${item.meaning}` : ""}`}
            style={{ paddingVertical: space.sm + 2, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, gap: 2 }}
          >
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>{item.term}</Text>
              <Text style={[type.bodyMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{formatMoneyMinor(item.minor, currency)}</Text>
            </View>
            {open && <Text style={[type.caption, { color: colour.inkMuted }]}>{item.meaning}</Text>}
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={{ minHeight: TOUCH_TARGET, justifyContent: "center", alignSelf: "flex-start" }}
      >
        <Text style={[type.smallMedium, { color: colour.forest800, textDecorationLine: "underline" }]}>{open ? "Hide What These Mean" : "What These Mean"}</Text>
      </Pressable>
    </View>
  )
}

/** A settled group (Up to date, Exempt) folded behind one line by default, so the work stays at the top. */
export function FoldedGroup({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}, ${count}. ${open ? "Hide" : "Show"}`}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <Text style={[type.smallMedium, { color: colour.inkMuted }]}>
          {label} · {count}
        </Text>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{open ? "Hide" : "Show"}</Text>
      </Pressable>
      {open && children}
    </View>
  )
}
