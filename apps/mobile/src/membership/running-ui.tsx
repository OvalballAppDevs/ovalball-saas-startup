import { useEffect, useState, type ReactNode } from "react"
import { AccessibilityInfo, Linking, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native"
import {
  STANDING_LABEL,
  formatMoneyMinor,
  reasonShort,
  type MembershipMoney,
  type MembershipRow,
  type MembershipStanding,
  type StandingCounts,
} from "@ovalball/contracts/membership/board"
import { needsActionCount, type StandingGuidance } from "@ovalball/contracts/membership/operate"
import { membershipSetupErrorMessage } from "@ovalball/contracts/membership/setup"
import { billingPeriodLabel } from "@ovalball/contracts/club/finance"

import { Sheet } from "../components/field-sheet"
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock, Mail, Phone, Search, TriangleAlert } from "../components/icons"
import { PersonAvatar } from "../components/identity"
import { Button, Card } from "../components/ui"
import { friendlyAction } from "../errors/translate"
import { MoneyList, StandingPill } from "./board-ui"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, font, radius, space, type } from "../design/tokens"

/**
 * RUNNING CLUB MEMBERSHIPS -- THE SHARED PIECES (Club Memberships Part 2).
 *
 * The club's screens (Overview, Members, a member, Reminders, Teams) and a Team Manager's squad view are built from
 * these, so a standing looks the same wherever it is read:
 *
 *   StandingBar      the one bold element: the squad's standings as a single stacked bar, words always beside it
 *   MemberRow        one player: initials, name, team or membership, the standing and its reason in a few words
 *   StatusCard       what a standing means for the reader, with the one thing to do about it
 *   IdentityBlock    a member's name, teams and standing at the top of their page
 *   DetailRow        a label and its value, stacked at large text sizes
 *   SegmentedTabs    a tablist of two or three segments, with counts
 *   SearchField / DropdownChip / PickerSheet / ChecklistSheet   finding and filtering members
 *   AsyncButton      a canonical Button that is busy while it works and says what happened
 *   MoneySheet       the month's money, every line, and where collected money goes
 *
 * Every figure, word and standing comes from the shared contracts; nothing here decides who is up to date.
 */

// ------------------------------------------------------------------------------------------------------- words

/** A line drawn with " · " between its facts, said with commas: a separator is for the eye, not the ear. */
export function spoken(line: string): string {
  return line.replace(/ · /g, ", ")
}

export function personName(firstName: string, surname: string): string {
  return `${firstName} ${surname}`.trim()
}

/** "1 Nov" from a date or a timestamp. A plain date is read as the day it names, whatever the phone's time zone. */
export function shortDate(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-GB", dateOnly ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short" })
}

/** "Under 12 Boys", "Under 12 Boys +1" -- a row has room for one team's name. */
export function firstTeam(teams: { name: string }[] | undefined): string | null {
  if (!teams || teams.length === 0) return null
  return teams.length === 1 ? teams[0]!.name : `${teams[0]!.name} +${teams.length - 1}`
}

/** The same, spoken: "Under 12 Boys and 1 more team". */
function teamsSpoken(teams: { name: string }[] | undefined): string | null {
  if (!teams || teams.length === 0) return null
  if (teams.length === 1) return teams[0]!.name
  const more = teams.length - 1
  return `${teams[0]!.name} and ${more} more ${more === 1 ? "team" : "teams"}`
}

/** A row's reason in a few words -- or, for a Direct Debit simply waiting for its day, the day. */
export function rowDetail(row: Pick<MembershipRow, "reason" | "nextCollectionDate">, viewer: "club" | "team" = "club"): string {
  if (row.reason === "SCHEDULED" && row.nextCollectionDate) {
    const day = shortDate(row.nextCollectionDate)
    if (day) return `Next collection ${day}`
  }
  return reasonShort(row.reason, viewer)
}

/** How many of a set need somebody to act: Action needed, Overdue, Not set up and Due, each counted once. */
export function needsActionOf(c: StandingCounts): number {
  return needsActionCount(c)
}

/**
 * "36 up to date · 3 collecting · 12 need action" -- the words beside a standing bar, zeros left out. A count and
 * its word never part at a line end (a no-break space), so a line never ends on a bare "1".
 */
