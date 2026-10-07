import { useEffect, useMemo, useState } from "react"
import { AccessibilityInfo, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native"
import {
  CLUB_MEMBERSHIP_TERMS_STATUS,
  clubMembershipTermsPoints,
  CONNECTION_STATE_LABEL,
  CONNECTION_STATE_TONE,
  feePercent,
  GOCARDLESS_ACCESS_SENTENCE,
  groupTeams,
  membershipMoneyLine,
  readinessSentence,
  verificationWaitSentence,
  type ConnectionState,
  type ConnectionTone,
  type FeeBearer,
  type MembershipTeam,
  type ReadinessItem,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import { formatFinanceDate, formatMinorUnits, ordinalWord } from "@ovalball/contracts/club/finance"

import { Sheet } from "../components/field-sheet"
import { DateField } from "../components/form"
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Clock, Pencil, TriangleAlert, Users } from "../components/icons"
import { ChoiceRow, IconTile } from "../people/ui"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, font, radius, space, type } from "../design/tokens"

/**
 * THE CLUB MEMBERSHIPS SETUP KIT (Club Memberships Part 1) -- the few shapes the setup journey and Membership
 * Settings share, so the phone says one thing one way:
 *
 *   ToneChip / ConnectionChip   a state in words on a tint, never the tint alone
 *   MoneyReceipt                where one month's money goes: member pays, Ovalball's fee, the club receives
 *   InfoRow                     an icon tile and a sentence that explains, not a button
 *   ReviewRow                   one setting on the Review step, opening the step that changes it
 *   MembershipCard / Sheet      a membership's name, monthly price and teams, and the sheet that edits them
 *   CollectionDaySheet          the 28 days a Direct Debit can be collected on
 *   StillToDo                   what Activate is waiting for, each line opening the step that finishes it
 *
 * Every figure here is the SERVER'S: the receipt shows what `membership_first_payment_example` worked out and
 * never does the fee arithmetic itself.
 */

const CHIP_TONE: Record<ConnectionTone, { bg: string; fg: string; dot: string; ring: boolean }> = {
  neutral: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted, dot: colour.inkSubtle, ring: false },
  // Moving -- GoCardless is checking or reviewing. Nothing for the club to do, so it stays green, drawn as a
  // ring rather than a filled dot: on its way, not there yet.
  moving: { bg: colour.mint100, fg: colour.rugby700, dot: colour.rugby700, ring: true },
  attention: { bg: colour.warningSurface, fg: colour.warning, dot: colour.warning, ring: false },
  settled: { bg: colour.successSurface, fg: colour.forest800, dot: colour.pitch600, ring: false },
}

export function ToneChip({ label, tone, accessibilityLabel }: { label: string; tone: ConnectionTone; accessibilityLabel?: string }) {
  const shade = CHIP_TONE[tone]
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: shade.bg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 5 }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shade.ring ? "transparent" : shade.dot, borderWidth: shade.ring ? 1.5 : 0, borderColor: shade.dot }} />
      <Text style={[type.caption, { color: shade.fg, fontFamily: font.bodyMedium }]}>{label}</Text>
    </View>
  )
}

export function ConnectionChip({ state }: { state: ConnectionState }) {
  return <ToneChip label={CONNECTION_STATE_LABEL[state]} tone={CONNECTION_STATE_TONE[state]} accessibilityLabel={`GoCardless: ${CONNECTION_STATE_LABEL[state]}`} />
}

/**
 * WHERE ONE MONTH'S MONEY GOES -- the setup journey's one bold element, and so the one tinted surface in it.
 *
 * What a member pays is the figure that matters to a club telling its parents, so it leads, large. Below it the
 * sum works in both directions the club can choose: what the member pays, less Ovalball's fee, is what reaches
 * the club before GoCardless's own fee. A screen reader hears it as the one sentence it is rather than six numbers.
 * `basis` names what the figures are for -- the club's own membership, or a stated example.
 */
