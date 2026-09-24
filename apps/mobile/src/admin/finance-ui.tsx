import { Pressable, Text, View } from "react-native"
import { billingPeriodLabel, formatFinanceDate, formatMinorUnits, OBLIGATION_STATUS_SHORT, obligationTone, shiftBillingPeriod, type FinanceObligationRow, type ObligationTone } from "@ovalball/contracts/club/finance"

import { ChevronLeft, ChevronRight, ExternalLink } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE FINANCE SCREENS' SHARED PIECES (CA-M11.1). Money is drawn once (`formatMinorUnits`), a status is a
 * WORD with a tint behind it and never the tint alone, and a hand-off to the website says so in its label.
 */

const TONES: Record<ObligationTone, { bg: string; fg: string }> = {
  positive: { bg: colour.successSurface, fg: colour.forest800 },
  caution: { bg: colour.warningSurface, fg: colour.warning },
  danger: { bg: colour.dangerSurface, fg: colour.danger },
  neutral: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted },
}

export function FinancePill({ label, tone }: { label: string; tone: ObligationTone }) {
  const shade = TONES[tone]
  return (
    <View style={{ backgroundColor: shade.bg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={[type.caption, { color: shade.fg }]}>{label}</Text>
    </View>
  )
}

export function MetricTile({ label, value, tone }: { label: string; value: string; tone?: "positive" | "caution" }) {
  const ink = tone === "positive" ? colour.forest800 : tone === "caution" ? colour.warning : colour.ink
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, gap: 4 }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{label.toUpperCase()}</Text>
      <Text style={[type.title, { color: ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}

/** Metrics and rows all follow the selected period, never just the current month. */
export function MonthSelector({ period, onChange }: { period: string; onChange: (period: string) => void }) {
  const arrow = (label: string, delta: number, Icon: typeof ChevronLeft) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onChange(shiftBillingPeriod(period, delta))} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Icon size={20} color={colour.forest800} />
    </Pressable>
  )
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
      {arrow("Previous month", -1, ChevronLeft)}
      <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, flex: 1, textAlign: "center" }]}>
        {billingPeriodLabel(period)}
      </Text>
      {arrow("Next month", 1, ChevronRight)}
    </View>
  )
}

export function NavRow({ label, caption, onPress, first = false, external = false }: { label: string; caption?: string; onPress: () => void; first?: boolean; external?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={external ? `${label}. Opens the Ovalball website` : label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        {caption ? <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text> : null}
      </View>
      {external ? <ExternalLink size={15} color={colour.inkSubtle} /> : <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}

export function ObligationRow({ row, first, onPress, children }: { row: FinanceObligationRow; first: boolean; onPress: () => void; children?: React.ReactNode }) {
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${row.playerName}, ${formatMinorUnits(row.amountMinor)}, ${OBLIGATION_STATUS_SHORT[row.status] ?? row.status}`} onPress={onPress} style={({ pressed }) => ({ paddingVertical: space.md, paddingHorizontal: space.lg, gap: 6, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
            {row.playerName}
          </Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{formatMinorUnits(row.amountMinor)}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <FinancePill label={OBLIGATION_STATUS_SHORT[row.status] ?? row.status} tone={obligationTone(row.status)} />
          <Text style={[type.caption, { color: colour.inkMuted }]}>Due {formatFinanceDate(row.dueDate)}</Text>
          {row.isProrated && <Text style={[type.caption, { color: colour.inkMuted }]}>· Pro-rata first month</Text>}
        </View>
      </Pressable>
      {children}
    </View>
  )
}

export function Notice({ notice }: { notice: { tone: "ok" | "error"; text: string } | null }) {
  if (!notice) return null
  return (
    <View accessibilityRole={notice.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: notice.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
      <Text style={[type.small, { color: notice.tone === "error" ? colour.danger : colour.forest800 }]}>{notice.text}</Text>
    </View>
  )
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

export function FieldLabel({ children }: { children: string }) {
  return <Text style={[type.smallMedium, { color: colour.ink }]}>{children}</Text>
}

export function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{term.toUpperCase()}</Text>
      {typeof children === "string" ? <Text style={[type.small, { color: colour.ink }]}>{children}</Text> : children}
    </View>
  )
}