export function standingWords(c: StandingCounts, { needs = true }: { needs?: boolean } = {}): string {
  const n = needsActionOf(c)
  const parts = [`${c.upToDate}\u00a0up to date`]
  if (c.collecting > 0) parts.push(`${c.collecting}\u00a0collecting`)
  if (needs && n > 0) parts.push(`${n}\u00a0${n === 1 ? "needs" : "need"} action`)
  if (c.exempt > 0) parts.push(`${c.exempt}\u00a0exempt`)
  return parts.join(" · ")
}

/**
 * Each standing's count among some rows -- a team's, from the club's own board -- so a team's bar is drawn from the
 * same standings the server gave each row. An ended membership is history, so it is not counted in the total.
 */
export function standingCounts(rows: Pick<MembershipRow, "standing">[]): StandingCounts {
  const c: StandingCounts = { total: 0, upToDate: 0, collecting: 0, due: 0, overdue: 0, actionNeeded: 0, notSetUp: 0, exempt: 0, ended: 0 }
  for (const r of rows) {
    if (r.standing === "ENDED") {
      c.ended = (c.ended ?? 0) + 1
      continue
    }
    c.total += 1
    if (r.standing === "UP_TO_DATE") c.upToDate += 1
    else if (r.standing === "COLLECTING") c.collecting += 1
    else if (r.standing === "DUE") c.due += 1
    else if (r.standing === "OVERDUE") c.overdue += 1
    else if (r.standing === "ACTION_NEEDED") c.actionNeeded += 1
    else if (r.standing === "NOT_SET_UP") c.notSetUp += 1
    else if (r.standing === "EXEMPT") c.exempt += 1
  }
  return c
}

/**
 * A refusal while reminding, in words. The server's own sentences pass (who may remind, how many at a time); the
 * daily limit (54000) is said plainly; anything else is the translator's generic line, never the database's text.
 */
export function reminderProblem(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code: unknown }).code) : ""
  if (code === "54000") return "That is more reminders than one person can send in a day. Try again tomorrow."
  return membershipSetupErrorMessage(cause, friendlyAction(cause, "send", "the reminder").message)
}

// ------------------------------------------------------------------------------------------------ the standing bar

/** Left to right: settled first, money on its way, then what needs somebody, the most serious at the end. */
const BAR_ORDER: MembershipStanding[] = ["UP_TO_DATE", "COLLECTING", "EXEMPT", "DUE", "NOT_SET_UP", "OVERDUE", "ACTION_NEEDED"]

/**
 * Each standing's shade: forest up to date, mint collecting, grey due, amber overdue, red action needed. Not set up
 * shares overdue's amber as an OUTLINE -- both want the family, but nothing has been set up to be late -- and
 * exempt is a flat pale grey, a part of the club that owes nothing. Tokens only; the legend draws the same swatches.
 */
// colour.ink at 30%: the website's grey for due (bg-ink/30), far enough from exempt's 10% to be told apart.
const DUE_GREY = "rgba(16,21,18,0.30)"

const BAR_SHADE: Record<MembershipStanding, { fill: string; edge?: string }> = {
  UP_TO_DATE: { fill: colour.forest800 },
  COLLECTING: { fill: colour.mint300 },
  DUE: { fill: DUE_GREY },
  OVERDUE: { fill: colour.warning },
  NOT_SET_UP: { fill: colour.surface, edge: colour.warning },
  ACTION_NEEDED: { fill: colour.danger },
  EXEMPT: { fill: colour.line },
  ENDED: { fill: colour.line },
}

function countOf(c: StandingCounts, s: MembershipStanding): number {
  switch (s) {
    case "UP_TO_DATE":
      return c.upToDate
    case "COLLECTING":
      return c.collecting
    case "DUE":
      return c.due
    case "OVERDUE":
      return c.overdue
    case "ACTION_NEEDED":
      return c.actionNeeded
    case "NOT_SET_UP":
      return c.notSetUp
    case "EXEMPT":
      return c.exempt
    case "ENDED":
      return 0
  }
}

/**
 * THE STANDING BAR -- the one bold element of running memberships: the same on the Overview, on every team and on
 * a Team Manager's squad. It is a picture of words printed beside it, so a screen reader is given those words once
 * rather than the bar as well, and nobody has to tell the colours apart to know where things stand. Every standing
 * anybody is in keeps a visible sliver, however large the club.
 */