export function MoneyReceipt({
  basis,
  memberPaysMinor,
  feeMinor,
  clubReceivesMinor,
  bps,
  currency = "GBP",
}: {
  basis: string
  memberPaysMinor: number
  feeMinor: number
  clubReceivesMinor: number
  bps: number
  currency?: string
}) {
  const money = (minor: number) => formatMinorUnits(minor, currency)
  const pct = feePercent(bps)
  const sentence = `${basis}: members pay ${money(memberPaysMinor)} a month, Ovalball's ${pct} fee is ${money(feeMinor)}, and the club receives ${money(clubReceivesMinor)} before GoCardless's own fee.`
  return (
    <View accessible accessibilityLabel={sentence} style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 }}>
      <Text style={[type.caption, { color: colour.forest800 }]}>{basis}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>Members pay</Text>
        <Text style={[type.title, { color: colour.forest800, fontVariant: ["tabular-nums"] }]}>{`${money(memberPaysMinor)}`}</Text>
      </View>
      <ReceiptLine label={`Ovalball's fee (${pct})`} value={`−${money(feeMinor)}`} muted />
      <View style={{ height: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(18,61,44,0.25)", marginVertical: space.xs }} />
      <ReceiptLine label="The club receives" value={money(clubReceivesMinor)} strong />
      <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>A month, before GoCardless's own fee.</Text>
    </View>
  )
}

/** While the server works the figures out again, the receipt's place is held, so old figures are never shown as new. */
export function ReceiptPlaceholder() {
  return (
    <View accessible accessibilityLabel="Working out the figures" style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm, opacity: 0.7 }}>
      <View style={{ height: 10, width: "45%", borderRadius: 5, backgroundColor: "rgba(18,61,44,0.12)" }} />
      <View style={{ height: 22, width: "70%", borderRadius: 6, backgroundColor: "rgba(18,61,44,0.12)" }} />
      <View style={{ height: 10, width: "60%", borderRadius: 5, backgroundColor: "rgba(18,61,44,0.12)" }} />
    </View>
  )
}