export function StandingBar({ counts, height = 12 }: { counts: StandingCounts; height?: number }) {
  const parts = BAR_ORDER.map((s) => ({ s, n: countOf(counts, s) })).filter((p) => p.n > 0)
  const total = parts.reduce((sum, p) => sum + p.n, 0)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", height, gap: 2, borderRadius: radius.pill, overflow: "hidden", backgroundColor: total === 0 ? colour.line : "transparent" }}
    >
      {parts.map(({ s, n }) => {
        const shade = BAR_SHADE[s]
        return <View key={s} style={{ flexBasis: 0, flexGrow: Math.max(n, total * 0.03), backgroundColor: shade.fill, borderWidth: shade.edge ? 1.5 : 0, borderColor: shade.edge ?? "transparent" }} />
      })}
    </View>
  )
}

/** The bar's key, in the bar's order: each standing anybody is in, with its count. Zeros are left out. */
export function standingLegendItems(counts: StandingCounts): { standing: MembershipStanding; count: number; words: string }[] {
  return BAR_ORDER.map((s) => ({ standing: s, count: countOf(counts, s) }))
    .filter((p) => p.count > 0)
    .map((p) => ({ ...p, words: `${p.count}\u00a0${STANDING_LABEL[p.standing].toLowerCase()}` }))
}

/** The key said aloud: "36 up to date, 3 collecting, 2 overdue". */
export function standingLegendSpoken(counts: StandingCounts): string {
  return standingLegendItems(counts)
    .map((i) => i.words.replace(/\u00a0/g, " "))
    .join(", ")
}

/**
 * THE STANDING BAR'S KEY -- the swatch the bar draws, the standing's name and its count, for each standing anybody
 * is in. The bar is a picture of these words, so a reader never has to guess what a colour means. Whole items wrap;
 * a count never parts from its word. Said once, by whatever holds it (`standingLegendSpoken`).
 */
export function StandingLegend({ counts }: { counts: StandingCounts }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: space.xs }}>
      {standingLegendItems(counts).map((i) => {
        const shade = BAR_SHADE[i.standing]
        return (
          <View key={i.standing} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: shade.fill, borderWidth: shade.edge ? 1.5 : 0, borderColor: shade.edge ?? "transparent" }} />
            <Text style={[type.small, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{i.words}</Text>
          </View>
        )
      })}
    </View>
  )
}

// ------------------------------------------------------------------------------------------------------- rows

/**
 * ONE MEMBER, ONE ROW: the whole row opens them. Initials, never a photograph (no authorised register picture
 * exists); the team for the club, the membership for a team's own staff; the standing; and its reason in a few
 * words. Read as one sentence by VoiceOver. Without `onPress` it is a line to read, not a control.
 */
export function MemberRow({
  row,
  first,
  context,
  onPress,
  hint,
}: {
  row: MembershipRow
  first: boolean
  /** The club sees a member's team; a team's staff see the membership (their board carries no other team). */
  context: "club" | "team"
  onPress?: () => void
  hint?: string
}) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  const name = personName(row.firstName, row.surname)
  const subtitle = context === "club" ? firstTeam(row.teams) : (row.membership?.name ?? null)
  const subtitleSpoken = context === "club" ? teamsSpoken(row.teams) : (row.membership?.name ?? null)
  const detail = rowDetail(row, context)
  const said = `${[subtitleSpoken ? `${name}, ${subtitleSpoken}` : name, STANDING_LABEL[row.standing], detail].join(". ")}.`
  const frame = (pressed: boolean): ViewStyle => ({
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.lg,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: colour.line,
    backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
  })
  const content = (
    <>
      {/* AT LARGE TEXT SIZES the initials give their width to the words: the row is the name, never the badge. */}
      {stacked ? null : (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <PersonAvatar name={name} url={null} size={40} />
        </View>
      )}
      {stacked ? (
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={[type.bodyMedium, { color: colour.ink }]}>{name}</Text>
          {subtitle ? <Text style={[type.small, { color: colour.inkMuted }]}>{subtitle}</Text> : null}
          <StandingPill standing={row.standing} />
          <Text style={[type.small, { color: colour.inkMuted }]}>{detail}</Text>
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink }]}>
              {name}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={[type.small, { color: colour.inkMuted }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end", gap: 4, maxWidth: "52%" }}>
            <View style={{ alignSelf: "flex-end" }}>
              <StandingPill standing={row.standing} />
            </View>
            <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted, textAlign: "right" }]}>
              {detail}
            </Text>
          </View>
        </View>
      )}
      {onPress ? <ChevronRight size={18} color={colour.inkSubtle} /> : null}
    </>
  )
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={said} style={frame(false)}>
        {content}
      </View>
    )
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={said} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => frame(pressed)}>
      {content}
    </Pressable>
  )
}

/** A label and its value. Side by side while both fit; at large text sizes the value goes under its label. */
export function DetailRow({ label, value, caption, first = false }: { label: string; value: string; caption?: string | null; first?: boolean }) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  return (
    <View
      accessible
      accessibilityLabel={spoken(`${label}: ${value}${caption ? `. ${caption}` : ""}`)}
      style={{ paddingVertical: space.sm + 2, gap: 2, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}
    >
      {stacked ? (
        <>
          <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
          <Text style={[type.bodyMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
        </>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
          <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{value}</Text>
        </View>
      )}
      {caption ? <Text style={[type.caption, { color: colour.inkMuted, textAlign: stacked ? "left" : "right", fontVariant: ["tabular-nums"] }]}>{caption}</Text> : null}
    </View>
  )
}

/** An email address or telephone number the reader may contact -- the phone's own mail app or dialler. */
export function ContactRow({ kind, value }: { kind: "email" | "phone"; value: string }) {
  const [failed, setFailed] = useState(false)
  const Icon = kind === "email" ? Mail : Phone
  const open = () => (kind === "email" ? Linking.openURL(`mailto:${value}`) : Linking.openURL(`tel:${value.replace(/[^\d+]/g, "")}`))
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colour.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={kind === "email" ? `Email ${value}` : `Call ${value}`}
        accessibilityHint={kind === "email" ? "Opens your email app" : "Opens your phone's dialler"}
        onPress={() => {
          setFailed(false)
          // A simulator or a tablet may have no mail app or dialler; saying so beats a button that does nothing.
          void open().catch(() => setFailed(true))
        }}
        style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, opacity: pressed ? 0.7 : 1 })}
      >
        <Icon size={18} color={colour.forest800} />
        <Text style={[type.small, { color: colour.forest800, flex: 1 }]}>{value}</Text>
      </Pressable>
      {failed && <Text style={[type.caption, { color: colour.inkMuted, paddingBottom: space.sm }]}>{kind === "email" ? "This device can't open an email app." : "This device can't make calls."}</Text>}
    </View>
  )
}

// ------------------------------------------------------------------------------------------------ status and identity

const GUIDANCE_TONE: Record<StandingGuidance["tone"], { disc: string; ink: string; Icon: typeof CircleAlert }> = {
  settled: { disc: colour.mint100, ink: colour.forest800, Icon: CircleCheck },
  moving: { disc: colour.mint100, ink: colour.rugby700, Icon: Clock },
  neutral: { disc: "rgba(16,21,18,0.05)", ink: colour.inkMuted, Icon: Clock },
  attention: { disc: colour.warningSurface, ink: colour.warning, Icon: TriangleAlert },
  problem: { disc: colour.dangerSurface, ink: colour.danger, Icon: CircleAlert },
  quiet: { disc: "rgba(16,21,18,0.05)", ink: colour.inkSubtle, Icon: CircleCheck },
}

/**
 * WHAT A STANDING MEANS FOR THE READER: what happened, whether it sorts itself out and who needs to act
 * (`standingGuidance`), with the icon in the guidance's own tone. `children` is the one thing to do about it.
 * `flat` draws it without its card, for a sheet that is already a surface.
 */
export function StatusCard({ guidance, children, flat = false }: { guidance: StandingGuidance; children?: ReactNode; flat?: boolean }) {
  const tone = GUIDANCE_TONE[guidance.tone]
  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tone.disc, alignItems: "center", justifyContent: "center" }}>
          <tone.Icon size={20} color={tone.ink} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {guidance.title}
          </Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>{guidance.body}</Text>
        </View>
      </View>
      {children}
    </>
  )
  if (flat) return <View style={{ gap: space.md }}>{body}</View>
  return <Card style={{ gap: space.md }}>{body}</Card>
}