function ReceiptLine({ label, value, muted = false, strong = false }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, paddingVertical: 3 }}>
      <Text style={[strong ? type.bodyMedium : type.small, { color: muted ? colour.inkMuted : colour.ink, flexShrink: 1 }]}>{label}</Text>
      <Text style={[strong ? type.heading : type.smallMedium, { color: muted ? colour.inkMuted : colour.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}

/**
 * WHAT MEMBERS PAY, MEMBERSHIP BY MEMBERSHIP -- the head of Review. The real prices, under the club's own fee
 * choice, before anything is switched on: the figure a club will tell its parents, per membership.
 */
export function MembershipsMoney({ memberships, bearer, bps, currency = "GBP" }: { memberships: SetupMembership[]; bearer: FeeBearer | null; bps: number; currency?: string }) {
  const priced = memberships.filter((m) => m.money !== null)
  if (!bearer || priced.length === 0) return null
  const money = (minor: number) => formatMinorUnits(minor, currency)
  const pct = feePercent(bps)
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        What Members Pay
      </Text>
      {priced.map((m, i) => (
        <View
          key={m.id}
          accessible
          accessibilityLabel={`${m.name}: members pay ${money(m.money!.membersPayMinor)} a month. Ovalball's ${pct} fee is ${money(m.money!.feeMinor)}. The club receives ${money(m.money!.clubReceivesMinor)}.`}
          style={{ gap: 2, paddingTop: i === 0 ? 0 : space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "rgba(18,61,44,0.15)" }}
        >
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
            <Text style={[type.bodyMedium, { color: colour.ink, flexShrink: 1 }]}>{m.name}</Text>
            <Text style={[type.title, { color: colour.forest800, fontVariant: ["tabular-nums"] }]}>{money(m.money!.membersPayMinor)}</Text>
          </View>
          <Text style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{`Ovalball's ${pct} ${money(m.money!.feeMinor)} · the club receives ${money(m.money!.clubReceivesMinor)}`}</Text>
        </View>
      ))}
      <Text style={[type.caption, { color: colour.inkMuted }]}>A month, before GoCardless's own fee.</Text>
    </View>
  )
}

/** An explanation with its icon: read as one sentence, never announced as something to press. */
export function InfoRow({ icon, title, body, first = false }: { icon: React.ReactNode; title: string; body?: string; first?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={body ? `${title}. ${body}` : title}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}
    >
      <IconTile>{icon}</IconTile>
      <View style={{ flex: 1, minWidth: 0, gap: 2, paddingTop: body ? 0 : 10 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
        {!!body && <Text style={[type.small, { color: colour.inkMuted }]}>{body}</Text>}
      </View>
    </View>
  )
}

/** One setting on the Review step. The whole row opens the step that changes it. */
export function ReviewRow({
  icon,
  label,
  value,
  chip,
  chipLabel,
  onPress,
  first = false,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value?: string | null
  chip?: React.ReactNode
  /** The chip's words, so a screen reader hears the state the chip shows ("GoCardless: Being verified"). */
  chipLabel?: string
  onPress?: () => void
  first?: boolean
  hint?: string
}) {
  // AT LARGE TEXT SIZES the value goes under the label: side by side, a chip was squeezed to one letter per line.
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  const valueNode = chip ? <View style={{ alignSelf: stacked ? "flex-start" : "flex-end" }}>{chip}</View> : !!value && <Text style={[type.small, { color: colour.inkMuted, textAlign: stacked ? "left" : "right" }]}>{value}</Text>
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${chipLabel ?? value ?? ""}`.replace(/: $/, "")}
      accessibilityHint={hint}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <View style={{ width: 22, alignItems: "center" }}>{icon}</View>
      {stacked ? (
        <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
          {valueNode}
        </View>
      ) : (
        <>
          <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]}>{label}</Text>
          <View style={{ flex: 1, minWidth: space.sm, alignItems: "flex-end" }}>{valueNode}</View>
        </>
      )}
      {onPress && <ChevronRight size={18} color={colour.inkSubtle} />}
    </Pressable>
  )
}

/** The words for a team list, kept to a line or two: "Under 12 Boys, Under 13 Boys and 3 more". */
export function teamsSentence(teams: MembershipTeam[], limit = 3): string {
  if (teams.length === 0) return "No teams yet"
  const names = teams.map((t) => t.name)
  if (names.length <= limit) return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`
}

export function priceSentence(amountMinor: number | null, currency = "GBP"): string {
  return amountMinor === null ? "No monthly price yet" : `${formatMinorUnits(amountMinor, currency)} a month`
}

/** A membership: its name, its monthly price, the teams it covers and, when there is one, its next price. */
export function MembershipCard({
  membership,
  onEdit,
  currency = "GBP",
  showHolders = false,
  history,
  feeBearer = null,
  flat = false,
  collection = null,
}: {
  membership: SetupMembership
  onEdit?: () => void
  currency?: string
  showHolders?: boolean
  /** Every price this membership has had or will have, newest first; shown on request. */
  history?: { id: string; amountMinor: number; effectiveFrom: string }[]
  /** The club's fee arrangement, so the card can say what members actually pay (the server's figure). */
  feeBearer?: FeeBearer | null
  /** Drawn as a row inside a card that is already a card -- no border of its own. */
  flat?: boolean
  /** The club's saved collection settings, so the card says how and when it is collected (never a guess). */
  collection?: { day: number; firstPayment: string | null } | null
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const unpriced = membership.monthlyAmountMinor === null
  const noTeams = membership.teams.length === 0
  const moneyLine = membershipMoneyLine(membership, feeBearer)
  return (
    <View style={flat ? { paddingVertical: space.md, gap: space.md } : { borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <IconTile>
          <Users size={20} color={colour.forest800} />
        </IconTile>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {membership.name}
          </Text>
          <Text style={[type.small, { color: unpriced ? colour.warning : colour.ink, fontVariant: ["tabular-nums"] }]}>{priceSentence(membership.monthlyAmountMinor, currency)}</Text>
          {!!moneyLine && <Text style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{moneyLine}</Text>}
        </View>
        {onEdit && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${membership.name}`}
            onPress={onEdit}
            hitSlop={8}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, opacity: pressed ? 0.7 : 1 })}
          >
            <Pencil size={16} color={colour.forest800} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
          </Pressable>
        )}
      </View>
      <View style={{ gap: space.xs }}>
        <Detail label="Applies To" value={teamsSentence(membership.teams, 6)} attention={noTeams} />
        {collection && <Detail label="Collected" value={`Monthly by Direct Debit, on the ${ordinalWord(collection.day)}`} />}
        {collection?.firstPayment && <Detail label="Joining Part-Way" value={collection.firstPayment} />}
        {membership.nextPrice && <Detail label="Next Price" value={`${formatMinorUnits(membership.nextPrice.amountMinor, currency)} a month from ${formatFinanceDate(membership.nextPrice.effectiveFrom, "long")}`} />}
        {showHolders && <Detail label="Members" value={membership.activeMemberships === 0 ? "Nobody yet" : `${membership.activeMemberships} paying`} />}
      </View>
      {history && history.length > 0 && (
        <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
            accessibilityLabel={`Price history for ${membership.name}`}
            onPress={() => setHistoryOpen((v) => !v)}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Price History</Text>
            {historyOpen ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
          </Pressable>
          {historyOpen &&
            history.map((row) => (
              <View key={row.id} accessible accessibilityLabel={`From ${formatFinanceDate(row.effectiveFrom, "long")}: ${formatMinorUnits(row.amountMinor, currency)} a month`} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>{`From ${formatFinanceDate(row.effectiveFrom)}`}</Text>
                <Text style={[type.small, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{formatMinorUnits(row.amountMinor, currency)}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  )
}

function Detail({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  // AT LARGE TEXT SIZES the value goes under its label rather than squeezing beside a fixed column.
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: stacked ? "column" : "row", gap: stacked ? 2 : space.md }}>
      <Text style={[type.small, { color: colour.inkMuted, width: stacked ? undefined : 120 }]}>{label}</Text>
      <Text style={[type.small, { color: attention ? colour.warning : colour.ink, flex: stacked ? undefined : 1 }]}>{value}</Text>
    </View>
  )
}

// -----------------------------------------------------------------------------------------------------------------
// THE MEMBERSHIP SHEET -- add or edit one membership: its name, monthly price and teams, saved together.
// -----------------------------------------------------------------------------------------------------------------

export interface MembershipDraft {
  name: string
  monthlyAmountMinor: number
  teamIds: string[]
  /** Set only when the price changed: the day the new price starts. */
  priceFrom: string | null
}

/** "16", "16.5", "£16.50" → 1650; anything else → null. */
export function parsePounds(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, "")
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

function poundsText(minor: number | null): string {
  if (minor === null) return ""
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2)
}

/**
 * How tall the keyboard is right now. A sheet that rises with the keyboard still has to fit above it: the
 * number pad has no key that puts it away, so a Save button left underneath it cannot be reached at all.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}

function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MembershipSheet({
  visible,
  membership,
  teams,
  memberships,
  askPriceStart,
  onClose,
  onSave,
  onArchive,
  saving,
  problem,
}: {
  visible: boolean
  /** null to add a new membership. */
  membership: SetupMembership | null
  teams: (MembershipTeam & { productId: string | null })[]
  /** Every membership, so a team that would move is named with the one it leaves. */
  memberships: SetupMembership[]
  /**
   * After memberships are on, a new price is scheduled rather than switched: the person picks the day it
   * starts, and is told that members already enrolled keep their price.
   */
  askPriceStart: boolean
  onClose: () => void
  onSave: (draft: MembershipDraft) => void
  /** Offered only for a membership nobody holds; the server refuses anything else regardless. */
  onArchive?: () => void
  saving: boolean
  problem: string | null
}) {
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [start, setStart] = useState<"today" | "next" | "date">("today")
  const [startDate, setStartDate] = useState(localIsoDate(new Date()))
  const [tried, setTried] = useState(false)
  const keyboard = useKeyboardHeight()
  const { height: windowHeight } = useWindowDimensions()
  // What is left above the keyboard once the sheet's title, hint and buttons have their room.
  const listHeight = Math.max(140, Math.min(420, windowHeight - keyboard - 300))

  useEffect(() => {
    if (!visible) return
    setName(membership?.name ?? "")
    setPrice(poundsText(membership?.monthlyAmountMinor ?? null))
    setPicked(new Set(membership?.teams.map((t) => t.id) ?? []))
    setStart("today")
    setStartDate(localIsoDate(new Date()))
    setTried(false)
  }, [visible, membership])

  const owner = useMemo(() => new Map(memberships.map((m) => [m.id, m.name])), [memberships])
  const amount = parsePounds(price)
  const nameProblem = name.trim().length === 0 ? "Give the membership a name." : name.trim().length > 60 ? "Keep the name to 60 characters or fewer." : null
  const priceProblem = amount === null || amount < 100 ? "A monthly price must be at least £1.00." : null
  const teamProblem = picked.size === 0 ? "Choose at least one team." : null
  const priceChanged = membership !== null && amount !== null && amount !== membership.monthlyAmountMinor
  const today = new Date()
  const todayText = localIsoDate(today)
  const nextMonthFirst = localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 1))
  const priceFrom = !askPriceStart || start === "today" ? todayText : start === "next" ? nextMonthFirst : startDate
  const dateProblem = askPriceStart && priceChanged && start === "date" && startDate < todayText ? "A new price can start today or later, never in the past." : null

  function save() {
    setTried(true)
    if (nameProblem || priceProblem || teamProblem || dateProblem || amount === null) return
    const isNew = membership === null
    onSave({
      name: name.trim(),
      monthlyAmountMinor: amount,
      teamIds: [...picked],
      priceFrom: isNew || priceChanged ? priceFrom : null,
    })
  }

  return (
    <Sheet
      visible={visible}
      title={membership ? `Edit ${membership.name}` : "Add a Membership"}
      hint="A name, a monthly price and the teams it covers."
      onClose={onClose}
      onSave={save}
      saving={saving}
      problem={problem}
      saveLabel={membership ? "Save Membership" : "Add Membership"}
      brand
    >
      <ScrollView style={{ maxHeight: listHeight }} contentContainerStyle={{ gap: space.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={{ gap: 6 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Name</Text>
          <TextInput
            accessibilityLabel="Name"
            accessibilityHint={tried && nameProblem ? nameProblem : undefined}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Junior Membership"
            placeholderTextColor={colour.inkSubtle}
            autoCapitalize="words"
            maxLength={60}
            selectionColor={colour.pitch600}
            style={[type.body, fieldStyle(tried && !!nameProblem)]}
          />
          {tried && nameProblem && <FieldProblem text={nameProblem} />}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Monthly Price</Text>
          <View style={[fieldStyle(tried && !!priceProblem), { flexDirection: "row", alignItems: "center", paddingHorizontal: 0 }]}>
            <Text accessible={false} style={[type.body, { color: colour.inkMuted, paddingLeft: space.md, paddingRight: 2 }]}>£</Text>
            <TextInput
              accessibilityLabel="Monthly price in pounds"
              accessibilityHint={tried && priceProblem ? priceProblem : undefined}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colour.inkSubtle}
              selectionColor={colour.pitch600}
              style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink, paddingRight: space.md, fontVariant: ["tabular-nums"] }]}
            />
          </View>
          {tried && priceProblem ? <FieldProblem text={priceProblem} /> : <Text style={[type.caption, { color: colour.inkMuted }]}>Collected every month by Direct Debit. At least £1.00.</Text>}
        </View>

        {askPriceStart && priceChanged && (
          <View accessibilityRole="radiogroup" accessibilityLabel="When the new price starts" style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>New Price Starts</Text>
            <ChoiceRow kind="radio" checked={start === "today"} label="Today" description="For anyone who joins from today." onPress={() => setStart("today")} />
            <ChoiceRow kind="radio" checked={start === "next"} label={`On ${formatFinanceDate(nextMonthFirst, "long")}`} description="For anyone who joins from the 1st of next month." onPress={() => setStart("next")} />
            <ChoiceRow kind="radio" checked={start === "date"} label="On Another Date" description={start === "date" ? null : "Choose the day it starts."} onPress={() => setStart("date")}>
              {start === "date" && (
                <View style={{ marginTop: space.sm }}>
                  <DateField label="New price starts" value={startDate} onChange={setStartDate} />
                </View>
              )}
            </ChoiceRow>
            {tried && dateProblem && <FieldProblem text={dateProblem} />}
            <Text style={[type.caption, { color: colour.inkMuted }]}>Members already enrolled keep paying their current price.</Text>
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Teams</Text>
          {teams.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>The club has no teams yet.</Text>}
          {/* THE TEAM DIRECTORY'S GROUPS, each with Select All for the teams no other membership has: a club with
              twenty teams ticks a group, not twenty rows. A team in another membership is still a decision of its own. */}
          {groupTeams(teams).map((group) => {
            const free = group.teams.filter((t) => !t.productId || t.productId === membership?.id)
            const allFree = free.length > 0 && free.every((t) => picked.has(t.id))
            return (
              <View key={group.key} style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingTop: space.xs }}>
                  <Text accessibilityRole="header" style={[type.caption, { color: colour.inkMuted, fontFamily: font.bodySemi }]}>
                    {group.title}
                  </Text>
                  {free.length > 1 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={allFree ? `Clear all ${group.title} teams` : `Select all ${group.title} teams`}
                      onPress={() => {
                        const next = new Set(picked)
                        for (const t of free) {
                          if (allFree) next.delete(t.id)
                          else next.add(t.id)
                        }
                        setPicked(next)
                      }}
                      hitSlop={6}
                      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={[type.smallMedium, { color: colour.forest800 }]}>{allFree ? "Clear All" : "Select All"}</Text>
                    </Pressable>
                  )}
                </View>
                {group.teams.map((team) => {
                  const on = picked.has(team.id)
                  const elsewhere = team.productId && team.productId !== membership?.id ? owner.get(team.productId) : null
                  return (
                    <ChoiceRow
                      key={team.id}
                      kind="checkbox"
                      checked={on}
                      label={team.name}
                      description={elsewhere ? (on ? `Moves here from ${elsewhere}.` : `In ${elsewhere}.`) : null}
                      onPress={() => {
                        const next = new Set(picked)
                        if (on) next.delete(team.id)
                        else next.add(team.id)
                        setPicked(next)
                      }}
                    />
                  )
                })}
              </View>
            )
          })}
          {tried && teamProblem && <FieldProblem text={teamProblem} />}
        </View>

        {membership && onArchive && membership.activeMemberships === 0 && (
          <View style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${membership.name}`}
              onPress={onArchive}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.danger }]}>Remove This Membership</Text>
            </Pressable>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Nobody is paying for it. Its teams will have no membership until you add them to another.</Text>
          </View>
        )}
      </ScrollView>
    </Sheet>
  )
}

function fieldStyle(invalid: boolean) {
  return {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: invalid ? 1.5 : 1,
    borderColor: invalid ? colour.danger : colour.lineStrong,
    backgroundColor: colour.surface,
    color: colour.ink,
  } as const
}

function FieldProblem({ text }: { text: string }) {
  // iOS does not announce an "alert" role when it appears, so the problem is said once as well.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(text)
  }, [text])
  return (
    <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger }]}>
      {text}
    </Text>
  )
}

/** The 28 days a monthly Direct Debit can fall on -- every month has them. */
export function CollectionDaySheet({ visible, day, onClose, onChoose }: { visible: boolean; day: number; onClose: () => void; onChoose: (day: number) => void }) {
  const [draft, setDraft] = useState(day)
  useEffect(() => {
    if (visible) setDraft(day)
  }, [visible, day])
  return (
    <Sheet visible={visible} title="Collection Day" hint="Every month has these 28 days, so the day never moves." onClose={onClose} onSave={() => onChoose(draft)} saving={false} problem={null} saveLabel="Use This Day" brand>
      <ScrollView style={{ maxHeight: 360 }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Collection day" style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
            const on = d === draft
            return (
              <Pressable
                key={d}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${ordinalWord(d)} of each month`}
                onPress={() => setDraft(d)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET + 4,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space.md,
                  borderTopWidth: d === 1 ? 0 : 1,
                  borderTopColor: colour.line,
                  backgroundColor: pressed ? "rgba(16,21,18,0.03)" : on ? colour.mint100 : "transparent",
                })}
              >
                <Text style={[type.small, { flex: 1, color: colour.ink, fontFamily: on ? font.bodySemi : font.body }]}>{`${ordinalWord(d)} of each month`}</Text>
                {on && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </Sheet>
  )
}

/**
 * WHAT THE CLUB AGREES TO -- Ovalball's fee and what Ovalball does on the club's GoCardless account.
 *
 * The five points are shown by their headings, each one's detail a tap away for all of them at once, and the
 * agreement is a box the person ticks themselves: it is recorded (who, when, which version) only when they then
 * act on it. The wording is PROPOSED, and says so, until the owner and legal approve it.
 */
export function TermsCard({
  title,
  bps,
  terms,
  clubName,
  agreed,
  onToggle,
  canAgree,
  agreeBelow = false,
}: {
  title: string
  bps: number
  terms: { accepted: boolean; acceptedAt: string | null; acceptedByName: string | null }
  clubName: string | null
  agreed: boolean
  onToggle: () => void
  canAgree: boolean
  /** The box to tick sits with the button it unlocks (the screen's footer), so the card only points to it. */
  agreeBelow?: boolean
}) {
  const [open, setOpen] = useState(false)
  const points = clubMembershipTermsPoints(bps)
  const club = clubName ?? "the club"
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{`What ${club} agrees to by collecting memberships through Ovalball.`}</Text>
      </View>
      <View style={{ gap: space.sm }}>
        {points.map((point) => (
          <View key={point.title} accessible accessibilityLabel={open ? `${point.title}. ${point.body}` : point.title} style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.forest800, marginTop: 7 }} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{point.title}</Text>
              {open && <Text style={[type.small, { color: colour.inkMuted }]}>{point.body}</Text>}
            </View>
          </View>
        ))}
      </View>
      {/* Never folded away: a club that uses GoCardless for anything else needs to see this before it agrees. */}
      <Text style={[type.small, { color: colour.ink }]}>{GOCARDLESS_ACCESS_SENTENCE}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? "Show less" : "Read the details"}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{open ? "Show Less" : "Read the Details"}</Text>
        {open ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
      </Pressable>
      {open && <Text style={[type.caption, { color: colour.inkSubtle }]}>{CLUB_MEMBERSHIP_TERMS_STATUS}</Text>}
      {terms.accepted ? (
        <View accessible style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colour.line }}>
          <CircleCheck size={18} color={colour.pitch600} />
          <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{`Agreed by ${terms.acceptedByName ?? "the club"}${terms.acceptedAt ? ` on ${formatFinanceDate(terms.acceptedAt, "long")}` : ""}.`}</Text>
        </View>
      ) : canAgree ? (
        <ChoiceRow kind="checkbox" checked={agreed} label={`I agree on behalf of ${club}`} onPress={onToggle} />
      ) : agreeBelow ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>{`Tick the box below, beside the button, to agree for ${club}.`}</Text>
      ) : (
        <Text style={[type.small, { color: colour.inkMuted }]}>Someone who can connect GoCardless or set up memberships agrees to these for the club.</Text>
      )}
    </View>
  )
}

/**
 * What Activate is waiting for -- amber, because it is, and each line the club can do something about opens the
 * step that finishes it. Waiting for GoCardless's own review is not a task: it is said, never offered as a link.
 */
export function StillToDo({ missing, connection, onOpen, bare = false }: { missing: ReadinessItem[]; connection: ConnectionState; onOpen?: (item: ReadinessItem) => void; bare?: boolean }) {
  if (missing.length === 0) return null
  return (
    <View style={bare ? { gap: space.xs } : { borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(138,90,0,0.18)", backgroundColor: colour.warningSurface, padding: space.md, gap: space.xs }}>
      {!bare && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <TriangleAlert size={16} color={colour.warning} />
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.warning }]}>
            Still to Do
          </Text>
        </View>
      )}
      {missing.map((item) => {
        const actionable = !!onOpen && !(item === "VERIFY" && connection !== "ACTION_REQUIRED")
        return (
          <Pressable
            key={item}
            accessibilityRole={actionable ? "button" : "text"}
            accessibilityLabel={readinessSentence(item, connection)}
            disabled={!actionable}
            onPress={() => onOpen?.(item)}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{readinessSentence(item, connection)}</Text>
            {actionable && <ChevronRight size={16} color={colour.warning} />}
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * THE FINISHED ENDING WHILE GOCARDLESS VERIFIES. Everything the club can do is done; Activate waits for GoCardless,
 * and the club is told how it will hear. A settled surface, not a to-do.
 */
export function ReadyAndWaiting({ clubName }: { clubName: string | null }) {
  return (
    <View accessible accessibilityLabel={`Everything's ready. ${verificationWaitSentence(clubName)}`} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, padding: space.lg }}>
      <IconTile>
        <Clock size={20} color={colour.forest800} />
      </IconTile>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{"Everything's Ready"}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{verificationWaitSentence(clubName)}</Text>
      </View>
    </View>
  )
}