/** A member at the top of their page: initials, name, teams and membership, and the standing in words. */
export function IdentityBlock({ name, line, standing }: { name: string; line: string | null; standing: MembershipStanding }) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  return (
    <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: space.md }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <PersonAvatar name={name} url={null} size={64} />
      </View>
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          {name}
        </Text>
        {line ? <Text style={[type.small, { color: colour.inkMuted }]}>{line}</Text> : null}
        <StandingPill standing={standing} />
      </View>
    </View>
  )
}

// ----------------------------------------------------------------------------------------------------- controls

/** Two or three segments of one tablist, each with its count; they stack at large text sizes rather than clip. */
export function SegmentedTabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (key: K) => void; label: string }) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: stacked ? "column" : "row", gap: 3, padding: 3, borderRadius: radius.md, backgroundColor: "rgba(16,21,18,0.05)" }}>
      {tabs.map((t) => {
        const on = t.key === value
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.count === undefined ? t.label : `${t.label}, ${t.count}`}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => ({
              flex: stacked ? undefined : 1,
              minHeight: TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              backgroundColor: on ? colour.forest800 : "transparent",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[type.smallMedium, { color: on ? colour.onForest : colour.ink, flexShrink: 1 }]}>
              {t.label}
            </Text>
            {t.count !== undefined && <Text style={[type.caption, { color: on ? colour.onForestMuted : colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{t.count}</Text>}
          </Pressable>
        )
      })}
    </View>
  )
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (next: string) => void; placeholder: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
      <Search size={18} color={colour.inkSubtle} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        selectionColor={colour.pitch600}
        style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]}
      />
    </View>
  )
}

/** A filter that opens a list: it shows what is chosen, and a forest fill says a choice is on. */
export function DropdownChip({ label, value, anyLabel, onPress }: { label: string; value: string | null; anyLabel: string; onPress: () => void }) {
  const on = value !== null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${on ? value : anyLabel}`}
      accessibilityHint="Opens a list to choose from"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: on ? colour.forest800 : colour.lineStrong,
        backgroundColor: on ? colour.forest800 : colour.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text numberOfLines={1} style={[type.smallMedium, { color: on ? colour.onForest : colour.ink, flexShrink: 1 }]}>
        {on ? value : label}
      </Text>
      <ChevronDown size={16} color={on ? colour.onForest : colour.inkMuted} />
    </Pressable>
  )
}

export interface PickerOption {
  id: string
  label: string
  detail?: string | null
}

function OptionRow({ option, kind, checked, first, onPress }: { option: PickerOption; kind: "radio" | "checkbox"; checked: boolean; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked }}
      accessibilityLabel={spoken(option.detail ? `${option.label}, ${option.detail}` : option.label)}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 4,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : checked ? colour.mint100 : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: colour.ink, fontFamily: checked ? font.bodySemi : font.body }]}>{option.label}</Text>
        {option.detail ? <Text style={[type.caption, { color: colour.inkMuted }]}>{option.detail}</Text> : null}
      </View>
      {checked && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
    </Pressable>
  )
}

const listBox: StyleProp<ViewStyle> = { borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }

/** One choice from a list, applied on Apply. `allLabel` adds the "everybody" choice at the top. */
export function PickerSheet({
  visible,
  title,
  hint,
  options,
  allLabel,
  value,
  emptyMessage,
  onClose,
  onApply,
  applyLabel = "Apply Filter",
}: {
  visible: boolean
  title: string
  hint?: string
  options: PickerOption[]
  allLabel?: string
  value: string | null
  emptyMessage?: string
  onClose: () => void
  onApply: (id: string | null) => void
  applyLabel?: string
}) {
  const [draft, setDraft] = useState<string | null>(value)
  const { height } = useWindowDimensions()
  useEffect(() => {
    if (visible) setDraft(value)
  }, [visible, value])
  const rows: PickerOption[] = allLabel ? [{ id: "", label: allLabel }, ...options] : options
  return (
    <Sheet visible={visible} title={title} hint={hint} onClose={onClose} onSave={() => onApply(draft)} saving={false} problem={null} saveLabel={applyLabel} canSave={allLabel !== undefined || draft !== null} brand>
      {options.length === 0 && emptyMessage ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>{emptyMessage}</Text>
      ) : (
        <ScrollView style={{ maxHeight: Math.max(220, height * 0.5) }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={title} style={listBox}>
            {rows.map((o, i) => {
              const id = o.id || null
              return <OptionRow key={o.id || "all"} option={o} kind="radio" checked={draft === id} first={i === 0} onPress={() => setDraft(id)} />
            })}
          </View>
        </ScrollView>
      )}
    </Sheet>
  )
}

/** Several choices from a list -- the members a reminder goes to. */
export function ChecklistSheet({
  visible,
  title,
  hint,
  options,
  value,
  emptyMessage,
  onClose,
  onApply,
  applyLabel,
}: {
  visible: boolean
  title: string
  hint?: string
  options: PickerOption[]
  value: string[]
  emptyMessage: string
  onClose: () => void
  onApply: (ids: string[]) => void
  applyLabel: (count: number) => string
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set(value))
  const { height } = useWindowDimensions()
  useEffect(() => {
    if (visible) setDraft(new Set(value))
  }, [visible, value])
  const allOn = options.length > 0 && options.every((o) => draft.has(o.id))
  return (
    <Sheet visible={visible} title={title} hint={hint} onClose={onClose} onSave={() => onApply(options.filter((o) => draft.has(o.id)).map((o) => o.id))} saving={false} problem={null} saveLabel={applyLabel(draft.size)} canSave={draft.size > 0} brand>
      {options.length === 0 ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>{emptyMessage}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {options.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={allOn ? "Clear all" : `Select all ${options.length}`}
              onPress={() => setDraft(allOn ? new Set() : new Set(options.map((o) => o.id)))}
              hitSlop={6}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{allOn ? "Clear All" : "Select All"}</Text>
            </Pressable>
          )}
          <ScrollView style={{ maxHeight: Math.max(200, height * 0.45) }}>
            <View accessibilityLabel={title} style={listBox}>
              {options.map((o, i) => (
                <OptionRow
                  key={o.id}
                  option={o}
                  kind="checkbox"
                  checked={draft.has(o.id)}
                  first={i === 0}
                  onPress={() => {
                    const next = new Set(draft)
                    if (next.has(o.id)) next.delete(o.id)
                    else next.add(o.id)
                    setDraft(next)
                  }}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </Sheet>
  )
}

/**
 * THE CANONICAL BUTTON, FOR A JOB THAT TAKES A MOMENT: busy while it works, then the sentence the job returns is
 * said to VoiceOver as a whole sentence. The job itself shows the sentence on the screen and never throws.
 */
export function AsyncButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  accessibilityHint,
  icon,
  style,
}: {
  label: string
  onPress: () => Promise<string | null | void>
  variant?: "primary" | "brand" | "secondary" | "quiet" | "danger"
  disabled?: boolean
  accessibilityHint?: string
  icon?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const said = await onPress()
      if (said) AccessibilityInfo.announceForAccessibility(said)
    } finally {
      setBusy(false)
    }
  }
  return <Button label={label} variant={variant} busy={busy} disabled={disabled} accessibilityHint={accessibilityHint} icon={icon} style={style} onPress={() => void run()} />
}

// --------------------------------------------------------------------------------------------------- the money

function ChainLine({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, paddingVertical: 3 }}>
      <Text style={[strong ? type.bodyMedium : type.small, { color: muted ? colour.inkMuted : colour.ink, flexShrink: 1 }]}>{label}</Text>
      <Text style={[strong ? type.heading : type.smallMedium, { color: muted ? colour.inkMuted : colour.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}

/**
 * THIS MONTH'S MONEY -- every line of the club board's month, and where collected money goes: what was collected,
 * Ovalball's fee on it, and what the club receives before GoCardless's own fee. Money with the bank is never
 * called collected, and GoCardless's fee is never estimated -- it is only known when GoCardless pays the club out.
 */
export function MoneySheet({
  visible,
  money,
  feePercentLabel,
  onClose,
  onOpenPayments,
}: {
  visible: boolean
  money: MembershipMoney
  /** "2.5%", from the server's rate, when the screen has it. */
  feePercentLabel: string | null
  onClose: () => void
  onOpenPayments: () => void
}) {
  const { height } = useWindowDimensions()
  const m = (minor: number) => formatMoneyMinor(minor, money.currency)
  const month = money.period ? billingPeriodLabel(money.period) : null
  const feeLabel = feePercentLabel ? `Ovalball's fee (${feePercentLabel})` : "Ovalball's fee"
  const chain = [
    `Collected ${m(money.collectedMinor)}`,
    `${feeLabel} ${m(money.ovalballFeeMinor)}`,
    money.membersFeeMinor > 0 ? `Members paid Ovalball's fee on top: ${m(money.membersFeeMinor)}` : null,
    money.feeOnRefundsMinor > 0 ? `Fee on refunded payments ${m(money.feeOnRefundsMinor)}` : null,
    `The club receives ${m(money.clubReceivesMinor)}, before GoCardless's own fee`,
  ]
    .filter(Boolean)
    .join(". ")
  return (
    <Sheet
      visible={visible}
      title="This Month's Money"
      hint={month ? `${month} · member payments` : "Member payments"}
      onClose={onClose}
      onSave={onOpenPayments}
      saving={false}
      problem={null}
      saveLabel="Open Payments"
      brand
      dismissLabel="Close"
    >
      <ScrollView style={{ maxHeight: Math.max(260, height * 0.55) }} contentContainerStyle={{ gap: space.md }}>
        <MoneyList
          currency={money.currency}
          items={[
            { term: "Expected", minor: money.expectedMinor, meaning: "What this month's memberships come to, leaving out anything exempt, waived, refunded or cancelled." },
            { term: "Collected", minor: money.collectedMinor, meaning: "Money GoCardless has confirmed for this month, less anything refunded. Before GoCardless's own fee." },
            { term: "With the bank", minor: money.collectingMinor, meaning: "Payments with the bank now. Not counted as collected until GoCardless confirms them." },
            { term: "Outstanding", minor: money.outstandingMinor, meaning: "Owed for this month and not yet collected. It includes the money with the bank, overdue and failed." },
            { term: "Overdue", minor: money.overdueMinor, meaning: "Part of Outstanding: owed, not with the bank, and more than five days late." },
            { term: "Failed", minor: money.failedMinor, meaning: "Part of Outstanding: payments that didn't go through, or were reclaimed through the bank." },
            { term: "Refunded", minor: money.refundedMinor, meaning: "Money given back for this month." },
            { term: "Waived or exempt", minor: money.waivedMinor, meaning: "What the club chose not to collect this month." },
            { term: "Next collection", minor: money.nextCollectionMinor, meaning: "What the Direct Debits in place will collect on the next collection day." },
          ]}
        />
        <View accessible accessibilityLabel={`Where collected money goes. ${chain}.`} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: 2 }}>
          <Text style={[type.smallMedium, { color: colour.ink, marginBottom: space.xs }]}>Where Collected Money Goes</Text>
          <ChainLine label="Collected" value={m(money.collectedMinor)} />
          <ChainLine label={feeLabel} value={m(money.ovalballFeeMinor)} muted />
          {money.membersFeeMinor > 0 && <ChainLine label="Members paid Ovalball's fee on top" value={m(money.membersFeeMinor)} muted />}
          {money.feeOnRefundsMinor > 0 && <ChainLine label="Fee on refunded payments" value={m(money.feeOnRefundsMinor)} muted />}
          <View style={{ height: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: colour.lineStrong, marginVertical: space.xs }} />
          <ChainLine label="The club receives" value={m(money.clubReceivesMinor)} strong />
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
            {"Before GoCardless's own fee, which is only known when GoCardless pays the club, so it is never estimated here."}
          </Text>
          {money.feeOnRefundsMinor > 0 && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>{"GoCardless doesn't say whether its fee comes back on a refund, so that part is neither counted as Ovalball's nor left in what the club receives."}</Text>
          )}
        </View>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{"Bank details are held by GoCardless, never by Ovalball."}</Text>
      </ScrollView>
    </Sheet>
  )
}
